import { spawn } from "node:child_process";
import type { StdioOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { dataRoot, fail, locate, OfficeError, packageRoot } from "./project.ts";
import { machinePreflight, up } from "./launcher.ts";
import { statusTeam as lifecycleStatusTeam, stopTeam as lifecycleStopTeam } from "./lifecycle.ts";
import type { MacRepo } from "../hub/store.ts";
import { printable, readLinkConfig, removeLinkConfig } from "../runtime/hub-link.ts";
import type { HubLinkConfig } from "../runtime/hub-link.ts";
import { runCommand } from "../runners/command.ts";
import type { GitEnv } from "../team/branch.ts";
import type { GhResult } from "../team/gh.ts";
import {
  bootoutCommand,
  installLaunchAgent,
  launchAgentState,
  launchLogPath,
  removeLaunchAgent,
  stableNodePath,
} from "../team/launch-agent.ts";
import type { LaunchRun } from "../team/launch-agent.ts";
import {
  defaultMacName,
  hubOrigin,
  macCall,
  macClient,
  pairMac,
  readMacLink,
  removeMacLink,
  rerunCommand,
  writeMacLink,
} from "../team/mac.ts";
import type { MacCall, MacLinkFile } from "../team/mac.ts";
import { reposDir, SYNC_BUSY, syncMacRepos } from "../team/mac-sync.ts";
import type { MacRepoResult } from "../team/mac-sync.ts";
import { macRestartPath } from "../team/mac-watch.ts";
import { readTeam, teamRunning as registryTeamRunning } from "../team/registry.ts";
import type { TeamRepo } from "../team/registry.ts";

export const MAC_ACTIONS: readonly string[] = ["connect", "status", "disconnect", "restart"];

export type MacCliDeps = {
  call?: MacCall;
  open?: (url: string) => Promise<void>;
  launch?: LaunchRun;
  gh?: (host: string) => Promise<GhResult>;
  ghLogin?: ((host: string) => Promise<void>) | null;
  setupGit?: (host: string) => Promise<boolean>;
  git?: GitEnv;
  home?: string;
  uid?: number;
  node?: string;
  say?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  teamRunning?: (root: string) => boolean;
  stopTeam?: (root: string) => Promise<unknown>;
  upTeam?: (root: string) => Promise<unknown>;
  statusTeam?: (root: string) => Promise<{ status: string }>;
  /** `mac restart`'s check that `up` could start the Office; default `machinePreflight()`. */
  preflight?: () => Promise<unknown>;
};

type HubState = "ok" | "revoked" | "unreachable";
type StatusRepo = { name: string; project: string | null; registered: boolean; linked: boolean };

const OPEN_TIMEOUT_MS = 30000;
const OPEN_MAX_BYTES = 64 * 1024;
// A path launchd could not be given: the LaunchAgent refuses it, so it is left out instead.
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Failures pairMac already words for a person, with the rerun command. */
const WORDED = new Set(["HUB_URL_INVALID", "HUB_TOO_OLD", "MAC_DENIED", "MAC_CODE_EXPIRED"]);
/** What readMacLink throws for a file that is there but cannot be used. */
const LINK_FILE_PROBLEMS = new Set(["MAC_LINK_PERMISSIONS", "MAC_LINK_INVALID"]);

const again = (hub: string): string => `다시 하려면 Mac 터미널에서 실행하세요: ${rerunCommand(hub)}`;
/** A problem line that names the command to run again, once. */
const withRerun = (line: string, hub: string): string => (line.includes(rerunCommand(hub)) ? line : `${line} — ${again(hub)}`);

const fields = (error: unknown) => {
  const e = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; status?: unknown; message?: unknown };
  return {
    code: typeof e.code === "string" ? e.code : undefined,
    status: typeof e.status === "number" ? e.status : undefined,
    message: typeof e.message === "string" ? e.message : "",
  };
};
const linkFileProblem = (error: unknown): error is OfficeError =>
  error instanceof OfficeError && LINK_FILE_PROBLEMS.has(error.code);

/**
 * A failure to reach or use the Hub as one plain line with the command to run again. Nothing the Hub sent is quoted
 * except its own refusal message (made printable); a network error is named only by its code. pairMac's own refusals
 * (denied, expired, too old, a bad address) already say this and pass through.
 */
