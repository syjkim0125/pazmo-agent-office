import { randomUUID } from "node:crypto";
import { lstatSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OfficeError, fail, noSymlinks } from "../cli/project.ts";
import { readStable } from "../core/candidates.ts";
import { PLAN_LIMITS, planStoryKey } from "../hub/plan-protocol.ts";
import type { PlanLease, PlanQuestion, PlanRecord, PlanResult } from "../hub/plan-protocol.ts";
import { storyBaseBranch } from "../hub/story-protocol.ts";
import type { StoryState } from "../hub/story-protocol.ts";
import type { StoryView } from "../hub/story-store.ts";
import type { LeanOffice } from "../lean/office.ts";
import { PlanningInvalid, oneLine, teamPlanningPacket } from "../runners/planning.ts";
import type { PlanningPacket, PlanningStory } from "../runners/planning.ts";
import { runnerAccountProblem, runnerNotReady } from "../runners/runner-account.ts";
import type { RunnerAccountProblem } from "../runners/runner-account.ts";
import {
  SplitRefused,
  acceptTeamLead,
  acceptTeamPm,
  decidedOf,
  dialogueOf,
  renderTeamStory,
  repoFolders,
} from "../runners/team-planning.ts";
import type { TeamSplit } from "../runners/team-planning.ts";
import * as branch from "./branch.ts";
import type { GitEnv } from "./branch.ts";
import { PlanGateError, checkApprovals, writeGateRecords } from "./plan-gates.ts";
import { planFailure } from "./plan-link.ts";
import type { PlanFailure, PlanLink } from "./plan-link.ts";
import { planTree } from "./plan-tree.ts";
import type { PlanTreeGit, PlanTreeRepo } from "./plan-tree.ts";

/** How often a leased step's heartbeat goes out: well inside the Hub's 600000 ms lease. */
const BEAT_MS = 60000;
/** How long an older Hub without plan routes is left alone before it is asked again. */
const RECHECK_MS = 300000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A registered repo that is ready (Hub link and gh login) with its plan link: the Office's own checkout of it. */
export type PlanLane = { project: string; checkout: string; repoId: string; link: PlanLink };
/** The host git a plan step uses, bound to the person's git environment: the planning tree's reads and the guarded
 * push that makes a published Story's base. */
export type PlanGit = PlanTreeGit & {
  pushStoryBase(checkout: string, storyBase: string, sha: string): Promise<"created" | "exists">;
};

/** `branch.ts`'s plan steps bound to the person's git environment, as `branchOps` binds a Story Task's. */
export function planGitOps(env: GitEnv): PlanGit {
  return {
    fetchBaseTip: (checkout, baseBranch) => branch.fetchBaseTip(checkout, baseBranch, env),
    listTree: (checkout, sha) => branch.listTree(checkout, sha, env),
    extractTree: (checkout, sha, target) => branch.extractTree(checkout, sha, target, env),
    pushStoryBase: (checkout, storyBase, sha) => branch.pushStoryBase(checkout, storyBase, sha, env),
  };
}

export type PlannerConfig = {
  /** The canonical data root: a plan's folder is `<root>/team/plans/<planId>`. */
  root: string;
  /** The ready lanes with a plan link, in registration order: the first one asks for work. */
  lanes: () => PlanLane[];
  engineOf: (project: string) => Pick<LeanOffice, "planTurn">;
  /** Whether a plan step may start now (live, runners ready, no open Task record, no run, no restart held). */
  canStart: () => boolean;
  git: PlanGit;
  beatMs?: number;
  recheckMs?: number;
  log: (line: string) => void;
  now?: () => number;
};
export type PlannerTick =
  | { ran: false; why: "busy" | "no-lane" | "none" | "hub-too-old" }
  | { ran: true; planId: string; posted: PlanResult["kind"] | null };

/** What a step works with: the leased plan and its lease, the lane that leased it, its folder and repos (each on a
 * lane), and the signal that stops it. */
type StepInput = {
  plan: PlanRecord;
  leaseId: string;
  revision: number;
  lane: PlanLane;
  dir: string;
  repos: PlanTreeRepo[];
  signal: AbortSignal;
  /** A heartbeat right before a Hub write: null while the step is still this Office's. A cut (NOT_YOURS, STATE, STALE,
   * gone) has already stopped the step and is given back; any other failure is HubNotNow. */
  confirm(): Promise<PlanFailure | null>;
};
type Step = (s: StepInput) => Promise<PlanResult>;

const failed = (reason: string): PlanResult => ({
  kind: "failed",
  reason: reason.length <= PLAN_LIMITS.failureMax ? reason : reason.slice(0, PLAN_LIMITS.failureMax),
});
/** A plain first line for the PL, then the detail from the second line on. */
const withDetail = (plain: string, detail: string) => failed(detail.trim() ? `${plain}\n${detail.trim()}` : plain);

