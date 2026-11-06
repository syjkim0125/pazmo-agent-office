import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
import { planTextHash } from "../src/hub/plan-protocol.ts";
import { approvedStory, decidedOf, renderTeamDesign, renderTeamStory, repoFolders } from "../src/runners/team-planning.ts";
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
  const make = () =>
    createPlanner({
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
  w.planner = make();
  /** A new planner over the same data root, Hub and git: the Office restarted. */
  w.restart = () => {
    w.planner.stop();
    w.planner = make();
  };
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

/** A Hub refusal as hubCall throws it: the Hub's message, its code and status. */
const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });
const REFUSED = "Hub가 이 Office의 결과를 받지 않았습니다(Hub와 Office 버전이 다를 수 있습니다). Office를 업데이트한 뒤 다시 시도하세요.";

test("a result the Hub refuses with 400 posts one failed in its place on the same lease, and nothing is sent again for that lease", async (t) => {
  const w = world(t, { answers: [QUESTIONS, QUESTIONS] });
  const link = w.first.link;
  link.on.result = (r) => {
    if (r.kind === "questions") throw refusal(400, "INVALID", "질문 차례는 5번까지입니다.");
  };
  link.lease = leaseOf(planRecord(), { leaseId: "L1", revision: 3 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "failed" });
  assert.deepEqual(
    w.results().map((call) => [...call.slice(2, 5), call[5].kind]),
    [
      [PLAN_ID, "L1", 3, "questions"],
      [PLAN_ID, "L1", 3, "failed"],
    ],
    "one failed, on the same lease and revision",
  );
  assert.equal(w.lastResult().reason, `${REFUSED}\nINVALID: 질문 차례는 5번까지입니다.`);
  for (let i = 0; i < 3; i++) assert.deepEqual(await w.planner.tick(), { ran: false, why: "none" });
  assert.equal(w.results().length, 2, "nothing is sent again");
  assert.equal(w.seen.length, 1, "and no second turn");
});

test("a failed the Hub also refuses with 400 is dropped and logged once; no turn runs again for that lease until it runs out", async (t) => {
  let clock = 1_700_000_000_000;
  const w = world(t, { answers: [QUESTIONS, QUESTIONS], now: () => clock });
  const link = w.first.link;
  link.on.result = () => {
    throw refusal(400, "INVALID", "결과를 읽을 수 없습니다.");
  };
  const lease = leaseOf(planRecord(), { leaseId: "L1", revision: 3 });
  link.lease = lease;
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: null });
  assert.deepEqual(w.results().map((call) => call[5].kind), ["questions", "failed"], "the failed in its place, once");
  const dropped = () => w.logs.filter((line) => line.includes(PLAN_ID) && line.includes("dropped"));
  assert.equal(dropped().length, 1, w.logs.join("\n"));
  // The Hub still holds the lease: it is not asked for, so the lease can run out; Task claims go on.
  const nexts = () => w.calls.filter(([, what]) => what === "next").length;
  for (let i = 0; i < 3; i++) {
    clock += 30000;
    assert.deepEqual(await w.planner.tick(), { ran: false, why: "none" });
  }
  assert.equal(nexts(), 1);
  assert.equal(w.results().length, 2);
  assert.equal(w.seen.length, 1);
  assert.equal(dropped().length, 1, "logged once");
  // A Hub that still hands out the same lease afterwards gets no turn for it either.
  clock += 600000;
  link.on.result = undefined;
  assert.deepEqual(link.lease, lease);
  assert.deepEqual(await w.planner.tick(), { ran: false, why: "none" });
  assert.equal(nexts(), 2);
  assert.equal(w.seen.length, 1);
  // Once the lease has run out (600000 ms without a heartbeat) the Hub leases the plan again: a new lease, a new turn.
  clock += 600000;
  link.lease = leaseOf(planRecord(), { leaseId: "L2", revision: 3 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "questions" });
  assert.equal(w.seen.length, 2);

  // A failed result refused with 400 is dropped as it is: no second failed.
  const lone = world(t, { names: ["app-be"], now: () => clock });
  lone.first.link.on.result = () => {
    throw refusal(400, "INVALID", "실패 이유는 1~4000자여야 합니다.");
  };
  lone.first.link.lease = leaseOf(planRecord(), { leaseId: "L9", revision: 1 });
  assert.deepEqual(await lone.planner.tick(), { ran: true, planId: PLAN_ID, posted: null });
  assert.deepEqual(lone.results().map((call) => call[5].kind), ["failed"]);
  assert.equal(lone.logs.filter((line) => line.includes("dropped")).length, 1, lone.logs.join("\n"));
  assert.deepEqual(await lone.planner.tick(), { ran: false, why: "none" });
  assert.equal(lone.results().length, 1);
});