export function hubFailure(error: unknown, hub: string): OfficeError {
  if (error instanceof OfficeError && WORDED.has(error.code)) return error;
  const { code, status, message } = fields(error);
  const page = /^HUB_BAD_RESPONSE_(\d{3})$/.exec(message);
  const httpStatus = status ?? (page ? Number(page[1]) : undefined);
  if (code === "HUB_TLS_UNTRUSTED")
    return new OfficeError(
      "HUB_TLS_UNTRUSTED",
      `허브(${hub})의 인증서를 이 Mac이 믿지 못했습니다. 허브 주소가 맞는지, 회사 인증서가 이 Mac에 설치돼 있는지 확인하세요. ${again(hub)}`,
    );
  if (httpStatus !== undefined && httpStatus >= 500)
    return new OfficeError("HUB_NOT_READY", `허브(${hub})가 아직 준비되지 않았습니다(${httpStatus}). 잠시 뒤 ${again(hub)}`);
  if (status !== undefined) {
    const said = printable(message).trim();
    return new OfficeError(code ? printable(code) : `HUB_${status}`, `허브가 거절했습니다${said ? `: ${said}` : ""} — ${again(hub)}`);
  }
  if (page || code === "HUB_BAD_RESPONSE")
    return new OfficeError(
      "HUB_BAD_RESPONSE",
      `허브(${hub})의 답을 이해하지 못했습니다. 허브 주소가 맞는지 확인하고, 계속되면 허브 관리자에게 알리세요. ${again(hub)}`,
    );
  if (error instanceof OfficeError) return error;
  const why = code ?? (/^HUB_[A-Z_]+$/.test(message) ? message : undefined);
  return new OfficeError(
    "HUB_UNREACHABLE",
    `허브(${hub})에 닿지 않습니다${why ? `(${printable(why)})` : ""}. 네트워크와 VPN을 확인하세요. ${again(hub)}`,
  );
}

type Spawn = (
  command: string,
  args: string[],
  options: { stdio: StdioOptions },
) => { once(event: "exit" | "error", listener: (...args: any[]) => void): unknown };

/**
 * `gh auth login` for a Git host, only when a person is at the terminal (stdin is a TTY): it gets the terminal, and
 * the sync asks gh again once it ends. gh's own stdout goes to stderr, so stdout keeps only the JSON result. Null
 * without a terminal (the LaunchAgent, a running Office), so nothing waits on a login nobody can answer.
 */
export function ttyGhLogin(
  stdin: { isTTY?: boolean } = process.stdin,
  spawnFn: Spawn = spawn,
): ((host: string) => Promise<void>) | null {
  if (!stdin.isTTY) return null;
  return (host) =>
    new Promise<void>((resolve, reject) => {
      const child = spawnFn("gh", ["auth", "login", "--hostname", host, "--web", "--git-protocol", "https"], {
        stdio: ["inherit", 2, "inherit"],
      });
      child.once("error", reject);
      child.once("exit", () => resolve());
    });
}

/** The approve page in the person's browser; a failed open only makes pairMac say to open it by hand. */
async function openInBrowser(url: string): Promise<void> {
  const result = await runCommand("/usr/bin/open", [url], {
    timeoutMs: OPEN_TIMEOUT_MS,
    maxBytes: OPEN_MAX_BYTES,
    env: { PATH: "/usr/bin:/bin", HOME: homedir(), LANG: "C" },
  });
  if (result.exitCode !== 0) throw new Error("open failed");
}

const hostGit = (): GitEnv => ({
  home: homedir(),
  pathEnv: process.env.PATH ?? "",
  ...(process.env.SSH_AUTH_SOCK ? { sshAuthSock: process.env.SSH_AUTH_SOCK } : {}),
});

/** `NODE_EXTRA_CA_CERTS` of this run, for the LaunchAgent: only an absolute path launchd can be given. */
function extraCaOf(): string | undefined {
  const value = process.env.NODE_EXTRA_CA_CERTS;
  return value && isAbsolute(value) && !CONTROL.test(value) ? value : undefined;
}