const SIXTH_ROUND = "AI가 다섯 번 물었는데도 정할 것이 남았습니다. 하고 싶은 일을 더 자세히 적어 새 Story로 시작하세요.";
const DRAFT_TOO_LONG = "Story 초안이 너무 깁니다(32KB 넘음). 하고 싶은 일을 줄이거나 나눠 새 Story로 시작하세요.";
const ACCOUNT_WORDS: Record<RunnerAccountProblem["kind"], string> = {
  limit: "사용 한도",
  billing: "결제",
  login: "로그인",
  not_ready: "준비 안 됨",
};
/** The plain first line of each failure the plan tree or the turn can end on, by its Office error code. */
const PLAIN: Record<string, string> = {
  PLANNING_INVALID: "AI의 답을 읽지 못했습니다. 다시 시도하세요.",
  CANDIDATE_LIMIT: "레포가 커서 기획 입력(파일 1만 개·100MB)을 넘습니다.",
  GIT_FAILED: "PL Mac에서 레포를 받지 못했습니다.",
  CANDIDATE_CHANGED: "PL Mac에 만들어 둔 기획 입력이 바뀌었거나 읽히지 않습니다. 다시 시도하고, 또 실패하면 취소한 뒤 새 Story로 시작하세요.",
  UNSAFE_PATH: "레포에 기획 입력으로 옮길 수 없는 경로가 있습니다.",
  KIT_SOURCE_CHANGED: "PL Mac에 적어 둔 기획 기록이 지금 승인과 다릅니다. 취소하고 새 Story로 시작하세요.",
  BASES_CHANGED: "PL Mac에 적어 둔 Story 시작 커밋 기록을 읽을 수 없습니다. 취소하고 새 Story로 시작하세요.",
};
const UNKNOWN = "PL Mac에서 기획 단계를 마치지 못했습니다. 다시 시도하세요.";
/** UNSAFE_PATH from writing the gate records: the plan's own folder, not a repo path of the planning tree. */
const RECORDS = "PL Mac에 기획 기록을 쓸 수 없습니다(기획 폴더가 안전하지 않습니다). Office 데이터 폴더를 확인한 뒤 다시 시도하세요.";
const TWICE = "AI가 Task를 두 번 나눴지만 검사를 통과하지 못했습니다.";
const PUBLISH_REFUSED = "Hub가 Story 올리기를 받지 않았습니다. 아래 이유를 확인한 뒤 다시 시도하세요.";
const OPEN_REFUSED = "Hub가 Story 열기를 받지 않았습니다. 아래 이유를 확인한 뒤 다시 시도하세요.";
const STORY_REFUSED = "Hub에서 올린 Story를 읽지 못했습니다. 아래 이유를 확인한 뒤 다시 시도하세요.";
const STORY_CANCELLED = "이 기획으로 올린 Story가 취소됐습니다. 취소하고 새 Story로 시작하세요.";
const HUB_UNSURE = "Hub가 답하지 않아 Story를 올리거나 열지 못했습니다. 잠시 뒤 다시 시도하세요.";
/** The Story states that count as opened: the Hub's own list for an `open` result. */
const OPENED: readonly StoryState[] = ["open", "verifying", "awaiting_g4", "done"];
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** `bases.json` is a few repo ids and commit ids. */
const BASES_BYTES = 65536;
/** What the PL sees when the Hub refused a result of this Office for good (a 400: the two disagree on a rule). */
const HUB_REFUSED =
  "Hub가 이 Office의 결과를 받지 않았습니다(Hub와 Office 버전이 다를 수 있습니다). Office를 업데이트한 뒤 다시 시도하세요.";
/** How often a result the Hub did not take is sent again before it is dropped. */
const MAX_RESENDS = 3;
/** "Not now": another run, an engine locked or stopping, or the turn was cancelled. No result; the lease is asked for
 * again on a later tick. */
const WAITS = new Set(["BUSY", "EXECUTION_LOCKED", "STOPPING", "CANCELLED"]);
/** Answers that mean the step is no longer this Office's to finish: stop it and send nothing. */
const CUT: PlanFailure[] = ["stale", "not-yours", "state", "gone"];

const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
/** Status and code of a failed Hub call, for a log line: never the whole error. */
function describe(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown error";
  const { status, code, message } = error as Record<string, unknown>;
  const parts = [status, code].filter((part) => typeof part === "string" || typeof part === "number");
  if (parts.length) return parts.join(" ");
  return typeof message === "string" && message ? message.slice(0, 80) : "unknown error";
}

