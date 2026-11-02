import type { ClaimedTask, OpenTaskRef } from "../hub/story-store.ts";
import type { GhResult } from "./gh.ts";
import type { OpenClaim, TeamStore } from "./store.ts";
import { classifyLinkError, type LinkFailure, type StoryLink } from "./story-link.ts";

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

/** `open` of a tick that took nothing is the Task of this person's that the Hub
 * named as the reason, or null when the board simply had nothing to give. */
export type TickResult =
  | { claimed: OpenClaim }
  | { recovered: OpenClaim }
  | { skipped: "open" | "locked" | "paused" | "cap" | "busy" | "no-lane" }
  | { claimed: null; open: OpenTaskRef | null };

/** What the heartbeat tells the Hub about where a Task is. */
export type Stage = "build" | "review" | "verify" | "merge";

export type ClaimScheduler = {
  tick(): Promise<TickResult>;
  beat(): Promise<void>;
  lanes(): RepoLane[];
  /** The open Task of this person's that the latest claim reply named as keeping the Hub from giving another, or null. */
  blockedBy(): OpenTaskRef | null;
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
  /** Whether this Office can run a Task at all right now (live, with its runners ready); if not, nothing is claimed. */
  canExecute: () => boolean;
  /** The stage the heartbeat reports for the open record. */
  stageOf: (open: OpenClaim) => Stage;
  /** Called with the record that was just dropped and why, so whatever runs for it can be stopped. It is not
   * waited for, and a failure of it (thrown, or a rejected promise) is only logged. */
  onDropped?: (open: OpenClaim, reason: string) => void | Promise<void>;
  /** Whether a heartbeat answered NOT_YOURS leaves this record in place for now (one line per claim) instead of
   * dropping it. The Office keeps a verified or merging record until the first drive after its start has settled:
   * that drive may still find the PR merged and send the Hub its late report. */
  keepOnNotYours?: (open: OpenClaim) => boolean;
  log?: (line: string) => void;
}): ClaimScheduler {
  const { lanes, store } = d;
  const log = d.log ?? (() => {});

  /** A failed call of `lane` never stops the other lanes. `relink` and
   * `hub-too-old` also take the lane out of use until the member fixes it. Any
   * other failure (`retry`; the answers that cannot be a normal outcome of
   * these calls: NOT_YOURS or STATE on an inbox, claim or task read; and
   * `invalid`, `lock` and `not-found` outside the calls about the open claim,
   * see `answer`) falls through like `retry`: the lane is left as it is and
   * asked again next cycle. A permanent cause (a 404 for this repo, a bad
   * config) looks the same as a passing network error, so every failure is
   * logged with its project and status/code. */
  function onFailure(lane: RepoLane, what: string, error: unknown): void {
    const kind = classifyLinkError(error);
    if (kind === "relink" || kind === "hub-too-old") {
      lane.state = kind;
      log(`team: ${lane.project}: ${what} was refused (${describeError(error)}); the repo link needs attention`);
      return;
    }
    log(`team: ${lane.project}: ${what} failed (${describeError(error)}); skipping this repo for now`);
  }

  /** The Task of a repo is stored only with both ids as strings: Story-link
   * checks the shape of a reply, not its fields. A Task without them is logged
   * and not stored, like any other failure of that lane. */
  function record(lane: RepoLane, task: ClaimedTask | null | undefined, source: "claim" | "recovered", what: string): OpenClaim | null {
    if (!hasIds(task)) {
      log(`team: ${lane.project}: ${what} returned a Task without ids (HUB_BAD_RESPONSE); skipping this repo for now`);
      return null;
    }
    store.recordClaim(lane.project, task, source);
    // What was stored, with the phase and attempts a new record starts with.
    return store.openClaim();
  }

  /** Runs one Hub call of `lane`: `{ value }`, or `null` after its failure was
   * handled and logged. Only the call is inside the `try`, so a store error is
   * never mistaken for a Hub error. */
  async function attempt<T>(lane: RepoLane, what: string, call: () => Promise<T>): Promise<{ value: T } | null> {
    try {
      return { value: await call() };
    } catch (error) {
      onFailure(lane, what, error);
      return null;
    }
  }

  /** A claim the Hub already has open for this person that the store lost: a
   * reply that never arrived, or a restart before the write. Each repo's link
   * is asked, since the inbox only shows the Task of its own repo, and the Task
   * is read through the link that reported it. A claim whose report the Hub refused for good is not taken back
   * (`leaveRefused`). */
  async function recover(): Promise<OpenClaim | null> {
    for (const lane of lanes) {
      if (!isReady(lane)) continue;
      const inbox = await attempt(lane, "reading the inbox", () => lane.link.inbox());
      if (!inbox?.value.mine) continue;
      const { taskId, claimId, state } = inbox.value.mine;
      const refused = store.refusedClaim(taskId, claimId);
      if (refused) {
        leaveRefused(lane, refused, state);
        continue;
      }
      const read = await attempt(lane, "reading the open claim", () => lane.link.task(taskId, claimId));
      if (!read) continue;
      // A Story verification Task has no repo, so every lane's inbox offers it; it is for the PL, not for this Office.
      if (read.value?.kind !== "work") continue;
      const claim = record(lane, read.value, "recovered", "reading the open claim");
      if (!claim) continue;
      if (state !== "failed") return claim;
      // Failed and not yet rerun: held in phase failed, which is read and never heartbeated.
      store.setPhase(claim.taskId, "failed");
      return { ...claim, phase: "failed" };
    }
    return null;
  }

  /** Claims whose report the Hub refused for good, already logged as not taken back. */
  const refusedSaid = new Set<string>();
  /** A claim whose report the Hub refused for good is left to its PL: taking it back would only run the old change
   * again and be refused again. No record, so no heartbeat: the Hub shows the Task held after 10 minutes, and its PL
   * releases or cancels it. It is shown as `blockedBy` (refined by the next claim reply, which names its repo) and
   * logged once. */
  function leaveRefused(lane: RepoLane, task: ClaimedTask, state: OpenTaskRef["state"]): void {
    const key = `${task.taskId}:${task.claimId}`;
    if (!refusedSaid.has(key)) {
      refusedSaid.add(key);
      log(
        `team: ${lane.project}: story-${task.story?.number} task-${task.number}: the Hub refused its report for good (HUB_REFUSED_REPORT), so its claim is not taken back; no heartbeat goes out for it, so its PL can release or cancel it once it shows held`,
      );
    }
    if (blocked?.storyNumber !== task.story?.number || blocked?.taskNumber !== task.number)
      setBlockedBy({ storyNumber: task.story?.number, taskNumber: task.number, repoName: null, state });
  }

  let blocked: OpenTaskRef | null = null;
  /** Says which open Task keeps the Hub from giving another one, with one line each time that changes. */
  function setBlockedBy(next: OpenTaskRef | null): void {
    const was = blocked;
    blocked = next;
    const same =
      was === next ||
      (was !== null &&
        next !== null &&
        was.storyNumber === next.storyNumber &&
        was.taskNumber === next.taskNumber &&
        was.repoName === next.repoName &&
        was.state === next.state);
    if (same) return;
    log(
      next
        ? `team: blocked by story-${next.storyNumber} task-${next.taskNumber} (${[next.repoName, next.state].filter(Boolean).join(", ")})`
        : "team: no longer blocked",
    );
  }

  async function runTick(): Promise<TickResult> {
    if (store.openClaim()) return { skipped: "open" };

    const recovered = await recover();
    if (recovered) return { recovered };

    if (!d.canExecute()) return { skipped: "locked" };
    const { paused, dailyCap } = store.settings();
    if (paused) return { skipped: "paused" };
    if (dailyCap !== null && store.claimedToday() >= dailyCap) return { skipped: "cap" };
    if (d.busy()) return { skipped: "busy" };
    if (!lanes.some(isReady)) return { skipped: "no-lane" };

    // What the claim replies say is in the way. The Hub holds one open Task per person, so every lane
    // that answers names the same one; a lane that fails to answer says nothing either way.
    let heard = false;
    let open: OpenTaskRef | null = null;
    for (const lane of lanes) {
      // Looked at again for each lane: a lane can stop being ready while an earlier one is asked.
      if (!isReady(lane)) continue;
      const taken = await attempt(lane, "the claim", () => lane.link.claim());
      if (!taken) continue;
      heard = true;
      if (taken.value.task === null) {
        open ??= taken.value.open;
        continue;
      }
      const claim = record(lane, taken.value.task, "claim", "the claim");
      if (claim) {
        setBlockedBy(null);
        return { claimed: claim };
      }
    }
    if (heard) setBlockedBy(open);
    return { claimed: null, open };
  }

  /** The record, if it is still the claim that was sent: an operator may have replaced it while a call was in flight. */
  function still(open: OpenClaim): OpenClaim | null {
    const now = store.openClaim();
    return now && now.taskId === open.taskId && now.claimId === open.claimId ? now : null;
  }

  /** Closes the record as dropped, if it is still the claim that was sent, and tells `onDropped` which record it was. */
  function drop(open: OpenClaim, reason: string, line: string): void {
    const now = still(open);
    if (!now) return;
    store.dropClaim(open.taskId, reason);
    log(line);
    const failed = (error: unknown) =>
      log(`team: ${open.project}: stopping what ran for ${open.taskId} failed (${describeError(error)})`);
    try {
      Promise.resolve(d.onDropped?.(now, reason)).catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  /** A refusal that leaves the record as it is: a line, and a lane that needs the member's attention is taken out of use. */
  function keep(open: OpenClaim, lane: RepoLane, what: string, kind: LinkFailure, error: unknown): void {
    if (kind === "state") {
      log(`team: ${open.project}: ${what} for ${open.taskId} was refused (STATE); the record is kept`);
    } else if (kind === "relink" || kind === "hub-too-old") {
      lane.state = kind;
      log(`team: ${open.project}: ${what} for ${open.taskId} was refused (${describeError(error)}); the repo link needs attention`);
    } else {
      log(`team: ${open.project}: ${what} for ${open.taskId} failed (${describeError(error)}); trying again next cycle`);
    }
  }

  /** A failed call that reports on the open claim. NOT_YOURS means the PL released or cancelled it. NOT_FOUND
   * means the Hub does not know this Task under this link any more (wiped or re-created, the repo linked to
   * another Hub or re-created under a new id). Kept, the record would hold every tick at `open` and `team
   * remove` at OPEN_CLAIM for good; dropped, the next tick takes the claim back if the Hub still reports it.
   * Only calls about the claim itself are read this way: elsewhere a 404 (kind not-found) is retried like any
   * other failure. */
  function answer(open: OpenClaim, lane: RepoLane, what: string, error: unknown): void {
    const kind = classifyLinkError(error);
    if (kind === "not-yours") {
      drop(open, "NOT_YOURS", `team: ${open.project}: ${open.taskId} is no longer this Office's claim (NOT_YOURS); the record was dropped`);
    } else if (kind === "not-found") {
      drop(open, "NOT_FOUND", `team: ${open.project}: the Hub no longer knows ${open.taskId} (NOT_FOUND); the record was dropped`);
    } else {
      keep(open, lane, what, kind, error);
    }
  }

  /** The heartbeat was refused because the Task is no longer this Office's `claimed` Task at the Hub: STATE,
   * this Office already reported it; or NOT_YOURS, the PL released or cancelled it. What the Office still owes the
   * Hub is in the record, read again since the report may have been written while the heartbeat was in flight.
   * A merged report is sent again whichever the answer was: after a release the Hub still takes the late report
   * of the claim that held the merge lock, and after STATE it has the merge already. Either way (`already` or
   * not) the Hub has it then, and the record is done; a resend refused for good (STATE, INVALID, LOCK_REQUIRED)
   * drops the record as HUB_REFUSED_REPORT, as the executor's own send does. With no report, or only a failed one, NOT_YOURS drops the
   * record; so does STATE when nothing is left to send (a failed Task the Hub still lists as this member's comes
   * back from the inbox in phase failed), while a failed report waiting at STATE is the executor's to send. */
  async function settle(open: OpenClaim, lane: RepoLane, link: StoryLink, kind: "state" | "not-yours", error: unknown): Promise<void> {
    const latest = still(open);
    const report = latest?.report;
    if (report === undefined) return; // the record was replaced meanwhile: this answer is not about it
    if (report?.kind !== "merged") {
      if (kind === "not-yours" && latest && d.keepOnNotYours?.(latest)) return keptForNow(latest);
      if (kind === "not-yours") answer(open, lane, "the heartbeat", error);
      else if (report === null) drop(open, "STATE", `team: ${open.project}: ${open.taskId} is already reported to the Hub (STATE) and nothing is left to send; the record was dropped`);
      else keep(open, lane, "the heartbeat", "state", error);
      return;
    }
    const { prUrl, mergeCommit, summary, assumptions } = report;
    try {
      await link.merged({ taskId: open.taskId, claimId: open.claimId, prUrl, mergeCommit, summary, assumptions });
    } catch (resendError) {
      const refusal = classifyLinkError(resendError);
      // Refused for good, as the executor's own send ends: dropped, and the next tick does not take it back.
      if (refusal === "state" || refusal === "invalid" || refusal === "lock")
        drop(
          open,
          "HUB_REFUSED_REPORT",
          `team: ${open.project}: the Hub refused the merged report of ${open.taskId} for good (${describeError(resendError)}; PR ${prUrl}, merge commit ${mergeCommit}); the record was dropped (HUB_REFUSED_REPORT)`,
        );
      else answer(open, lane, "the merged report", resendError);
      return;
    }
    if (still(open)) store.finishClaim(open.taskId);
  }

  /** Claims whose heartbeat NOT_YOURS was let pass under `keepOnNotYours`, so the line goes out once. */
  const keptClaims = new Set<string>();
  function keptForNow(open: OpenClaim): void {
    if (keptClaims.has(open.claimId)) return;
    keptClaims.add(open.claimId);
    log(
      `team: ${open.project}: the heartbeat for ${open.taskId} was answered NOT_YOURS while the record is ${open.phase}; it is kept until the start's first drive settles, which may still report its merge`,
    );
  }

  /** Reads the Task of a failed record to see whether the claim is still this Office's. NOT_YOURS (the PL released
   * or cancelled it) and NOT_FOUND (the Hub does not know it any more) end such a record like any other; any other
   * answer leaves it for the member to rerun. */
  async function watch(open: OpenClaim, lane: RepoLane, link: StoryLink): Promise<void> {
    try {
      await link.task(open.taskId, open.claimId);
    } catch (error) {
      answer(open, lane, "reading the failed Task", error);
    }
  }

  async function runBeat(): Promise<void> {
    const open = store.openClaim();
    if (!open) return;
    const lane = lanes.find((candidate) => candidate.project === open.project);
    // Only the lane's link works for this claim, and a Hub call needs no gh login, so its state is not looked at.
    if (!lane || !lane.link) {
      const doing = open.phase === "failed" ? "check the failed Task" : "send the heartbeat for";
      log(`team: ${open.project}: no repo link to ${doing} ${open.taskId}`);
      return;
    }
    const { link } = lane;
    // A failed Task is the member's open Task at the Hub but takes no heartbeat; the Hub is read instead.
    if (open.phase === "failed") return watch(open, lane, link);
    const stage = d.stageOf(open);
    try {
      await link.heartbeat(open.taskId, open.claimId, stage);
    } catch (error) {
      const kind = classifyLinkError(error);
      if (kind === "state" || kind === "not-yours") await settle(open, lane, link, kind, error);
      else answer(open, lane, "the heartbeat", error);
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
    blockedBy: () => blocked,
  };
}