type Env = {
  root: string;
  say: (line: string) => void;
  call: MacCall;
  launch: LaunchRun | undefined;
  home: string;
  uid: number;
};
function envOf(root: string, d: MacCliDeps): Env {
  const sink = d.say ?? ((line: string) => console.error(line));
  return {
    root,
    // A line that cannot be said never stops the command.
    say: (line) => {
      try {
        sink(line);
      } catch {
        // nowhere left to say it
      }
    },
    call: d.call ?? macCall,
    launch: d.launch,
    home: d.home ?? homedir(),
    uid: d.uid ?? process.getuid?.() ?? -1,
  };
}

/** The link file of a registered repo, or null when it has none or it cannot be read. */
function linkOf(entry: TeamRepo, root: string): { dataDir: string; cfg: HubLinkConfig | null } | null {
  try {
    const { dataDir } = locate(entry.project, root);
    return { dataDir, cfg: readLinkConfig(dataDir) };
  } catch {
    return null;
  }
}

/** Whether `cfg` is a link this Mac can use: the person's own (no macId) always; one this Mac minted unless the Hub
 * revoked it or says it is not live (when the Hub answered). */
function usable(cfg: HubLinkConfig | null, macId: string | null, hub: HubState | null, repo?: MacRepo): boolean {
  if (!cfg) return false;
  if (cfg.macId === undefined) return true;
  if (macId === null || cfg.macId !== macId || hub === "revoked") return false;
  if (hub === "ok") return repo !== undefined && repo.linked && cfg.repoId === repo.repoId;
  return true;
}

function nameOf(entry: TeamRepo, cfg: HubLinkConfig | null): string {
  const name = cfg?.repoName;
  return printable(typeof name === "string" && name ? name : basename(entry.project));
}

/** The existing link when it is for this Hub and the Hub still answers it; null means pair. Only a 401 (the Hub ended
 * this Mac) pairs again: pairing revokes this Mac and every repo link it minted, which would cut a running Office's
 * Story link. Any other failure (a 5xx, a router page, a timeout) keeps the file and is the Hub failure, with the
 * command to run again. */
async function reusable(e: Env, hub: string): Promise<MacLinkFile | null> {
  let file: MacLinkFile | null;
  try {
    file = readMacLink(e.root);
  } catch (error) {
    if (!linkFileProblem(error)) throw error;
    e.say("Mac 연결 파일을 쓸 수 없어 새로 연결합니다");
    return null;
  }
  if (!file) return null;
  if (file.hub !== hub) {
    e.say(`이 Mac은 다른 허브(${file.hub})에 연결돼 있었습니다 — ${hub}에 새로 연결합니다`);
    return null;
  }
  try {
    await macClient(file, e.call).repos();
    return file;
  } catch (error) {
    if (fields(error).status !== 401) throw hubFailure(error, hub);
    e.say("허브에서 이 Mac 연결이 해제됐습니다 — 새로 연결합니다");
    return null;
  }
}

/**
 * Pairs this Mac with `hub` (or keeps a link the Hub still answers), brings the clones and the registry in line
 * while the team Office is stopped, and loads the LaunchAgent that starts the team Office at login (and once now).
 * It does not wait for the Office: the result says where its log is and where to look on the Hub.
 */
