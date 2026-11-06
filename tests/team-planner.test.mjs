import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
import { decidedOf, renderTeamStory } from "../src/runners/team-planning.ts";
import { createPlanner } from "../src/team/planner.ts";
import {
  BE,
  FE,
  PLAN_ID,
  fakePlanGit,
  fakePlanLink,
  hubError,
  leaseOf,
  planRecord,
  round,
  scriptedTurns,
} from "./plan-fixture.mjs";

const STORY = {
  title: "주문 내역 화면",
  goal: "고객이 지난 주문을 본다.",
  domain: "주문은 바뀌지 않는다.",
  must: ["주문 목록을 보여 준다.", "API가 주문을 돌려준다."],
  should: [],
  out: ["결제."],
  assumptions: ["최근 30일만."],
  verify: [
    { must: [1], scenario: "화면에 주문이 보인다." },
    { must: [2], scenario: "API가 200을 돌려준다." },
  ],
};
const QUESTIONS = { status: "questions", questions: [{ id: "Q1", text: "어느 화면부터 만들까요?", reason: "범위가 바뀝니다." }] };
const ready = (openBlocking = [], story = STORY) => ({ status: "ready", story: { ...story, openBlocking } });

/** Lets the fakes' promise chains and the planner's file work run (a few ms at a time, up to 10 s). */
async function until(ready, what) {
  for (let i = 0; i < 2000; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting: ${what}`);
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
/** Rejects when `promise` is still pending after `ms`: a step that did not stop. */
const settles = (promise, what, ms = 5000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not settle`)), ms).unref()),
  ]);

/**
 * A planner over lanes for `names` (app-be, app-fe by default), each with a fake plan link recording into `calls`,
 * one fake engine whose turns answer `answers` in order, and fake git. `canStart` and `lanes` can be changed on the
 * returned world.
 */
function world(t, { names = ["app-be", "app-fe"], answers = [], beatMs, recheckMs, now } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-planner-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ids = { "app-be": BE, "app-fe": FE };
  const calls = [];
  const w = {
    root,
    calls,
    logs: [],
    answers,
    seen: [],
    turnsOn: [],
    state: { verifying: false },
    canStart: true,
    git: fakePlanGit({ "/co/app-be": [{ path: "src/a.ts" }], "/co/app-fe": [{ path: "web/index.html" }] }),
    lanes: names.map((name) => ({ project: `/repos/${name}`, checkout: `/co/${name}`, repoId: ids[name], link: fakePlanLink(ids[name], calls, name) })),
    get first() {
      return w.lanes[0];
    },
    results: () => calls.filter(([, what]) => what === "result"),
    lastResult: () => calls.filter(([, what]) => what === "result").at(-1)?.[5],
  };
  const turnOf = scriptedTurns(w.state, answers, w.seen);
  w.planner = createPlanner({
    root,
    lanes: () => w.lanes,
    engineOf: (project) => ({
      planTurn: (packet, candidate, signal) => {
        w.turnsOn.push(project);
        return turnOf(packet, candidate, signal);
      },
    }),
    canStart: () => w.canStart,
    git: w.git,
    beatMs,
    recheckMs,
    log: (line) => w.logs.push(line),
    now,
  });
  t.after(() => w.planner.stop());
  return w;
}
const firstLine = (reason) => reason.split("\n")[0];

