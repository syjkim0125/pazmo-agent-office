import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  fail,
  ignoreMetadata,
  initTeam,
  noSymlinks,
  packageRoot,
  readManifest,
  teamProject,
} from "./project.ts";
import { assertNotInTeam, assertReposPresent, readTeam } from "../team/registry.ts";
import type { Project } from "./project.ts";
import type { LiveConfig } from "../runtime/live.ts";

/** The engines this version starts. */
const STARTED = ["lean", "team"] as const;
/** Engines an earlier version may have left running: still read from the
 * saved state so that Office can be shown and stopped, never started (D30).
 * A state without an engine is the legacy one. */
const RETIRED = ["legacy", "claw"] as const;
export type Engine = (typeof STARTED)[number];
type RetiredEngine = (typeof RETIRED)[number];
const ENGINES: readonly string[] = [...STARTED, ...RETIRED];
type Running = {
  version: 1;
  engine?: Engine | RetiredEngine;
  project: string;
  pid: number;
  port: number;
  token: string;
  instance: string;
};
function readState(p: Project): Running | undefined {
  const path = join(p.dataDir, "running.json");
  noSymlinks(path);
  if (!existsSync(path)) return;
  let s: Running;
  try {
    s = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(
      "UNKNOWN",
      "Runtime state is unreadable; preserve it for recovery.",
    );
  }
  if (
    s.version !== 1 ||
    (s.engine !== undefined && !ENGINES.includes(s.engine)) ||
    s.project !== p.project ||
    !Number.isInteger(s.pid) ||
    s.pid <= 0 ||
    !Number.isInteger(s.port) ||
    s.port < 1 ||
    s.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(s.token) ||
    !/^[a-f0-9]{32}$/.test(s.instance)
  )
    fail("UNKNOWN", "Runtime state is invalid; preserve it for recovery.");
  return s;
}
async function control(s: Running, action: "status" | "stop") {
  const response = await fetch(`http://127.0.0.1:${s.port}/__pazmo/${action}`, {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${s.token}` },
    signal: AbortSignal.timeout(1500),
    redirect: "error",
  });
  if (response.status === 409 && action === "stop")
    fail(
      "TASK_ACTIVE",
      "Cancel active tasks and wait for cleanup before stopping Office.",
    );
  if (!response.ok)
    throw new Error("Controller identity was not authenticated.");
  const value = (await response.json()) as {
    instance: string;
    project: string;
    status: string;
    execution?: string;
  } & Record<string, unknown>;
  if (value.instance !== s.instance || value.project !== s.project)
    throw new Error("Controller identity mismatch.");
  return value;
}
/** The service process each engine runs, as plain `node <file>`. Both need the
 * root dependencies installed: the engine loads `ws` (see dependenciesInstalled). */
const SERVICE: Record<Engine, string> = {
  lean: "src/runtime/lean-service.ts",
  team: "src/runtime/team-service.ts",
};
/** How long `start` waits for the service's ready message. Both start in under
 * 3 s even under load; a crash or an error reply ends the wait at once. */
export const STARTUP_MS: Record<Engine, number> = {
  lean: 15000,
  team: 15000,
};
/** What `status` shows of a running team Office: its TeamStatus. */
const TEAM_FIELDS = ["repos", "paused", "dailyCap", "today", "claim", "busy"] as const;
/** Whether `ws` resolves from src/runners, where exec-relay.ts imports it when
 * the service starts. */
export function dependenciesInstalled(): boolean {
  try {
    createRequire(join(packageRoot, "src/runners/exec-relay.ts")).resolve("ws");
    return true;
  } catch {
    return false;
  }
}
/** What `status` reports; a running team Office adds its TeamStatus fields. */
export type OfficeStatus = {
  status: string;
  execution: string;
  engine?: Engine | RetiredEngine;
  url?: string;
  dataDir?: string;
  reason?: string;
  [key: string]: unknown;
};
export async function status(p: Project): Promise<OfficeStatus> {
  readManifest(p);
  const s = readState(p);
  if (!s)
    return {
      status: existsSync(join(p.dataDir, "start.lock")) ? "unknown" : "stopped",
      execution: "locked",
    };
  try {
    const current = await control(s, "status");
    return {
      status: "running",
      execution: current.execution ?? "locked",
      engine: s.engine ?? "legacy",
      // The team Office has no page in stage 2: its repos instead of a URL.
      ...(s.engine === "team"
        ? Object.fromEntries(TEAM_FIELDS.map((key) => [key, current[key]]))
        : { url: `http://127.0.0.1:${s.port}` }),
      dataDir: p.dataDir,
    };
  } catch {
    return {
      status: "unknown",
      execution: "locked",
      reason:
        "Saved runtime cannot be authenticated; no PID will be signalled.",
    };
  }
}
export async function start(
  p: Project,
  port: number,
  live?: LiveConfig,
  engine: Engine = "lean",
  /** Checks before anything starts; tests replace them. */
  checks: { installed: () => boolean } = { installed: dependenciesInstalled },
) {
  assertNotInTeam(p);
  const current = await status(p);
  if (current.status === "running") {
    if (current.engine !== engine)
      fail(
        "ENGINE_MISMATCH",
        "Stop the current Office before changing its runtime.",
      );
    if (live && current.execution !== "ready")
      fail("EXECUTION_LOCKED", "Stop the preview before starting with --live.");
    return current;
  }
  if (current.status !== "stopped")
    fail("UNKNOWN", "Resolve the preserved runtime state before restarting.");
  // The service loads ws: without the dependencies it would exit at startup.
  if (!checks.installed())
    fail(
      "NOT_INSTALLED",
      `Office 의존성이 설치되지 않았습니다. ./office${engine === "team" ? " --team" : ""} 로 설치하세요(업데이트 뒤 첫 실행은 npm 레지스트리 접속이 필요합니다).`,
    );
  ignoreMetadata(p);
  noSymlinks(p.dataDir);
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  const lock = join(p.dataDir, "start.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    return fail("BUSY", "Another start or recovery owns this Office.");
  }
  try {
    // Recheck after acquiring the lock; never replace another controller's state.
    if (readState(p))
      fail("BUSY", "Runtime state appeared while acquiring the start lock.");
    for (const name of ["home", "tmp"]) {
      noSymlinks(join(p.dataDir, name));
      mkdirSync(join(p.dataDir, name), { recursive: true, mode: 0o700 });
    }
    const log = join(p.dataDir, "office.log");
    noSymlinks(log);
    const fd = openSync(log, "a", 0o600);
    const token = randomBytes(32).toString("hex"),
      instance = randomBytes(16).toString("hex");
    const child = spawn(
      process.execPath,
      [join(packageRoot, SERVICE[engine])],
      {
        cwd: p.dataDir,
        detached: true,
        stdio: ["ignore", fd, fd, "ipc"],
        env: {
          // The native Office reads task diffs with git.
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          HOME: join(p.dataDir, "home"),
          TMPDIR: join(p.dataDir, "tmp"),
          LANG: "en_US.UTF-8",
        },
      },
    );
    closeSync(fd);
    let readyPort: number;
    try {
      readyPort = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Office startup timed out.")),
          STARTUP_MS[engine],
        );
        const finish = (error?: Error, value?: number) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value!);
        };
        child.once("error", (error) => finish(error));
        child.once("exit", () =>
          finish(
            new Error("Office exited before becoming ready. See office.log."),
          ),
        );
        child.once("message", (raw: unknown) => {
          const m = raw as { type?: string; port?: number; error?: string };
          if (m.type === "ready" && Number.isInteger(m.port) && m.port! > 0)
            finish(undefined, m.port);
          else finish(new Error(m.error || "Invalid Office startup result."));
        });
        child.send({
          project: p.project,
          dataDir: p.dataDir,
          port,
          token,
          instance,
          ...(live ? { live } : {}),
          // The team Office checks the person's own `gh` login: their PATH and
          // HOME, as live passes them for the runner CLIs.
          ...(engine === "team"
            ? { gh: { pathEnv: process.env.PATH ?? "", home: homedir() } }
            : {}),
        });
      });
      const state: Running = {
        version: 1,
        engine,
        project: p.project,
        pid: child.pid!,
        port: readyPort,
        token,
        instance,
      };
      writeFileSync(join(p.dataDir, "running.json"), JSON.stringify(state), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
    child.disconnect();
    child.unref();
    return {
      status: "running",
      execution: live ? "ready" : "locked",
      engine,
      ...(engine === "team" ? {} : { url: `http://127.0.0.1:${readyPort}` }),
      dataDir: p.dataDir,
    };
  } finally {
    rmdirSync(lock);
  }
}

