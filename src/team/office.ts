import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { OfficeError, fail, locate } from "../cli/project.ts";
import { createLeanOffice } from "../lean/office.ts";
import type { LeanConfig, LeanOffice } from "../lean/office.ts";
import { openLeanDb } from "../lean/schema.ts";
import { printable, readLinkConfig } from "../runtime/hub-link.ts";
import type { LiveConfig } from "../runtime/live.ts";
import { keptClaudeBlock, loadRunnerCatalog } from "../runtime/runner-settings.ts";
import type { RunnerCatalog } from "../runtime/runner-settings.ts";
import { STORY_CHECKOUT } from "./branch.ts";
import { branchOps, createExecutor, prOps } from "./executor.ts";
import type { BranchOps, Executor, PrOps } from "./executor.ts";
import { ghStatus, remoteHost } from "./gh.ts";
import type { GhResult } from "./gh.ts";
import { macClient, readMacLink } from "./mac.ts";
import type { MacClient, MacLinkFile } from "./mac.ts";
import { syncMacRepos } from "./mac-sync.ts";
import { createMacWatch, spawnMacRestart } from "./mac-watch.ts";
import type { Presence } from "./mac-watch.ts";
import { newPlanHolder, planLink } from "./plan-link.ts";
import type { PlanLink } from "./plan-link.ts";
import { createPlanner, planGitOps } from "./planner.ts";
import type { PlanGit, PlanLane } from "./planner.ts";
import { assertReposPresent, readTeam, teamDir } from "./registry.ts";
import { createClaimScheduler } from "./scheduler.ts";
import type { RepoLane } from "./scheduler.ts";
import { openTeamStore, waitingOf } from "./store.ts";
import type { ClaimPhase, RunnerWaiting, TeamStore } from "./store.ts";
import { storyLink } from "./story-link.ts";
import type { OpenTaskRef, StoryLink } from "./story-link.ts";

/** How often the Office tries to claim a Task. */
const CLAIM_MS = 30000;
/** How often the open claim's heartbeat goes out: well inside the Hub's 600000 ms hold. */
const BEAT_MS = 60000;
/** How often a repo that is not ready (no link, gh, a link the Hub refused) is checked again. */
const RECHECK_MS = 300000;
/** How often the open record is taken one phase further, besides each settle of a repo engine. */
const DRIVE_MS = 10000;
/** Where a repo's Story engine works, in the repo's data directory: the Office's own checkout of the repo
 * (a linked worktree) and the engine's data. The repo's `lean/` data is never opened. */
const CHECKOUT_DIR = STORY_CHECKOUT;
const STORY_DIR = "story";
/** How long one runner discovery serves every repo engine, as one engine reuses its own. */
const DISCOVERY_TTL_MS = 5000;

export type TeamStatus = {
  repos: { project: string; remote: string; state: RepoLane["state"]; gh: GhResult | null }[];
  /** `live` once started with `--live` (or `up --team`): only then are Tasks claimed and run. */
  execution: "live" | "locked";
  paused: boolean;
  dailyCap: number | null;
  today: number;
  claim: {
    storyNumber: number;
    taskNumber: number;
    title: string;
    project: string;
    phase: ClaimPhase;
    attempts: number;
    /** The runner account problem the attempt waits out (D37), or null. */
    waiting: RunnerWaiting | null;
  } | null;
  /** The open Task of this person's that the latest claim reply named as keeping the Hub from giving another. */
  blockedBy: OpenTaskRef | null;
  busy: boolean;
};

/** The status in the lifecycle's own words for execution (`status --team`): a live team Office is `ready`, as
 * `up --team` (its reuse check) and a later `start --team --live` (its EXECUTION_LOCKED check) compare it. */
export function lifecycleView(status: TeamStatus): Omit<TeamStatus, "execution"> & { execution: "ready" | "locked" } {
  return { ...status, execution: status.execution === "live" ? "ready" : "locked" };
}

export type TeamOffice = {
  status(): TeamStatus;
  /** Throws (TASK_ACTIVE) while any repo engine has a run. */
  assertIdle(): void;
  /** A stop was accepted: no claim, heartbeat or check starts from here on. */
  beginStop(): void;
  /** Closes every repo engine, its database and the team store. Idempotent. */
  close(): Promise<void>;
};

