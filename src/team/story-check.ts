import { OfficeError } from "../cli/project.ts";
import { LIMITS, storyBaseBranch } from "../hub/story-protocol.ts";
import type { ClaimedTask } from "../hub/story-store.ts";
import type { StoryEngine } from "./executor.ts";
import { classifyLinkError } from "./story-link.ts";
import type { StoryLink } from "./story-link.ts";

/**
 * One registered repo as the Story check uses it: its Hub repo id and name, its Office checkout and engine. `ready`
 * lanes (with a link and a fine gh login) are the ones the Hub is asked through; a check runs on any registered
 * repo's checkout, since it needs neither gh nor that repo's Hub link (D47).
 */
export type CheckLane = {
  project: string;
  repoId: string;
  repoName: string;
  checkout: string;
  link: StoryLink | null;
  ready: boolean;
  engine: Pick<StoryEngine, "freezeProject" | "verifyCandidate">;
};

export type StoryCheckGit = {
  /** Puts the Office checkout on the origin's latest Story base and returns that commit (`branch.checkoutStoryBase`). */
  checkoutStoryBase(checkout: string, task: { storyBase: string; repo?: string }): Promise<{ head: string }>;
};

export type StoryChecker = { tick(): Promise<{ ran: boolean }>; active(): boolean; stop(): void };

/** How often the Story check's heartbeat goes out: well inside the Hub's 10 minutes before a Task shows held. */
const BEAT_MS = 60000;
/** A git or VM failure of one claim's check is reported only once the claim failed this many times… */
const MAX_TRIES = 3;
/** …over at least this long, so a short network loss is not a failed Story. Not-now answers are not counted. */
const FAIL_WINDOW_MS = 600000;
/** Errors that mean "not now": another run, an Office stopping, a cancelled verify. */
const WAITS = new Set(["BUSY", "EXECUTION_LOCKED", "STOPPING", "CANCELLED"]);
const VERDICT = { pass: "통과", fail: "실패", unknown: "판정 불가" } as const;

/** A repo's checked Story base: `checks` is empty for a repo the Story has no checks in (its commit still binds the
 * result approval, D48). */
type RepoResult =
  | { repo: string; repoId?: string; head: string; checks: { id: string; verdict: "pass" | "fail" | "unknown"; output: string }[] }
  | { repo: string; problem: string };

class NotNow extends Error {}
class Cut extends Error {}
class TakeRefused extends Error {}

/** Code and first line of a failure, with any `user:secret@` taken out of URLs it quotes (a git remote's). */
export function describe(error: unknown): string {
  const plain = (() => {
    if (error instanceof OfficeError) return `${error.code}: ${firstLine(error.message)}`;
    if (typeof error !== "object" || error === null) return firstLine(String(error));
    const { status, code, message } = error as Record<string, unknown>;
    const head = [status, code].filter((part) => typeof part === "string" || typeof part === "number").join(" ");
    const text = typeof message === "string" ? firstLine(message) : "";
    if (head && text && text !== code) return `${head}: ${text}`;
    return head || text || "unknown error";
  })();
  return plain.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1");
}
const firstLine = (text: string) => (text.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 300);
/** A repo this Office does not have, as people read it: the Hub's name for it, or its id from a Hub that sends none. */
const repoLabel = (task: ClaimedTask, repoId: string) =>
  task.story.branches.find((b) => b.repoId === repoId)?.repoName ?? repoId;
