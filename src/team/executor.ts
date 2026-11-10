import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OfficeError, fail, noSymlinks } from "../cli/project.ts";
import type { Candidate } from "../core/candidates.ts";
import { PLAN_ROOT } from "../core/contracts.ts";
import { LIMITS, prUrlOf } from "../hub/story-protocol.ts";
import type { ClaimedTask } from "../hub/story-store.ts";
import type { LeanOffice } from "../lean/office.ts";
import type { RunnerAccountProblem } from "../runners/runner-account.ts";
import * as branch from "./branch.ts";
import type { GitEnv } from "./branch.ts";
import * as pulls from "./pr.ts";
import type { GhEnv, PullRequest } from "./pr.ts";
import type { Stage } from "./scheduler.ts";
import { CONFLICT_PATH_MAX, CONFLICT_PATHS_MAX } from "./store.ts";
import type { OpenClaim, TeamStore } from "./store.ts";
import { assumedLines, contractFolder, storySummary, writeStoryContract } from "./story-contract.ts";
import { classifyLinkError } from "./story-link.ts";
import type { StoryLink } from "./story-link.ts";

/** Runs of one claim before the Task is reported failed. The engine's own fix rounds are not counted. */
const MAX_ATTEMPTS = 3;
/** Failures in a row of one step (a refused push, a gh error) before the Task is reported failed. */
const MAX_STEP_FAILURES = 3;
/** An engine task still running this long after it was submitted counts as a failed attempt. */
const BUILD_DEADLINE_MS = 5400000;
/** How long a claim waits before asking for a busy merge lock again. */
const LOCK_RETRY_MS = 30000;
const TITLE_MAX = 200;
/** How long a runner account problem may hold the Task before it is reported failed (D37). */
const RUNNER_WAIT_MAX_MS = 21600000;
/** When an attempt the runner's account stopped runs again, if the runner named no reset time. */
const RUNNER_RETRY_MS = 1800000;
const ACCOUNT_CODES = { limit: "RUNNER_LIMIT", billing: "RUNNER_BILLING", login: "RUNNER_LOGIN", not_ready: "RUNNER_NOT_READY" } as const;
const ACCOUNT_WORDS = { limit: "usage limit", billing: "billing or credits", login: "login" } as const;
/** "Not now", not a failed step: another run, an Office without a runtime or stopping, a cancelled verify. */
const WAITS = new Set(["BUSY", "EXECUTION_LOCKED", "STOPPING", "CANCELLED"]);

/** The host git steps of a Story Task (`branch.ts`), bound to the person's git environment. */
export type BranchOps = {
  ensureCheckout(repo: string, checkout: string): Promise<void>;
  /** `repo` is the registered repo, which the checkout must never be. */
  startTaskBranch(checkout: string, task: { branch: string; storyBase: string; repo?: string }): Promise<{ head: string }>;
  applyCandidate(checkout: string, baseline: Candidate, candidate: Candidate): Promise<unknown>;
  commitAll(checkout: string, message: string): Promise<{ sha: string; changed: boolean }>;
  pushTaskBranch(checkout: string, branch: string, sha: string): Promise<void>;
  mergeStoryBase(checkout: string, storyBase: string): ReturnType<typeof branch.mergeStoryBase>;
  inMerge(checkout: string): boolean;
};

export function branchOps(env: GitEnv): BranchOps {
  return {
    ensureCheckout: (repo, checkout) => branch.ensureCheckout(repo, checkout, env),
    startTaskBranch: (checkout, task) => branch.startTaskBranch(checkout, task, env),
    applyCandidate: (checkout, baseline, candidate) => branch.applyCandidate(checkout, baseline, candidate),
    commitAll: (checkout, message) => branch.commitAll(checkout, message, env),
    pushTaskBranch: (checkout, name, sha) => branch.pushTaskBranch(checkout, name, sha, env),
    mergeStoryBase: (checkout, storyBase) => branch.mergeStoryBase(checkout, storyBase, env),
    inMerge: (checkout) => branch.inMerge(checkout),
  };
}

/** The PR steps of a Story Task (`pr.ts`), bound to the person's gh environment. */
export type PrOps = {
  ensurePr(remote: string, p: { base: string; head: string; title: string; body: string }): Promise<PullRequest>;
  findPr(remote: string, p: { base: string; head: string }): Promise<PullRequest | null>;
  mergePr(remote: string, pr: { number: number; headSha: string }): Promise<{ mergeCommit: string }>;
};

export function prOps(env: GhEnv): PrOps {
  return {
    ensurePr: (remote, p) => pulls.ensurePr(remote, p, env),
    findPr: (remote, p) => pulls.findPr(remote, p, env),
    mergePr: (remote, pr) => pulls.mergePr(remote, pr, env),
  };
}

