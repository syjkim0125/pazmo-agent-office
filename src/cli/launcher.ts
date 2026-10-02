import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  dataRoot,
  fail,
  init,
  locate,
  noSymlinks,
  packageRoot,
} from "./project.ts";
import { monitor, start, status } from "./lifecycle.ts";
import { installedRuntime, setupRuntime } from "./runtime-setup.ts";
import { runCommand } from "../runners/command.ts";
import { IMAGE } from "../runners/container-verifier.ts";

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

function sourceDigest(root: string) {
  const hash = createHash("sha256");
  function visit(path: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && !entry.name.endsWith(".tsbuildinfo"))
        hash.update(child.slice(root.length)).update(readFileSync(child));
    }
  }
  // Build inputs only; no logs, databases or installed dependencies.
  for (const name of ["src", "public"]) visit(join(root, name));
  for (const entry of readdirSync(root))
    if (
      /^(package\.json|pnpm-lock\.yaml|index\.html|vite\.config\..+|tsconfig.*\.json)$/.test(
        entry,
      )
    )
      hash.update(entry).update(readFileSync(join(root, entry)));
  return hash.digest("hex");
}
export async function up(options: {
  project?: string;
  dataDir?: string;
  port?: number;
  open?: boolean;
}) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    fail("PLATFORM", "현재 live 실행은 Apple Silicon macOS에서 검증됐습니다.");
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
  await run("/usr/bin/git", ["-C", p.project, "rev-parse", "--show-toplevel"]);
  init(p, true);
  const current = await status(p);
  if (
    current.status !== "stopped" &&
    !(
      current.status === "running" &&
      current.engine === "claw" &&
      current.execution === "ready"
    )
  )
    fail(
      "RUNNING",
      "기존 실행을 보존했습니다. status/stop으로 기존 실행 상태를 확인해주세요.",
    );
  if (current.status === "stopped") {
    for (const name of ["colima", "docker"])
      if (!existsSync(`/opt/homebrew/bin/${name}`))
        fail(
          "PREREQUISITE",
          "최초 준비: Homebrew에서 brew install colima docker 후 다시 실행해주세요.",
        );
    if (!existsSync(join(homedir(), ".codex/auth.json")))
      fail(
        "LOGIN_REQUIRED",
        "최초 준비: Mac에서 codex login을 완료한 뒤 다시 실행해주세요. 로그인 정보는 VM에 복사하지 않습니다.",
      );
    const vendor = join(packageRoot, "vendor/claw-empire");
    console.error("[1/4] 설치·빌드 확인 (첫 설치는 시간이 걸릴 수 있습니다)");
    await run(
      join(dirname(process.execPath), "npx"),
      ["--yes", "pnpm@10.30.1", "install", "--frozen-lockfile"],
      vendor,
    );
    const digest = sourceDigest(vendor),
      stamp = join(vendor, "node_modules/.pazmo-build");
    if (
      !existsSync(join(vendor, "dist/index.html")) ||
      !existsSync(stamp) ||
      readFileSync(stamp, "utf8") !== digest
    ) {
      await run(
        process.execPath,
        ["node_modules/typescript/bin/tsc", "-b"],
        vendor,
      );
      await run(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "build"],
        vendor,
      );
      writeFileSync(stamp, digest);
    }
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
    await start(
      p,
      options.port ?? 0,
      {
        controller: binaries.controller,
        binary: binaries.binary,
        authHome: join(homedir(), ".codex"),
        socket: join(homedir(), ".colima/pazmo-office/docker.sock"),
      },
      "claw",
    );
  }
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
