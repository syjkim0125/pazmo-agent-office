import { OfficeError } from "../cli/project.ts";
import type { FinishReport, FinishView } from "../hub/story-store.ts";
import type { PullRequest } from "./pr.ts";
import { describe, storyCheckSummary } from "./story-check.ts";
import type { CheckLane } from "./story-check.ts";
import type { StoryLink } from "./story-link.ts";

/** A registered repo as the merge uses it: a Story check lane and the repo's `host/owner/repo`, where its PRs are. */
export type FinishLane = CheckLane & { remote: string };

export type FinishGit = {
  /** `branch.prepareStoryMerge`: the Story base readied on the Office checkout for its merge. */
  prepare(
    checkout: string,
    task: { storyBase: string; baseBranch: string; verified: string; repo?: string },
  ): Promise<{ kind: "moved" } | { kind: "current"; head: string; check: boolean } | { kind: "merged"; head: string } | { kind: "conflict"; head: string; files: string[] }>;
  /** The origin's Story base tip now (`branch.storyBaseTip`), or null without one. */
  tip(checkout: string, storyBase: string): Promise<string | null>;
};
export type FinishPr = {
  /** `pr.ensureStoryPr`, `pr.viewStoryPr` and `pr.mergeStoryPr`, bound to the person's gh. */
  ensure(remote: string, p: { base: string; head: string; headSha: string; title: string; body: string }): Promise<PullRequest>;
  view(remote: string, number: number): Promise<Pick<PullRequest, "state" | "mergeCommit">>;
  merge(remote: string, pr: { number: number; headSha: string }): Promise<{ mergeCommit: string }>;
};
export type StoryFinisher = { tick(): Promise<{ ran: boolean }>; active(): boolean; stop(): void };

/** Errors that mean "not now": another run, an Office stopping, a cancelled verify. */
const WAITS = new Set(["BUSY", "EXECUTION_LOCKED", "STOPPING", "CANCELLED"]);
class NotNow extends Error {}
/** The approval ended or the Story went back to its check: nothing more for it this tick. */
class Ended extends Error {}
const codeOf = (error: unknown) => (error instanceof OfficeError ? error.code : (error as { code?: unknown } | null)?.code);

/**
 * The PL Office's merge of a locally approved Story (D48). On each tick it reads the Stories its PL approved
 * (`finishReady`) and, repo by repo, in the Story's order:
 * - a repo merged already is skipped; a PR this Office opened or handed is read first: merged is reported merged,
 *   closed without merging ends the approval (`closed`), and a handed PR still open waits for its person;
 * - otherwise the Story base is readied (`git.prepare`): moved after its check sends the Story back to its check
 *   (`reverify`); a conflict opens the PR and hands it to a person; base branch commits that came in are checked
 *   again in the VM first, and a failure reopens the Story (`failed`);
 * - then the Story base → base branch PR is opened (`opened`) and merged with the PL's gh on the checked commit
 *   (`merged`); a refused merge (a protection rule, a required review) hands it to a person (`handed`).
 * Once every repo is merged it reports `done`. A git, gh, VM or Hub failure is said in the log and tried again next
 * tick; the Hub's records make each step safe to do again. The timer that calls `tick` is the caller's.
 */
