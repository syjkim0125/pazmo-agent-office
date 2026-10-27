import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture as contractFixture } from "./contract-fixture.mjs";
import { openLeanDb } from "../src/lean/schema.ts";
import { createLeanOffice } from "../src/lean/office.ts";
import { startLeanServer } from "../src/lean/server.ts";
import { continuePlanning } from "../src/runners/planning.ts";
import { OfficeError } from "../src/cli/project.ts";
import { digest } from "../src/core/candidates.ts";
import { roleJobFactory } from "../src/runtime/runner-jobs.ts";
import { liveRunnerWiring } from "../src/runtime/live.ts";

const TOKEN = "a".repeat(64);
const STORY = {
  title: "README",
  goal: "Clarify execution",
  domain: "Documentation",
  must: ["Show actual command"],
  should: [],
  out: ["Runtime changes"],
  assumptions: [],
  verify: [{ must: [1], scenario: "Command matches CLI" }],
};
const readyCatalog = () => ({
  installs: {
    codex: { runner: "codex", status: "ready", version: "0.160.0", sha256: "a".repeat(64), path: "/c", loggedIn: true, hint: "준비됨" },
    claude: { runner: "claude", status: "ready", version: "2.1.280", sha256: "b".repeat(64), path: "/k", loggedIn: true, hint: "준비됨" },
  },
  models: {
    codex: [{ slug: "gpt-6-sol" }, { slug: "gpt-5.5", reasoningLevels: [{ effort: "low" }, { effort: "high" }] }],
    claude: [{ slug: "default" }, { slug: "sonnet", reasoningLevels: [{ effort: "low" }] }, { slug: "haiku" }],
  },
});
const loggedOut = (name) => {
  const c = readyCatalog();
  c.installs[name] = { ...c.installs[name], loggedIn: false, hint: `${name} 로그인이 필요합니다.` };
  return c;
};
const codex = (model = "gpt-5.5", effort = null) => ({ runner: "codex", model, effort });
const claude = (model = "default", effort = null) => ({ runner: "claude", model, effort });

/** A lean Office on its own database with a fake live runtime that records
 * every start, as in the native-office tests. `catalog` is what discovery
 * finds at startup (a function of the temp root when it needs files there). */
async function fixture(t, { catalog = readyCatalog() } = {}) {
  const c = contractFixture(t);
  const db = openLeanDb(c.root, c.project);
  // The facade reuses a discovery for 5 s of this clock. Replacing the catalog
  // stands for a changed world (a CLI logged out, a model left) later than
  // that, so the next load discovers again, as the tests that follow expect.
  const clock = { now: 1_000_000 };
  // count: discoveries run; failure: thrown by the next discoveries until cleared.
  const discoveries = { count: 0, failure: null };
  // statusFailure: the next live.status() call throws it once; lastError: the
  // run failure live.status() reports (as LiveRuntime does after a failed run).
  const state = {
    current: typeof catalog === "function" ? catalog(c.root) : catalog,
    active: [],
    statusFailure: null,
    lastError: null,
    get catalog() {
      return this.current;
    },
    set catalog(value) {
      this.current = value;
      clock.now += 60_000;
    },
  };
  const calls = { planning: [], implementation: [], understanding: [], cancelled: [], aborted: [] };
  const captured = {};
  const live = {
    status: () => {
      const failure = state.statusFailure;
      state.statusFailure = null;
      if (failure) throw failure;
      return { execution: "ready", active: state.active, lastError: state.lastError };
    },
    startPlanning: (...args) => calls.planning.push(args),
    startImplementation: (...args) => calls.implementation.push(args),
    startUnderstanding: (...args) => calls.understanding.push(args),
    cancelImplementation: (...args) => calls.cancelled.push(args),
    abort: (id) => calls.aborted.push(id),
    assertIdle() {},
    close: async () => {},
  };
  const config = {
    db,
    project: c.project,
    dataDir: c.root,
    token: TOKEN,
    now: () => clock.now,
    runnerCatalog: async () => {
      discoveries.count++;
      // gate: a promise the next discoveries wait for (a slow CLI probe).
      if (discoveries.gate) await discoveries.gate;
      if (discoveries.failure) throw discoveries.failure;
      return state.catalog;
    },
    createRuntime: async (...args) => {
      captured.ledgers = args[3];
      captured.runners = args[5];
      return live;
    },
  };
  const opened = [await createLeanOffice(config)];
  // Runs before contract-fixture removes the directory.
  c.defer(async () => {
    for (const office of opened) await office.close();
    db.close();
  });
  const f = {
    ...c,
    db,
    state,
    clock,
    discoveries,
    calls,
    captured,
    config,
    get office() {
      return opened.at(-1);
    },
    get ledgers() {
      return captured.ledgers;
    },
    async reopen() {
      await opened.at(-1).close();
      opened.push(await createLeanOffice(config));
      return opened.at(-1);
    },
  };
  return f;
}
/** The default agent first (oldest), then Alice: work codex, review claude. */
async function agents(f, work = codex("gpt-5.5", "high"), review = claude()) {
  const fallback = await f.office.agents.ensureDefault();
  f.db.prepare("UPDATE agents SET created_at=1 WHERE id=?").run(fallback.id);
  const alice = await f.office.agents.create({ name: "Alice", work, review });
  return { fallback: f.office.agents.list()[0], alice };
}
function locate(board, id) {
  for (const [column, cards] of Object.entries(board.columns)) {
    const card = cards.find((c) => c.id === id);
    if (card) return { column, ...card };
  }
  return null;
}
const count = (f, table) => f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
async function storyReady(f, id) {
  const { intake } = f.ledgers;
  const i = intake.get(id),
    packet = intake.packet(id, i.revision, i.inputDigest);
  intake.acceptKit(
    id,
    i.revision,
    i.inputDigest,
    { kind: "lead", packet: continuePlanning(packet, STORY, "lead") },
    { runId: "test", runFile: "test", nodeId: "requirements", action: "role-complete", revisionToken: "test" },
  );
  await f.office.refresh();
}
async function answer(f, kind, note = "README 실행 안내만 수정하는 범위를 승인합니다.") {
  const decision = (await f.office.decisions()).find((d) => d.decision_kind === kind);
  assert.ok(decision, `an open ${kind} decision`);
  await f.office.reply(decision.id, 1, note);
}
/** What a Lead publication leaves behind: one registered contract task linked
 * to the request (the same synthetic publication the native G4 test uses). */
async function publishChild(f, rootId) {
  mkdirSync(join(f.project, "src"), { recursive: true });
  f.put("src/a", "before");
  f.put(
    "verify.json",
    JSON.stringify({
      version: 1,
      workspace: { include: ["src"], exclude: [] },
      checks: [
        {
          id: "V1",
          argv: ["node", "-e", "require('assert/strict').equal(require('fs').readFileSync('src/a','utf8'),'after')"],
          timeoutMs: 15000,
        },
      ],
    }),
  );
  const child = await f.ledgers.store.register(TOKEN, { ...f.input, risk: "normal", decision: null });
  f.db.prepare("UPDATE tasks SET source_task_id=? WHERE id=?").run(rootId, child.id);
  f.db.prepare("INSERT INTO pazmo_intake_publications VALUES (?,?)").run(rootId, JSON.stringify({ taskIds: [child.id] }));
  f.db.prepare("UPDATE tasks SET status='planned' WHERE id=?").run(rootId);
  await f.office.refresh();
  return child.id;
}
/** A request whose one subtask passed verification: its round awaits G4, and
 * the engine has not prepared the G4 evidence yet (no refresh since). With a
 * review verdict of "unknown", verification hands the subtask to a person. */