/** The team Office of a data root: every registered repo, one engine each.
 * `NO_REPOS` until `team add` registered one. */
export async function startTeam(
  root: string,
  port: number,
  live?: LiveConfig,
  checks?: { installed: () => boolean },
) {
  const { repos } = readTeam(root);
  if (repos.length === 0)
    fail(
      "NO_REPOS",
      "No repo is registered in the team Office. Add one with `team add --project PATH` first.",
    );
  assertReposPresent(repos);
  return start(initTeam(root), port, live, "team", checks);
}
/** Never set up: neither its metadata nor any runtime state exists. */
function teamUnset(root: string): boolean {
  const p = teamProject(root);
  return (
    !existsSync(join(p.directory, "manifest.json")) &&
    !existsSync(join(p.dataDir, "running.json")) &&
    !existsSync(join(p.dataDir, "start.lock"))
  );
}
export async function statusTeam(root: string) {
  if (teamUnset(root)) return { status: "stopped", execution: "locked" };
  return status(teamProject(root));
}
export async function stopTeam(root: string) {
  if (teamUnset(root)) return { status: "stopped", execution: "locked" };
  return stop(teamProject(root));
}
export async function stop(p: Project) {
  readManifest(p);
  if (existsSync(join(p.dataDir, "start.lock")))
    fail(
      "UNKNOWN",
      "Office startup or recovery is still pending; state is preserved.",
    );
  const s = readState(p);
  if (!s) return { status: "stopped", execution: "locked" };
  try {
    await control(s, "status");
    await control(s, "stop");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "TASK_ACTIVE"
    )
      throw error;
    return fail(
      "UNKNOWN",
      "Runtime could not be authenticated. No process was signalled; state is preserved.",
    );
  }
  // Only clear the state we authenticated, never a concurrently replaced instance.
  // An Office an earlier version started may also have left an operator file.
  if (readState(p)?.instance === s.instance) {
    unlinkSync(join(p.dataDir, "running.json"));
    const operator = join(p.dataDir, `operator-${s.instance}.json`);
    noSymlinks(operator);
    if (existsSync(operator)) unlinkSync(operator);
  }
  return { status: "stopped", execution: "locked", dataPreserved: p.dataDir };
}

/** monitor --team: stage 2 has no team screen (stage 5 adds one). */
export const NO_TEAM_SCREEN = [
  "UNSUPPORTED",
  "The team Office has no screen yet. Use status --team to see its repos.",
] as const;

/** Open the lean Office's local session. */
export async function monitor(p: Project) {
  readManifest(p);
  const s = readState(p);
  if (!s) fail("NOT_RUNNING", "Start the Office before opening it.");
  await control(s, "status");
  if (s.engine === "team") return fail(...NO_TEAM_SCREEN);
  if (s.engine !== "lean")
    fail(
      "ENGINE_MISMATCH",
      "An Office an earlier version started is running. Stop it with stop, then start the Office again.",
    );
  return { url: `http://127.0.0.1:${s.port}/`, access: "local-session" };
}