async function connect(e: Env, options: { hub?: string; name?: string }, d: MacCliDeps) {
  const hub =
    hubOrigin(options.hub) ??
    fail("HUB_URL_INVALID", "허브 주소는 https://호스트 형식이어야 합니다. 경로, 쿼리, 사용자 정보는 넣지 마세요.");
  e.say("[1/3] 허브와 이 Mac 짝짓기");
  let file = await reusable(e, hub);
  if (file) e.say(`이미 이 허브에 연결된 Mac입니다(${file.name}, ${file.memberName}) — 다시 짝짓지 않습니다`);
  else {
    // The Hub keeps the name trimmed; so does this Mac.
    const name = options.name?.trim() || defaultMacName();
    let paired;
    try {
      paired = await pairMac({ hub, name, open: d.open ?? openInBrowser, say: e.say, call: e.call, sleep: d.sleep, now: d.now });
    } catch (error) {
      throw hubFailure(error, hub);
    }
    file = {
      version: 1,
      hub,
      macId: paired.macId,
      macToken: paired.macToken,
      memberId: paired.member.id,
      memberName: paired.member.name,
      name,
    };
    writeMacLink(e.root, file);
    file = readMacLink(e.root)!;
    e.say(`허브에서 이 Mac을 허용했습니다(${file.name}, ${file.memberName})`);
  }

  e.say("[2/3] 담당 repo 맞추기");
  const log = launchLogPath(e.root);
  let repos: MacRepoResult[] = [];
  const problems: string[] = [];
  let note: string;
  if ((d.teamRunning ?? registryTeamRunning)(e.root)) {
    // The registry is the running Office's: it brings its repos in line within 5 minutes.
    e.say("팀 Office가 켜져 있어 담당 repo는 켜진 Office가 5분 안에 맞춥니다");
    note = `팀 Office가 이미 켜져 있어 담당 repo는 켜진 Office가 5분 안에 맞춥니다. 허브의 '내 Mac'에서 확인하세요. 기록: ${log}`;
  } else {
    note = `Office를 켭니다. 처음에는 VM과 이미지를 준비하느라 몇 분 걸립니다. 몇 분 뒤 허브의 '내 Mac'에서 확인하세요. 기록: ${log}`;
    try {
      const synced = await syncMacRepos(
        {
          root: e.root,
          hub,
          macId: file.macId,
          member: { id: file.memberId, name: file.memberName },
          client: macClient(file, e.call),
          git: d.git ?? hostGit(),
          gh: d.gh,
          ghLogin: d.ghLogin === undefined ? ttyGhLogin() : d.ghLogin,
          setupGit: d.setupGit,
          say: e.say,
        },
        "full",
      );
      repos = synced.repos;
      // Another full sync (the agent's own `up`) is doing it: no rerun needed, the Office starts with its result.
      if (synced.skipped) problems.push(SYNC_BUSY);
    } catch (error) {
      // The pairing stands; the LaunchAgent's own start syncs again.
      const reason = error instanceof OfficeError ? printable(error.message) : hubFailure(error, hub).message;
      const line = withRerun(`담당 repo를 맞추지 못했습니다 — ${reason}`, hub);
      e.say(line);
      problems.push(line);
    }
    for (const repo of repos) if (repo.problem) problems.push(withRerun(repo.problem, hub));
  }

  e.say("[3/3] 로그인할 때 Office 자동 실행 등록");
  const extraCa = extraCaOf();
  try {
    const agent = await installLaunchAgent({
      home: e.home,
      uid: e.uid,
      node: d.node ?? stableNodePath(process.execPath),
      cli: join(packageRoot, "bin", "pazmo-office.mjs"),
      root: e.root,
      ...(extraCa ? { extraCa } : {}),
      run: e.launch,
      sleep: d.sleep,
    });
    // Left loaded: reloading it would stop an Office start it may still be running.
    if (agent === "kept") e.say("로그인할 때 Office 자동 실행은 이미 등록돼 있습니다 — 다시 등록하지 않습니다");
  } catch (error) {
    if (!(error instanceof OfficeError) || error.code !== "LAUNCHD_FAILED") throw error;
    fail(
      "LAUNCHD_FAILED",
      `로그인할 때 Office를 켜는 자동 실행을 등록하지 못했습니다(${printable(error.message)}). 파일은 남아 있어 다음 로그인 때 다시 시도됩니다. ${again(hub)}`,
    );
  }
  e.say(note);
  return { connected: true, member: file.memberName, mac: file.name, repos, problems, launchAgent: "loaded", log, note };
}