async function verifiedChild(f, verdict = "pass") {
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  await answer(f, "story");
  const child = await publishChild(f, id);
  await answer(f, "G1", "실행 범위를 확인했습니다.");
  const { handoffs, execution } = f.ledgers;
  const attempt = handoffs.prepare(child);
  handoffs.start(attempt.leaseId, "fixture-engineer");
  writeFileSync(join(attempt.workspace, "src/a"), "after");
  const observation = { exitCode: 0, signal: null, timedOut: false, error: null, output: "Scripted fixture only" };
  const finished = handoffs.finish(attempt.leaseId, "fixture-engineer", { closed: true, observation });
  for (const node of finished.round.nodes) {
    const lease = execution.reserveNode(finished.round.id, node.id);
    execution.start(lease.id, node.id);
    execution.finish(lease.id, node.id, {
      closed: true,
      observation: {
        ...observation,
        kind: node.kind,
        ...(node.kind === "review" ? { report: { verdict, findings: [], summary: "Fixture" } } : {}),
      },
    });
  }
  return { id, child };
}
/** Every open approval challenge is past its deadline. */
const expireChallenges = (f) =>
  f.db.prepare("UPDATE pazmo_approval_challenges SET expires_at=? WHERE consumed_at IS NULL").run(Date.now() - 1);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const RENEWED = { code: "STALE_APPROVAL", message: "결정이 갱신되었습니다. 다시 답해 주세요." };
const engineChild = (f, id, root, status = "in_progress") =>
  f.db.prepare("INSERT INTO tasks(id,title,status,source_task_id) VALUES (?,?,?,?)").run(id, `child ${id}`, status, root);

test("creating a task starts planning and puts one card on the board under its agent", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({
    title: "  Improve README  ",
    body: "Explain the start command",
    agentId: alice.id,
    risk: "high",
  });
  assert.equal(f.calls.planning.length, 1, "planning started");
  const board = f.office.board();
  assert.deepEqual(Object.keys(board.columns).sort(), ["active", "cancelled", "decide", "done", "waiting"]);
  assert.equal(board.columns.waiting.length + board.columns.active.length, 1);
  const card = locate(board, id);
  assert.equal(card.title, "Improve README");
  assert.equal(card.agentId, alice.id);
  assert.equal(card.agentName, "Alice");
  assert.equal(card.stage, "plan");
  assert.equal(card.risk, "high");
  assert.equal(typeof card.updatedAt, "number");
  const row = f.db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  assert.deepEqual(
    [row.title, row.description, row.status, row.project_path, row.agent_id, row.risk, row.source_task_id],
    ["Improve README", "Explain the start command", "inbox", f.project, alice.id, "high", null],
  );
  const intake = f.ledgers.intake.get(id);
  assert.equal(intake.risk, "high", "the same risk reaches the intake");
  assert.equal(intake.request, "Improve README\nExplain the start command");
});

test("a task waits on the board until the engine dispatches its first run", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const first = await f.office.createTask({ title: "First", body: "", agentId: alice.id, risk: "normal" });
  f.state.active = [{ taskId: first.id, kind: "planning" }];
  const second = await f.office.createTask({ title: "Second", body: "", agentId: alice.id, risk: "normal" });
  assert.equal(f.calls.planning.length, 1, "one run at a time");
  let board = f.office.board();
  assert.equal(locate(board, first.id).column, "active");
  assert.equal(locate(board, second.id).column, "waiting");
  assert.equal(locate(board, second.id).stage, "plan");
  f.state.active = [];
  await f.office.refresh();
  assert.equal(f.calls.planning.length, 2);
  board = f.office.board();
  assert.equal(locate(board, second.id).column, "active");
});

test("a restarted lean Office dispatches a task that was still waiting", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const first = await f.office.createTask({ title: "First", body: "", agentId: alice.id, risk: "normal" });
  f.state.active = [{ taskId: first.id, kind: "planning" }];
  const second = await f.office.createTask({ title: "Second", body: "", agentId: alice.id, risk: "normal" });
  assert.equal(f.calls.planning.length, 1);
  f.state.active = [];
  await f.reopen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    f.calls.planning.map(([id]) => id),
    [first.id, second.id],
    "startup reconciliation starts the waiting task once and never replays the first",
  );
});

test("an open decision moves the card to decide and a reply moves it on", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  let card = locate(f.office.board(), id);
  assert.equal(card.column, "decide");
  assert.equal(card.stage, "plan", "the Story gate (G1) is part of planning");
  const detail = f.office.detail(id);
  assert.deepEqual(detail.decisions.map((d) => d.decision_kind), ["story"]);
  assert.deepEqual((await f.office.decisions()).map((d) => d.id), detail.decisions.map((d) => d.id));
  await answer(f, "story");
  assert.equal(f.calls.planning.length, 2, "approval starts the Lead");
  card = locate(f.office.board(), id);
  assert.equal(card.column, "active");
  assert.equal(card.stage, "design");
  assert.deepEqual(await f.office.decisions(), []);
});

test("PM questions are planning and Lead questions are design", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  const ask = async () => {
    const { intake } = f.ledgers;
    const i = intake.get(id);
    intake.acceptKit(
      id,
      i.revision,
      i.inputDigest,
      {
        kind: "questions",
        inputDigest: i.inputDigest,
        questions: [{ id: "Q1", text: "Which README?", reason: "Two READMEs exist" }],
      },
      { runId: "test", runFile: "test", nodeId: "n", action: "role-question", revisionToken: "test" },
    );
    await f.office.refresh();
  };
  await ask();
  assert.deepEqual(
    [locate(f.office.board(), id).column, locate(f.office.board(), id).stage],
    ["decide", "plan"],
  );
  await answer(f, "questions", "The root README");
  await storyReady(f, id);
  await answer(f, "story");
  await ask();
  assert.deepEqual(
    [locate(f.office.board(), id).column, locate(f.office.board(), id).stage],
    ["decide", "design"],
  );
});

