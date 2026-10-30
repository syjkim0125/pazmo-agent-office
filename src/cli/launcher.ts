import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  dataRoot,
  fail,
  init,
  initTeam,
  locate,
  noSymlinks,
  packageRoot,
} from "./project.ts";
import { monitor, start, startTeam, status } from "./lifecycle.ts";
import { installedRuntime, setupRuntime } from "./runtime-setup.ts";
import { assertNotInTeam, assertReposPresent, readTeam } from "../team/registry.ts";
import type { LiveConfig } from "../runtime/live.ts";
import { runCommand } from "../runners/command.ts";
import { IMAGE } from "../runners/container-verifier.ts";
import { discoverRunners } from "../runners/runner-discovery.ts";
import type { RunnerInstall, RunnerName } from "../runners/runner-discovery.ts";

/** Start needs one installed, logged-in CLI; the pinned runtime needs codex's. */
export function assertRunnerLogin(
  installs: Record<RunnerName, RunnerInstall>,
  o: { codexAuth: boolean; codexRuntime?: "installed" | "pinned" },
) {
  const ready = Object.values(installs).some(
    (i) => i.status === "ready" && i.loggedIn && !i.blocked,
  );
  if (o.codexRuntime === "pinned" ? o.codexAuth && !installs.codex.blocked : ready) return;
  fail(
    "LOGIN_REQUIRED",
    `최초 준비: codex 또는 claude 중 하나를 설치하고 로그인한 뒤 다시 실행해주세요. codex: ${installs.codex.hint} claude: ${installs.claude.hint} 로그인 정보는 VM에 복사하지 않습니다.`,
  );
}

type Run = (
  executable: string,
  args: string[],
  cwd?: string,
) => Promise<string>;
const run: Run = async (executable, args, cwd = packageRoot) => {
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
  };
  // Profile lookup must agree with the fixed configuration/socket we inspect.
  for (const key of [
    "COLIMA_HOME",
    "LIMA_HOME",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
  ])
    delete (env as NodeJS.ProcessEnv)[key];
  const result = await runCommand(executable, args, {
    cwd,
    timeoutMs: 600000,
    maxBytes: 8 * 1024 * 1024,
    env,
  });
  if (result.exitCode !== 0 || result.error || result.timedOut || result.signal)
    fail(
      "SETUP_FAILED",
      `${executable} ${args[0] ?? ""}: ${result.error || result.stderr.slice(-3000) || result.stdout.slice(-3000) || "command failed"}`,
    );
  return result.stdout;
};

/** Accept only the explicit, mount-free profile produced by our startup flags.
 * Unknown/duplicate YAML values fail closed instead of silently editing a VM. */