/** What this Mac is connected to and what it runs. A link file that cannot be used is reported, not thrown. */
async function macStatus(e: Env, d: MacCliDeps) {
  let file: MacLinkFile | null = null;
  let problem: string | undefined;
  try {
    file = readMacLink(e.root);
  } catch (error) {
    if (!linkFileProblem(error)) throw error;
    problem = error.message;
  }
  const launchAgent = await launchAgentState({ home: e.home, uid: e.uid, run: e.launch });
  const team = (await (d.statusTeam ?? lifecycleStatusTeam)(e.root)).status;
  const registered = readTeam(e.root).repos;
  const local = (entry: TeamRepo, macId: string | null, hub: HubState | null): StatusRepo => {
    const found = linkOf(entry, e.root);
    return {
      name: nameOf(entry, found?.cfg ?? null),
      project: entry.project,
      registered: true,
      linked: usable(found?.cfg ?? null, macId, hub),
    };
  };
  if (!file)
    return {
      connected: false,
      ...(problem ? { problem } : {}),
      repos: registered.map((entry) => local(entry, null, null)),
      launchAgent,
      team,
    };

  let hubState: HubState = "ok";
  let owned: MacRepo[] = [];
  try {
    owned = await macClient(file, e.call).repos();
  } catch (error) {
    hubState = fields(error).status === 401 ? "revoked" : "unreachable";
    problem =
      hubState === "revoked"
        ? `허브에서 이 Mac 연결이 해제됐습니다. ${again(file.hub)}`
        : `허브(${file.hub})에 닿지 않아 담당 repo와 연결을 확인하지 못했습니다(${printable(fields(error).code ?? "HUB_UNREACHABLE")}). 네트워크와 VPN을 확인하세요`;
  }
  const repos: StatusRepo[] =
    hubState === "ok"
      ? [
          ...owned.map((repo): StatusRepo => {
            const entry = registered.find((r) => r.remote === repo.remote);
            const found = entry ? linkOf(entry, e.root) : null;
            return {
              name: printable(repo.name),
              project: entry?.project ?? null,
              registered: entry !== undefined,
              linked: usable(found?.cfg ?? null, file.macId, "ok", repo),
            };
          }),
          // Registered repos the member does not own (or no longer owns).
          ...registered.filter((entry) => !owned.some((repo) => repo.remote === entry.remote)).map((entry) => local(entry, file.macId, "ok")),
        ]
      : registered.map((entry) => local(entry, file.macId, hubState));
  return {
    connected: true,
    hub: file.hub,
    member: file.memberName,
    mac: file.name,
    hubState,
    repos,
    launchAgent,
    team,
    ...(problem ? { problem } : {}),
  };
}

/**
 * Stops the team Office (a running Task refuses it and nothing changes), takes the LaunchAgent down, revokes this
 * Mac on the Hub, and deletes the link files this Mac wrote and mac-link.json. The registry and the clones stay.
 * A Hub that cannot be reached is no reason to keep the Mac connected here: the person revokes it on /mac.
 */