test("a published plan walks the card through design, build, review and g4 to done", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  await answer(f, "story");
  const child = await publishChild(f, id);
  const at = () => {
    const card = locate(f.office.board(), id);
    return [card.column, card.stage];
  };
  assert.deepEqual(at(), ["decide", "design"], "the Lead's plan awaits its contract approval");
  // The engine could cancel this managed subtask by itself; the lean Office takes requests only.
  assert.throws(() => f.office.detail(child), { code: "NOT_FOUND" });
  await assert.rejects(f.office.cancel(child), { code: "NOT_FOUND" });
  assert.equal(f.db.prepare("SELECT status FROM tasks WHERE id=?").get(child).status, "inbox");
  let detail = f.office.detail(id);
  assert.deepEqual(detail.decisions.map((d) => [d.decision_kind, d.task_id]), [["G1", child]]);
  assert.deepEqual(detail.diffs, [
    { taskId: child, title: "Input validation", stat: "검증된 변경본을 준비 중입니다.", diff: "" },
  ]);
  assert.deepEqual(detail.deliveries, [{ taskId: child, status: "not_delivered", directory: null }]);

  await answer(f, "G1", "실행 범위를 확인했습니다.");
  assert.equal(f.calls.implementation.length, 1, "the approved contract starts the engineer");
  assert.deepEqual(at(), ["active", "build"]);

  const { handoffs, execution, completion } = f.ledgers;
  const attempt = handoffs.prepare(child);
  handoffs.start(attempt.leaseId, "fixture-engineer");
  assert.deepEqual(at(), ["active", "build"]);
  writeFileSync(join(attempt.workspace, "src/a"), "after");
  const observation = { exitCode: 0, signal: null, timedOut: false, error: null, output: "Scripted fixture only" };
  const finished = handoffs.finish(attempt.leaseId, "fixture-engineer", { closed: true, observation });
  assert.deepEqual(at(), ["active", "review"]);
  for (const node of finished.round.nodes) {
    const lease = execution.reserveNode(finished.round.id, node.id);
    execution.start(lease.id, node.id);
    execution.finish(lease.id, node.id, {
      closed: true,
      observation: {
        ...observation,
        kind: node.kind,
        ...(node.kind === "review" ? { report: { verdict: "pass", findings: [], summary: "Fixture" } } : {}),
      },
    });
  }
  await f.office.refresh();
  assert.deepEqual(at(), ["decide", "g4"]);
  detail = f.office.detail(id);
  assert.equal(detail.stage, "g4");
  assert.deepEqual(detail.decisions.map((d) => [d.decision_kind, d.task_id]), [["G4", child]]);
  assert.match(detail.diffs[0].diff, /after/);
  assert.ok(
    detail.events.some((e) => e.text.startsWith("최종 결과 승인")),
    "the subtask's messages are part of the request's events",
  );

  await answer(f, "G4", "1. Changes src/a to after\n2. Delivery needs matching verification\n3. Fixture evidence only");
  assert.equal(f.calls.understanding.length, 1);
  assert.deepEqual(at(), ["active", "g4"], "the reviewer's G4 evaluation is still the G4 stage");
  const g4 = completion.get(child);
  completion.evaluate(
    TOKEN,
    g4.id,
    g4.answerDigest,
    Object.fromEntries(["behavior", "invariant", "evidence"].map((k) => [k, { correct: true, rationale: "Matches" }])),
  );
  await f.office.refresh();
  assert.deepEqual(at(), ["done", "done"]);
  detail = f.office.detail(id);
  assert.equal(detail.status, "done");
  assert.equal(detail.deliveries.length, 1);
  assert.equal(detail.deliveries[0].status, "delivered");
  assert.equal(typeof detail.deliveries[0].directory, "string");
});

test("chooseRunner gives the root agent's work runner to pm, lead and engineer and its review runner to the reviewer", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f, codex("gpt-5.5", "high"), claude("haiku"));
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  engineChild(f, "child-1", id);
  engineChild(f, "grandchild-1", "child-1");
  const work = { runner: "codex", model: "gpt-5.5", reasoning: "high" },
    review = { runner: "claude", model: "haiku", reasoning: null };
  assert.equal(f.office.chooseRunner("engineer", "child-1").runner, "codex");
  assert.equal(f.office.chooseRunner("reviewer", "child-1").runner, "claude");
  assert.deepEqual(f.office.chooseRunner("pm", id), work);
  assert.deepEqual(f.office.chooseRunner("lead", id), work);
  assert.deepEqual(f.office.chooseRunner("engineer", "grandchild-1"), work);
  assert.deepEqual(f.office.chooseRunner("reviewer", "grandchild-1"), review);
  // The live runtime asks the same function for every role job.
  assert.deepEqual(f.captured.runners.choose("engineer", "child-1"), work);
  assert.deepEqual(f.captured.runners.choose("reviewer", "child-1"), review);
});

test("a runner change on an agent with a waiting task reaches the next chooseRunner", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const first = await f.office.createTask({ title: "First", body: "", agentId: alice.id, risk: "normal" });
  f.state.active = [{ taskId: first.id, kind: "planning" }];
  const { id } = await f.office.createTask({ title: "Waiting", body: "", agentId: alice.id, risk: "normal" });
  assert.equal(locate(f.office.board(), id).column, "waiting");
  await f.office.agents.update(alice.id, { work: claude("sonnet", "low") });
  assert.deepEqual(f.office.chooseRunner("pm", id), { runner: "claude", model: "sonnet", reasoning: "low" });
  await f.office.agents.update(alice.id, { review: codex("gpt-6-sol") });
  assert.deepEqual(f.office.chooseRunner("reviewer", id), { runner: "codex", model: "gpt-6-sol", reasoning: null });
});

test("an agent whose runner logged out cannot take a new task, and the tasks it has stay", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const kept = await f.office.createTask({ title: "Kept", body: "", agentId: alice.id, risk: "normal" });
  f.state.catalog = loggedOut("claude");
  await assert.rejects(
    f.office.createTask({ title: "Refused", body: "", agentId: alice.id, risk: "normal" }),
    { code: "AGENT_RUNNER_NOT_READY", message: "agent 실행기를 확인하세요." },
  );
  assert.equal(count(f, "tasks"), 1, "nothing was inserted");
  assert.equal(f.calls.planning.length, 1);
  const cards = Object.values(f.office.board().columns).flat();
  assert.deepEqual(cards.map((c) => c.id), [kept.id]);
  assert.equal(f.office.detail(kept.id).title, "Kept");
});

test("task input is validated before anything is stored", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const base = { title: "Improve README", body: "", agentId: alice.id, risk: "normal" };
  for (const title of ["x".repeat(201), "", "   ", 7, undefined])
    await assert.rejects(f.office.createTask({ ...base, title }), { code: "INVALID" }, JSON.stringify(title));
  for (const risk of ["x", undefined, "HIGH"])
    await assert.rejects(f.office.createTask({ ...base, risk }), { code: "INVALID" }, JSON.stringify(risk));
  await assert.rejects(f.office.createTask({ ...base, body: 5 }), { code: "INVALID" });
  for (const bad of [null, "task", []])
    await assert.rejects(f.office.createTask(bad), { code: "INVALID" }, JSON.stringify(bad));
  await assert.rejects(f.office.createTask({ ...base, agentId: undefined }), { code: "INVALID" });
  await assert.rejects(f.office.createTask({ ...base, agentId: "no-such-agent" }), { code: "NOT_FOUND" });
  // The intake takes the title and the body as one request of at most 16384
  // UTF-8 bytes ("Improve README\n" is 15 of them); it is checked here first.
  const tooLong = { code: "INVALID", message: "내용은 16384바이트까지입니다." };
  await assert.rejects(f.office.createTask({ ...base, body: "x".repeat(16384) }), tooLong);
  await assert.rejects(f.office.createTask({ ...base, body: "x".repeat(16370) }), tooLong);
  await assert.rejects(f.office.createTask({ ...base, body: "가".repeat(5457) }), tooLong, "bytes, not characters");
  assert.equal(count(f, "tasks"), 0, "no rejected request left a task");
  assert.equal(count(f, "messages"), 0);
  assert.equal(f.calls.planning.length, 0);
  const made = await f.office.createTask({ ...base, title: "가".repeat(200) });
  assert.equal(f.office.detail(made.id).title, "가".repeat(200), "200 characters are allowed");
  const longest = await f.office.createTask({ ...base, body: "x".repeat(16369) });
  assert.equal(f.ledgers.intake.get(longest.id).request.length, 16384, "exactly the intake's limit is allowed");
});

