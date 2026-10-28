import type { ClaimedTask } from "../hub/story-store.ts";
import type { GhResult } from "./gh.ts";
import type { OpenClaim, TeamStore } from "./store.ts";
import { classifyLinkError, type StoryLink } from "./story-link.ts";

/** One registered repo as the scheduler sees it. Task 7 keeps `gh` and `state`
 * current, in place on these same objects: `ready` means it has a link and its
 * `gh` login is fine, and the scheduler does not work that out again. */
export type RepoLane = {
  project: string;
  remote: string;
  link: StoryLink | null;
  gh: GhResult | null;
  state: "ready" | "no-link" | "gh" | "relink" | "hub-too-old";
};

export type TickResult =
  | { claimed: OpenClaim }
  | { recovered: OpenClaim }
  | { skipped: "open" | "paused" | "cap" | "busy" | "no-lane" }
  | { claimed: null };

export type ClaimScheduler = {
  tick(): Promise<TickResult>;
  beat(): Promise<void>;
  lanes(): RepoLane[];
};

type ReadyLane = RepoLane & { link: StoryLink };

const isReady = (lane: RepoLane): lane is ReadyLane =>
  lane.state === "ready" && lane.link !== null;

/** Status and code of a failed Hub call (or a short message when it has
 * neither), for the log: never the whole error, so nothing that came back from
 * the Hub or the network is copied into a line. */
function describeError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown error";
  const { status, code, message } = error as Record<string, unknown>;
  const parts = [status, code].filter(
    (part) => typeof part === "string" || typeof part === "number",
  );
  if (parts.length > 0) return parts.join(" ");
  return typeof message === "string" && message ? message.slice(0, 80) : "unknown error";
}

const hasIds = (task: ClaimedTask | null | undefined): task is ClaimedTask =>
  typeof task?.taskId === "string" && typeof task?.claimId === "string";

/**
 * Takes at most one Story Task for this person's team Office, from whichever
 * registered repo has one ready, and keeps the Task's claim alive. This is only
 * the decision logic: the timers that call `tick` and `beat` belong to the
 * caller. The two never run twice at once: a call made while one of the same
 * kind is still running gets that run's result.
 */