/** What the executor uses of a repo's Story engine. */
export type StoryEngine = Pick<
  LeanOffice,
  | "submitStoryTask"
  | "storyTaskFor"
  | "storyOutcome"
  | "storyEvidence"
  | "freezeProject"
  | "cancelStoryTask"
  | "verifyCandidate"
>;

export type Executor = {
  /** Takes the open record one phase further, at most. A call while one runs gets that run. Never rejects. */
  drive(): Promise<void>;
  /** A drive is under way, its git and engine steps on a checkout included, even when the record it took was dropped
   * meanwhile (a heartbeat answered NOT_YOURS). */
  busy(): boolean;
  /** The stage the heartbeat reports for the open record. */
  stageOf(open: OpenClaim): Stage;
  /** For the scheduler: a dropped record's own engine task is cancelled (its checkout and branch stay). */
  onDropped(open: OpenClaim, reason: string): Promise<void>;
};

type Facts = { checkout: string; branch: string; storyBase: string; engine: StoryEngine };

/** Code and message of a failure (for a Hub call: status, code and the Hub's own reason) on one line, for the
 * log and a reported reason. */
function describe(error: unknown): string {
  if (error instanceof OfficeError) return `${error.code}: ${firstLine(error.message)}`;
  if (typeof error !== "object" || error === null) return firstLine(String(error));
  const { status, code, message } = error as Record<string, unknown>;
  const head = [status, code].filter((part) => typeof part === "string" || typeof part === "number").join(" ");
  const text = typeof message === "string" ? firstLine(message) : "";
  if (head && text && text !== code) return `${head}: ${text}`;
  return head || text || "unknown error";
}

function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 300);
}

const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));
/** Free text from the Hub as one line for git and gh: no control characters (a NUL could not be passed at all). */
const oneLine = (text: string, max: number) => clip(text.replace(/[\s\x00-\x1f\x7f]+/g, " ").trim(), max);
/** Text the Office writes on GitHub with `@name` mentions made inert (a zero-width joiner after the `@`), so the
 * PL's title or an engineer's ASSUMED line notifies nobody. An address like dev@example.com is not a mention. */
const noMentions = (text: string) => text.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@\u200D");

/**
 * The state machine that runs the Story Task the team Office holds: build, review and verify in the repo's
 * Story engine, then, outside the VM with the person's git and gh, commit, push the Task branch, open the PR,
 * take the Hub merge lock, merge the latest Story base (its checks run again if it moved), merge the PR and
 * report to the Hub. Every step writes the record first and then does its work, and each work step can be done
 * again, so the Office may stop between any two. The timers and the engine settle that call `drive` belong to
 * the caller.
 */