test("cancel moves the card to cancelled; detail and cancel take root tasks only", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "Body", agentId: alice.id, risk: "normal" });
  const detail = f.office.detail(id);
  assert.equal(detail.id, id);
  assert.equal(detail.body, "Body");
  assert.equal(detail.status, "inbox");
  assert.equal(detail.stage, "plan");
  assert.equal(detail.agent.name, "Alice");
  assert.deepEqual(detail.diffs, [], "a root without subtasks has no diffs");
  assert.deepEqual(detail.deliveries, []);
  assert.deepEqual(detail.runs, []);
  assert.deepEqual(detail.decisions, []);
  engineChild(f, "child-1", id);
  for (const missing of ["child-1", "no-such-task"]) {
    assert.throws(() => f.office.detail(missing), { code: "NOT_FOUND" }, missing);
    await assert.rejects(f.office.cancel(missing), { code: "NOT_FOUND" }, missing);
  }
  f.db.prepare("DELETE FROM tasks WHERE id='child-1'").run();
  await f.office.cancel(id);
  assert.deepEqual(f.calls.aborted, [id]);
  const card = locate(f.office.board(), id);
  assert.equal(card.column, "cancelled");
  assert.equal(card.stage, "cancelled");
});

test("detail gathers the task's and its subtasks' events in time order without repeating log copies", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  engineChild(f, "child-1", id);
  f.db
    .prepare(
      "INSERT INTO messages(id,sender_type,receiver_type,content,message_type,task_id,created_at) VALUES ('m-child','agent','all','하위 작업을 시작했습니다','status_update','child-1',?)",
    )
    .run(Date.now() + 60_000);
  f.db.prepare("INSERT INTO task_logs(task_id,kind,message,created_at) VALUES (?,'system','로그 전용 기록',?)").run(id, 1);
  const { events } = f.office.detail(id);
  const texts = events.map((e) => e.text);
  assert.equal(texts.filter((x) => x.startsWith("요청을 접수했습니다")).length, 1, "a log copy of a message is not repeated");
  assert.equal(texts[0], "로그 전용 기록", "a log line without a message is kept, in time order");
  assert.equal(texts.at(-1), "하위 작업을 시작했습니다", "subtask events are included");
  assert.deepEqual(
    events.map((e) => e.at),
    events.map((e) => e.at).toSorted((a, b) => a - b),
  );
  for (const e of events) assert.deepEqual(Object.keys(e).sort(), ["at", "text"]);
});

test("decide wins over waiting and active but not over done or cancelled", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const insert = f.db.prepare("INSERT INTO tasks(id,title,status,agent_id,project_path) VALUES (?,?,?,?,?)");
  const decide = f.db.prepare(
    "INSERT INTO pazmo_native_decisions VALUES (?,?,'story',?,'{}','요약',1)",
  );
  for (const status of ["done", "cancelled"]) {
    insert.run(`t-${status}`, status, status, alice.id, f.project);
    decide.run(`d-${status}`, `t-${status}`, `binding-${status}`);
  }
  insert.run("t-open", "open", "inbox", alice.id, f.project);
  engineChild(f, "c-open", "t-open", "planned");
  decide.run("d-child", "c-open", "binding-child");
  const board = f.office.board();
  assert.equal(locate(board, "t-done").column, "done");
  assert.equal(locate(board, "t-cancelled").column, "cancelled");
  assert.equal(locate(board, "t-open").column, "decide", "a subtask's decision puts its root in decide");
  assert.equal(locate(board, "c-open"), null, "subtasks are not cards");
});

test("a root without an agent shows no owner and runs on the oldest remaining agent", async (t) => {
  const f = await fixture(t);
  const { fallback, alice } = await agents(f, claude("haiku"), claude("haiku"));
  // A task the engine created itself (e.g. a team hub request) has no lean owner.
  f.db.prepare("INSERT INTO tasks(id,title,status,project_path) VALUES ('hub-root','From hub','inbox',?)").run(f.project);
  engineChild(f, "hub-child", "hub-root");
  assert.deepEqual(f.office.chooseRunner("engineer", "hub-child"), fallback.work);
  assert.deepEqual(f.office.chooseRunner("reviewer", "hub-root"), fallback.review);
  const card = locate(f.office.board(), "hub-root");
  assert.equal(card.agentId, null);
  assert.equal(card.agentName, null);

  // Alice's finished task loses its owner when she is removed.
  const { id } = await f.office.createTask({ title: "Done work", body: "", agentId: alice.id, risk: "normal" });
  engineChild(f, "alice-child", id, "done");
  assert.equal(f.office.chooseRunner("engineer", "alice-child").runner, "claude");
  f.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(id);
  f.office.agents.remove(alice.id);
  assert.deepEqual(f.office.chooseRunner("engineer", "alice-child"), fallback.work, "the deleted agent falls back");
  assert.deepEqual(f.office.chooseRunner("reviewer", "alice-child"), fallback.review);
});

test("the oldest agent is chosen by creation time, then id", async (t) => {
  const f = await fixture(t);
  f.db.prepare(
    "INSERT INTO agents(id,name,work_runner,work_model,review_runner,review_model,created_at) VALUES ('b-agent','B','claude','haiku','claude','haiku',5)",
  ).run();
  f.db.prepare(
    "INSERT INTO agents(id,name,work_runner,work_model,review_runner,review_model,created_at) VALUES ('a-agent','A','codex','gpt-6-sol','codex','gpt-6-sol',5)",
  ).run();
  f.db.prepare(
    "INSERT INTO agents(id,name,work_runner,work_model,review_runner,review_model,created_at) VALUES ('0-agent','Z','claude','sonnet','claude','sonnet',9)",
  ).run();
  assert.deepEqual(f.office.chooseRunner("engineer", "unknown-task"), {
    runner: "codex",
    model: "gpt-6-sol",
    reasoning: null,
  });
});

test("chooseRunner still resolves for the subtasks of a root cancelled while they stop", async (t) => {
  const f = await fixture(t);
  const { fallback, alice } = await agents(f, claude("haiku"), claude("sonnet", "low"));
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  await answer(f, "story");
  const child = await publishChild(f, id);
  await answer(f, "G1", "실행 범위를 확인했습니다.");
  await f.office.cancel(id);
  assert.equal(f.calls.cancelled.length, 1, "the running subtask was asked to stop");
  assert.notEqual(f.db.prepare("SELECT status FROM tasks WHERE id=?").get(child).status, "cancelled");
  assert.equal(locate(f.office.board(), id).column, "cancelled");
  // The root is cancelled, so its agent is no longer busy and may be removed
  // while the subtask's job is still winding down.
  f.office.agents.remove(alice.id);
  assert.deepEqual(f.office.chooseRunner("reviewer", child), fallback.review);
  assert.deepEqual(f.office.chooseRunner("engineer", child), fallback.work);
});