export type TeamConfig = {
  /** The canonical data root (`dataRoot`): the registry and `<root>/team` live there. */
  root: string;
  token: string;
  /** What `start --team --live` and `up --team` run with. Every repo's Story engine gets it, and only then
   * does the Office claim and run Tasks. Without it every engine opens locked, no git runs on the repos and
   * nothing is claimed. */
  live?: LiveConfig;
  /** Tests only: the engines' runtime in place of the live one (the shared gate and the Story engine are
   * exercised with a fake). It does not unlock execution: that is `live`. */
  createRuntime?: LeanConfig["createRuntime"];
  runnerCatalog?: LeanConfig["runnerCatalog"];
  now?: () => number;
  /** The Story link of a repo from its data directory; default: its hub-link.json. */
  linkOf?: (dataDir: string) => StoryLink | null;
  /** The plan link of a repo from its data directory (the same link, for the PL's plan work) carrying `holder`, this
   * Office start's lease holder id; default: its hub-link.json. */
  planLinkOf?: (dataDir: string, holder: string) => PlanLink | null;
  /** Tests only: the host git of a plan's planning tree; default `planGitOps(host)`. */
  planGit?: PlanGit;
  /** The gh login for a Git host; default: `gh auth status --hostname` with `host`'s PATH and HOME. */
  ghOf?: (host: string) => Promise<GhResult>;
  /** The person's own HOME and PATH (and ssh agent) for the host git and gh of a Story Task; default: this
   * process's. */
  host?: { home: string; pathEnv: string; sshAuthSock?: string };
  /** Tests only: the host git and gh steps; default: `branchOps(host)` and `prOps(host)`. */
  git?: BranchOps;
  pr?: PrOps;
  /** The Mac link; default `readMacLink(root)`, with a file that cannot be used said once and taken as none. */
  macLinkOf?: () => MacLinkFile | null;
  /** The Hub client of the Mac link; default `macClient(file)`. */
  macClientFor?: (file: MacLinkFile) => MacClient;
  /** The repo check of a connected Mac: what only a full sync can do (registry changes). Default: the `pending` of a
   * links-only `syncMacRepos` (repo links are fixed in place), each of its lines said once while it repeats. */
  macSync?: (file: MacLinkFile, client: Pick<MacClient, "repos" | "link">) => Promise<{ add: string[]; remove: string[] }>;
  /** Restarts this Office apart from it; default `spawnMacRestart(root, host)`. */
  restartSelf?: () => void;
  claimMs?: number;
  /** How often the open claim's heartbeat and this Mac's presence go out. */
  beatMs?: number;
  /** How often the repos that are not ready, the runners (while ready) and a connected Mac's repo set are checked. */
  recheckMs?: number;
  driveMs?: number;
  /** Where the Office's lines go; default: stderr (the Office log). */
  log?: (line: string) => void;
};

/** Code and message of a failure, for one log line. Hub failures never get
 * here: the scheduler logs those itself. */
function describe(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error).slice(0, 160);
  const { code, message } = error as Record<string, unknown>;
  const text = typeof message === "string" ? message.slice(0, 160) : "";
  return typeof code === "string" ? (text ? `${code}: ${text}` : code) : text || "unknown error";
}

type Peer = Pick<LeanOffice, "busy" | "refresh">;
export type GateMember = {
  /** Some other open engine has a run (what the engine's `othersActive` asks). Never throws. */
  othersActive(): boolean;
  /** Lets the other engines continue, one after another, from the one after
   * this engine (what its `onSettled` does). Never rejects. */
  onSettled(): Promise<void>;
  /** The engine, once it exists: its callbacks are made before it is. */
  attach(peer: Peer): void;
  /** The engine closed: it is neither asked nor refreshed again. */
  leave(): void;
};

/**
 * Ties the repo engines of one team Office to a single run at a time. An
 * engine whose `busy()` throws counts as running: a run is never started beside
 * one that cannot be ruled out. When an engine settles, the others are
 * refreshed in registration order starting after it, so each repo gets its turn
 * in round robin; each refresh waits for the one before, which may have started
 * the next run.
 */
