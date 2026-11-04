import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extraCaCerts, noSymlinks, packageRoot } from "../cli/project.ts";
import type { MacState } from "../hub/store.ts";
import { printable } from "../runtime/hub-link.ts";
import { STABLE_NODE, launchLogPath, stableNodePath } from "./launch-agent.ts";
import { rerunCommand } from "./mac.ts";
import type { MacClient, MacLinkFile } from "./mac.ts";
import { teamDir } from "./registry.ts";

/** How long claims stay held for a restart this Office asked for: past it, the restart did not happen (this Office
 * was never stopped), so claims resume and the next check tries again. */
export const RESTART_HOLD_MS = 600_000;
/** How long a pending set a restart already tried is left alone: its full sync may have failed only for a moment
 * (no Hub, a clone timeout), so past this it is tried once more, at the cost of one restart an hour for one that
 * keeps failing. */
export const RESTART_RETRY_MS = 3_600_000;

/** What the Mac's heartbeat tells the Hub: its state and, for `limited`, which runner and why. */
export type Presence = { state: MacState; detail: string | null };

type Pending = { add: string[]; remove: string[] };
type WatchClient = Pick<MacClient, "heartbeat" | "repos" | "link">;

export type MacWatchDeps = {
  /** The Mac link, or null when this Mac is not connected (or its file cannot be used). */
  linkOf: () => MacLinkFile | null;
  clientFor: (file: MacLinkFile) => WatchClient;
  presence: () => Presence;
  /** No record is open and no engine runs: the team Office can be stopped now. */
  idle: () => boolean;
  /** A links-only sync: repo links are fixed in place; what only a full sync can do (registry changes) comes back. */
  sync: (file: MacLinkFile, client: Pick<MacClient, "repos" | "link">) => Promise<Pending>;
  /** Starts the restart (`mac restart`) apart from this Office; it does not wait for it. */
  restart: () => void;
  log: (line: string) => void;
  now?: () => number;
  /** The data root: the pending set a restart was asked for is kept in `<root>/team/mac-restart.json`, so the
   * restarted Office knows it. Without it the set is kept in memory only. */
  root?: string;
};

export type MacWatch = {
  /** Sends this Mac's presence to the Hub (nothing when not connected or revoked). */
  beat(): Promise<void>;
  /** Asks the Hub which repos the member owns now and restarts the Office when the registry must change. */
  check(): Promise<void>;
  /** A restart was asked for less than RESTART_HOLD_MS ago: no Task is claimed. */
  holding(): boolean;
};

const RESTART_FILE = "mac-restart.json";
/** Where the pending set the last self-restart was for is kept. */
export const macRestartPath = (root: string): string => join(teamDir(root), RESTART_FILE);

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
/** One order whatever order the Hub and the registry gave: the same set is the same key. */
const sorted = (p: Pending): Pending => ({ add: [...new Set(p.add)].sort(), remove: [...new Set(p.remove)].sort() });
const keyOf = (p: Pending): string => JSON.stringify([p.add, p.remove]);

/** A pending set a restart was asked for, and when. */
type Remembered = { key: string; at: number };

/** The set remembered on disk; anything unreadable counts as nothing remembered (at worst, one more restart). */
function readRemembered(root: string): Remembered | null {
  try {
    const file = macRestartPath(root);
    noSymlinks(file);
    if (!existsSync(file)) return null;
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { version, add, remove, at } = value as Record<string, unknown>;
    return version === 1 && strings(add) && strings(remove) && typeof at === "number" && Number.isFinite(at)
      ? { key: keyOf(sorted({ add, remove })), at }
      : null;
  } catch {
    return null;
  }
}