export function createStoryFinisher(d: {
  lanes(): FinishLane[];
  /** Whether a merge may run now (live, runners ready, no open Task record, no run, not stopping). */
  canRun(): boolean;
  git: FinishGit;
  pr: FinishPr;
  log?: (line: string) => void;
}): StoryFinisher {
  const log = (line: string) => {
    try {
      d.log?.(line);
    } catch {
      // nowhere left to say it
    }
  };
  /** The last line said for each Story, so a wait that lasts (a handed PR) is said once. */
  const said = new Map<string, string>();
  const sayOnce = (storyId: string, line: string) => {
    if (said.get(storyId) === line) return;
    said.set(storyId, line);
    log(line);
  };
  let running: { abort: AbortController } | null = null;
  let stopped = false;
  /** The last problem reported to the Hub for each Story, so the same one is posted once. */
  const problems = new Map<string, string>();

  /** Re-checks one repo's Story base on its checkout after base branch commits came in; the failure summary, or null. */
  async function recheck(lane: FinishLane, view: FinishView, head: string, signal: AbortSignal): Promise<string | null> {
    const checks = view.checks[lane.repoId] ?? [];
    if (!checks.length) return null;
    const candidate = await lane.engine.freezeProject();
    const unique = new Set(checks.map((c) => c.id)).size === checks.length;
    const results = await lane.engine.verifyCandidate(
      candidate,
      checks.map((c, i) => ({ id: unique ? c.id : `V${i + 1}`, argv: c.argv, timeoutMs: c.timeoutMs })),
      signal,
    );
    const { passed, summary } = storyCheckSummary([{ repo: lane.repoName, head, checks: results }]);
    return passed ? null : summary;
  }

  /** Takes an approved Story one step further at most per repo; whether git, gh or the VM ran. */
  async function finish(via: StoryLink, storyId: string, signal: AbortSignal): Promise<boolean> {
    const view = await via.finishView(storyId);
    if (view.state !== "awaiting_g4" || !view.approval) return false;
    const name = `story-${view.number}`;
    const report = async (r: FinishReport) => via.finishReport(view.storyId, r);
    const lanes = d.lanes();
    let acted = false;
    let waiting: string[] = [];
    for (const b of view.branches) {
      if (signal.aborted) throw new NotNow("stopping");
      const rec = view.repos[b.repoId];
      if (rec?.state === "merged") continue;
      const lane = lanes.find((l) => l.repoId === b.repoId);
      if (!lane) {
        waiting.push(`${b.repoName}: not on this Office, so it cannot be merged here`);
        continue;
      }
      if (rec) {
        const pr = await d.pr.view(lane.remote, rec.prNumber);
        if (pr.state === "MERGED") {
          if (!pr.mergeCommit) {
            waiting.push(`${b.repoName}: PR #${rec.prNumber} is merged but GitHub names no merge commit yet`);
            continue;
          }
          await report({ kind: "repo", repoId: b.repoId, state: "merged", prNumber: rec.prNumber, prUrl: rec.prUrl, mergeCommit: pr.mergeCommit, reason: null });
          log(`team: ${name}: ${b.repoName} is merged (PR #${rec.prNumber})`);
          continue;
        }
        if (pr.state === "CLOSED") {
          await report({ kind: "closed", repoId: b.repoId, prNumber: rec.prNumber });
          log(`team: ${name}: PR #${rec.prNumber} of ${b.repoName} was closed without merging; the Story waits for the PL's approval again`);
          throw new Ended();
        }
        if (rec.state === "handed") {
          waiting.push(`${b.repoName}: PR #${rec.prNumber} waits for a person`);
          continue;
        }
      }
      const verified = view.verified?.[b.repoId];
      if (!verified) {
        await report({ kind: "reverify", reason: `${b.repoName}의 검증 커밋이 없어 Story 검증을 다시 합니다.` });
        throw new Ended();
      }
      acted = true;
      const prep = await d.git.prepare(lane.checkout, { storyBase: b.storyBase, baseBranch: b.baseBranch, verified, repo: lane.project });
      if (prep.kind === "moved") {
        await report({ kind: "reverify", reason: `${b.repoName}의 Story base가 검증 뒤에 바뀌어 Story 검증을 다시 합니다.` });
        log(`team: ${name}: the Story base of ${b.repoName} moved after its check; the Story is checked again`);
        throw new Ended();
      }
      if (prep.kind !== "conflict" && (prep.kind === "merged" || prep.check)) {
        const failure = await recheck(lane, view, prep.head, signal);
        if (failure) {
          await report({ kind: "failed", reason: `${b.repoName}: 기준 브랜치(${b.baseBranch})를 합친 뒤 Story 검사가 실패했습니다.\n${failure}` });
          log(`team: ${name}: the Story checks of ${b.repoName} failed after merging ${b.baseBranch}; the Story is open again`);
          throw new Ended();
        }
      }
      const pr = await d.pr.ensure(lane.remote, {
        base: b.baseBranch,
        head: b.storyBase,
        headSha: prep.head,
        title: `Story #${view.number}: ${view.title}`.slice(0, 200),
        body: `PL이 결과를 승인한 Story #${view.number}의 Story base를 ${b.baseBranch}에 머지합니다(Pazmo Office).`,
      });
      if (prep.kind === "conflict") {
        const reason = `충돌: ${prep.files.slice(0, 20).join(", ")}`;
        await report({ kind: "repo", repoId: b.repoId, state: "handed", prNumber: pr.number, prUrl: pr.url, mergeCommit: null, reason });
        log(`team: ${name}: ${b.repoName} conflicts with ${b.baseBranch}; PR #${pr.number} is handed to a person`);
        continue;
      }
      if (!rec || rec.prNumber !== pr.number)
        await report({ kind: "repo", repoId: b.repoId, state: "opened", prNumber: pr.number, prUrl: pr.url, mergeCommit: null, reason: null });
      // The approval is read again right before the merge: Tasks added since (the Story reopened) end it (D48).
      const still = await via.finishView(view.storyId);
      if (still.state !== "awaiting_g4" || !still.approval || still.approval.recordHash !== view.approval.recordHash) throw new Ended();
      try {
        const { mergeCommit } = await d.pr.merge(lane.remote, { number: pr.number, headSha: prep.head });
        await report({ kind: "repo", repoId: b.repoId, state: "merged", prNumber: pr.number, prUrl: pr.url, mergeCommit, reason: null });
        log(`team: ${name}: ${b.repoName} is merged into ${b.baseBranch} (PR #${pr.number})`);
      } catch (error) {
        if (codeOf(error) !== "GH_FAILED") throw error;
        // A refusal because the Story base moved meanwhile (--match-head-commit) is a Story base to check again, never
        // a PR to hand to a person, who could merge content nobody checked.
        if ((await d.git.tip(lane.checkout, b.storyBase)) !== prep.head) {
          await report({ kind: "reverify", reason: `${b.repoName}의 Story base가 머지 직전에 바뀌어 Story 검증을 다시 합니다.` });
          log(`team: ${name}: the Story base of ${b.repoName} moved before its merge; the Story is checked again`);
          throw new Ended();
        }
        const reason = describe(error).replace(/^GH_FAILED: /, "");
        await report({ kind: "repo", repoId: b.repoId, state: "handed", prNumber: pr.number, prUrl: pr.url, mergeCommit: null, reason });
        log(`team: ${name}: the merge of ${b.repoName} was refused (${reason}); PR #${pr.number} is handed to a person`);
      }
    }
    const now = await via.finishView(view.storyId);
    if (now.state === "awaiting_g4" && now.approval && now.branches.every((b) => now.repos[b.repoId]?.state === "merged")) {
      await report({ kind: "done" });
      log(`team: ${name}: every repo is merged; the Story is done`);
      said.delete(view.storyId);
      return true;
    }
    if (waiting.length) sayOnce(view.storyId, `team: ${name}: waiting (${waiting.join("; ")})`);
    waiting = [];
    return acted;
  }

  async function runTick(): Promise<{ ran: boolean }> {
    if (stopped || !d.canRun()) return { ran: false };
    const via = d.lanes().find((l) => l.ready && l.link !== null)?.link;
    if (!via) return { ran: false };
    let ready: string[];
    try {
      ready = (await via.inbox()).finishReady ?? [];
    } catch (error) {
      log(`team: looking for approved Stories failed (${describe(error)}); trying again next cycle`);
      return { ran: false };
    }
    const abort = new AbortController();
    running = { abort };
    try {
      for (const storyId of ready) {
        try {
          if (await finish(via, storyId, abort.signal)) {
            problems.delete(storyId);
            return { ran: true };
          }
        } catch (error) {
          if (error instanceof Ended) return { ran: true };
          if (error instanceof NotNow || WAITS.has(codeOf(error) as string) || abort.signal.aborted) {
            log(`team: merging an approved Story waits (${describe(error)})`);
            return { ran: false };
          }
          // A Story that keeps failing (an expired gh login, a network error) never holds the claim tick or the next
          // approved Story; its reason is said once here and shown on its page.
          const reason = describe(error);
          sayOnce(storyId, `team: merging Story ${storyId} failed (${reason}); trying again next cycle`);
          if (problems.get(storyId) !== reason) {
            problems.set(storyId, reason);
            await via.finishReport(storyId, { kind: "problem", reason: `머지를 하지 못하고 다시 시도합니다: ${reason}`.slice(0, 4000) }).catch(() => {});
          }
        }
      }
      return { ran: false };
    } finally {
      running = null;
    }
  }

  let ticking: Promise<{ ran: boolean }> | null = null;
  return {
    tick() {
      ticking ??= runTick().finally(() => {
        ticking = null;
      });
      return ticking;
    },
    active: () => running !== null,
    stop() {
      stopped = true;
      running?.abort.abort();
    },
  };
}