export function createExecutor(d: {
  store: TeamStore;
  engineOf(project: string): StoryEngine;
  linkOf(project: string): StoryLink | null;
  git: BranchOps;
  pr: PrOps;
  checkoutOf(project: string): string;
  /** The repo's `host/owner/repo` as the team registry holds it: where its PRs are. */
  remoteOf(project: string): string;
  agentOf(project: string): string;
  log?: (line: string) => void;
  now?: () => number;
}): Executor {
  const { store, git } = d;
  const now = d.now ?? Date.now;
  const log = (line: string) => {
    try {
      d.log?.(line);
    } catch {
      // nowhere left to say it
    }
  };
  /** Failures in a row of one step of one claim, by `<claimId>:<step>`. Memory only: a restart starts again. */
  const failures = new Map<string, number>();
  /** When a claim may ask again for a merge lock that was busy. */
  const lockWait = new Map<string, number>();
  /** The re-verify in flight, so a drop of its record can stop it. */
  let verifying: { claimId: string; abort: AbortController } | null = null;

  const say = (open: OpenClaim, what: string) =>
    log(`team: ${open.project}: story-${open.task.story?.number} task-${open.task.number}: ${what}`);

  /** The open record, if it is still the claim this step began with: the PL may have taken it meanwhile. */
  function current(open: OpenClaim): OpenClaim | null {
    const latest = store.openClaim();
    return latest && latest.taskId === open.taskId && latest.claimId === open.claimId ? latest : null;
  }

  function forget(claimId: string): void {
    for (const key of failures.keys()) if (key.startsWith(`${claimId}:`)) failures.delete(key);
    lockWait.delete(claimId);
  }

  function facts(open: OpenClaim): Facts {
    const { task } = open;
    const storyBase = task.story?.branches?.find((b) => b.repoId === task.repoId)?.storyBase;
    if (!task.branch || !storyBase)
      fail("INVALID", "The Story Task names no Task branch or Story base for its repo.");
    return { checkout: d.checkoutOf(open.project), branch: task.branch, storyBase, engine: d.engineOf(open.project) };
  }

  const titleOf = (task: ClaimedTask) =>
    [`Story #${task.story.number} Task #${task.number}`, oneLine(task.title, TITLE_MAX)].filter(Boolean).join(": ");

  /** The 3-line summary and the ASSUMED lines of the verified attempt. When the engine can no longer give its
   * evidence, the summary is the Task's title and changed-file count without it, and there are no lines. */
  function recordOf(open: OpenClaim, f: Facts): { summary: string; assumptions: string[] } {
    try {
      const ev = f.engine.storyEvidence(open.engineTask ?? "");
      let files = 0;
      try {
        files = branch.changedFiles(ev.baseline, ev.candidate);
      } catch {
        // the count only fills the summary when the diff evidence is unreadable
      }
      return {
        summary: storySummary(ev.evidence, { title: open.task.title, files }),
        assumptions: assumedLines(ev.engineerOutputs),
      };
    } catch (error) {
      say(open, `the engine's record of the change could not be read (${describe(error)}); the summary goes without it`);
      return { summary: storySummary(null, { title: open.task.title, files: 0 }), assumptions: [] };
    }
  }

  function prRequest(open: OpenClaim, f: Facts) {
    const { summary, assumptions } = recordOf(open, f);
    const body = [
      summary,
      assumptions.join("\n"),
      `Hub Story #${open.task.story.number} Task #${open.task.number}: ${f.branch} into ${f.storyBase}.`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\0/g, "");
    return { base: f.storyBase, head: f.branch, title: noMentions(titleOf(open.task)), body: noMentions(body) };
  }

  /** Sends the merge unlock a failed attempt owes the Hub, on every drive until the Hub confirms it, so the
   * other Tasks of the Story and repo are not held up for a whole attempt. Not while the Task merges (it holds
   * the lock again then, which settles the debt) and never before a merged report (that report needs the
   * lock). A failure is only logged: it is not a failed step. An answer that the lock is not this claim's to
   * give (released, cancelled, already reported) settles it too. */
  async function settleUnlock(open: OpenClaim): Promise<void> {
    if (!open.unlockOwed || open.phase === "verified" || open.phase === "merging" || open.report?.kind === "merged") return;
    const link = d.linkOf(open.project);
    if (!link) return;
    try {
      await link.mergeUnlock(open.taskId, open.claimId);
    } catch (error) {
      const kind = classifyLinkError(error);
      if (kind !== "not-yours" && kind !== "state" && kind !== "not-found")
        return say(open, `giving the merge lock back failed (${describe(error)}); trying again next cycle`);
      say(open, `the Hub holds no merge lock of this claim to give back (${describe(error)})`);
    }
    if (current(open)) store.setPhase(open.taskId, open.phase, { unlockOwed: false });
  }

  /** One attempt ended without a merge. The next starts from implementation with this reason in its contract;
   * after the third, the Task is reported failed. A held merge lock is owed back, in the same write, and sent
   * right away; `settleUnlock` sends it again until the Hub has it. */
  async function failAttempt(open: OpenClaim, reason: string, conflict: string[], lockHeld: boolean): Promise<void> {
    if (!current(open)) return;
    const attempts = open.attempts + 1;
    const lastFailure = {
      reason: clip(reason, LIMITS.failureReasonMax),
      conflict: conflict.slice(0, CONFLICT_PATHS_MAX).map((path) => clip(path, CONFLICT_PATH_MAX)),
    };
    const owed = lockHeld ? { unlockOwed: true } : {};
    if (attempts < MAX_ATTEMPTS) {
      // A counted attempt ends any runner wait: the next one starts afresh.
      store.setPhase(open.taskId, "claimed", { attempts, lastFailure, buildingSince: null, runnerWait: null, ...owed });
      say(open, `attempt ${attempts} of ${MAX_ATTEMPTS} failed (${firstLine(reason)}); starting again from implementation`);
    } else {
      store.setReport(open.taskId, { kind: "failed", reason: lastFailure.reason });
      store.setPhase(open.taskId, "reporting", { attempts, lastFailure, buildingSince: null, runnerWait: null, ...owed });
      say(open, `attempt ${attempts} of ${MAX_ATTEMPTS} failed (${firstLine(reason)}); reporting the Task as failed`);
    }
    forget(open.claimId);
    const after = current(open);
    if (after) await settleUnlock(after);
  }

  /** A person closed the Task's PR without merging it: their way to stop the automatic merge (the Office never
   * closes a PR). The Task is reported failed at once, not as an attempt, and no PR is opened over the closed one;
   * the failed report also frees a held merge lock. After the person reopens the PR, `team rerun` goes on with it;
   * the PL can cancel the Task instead. */
  function prClosed(open: OpenClaim, pr: PullRequest): void {
    if (!current(open)) return;
    const reason = `PR #${pr.number} was closed on GitHub; reopen it, then run team rerun`;
    store.setReport(open.taskId, { kind: "failed", reason });
    store.setPhase(open.taskId, "reporting", { buildingSince: null });
    forget(open.claimId);
    say(open, `${reason}; reporting the Task as failed`);
  }

  /** The run stopped on its runner's account, or on a runner that was not ready, not on the work (D37, D39): no
   * attempt is counted, and the same attempt runs again at the runner's reset time, else after RUNNER_RETRY_MS,
   * never later than RUNNER_WAIT_MAX_MS after the first such stop. One at or past that is reported failed with the
   * runner's own words or the Office's hint. */
  function waitForRunner(open: OpenClaim, problem: RunnerAccountProblem): void {
    if (!current(open)) return;
    const at = now();
    const since = open.runnerWait?.since ?? at;
    const { runner, kind, message } = problem;
    const what =
      kind === "not_ready" ? `${runner} is not ready (${message})` : `${runner} account problem (${ACCOUNT_WORDS[kind]}: ${message})`;
    if (at - since >= RUNNER_WAIT_MAX_MS) {
      store.setReport(open.taskId, { kind: "failed", reason: clip(`${ACCOUNT_CODES[kind]} ${runner}: ${message}`, LIMITS.failureReasonMax) });
      store.setPhase(open.taskId, "reporting", { buildingSince: null, runnerWait: null });
      forget(open.claimId);
      return say(open, `${what} for ${RUNNER_WAIT_MAX_MS / 3600000} hours; reporting the Task as failed`);
    }
    const reset = problem.resetsAt !== null && problem.resetsAt > at ? problem.resetsAt : at + RUNNER_RETRY_MS;
    const retryAt = Math.min(reset, since + RUNNER_WAIT_MAX_MS);
    const runs = (open.runnerWait?.runs ?? 0) + 1;
    store.setPhase(open.taskId, "claimed", { buildingSince: null, runnerWait: { runner, kind, message, since, retryAt, runs } });
    say(open, `${what}; not counted as an attempt; running it again at ${new Date(retryAt).toISOString()}`);
  }

  /** claimed: the checkout on the Task branch, this attempt's contract, and the engine task built from it. A
   * runner account problem is waited out first. */
  async function prepare(open: OpenClaim): Promise<void> {
    if (open.runnerWait && now() < open.runnerWait.retryAt) return;
    const f = facts(open);
    const { task } = open;
    // The engine already took this attempt (the Office stopped before it wrote building): carry on with it.
    // The record keeps the engine task of a failed attempt, so that one is never taken for the next.
    const submitted = f.engine.storyTaskFor(open.taskId, open.claimId);
    if (submitted !== null && submitted !== open.engineTask) {
      // The submit time was written just before that submit: the build clock goes on from it.
      store.setPhase(open.taskId, "building", { engineTask: submitted, buildingSince: open.buildingSince ?? now() });
      say(open, `carrying on with engine task ${submitted}, submitted before a restart`);
      return;
    }
    await git.ensureCheckout(open.project, f.checkout);
    // Keeps a merge in progress on this branch: the attempt after a conflict resolves it.
    await git.startTaskBranch(f.checkout, { branch: f.branch, storyBase: f.storyBase, repo: open.project });
    const attempt = open.attempts + 1;
    // A run again after a runner account problem gets its own folder; the refused run's stays.
    const run = open.runnerWait?.runs ?? 0;
    removeUnsubmitted(f.checkout, task, attempt, run);
    // Attempt 1 after a rerun gets the Hub's last failure and memo from the Task itself.
    const failure =
      attempt > 1
        ? {
            reason: open.lastFailure?.reason ?? "An earlier attempt failed.",
            memo: task.lastFailure?.memo ?? null,
            conflict: open.lastFailure?.conflict ?? [],
          }
        : null;
    const input = writeStoryContract(f.checkout, task, attempt, failure, run);
    if (!current(open)) return;
    // On file before the submit, so a restart that adopts this engine task keeps its build clock.
    const submittedAt = now();
    store.setPhase(open.taskId, "claimed", { buildingSince: submittedAt });
    const id = await f.engine.submitStoryTask(input, {
      hubTaskId: open.taskId,
      claimId: open.claimId,
      agentId: d.agentOf(open.project),
      g1Note: `Hub Story #${task.story.number} opened by its PL; Story Task #${task.number} claim ${open.claimId.slice(0, 8)}`,
    });
    if (!current(open)) {
      // Dropped while it was being submitted: onDropped knew only the engine task before this one.
      await f.engine.cancelStoryTask(id).catch(() => {});
      return;
    }
    store.setPhase(open.taskId, "building", { engineTask: id, buildingSince: submittedAt });
    say(open, `attempt ${attempt} of ${MAX_ATTEMPTS} is building (engine task ${id})`);
  }

  /** A folder of this run with no engine task behind it: the Office stopped while writing it. */
  function removeUnsubmitted(checkout: string, task: ClaimedTask, attempt: number, run: number): void {
    if (!Number.isSafeInteger(task.story?.number) || !Number.isSafeInteger(task.number)) return;
    const plans = join(realpathSync(checkout), PLAN_ROOT);
    noSymlinks(plans);
    rmSync(join(plans, contractFolder(task.story.number, task.number, attempt, run)), { recursive: true, force: true });
  }

  /** building: waits for the engine; a verified change is committed, pushed and put up as the PR. */
  async function build(open: OpenClaim): Promise<void> {
    const f = facts(open);
    const id = open.engineTask;
    if (!id) return failAttempt(open, "The engine task of this attempt is not on record.", [], false);
    const outcome = f.engine.storyOutcome(id);
    if (outcome.kind === "running") {
      if (open.buildingSince === null) {
        store.setPhase(open.taskId, "building", { buildingSince: now() });
        return;
      }
      if (now() - open.buildingSince <= BUILD_DEADLINE_MS) return;
      await f.engine.cancelStoryTask(id);
      return failAttempt(open, `BUILD_TIMEOUT: engine task ${id} ran for more than ${BUILD_DEADLINE_MS / 60000} minutes.`, [], false);
    }
    if (outcome.kind === "stopped" && outcome.runnerAccount) return waitForRunner(open, outcome.runnerAccount);
    // The runner got through: a wait it ended is over.
    if (open.runnerWait) store.setPhase(open.taskId, "building", { runnerWait: null });
    if (outcome.kind === "stopped") return failAttempt(open, outcome.reason, [], false);
    // Read before anything touches the attempt's contract folder: the engine checks it to keep its conclusion.
    const ev = f.engine.storyEvidence(id);
    await git.applyCandidate(f.checkout, ev.baseline, ev.candidate);
    let sha: string;
    try {
      ({ sha } = await git.commitAll(f.checkout, titleOf(open.task)));
    } catch (error) {
      // The change kept a conflict's markers: like the conflict itself it costs an attempt, and the next one gets
      // the files (the merge stays in progress for it).
      if (error instanceof branch.ConflictMarkers)
        return failAttempt(open, `The verified change still holds conflict markers in ${error.files.length} file(s).`, error.files, false);
      throw error;
    }
    if (!current(open)) return;
    await git.pushTaskBranch(f.checkout, f.branch, sha);
    // What was checked and pushed: the merge goes ahead only at this head.
    if (!current(open)) return;
    store.setPhase(open.taskId, "building", { pushedSha: sha });
    const pr = await d.pr.ensurePr(d.remoteOf(open.project), prRequest(open, f));
    if (pr.state === "CLOSED") return prClosed(open, pr);
    if (!current(open)) return;
    store.setPhase(open.taskId, "verified");
    say(open, `verified; pushed ${sha.slice(0, 12)} to ${f.branch}, PR ${pr.url}`);
  }

  /** Asks the Hub for the claim's merge lock: true when the claim holds it (the Hub grants it again while it is
   * held, so asking twice is safe). Any other answer is dealt with here: NOT_YOURS (the PL released or cancelled
   * the claim) goes to the late report, a busy lock is asked for again after LOCK_RETRY_MS, anything else next
   * cycle. */
  async function holdLock(open: OpenClaim, link: StoryLink, f: Facts, remote: string): Promise<boolean> {
    let lock: { granted: boolean; holder: number | null };
    try {
      lock = await link.mergeLock(open.taskId, open.claimId);
    } catch (error) {
      if (classifyLinkError(error) === "not-yours") await lateReport(open, f, remote, error);
      else say(open, `asking for the merge lock failed (${describe(error)}); trying again next cycle`);
      return false;
    }
    const latest = current(open);
    if (!latest) return false;
    if (!lock.granted) {
      if (latest.phase === "verified") store.setPhase(open.taskId, "merging");
      lockWait.set(open.claimId, now() + LOCK_RETRY_MS);
      say(open, `the merge lock is held by task-${lock.holder ?? "?"}; asking again in ${LOCK_RETRY_MS / 1000} s`);
      return false;
    }
    lockWait.delete(open.claimId);
    return true;
  }

  /** verified, merging: with the Hub merge lock, the latest Story base goes into the Task branch (checked again
   * if it moved), and the PR is merged. A busy lock is asked for again after LOCK_RETRY_MS, with no gh call
   * meanwhile. The lock comes first: a merged report needs it, unless the claim is gone (see `lateReport`). */
  async function merge(open: OpenClaim): Promise<void> {
    const link = d.linkOf(open.project);
    if (!link) return say(open, "no repo link to ask for the merge lock");
    const wait = lockWait.get(open.claimId);
    if (wait !== undefined && now() < wait) return;
    const f = facts(open);
    const remote = d.remoteOf(open.project);
    if (!(await holdLock(open, link, f, remote))) return;
    // Held again, so an unlock an earlier attempt still owed is settled: the merge (or its failure) gives it back.
    store.setPhase(open.taskId, "merging", { unlockOwed: false });
    // Merged already (a stop after the merge, or a person merged it on GitHub): reported with the lock held,
    // never merged again.
    const pr = await d.pr.ensurePr(remote, prRequest(open, f));
    if (pr.state === "MERGED")
      return pr.mergeCommit
        ? reportMerged(open, f, remote, pr, pr.mergeCommit)
        : say(open, `PR #${pr.number} is merged but GitHub names no merge commit yet; asking again next cycle`);
    if (pr.state === "CLOSED") return prClosed(open, pr);
    // The Office stopped right after a conflict, before it wrote the failed attempt.
    if (git.inMerge(f.checkout))
      return failAttempt(open, `Merging ${f.storyBase} into the Task branch left a conflict.`, [], true);
    // Back to what was pushed: a base merge that was neither verified nor pushed before a stop is done again.
    const { head } = await git.startTaskBranch(f.checkout, { branch: f.branch, storyBase: f.storyBase, repo: open.project });
    // A commit someone else pushed meanwhile (a suggestion accepted on the PR, a bot, a teammate) was never
    // checked: the next attempt starts from it and its engine checks it.
    if (head !== open.pushedSha)
      return failAttempt(open, `the Task branch moved outside the Office: ${head.slice(0, 12)}`, [], true);
    const base = await git.mergeStoryBase(f.checkout, f.storyBase);
    if (base.kind === "conflict")
      return failAttempt(
        open,
        `Merging ${f.storyBase} into the Task branch conflicted in ${base.files.length} file(s).`,
        base.files,
        true,
      );
    let headSha = head;
    if (base.kind === "merged") {
      const failed = await reverify(open, f);
      if (!current(open)) return;
      if (failed) {
        // The failed attempt is on file before its merge goes anywhere: a restart must never find this record
        // merging with an unchecked head on origin. The push then only lets the next attempt start from the
        // Task branch with the base merged; if it fails, that attempt starts from the head before the merge.
        await failAttempt(open, failed, [], true);
        // Giving the lock back awaited the Hub: a record dropped meanwhile gets nothing pushed.
        if (!current(open)) return;
        try {
          await git.pushTaskBranch(f.checkout, f.branch, base.sha);
        } catch (error) {
          return say(open, `pushing the merged ${f.storyBase} for the next attempt failed (${describe(error)}); it starts without it`);
        }
        const after = current(open);
        if (after) store.setPhase(after.taskId, after.phase, { pushedSha: base.sha });
        return;
      }
      await git.pushTaskBranch(f.checkout, f.branch, base.sha);
      if (!current(open)) return;
      store.setPhase(open.taskId, "merging", { pushedSha: base.sha });
      headSha = base.sha;
    }
    if (!current(open)) return;
    // The PL may have cancelled or released the claim since the lock was granted (the checks above can take their
    // whole time limits, and no heartbeat answer reaches this run): a release also frees the lock for another Task
    // of the Story and repo. So the lock is asked for again right before the merge.
    if (!(await holdLock(open, link, f, remote))) return;
    const { mergeCommit } = await d.pr.mergePr(remote, { number: pr.number, headSha });
    return reportMerged(open, f, remote, pr, mergeCommit);
  }

  /** The merge lock was refused because the claim is no longer this Office's (the PL released it). A PR this
   * Office merged before that still counts: the Hub takes the late report of the claim that held the lock. The
   * PR is only looked up (a claim that is not this Office's opens none); unmerged, the record is left to the
   * scheduler, which drops it on the same answer. */
  async function lateReport(open: OpenClaim, f: Facts, remote: string, error: unknown): Promise<void> {
    const pr = await d.pr.findPr(remote, { base: f.storyBase, head: f.branch });
    if (pr?.state === "MERGED" && pr.mergeCommit) return reportMerged(open, f, remote, pr, pr.mergeCommit);
    if (pr?.state === "MERGED")
      return say(open, `the merge lock was refused (${describe(error)}) and PR #${pr.number} is merged but GitHub names no merge commit yet; asking again next cycle`);
    say(open, `the merge lock was refused (${describe(error)}) and the PR is not merged; the record is no longer this Office's`);
  }

  /** The Task's checks again, in the engine, on the checkout with the base merged. The reason when one did not
   * pass, else null. */
  async function reverify(open: OpenClaim, f: Facts): Promise<string | null> {
    const candidate = await f.engine.freezeProject();
    // Numbered as the contract numbers them: the Hub's own ids are not trusted to be unique.
    const checks = open.task.verify.map((check, i) => ({ id: `V${i + 1}`, argv: check.argv, timeoutMs: check.timeoutMs }));
    const abort = new AbortController();
    verifying = { claimId: open.claimId, abort };
    let results: Awaited<ReturnType<StoryEngine["verifyCandidate"]>>;
    try {
      results = await f.engine.verifyCandidate(candidate, checks, abort.signal);
    } finally {
      if (verifying?.abort === abort) verifying = null;
    }
    const failed = results.filter((result) => result.verdict !== "pass");
    if (!failed.length) return null;
    return [
      `Re-verification after merging ${f.storyBase} failed: ${failed.map((r) => `${r.id} ${r.verdict}`).join(", ")}`,
      ...failed.map((r) => `[${r.id}] ${r.output.trim()}`),
    ].join("\n");
  }

  /** The PR's address as the Hub takes it (`prUrlOf`): GitHub's own, or else the https address of the registry's
   * `host/owner/repo` and the PR number, so a report is never refused for its address. */
  function prUrlFor(open: OpenClaim, remote: string, pr: PullRequest): string {
    const given = prUrlOf(pr.url);
    if (given) return given;
    const built = prUrlOf(`https://${remote}/pull/${pr.number}`);
    if (!built) return fail("INVALID", `PR #${pr.number} has no address the Hub takes.`);
    say(open, `GitHub's address of PR #${pr.number} is not one the Hub takes (${oneLine(pr.url, 200)}); reporting ${built}`);
    return built;
  }

  function reportMerged(open: OpenClaim, f: Facts, remote: string, pr: PullRequest, mergeCommit: string): void {
    if (!current(open)) return;
    const prUrl = prUrlFor(open, remote, pr);
    const { summary, assumptions } = recordOf(open, f);
    // The report is written before the phase: a stop between the two finds the PR merged and writes it again.
    store.setReport(open.taskId, { kind: "merged", prUrl, mergeCommit, summary, assumptions });
    store.setPhase(open.taskId, "reporting");
    forget(open.claimId);
    say(open, `merged ${prUrl} as ${mergeCommit.slice(0, 12)}; reporting it to the Hub`);
  }

  /** A report the Hub answered with a refusal. Network trouble or a link to fix keeps it for the next drive;
   * any other answer is final, and the record is closed (the PR, if merged, stays merged). */
  function refused(open: OpenClaim, what: string, error: unknown, about: string): void {
    const kind = classifyLinkError(error);
    if (kind === "retry" || kind === "relink" || kind === "hub-too-old")
      return say(open, `sending the ${what} failed (${describe(error)}); it is kept and sent again`);
    if (!current(open)) return;
    const reason = kind === "not-yours" ? "NOT_YOURS" : kind === "not-found" ? "NOT_FOUND" : "HUB_REFUSED_REPORT";
    store.dropClaim(open.taskId, reason);
    forget(open.claimId);
    // The Hub still lists a HUB_REFUSED_REPORT claim as this member's; the scheduler does not take it back.
    say(open, `the Hub refused the ${what} for good (${describe(error)}; ${about}); the record was dropped (${reason})`);
  }

  /** reporting: the report waiting in the record goes to the Hub until it takes it. */
  async function report(open: OpenClaim): Promise<void> {
    const r = open.report;
    if (!r) return say(open, "the record is reporting but holds no report");
    const link = d.linkOf(open.project);
    if (!link) return say(open, "no repo link to send the report; it is kept");
    if (r.kind === "merged") {
      let reply: { already: boolean; ready: number[] };
      try {
        const { prUrl, mergeCommit, summary, assumptions } = r;
        reply = await link.merged({ taskId: open.taskId, claimId: open.claimId, prUrl, mergeCommit, summary, assumptions });
      } catch (error) {
        return refused(open, "merged report", error, `PR ${r.prUrl}, merge commit ${r.mergeCommit}`);
      }
      if (!current(open)) return;
      store.finishClaim(open.taskId);
      forget(open.claimId);
      const ready = reply.ready.length ? `; ready now: ${reply.ready.map((n) => `task-${n}`).join(", ")}` : "";
      return say(open, `the Hub has the merge${reply.already ? " (sent before)" : ""}${ready}`);
    }
    try {
      await link.failed(open.taskId, open.claimId, r.reason);
    } catch (error) {
      return refused(open, "failed report", error, `reason: ${firstLine(r.reason)}`);
    }
    if (!current(open)) return;
    // The Hub frees a held merge lock with the failed report, so no unlock is owed any more.
    store.setPhase(open.taskId, "failed", { unlockOwed: false });
    store.setReport(open.taskId, null);
    forget(open.claimId);
    say(open, 'reported failed to the Hub; it runs again after pazmo-office team rerun --memo "<memo>"');
  }

  /** failed: a member's rerun request goes to the Hub, and its new claim replaces the record. */
  async function rerun(open: OpenClaim): Promise<void> {
    const memo = open.rerunMemo;
    if (memo === null) return;
    const link = d.linkOf(open.project);
    if (!link) return say(open, "no repo link to ask for the rerun; the request is kept");
    let task: ClaimedTask;
    try {
      task = await link.rerun(open.taskId, memo);
    } catch (error) {
      const kind = classifyLinkError(error);
      if (kind === "invalid") {
        store.takeRerun(open.taskId);
        return say(open, `the Hub refused the rerun memo (${describe(error)}); ask again with another memo`);
      }
      const recovered = kind === "state" ? await rerunTaken(open, link) : null;
      if (!recovered) return say(open, `asking the Hub for the rerun failed (${describe(error)}); the request is kept`);
      task = recovered;
    }
    if (!current(open)) return;
    store.replaceClaim(open.taskId, task);
    forget(open.claimId);
    say(open, `running again under a new claim${memo ? " with the member's memo" : ""}`);
  }

  /** A rerun the Hub already took (the reply was lost): its new claim is this member's open Task. */
  async function rerunTaken(open: OpenClaim, link: StoryLink): Promise<ClaimedTask | null> {
    try {
      const { mine } = await link.inbox();
      if (!mine || mine.taskId !== open.taskId || mine.state !== "claimed" || mine.claimId === open.claimId) return null;
      return await link.task(open.taskId, mine.claimId);
    } catch (error) {
      say(open, `reading the rerun the Hub may have taken failed (${describe(error)})`);
      return null;
    }
  }

  const STEPS: Record<OpenClaim["phase"], { name: string; key: string }> = {
    claimed: { name: "preparing the attempt", key: "prepare" },
    building: { name: "handing over the verified change", key: "build" },
    verified: { name: "merging", key: "merge" },
    merging: { name: "merging", key: "merge" },
    reporting: { name: "reporting", key: "report" },
    failed: { name: "running again", key: "rerun" },
  };

  /** A step that threw. A wait is only logged; anything else counts toward MAX_STEP_FAILURES in a row, after
   * which the Task is reported failed with the last reason (the report also frees a held merge lock). The
   * report and rerun steps never end the Task this way: a merged report must never turn into a failed one. */
  function stepFailed(open: OpenClaim, error: unknown): void {
    const step = STEPS[open.phase];
    const code = error instanceof OfficeError ? error.code : null;
    if (code !== null && WAITS.has(code)) return say(open, `${step.name} waits (${describe(error)})`);
    const key = `${open.claimId}:${step.key}`;
    const count = (failures.get(key) ?? 0) + 1;
    if (count < MAX_STEP_FAILURES || open.phase === "reporting" || open.phase === "failed") {
      failures.set(key, count);
      return say(open, `${step.name} failed (${describe(error)}); trying again next cycle`);
    }
    if (!current(open)) return;
    const reason = clip(`${step.name} failed ${count} times in a row: ${describe(error)}`, LIMITS.failureReasonMax);
    store.setReport(open.taskId, { kind: "failed", reason });
    store.setPhase(open.taskId, "reporting", { buildingSince: null });
    forget(open.claimId);
    say(open, `${reason}; reporting the Task as failed`);
  }

  async function step(): Promise<void> {
    let open: OpenClaim | null = null;
    try {
      open = store.openClaim();
      if (!open) return;
      await settleUnlock(open);
      open = current(open);
      if (!open) return;
      const phase = open.phase;
      if (phase === "claimed") await prepare(open);
      else if (phase === "building") await build(open);
      else if (phase === "verified" || phase === "merging") await merge(open);
      else if (phase === "reporting") await report(open);
      else await rerun(open);
      failures.delete(`${open.claimId}:${STEPS[phase].key}`);
    } catch (error) {
      if (!open) return log(`team: reading the open Task failed (${describe(error)})`);
      try {
        stepFailed(open, error);
      } catch (writeError) {
        say(open, `recording a failure failed (${describe(writeError)})`);
      }
    }
  }

  let running: Promise<void> | null = null;
  return {
    drive() {
      running ??= step().finally(() => {
        running = null;
      });
      return running;
    },
    busy: () => running !== null,
    stageOf(open) {
      if (open.phase === "verified" || open.phase === "merging" || open.phase === "reporting") return "merge";
      if (open.phase === "building" && open.engineTask) {
        try {
          const outcome = d.engineOf(open.project).storyOutcome(open.engineTask);
          if (outcome.kind === "running") return outcome.stage;
        } catch {
          // an engine that cannot say is still building, as far as the Hub needs to know
        }
      }
      return "build";
    },
    async onDropped(open, reason) {
      if (verifying?.claimId === open.claimId) verifying.abort.abort();
      forget(open.claimId);
      const id = open.engineTask;
      if (!id) return;
      try {
        await d.engineOf(open.project).cancelStoryTask(id);
        say(open, `dropped (${reason}); engine task ${id} was cancelled, the checkout and branch are kept`);
      } catch (error) {
        say(open, `dropped (${reason}); cancelling engine task ${id} failed (${describe(error)})`);
      }
    },
  };
}