export function assertVmConfig(config: string) {
  for (const [key, expected] of Object.entries({
    vmType: "vz",
    mounts: "null",
    forwardAgent: "false",
    sshConfig: "false",
    portForwarder: "none",
  })) {
    const values = [...config.matchAll(new RegExp(`^${key}:([^\\n]*)`, "gm"))];
    if (values.length !== 1 || values[0][1].trim() !== expected)
      fail(
        "VM_CONFIG",
        `전용 VM의 ${key} 설정이 검증된 값과 다릅니다. 기존 VM은 변경하지 않았습니다.`,
      );
  }
}
export async function prepareVm(
  exec: Run,
  readConfig: () => string | undefined,
) {
  const previous = readConfig();
  if (previous !== undefined) assertVmConfig(previous);
  await exec("/opt/homebrew/bin/colima", [
    "start",
    "pazmo-office",
    "--vm-type",
    "vz",
    "--cpu",
    "2",
    "--memory",
    "4",
    "--disk",
    "20",
    "--mount",
    "none",
    "--activate=false",
    "--ssh-config=false",
    "--ssh-agent=false",
    "--port-forwarder",
    "none",
  ]);
  const current = readConfig();
  if (current === undefined)
    fail("VM_CONFIG", "전용 VM 설정 파일을 확인할 수 없습니다.");
  assertVmConfig(current);
  const mounts = await exec("/opt/homebrew/bin/colima", [
    "ssh",
    "--profile",
    "pazmo-office",
    "--",
    "findmnt",
    "-rn",
    "-o",
    "TARGET,SOURCE,FSTYPE",
  ]);
  if (!mounts.trim() || /virtiofs|9p|sshfs|\/Users\//.test(mounts))
    fail(
      "VM_CONFIG",
      "전용 VM에서 호스트 파일 공유가 발견되었거나 확인에 실패했습니다.",
    );
  const docker = [
    "--host",
    `unix://${join(homedir(), ".colima/pazmo-office/docker.sock")}`,
  ];
  if (
    (
      await exec("/opt/homebrew/bin/docker", [
        ...docker,
        "info",
        "--format",
        "{{.Name}}",
      ])
    ).trim() !== "colima-pazmo-office"
  )
    fail("VM_CONFIG", "전용 VM Docker daemon이 아닙니다.");
  try {
    await exec("/opt/homebrew/bin/docker", [
      ...docker,
      "image",
      "inspect",
      IMAGE,
    ]);
  } catch {
    await exec("/opt/homebrew/bin/docker", [...docker, "pull", IMAGE]);
  }
}

/** The locked `ws` version and the one installed in the package root, or null. */
function wsVersions(root: string) {
  const version = (file: string): string | null => {
    try {
      return JSON.parse(readFileSync(file, "utf8")).version ?? null;
    } catch {
      return null;
    }
  };
  let locked: string | null = null;
  try {
    locked =
      JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages?.[
        "node_modules/ws"
      ]?.version ?? null;
  } catch {
    locked = null;
  }
  return { locked, installed: version(join(root, "node_modules/ws/package.json")) };
}
/** Step 1 of `up`, before a running Office is reused: the engine loads `ws`
 * (src/runners/exec-relay.ts, and the claude tool bridge each claude job starts
 * from disk), so a reused Office needs it too. Installs the production
 * dependencies only when `ws` is missing or not the locked version, so a
 * checkout's development tools stay installed otherwise. */
export async function prepareDependencies(
  exec: Run,
  root = packageRoot,
  /** Told just before an install starts; nothing is printed otherwise, so an
   * early refusal stays the only output. */
  announce: () => void = () => {},
): Promise<"current" | "installed"> {
  const { locked, installed } = wsVersions(root);
  if (locked !== null && installed === locked) return "current";
  announce();
  await exec(
    join(dirname(process.execPath), "npm"),
    ["ci", "--omit=dev", "--prefer-offline", "--no-audit", "--no-fund"],
    root,
  );
  return "installed";
}
/** `up` reuses an Office only when it runs the engine asked for and can execute. */
export function canReuse(
  current: { status: string; engine?: string; execution?: string },
  engine: "lean" | "team",
): boolean {
  return (
    current.status === "running" &&
    current.engine === engine &&
    current.execution === "ready"
  );
}
type UpOptions = {
  project?: string;
  dataDir?: string;
  port?: number;
  open?: boolean;
  codexRuntime?: "installed" | "pinned";
  /** The engine to run; lean unless the team Office is asked for. */
  engine?: "lean" | "team";
};

/** Steps 2–3 of `up`, the same for both engines: the prerequisites and a
 * logged-in runner, the pinned Codex runtime, the dedicated VM and its
 * isolation probe. Returns the live configuration step 4 starts the Office with. */
async function prepareMachine(options: UpOptions): Promise<LiveConfig> {
  for (const name of ["colima", "docker"])
    if (!existsSync(`/opt/homebrew/bin/${name}`))
      fail(
        "PREREQUISITE",
        "최초 준비: Homebrew에서 brew install colima docker 후 다시 실행해주세요.",
      );
  assertRunnerLogin(
    await discoverRunners({ pathEnv: process.env.PATH ?? "", home: homedir() }),
    {
      codexAuth: existsSync(join(homedir(), ".codex/auth.json")),
      codexRuntime: options.codexRuntime,
    },
  );
  console.error("[1/4] 의존성 확인됨");
  console.error("[2/4] 고정된 Codex 실행 파일 확인");
  await setupRuntime(options.dataDir, true);
  console.error("[3/4] 전용 VM·이미지 준비 및 파일 공유 차단 확인");
  const config = join(homedir(), ".colima/pazmo-office/colima.yaml");
  await prepareVm(run, () =>
    existsSync(config) ? readFileSync(config, "utf8") : undefined,
  );
  // Existing diagnostic does not use credentials or call a model.
  const report = JSON.parse(
    await run("/usr/bin/python3", ["scripts/probe-vm-isolation.py"]),
  );
  if (report.exitCode !== 0) fail("VM_PROBE", "VM 경계 검증이 실패했습니다.");
  console.error(`VM 검사 기록: ${report.report}`);
  console.error("[4/4] Office 실행");
  const binaries = installedRuntime(options.dataDir);
  return {
    controller: binaries.controller,
    binary: binaries.binary,
    authHome: join(homedir(), ".codex"),
    socket: join(homedir(), ".colima/pazmo-office/docker.sock"),
    userHome: homedir(),
    searchPath: process.env.PATH ?? "",
    ...(options.codexRuntime ? { codexRuntime: options.codexRuntime } : {}),
  };
}

/** `up --team`: every registered repo is prepared as `up` prepares one (its
 * git root, its Office metadata), then the machine as for lean, then one team
 * Office runs them all. There is no page to open yet; the result is its status. */
async function upTeam(options: UpOptions) {
  const root = dataRoot(options.dataDir);
  const { repos } = readTeam(root);
  if (repos.length === 0)
    fail(
      "NO_REPOS",
      "No repo is registered in the team Office. Add one with `team add --project PATH` first.",
    );
  // Before any repo is located, checked with git or given its metadata.
  assertReposPresent(repos);
  for (const repo of repos) {
    const p = locate(repo.project, options.dataDir);
    await run("/usr/bin/git", ["-C", p.project, "rev-parse", "--show-toplevel"]);
    init(p, true);
  }
  const p = initTeam(root);
  const current = await status(p);
  if (current.status !== "stopped" && !canReuse(current, "team"))
    fail(
      "RUNNING",
      "기존 실행을 보존했습니다. status --team/stop --team으로 기존 실행 상태를 확인해주세요.",
    );
  if (current.status === "stopped")
    await startTeam(root, options.port ?? 0, await prepareMachine(options));
  return { ...(await status(p)), reused: current.status === "running" };
}

export async function up(options: UpOptions) {
  const engine = options.engine ?? "lean";
  if (process.platform !== "darwin" || process.arch !== "arm64")
    fail("PLATFORM", "현재 live 실행은 Apple Silicon macOS에서 검증됐습니다.");
  await prepareDependencies(run, packageRoot, () =>
    console.error("[1/4] 의존성 설치 (업데이트 뒤 첫 실행은 npm 레지스트리 접속이 필요합니다)"),
  );
  if (engine === "team") return upTeam(options);
  const root = dataRoot(options.dataDir),
    preference = join(root, "launcher.json");
  noSymlinks(preference);
  const saved = existsSync(preference)
    ? JSON.parse(readFileSync(preference, "utf8"))
    : undefined;
  const project = options.project ?? saved?.project;
  if (typeof project !== "string")
    fail(
      "PROJECT_REQUIRED",
      "첫 실행: ./office --project /절대/프로젝트/경로 (Office와 별도인 기존 Git 프로젝트)",
    );
  const p = locate(project, options.dataDir);
  assertNotInTeam(p);
  await run("/usr/bin/git", ["-C", p.project, "rev-parse", "--show-toplevel"]);
  init(p, true);
  const current = await status(p);
  // Another engine's Office is never replaced here: the person stops it first.
  if (
    current.status === "running" &&
    current.engine !== undefined &&
    current.engine !== engine
  )
    fail(
      "ENGINE_MISMATCH",
      "Stop the current Office before changing its runtime.",
    );
  if (current.status !== "stopped" && !canReuse(current, engine))
    fail(
      "RUNNING",
      "기존 실행을 보존했습니다. status/stop으로 기존 실행 상태를 확인해주세요.",
    );
  if (current.status === "stopped")
    await start(p, options.port ?? 0, await prepareMachine(options), engine);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const temp = `${preference}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, project: p.project }), {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temp, preference);
  const view = await monitor(p);
  if (options.open !== false) await run("/usr/bin/open", [view.url]);
  return {
    ...view,
    project: p.project,
    dataDir: p.dataDir,
    reused: current.status === "running",
  };
}