/** A Hub refusal on one line: its status, code and message. */
function hubReason(error: unknown): string {
  const { status, code } = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;
  const head = [status, code].filter((part) => typeof part === "string" || typeof part === "number").join(" ");
  const message = error instanceof Error ? error.message : String(error);
  return oneLine(head && message !== head ? `${head}: ${message}` : head || message);
}

/** Ends a step with a result a helper of the step worded itself (a repo's base, a Hub refusal). */
class StepEnd extends Error {
  result: PlanResult;
  constructor(result: PlanResult) {
    super(result.kind);
    this.result = result;
  }
}

/** A Hub call of a step that did not go through now (network, 5xx, a link to fix): no result, and the same lease is
 * tried again on a later tick, at most MAX_RESENDS times more before the PL is told. */
class HubNotNow extends OfficeError {
  constructor(what: string, error: unknown) {
    super("HUB_NOT_NOW", `${what}: ${describe(error)}`);
  }
}

/** A Hub call of the splitting step. A refusal for good (a 4xx other than 401) ends the step with `plain` and the
 * Hub's reason, never as an older Hub; anything else is not now. The step's own errors pass through. */
async function hubStep<T>(what: string, plain: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof OfficeError || error instanceof StepEnd) throw error;
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 401)
      throw new StepEnd(withDetail(plain, hubReason(error)));
    throw new HubNotNow(what, error);
  }
}

/** A model turn's runner the PL's Mac cannot use (not ready, a limit, billing, login) as the PL's failure, else null. */
function runnerProblem(observation: Awaited<ReturnType<LeanOffice["planTurn"]>>): PlanResult | null {
  const problem = runnerNotReady(observation.result.error) ?? runnerAccountProblem(observation.result.stdout ?? "");
  return problem
    ? withDetail(
        `PL Mac의 AI 실행기(${problem.runner})를 쓸 수 없습니다: ${ACCOUNT_WORDS[problem.kind]}. 해결한 뒤 다시 시도하세요.`,
        problem.message,
      )
    : null;
}

/** The reason a Lead split was refused, for the next turn's `retry`: the Office's own checks of the output
 * (PLANNING_INVALID, never a runner's failure) or the Hub's graph check (SPLIT_REFUSED). Null for anything else. */
function refusalOf(error: unknown): string | null {
  const reason =
    error instanceof SplitRefused
      ? `${error.graphCode}: ${error.message}`
      : error instanceof PlanningInvalid && error.origin === "output"
        ? error.detail
        : null;
  if (reason === null) return null;
  // The packet takes it as one line of at most failureMax characters.
  const line = oneLine(reason).slice(0, PLAN_LIMITS.failureMax);
  return (/[\ud800-\udbff]$/.test(line) ? line.slice(0, -1) : line) || "refused";
}

/**
 * The base commit of each repo of a published Story, from `bases.json` in the plan's folder (`{ [repoId]: sha }`,
 * 0600). Null when it is not there yet. Anything but such a map is BASES_CHANGED and the file is kept as it is.
 */
function readBases(file: string): Record<string, string> | null {
  noSymlinks(file);
  if (!lstatSync(file, { throwIfNoEntry: false })) return null;
  let value: unknown;
  try {
    value = JSON.parse(readStable(file, BASES_BYTES).toString("utf8"));
  } catch {
    value = null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.values(value).every((sha) => typeof sha === "string" && OBJECT_ID.test(sha))
  )
    fail("BASES_CHANGED", "bases.json is not a map of repo ids to full commit ids; it is kept for inspection.");
  return value as Record<string, string>;
}