test("a queued lease runs one PM turn on the leased lane's engine over the plan tree and posts questions with the lease id and revision", async (t) => {
  const w = world(t, { answers: [QUESTIONS] });
  w.first.link.lease = leaseOf(planRecord(), { leaseId: "L1", revision: 4 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "questions" });
  assert.deepEqual(w.turnsOn, ["/repos/app-be"], "one turn, on the engine of the lane that leased it");
  const { packet, candidate, signal } = w.seen[0];
  assert.equal(packet.role, "pm");
  assert.equal(packet.requestId, PLAN_ID);
  assert.equal(packet.request, planRecord().intent, "the PL's text with its line breaks");
  assert.deepEqual(packet.team.repos, [
    { folder: "app-be", baseBranch: "main" },
    { folder: "app-fe", baseBranch: "develop" },
  ]);
  assert.deepEqual(packet.dialogue, []);
  assert.ok(signal instanceof AbortSignal);
  assert.ok(verifyCandidate(candidate));
  const dir = join(w.root, "team", "plans", PLAN_ID);
  assert.ok(candidate.directory.startsWith(join(dir, "candidates")), "frozen in the plan's own folder");
  assert.ok(existsSync(join(dir, "candidate.json")));
  assert.equal(readFileSync(join(candidate.directory, "tree", "app-be", "src", "a.ts"), "utf8"), "x");
  assert.equal(readFileSync(join(candidate.directory, "tree", "app-fe", "web", "index.html"), "utf8"), "x");
  assert.deepEqual(
    w.git.calls.filter(([what]) => what === "fetchBaseTip"),
    [
      ["fetchBaseTip", "/co/app-be", "main"],
      ["fetchBaseTip", "/co/app-fe", "develop"],
    ],
    "each repo from its own lane's checkout at its base branch",
  );
  assert.deepEqual(w.calls, [
    ["app-be", "next"],
    [
      "app-be",
      "result",
      PLAN_ID,
      "L1",
      4,
      { kind: "questions", questions: [{ id: "Q1", text: "어느 화면부터 만들까요?", reason: "범위가 바뀝니다.", blocking: false }] },
    ],
  ]);
  assert.equal(w.planner.active(), false);
  // The result ended the lease: no more work.
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "none" });
  assert.equal(w.seen.length, 1);
});

test("a tick is busy while the Office cannot start a plan or a step runs, and no-lane without a ready lane", async (t) => {
  let release;
  const w = world(t, { answers: [() => new Promise((resolve) => (release = resolve)).then(() => QUESTIONS)] });
  w.first.link.lease = leaseOf(planRecord());
  w.canStart = false;
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "busy" });
  assert.deepEqual(w.calls, [], "nothing is asked of the Hub");
  w.canStart = true;
  const lanes = w.lanes;
  w.lanes = [];
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "no-lane" });
  w.lanes = lanes;
  const first = w.planner.tick();
  await until(() => w.seen.length === 1, "the turn");
  assert.equal(w.planner.active(), true);
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "busy" }, "one step at a time");
  release();
  assert.deepEqual(await first, { ran: true, planId: PLAN_ID, posted: "questions" });
  assert.equal(w.planner.active(), false);
});

test("a story with openBlocking posts Q1..Qn questions marked blocking; a clean story posts draft whose text is renderTeamStory with a PL 답 line per answered question; answers reach the packet folded to one line", async (t) => {
  const w = world(t, {
    answers: [
      ready([
        { text: "결제 내역도 보여 줄까요?", reason: "범위가 바뀝니다." },
        { text: "며칠치를 보여 줄까요?", reason: "데이터 양이 바뀝니다." },
      ]),
      ready([]),
    ],
  });
  const rounds = [round("어느 화면부터 만들까요?", "주문 목록부터.\n그다음 상세.\r\n  끝.")];
  w.first.link.lease = leaseOf(planRecord({ rounds }), { leaseId: "L1", revision: 5 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "questions" });
  assert.deepEqual(w.lastResult(), {
    kind: "questions",
    questions: [
      { id: "Q1", text: "결제 내역도 보여 줄까요?", reason: "범위가 바뀝니다.", blocking: true },
      { id: "Q2", text: "며칠치를 보여 줄까요?", reason: "데이터 양이 바뀝니다.", blocking: true },
    ],
  });
  assert.deepEqual(w.seen[0].packet.dialogue, [
    {
      questions: [{ id: "Q1", text: "어느 화면부터 만들까요?", reason: "범위가 바뀝니다." }],
      answers: [{ id: "Q1", answer: "주문 목록부터. 그다음 상세. 끝." }],
    },
  ]);

  // The PL answered the blocking round and asked for a rewrite: a new lease, a clean story.
  const answered = [...rounds, round("결제 내역도 보여 줄까요?", "아니요,\n빼 주세요.", { blocking: true })];
  const rewrite = { previous: "# Story: 이전 초안\n", note: "제목을\n바꿔 주세요." };
  w.first.link.lease = leaseOf(planRecord({ rounds: answered, rewrite }), { leaseId: "L2", revision: 7 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "draft" });
  const draft = w.lastResult();
  assert.equal(draft.kind, "draft");
  assert.equal(draft.text, renderTeamStory(STORY, decidedOf(answered)));
  assert.match(draft.text, /^- D2\. PL 답: 어느 화면부터 만들까요\? → 주문 목록부터\. 그다음 상세\. 끝\.$/m);
  assert.match(draft.text, /^- D3\. PL 답: 결제 내역도 보여 줄까요\? → 아니요, 빼 주세요\.$/m);
  assert.deepEqual(draft.story, STORY, "the story the draft renders, without openBlocking");
  assert.deepEqual(w.calls.at(-1).slice(0, 5), ["app-be", "result", PLAN_ID, "L2", 7]);
  assert.deepEqual(w.seen[1].packet.team.rewrite, { previous: "# Story: 이전 초안\n", note: "제목을 바꿔 주세요." });
  assert.equal(w.seen[1].candidate.digest, w.seen[0].candidate.digest, "every step of the plan reads the same tree");
  assert.equal(w.git.calls.filter(([what]) => what === "fetchBaseTip").length, 2, "fetched once per repo, for the first step");
});