export function sharedGate(log: (line: string) => void) {
  type Slot = { name: string; peer: Peer | null; open: boolean };
  const slots: Slot[] = [];
  let stopped = false;
  function running(slot: Slot): boolean {
    if (!slot.open || !slot.peer) return false;
    try {
      return slot.peer.busy();
    } catch (error) {
      log(`team: ${slot.name}: could not tell whether it runs (${describe(error)}); counted as running`);
      return true;
    }
  }
  return {
    join(name: string): GateMember {
      const slot: Slot = { name, peer: null, open: true };
      slots.push(slot);
      return {
        othersActive: () => slots.some((other) => other !== slot && running(other)),
        async onSettled() {
          const at = slots.indexOf(slot);
          for (const other of [...slots.slice(at + 1), ...slots.slice(0, at)]) {
            if (stopped) return;
            if (!other.open || !other.peer) continue;
            try {
              await other.peer.refresh();
            } catch (error) {
              log(`team: ${other.name}: its continuation after another repo's run failed (${describe(error)})`);
            }
          }
        },
        attach(peer) {
          slot.peer = peer;
        },
        leave() {
          slot.open = false;
        },
      };
    },
    /** Any open engine has a run. */
    busy: () => slots.some(running),
    /** The Office is stopping: no engine is refreshed from here on. */
    stop() {
      stopped = true;
    },
  };
}

/** One runner discovery at a time for every repo engine, reused for DISCOVERY_TTL_MS: they all ask about the
 * same CLIs on this Mac, and a live start would otherwise run one per repo (seconds each) before it is ready.
 * While `hold(true)` (the start), a kept discovery is reused however old, so one serves the whole start. A
 * failed discovery is neither kept nor reused. Every repo's discovery passes here, so a hook block that any
 * of them found survives a failed claude listing for all of them (D29/D39), not only for the repo that saw it. */
function sharedDiscovery(
  discover: (home?: string, pathEnv?: string) => Promise<RunnerCatalog>,
  now: () => number,
) {
  let kept: { at: number; catalog: RunnerCatalog } | undefined;
  let flight: Promise<RunnerCatalog> | undefined;
  let held = false;
  return {
    load(home?: string, pathEnv?: string): Promise<RunnerCatalog> {
      if (flight) return flight;
      if (kept && (held || now() - kept.at < DISCOVERY_TTL_MS)) return Promise.resolve(kept.catalog);
      const started = discover(home, pathEnv).then((found) => {
        const catalog = keptClaudeBlock(kept?.catalog, found);
        kept = { at: now(), catalog };
        return catalog;
      });
      flight = started;
      const settled = () => {
        if (flight === started) flight = undefined;
      };
      started.then(settled, settled);
      return started;
    },
    hold(on: boolean): void {
      held = on;
    },
  };
}

function defaultLinkOf(dataDir: string): StoryLink | null {
  const config = readLinkConfig(dataDir);
  return config ? storyLink(config) : null;
}
function defaultPlanLinkOf(dataDir: string, holder: string): PlanLink | null {
  const config = readLinkConfig(dataDir);
  return config ? planLink(config, undefined, holder) : null;
}

const stateOf = (lane: RepoLane): RepoLane["state"] => (!lane.link ? "no-link" : lane.gh?.ok ? "ready" : "gh");

/**
 * The team Office: one Story engine per registered repo, on the Office's own
 * checkout of that repo (`<repo dataDir>/story-checkout`, data in
 * `<repo dataDir>/story`), tied to one run at a time; the claim scheduler over
 * one lane per repo; and the executor that runs the claimed Task. Claims every
 * `claimMs` (only when live, with every engine's runners ready and no open
 * record), sends the open claim's heartbeat every `beatMs`, checks the repos
 * that are not ready again every `recheckMs`, and drives the open record when an
 * engine settles and every `driveMs`. A live start drives the open record at
 * once; until that first drive settles, a heartbeat answered NOT_YOURS does not
 * drop a verified or merging record. Without `live` the engines open locked and the
 * open record, if any, waits: only its heartbeat goes on (a failed one is read
 * instead), and a verified or merging one gets neither heartbeat nor drop.
 */
