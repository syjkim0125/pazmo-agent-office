import { join } from "node:path";
import { OfficeError } from "../cli/project.ts";
import { PLAN_LIMITS } from "../hub/plan-protocol.ts";
import type { PlanLease, PlanQuestion, PlanRecord, PlanResult } from "../hub/plan-protocol.ts";
import type { LeanOffice } from "../lean/office.ts";
import { PlanningInvalid, teamPlanningPacket } from "../runners/planning.ts";
import type { PlanningPacket } from "../runners/planning.ts";
import { runnerAccountProblem, runnerNotReady } from "../runners/runner-account.ts";
import type { RunnerAccountProblem } from "../runners/runner-account.ts";
import { acceptTeamPm, decidedOf, dialogueOf, renderTeamStory, repoFolders } from "../runners/team-planning.ts";
import * as branch from "./branch.ts";
import type { GitEnv } from "./branch.ts";
import { planFailure } from "./plan-link.ts";
import type { PlanFailure, PlanLink } from "./plan-link.ts";
import { planTree } from "./plan-tree.ts";
import type { PlanTreeRepo } from "./plan-tree.ts";

/** How often a leased step's heartbeat goes out: well inside the Hub's 600000 ms lease. */
const BEAT_MS = 60000;
/** How long an older Hub without plan routes is left alone before it is asked again. */
const RECHECK_MS = 300000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A registered repo that is ready (Hub link and gh login) with its plan link: the Office's own checkout of it. */
export type PlanLane = { project: string; checkout: string; repoId: string; link: PlanLink };
/** The host git a plan step uses, bound to the person's git environment. */
export type PlanGit = Parameters<typeof planTree>[2];

/** `branch.ts`'s planning-tree steps bound to the person's git environment, as `branchOps` binds a Story Task's. */
export function planGitOps(env: GitEnv): PlanGit {
  return {
    fetchBaseTip: (checkout, baseBranch) => branch.fetchBaseTip(checkout, baseBranch, env),
    listTree: (checkout, sha) => branch.listTree(checkout, sha, env),
    extractTree: (checkout, sha, target) => branch.extractTree(checkout, sha, target, env),
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

/** What a step works with: the leased plan, the lane that leased it, its folder and repos (each on a lane), and the
 * signal that stops it. */
type StepInput = {
  plan: PlanRecord;
  lane: PlanLane;
  dir: string;
  repos: PlanTreeRepo[];
  signal: AbortSignal;
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
};
const UNKNOWN = "PL Mac에서 기획 단계를 마치지 못했습니다. 다시 시도하세요.";
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

/** The failure the PL sees for an error a step ended on. */
function reasonOf(error: unknown): PlanResult {
  const code = codeOf(error);
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
    const problem = runnerNotReady(observation.result.error) ?? runnerAccountProblem(observation.result.stdout ?? "");
    if (problem)
      return withDetail(
        `PL Mac의 AI 실행기(${problem.runner})를 쓸 수 없습니다: ${ACCOUNT_WORDS[problem.kind]}. 해결한 뒤 다시 시도하세요.`,
        problem.message,
      );
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
  /** The step of each state with Office work. Task 8 adds `splitting`, Task 9 `design`. */
  const STEPS: Partial<Record<PlanRecord["state"], Step>> = { queued: pmStep };

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
            lane,
            dir: join(c.root, "team", "plans", plan.id),
            repos: folders.map((f) => ({ ...f, checkout: byRepo.get(f.repoId)!.checkout })),
            signal: abort.signal,
          });
    } catch (error) {
      if (abort.signal.aborted || WAITS.has(codeOf(error) ?? "")) {
        if (!abort.signal.aborted) log(`team: plan ${plan.id}: not now (${describe(error)}); trying again on a later tick`);
        result = null;
      } else result = reasonOf(error);
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
