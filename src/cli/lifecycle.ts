import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  extraCaCerts,
  fail,
  ignoreMetadata,
  initTeam,
  noSymlinks,
  packageRoot,
  readManifest,
  teamProject,
} from "./project.ts";
import { readMacLink } from "../team/mac.ts";
import { assertNotInTeam, assertReposPresent, readTeam } from "../team/registry.ts";
import type { Project } from "./project.ts";
import type { LiveConfig } from "../runtime/live.ts";

/** The engines this version starts. */
const STARTED = ["lean", "team"] as const;
/** Engines an earlier version may have left running: still read from the
 * saved state so that Office can be shown and stopped, never started (D33).
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
  /** The boot session it started in (bootSession), where the machine has one. */
  boot?: string;
};
/** A service's own environment: Office's HOME and TMPDIR and a short PATH (the native Office reads task diffs with
 * git). The team service also gets the extra CA file of `env` (an absolute path only): its Mac heartbeat and repo
 * check call a Hub that may sit behind it. */
export function serviceEnv(engine: Engine, dataDir: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const extraCa = engine === "team" ? extraCaCerts(env) : undefined;
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(dataDir, "home"),
    TMPDIR: join(dataDir, "tmp"),
    LANG: "en_US.UTF-8",
    ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}),
  };
}
/** The last words of an UNKNOWN: the file whose removal lets Office start again, for a person who knows no Office
 * is running. */
const removeHint = (file: string) =>
  `If no Office is running or starting on this Mac, remove ${file} and try again.`;
function readState(p: Project): Running | undefined {
  const path = join(p.dataDir, "running.json");
  noSymlinks(path);
  if (!existsSync(path)) return;
  let s: Running;
  try {
    s = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail("UNKNOWN", `Runtime state cannot be read. ${removeHint(path)}`);
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
    !/^[a-f0-9]{32}$/.test(s.instance) ||
    (s.boot !== undefined && (typeof s.boot !== "string" || !BOOT_ID.test(s.boot)))
  )
    fail("UNKNOWN", `Runtime state is not valid. ${removeHint(path)}`);
  return s;
}
/** Removes `<dataDir>/running.json` if it still names `instance`, never a concurrently replaced instance's, and that
 * instance's operator file (an Office an earlier version started may have left one). A state already gone, or one
 * that cannot be parsed, is left as it is. `stop`, stale-state recovery and a service shutting down use it. */
export function removeSavedState(dataDir: string, instance: string): void {
  const file = join(dataDir, "running.json");
  noSymlinks(file);
  let saved: { instance?: unknown } | null;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (saved?.instance !== instance) return;
  const operator = join(dataDir, `operator-${instance}.json`);
  noSymlinks(operator);
  rmSync(file, { force: true });
  rmSync(operator, { force: true });
}
const BOOT_ID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
let boot: { id: string | undefined } | undefined;
/** This boot session's id: macOS `kern.bootsessionuuid`, Linux's boot_id; undefined elsewhere or when it cannot be
 * read. Read once per process: no process outlives its boot. */
export function bootSession(): string | undefined {
  boot ??= { id: readBootSession() };
  return boot.id;
}
function readBootSession(): string | undefined {
  try {
    const raw =
      process.platform === "darwin"
        ? execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], {
            encoding: "utf8",
            timeout: 2000,
            stdio: ["ignore", "pipe", "ignore"],
          })
        : process.platform === "linux"
          ? readFileSync("/proc/sys/kernel/random/boot_id", "utf8")
          : "";
    const id = raw.trim();
    return BOOT_ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
/** Whether the process a saved state or start lock names is gone. One recorded in another boot is, whatever its pid
 * names now: pids start again from 1 at every boot, so after a crash or power loss the old pid often belongs to a
 * live login process. Otherwise only ESRCH is gone (signal 0 only checks): a process of another user (EPERM) is
 * alive, and so is an unrelated one of this boot that reused the pid. A record without a well-formed boot (an earlier
 * version's), or a machine without one, has the pid rule only. `teamRunning` judges by this rule too. */