test("a project repo with no ready lane posts failed naming that repo and runs no turn", async (t) => {
  const w = world(t, { names: ["app-be"], answers: [QUESTIONS] });
  w.first.link.lease = leaseOf(planRecord(), { leaseId: "L1", revision: 2 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "failed" });
  assert.deepEqual(w.lastResult(), {
    kind: "failed",
    reason: "레포 app-fe을(를) PL의 Mac에서 쓸 수 없습니다(연결 없음 또는 gh 로그인 필요). 내 Mac 화면에서 확인한 뒤 다시 시도하세요.",
  });
  assert.deepEqual(w.seen, [], "no turn");
  assert.deepEqual(w.git.calls, [], "no git");
  assert.equal(existsSync(join(w.root, "team", "plans", PLAN_ID)), false, "no plan folder");
});

test("a sixth question round, a draft over 32256 bytes, a runner refusal (RUNNER_NOT_READY claude) and an unreadable answer each post failed with its plain first line", async (t) => {
  const huge = { ...STORY, must: Array.from({ length: 6 }, () => "가".repeat(2000)), verify: [{ must: [1, 2, 3, 4, 5, 6], scenario: "다 된다." }] };
  const refused = { closed: true, result: { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, error: "RUNNER_NOT_READY claude: claude에 로그인하세요." } };
  const limited = {
    closed: true,
    result: {
      exitCode: 1,
      signal: null,
      stderr: "",
      timedOut: false,
      error: null,
      stdout: [{ type: "turn.started" }, { type: "turn.failed", error: { kind: "rate_limit", message: "weekly limit reached" } }]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    },
  };
  const unreadable = { closed: true, result: { exitCode: 0, signal: null, stdout: "not a report", stderr: "", timedOut: false, error: null } };
  const w = world(t, { answers: [QUESTIONS, ready([{ text: "결제는?", reason: "범위" }]), ready([], huge), refused, limited, unreadable] });
  const five = Array.from({ length: 5 }, (_, i) => round(`질문 ${i + 1}`, `답 ${i + 1}`));
  const reasons = [];
  for (const [i, rounds] of [five, five, [], [], [], []].entries()) {
    w.first.link.lease = leaseOf(planRecord({ rounds }), { leaseId: `L${i}`, revision: i + 1 });
    assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "failed" });
    reasons.push(w.lastResult().reason);
  }
  const sixth = "AI가 다섯 번 물었는데도 정할 것이 남았습니다. 하고 싶은 일을 더 자세히 적어 새 Story로 시작하세요.";
  assert.equal(reasons[0], sixth, "a sixth round of questions");
  assert.equal(reasons[1], sixth, "a sixth round of blocking decisions");
  assert.equal(reasons[2], "Story 초안이 너무 깁니다(32KB 넘음). 하고 싶은 일을 줄이거나 나눠 새 Story로 시작하세요.");
  assert.ok(Buffer.byteLength(renderTeamStory(huge, [])) > 32256);
  assert.equal(firstLine(reasons[3]), "PL Mac의 AI 실행기(claude)를 쓸 수 없습니다: 준비 안 됨. 해결한 뒤 다시 시도하세요.");
  assert.match(reasons[3], /\nclaude에 로그인하세요\./, "the runner's own hint on the next line");
  assert.equal(firstLine(reasons[4]), "PL Mac의 AI 실행기(claude)를 쓸 수 없습니다: 사용 한도. 해결한 뒤 다시 시도하세요.");
  assert.equal(firstLine(reasons[5]), "AI의 답을 읽지 못했습니다. 다시 시도하세요.");
  assert.match(reasons[5], /\n.*terminal report missing/, "what was wrong, on the next line");
  for (const reason of reasons) assert.ok(reason.length <= 4000);
});