/** Temporary file, then rename, 0600: the restarted Office never reads half a set. */
function writeRemembered(root: string, p: Pending, at: number): void {
  const dir = teamDir(root);
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = macRestartPath(root);
  noSymlinks(file);
  const tmp = join(dir, `${RESTART_FILE}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify({ version: 1, add: p.add, remove: p.remove, at }) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

const statusOf = (error: unknown): unknown => (typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined);
/** A failure as the Office log may print it: code and message made printable (a Hub message is the Hub's text). */
function printableError(error: unknown): Error {
  const { code, message } = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; message?: unknown };
  const text = printable(typeof message === "string" ? message : String(error));
  return Object.assign(new Error(text), typeof code === "string" ? { code: printable(code) } : {});
}
const reasonOf = (error: unknown): string => printable(error instanceof Error ? error.message : String(error)).slice(0, 160);

/**
 * The Mac side of a team Office: a heartbeat with this Mac's presence, and a check of the member's repos that
 * restarts the Office when the registry must change (it may only change while the Office is stopped).
 *
 * A 401 means the Hub revoked this Mac: one line, then no Mac call under that macId until the link file names
 * another. A restart is asked for only while nothing is open; until then one line says it waits. From the
 * restart on, claims are held (`holding`) for RESTART_HOLD_MS. The pending set a restart was asked for is
 * remembered with its time (0600, before the restart): the restarted Office that finds the same set again (a repo a
 * full sync could not add) says so once and does not restart for it until RESTART_RETRY_MS have passed; a different
 * set restarts, and an empty one forgets it.
 */
export function createMacWatch(d: MacWatchDeps): MacWatch {
  const now = d.now ?? Date.now;
  const log = (line: string) => {
    try {
      d.log(line);
    } catch {
      // nowhere left to say it
    }
  };
  /** The macId the Hub answered 401 for. */
  let revoked: string | null = null;
  /** When this Office asked for its restart, while it holds claims for it. */
  let heldAt: number | null = null;
  /** The pending set a restart was asked for, by this Office or the one before it. */
  let restartedFor: Remembered | null = d.root === undefined ? null : readRemembered(d.root);
  /** Lines said once until what they say changes. */
  let waitingSaid: string | null = null;
  let stuckSaid: string | null = null;
  let unsavedSaid: string | null = null;

  const holding = (): boolean => heldAt !== null && now() - heldAt < RESTART_HOLD_MS;
  function revoke(file: MacLinkFile): void {
    revoked = file.macId;
    log(
      `team: 허브에서 이 Mac 연결이 해제됐습니다 — 허브에 상태를 보내지 않고 담당 repo도 확인하지 않습니다. 다시 연결하려면 Mac 터미널에서 실행하세요: ${rerunCommand(file.hub)}`,
    );
  }
  function forget(): void {
    restartedFor = null;
    if (d.root === undefined) return;
    try {
      rmSync(macRestartPath(d.root), { force: true });
    } catch {
      // A set left on disk costs at most one restart not made; the next empty check tries again.
    }
  }
  const describe = (p: Pending): string =>
    [p.add.length ? `더할 repo ${p.add.join(", ")}` : "", p.remove.length ? `뺄 repo ${p.remove.join(", ")}` : ""]
      .filter(Boolean)
      .join("; ");
  const restartCommand = d.root === undefined ? "pazmo-office mac restart" : `pazmo-office mac restart --data-dir ${d.root}`;
  const reasonsAt = d.root === undefined ? "Office 기록" : launchLogPath(d.root);

  return {
    holding,

    async beat() {
      const file = d.linkOf();
      if (!file || file.macId === revoked) return;
      const { state, detail } = d.presence();
      try {
        await d.clientFor(file).heartbeat(state, detail);
      } catch (error) {
        if (statusOf(error) === 401) return revoke(file);
        // Anything else (no network, a Hub restarting) is the timer's to log; the next beat tries again.
        throw printableError(error);
      }
    },

    async check() {
      const file = d.linkOf();
      if (!file || file.macId === revoked || holding()) return;
      if (heldAt !== null) {
        // The hold ran out and this Office still runs: the restart never happened, so it is asked for again, and no
        // later Office may take the set for one its restart already tried.
        heldAt = null;
        forget();
        log(
          `team: 팀 Office가 ${RESTART_HOLD_MS / 60000}분 안에 다시 켜지지 않았습니다 — Task를 다시 가져가고, 다음 확인에서 다시 켭니다. 다시 켜기 기록: ${reasonsAt}`,
        );
      }
      let pending: Pending;
      try {
        pending = sorted(await d.sync(file, d.clientFor(file)));
      } catch (error) {
        if (statusOf(error) === 401) return revoke(file);
        throw printableError(error);
      }
      if (pending.add.length === 0 && pending.remove.length === 0) {
        waitingSaid = stuckSaid = unsavedSaid = null;
        if (restartedFor !== null) forget();
        return;
      }
      const key = keyOf(pending);
      const what = describe(pending);
      const age = restartedFor?.key === key ? now() - restartedFor.at : null;
      if (age !== null && age >= 0 && age < RESTART_RETRY_MS) {
        // The restart for this very set happened and its full sync could not do it: another one now would not either.
        if (stuckSaid !== key)
          log(
            `team: 담당 repo 변경을 맞추지 못했습니다: ${what} — 다시 켜도 그대로여서 ${RESTART_RETRY_MS / 60000}분 동안 다시 켜지 않습니다. 이유는 ${reasonsAt}의 맞추기 줄에 있습니다. 고친 뒤 실행하세요: ${restartCommand}`,
          );
        stuckSaid = key;
        return;
      }
      stuckSaid = null;
      if (!d.idle()) {
        if (waitingSaid !== key)
          log(`team: 담당 repo가 바뀌었습니다(${what}) — 팀 Office를 다시 켜야 맞출 수 있어 열린 Task와 실행이 끝나기를 기다립니다`);
        waitingSaid = key;
        return;
      }
      waitingSaid = null;
      const at = now();
      if (d.root !== undefined)
        try {
          writeRemembered(d.root, pending, at);
        } catch (error) {
          // Unremembered, a restart could repeat every check for a set its sync cannot do: none is made.
          if (unsavedSaid !== key)
            log(`team: 담당 repo가 바뀌었지만(${what}) ${macRestartPath(d.root)}을 쓰지 못해 다시 켜지 않습니다(${reasonOf(error)}) — 다음 확인에서 다시 합니다`);
          unsavedSaid = key;
          return;
        }
      unsavedSaid = null;
      restartedFor = { key, at };
      heldAt = at;
      log(`team: 담당 repo가 바뀌었습니다(${what}) — 새 Task를 가져가지 않고 팀 Office를 다시 켭니다`);
      try {
        d.restart();
      } catch (error) {
        // Nothing was started: claims resume and the next check asks again.
        heldAt = null;
        forget();
        log(`team: 팀 Office를 다시 켜지 못했습니다(${reasonOf(error)}) — 다음 확인에서 다시 합니다`);
      }
    },
  };
}

/** The node a restart runs with, as the LaunchAgent names it: this one (or Homebrew's version-independent path to
 * it) while it is there; once `brew upgrade` removed its versioned folder under this running Office, Homebrew's. */
export function restartNode(execPath: string = process.execPath, stable: string = STABLE_NODE): string {
  return existsSync(execPath) ? stableNodePath(execPath, stable) : stable;
}

/**
 * `mac restart --data-dir <root>` apart from this Office (its own process group, not waited for): it stops this
 * Office and starts it again as `up --team --no-open`. It runs on `restartNode()` with the person's PATH and HOME
 * (and ssh agent) and this process's extra CA file (an absolute path only), as the LaunchAgent's `up` does, and
 * writes to the LaunchAgent's log. No token is in its arguments or environment. `o` is for tests.
 */
export function spawnMacRestart(
  root: string,
  host: { pathEnv: string; home: string; sshAuthSock?: string },
  spawnFn: typeof spawn = spawn,
  o: { execPath?: string; stableNode?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const log = launchLogPath(root);
  noSymlinks(log);
  const node = restartNode(o.execPath, o.stableNode);
  const extraCa = extraCaCerts(o.env);
  const fd = openSync(log, "a", 0o600);
  try {
    const child = spawnFn(node, [join(packageRoot, "bin", "pazmo-office.mjs"), "mac", "restart", "--data-dir", root], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: {
        PATH: host.pathEnv,
        HOME: host.home,
        LANG: "en_US.UTF-8",
        ...(host.sshAuthSock ? { SSH_AUTH_SOCK: host.sshAuthSock } : {}),
        ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}),
      },
    });
    // A child that never started emits `error`: said in the log, never thrown into the Office (the hold runs out).
    child.once("error", (error: Error) => {
      try {
        appendFileSync(log, `팀 Office를 다시 켜는 명령을 시작하지 못했습니다(${reasonOf(error)})\n`);
      } catch {
        // nowhere left to say it
      }
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
}