export function processGone(pid: number, recordedBoot?: string): boolean {
  const current = recordedBoot && BOOT_ID.test(recordedBoot) ? bootSession() : undefined;
  if (current && recordedBoot !== current) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
/** The start lock: a directory, made atomically by a start or a stale-state recovery, whose `pid` file holds its
 * maker's pid and the boot session it was made in (lockRecord). */
const startLock = (p: Project) => join(p.dataDir, "start.lock");
const lockRecord = () => {
  const id = bootSession();
  return id ? `${process.pid}\n${id}` : String(process.pid);
};
/** How long a start lock may have no readable pid: its maker writes it right after making the directory. An older
 * one's maker died first, or an earlier version made it. Judged by the directory's mtime: this only bounds a short
 * window, so a clock change merely moves it. */
const UNCLAIMED_LOCK_MS = 60_000;
/** Whether a start lock is stale: its maker is gone (processGone), or it has had no readable pid for
 * UNCLAIMED_LOCK_MS. A lock that is gone is stale. The lifecycle and `teamRunning` judge a lock by this one rule. */
export function startLockStale(lock: string): boolean {
  let text = "";
  try {
    text = readFileSync(join(lock, "pid"), "utf8");
  } catch {
    // No pid yet: judged by its age below.
  }
  const [pidText = "", recordedBoot] = text.split("\n");
  const pid = Number(pidText);
  if (pidText.trim() && Number.isInteger(pid) && pid > 0) return processGone(pid, recordedBoot?.trim() || undefined);
  try {
    return Date.now() - statSync(lock).mtimeMs > UNCLAIMED_LOCK_MS;
  } catch {
    return true;
  }
}
/** Removes a stale start lock so that only one remover acts on it. It is first renamed to a name of this remover's
 * own, judged again there, and put back if it is live after all: a new lock that replaced the stale one between
 * another remover's judgement and this rename. If a third lock took the place meanwhile, the moved one is dropped
 * (its maker then releases nothing, see takeStartLock). True when no lock is left. */
export function removeStaleStartLock(lock: string): boolean {
  const aside = `${lock}.${randomBytes(8).toString("hex")}`;
  try {
    renameSync(lock, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  if (startLockStale(aside)) {
    rmSync(aside, { recursive: true, force: true });
    return true;
  }
  try {
    renameSync(aside, lock);
  } catch {
    rmSync(aside, { recursive: true, force: true });
  }
  return false;
}
/** Whether no live start lock exists; a stale one is removed. */
function startLockFree(p: Project): boolean {
  const lock = startLock(p);
  noSymlinks(lock);
  if (!existsSync(lock)) return true;
  return startLockStale(lock) && removeStaleStartLock(lock);
}
/** Takes the start lock, taking over a stale one; undefined while another process holds it. The result releases it,
 * only while its pid file still holds this process's record: never a lock another process took over meanwhile. */
function takeStartLock(p: Project): (() => void) | undefined {
  const lock = startLock(p);
  noSymlinks(lock);
  for (let attempt = 0; ; attempt++)
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch {
      if (attempt > 0 || !startLockFree(p)) return;
    }
  const pidFile = join(lock, "pid");
  const record = lockRecord();
  try {
    writeFileSync(pidFile, record, { flag: "wx", mode: 0o600 });
  } catch (error) {
    // Only the empty directory made above: a lock put back meanwhile has its maker's pid file.
    try {
      rmdirSync(lock);
    } catch {
      // Not empty: not this one's.
    }
    throw error;
  }
  return () => {
    let text: string | undefined;
    try {
      text = readFileSync(pidFile, "utf8");
    } catch {
      // Gone, or moved aside by a remover: nothing of this one's to remove.
    }
    if (text === record) rmSync(lock, { recursive: true, force: true });
  };
}
/** A saved state whose controller did not answer and whose process is gone (processGone: a logout, reboot or crash
 * ended it without `stop`) is stale: cleared under the start lock if the file still names that instance. True when no state
 * is left. False, and nothing changes, while its process may be alive, another process holds the lock, or another
 * instance replaced it. The pid is never signalled. */
function clearDeadState(p: Project, s: Running): boolean {
  if (!processGone(s.pid, s.boot)) return false;
  const release = takeStartLock(p);
  if (!release) return false;
  try {
    const current = readState(p);
    if (current?.instance === s.instance) removeSavedState(p.dataDir, s.instance);
    return !current || current.instance === s.instance;
  } finally {
    release();
  }
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
/** How long `start` waits for the service's ready message. Lean and team
 * services start in under 3 s even under load (measured for lean). A live lean
 * Office reports ready only after its first runner discovery, which waits up to
 * 17 s for the claude it asked to exit (D31), so lean waits 30 s. A live team
 * Office does the same discovery once for all its repo engines (it shares one),
 * so it waits as long. A claude that also takes its whole 15 s to answer makes
 * that discovery alone up to 32 s; such a start still times out. The claude, in
 * its own process group, then gets the end of its input and is never
 * SIGKILLed, so it cannot strand its login lock. A crash or an error reply ends
 * the wait at once, so only a service that neither replies nor exits waits this
 * long. */
export const STARTUP_MS: Record<Engine, number> = {
  lean: 30000,
  team: 30000,
};
/** What `status` shows of a running team Office: its TeamStatus (its execution is the lifecycle's own field). */
const TEAM_FIELDS = ["repos", "paused", "dailyCap", "today", "claim", "blockedBy", "busy"] as const;
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
    return startLockFree(p)
      ? { status: "stopped", execution: "locked" }
      : {
          status: "unknown",
          execution: "locked",
          reason: `An Office start or recovery is under way. ${removeHint(startLock(p))}`,
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
    if (clearDeadState(p, s)) return { status: "stopped", execution: "locked" };
    return {
      status: "unknown",
      execution: "locked",
      reason: `The saved Office did not answer and its process may still be running; no process was signalled. ${removeHint(join(p.dataDir, "running.json"))}`,
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
  if (current.status !== "stopped") {
    const running = join(p.dataDir, "running.json");
    fail(
      "UNKNOWN",
      `An Office may still be running or starting; nothing was started. ${removeHint(existsSync(running) ? running : startLock(p))}`,
    );
  }
  // The service loads ws: without the dependencies it would exit at startup.
  if (!checks.installed())
    fail(
      "NOT_INSTALLED",
      `Office 의존성이 설치되지 않았습니다. ./office${engine === "team" ? " --team" : ""} 로 설치하세요(Apple Silicon 밖에서는 npm ci --omit=dev). 업데이트 뒤 첫 실행은 npm 레지스트리 접속이 필요합니다.`,
    );
  ignoreMetadata(p);
  noSymlinks(p.dataDir);
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  const release = takeStartLock(p);
  if (!release) return fail("BUSY", "Another start or recovery owns this Office.");
  let spawned: ChildProcess | undefined;
  /** A signal while the start waits (launchd's bootout sends SIGTERM, a terminal's Ctrl-C SIGINT) would end the
   * process without the `finally` below: stop the service it spawned, as a failed start does, release the lock and
   * leave non-zero. Nothing was recorded yet: the state is written after the ready, without waiting. */
  const interrupted = (signal: NodeJS.Signals) => {
    spawned?.kill("SIGTERM");
    release();
    console.error(
      JSON.stringify({ code: "INTERRUPTED", error: `Office start was interrupted (${signal}); the service it started was stopped.` }),
    );
    process.exit(1);
  };
  process.on("SIGTERM", interrupted);
  process.on("SIGINT", interrupted);
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
        env: serviceEnv(engine, p.dataDir),
      },
    );
    spawned = child;
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
          // The team Office runs the person's own gh and git (their login,
          // credential helper and ssh agent): their PATH and HOME, as live
          // passes them for the runner CLIs.
          ...(engine === "team"
            ? {
                host: {
                  pathEnv: process.env.PATH ?? "",
                  home: homedir(),
                  ...(process.env.SSH_AUTH_SOCK ? { sshAuthSock: process.env.SSH_AUTH_SOCK } : {}),
                },
              }
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
        ...(bootSession() ? { boot: bootSession() } : {}),
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
    process.off("SIGTERM", interrupted);
    process.off("SIGINT", interrupted);
    release();
  }
}

/** The team Office of a data root: every registered repo, one engine each.
 * `NO_REPOS` until `team add` registered one, unless this Mac is connected to
 * a Hub (`mac connect`): then it runs with none. */
export async function startTeam(
  root: string,
  port: number,
  live?: LiveConfig,
  checks?: { installed: () => boolean },
) {
  const { repos } = readTeam(root);
  if (repos.length === 0 && !readMacLink(root))
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
  if (!startLockFree(p))
    fail(
      "UNKNOWN",
      `Office startup or recovery is still pending; state is preserved. ${removeHint(startLock(p))}`,
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
    if (clearDeadState(p, s)) return { status: "stopped", execution: "locked" };
    return fail(
      "UNKNOWN",
      `Runtime could not be authenticated. No process was signalled; state is preserved. ${removeHint(join(p.dataDir, "running.json"))}`,
    );
  }
  // Only clear the state we authenticated; the stopping Office may have removed it already.
  removeSavedState(p.dataDir, s.instance);
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