test("a missing parent, a cycle or an unknown task use the default agent; no agent at all uses the default runner", async (t) => {
  const f = await fixture(t);
  const { fallback } = await agents(f, claude("haiku"), claude("haiku"));
  engineChild(f, "orphan", "ghost-parent");
  engineChild(f, "loop-a", "loop-b");
  engineChild(f, "loop-b", "loop-a");
  for (const id of ["orphan", "loop-a", "unknown-task"])
    assert.deepEqual(f.office.chooseRunner("engineer", id), fallback.work, id);
  f.db.prepare("DELETE FROM agents").run();
  assert.deepEqual(f.office.chooseRunner("engineer", "orphan"), { runner: "codex", model: "gpt-5.5", reasoning: null });
  // The default runner follows the latest discovery: codex logged out → claude.
  f.state.catalog = loggedOut("codex");
  const helper = await f.office.agents.create({ name: "Probe", work: claude(), review: claude() });
  f.db.prepare("DELETE FROM agents WHERE id=?").run(helper.id);
  assert.deepEqual(f.office.chooseRunner("reviewer", "orphan"), { runner: "claude", model: "default", reasoning: null });
});

test("an expired gate decision is renewed by reading the detail or the board, and its old id says so", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  await answer(f, "story");
  await publishChild(f, id);
  const note = "실행 범위를 확인했습니다.";
  const gate = () => f.office.detail(id).decisions.find((d) => d.decision_kind === "G1");

  // Reading the detail reissues it; nothing else would while the Office is idle.
  expireChallenges(f);
  const stale = gate();
  assert.ok(stale.expires_at <= Date.now());
  await tick();
  const fresh = gate();
  assert.notEqual(fresh.id, stale.id, "detail() renewed the expired decision");
  assert.ok(fresh.expires_at > Date.now());
  await assert.rejects(f.office.reply(stale.id, 1, note), RENEWED);

  // Reading the board does the same.
  expireChallenges(f);
  f.office.board();
  await tick();
  const renewed = f.db.prepare("SELECT id FROM pazmo_native_decisions WHERE kind='G1'").get().id;
  assert.notEqual(renewed, fresh.id, "board() renewed the expired decision");
  await assert.rejects(f.office.reply(fresh.id, 1, note), RENEWED);

  // Answering a decision that expired since it was read renews it too.
  expireChallenges(f);
  await assert.rejects(f.office.reply(renewed, 1, note), RENEWED);
  const latest = f.db.prepare("SELECT id FROM pazmo_native_decisions WHERE kind='G1'").get().id;
  assert.notEqual(latest, renewed, "reply() reconciled before answering");

  await f.office.reply(latest, 1, note);
  assert.equal(f.calls.implementation.length, 1, "the fresh id is answerable");
  assert.equal(locate(f.office.board(), id).column, "active");
  // A decision that never expired keeps the engine's own refusal.
  await assert.rejects(f.office.reply(latest, 1, note), { code: "STALE_APPROVAL", message: "이미 처리됐거나 변경된 요청입니다." });
});

test("a subtask whose diff cannot be read does not break the detail", async (t) => {
  const f = await fixture(t);
  const { id, child } = await verifiedChild(f);
  // The round awaits G4 but the engine has not prepared its evidence yet.
  let detail = f.office.detail(id);
  assert.deepEqual(detail.diffs, [
    { taskId: child, title: "Input validation", stat: "", diff: "", error: "EVIDENCE_REQUIRED" },
  ]);
  assert.equal(detail.stage, "g4");
  assert.ok(detail.events.length > 0, "events still load");
  assert.deepEqual(detail.deliveries, [{ taskId: child, status: "not_delivered", directory: null }]);
  await f.office.refresh();
  assert.match(f.office.detail(id).diffs[0].diff, /after/);
  assert.equal(f.office.detail(id).diffs[0].error, undefined);

  // A failure that is not an Office error is reported as UNAVAILABLE and logged once.
  await answer(f, "G4", "1. Changes src/a to after\n2. Delivery needs matching verification\n3. Fixture evidence only");
  const logged = t.mock.method(console, "error", () => {});
  f.db.prepare("UPDATE pazmo_g4_evidence SET evidence_json='{' WHERE task_id=?").run(child);
  detail = f.office.detail(id);
  f.office.detail(id);
  assert.deepEqual(detail.diffs, [
    { taskId: child, title: "Input validation", stat: "", diff: "", error: "UNAVAILABLE" },
  ]);
  assert.equal(logged.mock.callCount(), 1, "logged once, not on every poll");
});

test("a task whose start failed after it was accepted keeps the task and records why", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const logged = t.mock.method(console, "error", () => {});
  f.state.statusFailure = new OfficeError("RUNTIME_DOWN", "runtime unavailable");
  const { id } = await f.office.createTask({ title: "First", body: "", agentId: alice.id, risk: "normal" });
  assert.equal(f.calls.planning.length, 0);
  assert.ok(f.ledgers.intake.get(id), "the task entered the intake");
  const texts = f.office.detail(id).events.map((e) => e.text);
  assert.equal(texts.filter((x) => x === "작업을 시작하지 못했습니다: RUNTIME_DOWN").length, 1);
  assert.ok(logged.mock.callCount() >= 1, "the failure is still logged");

  f.state.statusFailure = new TypeError("boom");
  const second = await f.office.createTask({ title: "Second", body: "", agentId: alice.id, risk: "normal" });
  assert.ok(
    f.office.detail(second.id).events.some((e) => e.text === "작업을 시작하지 못했습니다: INTERNAL"),
    "an unexpected error is recorded without its text",
  );
  assert.equal(count(f, "tasks"), 2, "a retry is never needed, so nothing is duplicated");
  await f.office.refresh();
  assert.deepEqual(
    f.calls.planning.map(([taskId]) => taskId).sort(),
    [id, second.id].sort(),
    "the next continuation starts each accepted task once",
  );
});

test("runners() gives a fresh sanitized catalog: status, login, block, models; never a path", async (t) => {
  const f = await fixture(t);
  const blocked = readyCatalog();
  // Real discovery results: the install path is absolute under the home directory,
  // and a blocked codex says which home-relative files block it (runner-discovery.ts).
  const installs = { codex: "/Users/example/.nvm/versions/node/v24.19.0/bin/codex", claude: "/Users/example/.local/bin/claude" };
  const blockedHint =
    "~/.codex/AGENTS.md가 있으면 codex가 이 개인 지침을 Office 역할 실행에 섞습니다. 그 파일을 다른 곳으로 옮기거나 claude를 고르세요.";
  blocked.installs.codex = { ...blocked.installs.codex, path: installs.codex, blocked: "~/.codex/AGENTS.md", hint: blockedHint };
  blocked.installs.claude = { ...blocked.installs.claude, path: installs.claude };
  blocked.models.codex = [
    {
      slug: "gpt-5.5",
      displayName: "GPT 5.5",
      defaultReasoningLevel: "high",
      reasoningLevels: [{ effort: "low", description: "빠르게" }, { effort: "high" }],
      // Anything beyond the declared fields (e.g. a source file) is not passed on.
      sourcePath: "/secret/models.json",
    },
    { slug: "plain" },
  ];
  f.state.catalog = blocked;
  const view = await f.office.runners();
  assert.deepEqual(view, {
    runners: [
      {
        runner: "codex",
        status: "ready",
        loggedIn: true,
        blocked: true,
        hint: blockedHint,
        models: [
          {
            slug: "gpt-5.5",
            displayName: "GPT 5.5",
            defaultReasoningLevel: "high",
            reasoningLevels: [{ effort: "low", description: "빠르게" }, { effort: "high" }],
          },
          { slug: "plain", reasoningLevels: [] },
        ],
      },
      {
        runner: "claude",
        status: "ready",
        loggedIn: true,
        blocked: false,
        hint: "준비됨",
        models: [
          { slug: "default", reasoningLevels: [] },
          { slug: "sonnet", reasoningLevels: [{ effort: "low" }] },
          { slug: "haiku", reasoningLevels: [] },
        ],
      },
    ],
  });
  const text = JSON.stringify(view);
  assert.ok(!/"path"\s*:/.test(text), "no path key anywhere");
  assert.ok(text.includes("~/.codex/AGENTS.md"), "the home-relative hint is kept: the user needs it to act");
  for (const secret of [installs.codex, installs.claude, "/Users/example", "/secret/models.json", "sha256", "version"])
    assert.ok(!text.includes(secret), `${secret} must not reach the view`);

  // Every call asks for a fresh discovery: a CLI that logged out shows up at once.
  f.state.catalog = loggedOut("claude");
  const after = await f.office.runners();
  const entry = after.runners.find((r) => r.runner === "claude");
  assert.equal(entry.loggedIn, false);
  assert.equal(entry.hint, "claude 로그인이 필요합니다.");
  // A CLI that is not installed has no models.
  const missing = readyCatalog();
  missing.installs.claude = { runner: "claude", status: "missing", loggedIn: false, hint: "설치되어 있지 않습니다." };
  delete missing.models.claude;
  f.state.catalog = missing;
  const gone = (await f.office.runners()).runners.find((r) => r.runner === "claude");
  assert.deepEqual(gone, { runner: "claude", status: "missing", loggedIn: false, blocked: false, hint: "설치되어 있지 않습니다.", models: [] });
});

