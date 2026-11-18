import { OfficeError } from "../cli/project.ts";
import { LIMITS } from "../hub/story-protocol.ts";
import type { ClaimedTask } from "../hub/story-store.ts";
import type { StoryEngine } from "./executor.ts";
import { classifyLinkError } from "./story-link.ts";
import type { StoryLink } from "./story-link.ts";

/** One registered repo as the Story check uses it: its Hub repo id and name, its Office checkout and engine. */
export type CheckLane = {
  project: string;
  repoId: string;
  repoName: string;
  checkout: string;
  link: StoryLink;
  engine: Pick<StoryEngine, "freezeProject" | "verifyCandidate">;
};

export type StoryCheckGit = {
  /** Puts the Office checkout on the origin's latest Story base and returns that commit (`branch.checkoutStoryBase`). */
  checkoutStoryBase(checkout: string, task: { storyBase: string; repo?: string }): Promise<{ head: string }>;
};

/** How often the Story check's heartbeat goes out: well inside the Hub's 10 minutes before a Task shows held. */
const BEAT_MS = 60000;
/** Failed tries in a row of one check (git, the VM) before it is reported failed. Not-now answers are not counted. */
const MAX_TRIES = 3;
/** Errors that mean "not now": another run, an Office stopping, a cancelled verify. */
const WAITS = new Set(["BUSY", "EXECUTION_LOCKED", "STOPPING", "CANCELLED"]);
const VERDICT = { pass: "통과", fail: "실패", unknown: "판정 불가" } as const;

type RepoResult =
  | { repo: string; head: string; checks: { id: string; verdict: "pass" | "fail" | "unknown"; output: string }[] }
  | { repo: string; problem: string };

class NotNow extends Error {}
class Cut extends Error {}
class TakeRefused extends Error {}

function describe(error: unknown): string {
  if (error instanceof OfficeError) return `${error.code}: ${firstLine(error.message)}`;
  if (typeof error !== "object" || error === null) return firstLine(String(error));
  const { status, code, message } = error as Record<string, unknown>;
  const head = [status, code].filter((part) => typeof part === "string" || typeof part === "number").join(" ");
  const text = typeof message === "string" ? firstLine(message) : "";
  if (head && text && text !== code) return `${head}: ${text}`;
  return head || text || "unknown error";
}
const firstLine = (text: string) => (text.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 300);
/** A repo this Office does not have, as people read it: the Hub's name for it, or its id from a Hub that sends none. */
const repoLabel = (task: ClaimedTask, repoId: string) =>
  task.story.branches.find((b) => b.repoId === repoId)?.repoName ?? repoId;