test("planning tree failures post failed with a plain first line naming what went wrong", async (t) => {
  const w = world(t, { answers: [] });
  const cases = [
    [new OfficeError("GIT_FAILED", "app-fe: git fetch could not finish (exit 128)."), "PL Mac에서 레포를 받지 못했습니다.", /app-fe: git fetch/],
    [new OfficeError("CANDIDATE_LIMIT", "The project's repos hold 12000 files and 5 bytes."), "레포가 커서 기획 입력(파일 1만 개·100MB)을 넘습니다.", /12000 files/],
    [new OfficeError("CANDIDATE_CHANGED", "app-be: the planning tree could not be frozen (EIO)."), null, /app-be/],
    [new OfficeError("UNSAFE_PATH", "app-be: A candidate path is unsafe."), null, /app-be/],
  ];
  for (const [i, [error, plain, detail]] of cases.entries()) {
    w.git.fetchBaseTip = async () => {
      throw error;
    };
    w.first.link.lease = leaseOf(planRecord({ id: `6f1c2d3e-4a5b-4c6d-8e7f-00112233445${i}` }), { leaseId: `L${i}`, revision: 1 });
    assert.equal((await w.planner.tick()).posted, "failed");
    const reason = w.lastResult().reason;
    if (plain) assert.equal(firstLine(reason), plain);
    else assert.doesNotMatch(firstLine(reason), /[A-Z_]{6,}/, "plain words, not a code");
    assert.match(reason.split("\n").slice(1).join("\n"), detail, "the detail from the second line on");
  }
  assert.deepEqual(w.seen, [], "no turn");
});

test("the heartbeat goes every beatMs; a NOT_YOURS heartbeat aborts the turn's signal and posts nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let aborted = null;
  const hang = (_packet, _candidate, signal) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => {
        aborted = signal.aborted;
        reject(new OfficeError("CANCELLED", "The planning turn was cancelled."));
      }),
    );
  const w = world(t, { beatMs: 60000, answers: [hang, hang] });
  const link = w.first.link;
  link.lease = leaseOf(planRecord(), { leaseId: "L1", revision: 3 });
  const beats = () => w.calls.filter(([, what]) => what === "heartbeat");
  const ticking = w.planner.tick();
  await until(() => w.seen.length === 1, "the turn");
  t.mock.timers.tick(59999);
  await flush();
  assert.deepEqual(beats(), [], "no heartbeat before beatMs");
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(beats(), [["app-be", "heartbeat", PLAN_ID, "L1"]]);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(beats().length, 2);
  link.on.heartbeat = () => {
    throw hubError(409, "NOT_YOURS");
  };
  t.mock.timers.tick(60000);
  assert.deepEqual(await settles(ticking, "the cut step"), { ran: true, planId: PLAN_ID, posted: null });
  assert.equal(aborted, true, "the turn's signal was aborted");
  assert.deepEqual(w.results(), [], "nothing is posted");
  assert.equal(w.planner.active(), false);
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(beats().length, 3, "the step's heartbeat stopped with it");

  // STATE (the PL cancelled the plan) stops the step the same way.
  aborted = null;
  link.on.heartbeat = () => {
    throw hubError(409, "STATE");
  };
  link.lease = leaseOf(planRecord(), { leaseId: "L2", revision: 4 });
  const second = w.planner.tick();
  await until(() => w.seen.length === 2, "the second turn");
  t.mock.timers.tick(60000);
  assert.deepEqual(await settles(second, "the second cut step"), { ran: true, planId: PLAN_ID, posted: null });
  assert.equal(aborted, true);
  assert.deepEqual(w.results(), []);
});