test("a result that keeps getting 5xx is resent at most 3 times, then dropped and logged once", async (t) => {
  const w = world(t, { answers: [QUESTIONS] });
  const link = w.first.link;
  link.on.result = () => {
    throw hubError(503, "HUB_UNAVAILABLE");
  };
  link.lease = leaseOf(planRecord(), { leaseId: "L1", revision: 2 });
  for (let i = 0; i < 4; i++) assert.equal((await w.planner.tick()).ran, true);
  assert.equal(w.results().length, 4, "sent once and resent 3 times");
  for (let i = 0; i < 3; i++) assert.deepEqual(await w.planner.tick(), { ran: false, why: "none" });
  assert.equal(w.results().length, 4, "never more");
  assert.equal(w.seen.length, 1, "one turn");
  assert.equal(w.logs.filter((line) => line.includes(PLAN_ID) && line.includes("dropped")).length, 1, w.logs.join("\n"));
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

// Task 8: the splitting step of a normal-risk plan after its G1.
const SPLIT_ROUNDS = [round("기간은?", "최근\n30일")];
const DRAFT = renderTeamStory(STORY, decidedOf(SPLIT_ROUNDS));
const G1 = {
  approvalId: "0b6d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4",
  gate: "G1",
  memberId: "m-pl",
  at: Date.UTC(2026, 10, 6, 23, 30),
  textHash: planTextHash(DRAFT),
};
/** The approved draft the Hub Story carries. */
const VIEW = approvedStory(DRAFT, G1);
/** A normal-risk plan leased for its splitting step after the PL's G1 of DRAFT. */
const splitting = (over = {}) =>
  planRecord({ state: "splitting", rounds: SPLIT_ROUNDS, draft: { text: DRAFT, story: JSON.parse(JSON.stringify(STORY)) }, g1: G1, ...over });
const planId = (n) => `6f1c2d3e-4a5b-4c6d-8e7f-0011223344${String(n).padStart(2, "0")}`;
const BE_TIP = "be".repeat(20);
const FE_TIP = "fe".repeat(20);
const check = (id, file = "tests/orders.test.mjs") => ({ id, argv: ["node", "--test", file], timeoutMs: 30000 });
const beTask = (over = {}) => ({
  title: "주문 API",
  outcome: "API가 주문을 돌려준다.",
  scope: "주문 라우트.",
  constraints: "응답 모양을 지킨다.",
  must: [2],
  verify: [2],
  checks: [check("V2")],
  repo: "app-be",
  files: ["src/orders.ts"],
  after: [],
  ...over,
});
const feTask = (over = {}) => ({
  title: "주문 화면",
  outcome: "화면에 주문이 보인다.",
  scope: "주문 화면.",
  constraints: "디자인 체계를 따른다.",
  must: [1],
  verify: [1],
  checks: [check("V1", "tests/orders-page.test.mjs")],
  repo: "app-fe",
  files: ["src/orders-page.tsx"],
  after: [1],
  ...over,
});
/** A Lead split the Office's checks and the Hub's take: the API in app-be, then the page in app-fe. */
const LEAD = {
  plan: "API를 먼저 만들고 화면은 그 뒤에 붙인다.",
  tasks: [beTask(), feTask()],
  storyVerify: [
    { repo: "app-be", checks: [check("V2")] },
    { repo: "app-fe", checks: [check("V1", "tests/orders-page.test.mjs")] },
  ],
};
/** P5: no task covers Story MUST 1 and Verify 1. */
const UNCOVERED = { ...LEAD, tasks: [beTask()], storyVerify: [{ repo: "app-be", checks: [check("V2")] }] };
/** The Hub's own graph check refuses it: two app-be tasks change src/orders.ts with no order between them. */
const OVERLAP = { ...LEAD, tasks: [beTask(), feTask({ repo: "app-be", files: ["src/orders.ts"], after: [] })] };
const TWICE = "AI가 Task를 두 번 나눴지만 검사를 통과하지 못했습니다.";
const planDir = (w, id = PLAN_ID) => join(w.root, "team", "plans", id);
const named = (w, call) => w.calls.filter(([, what]) => what === call);
const pushes = (w) => w.git.calls.filter(([what]) => what === "pushStoryBase");
const fetches = (w) => w.git.calls.filter(([what]) => what === "fetchBaseTip");

test("a splitting lease checks the gates, writes the records, runs one Lead turn, publishes with key plan:<planId>, the plan's title, the approved story as body and risk normal, makes every Story repo's base at its recorded base branch tip, opens and posts open", async (t) => {
  const w = world(t, { answers: [LEAD] });
  w.git.tips = { "/co/app-be": BE_TIP, "/co/app-fe": FE_TIP };
  const link = w.first.link;
  let pushedAtOpen = null;
  link.on.open = () => {
    pushedAtOpen = pushes(w).length;
  };
  link.lease = leaseOf(splitting(), { leaseId: "L1", revision: 9 });

  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "open" });
  const dir = planDir(w);
  assert.equal(readFileSync(join(dir, "story.md"), "utf8"), VIEW, "the gate records are in the plan's folder");
  assert.equal(JSON.parse(readFileSync(join(dir, "g1.json"), "utf8")).responseRef, `hub-approval:${G1.approvalId}`);
  assert.equal(w.seen.length, 1, "one Lead turn");
  const { packet } = w.seen[0];
  assert.equal(packet.role, "lead");
  assert.deepEqual(packet.story, STORY);
  assert.equal(packet.team.retry, null);
  assert.deepEqual(packet.team.repos, [
    { folder: "app-be", baseBranch: "main" },
    { folder: "app-fe", baseBranch: "develop" },
  ]);
  const published = named(w, "publish");
  assert.equal(published.length, 1);
  const { graph, storyVerify, ...input } = published[0][2];
  assert.deepEqual(input, { projectId: "p-1", title: "주문 내역 화면", body: VIEW, risk: "normal", key: `plan:${PLAN_ID}` });
  assert.deepEqual(
    graph.nodes.map((n) => [n.id, n.repoId, n.title, n.files]),
    [
      ["t1", BE, "주문 API", ["src/orders.ts"]],
      ["t2", FE, "주문 화면", ["src/orders-page.tsx"]],
    ],
  );
  assert.deepEqual(graph.edges, [{ from: "t1", to: "t2" }]);
  assert.deepEqual(storyVerify.map((v) => v.repoId), [BE, FE]);

  assert.deepEqual(JSON.parse(readFileSync(join(dir, "bases.json"), "utf8")), { [BE]: BE_TIP, [FE]: FE_TIP });
  assert.equal(statSync(join(dir, "bases.json")).mode & 0o777, 0o600);
  assert.deepEqual(fetches(w).slice(-2), [
    ["fetchBaseTip", "/co/app-be", "main"],
    ["fetchBaseTip", "/co/app-fe", "develop"],
  ]);
  assert.deepEqual(pushes(w), [
    ["pushStoryBase", "/co/app-be", "feature/story-7/base", BE_TIP],
    ["pushStoryBase", "/co/app-fe", "feature/story-7/base", FE_TIP],
  ]);
  assert.equal(pushedAtOpen, 2, "every base was made before open");
  assert.deepEqual(
    w.calls.map(([, what]) => what),
    ["next", "heartbeat", "publish", "story", "heartbeat", "open", "result"],
    "the plan is confirmed right before publish and right before open",
  );
  assert.deepEqual(named(w, "heartbeat").map((call) => call.slice(2)), [
    [PLAN_ID, "L1"],
    [PLAN_ID, "L1"],
  ]);
  assert.deepEqual(w.calls.at(-1).slice(2), [PLAN_ID, "L1", 9, { kind: "open", storyId: "story-7" }]);
  assert.equal(link.stories.get("story-7").state, "open");
});

