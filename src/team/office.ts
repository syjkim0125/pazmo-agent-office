import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fail, locate } from "../cli/project.ts";
import { createLeanOffice } from "../lean/office.ts";
import type { LeanConfig, LeanOffice } from "../lean/office.ts";
import { openLeanDb } from "../lean/schema.ts";
import { readLinkConfig } from "../runtime/hub-link.ts";
import type { LiveConfig } from "../runtime/live.ts";
import { ghStatus, remoteHost } from "./gh.ts";
import type { GhResult } from "./gh.ts";
import { readTeam, teamDir } from "./registry.ts";
import { createClaimScheduler } from "./scheduler.ts";
import type { RepoLane } from "./scheduler.ts";
import { openTeamStore } from "./store.ts";
import type { TeamStore } from "./store.ts";
import { storyLink } from "./story-link.ts";
import type { StoryLink } from "./story-link.ts";

/** How often the Office tries to claim a Task. */
const CLAIM_MS = 30000;
/** How often the open claim's heartbeat goes out: well inside the Hub's 600000 ms hold. */
const BEAT_MS = 60000;
/** How often a repo that is not ready (no link, gh, a link the Hub refused) is checked again. */
const RECHECK_MS = 300000;

export type TeamStatus = {
  repos: { project: string; remote: string; state: RepoLane["state"]; gh: GhResult | null }[];
  paused: boolean;
  dailyCap: number | null;
  today: number;
  claim: { storyNumber: number; taskNumber: number; title: string; project: string } | null;
  busy: boolean;
};

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
  live?: LiveConfig;
  createRuntime?: LeanConfig["createRuntime"];
  runnerCatalog?: LeanConfig["runnerCatalog"];
  now?: () => number;
  /** The Story link of a repo from its data directory; default: its hub-link.json. */
  linkOf?: (dataDir: string) => StoryLink | null;
  /** The gh login for a Git host; default: `gh auth status --hostname` with this process's PATH and HOME. */
  ghOf?: (host: string) => Promise<GhResult>;
  claimMs?: number;
  beatMs?: number;
  recheckMs?: number;
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

function defaultLinkOf(dataDir: string): StoryLink | null {
  const config = readLinkConfig(dataDir);
  return config ? storyLink(config) : null;
}

const stateOf = (lane: RepoLane): RepoLane["state"] => (!lane.link ? "no-link" : lane.gh?.ok ? "ready" : "gh");

/**
 * The team Office: one lean engine per registered repo, on that repo's own
 * lean data, tied to one run at a time; and the claim scheduler over one lane
 * per repo. Claims every `claimMs`, sends the open claim's heartbeat every
 * `beatMs`, and checks the repos that are not ready again every `recheckMs`.
 * Stage 2 records a claimed Task and keeps it alive; it does not run it.
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
  if (repos.length === 0)
    fail("NO_REPOS", "No repo is registered in the team Office. Add one with `team add --project PATH` first.");
  const linkOf = c.linkOf ?? defaultLinkOf;
  const ghOf =
    c.ghOf ?? ((host: string) => ghStatus(host, { pathEnv: process.env.PATH ?? "", home: homedir() }));

  const gate = sharedGate(log);
  type Engine = { project: string; member: GateMember; db: DatabaseSync; office?: LeanOffice };
  const engines: Engine[] = [];
  const lanes: RepoLane[] = [];
  /** Where each lane's link file is, and its Git host (null when gh cannot be asked about it). */
  const where = new Map<RepoLane, { dataDir: string; host: string | null }>();
  const timers: ReturnType<typeof setInterval>[] = [];
  let stopped = false;
  let store: TeamStore | undefined;
  let closing: Promise<void> | undefined;

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

    for (const { p } of located) {
      const member = gate.join(p.project);
      const engine: Engine = { project: p.project, member, db: openLeanDb(p.dataDir, p.project) };
      engines.push(engine);
      engine.office = await createLeanOffice({
        db: engine.db,
        project: p.project,
        // The repo's own lean data, as its single lean Office uses it.
        dataDir: join(p.dataDir, "lean"),
        token: c.token,
        live: c.live,
        createRuntime: c.createRuntime,
        runnerCatalog: c.runnerCatalog,
        now: c.now,
        othersActive: member.othersActive,
        onSettled: () => void member.onSettled(),
      });
      member.attach(engine.office);
      // Only a live Office can run a task, and a task needs an agent.
      if (c.live) await engine.office.agents.ensureDefault();
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
    }
  } catch (error) {
    await closeAll().catch((closeError) => log(`team: closing after a failed start failed (${describe(closeError)})`));
    throw error;
  }
  const teamStore = store;

  const scheduler = createClaimScheduler({ lanes, store: teamStore, busy: () => gate.busy(), log });

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
      if (host && answers.has(host)) lane.gh = answers.get(host)!;
      lane.state = stateOf(lane);
      if (lane.state === "ready") log(`team: ${lane.project}: ready again (was ${before})`);
      else if (lane.state !== before) log(`team: ${lane.project}: not claiming yet: ${why(lane)}`);
    }
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
  every(c.claimMs ?? CLAIM_MS, "claim tick", () => scheduler.tick());
  every(c.beatMs ?? BEAT_MS, "heartbeat", () => scheduler.beat());
  every(c.recheckMs ?? RECHECK_MS, "repo check", recheck);

  return {
    status() {
      const { paused, dailyCap } = teamStore.settings();
      const open = teamStore.openClaim();
      return {
        repos: lanes.map(({ project, remote, state, gh }) => ({ project, remote, state, gh })),
        paused,
        dailyCap,
        today: teamStore.claimedToday(),
        claim: open && {
          storyNumber: open.task.story?.number,
          taskNumber: open.task.number,
          title: open.task.title,
          project: open.project,
        },
        busy: gate.busy(),
      };
    },
    assertIdle() {
      for (const engine of engines) engine.office!.assertIdle();
    },
    beginStop() {
      stopTimers();
      gate.stop();
      for (const engine of engines) engine.office!.beginStop();
    },
    close: closeAll,
  };
}