const codeOf = (error: unknown) =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * The summary the Hub keeps for a Story check (D47): one line with the outcome, one line per repo with the commit
 * it checked and each check's verdict, and the output of every check that did not pass, cut to fit the Hub's limit.
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
      : `- ${r.repo} @ ${r.head.slice(0, 12)}: ${r.checks.map((c) => `${c.id} ${VERDICT[c.verdict]}`).join(", ")}`,
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
 * The PL's Story check (D47): when this Office can run and holds nothing else, it takes a Story check the Hub
 * has ready (whatever the PL's 자동으로 일하기 says) or one it already holds (a restart checks again from the start),
 * then, repo by repo, puts the Office checkout on the latest Story base and runs that repo's Story checks in the
 * engine's VM, and reports pass or fail with a summary. Its heartbeat goes out while it runs; a NOT_YOURS or
 * NOT_FOUND answer (the PL released it, the Story was cancelled) stops it. A git or VM failure is tried again next
 * tick and reported as failed after `MAX_TRIES` in a row. The timer that calls `tick` belongs to the caller.
 */
export function createStoryChecker(d: {
  lanes(): CheckLane[];
  /** Whether a check may start now (live, runners ready, no open Task record, no run, not paused, not stopping). */
  canStart(): boolean;
  git: StoryCheckGit;
  beatMs?: number;
  log?: (line: string) => void;
}): { tick(): Promise<{ ran: boolean }>; active(): boolean; stop(): void } {
  const log = (line: string) => {
    try {
      d.log?.(line);
    } catch {
      // nowhere left to say it
    }
  };
  const beatMs = d.beatMs ?? BEAT_MS;
  /** Failed tries in a row, by claim id. Memory only: a restart starts again. */
  const tries = new Map<string, number>();
  let running: { abort: AbortController } | null = null;
  let stopped = false;

  /** The Story check to run now through `lane`: one this member already holds, else a ready one taken now. */
  async function next(lane: CheckLane): Promise<ClaimedTask | null> {
    const inbox = await lane.link.inbox();
    if (inbox.mine) {
      if (inbox.mine.state !== "claimed") return null;
      const task = await lane.link.task(inbox.mine.taskId, inbox.mine.claimId);
      return task.kind === "verify" ? task : null;
    }
    const storyId = inbox.verifyReady[0];
    if (!storyId) return null;
    let task: ClaimedTask;
    try {
      task = await lane.link.claimVerify(storyId);
    } catch (error) {
      throw new TakeRefused(`taking the Story check of ${storyId} was refused (${describe(error)})`);
    }
    log(`team: story-${task.story.number}: took the Story check`);
    return task;
  }

  async function checkRepo(task: ClaimedTask, entry: ClaimedTask["storyVerify"][number], lanes: CheckLane[], signal: AbortSignal): Promise<RepoResult> {
    const lane = lanes.find((l) => l.repoId === entry.repoId);
    const branch = task.story.branches.find((b) => b.repoId === entry.repoId);
    if (!lane) return { repo: repoLabel(task, entry.repoId), problem: "이 Mac의 Office에 등록되지 않은 레포라 검사하지 못했습니다." };
    if (!branch) return { repo: lane.repoName, problem: "이 레포의 Story base가 Hub에 없습니다." };
    const { head } = await d.git.checkoutStoryBase(lane.checkout, { storyBase: branch.storyBase, repo: lane.project });
    if (signal.aborted) throw new Cut();
    const candidate = await lane.engine.freezeProject();
    // The VM needs ids it can tell apart; the Hub's are kept unless two are the same.
    const unique = new Set(entry.checks.map((c) => c.id)).size === entry.checks.length;
    const checks = entry.checks.map((c, i) => ({ id: unique ? c.id : `V${i + 1}`, argv: c.argv, timeoutMs: c.timeoutMs }));
    const results = await lane.engine.verifyCandidate(candidate, checks, signal);
    return { repo: lane.repoName, head, checks: results };
  }

  async function run(task: ClaimedTask, via: CheckLane, lanes: CheckLane[]): Promise<void> {
    const name = `story-${task.story.number}`;
    const abort = new AbortController();
    running = { abort };
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
      const results: RepoResult[] = [];
      for (const entry of task.storyVerify) {
        if (abort.signal.aborted) throw new Cut();
        try {
          results.push(await checkRepo(task, entry, lanes, abort.signal));
        } catch (error) {
          if (error instanceof Cut || abort.signal.aborted) throw new Cut();
          if (WAITS.has(codeOf(error) as string)) throw new NotNow(describe(error));
          const n = (tries.get(task.claimId) ?? 0) + 1;
          tries.set(task.claimId, n);
          if (n < MAX_TRIES) {
            log(`team: ${name}: the Story check failed (${describe(error)}); trying again next cycle (${n}/${MAX_TRIES})`);
            return;
          }
          const lane = lanes.find((l) => l.repoId === entry.repoId);
          results.push({ repo: lane?.repoName ?? repoLabel(task, entry.repoId), problem: `Story base를 받거나 검사하지 못했습니다(${describe(error)}).` });
        }
      }
      if (abort.signal.aborted) throw new Cut();
      const { passed, summary } = storyCheckSummary(results);
      await via.link.verified(task.taskId, task.claimId, passed, summary);
      tries.delete(task.claimId);
      log(`team: ${name}: the Story check ${passed ? "passed" : "failed"} and was reported`);
    } catch (error) {
      if (error instanceof Cut) return log(`team: ${name}: the Story check stopped (${cut ?? "the Office is stopping"})`);
      if (error instanceof NotNow) return log(`team: ${name}: the Story check waits (${error.message})`);
      log(`team: ${name}: reporting the Story check failed (${describe(error)}); checking again next cycle`);
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
    if (stopped || !d.canStart()) return { ran: false };
    const lanes = d.lanes();
    // Any lane will do: the Story check has no repo, so every lane of this member sees it. A lane that cannot be
    // read gives way to the next; a refused take (another open Task) waits for the next tick.
    for (const lane of lanes) {
      let task: ClaimedTask | null;
      try {
        task = await next(lane);
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
      await run(task, lane, lanes);
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