test("every base is pushed before open; a failing base posts failed naming the repo and open is never called; the Hub Story stays draft", async (t) => {
  let treeDone = false;
  const lead = () => {
    treeDone = true;
    return LEAD;
  };
  const w = world(t, { answers: [LEAD, LEAD, lead] });
  const link = w.first.link;
  // The app-fe origin refuses the new branch (a protected-branch rule).
  w.git.on.pushStoryBase = (checkout) => {
    if (checkout === "/co/app-fe")
      throw new OfficeError("GIT_FAILED", "! [remote rejected] feature/story-7/base (pre-receive hook declined)");
  };
  link.lease = leaseOf(splitting(), { leaseId: "L1", revision: 9 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "failed" });
  const reason = w.lastResult().reason;
  assert.match(firstLine(reason), /app-fe/);
  assert.doesNotMatch(firstLine(reason), /app-be|[A-Z_]{6,}/);
  assert.match(reason, /\n! \[remote rejected\] feature\/story-7\/base \(pre-receive hook declined\)$/);
  assert.deepEqual(pushes(w).map(([, checkout]) => checkout), ["/co/app-be", "/co/app-fe"]);
  assert.deepEqual(named(w, "open"), [], "open is never called");
  assert.equal(link.stories.get("story-7").state, "draft");

  // Another commit already at app-be's base: BASE_EXISTS, naming the repo, and app-fe's base is not made.
  w.git.on.pushStoryBase = undefined;
  w.git.remote["/co/app-be feature/story-8/base"] = "0".repeat(40);
  link.lease = leaseOf(splitting({ id: planId(61) }), { leaseId: "L2", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.equal(
    w.lastResult().reason,
    "레포 app-be: 레포에 feature/story-8/base가 이미 다른 커밋으로 있습니다. 그 브랜치를 확인한 뒤 다시 시도하세요.",
  );
  assert.equal(w.git.remote["/co/app-fe feature/story-8/base"], undefined);
  assert.deepEqual(named(w, "open"), []);
  assert.equal(link.stories.get("story-8").state, "draft");

  // A base branch that cannot be fetched names its repo: nothing is recorded or pushed for that Story.
  const fetch = w.git.fetchBaseTip;
  w.git.fetchBaseTip = async (checkout, base) => {
    if (treeDone && checkout === "/co/app-fe") throw new OfficeError("GIT_FAILED", "fatal: couldn't find remote ref develop");
    return fetch(checkout, base);
  };
  link.lease = leaseOf(splitting({ id: planId(62) }), { leaseId: "L3", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.match(firstLine(w.lastResult().reason), /app-fe/);
  assert.match(w.lastResult().reason, /\nfatal: couldn't find remote ref develop$/);
  assert.equal(existsSync(join(planDir(w, planId(62)), "bases.json")), false);
  assert.equal(pushes(w).filter(([, , base]) => base === "feature/story-9/base").length, 0);
  assert.deepEqual(named(w, "open"), []);
  assert.equal(link.stories.get("story-9").state, "draft");
});


test("a P5 failure, a SPLIT_REFUSED graph or a publish answered 400 GRAPH_OVERLAP runs the Lead once more with the reason in the packet's retry; a second refusal posts failed", async (t) => {
  const w = world(t, { answers: [UNCOVERED, LEAD, OVERLAP, LEAD, LEAD, LEAD, UNCOVERED, OVERLAP, LEAD, LEAD] });
  const link = w.first.link;
  const hubSays = "Task t1와 t2가 같은 파일(src/orders.ts)을 건드리는데 실행 순서가 없습니다. 의존선으로 순서를 정하거나 파일을 나누세요.";
  let refuse = 0;
  link.on.publish = () => {
    if (refuse > 0) {
      refuse -= 1;
      throw refusal(400, "GRAPH_OVERLAP", hubSays);
    }
  };
  const run = async (n, posted) => {
    link.lease = leaseOf(splitting({ id: planId(n) }), { leaseId: `L${n}`, revision: 1 });
    assert.equal((await w.planner.tick()).posted, posted);
  };
  const retries = () => w.seen.map(({ packet }) => packet.team.retry);

  // P5: the Office's coverage check.
  await run(70, "open");
  assert.deepEqual(retries(), [null, "report.tasks: M1 not covered"]);
  assert.equal(named(w, "publish").length, 1, "only the second split is published");
  // SPLIT_REFUSED: the Hub's own graph check, run by the Office before publishing.
  await run(71, "open");
  assert.match(retries()[3], /^GRAPH_OVERLAP: Task t1와 t2가 같은 파일\(src\/orders\.ts\)/);
  assert.equal(named(w, "publish").length, 2);
  // The Hub's publish refuses the graph: the same one more turn, with the Hub's reason.
  refuse = 1;
  await run(72, "open");
  assert.deepEqual(retries().slice(4), [null, `GRAPH_OVERLAP: ${hubSays}`]);
  assert.equal(named(w, "publish").length, 4);
  assert.equal(link.stories.size, 3, "the refused publish made no Story");

  // A second refusal: failed with the reason, nothing published.
  await run(73, "failed");
  assert.equal(firstLine(w.lastResult().reason), TWICE);
  assert.match(w.lastResult().reason, /\nGRAPH_OVERLAP: /);
  assert.equal(retries()[7].startsWith("report.tasks: M1 not covered"), true);
  assert.equal(named(w, "publish").length, 4);
  // The Hub refuses both splits.
  refuse = 2;
  await run(74, "failed");
  assert.equal(firstLine(w.lastResult().reason), TWICE);
  assert.match(w.lastResult().reason, /\nGRAPH_OVERLAP: Task t1와 t2/);
  assert.equal(named(w, "publish").length, 6);
  assert.equal(w.seen.length, 10, "never a third Lead turn");
  assert.deepEqual(named(w, "open").length, 3);
});

test("a retry (or an Office restarted mid-split) sees published on the lease: no Lead turn, the same Story (already true), the recorded commits reused even after main moved, a base already at that commit kept, and an open answered STATE on an open Story counts as opened", async (t) => {
  const w = world(t, { answers: [LEAD] });
  w.git.tips = { "/co/app-be": BE_TIP, "/co/app-fe": FE_TIP };
  const link = w.first.link;
  w.git.on.pushStoryBase = (checkout) => {
    if (checkout === "/co/app-fe") throw new OfficeError("GIT_FAILED", "! [remote rejected] (permission denied)");
  };
  link.lease = leaseOf(splitting(), { leaseId: "L1", revision: 9 });
  assert.equal((await w.planner.tick()).posted, "failed");
  const recorded = readFileSync(join(planDir(w), "bases.json"), "utf8");
  assert.equal(w.git.remote["/co/app-be feature/story-7/base"], BE_TIP);
  assert.equal(link.stories.get("story-7").state, "draft");

  // The PL fixed the permission and pressed 다시 시도. Meanwhile both base branches moved and the Office restarted.
  w.git.on.pushStoryBase = undefined;
  w.git.tips = { "/co/app-be": "b0".repeat(20), "/co/app-fe": "f0".repeat(20) };
  w.restart();
  // An earlier open landed but its reply was lost: asked again, the Hub answers STATE on an open Story.
  link.on.open = (id) => {
    link.stories.get(id).state = "open";
    throw hubError(409, "STATE");
  };
  const turns = w.seen.length;
  const published = named(w, "publish").length;
  const fetched = fetches(w).length;
  link.lease = leaseOf(splitting({ published: { storyId: "story-7", number: 7, state: "draft" } }), { leaseId: "L2", revision: 11 });

  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "open" });
  assert.equal(w.seen.length, turns, "no Lead turn");
  assert.equal(named(w, "publish").length, published, "no second publish");
  assert.equal(fetches(w).length, fetched, "the recorded commits, not the moved tips");
  assert.equal(readFileSync(join(planDir(w), "bases.json"), "utf8"), recorded);
  assert.deepEqual(pushes(w).slice(-2), [
    ["pushStoryBase", "/co/app-be", "feature/story-7/base", BE_TIP],
    ["pushStoryBase", "/co/app-fe", "feature/story-7/base", FE_TIP],
  ]);
  assert.equal(w.git.remote["/co/app-be feature/story-7/base"], BE_TIP, "the base the first attempt made is kept");
  assert.equal(w.git.remote["/co/app-fe feature/story-7/base"], FE_TIP);
  assert.equal(named(w, "open").length, 1);
  assert.deepEqual(w.calls.at(-1).slice(2), [PLAN_ID, "L2", 11, { kind: "open", storyId: "story-7" }]);
});

test("a gate failure posts failed before any Lead turn or publish", async (t) => {
  const w = world(t, { answers: [LEAD] });
  const link = w.first.link;
  const cases = [
    [splitting({ id: planId(80), g1: { ...G1, memberId: "m-other" } }), "Story 승인 기록이 이 기획의 PL 것이 아닙니다."],
    [splitting({ id: planId(81), g1: { ...G1, textHash: planTextHash(`${DRAFT}\n`) } }), "승인한 초안과 지금 초안이 다릅니다. 취소하고 새 Story로 시작하세요."],
  ];
  for (const [i, [plan, reason]] of cases.entries()) {
    link.lease = leaseOf(plan, { leaseId: `L${i}`, revision: 1 });
    assert.equal((await w.planner.tick()).posted, "failed");
    assert.equal(w.lastResult().reason, reason);
    assert.equal(existsSync(join(planDir(w, plan.id), "story.md")), false, "no record");
  }

  // A record the plan's folder already holds with other bytes, or a plan folder that is a link: a plain reason, not
  // the planning tree's sentence or a code.
  mkdirSync(planDir(w, planId(82)), { recursive: true });
  writeFileSync(join(planDir(w, planId(82)), "story.md"), "# Story: 다른 글\n");
  mkdirSync(join(w.root, "elsewhere"));
  symlinkSync(join(w.root, "elsewhere"), planDir(w, planId(83)));
  for (const [i, id] of [planId(82), planId(83)].entries()) {
    link.lease = leaseOf(splitting({ id }), { leaseId: `M${i}`, revision: 1 });
    assert.equal((await w.planner.tick()).posted, "failed");
    const first = firstLine(w.lastResult().reason);
    assert.doesNotMatch(first, /[A-Z_]{6,}/);
    assert.doesNotMatch(first, /기획 입력으로 옮길 수 없는 경로/);
  }
  assert.match(firstLine(w.lastResult().reason), /기획 기록을 쓸 수 없습니다/);
  assert.deepEqual(readFileSync(join(planDir(w, planId(82)), "story.md"), "utf8"), "# Story: 다른 글\n", "kept as it was");
  assert.deepEqual(w.seen, [], "no Lead turn");
  assert.deepEqual(named(w, "publish"), [], "nothing published");
  assert.deepEqual(w.git.calls, [], "no git");
});

test("a plan cancelled before publish publishes nothing; one cancelled after publish has its draft Story cancelled by the Office, is not opened and posts nothing", async (t) => {
  const w = world(t, { answers: [LEAD, LEAD, LEAD] });
  const link = w.first.link;
  link.on.heartbeat = () => {
    throw hubError(409, "STATE");
  };
  link.lease = leaseOf(splitting(), { leaseId: "L1", revision: 9 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: null });
  assert.deepEqual(named(w, "publish"), []);
  assert.deepEqual(w.results(), []);

  // The PL cancels between publish and open: the Hub's cancel did not see the Story, so the Office cancels it.
  let beats = 0;
  link.on.heartbeat = () => {
    beats += 1;
    if (beats === 2) throw hubError(409, "STATE");
  };
  link.lease = leaseOf(splitting({ id: planId(90) }), { leaseId: "L2", revision: 1 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(90), posted: null });
  assert.equal(named(w, "publish").length, 1);
  assert.deepEqual(named(w, "cancel").map((call) => call[2]), ["story-7"]);
  assert.equal(link.stories.get("story-7").state, "cancelled");
  assert.deepEqual(named(w, "open"), []);
  assert.deepEqual(w.results(), []);
  assert.ok(w.logs.some((line) => line.includes(planId(90)) && line.includes("story-7") && line.includes("cancel")), w.logs.join("\n"));

  // Another Office of the PL took the lease over (NOT_YOURS): the plan is not cancelled, so its Story is left alone.
  beats = 0;
  link.on.heartbeat = () => {
    beats += 1;
    if (beats === 2) throw hubError(409, "NOT_YOURS");
  };
  link.lease = leaseOf(splitting({ id: planId(91) }), { leaseId: "L3", revision: 1 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(91), posted: null });
  assert.equal(named(w, "cancel").length, 1);
  assert.equal(link.stories.get("story-8").state, "draft");
  assert.deepEqual(named(w, "open"), []);
  assert.deepEqual(w.results(), []);
});

test("a publish or open the Hub refuses for good posts failed with a plain reason; a 5xx is tried again on the next tick of the same lease without another Lead turn, and the fourth one posts failed; a published Story cancelled meanwhile gets no base", async (t) => {
  const w = world(t, { answers: [LEAD, LEAD, LEAD, LEAD, LEAD] });
  const link = w.first.link;
  link.on.publish = () => {
    throw refusal(404, "NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
  };
  link.lease = leaseOf(splitting({ id: planId(1) }), { leaseId: "L1", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.doesNotMatch(firstLine(w.lastResult().reason), /[A-Z_]{6,}/);
  assert.match(w.lastResult().reason, /\n.*NOT_FOUND.*프로젝트를 찾을 수 없습니다\./);
  assert.equal(w.logs.some((line) => line.includes("older Hub")), false, "never hub-too-old");

  // 503 twice, then the Hub takes it: the kept split is published, with no second Lead turn.
  let down = 2;
  link.on.publish = () => {
    if (down > 0) {
      down -= 1;
      throw hubError(503, "HUB_UNAVAILABLE");
    }
  };
  link.lease = leaseOf(splitting({ id: planId(2) }), { leaseId: "L2", revision: 1 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(2), posted: null });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(2), posted: null });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(2), posted: "open" });
  assert.equal(w.seen.length, 2, "one Lead turn for that plan");
  assert.equal(named(w, "publish").length, 4);

  // Always 503: tried four times, then failed with a plain reason.
  link.on.publish = () => {
    throw hubError(503, "HUB_UNAVAILABLE");
  };
  link.lease = leaseOf(splitting({ id: planId(3) }), { leaseId: "L3", revision: 1 });
  for (let i = 0; i < 3; i++) assert.equal((await w.planner.tick()).posted, null);
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.doesNotMatch(firstLine(w.lastResult().reason), /[A-Z_]{6,}/);
  assert.match(w.lastResult().reason, /\n.*503/);
  assert.equal(w.seen.length, 3);

  // An open refused for good (403): failed, plain.
  link.on.publish = undefined;
  link.on.open = () => {
    throw refusal(403, "FORBIDDEN", "Story의 PL만 열 수 있습니다.");
  };
  link.lease = leaseOf(splitting({ id: planId(4) }), { leaseId: "L4", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.doesNotMatch(firstLine(w.lastResult().reason), /[A-Z_]{6,}/);
  assert.match(w.lastResult().reason, /\n.*FORBIDDEN.*Story의 PL만 열 수 있습니다\./);
  const story = [...link.stories.values()].at(-1);
  assert.equal(story.state, "draft");

  // That Story is cancelled on the Hub before the PL retries: no base is made for it and it is not opened.
  link.on.open = undefined;
  story.state = "cancelled";
  const pushed = pushes(w).length;
  link.lease = leaseOf(splitting({ id: planId(4), published: { storyId: story.id, number: story.number, state: "cancelled" } }), { leaseId: "L5", revision: 2 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.doesNotMatch(firstLine(w.lastResult().reason), /[A-Z_]{6,}/);
  assert.equal(pushes(w).length, pushed);
  assert.equal(story.state, "cancelled");
});

test("a step the periodic heartbeat cut while it published makes no base: the plan was cancelled, so its draft Story is cancelled; a step stopped with the Office writes nothing more", async (t) => {
  const w = world(t, { answers: [LEAD, LEAD], beatMs: 5 });
  const link = w.first.link;
  link.on.publish = () => new Promise((resolve) => setTimeout(resolve, 60));
  // Cancelled on the Hub once the Office has sent its publish: every heartbeat after that answers STATE.
  link.on.heartbeat = () => {
    if (named(w, "publish").length) throw hubError(409, "STATE");
  };
  link.lease = leaseOf(splitting(), { leaseId: "L1", revision: 9 });
  assert.deepEqual(await settles(w.planner.tick(), "the cut step"), { ran: true, planId: PLAN_ID, posted: null });
  assert.deepEqual(pushes(w), [], "no base for a cancelled plan");
  assert.deepEqual(named(w, "cancel").map((call) => call[2]), ["story-7"]);
  assert.deepEqual(named(w, "open"), []);
  assert.deepEqual(w.results(), []);

  // The Office stops while the step publishes: nothing after the publish reaches the Hub or an origin.
  link.on.heartbeat = undefined;
  link.on.publish = () => {
    w.planner.stop();
  };
  link.lease = leaseOf(splitting({ id: planId(95) }), { leaseId: "L2", revision: 1 });
  assert.deepEqual(await settles(w.planner.tick(), "the stopped step"), { ran: true, planId: planId(95), posted: null });
  assert.deepEqual(pushes(w), []);
  assert.deepEqual(named(w, "open"), []);
  assert.equal(link.stories.get("story-8").state, "draft");
  assert.deepEqual(w.results(), []);
});

// Task 9: a high-risk plan's design step after its G1, and its splitting step after the PL's G3 of that design.
/** A high-risk plan leased for its design step after the PL's G1 of DRAFT. */
const designing = (over = {}) => splitting({ state: "design", risk: "high", ...over });
/** The design LEAD renders to: the Lead's plan, then one line per Task with its folder and the Tasks it waits for. */
const DESIGN_TEXT =
  "# Decision requiring human G3\n\nAPI를 먼저 만들고 화면은 그 뒤에 붙인다.\n\n## Task 목록\n- t1 · app-be · 주문 API\n- t2 · app-fe · 주문 화면(앞: t1)\n\nUnderstanding gate (G3): pending\n";
const g3Of = (text, over = {}) => ({
  approvalId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  gate: "G3",
  memberId: "m-pl",
  at: Date.UTC(2026, 10, 7, 1, 0),
  textHash: planTextHash(text),
  ...over,
});
/** The high-risk plan after the PL's G3 of a design result's `text`, leased for its splitting step: the Hub hands
 * back the split as the JSON it stored. */
const approvedDesign = ({ text, split }, over = {}) =>
  designing({ state: "splitting", design: text, split: JSON.parse(JSON.stringify(split)), g3: g3Of(text), ...over });
const G3_REFUSED = "설계 승인 기록이 맞지 않습니다.";

test("a design lease checks G1, runs the Lead turn and posts design with the decision.md text and the split; nothing is published and no base is made", async (t) => {
  const w = world(t, { answers: [LEAD] });
  const link = w.first.link;
  link.lease = leaseOf(designing(), { leaseId: "L1", revision: 6 });

  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "design" });
  assert.equal(w.seen.length, 1, "one Lead turn");
  const { packet } = w.seen[0];
  assert.equal(packet.role, "lead");
  assert.equal(packet.risk, "high");
  assert.deepEqual(packet.story, STORY);
  assert.equal(packet.team.retry, null);
  const result = w.lastResult();
  assert.deepEqual(Object.keys(result).sort(), ["kind", "split", "text"]);
  assert.equal(result.kind, "design");
  assert.equal(result.text, DESIGN_TEXT);
  assert.equal(result.text, renderTeamDesign(result.split, repoFolders(planRecord().repos)));
  assert.equal(result.split.plan, LEAD.plan);
  assert.deepEqual(
    result.split.graph.nodes.map((n) => [n.id, n.repoId, n.title, n.files]),
    [
      ["t1", BE, "주문 API", ["src/orders.ts"]],
      ["t2", FE, "주문 화면", ["src/orders-page.tsx"]],
    ],
  );
  assert.deepEqual(result.split.graph.edges, [{ from: "t1", to: "t2" }]);
  assert.deepEqual(result.split.storyVerify.map((v) => v.repoId), [BE, FE]);
  assert.deepEqual(w.calls.at(-1).slice(2, 5), [PLAN_ID, "L1", 6]);
  assert.deepEqual(w.calls.map(([, what]) => what), ["next", "result"], "nothing is published, read or opened on the Hub");
  assert.deepEqual(pushes(w), [], "no base is made");
  assert.equal(existsSync(join(planDir(w), "bases.json")), false);
  for (const record of ["story.md", "g1.json", "design.md", "g3.json"])
    assert.equal(existsSync(join(planDir(w), record)), false, `${record}: written only once the design is approved`);

  // A G1 that does not bind the draft: failed before any Lead turn.
  link.lease = leaseOf(designing({ id: planId(20), g1: { ...G1, memberId: "m-other" } }), { leaseId: "L2", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.equal(w.lastResult().reason, "Story 승인 기록이 이 기획의 PL 것이 아닙니다.");
  assert.equal(w.seen.length, 1, "no Lead turn");
  assert.deepEqual(named(w, "publish"), []);
});

test("a refused split or a design over 16384 bytes runs the Lead once more with the reason in retry; a second design over 16384 bytes posts failed with a plain reason", async (t) => {
  // 6000 Korean characters: within the Lead's 8192-character plan, but 18000 bytes of UTF-8.
  const LONG = { ...LEAD, plan: "가".repeat(6000) };
  const w = world(t, { answers: [UNCOVERED, LEAD, LONG, LEAD, LONG, LONG] });
  const link = w.first.link;
  const retries = () => w.seen.map(({ packet }) => packet.team.retry);

  link.lease = leaseOf(designing({ id: planId(30) }), { leaseId: "L1", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "design");
  assert.deepEqual(retries(), [null, "report.tasks: M1 not covered"]);
  assert.equal(w.lastResult().text, DESIGN_TEXT);

  link.lease = leaseOf(designing({ id: planId(31) }), { leaseId: "L2", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "design");
  assert.equal(retries()[2], null);
  assert.match(retries()[3], /16384/, "the Lead is told the byte limit");
  assert.match(retries()[3], /18\d{3}/, "and how long the design was");
  assert.equal(w.lastResult().text, DESIGN_TEXT);

  link.lease = leaseOf(designing({ id: planId(32) }), { leaseId: "L3", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  assert.equal(firstLine(w.lastResult().reason), "설계가 너무 깁니다(16KB 넘음).");
  assert.match(w.lastResult().reason, /\n.*16384/);
  assert.equal(w.seen.length, 6, "never a third Lead turn");
  assert.deepEqual(named(w, "publish"), []);
  assert.deepEqual(pushes(w), []);
});

test("after G3 a splitting lease publishes the stored split with risk high and no Lead turn, makes the bases and opens; g3.json is written", async (t) => {
  const w = world(t, { answers: [LEAD] });
  w.git.tips = { "/co/app-be": BE_TIP, "/co/app-fe": FE_TIP };
  const link = w.first.link;
  link.lease = leaseOf(designing(), { leaseId: "L1", revision: 6 });
  assert.equal((await w.planner.tick()).posted, "design");
  const design = w.lastResult();
  let pushedAtOpen = null;
  link.on.open = () => {
    pushedAtOpen = pushes(w).length;
  };
  const plan = approvedDesign(design);
  link.lease = leaseOf(plan, { leaseId: "L2", revision: 8 });

  assert.deepEqual(await w.planner.tick(), { ran: true, planId: PLAN_ID, posted: "open" });
  assert.equal(w.seen.length, 1, "no Lead turn after G3");
  const published = named(w, "publish");
  assert.equal(published.length, 1);
  const { graph, storyVerify, ...input } = published[0][2];
  assert.deepEqual(input, { projectId: "p-1", title: "주문 내역 화면", body: VIEW, risk: "high", key: `plan:${PLAN_ID}` });
  assert.deepEqual(graph, design.split.graph, "exactly the split the PL approved");
  assert.deepEqual(storyVerify, design.split.storyVerify);
  assert.deepEqual(pushes(w), [
    ["pushStoryBase", "/co/app-be", "feature/story-7/base", BE_TIP],
    ["pushStoryBase", "/co/app-fe", "feature/story-7/base", FE_TIP],
  ]);
  assert.equal(pushedAtOpen, 2, "every base was made before open");
  assert.deepEqual(JSON.parse(readFileSync(join(planDir(w), "bases.json"), "utf8")), { [BE]: BE_TIP, [FE]: FE_TIP });
  assert.deepEqual(
    w.calls.slice(2).map(([, what]) => what),
    ["next", "heartbeat", "publish", "story", "heartbeat", "open", "result"],
  );
  assert.deepEqual(w.calls.at(-1).slice(2), [PLAN_ID, "L2", 8, { kind: "open", storyId: "story-7" }]);
  assert.equal(link.stories.get("story-7").state, "open");
  assert.equal(link.stories.get("story-7").input.risk, "high");

  const dir = planDir(w);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".json")).sort(), [
    "bases.json", "candidate.json", "design.md", "g1.json", "g3.json", "story.md",
  ]);
  assert.equal(readFileSync(join(dir, "story.md"), "utf8"), VIEW);
  assert.equal(readFileSync(join(dir, "design.md"), "utf8"), DESIGN_TEXT);
  const g3 = JSON.parse(readFileSync(join(dir, "g3.json"), "utf8"));
  assert.equal(g3.gate, "G3");
  assert.equal(g3.responseRef, `hub-approval:${plan.g3.approvalId}`);
  assert.equal(g3.textHash, planTextHash(DESIGN_TEXT));
  assert.equal(JSON.parse(readFileSync(join(dir, "g1.json"), "utf8")).responseRef, `hub-approval:${G1.approvalId}`);

  // A retry of that plan after its Story was published: no Lead turn and no second publish (F1), the same records.
  const published2 = { storyId: "story-7", number: 7, state: "open" };
  link.on.open = undefined;
  link.lease = leaseOf(approvedDesign(design, { published: published2 }), { leaseId: "L3", revision: 10 });
  assert.equal((await w.planner.tick()).posted, "open");
  assert.equal(w.seen.length, 1);
  assert.equal(named(w, "publish").length, 1);

  // A publish the Hub did not answer (503) is tried again on the next tick of the same lease with the same stored split.
  let down = 1;
  link.on.publish = () => {
    if (down > 0) {
      down -= 1;
      throw hubError(503, "HUB_UNAVAILABLE");
    }
  };
  link.lease = leaseOf(approvedDesign(design, { id: planId(50) }), { leaseId: "L4", revision: 1 });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(50), posted: null });
  assert.deepEqual(await w.planner.tick(), { ran: true, planId: planId(50), posted: "open" });
  const [, again] = named(w, "publish").slice(-2);
  assert.deepEqual(again[2].graph, design.split.graph);
  assert.equal(again[2].risk, "high");
  assert.equal(w.seen.length, 1, "still no Lead turn");
});

test("a stored split that no longer passes the graph checks, or a G3 that does not bind the design, posts failed", async (t) => {
  const w = world(t, { answers: [LEAD] });
  const link = w.first.link;
  link.lease = leaseOf(designing(), { leaseId: "L0", revision: 6 });
  assert.equal((await w.planner.tick()).posted, "design");
  const design = w.lastResult();
  const edited = `${design.text}- t3 · app-be · 더한 Task\n`;
  const cycle = { ...design.split, graph: { ...design.split.graph, edges: [{ from: "t1", to: "t2" }, { from: "t2", to: "t1" }] } };
  const cases = [
    // The stored split fails the Hub's own graph check now (a cycle), though the design text still renders from it.
    approvedDesign({ text: renderTeamDesign(cycle, repoFolders(planRecord().repos)), split: cycle }, { id: planId(40) }),
    // A Task the Hub's project no longer has the repo of.
    approvedDesign(design, { id: planId(41), repos: [planRecord().repos[0]] }),
    approvedDesign(design, { id: planId(42), g3: g3Of(design.text, { memberId: "m-other" }) }),
    approvedDesign(design, { id: planId(43), g3: g3Of(`${design.text}\n`) }),
    // A design text the stored split does not render to, though the G3 binds that text.
    approvedDesign({ text: edited, split: design.split }, { id: planId(44) }),
    approvedDesign(design, { id: planId(45), g3: null }),
  ];
  for (const [i, plan] of cases.entries()) {
    link.lease = leaseOf(plan, { leaseId: `L${i + 1}`, revision: 1 });
    assert.equal((await w.planner.tick()).posted, "failed", plan.id);
    assert.equal(w.lastResult().reason, G3_REFUSED, plan.id);
    assert.equal(existsSync(join(planDir(w, plan.id), "g3.json")), false, "no record");
  }
  assert.equal(w.seen.length, 1, "never a Lead turn after G3");
  assert.deepEqual(named(w, "publish"), [], "nothing published");
  assert.deepEqual(pushes(w), []);

  // The Hub's publish refuses the approved split's graph: failed with a plain reason, not split again.
  const hubSays = "Task t1와 t2가 같은 파일(src/orders.ts)을 건드리는데 실행 순서가 없습니다.";
  link.on.publish = () => {
    throw refusal(400, "GRAPH_OVERLAP", hubSays);
  };
  link.lease = leaseOf(approvedDesign(design, { id: planId(46) }), { leaseId: "L9", revision: 1 });
  assert.equal((await w.planner.tick()).posted, "failed");
  const reason = w.lastResult().reason;
  assert.doesNotMatch(firstLine(reason), /[A-Z_]{6,}/);
  assert.match(firstLine(reason), /새 Story/);
  assert.ok(reason.endsWith(`\nGRAPH_OVERLAP: ${hubSays}`), reason);
  assert.equal(w.seen.length, 1, "no Lead turn");
  assert.equal(named(w, "publish").length, 1, "published once");
  assert.equal(link.stories.size, 0);
  assert.deepEqual(pushes(w), []);
});