export function createClaimScheduler(d: {
  lanes: RepoLane[];
  store: TeamStore;
  /** Whether a Task is running in any repo engine right now. */
  busy: () => boolean;
  log?: (line: string) => void;
}): ClaimScheduler {
  const { lanes, store } = d;
  const log = d.log ?? (() => {});

  /** What a failed call of `lane` means for this cycle: `next` goes on to the
   * next lane (the lane itself cannot be used until the member fixes it), `end`
   * leaves everything as it is and tries again on the next cycle. */
  function onFailure(lane: RepoLane, what: string, error: unknown): "next" | "end" {
    const kind = classifyLinkError(error);
    if (kind === "relink" || kind === "hub-too-old") {
      lane.state = kind;
      log(`team: ${lane.project}: ${what} was refused (${describeError(error)}); the repo link needs attention`);
      return "next";
    }
    // `retry`, and the two answers that cannot be a normal outcome of these
    // calls (NOT_YOURS or STATE on an inbox, claim or task read). A permanent
    // cause (a 404, a bad config) also looks like this, so it is always logged.
    log(`team: ${lane.project}: ${what} failed (${describeError(error)}); trying again next cycle`);
    return "end";
  }

  /** The Task of a repo is stored only with both ids as strings: Story-link
   * checks the shape of a reply, not its fields. */
  function record(lane: RepoLane, task: ClaimedTask | null | undefined, source: "claim" | "recovered", what: string): OpenClaim | null {
    if (!hasIds(task)) {
      log(`team: ${lane.project}: ${what} returned a Task without ids (HUB_BAD_RESPONSE); trying again next cycle`);
      return null;
    }
    store.recordClaim(lane.project, task, source);
    return { taskId: task.taskId, claimId: task.claimId, project: lane.project, task };
  }

  /** Runs one Hub call of `lane`: its value, or what to do about its failure.
   * Only the call is inside the `try`, so a store error is never mistaken for a
   * Hub error. */
  async function attempt<T>(lane: RepoLane, what: string, call: () => Promise<T>): Promise<{ value: T } | "next" | "end"> {
    try {
      return { value: await call() };
    } catch (error) {
      return onFailure(lane, what, error);
    }
  }

  /** A claim the Hub already has open for this person that the store lost: a
   * reply that never arrived, or a restart before the write. Each repo's link
   * is asked, since the inbox only shows the Task of its own repo, and the Task
   * is read through the link that reported it. */
  async function recover(): Promise<OpenClaim | "end" | null> {
    for (const lane of lanes) {
      if (!isReady(lane)) continue;
      const inbox = await attempt(lane, "reading the inbox", () => lane.link.inbox());
      if (inbox === "end") return "end";
      if (inbox === "next") continue;
      const { mine } = inbox.value;
      if (!mine) continue;
      const read = await attempt(lane, "reading the open claim", () => lane.link.task(mine.taskId, mine.claimId));
      if (read === "end") return "end";
      if (read === "next") continue;
      return record(lane, read.value, "recovered", "reading the open claim") ?? "end";
    }
    return null;
  }

  async function runTick(): Promise<TickResult> {
    if (store.openClaim()) return { skipped: "open" };

    const recovered = await recover();
    if (recovered === "end") return { claimed: null };
    if (recovered) return { recovered };

    const { paused, dailyCap } = store.settings();
    if (paused) return { skipped: "paused" };
    if (dailyCap !== null && store.claimedToday() >= dailyCap) return { skipped: "cap" };
    if (d.busy()) return { skipped: "busy" };
    if (!lanes.some(isReady)) return { skipped: "no-lane" };

    for (const lane of lanes) {
      // Looked at again for each lane: a lane can stop being ready while an earlier one is asked.
      if (!isReady(lane)) continue;
      const taken = await attempt(lane, "the claim", () => lane.link.claim());
      if (taken === "end") return { claimed: null };
      if (taken === "next" || taken.value === null) continue;
      const claim = record(lane, taken.value, "claim", "the claim");
      return claim ? { claimed: claim } : { claimed: null };
    }
    return { claimed: null };
  }

  async function runBeat(): Promise<void> {
    const open = store.openClaim();
    if (!open) return;
    const lane = lanes.find((candidate) => candidate.project === open.project);
    // Only the lane's link works for this claim, and a Hub call needs no gh login, so its state is not looked at.
    if (!lane || !lane.link) {
      log(`team: ${open.project}: no repo link to send the heartbeat for ${open.taskId}`);
      return;
    }
    try {
      await lane.link.heartbeat(open.taskId, open.claimId, "build");
    } catch (error) {
      const kind = classifyLinkError(error);
      if (kind === "not-yours") {
        // Dropped only if it is still the claim that was sent: an operator may have replaced the record meanwhile.
        const now = store.openClaim();
        if (now && now.taskId === open.taskId && now.claimId === open.claimId) {
          store.dropClaim(open.taskId, "NOT_YOURS");
          log(`team: ${open.project}: ${open.taskId} is no longer this Office's claim (NOT_YOURS); the record was dropped`);
        }
      } else if (kind === "state") {
        log(`team: ${open.project}: the heartbeat for ${open.taskId} was refused (STATE); the record is kept`);
      } else if (kind === "relink" || kind === "hub-too-old") {
        lane.state = kind;
        log(`team: ${open.project}: the heartbeat for ${open.taskId} was refused (${describeError(error)}); the repo link needs attention`);
      } else {
        log(`team: ${open.project}: the heartbeat for ${open.taskId} failed (${describeError(error)}); trying again next cycle`);
      }
    }
  }

  let ticking: Promise<TickResult> | null = null;
  let beating: Promise<void> | null = null;
  return {
    tick() {
      ticking ??= runTick().finally(() => {
        ticking = null;
      });
      return ticking;
    },
    beat() {
      beating ??= runBeat().finally(() => {
        beating = null;
      });
      return beating;
    },
    lanes: () => lanes.slice(),
  };
}