async function disconnect(e: Env, d: MacCliDeps) {
  let file: MacLinkFile | null = null;
  let unreadable = false;
  try {
    file = readMacLink(e.root);
  } catch (error) {
    if (!linkFileProblem(error)) throw error;
    unreadable = true;
  }
  // The restart-loop guard of this Mac's Office: left, it would hold back a reconnect's restart for up to an hour.
  const dropGuard = () => rmSync(macRestartPath(e.root), { force: true });
  /** Takes the agent down; when launchd keeps it (a bootout it did not take), says so with what to do, and returns
   * that line: until logout the job would run `up --team` every half hour. */
  const dropAgent = async (): Promise<string | null> => {
    if ((await removeLaunchAgent({ home: e.home, uid: e.uid, run: e.launch, sleep: d.sleep })) === "removed") return null;
    const line = `로그인할 때 Office 자동 실행 파일은 지웠지만 launchd가 아직 붙들고 있어, 로그아웃할 때까지 30분마다 Office를 켤 수 있습니다 — 로그아웃했다가 다시 로그인하거나 터미널에서 실행하세요: ${bootoutCommand(e.uid)}`;
    e.say(line);
    return line;
  };
  if (!file && !unreadable) {
    // Not connected: only an agent and a guard an earlier run may have left go.
    const agentLeft = await dropAgent();
    dropGuard();
    return { disconnected: true, hubRevoked: false, ...(agentLeft ? { launchAgent: "still-loaded", note: agentLeft } : {}) };
  }

  e.say("팀 Office를 멈춥니다");
  await (d.stopTeam ?? lifecycleStopTeam)(e.root);
  e.say("로그인할 때 Office 자동 실행을 지웁니다");
  const agentLeft = await dropAgent();
  let hubRevoked = false;
  if (file)
    try {
      await macClient(file, e.call).revoke();
      hubRevoked = true;
    } catch (error) {
      // A 401: the Hub already ended this Mac (revoked on the web).
      hubRevoked = fields(error).status === 401;
    }
  if (hubRevoked) e.say("허브에서 이 Mac 연결을 해제했습니다");

  // The link files this Mac wrote; with an unreadable mac-link.json, every one a Mac wrote. The person's own stay.
  let entries: TeamRepo[] = [];
  try {
    entries = readTeam(e.root).repos;
  } catch (error) {
    e.say(`팀 Office 등록을 읽지 못해 repo 연결 파일은 그대로 두었습니다 — ${printable(error instanceof Error ? error.message : String(error))}`);
  }
  for (const entry of entries) {
    const found = linkOf(entry, e.root);
    const macId = found?.cfg?.macId;
    if (found && typeof macId === "string" && (file ? macId === file.macId : true))
      try {
        removeLinkConfig(found.dataDir);
      } catch {
        // A file that cannot be removed is refused by the Hub once this Mac is revoked.
      }
  }
  removeMacLink(e.root);
  dropGuard();

  const result: { disconnected: true; hubRevoked: boolean; clonesKept: string; launchAgent?: "still-loaded"; note?: string } = {
    disconnected: true,
    hubRevoked,
    clonesKept: reposDir(e.root),
  };
  const notes: string[] = [];
  if (!hubRevoked) {
    const page = file ? `${file.hub}/mac` : "허브의 /mac";
    const removed = agentLeft ? "이 Mac의 연결 파일은 지웠습니다." : "이 Mac의 연결 파일과 자동 실행은 지웠습니다.";
    const line = file
      ? `허브에 닿지 않아 허브에서는 이 Mac을 해제하지 못했습니다. ${removed} ${page} 화면에서 이 Mac을 해제하세요.`
      : `Mac 연결 파일을 읽을 수 없어 허브에서는 이 Mac을 해제하지 못했습니다. ${removed} ${page} 화면에서 이 Mac을 해제하세요.`;
    e.say(line);
    notes.push(line);
  }
  if (agentLeft) {
    result.launchAgent = "still-loaded";
    notes.push(agentLeft);
  }
  if (notes.length) result.note = notes.join(" ");
  return result;
}

/** `mac restart`: what the team Office runs to restart itself for a changed repo set. First the checks of `up` that
 * need no VM (colima and docker installed, a logged-in runner): when they fail, the running Office is left on (it
 * waits, limited, until the person logs in) rather than stopped for a start that cannot happen. Then stop (a running
 * Task refuses it, and nothing starts), then the same start as `up --team --no-open`, with no prompt. */
async function restart(e: Env, d: MacCliDeps) {
  try {
    await (d.preflight ?? (() => machinePreflight()))();
  } catch (error) {
    if (!(error instanceof OfficeError)) throw error;
    const line = `팀 Office를 다시 켤 수 없는 상태라 멈추지 않고 켜진 채로 둡니다 — ${printable(error.message)}`;
    e.say(line);
    fail(error.code, line);
  }
  e.say("팀 Office를 멈춥니다");
  await (d.stopTeam ?? lifecycleStopTeam)(e.root);
  e.say("팀 Office를 다시 켭니다");
  return (d.upTeam ?? ((root: string) => up({ engine: "team", open: false, dataDir: root })))(e.root);
}

/** `pazmo-office mac connect|status|disconnect|restart`. The platform check for connect and restart is the CLI's. */
export async function macCommand(
  action: string,
  options: { hub?: string; name?: string; dataDir?: string },
  deps: MacCliDeps = {},
): Promise<unknown> {
  if (!MAC_ACTIONS.includes(action)) return fail("ARGUMENT", "mac needs an action: connect, status, disconnect or restart.");
  const e = envOf(dataRoot(options.dataDir), deps);
  if (action === "connect") return connect(e, options, deps);
  if (action === "status") return macStatus(e, deps);
  if (action === "disconnect") return disconnect(e, deps);
  return restart(e, deps);
}