const TTL = 5000;

test("discovery is shared: concurrent callers run one, a result is reused for 5 s, then it runs again", async (t) => {
  const f = await fixture(t);
  // Whatever startup discovered is now at its TTL.
  f.clock.now += TTL;
  f.discoveries.count = 0;
  const [first, second] = await Promise.all([f.office.runners(), f.office.runners()]);
  assert.equal(f.discoveries.count, 1, "two concurrent callers share one discovery");
  assert.deepEqual(first, second);
  f.clock.now += TTL - 1;
  await f.office.runners();
  assert.equal(f.discoveries.count, 1, "reused within the TTL");
  f.clock.now += 1;
  await f.office.runners();
  assert.equal(f.discoveries.count, 2, "discovered again once the TTL is over");
});

test("agents and task creation use the same discovery as runners(), and chooseRunner follows it", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  f.clock.now += TTL;
  f.discoveries.count = 0;
  await Promise.all([f.office.runners(), f.office.agents.runnersReady(alice.id), f.office.agents.runnersReady(alice.id)]);
  assert.equal(f.discoveries.count, 1, "concurrent runners() and runnersReady share one discovery");
  await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  assert.equal(f.discoveries.count, 2, "task creation reuses it, then gives the engine one fresh discovery");
  await f.office.agents.create({ name: "Bob", work: claude(), review: claude() });
  assert.equal(f.discoveries.count, 3, "saving an agent's runners gives the engine one fresh discovery too");

  // The catalog chooseRunner reads is the one the shared load keeps: codex is
  // logged out, so with no agent left the default runner is claude.
  f.state.catalog = loggedOut("codex");
  await f.office.runners();
  f.db.prepare("DELETE FROM agents").run();
  assert.deepEqual(f.office.chooseRunner("engineer", "unknown-task"), { runner: "claude", model: "default", reasoning: null });
});

test("a failed discovery is not kept: its callers share the failure and the next call tries again", async (t) => {
  const f = await fixture(t);
  f.clock.now += TTL;
  f.discoveries.count = 0;
  f.discoveries.failure = new Error("discovery is down");
  const results = await Promise.allSettled([f.office.runners(), f.office.runners()]);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
  assert.equal(f.discoveries.count, 1, "one flight, one failure");
  f.discoveries.failure = null;
  const view = await f.office.runners();
  assert.equal(f.discoveries.count, 2, "no TTL wait after a failure");
  assert.equal(view.runners.length, 2);
});