test("a result that failed to send is sent on the next tick for the same lease without a second turn; a stale result is dropped", async (t) => {
  const w = world(t, { answers: [QUESTIONS, QUESTIONS, QUESTIONS, QUESTIONS, QUESTIONS] });
  const link = w.first.link;
  let refuse = hubError(503, "HUB_UNAVAILABLE");
  link.on.result = () => {
    if (refuse) throw refuse;
  };
  link.lease = leaseOf(planRecord(), { leaseId: "L1", revision: 2 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: null });
  assert.equal(w.results().length, 1);
  // The Hub is back and hands the same lease again: the remembered result goes, with no second turn.
  refuse = null;
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "questions" });
  assert.equal(w.seen.length, 1, "no second turn");
  assert.deepEqual(w.results().map((call) => call.slice(2)), [
    [PLAN_ID, "L1", 2, w.results()[0][5]],
    [PLAN_ID, "L1", 2, w.results()[0][5]],
  ]);

  // A remembered result whose lease moved on (another revision) is not sent: the new lease gets its own turn.
  refuse = hubError(503, "HUB_UNAVAILABLE");
  link.lease = leaseOf(planRecord(), { leaseId: "L2", revision: 3 });
  assert.equal((await w.planner.tick()).posted, null);
  refuse = null;
  link.lease = leaseOf(planRecord(), { leaseId: "L3", revision: 4 });
  assert.equal((await w.planner.tick()).posted, "questions");
  assert.equal(w.seen.length, 3);
  assert.deepEqual(w.results().at(-1).slice(2, 5), [PLAN_ID, "L3", 4]);

  // STALE: the plan moved on; the result is dropped, never sent again.
  refuse = hubError(409, "STALE");
  link.lease = leaseOf(planRecord(), { leaseId: "L4", revision: 5 });
  assert.equal((await w.planner.tick()).posted, null);
  refuse = null;
  const sent = w.results().length;
  assert.equal((await w.planner.tick()).posted, "questions");
  assert.equal(w.seen.length, 5, "a fresh turn, not the dropped result");
  assert.equal(w.results().length, sent + 1);
  assert.ok(w.logs.some((line) => line.includes(PLAN_ID) && line.includes("STALE")), w.logs.join("\n"));
});

test("a Hub without plan routes is said once and asked again after recheckMs", async (t) => {
  let clock = 1_700_000_000_000;
  const w = world(t, { recheckMs: 300000, now: () => clock });
  const link = w.first.link;
  link.nextError = hubError(404, "NOT_FOUND");
  const nexts = () => w.calls.filter(([, what]) => what === "next").length;
  const said = () => w.logs.filter((line) => line.includes("plan"));
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "hub-too-old" });
  assert.equal(nexts(), 1);
  assert.equal(said().length, 1, w.logs.join("\n"));
  clock += 299999;
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "hub-too-old" });
  assert.equal(nexts(), 1, "not asked again before recheckMs");
  clock += 1;
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "hub-too-old" });
  assert.equal(nexts(), 2);
  assert.equal(said().length, 1, "said once");
  // The Hub was updated.
  link.nextError = null;
  clock += 300000;
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "none" });
  assert.equal(nexts(), 3);
});