const codeOf = (error: unknown) =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * The summary the Hub keeps for a Story check (D47): one line with the outcome, one line per repo with the full
 * commit it checked (what bundle 4b's approval is bound to) and each check's verdict, and the output of every check
 * that did not pass, cut from the front to fit the Hub's limit.
 */
export function storyCheckSummary(results: RepoResult[]): { passed: boolean; summary: string } {
  const failedChecks = results.flatMap((r) =>
    "problem" in r ? [] : r.checks.filter((c) => c.verdict !== "pass").map((c) => ({ repo: r.repo, ...c })),
  );
  const problems = results.filter((r): r is Extract<RepoResult, { problem: string }> => "problem" in r);
  const passed = failedChecks.length === 0 && problems.length === 0;
  const count = results.reduce((n, r) => n + ("problem" in r ? 0 : r.checks.length), 0);
  const head = passed
    ? `Story 검사 통과: 레포 ${results.length}개, 검사 ${count}개.`
    : `Story 검사 실패: ${[...failedChecks.map((c) => `${c.repo} ${c.id}`), ...problems.map((p) => p.repo)].join(", ")}.`;
  const lines = results.map((r) =>
    "problem" in r
      ? `- ${r.repo}: ${r.problem}`
      : `- ${r.repo} @ ${r.head}: ${r.checks.length ? r.checks.map((c) => `${c.id} ${VERDICT[c.verdict]}`).join(", ") : "Story 검사 없음"}`,
  );
  let summary = [head, ...lines].join("\n");
  const room = LIMITS.summaryMax - summary.length;
  if (failedChecks.length && room > 40) {
    const each = Math.floor(room / failedChecks.length) - 2;
    const blocks = failedChecks.map((c) => {
      const title = `[${c.repo} ${c.id}]\n`;
      const keep = Math.max(0, each - title.length);
      const output = c.output.trim();
      return title + (output.length <= keep ? output : `…${output.slice(output.length - keep + 1)}`);
    });
    summary += `\n\n${blocks.join("\n\n")}`;
  }
  return { passed, summary: summary.slice(0, LIMITS.summaryMax) };
}

/**
 * The PL's Story check (D47). When this Office can run and holds nothing else, it goes on with a Story check it
 * already holds (a restart checks again from the start), or, unless paused, takes one the Hub has ready (whatever
 * the PL's 자동으로 일하기 says). Repo by repo it puts the Office checkout on the latest Story base and runs that repo's
 * Story checks in the engine's VM, then reports pass or fail with a summary. Its heartbeat goes out while it runs;
 * NOT_YOURS, NOT_FOUND or STATE (the PL released it, the Story was cancelled) stops it with no report. A verdict the
 * Hub did not get is sent again before anything is checked again. A git or VM failure is tried again on later ticks
 * and reported as failed once it failed `MAX_TRIES` times over `FAIL_WINDOW_MS`. The timer that calls `tick` is the
 * caller's.
 */
export function createStoryChecker(d: {
  lanes(): CheckLane[];
  /** Whether a check may run now (live, runners ready, no open Task record, no run, not stopping). */
  canRun(): boolean;
  /** Whether a new check may be taken now (not paused); a held one goes on regardless. */
  canTake(): boolean;
  git: StoryCheckGit;
  beatMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}): StoryChecker {
  const log = (line: string) => {
    try {
      d.log?.(line);
    } catch {
      // nowhere left to say it
    }
  };
  const beatMs = d.beatMs ?? BEAT_MS;
  const now = d.now ?? Date.now;
  /** Failed tries of a claim and when the first was (not reset by a success in between; cleared once a verdict is
   * made), by claim id. Memory only: a restart starts again. */
  const tries = new Map<string, { n: number; first: number }>();
  /** Verdicts the Hub has not confirmed yet, by claim id: sent again before anything is checked again. */
  const pending = new Map<string, { passed: boolean; summary: string; commits?: Record<string, string> }>();
  /** Claims whose verdict the Hub refused as INVALID, already said in the log. */
  const refusedSaid = new Set<string>();
  let running: { abort: AbortController } | null = null;
  let stopped = false;

  /** The Story check to run now through `lane`: one this member already holds, else, if `take`, a ready one. */
  async function next(lane: CheckLane & { link: StoryLink }, take: boolean): Promise<ClaimedTask | null> {
    const inbox = await lane.link.inbox();
    if (inbox.mine) {
      if (inbox.mine.state !== "claimed") return null;
      const task = await lane.link.task(inbox.mine.taskId, inbox.mine.claimId);
      return task.kind === "verify" ? task : null;
    }
    const storyId = inbox.verifyReady[0];
    if (!storyId || !take) return null;
    let task: ClaimedTask;
    try {
      task = await lane.link.claimVerify(storyId);
    } catch (error) {
      throw new TakeRefused(`taking the Story check of ${storyId} was refused (${describe(error)})`);
    }
    log(`team: story-${task.story.number}: took the Story check`);
    return task;
  }

  type Step = { entry: ClaimedTask["storyVerify"][number]; lane: CheckLane; head: string } | { result: RepoResult };

  /** A repo's Story base on its Office checkout, or the reason it cannot be checked (a result already). */
  async function checkout(task: ClaimedTask, entry: ClaimedTask["storyVerify"][number], lanes: CheckLane[]): Promise<Step> {
    const lane = lanes.find((l) => l.repoId === entry.repoId);
    const branch = task.story.branches.find((b) => b.repoId === entry.repoId);
    if (!lane)
      return { result: { repo: repoLabel(task, entry.repoId), problem: "이 Mac의 Office에 없거나 Hub에 연결되지 않은 레포라 검사하지 못했습니다." } };
    if (!branch) return { result: { repo: lane.repoName, problem: "이 레포의 Story base가 Hub에 없습니다." } };
    // Only this Story's own base is ever checked out.
    if (branch.storyBase !== storyBaseBranch(task.story.number))
      return { result: { repo: lane.repoName, problem: `Hub가 준 Story base(${branch.storyBase})가 Story #${task.story.number}의 것이 아닙니다.` } };
    const { head } = await d.git.checkoutStoryBase(lane.checkout, { storyBase: branch.storyBase, repo: lane.project });
    // A repo with no Story checks: its commit is checked out only to bind the result approval (D48).
    if (!entry.checks.length) return { result: { repo: lane.repoName, repoId: lane.repoId, head, checks: [] } };
    return { entry, lane, head };
  }

  async function verify(step: Extract<Step, { head: string }>, signal: AbortSignal): Promise<RepoResult> {
    const { entry, lane, head } = step;
    const candidate = await lane.engine.freezeProject();
    // The VM needs ids it can tell apart; the Hub's are kept unless two are the same.
    const unique = new Set(entry.checks.map((c) => c.id)).size === entry.checks.length;
    const checks = entry.checks.map((c, i) => ({ id: unique ? c.id : `Q${i + 1}`, argv: c.argv, timeoutMs: c.timeoutMs }));
    return { repo: lane.repoName, repoId: lane.repoId, head, checks: await lane.engine.verifyCandidate(candidate, checks, signal) };
  }

  /**
   * The checks of every repo, or null when a failure is to be tried again later (said in the log). Every repo's
   * Story base is checked out first (cheap git, each on its own checkout), and the VMs run only once all of them
   * are: a base that cannot be fetched never costs the other repos' VM runs while it is tried again.
   */
  async function checkAll(task: ClaimedTask, lanes: CheckLane[], signal: AbortSignal): Promise<RepoResult[] | null> {
    const name = `story-${task.story.number}`;
    /** A failure: counted, and either tried again later (null) or the repo's result once the claim's tries ran out. */
    const failed = (entry: ClaimedTask["storyVerify"][number], error: unknown): RepoResult | null => {
      if (error instanceof Cut || signal.aborted) throw new Cut();
      if (WAITS.has(codeOf(error) as string)) throw new NotNow(describe(error));
      const seen = tries.get(task.claimId) ?? { n: 0, first: now() };
      seen.n++;
      tries.set(task.claimId, seen);
      if (seen.n < MAX_TRIES || now() - seen.first < FAIL_WINDOW_MS) {
        log(`team: ${name}: the Story check failed (${describe(error)}); trying again next cycle (try ${seen.n})`);
        return null;
      }
      const lane = lanes.find((l) => l.repoId === entry.repoId);
      return { repo: lane?.repoName ?? repoLabel(task, entry.repoId), problem: `Story base를 받거나 검사하지 못했습니다(${describe(error)}).` };
    };
    const steps: Step[] = [];
    // Every Story repo: those with Story checks, and those with work only, whose commit binds the approval (D48).
    const entries = [
      ...task.storyVerify,
      ...task.story.branches
        .filter((b) => !task.storyVerify.some((v) => v.repoId === b.repoId))
        .map((b) => ({ repoId: b.repoId, checks: [] as ClaimedTask["storyVerify"][number]["checks"] })),
    ];
    for (const entry of entries) {
      if (signal.aborted) throw new Cut();
      try {
        steps.push(await checkout(task, entry, lanes));
      } catch (error) {
        const result = failed(entry, error);
        if (!result) return null;
        steps.push({ result });
      }
    }
    const results: RepoResult[] = [];
    for (const step of steps) {
      if (signal.aborted) throw new Cut();
      if ("result" in step) {
        results.push(step.result);
        continue;
      }
      try {
        results.push(await verify(step, signal));
      } catch (error) {
        const result = failed(step.entry, error);
        if (!result) return null;
        results.push(result);
      }
    }
    return results;
  }

  async function run(task: ClaimedTask, via: CheckLane & { link: StoryLink }, lanes: CheckLane[]): Promise<void> {
    const name = `story-${task.story.number}`;
    const abort = new AbortController();
    running = { abort };
    // One check is held at a time: what an earlier claim left (released between ticks) is forgotten.
    for (const map of [tries, pending]) for (const id of [...map.keys()]) if (id !== task.claimId) map.delete(id);
    for (const id of [...refusedSaid]) if (id !== task.claimId) refusedSaid.delete(id);
    let cut: string | null = null;
    const beat = async () => {
      try {
        await via.link.heartbeat(task.taskId, task.claimId, "verify");
      } catch (error) {
        const kind = classifyLinkError(error);
        if (kind === "not-yours" || kind === "not-found" || kind === "state") {
          cut ??= describe(error);
          abort.abort();
        } else log(`team: ${name}: the Story check heartbeat failed (${describe(error)}); trying again`);
      }
    };
    const timer = setInterval(() => void beat(), beatMs);
    timer.unref?.();
    try {
      await beat();
      if (cut) throw new Cut();
      let verdict = pending.get(task.claimId);
      if (!verdict) {
        const results = await checkAll(task, lanes, abort.signal);
        if (!results) return;
        if (abort.signal.aborted) throw new Cut();
        const summary = storyCheckSummary(results);
        // A passed check names every Story repo's commit: what the result approval binds (D48).
        const commits = Object.fromEntries(results.flatMap((r) => ("head" in r && r.repoId ? [[r.repoId, r.head]] : [])));
        verdict = summary.passed ? { ...summary, commits } : summary;
        pending.set(task.claimId, verdict);
        tries.delete(task.claimId);
      }
      await via.link.verified(task.taskId, task.claimId, verdict.passed, verdict.summary, verdict.commits);
      pending.delete(task.claimId);
      log(`team: ${name}: the Story check ${verdict.passed ? "passed" : "failed"} and was reported`);
    } catch (error) {
      if (error instanceof Cut) {
        pending.delete(task.claimId);
        return log(`team: ${name}: the Story check stopped (${cut ?? "the Office is stopping"})`);
      }
      if (error instanceof NotNow) return log(`team: ${name}: the Story check waits (${error.message})`);
      const kind = classifyLinkError(error);
      // The Hub will never take a verdict under this claim (released, cancelled, another verdict): forget it.
      if (kind === "not-yours" || kind === "not-found" || kind === "state") {
        pending.delete(task.claimId);
        return log(`team: ${name}: the Hub refused the Story check report (${describe(error)}); it was dropped`);
      }
      // The Hub refused its content: checking again would only make the same verdict, so it is kept and sent again,
      // said once. Its heartbeat goes on meanwhile, so the check never shows held and cannot be released on the web
      // (D48 fixes 4a's wording): only cancelling the Story, or stopping this Office for 10 minutes, ends it.
      if (kind === "invalid") {
        if (!refusedSaid.has(task.claimId))
          log(
            `team: ${name}: the Hub refused the Story check report (${describe(error)}); it is sent again each cycle. To end it, cancel the Story on the web or stop this Office for 10 minutes so the check shows held and can be released`,
          );
        refusedSaid.add(task.claimId);
        return;
      }
      log(`team: ${name}: reporting the Story check failed (${describe(error)}); sending it again next cycle`);
    } finally {
      clearInterval(timer);
      running = null;
    }
  }

  /** The last "not now" line, so a refusal that lasts (the PL holds another Task) is said once. */
  let lastWait = "";
  const waitLine = (line: string) => {
    if (line !== lastWait) log(line);
    lastWait = line;
  };

  async function runTick(): Promise<{ ran: boolean }> {
    if (stopped || !d.canRun()) return { ran: false };
    const lanes = d.lanes();
    const take = d.canTake();
    // Any ready lane will do: the Story check has no repo, so every lane of this member sees it. A lane that cannot
    // be read gives way to the next; a refused take (another open Task) waits for the next tick.
    for (const lane of lanes) {
      if (!lane.ready || lane.link === null) continue;
      const via = lane as CheckLane & { link: StoryLink };
      let task: ClaimedTask | null;
      try {
        task = await next(via, take);
      } catch (error) {
        if (error instanceof TakeRefused) {
          waitLine(`team: ${error.message}; trying again next cycle`);
          return { ran: false };
        }
        waitLine(`team: ${lane.project}: looking for a Story check failed (${describe(error)}); trying again next cycle`);
        continue;
      }
      lastWait = "";
      if (!task) return { ran: false };
      await run(task, via, lanes);
      return { ran: true };
    }
    return { ran: false };
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