test("a task whose runner check is still running when a stop is accepted is never created", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const before = count(f, "tasks");
  // A later clock: the next load discovers again, and that discovery is slow.
  f.state.catalog = readyCatalog();
  let release;
  f.discoveries.gate = new Promise((resolve) => (release = resolve));
  const server = await startLeanServer({
    office: f.office,
    token: TOKEN,
    instance: "d".repeat(32),
    project: f.project,
    port: 0,
    webRoot: f.root,
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const session = await fetch(`${base}/api/session`);
  const { csrf } = await session.json();
  const headers = {
    cookie: session.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": csrf,
    "content-type": "application/json",
  };
  const started = f.discoveries.count;
  const pending = fetch(`${base}/api/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" }),
  });
  // The request passed the gate and now waits for the runner check.
  while (f.discoveries.count === started) await new Promise((resolve) => setTimeout(resolve, 5));
  const stop = await fetch(`${base}/__pazmo/stop`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(stop.status, 200);
  release();
  const answered = await pending;
  assert.equal(answered.status, 503);
  assert.equal((await answered.json()).error, "STOPPING");
  assert.equal(count(f, "tasks"), before, "nothing was stored after the stop was accepted");
  // The office refuses on its own, without the server in front of it.
  f.discoveries.gate = null;
  await assert.rejects(
    f.office.createTask({ title: "Later", body: "", agentId: alice.id, risk: "normal" }),
    (error) => error instanceof OfficeError && error.code === "STOPPING",
  );
  assert.equal(count(f, "tasks"), before);
});

// --- Final review fixes ------------------------------------------------------

/** A catalog whose CLIs are real files under `root`, so a role job's binary
 * check passes; claude may be logged out. */
function installedCatalog(root, { claudeLoggedIn = true } = {}) {
  const c = readyCatalog();
  for (const name of ["codex", "claude"]) {
    const path = join(root, `${name}-binary`);
    writeFileSync(path, `${name} binary`, { mode: 0o700 });
    c.installs[name] = { ...c.installs[name], path, sha256: digest(`${name} binary`) };
  }
  if (!claudeLoggedIn) c.installs.claude = { ...c.installs.claude, loggedIn: false, hint: "claude 로그인이 필요합니다." };
  return c;
}
/** The live runtime's job factory over the engine's own runner settings (as
 * live.ts wires it), with the CLI qualified and its job faked. */
function engineJobs(runners) {
  const calls = [];
  const job = (runner) => (options, prompt) => {
    calls.push({ runner, options, prompt });
    return { supervise: async () => ({ closed: true, result: { exitCode: 0, signal: null, error: null, stdout: "", stderr: "", timedOut: false } }) };
  };
  const factory = roleJobFactory({
    choice: liveRunnerWiring(runners).choice,
    installs: () => runners.settings.catalog.installs,
    rediscover: async () => (await runners.settings.refresh()).installs,
    qualify: async () => ({ passed: true, checks: [], catalog: { path: "/cat.json", digest: "d".repeat(64) } }),
    evidence: { record() {} },
    executor: "/qualified/executor",
    authHome: "/Users/example/.codex",
    home: "/Users/example",
    pinnedController: "/pinned/controller",
    openExecutor: () => {
      throw new Error("unused");
    },
    timeoutMs: 1000,
    jobs: { codex: job("codex"), claude: job("claude") },
  });
  return { calls, run: (role, taskId) => factory(role, taskId, "prompt").supervise("h", 1000, new AbortController().signal) };
}

test("a CLI logged in after startup runs the reviewer job of a task created afterwards", async (t) => {
  const f = await fixture(t, { catalog: (root) => installedCatalog(root, { claudeLoggedIn: false }) });
  const { runners } = f.captured;
  assert.equal(runners.settings.catalog.installs.claude.loggedIn, false, "startup found only codex ready");
  await f.office.agents.ensureDefault();
  // The person logs in to claude after the Office started.
  f.state.catalog = installedCatalog(f.root);
  const rev = await f.office.agents.create({ name: "Rev", work: codex(), review: claude("sonnet") });
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: rev.id, risk: "normal" });
  engineChild(f, "child-1", id);
  const jobs = engineJobs(runners);
  const out = await jobs.run("reviewer", "child-1");
  assert.equal(out.result.error, null, "the reviewer job was accepted, not refused");
  assert.deepEqual(
    jobs.calls.map((c) => [c.runner, c.options.selection.model]),
    [["claude", "sonnet"]],
  );
});

test("the engine's loader discovers afresh inside the 5 s window, shares a discovery in flight and refreshes the cache", async (t) => {
  const f = await fixture(t);
  const { settings } = f.captured.runners;
  f.clock.now += TTL;
  f.discoveries.count = 0;
  await f.office.runners();
  assert.equal(f.discoveries.count, 1);
  await settings.refresh();
  assert.equal(f.discoveries.count, 2, "the engine's refresh is not served from the 5 s cache");
  // A change no cached result has seen (the clock did not move).
  f.state.current = loggedOut("codex");
  assert.equal(await settings.refresh(), f.state.current);
  assert.equal(f.discoveries.count, 3);
  // What the engine found is the facade's catalog too: no other discovery.
  assert.equal((await f.office.runners()).runners.find((r) => r.runner === "codex").loggedIn, false);
  f.db.prepare("DELETE FROM agents").run();
  assert.equal(f.office.chooseRunner("engineer", "unknown-task").runner, "claude");
  assert.equal(f.discoveries.count, 3);
  // A discovery already in flight is shared, not repeated.
  let release;
  f.discoveries.gate = new Promise((resolve) => (release = resolve));
  f.clock.now += TTL;
  const screen = f.office.runners();
  const engine = settings.refresh();
  release();
  await Promise.all([screen, engine]);
  assert.equal(f.discoveries.count, 4, "one discovery served both");
});

test("a task is not created when the engine's fresh discovery fails or no longer finds its runner", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const input = { title: "Improve README", body: "", agentId: alice.id, risk: "normal" };
  // The cached discovery (within 5 s) still says ready; the fresh one fails.
  const logged = t.mock.method(console, "error", () => {});
  f.discoveries.failure = new Error("discovery is down");
  await assert.rejects(f.office.createTask(input), { code: "AGENT_RUNNER_NOT_READY", message: "agent 실행기를 확인하세요." });
  assert.equal(logged.mock.callCount(), 1, "the discovery failure is logged");
  f.discoveries.failure = null;
  // The fresh one finds claude logged out since the cached one.
  f.state.current = loggedOut("claude");
  await assert.rejects(f.office.createTask(input), { code: "AGENT_RUNNER_NOT_READY" });
  assert.equal(count(f, "tasks"), 0, "nothing was stored");
  assert.equal(f.calls.planning.length, 0);
});

/** A planning run whose runner failed before any output: the engine offers a
 * planning-retry decision (as in the native-office runner failure test). */
async function runnerFailure(f, id) {
  const { intake, execution } = f.ledgers;
  const i = intake.get(id);
  const lease = execution.reservePlanning(id, i.revision, i.inputDigest, "b".repeat(64), 10000);
  execution.startPlanning(lease.id, "closed-planner");
  intake.interrupt(id, i.revision, i.inputDigest, "PLANNING_INVALID", { detail: "runner: not logged in", origin: "runner" });
  execution.finishPlanning(lease.id, "closed-planner", {
    closed: true,
    result: { exitCode: 1, signal: null, error: null, timedOut: false, stdout: "", stderr: "" },
  });
  await f.office.refresh();
}

test("a planning retry gives the engine a fresh discovery before the planning role runs again", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await runnerFailure(f, id);
  const retry = (await f.office.decisions()).find((d) => d.decision_kind === "planning-retry");
  assert.ok(retry, "a planning-retry decision is open");
  let card = locate(f.office.board(), id);
  assert.deepEqual([card.column, card.stopped], ["decide", false], "a decision to answer is not a stop");
  // The person logs in again; the engine still holds the discovery from task creation.
  const later = readyCatalog();
  f.state.current = later;
  assert.notEqual(f.captured.runners.settings.catalog, later);
  await f.office.reply(retry.id, 1, "다시 로그인했습니다.");
  assert.equal(f.captured.runners.settings.catalog, later, "the engine checks jobs against today's discovery");
  assert.equal(f.calls.planning.length, 2, "the retry started planning again");
});

test("a decision on a subtask names and links its request", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  const [story] = await f.office.decisions();
  assert.deepEqual([story.task_id, story.root_id, story.root_title], [id, id, "Improve README"]);
  await answer(f, "story");
  const child = await publishChild(f, id);
  const [g1] = await f.office.decisions();
  assert.equal(g1.decision_kind, "G1");
  assert.deepEqual([g1.task_id, g1.task_title], [child, "Input validation"], "the engine's own fields stay");
  assert.deepEqual([g1.root_id, g1.root_title], [id, "Improve README"]);
  const [shown] = f.office.detail(id).decisions;
  assert.deepEqual([shown.id, shown.root_id, shown.root_title], [g1.id, id, "Improve README"]);
  // The request is what the screen can open; the subtask is not.
  assert.equal(f.office.detail(g1.root_id).id, id);
  assert.throws(() => f.office.detail(g1.task_id), { code: "NOT_FOUND" });
});

test("a request whose planning stopped without a decision is stopped, with the engine's reason, until it is cancelled", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  f.state.active = [{ taskId: id, kind: "planning" }];
  let card = locate(f.office.board(), id);
  assert.deepEqual([card.column, card.stopped, card.stopReason], ["active", false, null], "running is not stopped");
  // The run ends refused: the engine stops the intake and will not retry it.
  f.state.active = [];
  const i = f.ledgers.intake.get(id);
  f.ledgers.intake.interrupt(id, i.revision, i.inputDigest, "RUNNER_EXITED");
  const reason = "작업이 멈췄습니다: RUNNER_EXITED. 자동 재시도하지 않습니다.";
  card = locate(f.office.board(), id);
  assert.deepEqual([card.column, card.stage, card.stopped, card.stopReason], ["active", "plan", true, reason], "from the intake's state");
  await f.office.refresh();
  const detail = f.office.detail(id);
  assert.deepEqual([detail.stopped, detail.stopReason], [true, reason]);
  assert.ok(detail.events.some((e) => e.text === reason), "the same words as the engine's notice");
  await f.office.cancel(id);
  card = locate(f.office.board(), id);
  assert.deepEqual([card.column, card.stopped, card.stopReason], ["cancelled", false, null]);
});

test("a subtask that verification handed to a person stops its request", async (t) => {
  const f = await fixture(t);
  const { id, child } = await verifiedChild(f, "unknown");
  assert.equal(f.db.prepare("SELECT status FROM tasks WHERE id=?").get(child).status, "pending");
  const card = locate(f.office.board(), id);
  assert.deepEqual([card.column, card.stopped], ["active", true]);
  assert.equal(card.stopReason, "하위 작업이 멈췄습니다: UNKNOWN_RESULT (Input validation). 자동으로 다시 실행하지 않습니다.");
  assert.equal(f.office.detail(id).stopReason, card.stopReason);
});

test("a failed run the engine will not repeat stops its request until it runs again", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: alice.id, risk: "normal" });
  await storyReady(f, id);
  await answer(f, "story");
  const child = await publishChild(f, id);
  await answer(f, "G1", "실행 범위를 확인했습니다.");
  f.state.active = [{ taskId: child, kind: "implementation" }];
  assert.equal(locate(f.office.board(), id).stopped, false, "running");
  f.state.active = [];
  f.state.lastError = { taskId: child, code: "LIVE_EXECUTION_FAILED" };
  await f.office.refresh();
  const reason = "실행이 멈췄습니다: LIVE_EXECUTION_FAILED. 자동으로 다시 실행하지 않습니다.";
  let card = locate(f.office.board(), id);
  assert.deepEqual([card.column, card.stage, card.stopped, card.stopReason], ["active", "build", true, reason]);
  assert.deepEqual([f.office.detail(id).stopped, f.office.detail(id).stopReason], [true, reason]);
  f.state.active = [{ taskId: child, kind: "implementation" }];
  card = locate(f.office.board(), id);
  assert.deepEqual([card.stopped, card.stopReason], [false, null], "a run of it is under way again");
});

test("a step whose run was recorded before a restart is held and stopped; the waiting task runs", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  const first = await f.office.createTask({ title: "First", body: "", agentId: alice.id, risk: "normal" });
  f.state.active = [{ taskId: first.id, kind: "planning" }];
  const second = await f.office.createTask({ title: "Second", body: "", agentId: alice.id, risk: "normal" });
  assert.equal(locate(f.office.board(), second.id).stopped, false, "waiting is not stopped");
  // The process restarts while the first run was recorded: the engine holds it.
  f.state.active = [];
  await f.reopen();
  await tick();
  f.state.active = [{ taskId: second.id, kind: "planning" }];
  const board = f.office.board();
  const held = locate(board, first.id);
  assert.deepEqual([held.column, held.stopped], ["active", true]);
  assert.match(held.stopReason, /^이 단계는 이미 실행 요청이 기록되어 있습니다\./);
  const running = locate(board, second.id);
  assert.deepEqual([running.column, running.stopped, running.stopReason], ["active", false, null]);
});

const CHANGES = /\[변경사항\]\n1\. [^\n]*\n2\. [^\n]*\n3\. [^\n]*/;

test("the detail's result summary is the final approval's change summary, and it outlives the decision", async (t) => {
  const f = await fixture(t);
  const { id, child } = await verifiedChild(f);
  assert.equal(f.office.detail(id).summary, null, "nothing to summarize before the final approval is requested");
  await f.office.refresh();
  const g4 = (await f.office.decisions()).find((d) => d.decision_kind === "G4");
  const block = CHANGES.exec(g4.summary)[0];
  assert.match(block, /^\[변경사항\]\n1\. 작업: /);
  assert.equal(f.office.detail(id).summary, block, "while the decision is open");
  await answer(f, "G4", "1. Changes src/a to after\n2. Delivery needs matching verification\n3. Fixture evidence only");
  const g4Row = f.ledgers.completion.get(child);
  f.ledgers.completion.evaluate(
    TOKEN,
    g4Row.id,
    g4Row.answerDigest,
    Object.fromEntries(["behavior", "invariant", "evidence"].map((k) => [k, { correct: true, rationale: "Matches" }])),
  );
  await f.office.refresh();
  const detail = f.office.detail(id);
  assert.equal(detail.status, "done");
  assert.equal(detail.deliveries[0].status, "delivered");
  assert.deepEqual(await f.office.decisions(), []);
  assert.equal(detail.summary, block, "kept after the answer and the delivery");
});

// --- Residual round: an agent's runner saved after a later login.

test("a review runner chosen after a later login for a busy agent runs that task's reviewer job", async (t) => {
  const f = await fixture(t, { catalog: (root) => installedCatalog(root, { claudeLoggedIn: false }) });
  const { runners } = f.captured;
  await f.office.agents.ensureDefault();
  const worker = await f.office.agents.create({ name: "Worker", work: codex(), review: codex() });
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: worker.id, risk: "normal" });
  engineChild(f, "child-1", id);
  assert.equal(f.office.agents.list().find((a) => a.id === worker.id).busy, true);
  // The person logs in to claude; the agent dialog's runner list sees it.
  f.state.catalog = installedCatalog(f.root);
  assert.equal((await f.office.runners()).runners.find((r) => r.runner === "claude").loggedIn, true);
  await f.office.agents.update(worker.id, { review: claude("sonnet") });
  const jobs = engineJobs(runners);
  const out = await jobs.run("reviewer", "child-1");
  assert.equal(out.result.error, null, "the reviewer job was accepted, not refused");
  assert.deepEqual(jobs.calls.map((c) => [c.runner, c.options.selection.model]), [["claude", "sonnet"]]);
});

test("saving an agent's runner checks it against a fresh discovery the engine also gets; a rename runs none", async (t) => {
  const f = await fixture(t);
  const { alice } = await agents(f);
  f.clock.now += TTL;
  f.discoveries.count = 0;
  await f.office.agents.update(alice.id, { name: "Alicia" });
  assert.equal(f.discoveries.count, 0, "a rename runs no discovery");
  await f.office.agents.update(alice.id, { review: claude("haiku") });
  assert.equal(f.discoveries.count, 1);
  // Inside the 5 s window: still a fresh discovery, and the engine holds it.
  f.state.current = readyCatalog();
  await f.office.agents.update(alice.id, { work: codex("gpt-6-sol") });
  assert.equal(f.discoveries.count, 2, "fresh even inside the 5 s window");
  assert.equal(f.captured.runners.settings.catalog, f.state.current, "the engine checks jobs against it");
  await f.office.agents.create({ name: "Bob", work: claude(), review: claude() });
  assert.equal(f.discoveries.count, 3, "creating an agent does the same");
  // The save is checked against that discovery, not the cached one.
  f.state.current = loggedOut("claude");
  await assert.rejects(f.office.agents.update(alice.id, { review: claude("sonnet") }), { code: "RUNNER_NOT_READY" });
  // A failed discovery saves nothing.
  f.state.current = readyCatalog();
  const logged = t.mock.method(console, "error", () => {});
  f.discoveries.failure = new Error("discovery is down");
  await assert.rejects(f.office.agents.update(alice.id, { review: claude("sonnet") }), {
    code: "AGENT_RUNNER_NOT_READY",
    message: "agent 실행기를 확인하세요.",
  });
  await assert.rejects(f.office.agents.create({ name: "Carol", work: claude(), review: claude() }), { code: "AGENT_RUNNER_NOT_READY" });
  assert.equal(logged.mock.callCount(), 2);
  f.discoveries.failure = null;
  const after = f.office.agents.list().find((a) => a.id === alice.id);
  assert.deepEqual([after.name, after.review.model], ["Alicia", "haiku"], "nothing changed");
  assert.equal(f.office.agents.list().some((a) => a.name === "Carol"), false);
});