/** Temporary file, then rename: `bases.json` is never seen half written. 0600 in the plan's 0700 folder. */
function writeBases(dir: string, file: string, bases: Record<string, string>): void {
  noSymlinks(file);
  const tmp = join(dir, `.bases.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(bases)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** The failure the PL sees for an error a step ended on. */
function reasonOf(error: unknown): PlanResult {
  const code = codeOf(error);
  if (error instanceof StepEnd) return error.result;
  if (error instanceof PlanGateError) return failed(error.message);
  if (error instanceof PlanningInvalid) return withDetail(PLAIN.PLANNING_INVALID, error.detail);
  if (error instanceof OfficeError && code && PLAIN[code]) return withDetail(PLAIN[code], error.message);
  const message = error instanceof Error ? error.message : String(error);
  return withDetail(UNKNOWN, code ? `${code}: ${message}` : message);
}

/**
 * The PL's plan work on their team Office: on each claim tick, the first ready lane's plan link is asked for a leased
 * step; a step runs to its end (its model turn on the leased lane's engine, inside the engine's single run slot),
 * with its heartbeat every `beatMs`, and its result goes to the Hub. A heartbeat answered NOT_YOURS, STATE, STALE or
 * gone stops the step and sends nothing. A result that could not be sent (network, a Hub restarting) is kept and
 * sent, with no second turn, when the next tick is handed the same lease and revision, at most MAX_RESENDS times; a
 * stale one is dropped. A result the Hub refuses for good (400) is never kept: a `failed` saying so goes in its place
 * on the same lease, and a `failed` the Hub refuses is dropped. A result given up that way leaves its lease alone (not
 * asked for) until the Hub's lease time has run out, so Task claims go on meanwhile. A Hub without plan routes (404) is
 * said once and left alone for `recheckMs`.
 */
export function createPlanner(c: PlannerConfig): { tick(): Promise<PlannerTick>; active(): boolean; stop(): void } {
  const now = c.now ?? Date.now;
  const beatMs = c.beatMs ?? BEAT_MS;
  const recheckMs = c.recheckMs ?? RECHECK_MS;
  const log = (line: string) => {
    try {
      c.log(line);
    } catch {
      // nowhere left to say it
    }
  };
  let stepping = false;
  let stopped = false;
  /** The running step's stop. */
  let current: AbortController | null = null;
  /** A result the Hub did not take because of a passing failure, for the lease it was made under, and how often it
   * was sent. */
  let pending: { planId: string; leaseId: string; revision: number; result: PlanResult; sends: number } | null = null;
  /** The lease whose result was given up, and until when the Hub is not asked for work so that the lease runs out. */
  let givenUp: { planId: string; leaseId: string; revision: number } | null = null;
  let restUntil: number | null = null;
  /** Until when an older Hub is not asked, and whether that was said. */
  let quietUntil: number | null = null;
  let hubTooOldSaid = false;
  /** Lines said once while they repeat (a lease of a step this Office cannot do yet). */
  const said = new Set<string>();
  const keyOf = (planId: string, leaseId: string, revision: number) => `${planId} ${leaseId} ${revision}`;
  /** The split of a lease whose Hub calls did not go through now, so that the next run of that lease publishes it
   * instead of running the Lead again; `retry` is the reason that split was asked for with, if any. */
  let kept: { key: string; split: TeamSplit; retry: string | null } | null = null;
  /** The lease whose step ended on HubNotNow, and how many times in a row. */
  let unsure: { key: string; tries: number } | null = null;

  function hubTooOld(): PlannerTick {
    quietUntil = now() + recheckMs;
    if (!hubTooOldSaid)
      log(`team: the Hub has no plan routes yet (an older Hub); asking it for plan work again every ${recheckMs / 1000} s`);
    hubTooOldSaid = true;
    return { ran: false, why: "hub-too-old" };
  }

  /** The PM step: one turn over the plan tree, then questions (asked, or the blocking decisions as Q1..Qn), a draft,
   * or a plain failure. */
  async function pmStep(s: StepInput): Promise<PlanResult> {
    const { plan } = s;
    let packet: PlanningPacket;
    try {
      packet = teamPlanningPacket({
        planId: plan.id,
        intent: plan.intent,
        risk: plan.risk,
        role: "pm",
        repos: s.repos.map(({ folder, baseBranch }) => ({ folder, baseBranch })),
        dialogue: dialogueOf(plan.rounds),
        story: null,
        rewrite: plan.rewrite,
        retry: null,
      });
    } catch (error) {
      // The Hub keeps its records within these bounds; this is not the AI's answer.
      if (error instanceof PlanningInvalid) return withDetail(UNKNOWN, `plan record: ${error.detail}`);
      throw error;
    }
    const candidate = await planTree(s.dir, s.repos, c.git, log);
    const observation = await c.engineOf(s.lane.project).planTurn(packet, candidate, s.signal);
    const problem = runnerProblem(observation);
    if (problem) return problem;
    const answer = acceptTeamPm(packet, observation);
    const asked: PlanQuestion[] =
      answer.kind === "questions"
        ? answer.questions.map((q) => ({ ...q, blocking: false }))
        : answer.openBlocking.map((b, i) => ({ id: `Q${i + 1}`, text: b.text, reason: b.reason, blocking: true }));
    if (answer.kind === "questions" || asked.length)
      return plan.rounds.length >= PLAN_LIMITS.roundsMax ? failed(SIXTH_ROUND) : { kind: "questions", questions: asked };
    const text = renderTeamStory(answer.story, decidedOf(plan.rounds));
    if (Buffer.byteLength(text) > PLAN_LIMITS.draftBytes) return failed(DRAFT_TOO_LONG);
    return { kind: "draft", text, story: answer.story };
  }
  /** One Lead turn over the plan tree for the approved `story`: its split, or the PL's failure when the runner cannot
   * be used. PLANNING_INVALID and SPLIT_REFUSED are thrown for `leadSplit` to retry. */
  async function leadTurn(s: StepInput, story: PlanningStory, retry: string | null): Promise<TeamSplit | PlanResult> {
    const { plan } = s;
    let packet: PlanningPacket;
    try {
      packet = teamPlanningPacket({
        planId: plan.id,
        intent: plan.intent,
        risk: plan.risk,
        role: "lead",
        repos: s.repos.map(({ folder, baseBranch }) => ({ folder, baseBranch })),
        dialogue: dialogueOf(plan.rounds),
        story,
        rewrite: null,
        retry,
      });
    } catch (error) {
      // The Hub keeps its records within these bounds; this is not the AI's answer and not worth a second turn.
      if (error instanceof PlanningInvalid) throw new StepEnd(withDetail(UNKNOWN, `plan record: ${error.detail}`));
      throw error;
    }
    const candidate = await planTree(s.dir, s.repos, c.git, log);
    const observation = await c.engineOf(s.lane.project).planTurn(packet, candidate, s.signal);
    return runnerProblem(observation) ?? acceptTeamLead(packet, observation, s.repos);
  }

  /**
   * The Lead's split of `story`, handed to `use`, with one more Lead turn when it is refused: by the Office's own
   * checks of the output (PLANNING_INVALID, SPLIT_REFUSED) or by `use` (SplitRefused, as the Hub's publish refusing
   * the graph is). The second turn's packet carries the reason in `retry`; a second refusal is failed with it. A split
   * whose `use` ended on HubNotNow is kept for its lease: the next run of that lease hands it to `use` again without a
   * Lead turn. The splitting step uses it, and the design step will (F6).
   */
  async function leadSplit(s: StepInput, story: PlanningStory, use: (split: TeamSplit) => Promise<PlanResult>): Promise<PlanResult> {
    const key = keyOf(s.plan.id, s.leaseId, s.revision);
    const held = kept?.key === key ? kept : null;
    kept = null;
    let retry = held?.retry ?? null;
    let split = held?.split ?? null;
    for (;;) {
      let refused: string | null;
      try {
        if (!split) {
          const made = await leadTurn(s, story, retry);
          if ("kind" in made) return made;
          split = made;
        }
        try {
          return await use(split);
        } catch (error) {
          if (error instanceof HubNotNow) kept = { key, split, retry };
          throw error;
        }
      } catch (error) {
        refused = refusalOf(error);
        if (refused === null) throw error;
      }
      log(`team: plan ${s.plan.id}: the Lead's split was refused (${refused.slice(0, 160)})${retry === null ? "; asking the Lead once more" : ""}`);
      if (retry !== null) return withDetail(TWICE, refused);
      retry = refused;
      split = null;
    }
  }

  /**
   * F5: the PL cancelled the plan after this Office published its Story, so the Hub's own cancel did not see it. The
   * Office (it is the PL) cancels that Story while it is still a draft. A failure here is only logged: a draft Story
   * cannot be claimed, and no step of a cancelled plan opens it.
   */
  async function cancelDraft(s: StepInput, story: { storyId: string; number: number }): Promise<void> {
    try {
      if ((await s.lane.link.story(story.storyId)).state !== "draft") return;
      await s.lane.link.cancel(story.storyId);
      log(`team: plan ${s.plan.id}: the plan was cancelled after story-${story.number} was published; that draft Story is cancelled`);
    } catch (error) {
      log(`team: plan ${s.plan.id}: the plan was cancelled; cancelling its draft story-${story.number} failed (${describe(error)})`);
    }
  }

  /**
   * Right before a Hub or origin write: whether the step may go on. The Hub is asked with a heartbeat (`always`), or
   * only once the step was stopped meanwhile (a heartbeat cut it, or the Office is stopping). A stopped or cut step
   * goes no further; when the plan was cancelled after `story` was published, that draft is cancelled first (F5).
   */
  async function goOn(s: StepInput, story: { storyId: string; number: number } | null, always: boolean): Promise<void> {
    if (!always && !s.signal.aborted) return;
    let cut: PlanFailure | null;
    try {
      cut = await s.confirm();
    } catch (error) {
      if (!s.signal.aborted) throw error;
      cut = null;
    }
    if (cut === "state" && story) await cancelDraft(s, story);
    if (cut || s.signal.aborted) throw new OfficeError("CANCELLED", "The plan step was stopped before its next write.");
  }

  /** The base commit of each repo of the Story: those `bases.json` holds, and for a repo it lacks the base branch tip
   * fetched now, all added in one write. A recorded commit is never replaced, so a retry makes every base where the
   * first split meant it, even after the base branch moved. A fetch that fails names its repo and records nothing. */
  async function baseCommits(s: StepInput, branches: StoryView["branches"], checkoutOf: Map<string, string>) {
    const file = join(s.dir, "bases.json");
    const recorded = readBases(file) ?? {};
    const bases: Record<string, string> = { ...recorded };
    for (const b of branches) {
      if (bases[b.repoId]) continue;
      try {
        bases[b.repoId] = await c.git.fetchBaseTip(checkoutOf.get(b.repoId)!, b.baseBranch);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new StepEnd(withDetail(`PL Mac에서 레포 ${b.repoName}의 ${b.baseBranch} 브랜치를 받지 못했습니다. 다시 시도하세요.`, message));
      }
    }
    if (Object.keys(bases).length !== Object.keys(recorded).length) writeBases(s.dir, file, bases);
    return bases;
  }

  /**
   * Steps 4–5 of a split, for a published Story (just now, or by an earlier attempt: F1): every Story repo's base
   * `feature/story-<N>/base` at its recorded commit, then, only once all are there and the plan is confirmed still
   * this Office's, the Story is opened. A base that cannot be made names its repo and the Story stays a draft. An open
   * answered STATE counts when the Story is already open (an earlier open whose reply was lost).
   */
  async function basesAndOpen(s: StepInput, story: { storyId: string; number: number }): Promise<PlanResult> {
    const { plan, lane } = s;
    const view = await hubStep("story", STORY_REFUSED, () => lane.link.story(story.storyId));
    if (view.state === "cancelled") return failed(STORY_CANCELLED);
    const checkoutOf = new Map(s.repos.map((r) => [r.repoId, r.checkout]));
    for (const b of view.branches) {
      if (!checkoutOf.has(b.repoId))
        return failed(`레포 ${b.repoName}을(를) PL의 Mac에서 쓸 수 없습니다(연결 없음 또는 gh 로그인 필요). 내 Mac 화면에서 확인한 뒤 다시 시도하세요.`);
      if (b.storyBase !== storyBaseBranch(story.number))
        return withDetail("Hub가 알려 준 Story 브랜치 이름이 이 Story 번호와 맞지 않습니다. 다시 시도하세요.", `${b.repoName}: ${b.storyBase}`);
    }
    const bases = await baseCommits(s, view.branches, checkoutOf);
    for (const b of view.branches) {
      await goOn(s, story, false);
      let made: "created" | "exists";
      try {
        made = await c.git.pushStoryBase(checkoutOf.get(b.repoId)!, b.storyBase, bases[b.repoId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (codeOf(error) === "BASE_EXISTS") return failed(`레포 ${b.repoName}: ${message}`);
        return withDetail(
          `레포 ${b.repoName}에 Story 시작 브랜치 ${b.storyBase}를 만들지 못했습니다. 레포 권한과 브랜치 규칙을 확인한 뒤 다시 시도하세요.`,
          message,
        );
      }
      log(`team: plan ${plan.id}: story-${story.number} base in ${b.repoName}: ${made}`);
    }
    await goOn(s, story, true);
    await hubStep("open", OPEN_REFUSED, async () => {
      try {
        await lane.link.open(story.storyId);
      } catch (error) {
        const { status, code } = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;
        if (status !== 409 || code !== "STATE") throw error;
        const again = await lane.link.story(story.storyId);
        if (OPENED.includes(again.state)) return;
        throw new StepEnd(failed(again.state === "cancelled" ? STORY_CANCELLED : `올린 Story를 열 수 없습니다(지금 상태: ${again.state}). 다시 시도하세요.`));
      }
    });
    log(`team: plan ${plan.id}: story-${story.number} opened`);
    return { kind: "open", storyId: story.storyId };
  }

  /**
   * The splitting step of a normal-risk plan after its G1: the approval must bind the draft (`checkApprovals`), the
   * kit gate records go to the plan's folder, then the Lead splits it (one retry), the plan is confirmed and the split
   * published under `plan:<planId>`, every Story base is made and the Story opened. A plan that already has a
   * published Story (a retry, an Office restarted mid-split) goes straight to its bases and open: no Lead turn and no
   * second publish (F1).
   */
  async function splitStep(s: StepInput): Promise<PlanResult> {
    const { plan, lane } = s;
    const gates = checkApprovals(plan, { needSplit: false });
    let storyView: string;
    try {
      ({ storyView } = writeGateRecords(s.dir, plan, gates));
    } catch (error) {
      if (error instanceof OfficeError && error.code === "UNSAFE_PATH") return withDetail(RECORDS, error.message);
      throw error;
    }
    if (plan.published) return basesAndOpen(s, plan.published);
    return leadSplit(s, gates.story, async (split) => {
      await goOn(s, null, true);
      const story = await hubStep("publish", PUBLISH_REFUSED, async () => {
        try {
          return await lane.link.publish({
            projectId: plan.projectId,
            title: plan.title,
            body: storyView,
            risk: plan.risk,
            key: planStoryKey(plan.id),
            graph: split.graph,
            storyVerify: split.storyVerify,
          });
        } catch (error) {
          // The Hub's own graph check refused the split: the Lead gets one more turn, as for the Office's checks.
          if (planFailure(error) === "retry-split") throw new SplitRefused(String(codeOf(error)), error instanceof Error ? error.message : "");
          throw error;
        }
      });
      log(`team: plan ${plan.id}: published as story-${story.number}${story.already ? " (already)" : ""}`);
      return basesAndOpen(s, story);
    });
  }

  /** The step of each state with Office work. Task 9 adds `design`. */
  const STEPS: Partial<Record<PlanRecord["state"], Step>> = { queued: pmStep, splitting: splitStep };

  /** Drops a lease's result for good: one line, and the lease is not asked for again until it has run out. */
  function giveUp(lease: PlanLease, line: string): null {
    pending = null;
    givenUp = { planId: lease.plan.id, leaseId: lease.leaseId, revision: lease.revision };
    restUntil = now() + PLAN_LIMITS.leaseMs;
    log(`team: plan ${lease.plan.id}: ${line}; dropped, and its lease is left to run out`);
    return null;
  }

  /** Sends a step's result for the lease it was made under (`sends`: the how-manieth time this result goes). */
  async function post(lane: PlanLane, lease: PlanLease, result: PlanResult, sends = 1): Promise<PlanResult["kind"] | null> {
    const planId = lease.plan.id;
    try {
      await lane.link.result(planId, lease.leaseId, lease.revision, result);
      pending = null;
      log(`team: plan ${planId}: posted ${result.kind}${result.kind === "failed" ? ` (${result.reason.split("\n")[0]})` : ""}`);
      return result.kind;
    } catch (error) {
      const { status, code } = (typeof error === "object" && error !== null ? error : {}) as Record<string, unknown>;
      // Refused for good: sending it again cannot help. The PL is told why, on the same lease, instead.
      if (status === 400 && !(typeof code === "string" && code.startsWith("GRAPH_"))) {
        pending = null;
        if (result.kind !== "failed") {
          const message = error instanceof Error ? error.message : "";
          return post(lane, lease, withDetail(HUB_REFUSED, `${String(code)}: ${message}`.replace(/[\s\x00-\x1f\x7f]+/g, " ")));
        }
        return giveUp(lease, `the Hub refused its failed result too (${describe(error)})`);
      }
      const kind = planFailure(error);
      if (CUT.includes(kind) || kind === "hub-too-old") {
        pending = null;
        log(`team: plan ${planId}: the Hub no longer takes this ${result.kind} result (${describe(error)}); dropped`);
        if (kind === "hub-too-old") hubTooOld();
        return null;
      }
      if (sends > MAX_RESENDS)
        return giveUp(lease, `its ${result.kind} result could not be sent ${sends} times (${describe(error)})`);
      pending = { planId, leaseId: lease.leaseId, revision: lease.revision, result, sends };
      log(
        `team: plan ${planId}: its ${result.kind} result could not be sent (${describe(error)}); sending it again on a later tick${kind === "relink" ? "; the repo link needs attention" : ""}`,
      );
      return null;
    }
  }

  /** A step's Hub call that did not go through: nothing is posted and the same lease is run again on a later tick, up
   * to MAX_RESENDS times in a row; then the PL is told, so that a Hub that keeps failing one call does not hold the
   * PL's Office (no Task claim runs in a tick a plan step ran in). */
  function notNow(lease: PlanLease, error: HubNotNow): PlanResult | null {
    const key = keyOf(lease.plan.id, lease.leaseId, lease.revision);
    const tries = unsure?.key === key ? unsure.tries + 1 : 1;
    if (tries > MAX_RESENDS) {
      unsure = null;
      kept = null;
      return withDetail(HUB_UNSURE, error.message);
    }
    unsure = { key, tries };
    log(`team: plan ${lease.plan.id}: the Hub did not answer its ${error.message}; trying again on a later tick`);
    return null;
  }

  /** Runs the leased step to its end with its heartbeat, then posts its result unless the step was cut or stopped. */
  async function runStep(lane: PlanLane, lease: PlanLease, step: Step): Promise<PlanResult["kind"] | null> {
    const { plan } = lease;
    const abort = new AbortController();
    current = abort;
    let beating = false;
    const beat = setInterval(() => {
      if (beating || abort.signal.aborted) return;
      beating = true;
      lane.link
        .heartbeat(plan.id, lease.leaseId)
        .catch((error) => {
          const kind = planFailure(error);
          if (!CUT.includes(kind) || abort.signal.aborted) return;
          log(`team: plan ${plan.id}: the Hub says this step is no longer this Office's (${describe(error)}); stopped without a result`);
          abort.abort();
        })
        .finally(() => {
          beating = false;
        });
    }, beatMs);
    beat.unref?.();
    let result: PlanResult | null;
    try {
      // The plan id names a folder: it is used only once it is a uuid.
      if (!UUID.test(plan.id)) throw new OfficeError("HUB_BAD_RESPONSE", "The Hub sent a plan id that is not a uuid.");
      const byRepo = new Map(c.lanes().map((l) => [l.repoId, l]));
      const folders = repoFolders(plan.repos);
      const missing = folders.filter((f) => !byRepo.has(f.repoId));
      result = missing.length
        ? failed(
            `레포 ${missing.map((m) => m.name).join(", ")}을(를) PL의 Mac에서 쓸 수 없습니다(연결 없음 또는 gh 로그인 필요). 내 Mac 화면에서 확인한 뒤 다시 시도하세요.`,
          )
        : await step({
            plan,
            leaseId: lease.leaseId,
            revision: lease.revision,
            lane,
            dir: join(c.root, "team", "plans", plan.id),
            repos: folders.map((f) => ({ ...f, checkout: byRepo.get(f.repoId)!.checkout })),
            signal: abort.signal,
            confirm: async () => {
              try {
                await lane.link.heartbeat(plan.id, lease.leaseId);
                return null;
              } catch (error) {
                const kind = planFailure(error);
                if (!CUT.includes(kind)) throw new HubNotNow("heartbeat", error);
                if (!abort.signal.aborted)
                  log(`team: plan ${plan.id}: the Hub says this step is no longer this Office's (${describe(error)}); stopped without a result`);
                abort.abort();
                return kind;
              }
            },
          });
    } catch (error) {
      if (abort.signal.aborted || WAITS.has(codeOf(error) ?? "")) {
        if (!abort.signal.aborted) log(`team: plan ${plan.id}: not now (${describe(error)}); trying again on a later tick`);
        result = null;
      } else if (error instanceof HubNotNow) result = notNow(lease, error);
      else result = reasonOf(error);
    } finally {
      clearInterval(beat);
      current = null;
    }
    // A cut or a stop that came after the turn returned still sends nothing.
    if (!result || abort.signal.aborted || stopped) return null;
    return post(lane, lease, result);
  }

  async function tick(): Promise<PlannerTick> {
    if (stepping || stopped) return { ran: false, why: "busy" };
    if (quietUntil !== null && now() < quietUntil) return { ran: false, why: "hub-too-old" };
    if (restUntil !== null && now() < restUntil) return { ran: false, why: "none" };
    if (!c.canStart()) return { ran: false, why: "busy" };
    const lane = c.lanes()[0];
    if (!lane) return { ran: false, why: "no-lane" };
    stepping = true;
    try {
      let lease: PlanLease | null;
      try {
        lease = await lane.link.next();
      } catch (error) {
        const kind = planFailure(error);
        if (kind === "hub-too-old") return hubTooOld();
        log(
          `team: ${lane.project}: asking the Hub for plan work failed (${describe(error)}); ${kind === "relink" ? "the repo link needs attention" : "trying again on a later tick"}`,
        );
        return { ran: false, why: "none" };
      }
      quietUntil = null;
      hubTooOldSaid = false;
      if (lease === null) {
        pending = null;
        return { ran: false, why: "none" };
      }
      const planId = lease.plan.id;
      if (pending && (pending.planId !== planId || pending.leaseId !== lease.leaseId || pending.revision !== lease.revision))
        pending = null;
      if (givenUp && givenUp.planId === planId && givenUp.leaseId === lease.leaseId && givenUp.revision === lease.revision) {
        // The Hub still holds the lease whose result was given up: leave it alone a while longer.
        restUntil = now() + PLAN_LIMITS.leaseMs;
        return { ran: false, why: "none" };
      }
      if (pending) return { ran: true, planId, posted: await post(lane, lease, pending.result, pending.sends + 1) };
      const step = STEPS[lease.plan.state];
      if (!step) {
        const line = `team: plan ${planId}: this Office cannot do its ${String(lease.plan.state)} step yet`;
        if (!said.has(line)) log(line);
        said.add(line);
        return { ran: false, why: "none" };
      }
      log(`team: plan ${planId}: leased for its ${lease.plan.state} step (revision ${lease.revision})`);
      return { ran: true, planId, posted: await runStep(lane, lease, step) };
    } finally {
      stepping = false;
    }
  }

  return {
    tick,
    active: () => stepping,
    stop() {
      stopped = true;
      pending = null;
      current?.abort();
    },
  };
}