export async function createTeamOffice(c: TeamConfig): Promise<TeamOffice> {
  const sink = c.log ?? ((line: string) => console.error(line));
  // A log line never takes anything down with it.
  const log = (line: string) => {
    try {
      sink(line);
    } catch {
      // nowhere left to say it
    }
  };
  const { repos } = readTeam(c.root);
  // A connected Mac (mac-link.json) runs the team Office with no repo yet, so that the Mac counts as on for its member.
  if (repos.length === 0 && !(c.macLinkOf ?? (() => readMacLink(c.root)))())
    fail("NO_REPOS", "No repo is registered in the team Office. Add one with `team add --project PATH` first.");
  // Before anything opens: `locate` would fail on a missing folder with a bare ENOENT.
  assertReposPresent(repos);
  const linkOf = c.linkOf ?? defaultLinkOf;
  const hostEnv = c.host ?? { home: homedir(), pathEnv: process.env.PATH ?? "" };
  const ghOf = c.ghOf ?? ((gitHost: string) => ghStatus(gitHost, hostEnv));
  const git = c.git ?? branchOps(hostEnv);
  const pr = c.pr ?? prOps(hostEnv);
  const live = c.live !== undefined;
  const clock = c.now ?? Date.now;
  const recheckMs = c.recheckMs ?? RECHECK_MS;
  const discovery = sharedDiscovery(c.runnerCatalog ?? loadRunnerCatalog, clock);
  // Released once the start has checked the runners.
  discovery.hold(true);

  const gate = sharedGate(log);
  type Engine = {
    /** The registered repo. */
    project: string;
    remote: string;
    checkout: string;
    member: GateMember;
    db: DatabaseSync;
    office?: LeanOffice;
    /** The engine's default agent, which runs its Story Tasks (live only). */
    agentId?: string;
  };
  const engines: Engine[] = [];
  const lanes: RepoLane[] = [];
  /** Where each lane's link file is, and its Git host (null when gh cannot be asked about it). */
  const where = new Map<RepoLane, { dataDir: string; host: string | null }>();
  /** Each lane's plan link, read with its Story link (at the start and by `recheck`). */
  const planLinks = new Map<RepoLane, PlanLink | null>();
  /** The PL's plan work, made once the engines are open (live only). */
  let planner: ReturnType<typeof createPlanner> | undefined;
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false;
  let store: TeamStore | undefined;
  let closing: Promise<void> | undefined;
  /** Made once the engines are open: their settle drives it. */
  let executor: Executor | undefined;
  /** Whether the first drive after a live start has settled (a locked Office drives nothing). */
  let firstDriven = !live;

  function stopTimers() {
    stopped = true;
    for (const timer of timers) clearInterval(timer);
    timers.length = 0;
  }
  /** Closes what is open: every engine at once (each stops starting runs as
   * its close begins), then the databases, then the store. */
  function closeAll(): Promise<void> {
    closing ??= (async () => {
      stopTimers();
      planner?.stop();
      gate.stop();
      let failure: unknown;
      for (const result of await Promise.allSettled(engines.map(async (engine) => engine.office?.close())))
        if (result.status === "rejected") failure ??= result.reason;
      for (const engine of engines) {
        engine.member.leave();
        try {
          engine.db.close();
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        store?.close();
      } catch (error) {
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
    })();
    return closing;
  }

  function linkFor(project: string, dataDir: string): StoryLink | null {
    try {
      return linkOf(dataDir);
    } catch (error) {
      log(`team: ${project}: the Hub link cannot be read (${describe(error)}); connect it again with pazmo-office hub-link --project ${project}`);
      return null;
    }
  }
  const planLinkOf = c.planLinkOf ?? defaultPlanLinkOf;
  /** This Office start's lease holder id, on every plan link: a plan step leased here is this Office's alone, not
   * another Office's of the same person (a Mac and a connection-string Office). */
  const holder = newPlanHolder();
  /** The same link file as the Story link: a file that cannot be read was said by `linkFor`. */
  function planLinkFor(dataDir: string): PlanLink | null {
    try {
      return planLinkOf(dataDir, holder);
    } catch {
      return null;
    }
  }
  function checkGh(host: string): Promise<GhResult | null> {
    return Promise.resolve()
      .then(() => ghOf(host))
      .catch((error) => {
        log(`team: the gh login for ${host} could not be checked (${describe(error)})`);
        return null;
      });
  }
  function why(lane: RepoLane): string {
    if (lane.state === "no-link")
      return `no Hub link yet; connect it with pazmo-office hub-link --project ${lane.project}`;
    if (lane.state === "gh") return lane.gh && !lane.gh.ok ? lane.gh.hint : "the gh login could not be checked";
    return lane.state;
  }

  try {
    store = openTeamStore(teamDir(c.root), c.now);
    const located = repos.map((repo) => {
      const p = locate(repo.project, c.root);
      let host: string | null = null;
      try {
        host = remoteHost(repo.remote);
      } catch {
        log(`team: ${p.project}: its origin ${repo.remote} names no Git host gh can check`);
      }
      return { remote: repo.remote, p, host };
    });
    // One gh check per host, while the engines open.
    const checks = new Map<string, Promise<GhResult | null>>();
    for (const { host } of located) if (host && !checks.has(host)) checks.set(host, checkGh(host));

    for (const { p, remote } of located) {
      const checkout = join(p.dataDir, CHECKOUT_DIR);
      const data = join(p.dataDir, STORY_DIR);
      // A live engine's runtime checks that its project is a git top level, so the checkout comes first. A
      // locked Office runs no git on the repos: its engines only read their data.
      // One repo whose checkout cannot be made (no commit yet, git not on the person's PATH) fails the start.
      if (live)
        await git.ensureCheckout(p.project, checkout).catch((error: unknown) =>
          fail(
            error instanceof OfficeError ? error.code : "GIT_FAILED",
            `The Story checkout of ${p.project} could not be made: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      const member = gate.join(p.project);
      const engine: Engine = { project: p.project, remote, checkout, member, db: openLeanDb(data, checkout) };
      engines.push(engine);
      engine.office = await createLeanOffice({
        db: engine.db,
        project: checkout,
        dataDir: data,
        token: c.token,
        live: c.live,
        createRuntime: c.createRuntime,
        runnerCatalog: (home, pathEnv) => discovery.load(home, pathEnv),
        now: c.now,
        othersActive: member.othersActive,
        // The other engines' turn and the drive start together; the gate's othersActive keeps one run at a time.
        onSettled: () => {
          void member.onSettled();
          if (live && !stopped) void executor?.drive();
        },
      });
      member.attach(engine.office);
      // A Story Task needs an agent; the engine's runners are checked against it before each claim.
      if (live) engine.agentId = (await engine.office.agents.ensureDefault()).id;
    }

    const gh = new Map<string, GhResult | null>();
    for (const [host, check] of checks) gh.set(host, await check);
    for (const { remote, p, host } of located) {
      const lane: RepoLane = {
        project: p.project,
        remote,
        link: linkFor(p.project, p.dataDir),
        gh: host ? (gh.get(host) ?? null) : null,
        state: "no-link",
      };
      lane.state = stateOf(lane);
      if (lane.state !== "ready") log(`team: ${lane.project}: not claiming yet: ${why(lane)}`);
      lanes.push(lane);
      where.set(lane, { dataDir: p.dataDir, host });
      planLinks.set(lane, planLinkFor(p.dataDir));
    }
  } catch (error) {
    await closeAll().catch((closeError) => log(`team: closing after a failed start failed (${describe(closeError)})`));
    throw error;
  }
  const teamStore = store;

  function engineOf(project: string): Engine {
    return (
      engines.find((engine) => engine.project === project) ??
      fail("NOT_FOUND", "The open Story Task's repo is not registered in the team Office.")
    );
  }
  const ex = createExecutor({
    store: teamStore,
    engineOf: (project) => engineOf(project).office!,
    linkOf: (project) => lanes.find((lane) => lane.project === project)?.link ?? null,
    git,
    pr,
    checkoutOf: (project) => engineOf(project).checkout,
    remoteOf: (project) => engineOf(project).remote,
    agentOf: (project) =>
      engineOf(project).agentId ?? fail("EXECUTION_LOCKED", "Start the team Office with --live to run Story Tasks."),
    log,
    now: c.now,
  });
  executor = ex;

  /** Whether every repo engine's agent has its runners logged in and installed, as of the last check, and when
   * that was. */
  let runnersReady = false;
  let runnersCheckedAt: number | null = null;
  let runnersNote: string | null = null;
  /** The runners of the engines that were not ready at the last check, each once: what `limited` names. */
  let runnersWaiting: string[] = [];
  /** Asks every engine whether its agent's runners pass today's discovery (one discovery serves them all). One
   * line each time the answer changes, naming the runners that are not ready. */
  async function checkRunners(): Promise<void> {
    const waiting: string[] = [];
    const names: string[] = [];
    for (const engine of engines) {
      let ready = false;
      try {
        ready = engine.agentId !== undefined && (await engine.office!.agents.runnersReady(engine.agentId));
      } catch (error) {
        log(`team: ${engine.project}: its runners could not be checked (${describe(error)})`);
      }
      if (ready) continue;
      // The agent is the engine's default one, fixed when it was made: name its runners, to log in to.
      const agent = engine.office!.agents.list().find((a) => a.id === engine.agentId);
      waiting.push(agent ? `${engine.project} (work ${agent.work.runner}, review ${agent.review.runner})` : engine.project);
      for (const runner of agent ? [agent.work.runner, agent.review.runner] : []) if (!names.includes(runner)) names.push(runner);
    }
    runnersReady = waiting.length === 0;
    runnersWaiting = names;
    runnersCheckedAt = clock();
    const note = runnersReady
      ? "team: every repo's runners are ready; claiming again"
      : `team: not claiming: the runners of ${waiting.join(", ")} are not ready; log in to those CLIs on this Mac`;
    // The first ready answer says nothing: claiming is what a live Office does.
    if (note !== runnersNote && !(runnersNote === null && runnersReady)) log(note);
    runnersNote = note;
  }
  /** What this Mac's heartbeat says, the first that holds: locked (not live); limited while the open record waits on
   * its runner's account, or while a live Office's runners are not ready (which runner, and why); working while an
   * engine runs or the open record moves on; idle otherwise. */
  function presenceOf(): Presence {
    if (!live) return { state: "locked", detail: null, until: null };
    const open = teamStore.openClaim();
    const waiting = open ? waitingOf(open) : null;
    if (waiting) return { state: "limited", detail: `${waiting.runner}: ${waiting.kind}`, until: open?.runnerWait?.retryAt ?? null };
    if (!runnersReady)
      return { state: "limited", detail: runnersWaiting.length ? `${runnersWaiting.join(", ")}: not_ready` : "not_ready", until: null };
    if (gate.busy() || planner?.active() || (open !== null && open.phase !== "failed"))
      return { state: "working", detail: null, until: null };
    return { state: "idle", detail: null, until: null };
  }

  /** A link file that cannot be used is said once, until it is fixed or its problem changes. */
  let macLinkNote: string | null = null;
  function readMacLinkOnce(): MacLinkFile | null {
    try {
      const file = readMacLink(c.root);
      macLinkNote = null;
      return file;
    } catch (error) {
      const note = `team: Mac 연결 파일을 쓸 수 없어 허브에 이 Mac의 상태를 보내지 않습니다 — ${printable(error instanceof Error ? error.message : String(error))}`;
      if (note !== macLinkNote) log(note);
      macLinkNote = note;
      return null;
    }
  }
  /** The links-only sync's lines of the last check that went through: a line said then is not said again. */
  let syncSaid = new Set<string>();
  async function linksOnlySync(file: MacLinkFile, client: Pick<MacClient, "repos" | "link">) {
    const said = new Set<string>();
    const { pending, minted } = await syncMacRepos(
      {
        root: c.root,
        hub: file.hub,
        macId: file.macId,
        member: { id: file.memberId, name: file.memberName },
        client,
        git: hostEnv,
        ghLogin: null,
        say: (line) => {
          said.add(line);
          if (!syncSaid.has(line)) log(`team: ${line}`);
        },
      },
      "links-only",
    );
    syncSaid = said;
    // A link minted now reaches its lane at once: a lane cut off by a re-pair waits no extra repo check (the Hub
    // shows an open Task held after 10 minutes without a heartbeat).
    if (minted.length) await recheckLanes();
    return pending;
  }
  const macClientFor = c.macClientFor ?? ((file: MacLinkFile) => macClient(file));
  /** A claim tick is under way: a Task the Hub gives in it is not recorded yet. */
  let claimTicking = false;
  const watch = createMacWatch({
    linkOf: c.macLinkOf ?? readMacLinkOnce,
    clientFor: macClientFor,
    presence: presenceOf,
    // A stopping Office is not restarted (the stop is the person's), nor one whose claim is under way.
    idle: () => !stopped && !claimTicking && !planner?.active() && teamStore.openClaim() === null && !gate.busy(),
    // Nor a live one whose runners are not ready (asked afresh, a restart is rare): its `up` would refuse and leave
    // it off, where in place it waits, limited, until the person logs in. A locked Office never checks its runners.
    startable: async () => {
      if (!live) return true;
      await checkRunners();
      return runnersReady;
    },
    sync: c.macSync ?? linksOnlySync,
    restart: c.restartSelf ?? (() => spawnMacRestart(c.root, hostEnv)),
    log,
    now: clock,
    root: c.root,
  });

  /** Whether the scheduler would ask the Hub for a claim now, the runners aside: the same order of checks. */
  function claimCouldFollow(): boolean {
    if (watch.holding()) return false;
    if (teamStore.openClaim() !== null) return false;
    const { paused, dailyCap } = teamStore.settings();
    if (paused || (dailyCap !== null && teamStore.claimedToday() >= dailyCap)) return false;
    if (gate.busy()) return false;
    return lanes.some((lane) => lane.state === "ready" && lane.link !== null);
  }
  /** The ready lanes with a plan link, in registration order: what the planner asks for plan work through. */
  function planLanes(): PlanLane[] {
    return lanes.flatMap((lane) => {
      const link = planLinks.get(lane) ?? null;
      if (lane.state !== "ready" || lane.link === null || link === null) return [];
      return [{ project: lane.project, checkout: engineOf(lane.project).checkout, repoId: link.repoId, link }];
    });
  }
  /** Whether the planner would ask the Hub for plan work now, the runners aside: a pause and the daily cap do not
   * hold plan work. */
  function planCouldFollow(): boolean {
    return planner !== undefined && !watch.holding() && teamStore.openClaim() === null && !gate.busy() && planLanes().length > 0;
  }
  /** Before a claim tick: the runners are checked only when a claim or plan work could follow, and then at once
   * while they were last found not ready, else once every `recheckMs` (a discovery starts the codex and claude CLIs). */
  async function runnersBeforeTick(): Promise<void> {
    if (!live || !(claimCouldFollow() || planCouldFollow())) return;
    if (runnersReady && runnersCheckedAt !== null && clock() - runnersCheckedAt < recheckMs) return;
    await checkRunners();
  }

  // A Task is claimed only when it can run here: live, every engine's runners ready, no record open, and no restart
  // of this Office held.
  const scheduler = createClaimScheduler({
    lanes,
    store: teamStore,
    busy: () => gate.busy(),
    canExecute: () => live && runnersReady && teamStore.openClaim() === null && !watch.holding(),
    stageOf: (open) => ex.stageOf(open),
    onDropped: (open, reason) => ex.onDropped(open, reason),
    // Until the start's first drive has settled, a verified or merging record may hold a merged PR whose claim the
    // PL released: that drive's late report needs the record, so a heartbeat NOT_YOURS leaves it in place.
    keepOnNotYours: (open) => !firstDriven && (open.phase === "verified" || open.phase === "merging"),
    log,
  });

  /** The lanes that are not ready, worked out again in place (the scheduler
   * holds these same objects): the link file is read again, gh is asked again
   * for a host that failed, and the state follows from the two. A lane the Hub
   * refused (relink, hub-too-old) is tried again this way: if the Hub still
   * refuses it, the next claim takes it out of use again. */
  async function recheck(): Promise<void> {
    const pending = lanes.filter((lane) => lane.state !== "ready");
    if (pending.length === 0) return;
    const asked = new Map<string, Promise<GhResult | null>>();
    for (const lane of pending) {
      const { host } = where.get(lane)!;
      if (host && !lane.gh?.ok && !asked.has(host)) asked.set(host, checkGh(host));
    }
    const answers = new Map<string, GhResult | null>();
    for (const [host, answer] of asked) answers.set(host, await answer);
    if (stopped) return;
    for (const lane of pending) {
      const { dataDir, host } = where.get(lane)!;
      const before = lane.state;
      lane.link = linkFor(lane.project, dataDir);
      planLinks.set(lane, planLinkFor(dataDir));
      if (host && answers.has(host)) lane.gh = answers.get(host)!;
      lane.state = stateOf(lane);
      if (lane.state === "ready") log(`team: ${lane.project}: ready again (was ${before})`);
      else if (lane.state !== before) log(`team: ${lane.project}: not claiming yet: ${why(lane)}`);
    }
  }
  /** `recheck`, one at a time: the repo check and a Mac sync that minted a link never work the same lanes at once. */
  let rechecking: Promise<void> = Promise.resolve();
  function recheckLanes(): Promise<void> {
    const next = rechecking.then(recheck, recheck);
    rechecking = next.catch(() => {});
    return next;
  }

  /** A timer whose run never overlaps itself and whose failure is logged, never thrown. */
  function every(ms: number, what: string, run: () => Promise<unknown>) {
    let running = false;
    const timer = setInterval(() => {
      if (stopped || running) return;
      running = true;
      Promise.resolve()
        .then(run)
        .catch((error) => log(`team: the ${what} failed (${describe(error)}); trying again next cycle`))
        .finally(() => {
          running = false;
        });
    }, ms);
    timer.unref();
    timers.push(timer);
  }
  // The start's own runner check, on the start's one discovery; later checks run their own.
  if (live) await checkRunners();
  discovery.hold(false);

  /** A locked Office leaves a record that may hold a merged PR (verified, merging) for a live start: a heartbeat
   * answered NOT_YOURS would drop it with nothing pending, and the merge would never be reported. A live
   * start drives it at once and keeps it through a NOT_YOURS until that drive settles. One line per claim. */
  const leftForLive = new Set<string>();
  function holdsForLive(): boolean {
    if (live) return false;
    const open = teamStore.openClaim();
    if (!open || (open.phase !== "verified" && open.phase !== "merging")) return false;
    if (!leftForLive.has(open.claimId)) {
      leftForLive.add(open.claimId);
      log(
        `team: ${open.project}: story-${open.task.story?.number} task-${open.task.number} is ${open.phase}; no heartbeat and no drop until a start with --live finishes it`,
      );
    }
    return true;
  }

  // At once, the open record left by the last run (if any) is taken one phase further. Heartbeats do not wait for
  // it (a re-verify can take the checks' whole time limits, and a Task without heartbeats shows held): until it
  // settles, `keepOnNotYours` keeps a record left verified or merging whose claim the PL released, so it still
  // reaches its late merged report; a cancel is honoured by the merge step's own second lock ask.
  if (live)
    void ex.drive().then(() => {
      firstDriven = true;
    });
  // The PL's plan work, only when live: a step runs only where a Task could (live, runners ready, no record open, no
  // run, no restart held) and once the executor's drive is idle: a drive whose record a heartbeat dropped may still
  // run git on a checkout the planner fetches into. A pause and the daily cap are for Tasks.
  if (live)
    planner = createPlanner({
      root: c.root,
      lanes: planLanes,
      engineOf: (project) => engineOf(project).office!,
      canStart: () =>
        live && runnersReady && teamStore.openClaim() === null && !gate.busy() && !ex.busy() && !watch.holding() && !stopped,
      git: c.planGit ?? planGitOps(hostEnv),
      beatMs: c.beatMs ?? BEAT_MS,
      recheckMs,
      log,
      now: c.now,
    });
  every(c.claimMs ?? CLAIM_MS, "claim tick", async () => {
    await runnersBeforeTick();
    if (stopped) return;
    claimTicking = true;
    try {
      // Plan work first (the PL waits for it on the web); a tick that did a plan step claims nothing.
      if (planner && (await planner.tick()).ran) return;
      if (stopped) return;
      return await scheduler.tick();
    } finally {
      claimTicking = false;
    }
  });
  every(c.beatMs ?? BEAT_MS, "heartbeat", async () => {
    if (stopped || holdsForLive()) return;
    return scheduler.beat();
  });
  every(recheckMs, "repo check", recheckLanes);
  if (live) every(c.driveMs ?? DRIVE_MS, "drive", () => ex.drive());
  // A connected Mac: its presence at once and every beat (nothing without a Mac link), its repo set every recheck.
  every(c.beatMs ?? BEAT_MS, "presence", () => watch.beat());
  every(recheckMs, "mac repo check", () => watch.check());
  void watch.beat().catch((error) => log(`team: the presence failed (${describe(error)}); trying again next cycle`));

  return {
    status() {
      const { paused, dailyCap } = teamStore.settings();
      const open = teamStore.openClaim();
      return {
        repos: lanes.map(({ project, remote, state, gh }) => ({ project, remote, state, gh })),
        execution: live ? "live" : "locked",
        paused,
        dailyCap,
        today: teamStore.claimedToday(),
        claim: open && {
          storyNumber: open.task.story?.number,
          taskNumber: open.task.number,
          title: open.task.title,
          project: open.project,
          phase: open.phase,
          attempts: open.attempts,
          waiting: waitingOf(open),
        },
        blockedBy: scheduler.blockedBy(),
        busy: gate.busy(),
      };
    },
    assertIdle() {
      for (const engine of engines) engine.office!.assertIdle();
    },
    beginStop() {
      stopTimers();
      planner?.stop();
      gate.stop();
      for (const engine of engines) engine.office!.beginStop();
    },
    close: closeAll,
  };
}
