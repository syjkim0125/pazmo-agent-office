import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { createNativeOffice } from "../src/runtime/native-office.ts";

test("native assignment adopts the original task and uses the same authoritative database", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-office-"))),
    project = join(root, "project");
  mkdirSync(project);
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  const calls = [];
  const live = {
    status: () => ({ execution: "ready", active: [] }),
    startPlanning: (...args) => calls.push(args),
    assertIdle() {},
    close: async () => {},
    abort() {},
  };
  const office = await createNativeOffice({
    db,
    project,
    dataDir: root,
    token: "a".repeat(64),
    createRuntime: async () => live,
  });
  t.after(async () => {
    await office.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  db.prepare(
    "INSERT INTO tasks(id,title,project_path,status) VALUES ('11111111-1111-4111-8111-111111111111','Improve README',?,'inbox')",
  ).run(project);
  await office.assign("11111111-1111-4111-8111-111111111111");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 1);
  assert.equal(
    db.prepare("SELECT task_id FROM pazmo_intakes").get().task_id,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(calls.length, 1);
  await office.assign("11111111-1111-4111-8111-111111111111");
  assert.equal(calls.length, 1, "must not replay uncertain planning dispatch");
  assert.equal(
    office.progress("11111111-1111-4111-8111-111111111111").canRun,
    false,
  );
  assert.doesNotThrow(() => office.checkTaskMutation(taskId, { hidden: 1 }));
  assert.throws(
    () => office.checkTaskMutation(taskId, { hidden: 1, status: "done" }),
    /managed/,
  );
  assert.throws(
    () => office.checkTaskMutation(taskId, { hidden: 2 }),
    /managed/,
  );
  assert.throws(
    () => office.checkTaskMutation("11111111-1111-4111-8111-111111111111"),
    /managed/,
  );
});

async function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-office-"))),
    project = join(root, "project");
  mkdirSync(project);
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  const calls = [];
  const live = {
    status: () => ({ execution: "ready", active: [] }),
    startPlanning: (...args) => calls.push(args),
    assertIdle() {},
    close: async () => {},
    abort() {},
  };
  const config = {
    db,
    project,
    dataDir: root,
    token: "a".repeat(64),
    createRuntime: async () => live,
  };
  let office = await createNativeOffice(config);
  t.after(async () => {
    await office.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    db,
    project,
    office,
    calls,
    live,
    async restart() {
      await office.close();
      office = await createNativeOffice(config);
      return office;
    },
  };
}
const taskId = "11111111-1111-4111-8111-111111111111";
function task(f, status = "inbox") {
  f.db
    .prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,?)")
    .run(taskId, "Update README", status);
}
function human(f, id, content) {
  f.db
    .prepare(
      "INSERT INTO messages(id,sender_type,receiver_type,content,message_type) VALUES (?,'ceo','agent',?,'chat')",
    )
    .run(id, content);
}

test("failed adoption rolls back metadata and does not start a model", async (t) => {
  const f = await fixture(t);
  task(f, "done");
  await assert.rejects(f.office.assign(taskId));
  assert.equal(
    f.db.prepare("SELECT project_path FROM tasks WHERE id=?").get(taskId)
      .project_path,
    null,
  );
  assert.equal(f.calls.length, 0);
});

test("chat persists one task across repeated ingress and restart without replay", async (t) => {
  const f = await fixture(t);
  human(f, "message-1", "Update README");
  const input = {
    id: "message-1",
    content: "Update README",
    receiverId: null,
    messageType: "task_assign",
  };
  await f.office.chat(input);
  await f.office.chat(input);
  const office = await f.restart();
  await office.refresh();
  await office.chat(input);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 1);
  assert.equal(f.calls.length, 1);
  await assert.rejects(office.chat({ ...input, id: "missing" }), /Persist/);
});

test("cancellation blocks dispatch after restart", async (t) => {
  const f = await fixture(t);
  task(f);
  await f.office.assign(taskId);
  await f.office.cancel(taskId);
  const office = await f.restart();
  await office.refresh();
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(taskId).status,
    "cancelled",
  );
  assert.equal(office.decisions().length, 0);
});

test("ordinary chat cannot approve a pending Story; explicit Decision saves the human answer", async (t) => {
  const f = await fixture(t);
  task(f);
  await f.office.assign(taskId);
  const { continuePlanning } = await import("../src/runners/planning.ts");
  const i = f.office.ledgers.intake.get(taskId),
    packet = f.office.ledgers.intake.packet(taskId, i.revision, i.inputDigest);
  const story = {
    title: "README",
    goal: "Clarify execution",
    domain: "Documentation",
    must: ["Show actual command"],
    should: [],
    out: ["Runtime changes"],
    assumptions: [],
    verify: [{ must: [1], scenario: "Command matches CLI" }],
  };
  f.office.ledgers.intake.acceptKit(
    taskId,
    i.revision,
    i.inputDigest,
    { kind: "lead", packet: continuePlanning(packet, story, "lead") },
    {
      runId: "test",
      runFile: "test",
      nodeId: "requirements",
      action: "role-complete",
      revisionToken: "test",
    },
  );
  await f.office.refresh();
  const agent = f.db
    .prepare("SELECT id FROM agents WHERE department_id='planning' LIMIT 1")
    .get().id;
  f.db
    .prepare("UPDATE tasks SET assigned_agent_id=? WHERE id=?")
    .run(agent, taskId);
  const decision = f.office.decisions()[0];
  assert.ok(decision);
  const [readable, original] = decision.summary.split("\n상세 원문:\n");
  assert.equal(
    readable,
    "요구사항 범위 승인\n\n**README**\n\n목표: Clarify execution\n\n영역: Documentation\n\n꼭 할 일 (MUST)\n- M1. Show actual command\n\n범위 밖 (OUT)\n- Runtime changes\n\n가정 (ASSUMED)\n- 없음\n\n확인 방법 (Verify)\n- V1 [M1]. Command matches CLI\n\n승인은 아래 원문 Story를 기준으로 합니다.",
    "people read the Story, not its JSON",
  );
  assert.doesNotMatch(decision.summary, /[{}"]/);
  const { renderPlanningStory } = await import("../src/runners/planning.ts");
  assert.equal(original, renderPlanningStory(story), "the bound Story stays complete");
  assert.deepEqual(f.office.ledgers.intake.get(taskId).story, story);
  human(f, "negative", "승인 안 해");
  await f.office.chat({
    id: "negative",
    content: "승인 안 해",
    receiverId: agent,
  });
  assert.equal(f.office.ledgers.intake.get(taskId).reason, "G1_REQUIRED");
  assert.equal(f.calls.length, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 1);
  await f.office.reply(
    decision.id,
    1,
    "README 실행 안내만 수정하는 범위를 승인합니다.",
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.office.decisions().length, 0);
  await assert.rejects(f.office.reply(decision.id, 1, "Replay"), /이미 처리/);
});

test("native G4 preserves failed feedback and delivers after explicit human acknowledgment (fixture)", async (t) => {
  const { officeFixture } = await import("./coordinator-fixture.mjs");
  const { writeFileSync } = await import("node:fs");
  const f = await officeFixture(t);
  applyDefaultSeeds(f.db);
  const calls = [];
  const office = await createNativeOffice({
    db: f.db,
    project: f.project,
    dataDir: f.root,
    token: "a".repeat(64),
    createRuntime: async () => ({
      status: () => ({ execution: "ready", active: [] }),
      startUnderstanding: (...args) => calls.push(args),
      assertIdle() {},
      close: async () => {},
    }),
  });
  t.after(() => office.close());
  const { handoffs, execution, completion, store } = office.ledgers;
  const attempt = handoffs.prepare(f.task.id);
  handoffs.start(attempt.leaseId, "fixture-engineer");
  writeFileSync(join(attempt.workspace, "src/a"), "after");
  const observation = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    error: null,
    output: "Scripted fixture only",
  };
  const finished = handoffs.finish(attempt.leaseId, "fixture-engineer", {
    closed: true,
    observation,
  });
  for (const node of finished.round.nodes) {
    const lease = execution.reserveNode(finished.round.id, node.id);
    execution.start(lease.id, node.id);
    execution.finish(lease.id, node.id, {
      closed: true,
      observation: {
        ...observation,
        kind: node.kind,
        ...(node.kind === "review"
          ? { report: { verdict: "pass", findings: [], summary: "Fixture" } }
          : {}),
      },
    });
  }
  // Synthetic publication links the native parent to the verified child.
  const parent = office.ledgers.intake.create(
    "a".repeat(64),
    "README request",
    "normal",
  );
  f.db
    .prepare("INSERT INTO pazmo_intake_publications VALUES (?,?)")
    .run(parent.taskId, JSON.stringify({ taskIds: [f.task.id] }));
  f.db
    .prepare("UPDATE tasks SET status='planned' WHERE id=?")
    .run(parent.taskId);
  await office.refresh();
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(parent.taskId)
      .status,
    "review",
  );
  assert.deepEqual(office.progress(parent.taskId).childTaskIds, [f.task.id]);
  assert.match(office.progress(parent.taskId).message, /Decisions/);
  const runAgain = await office.assign(parent.taskId);
  assert.equal(runAgain.workflow.canRun, false);
  assert.equal(
    calls.length,
    0,
    "Run on a published parent cannot restart implementation",
  );
  const decision = office.decisions()[0];
  assert.ok(decision);
  assert.match(office.diff(f.task.id).diff, /after/);
  assert.notEqual(store.get(f.task.id).status, "done");
  await assert.rejects(office.reply(decision.id, 3, ""), {
    code: "FEEDBACK_REQUIRED",
  });
  await assert.rejects(office.reply(decision.id, 1, "yes"), /3개 질문/);
  assert.equal(completion.get(f.task.id).status, "awaiting_answer");
  const note =
    "1. Changes src/a to after\n2. Cannot deliver without matching verification\n3. This is a fixture, not live evidence";
  await office.reply(decision.id, 1, note);
  const g4 = completion.get(f.task.id);
  assert.equal(g4.answer.note, note);
  assert.equal(g4.approved, false);
  assert.equal(calls.length, 1);
  assert.notEqual(store.get(f.task.id).status, "done");
  completion.evaluate(
    "a".repeat(64),
    g4.id,
    g4.answerDigest,
    Object.fromEntries(
      ["behavior", "invariant", "evidence"].map((k) => [
        k,
        { correct: false, rationale: "Explain fixture boundary" },
      ]),
    ),
  );
  await office.refresh();
  const retry = office.decisions()[0];
  assert.notEqual(retry.id, decision.id);
  assert.match(retry.summary, /다시 답하지 않아도 됩니다/);
  assert.equal(retry.options[0].action, "workflow_acknowledge");
  assert.equal(retry.options[0].number, 3);
  assert.match(retry.summary, /Explain fixture boundary/);
  assert.match(retry.summary, /Changes src\/a to after/);
  assert.match(office.progress(f.task.id).message, /Decisions/);
  await office.refresh();
  assert.equal(office.decisions()[0].id, retry.id);
  assert.equal(calls.length, 1, "feedback projection must not start a model");
  await office.reply(retry.id, 3, "");
  assert.equal(completion.get(f.task.id).evaluation.evidence.correct, false);
  assert.equal(
    completion.get(f.task.id).answer.feedbackAcknowledgment.requestId,
    g4.id,
  );
  await assert.rejects(office.reply(retry.id, 3, ""), /이미 처리/);
  assert.equal(store.get(f.task.id).status, "done");
  assert.equal(completion.delivery(f.task.id).status, "delivered");
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(parent.taskId)
      .status,
    "done",
  );
  await office.refresh();
  assert.equal(calls.length, 1, "acknowledgment must not reassess the human");
});

test("native expired contract Decisions cannot approve and refresh with a new challenge", async (t) => {
  const { officeFixture } = await import("./coordinator-fixture.mjs");
  const f = await officeFixture(t, false);
  applyDefaultSeeds(f.db);
  const office = await createNativeOffice({
    db: f.db,
    project: f.project,
    dataDir: f.root,
    token: "a".repeat(64),
  });
  t.after(() => office.close());
  await office.refresh();
  const first = office.decisions()[0];
  f.db.prepare("UPDATE pazmo_approval_challenges SET expires_at=0").run();
  await assert.rejects(
    office.reply(first.id, 1, "Fixture approval"),
    /expired/,
  );
  assert.equal(office.ledgers.store.get(f.task.id).approved.G1, false);
  await office.refresh();
  assert.notEqual(office.decisions()[0].id, first.id);
});

test("native recovery Decision survives restart and consumes exactly one human request", async (t) => {
  const f = await fixture(t);
  task(f);
  await f.office.assign(taskId);
  const { intake, execution } = f.office.ledgers;
  const i = intake.get(taskId);
  const lease = execution.reservePlanning(
    taskId,
    i.revision,
    i.inputDigest,
    "b".repeat(64),
    10000,
  );
  execution.startPlanning(lease.id, "closed-planner");
  intake.interrupt(taskId, i.revision, i.inputDigest, "PLANNING_INVALID", {
    detail: "story.goal: line break",
  });
  execution.finishPlanning(lease.id, "closed-planner", {
    closed: true,
    result: {
      exitCode: 0,
      signal: null,
      error: null,
      timedOut: false,
      stdout: "invalid",
      stderr: "",
    },
  });
  await f.office.refresh();
  const before = f.office.decisions()[0];
  assert.equal(before.options[0].label, "계획 재개");
  assert.match(before.summary, /\n원인: story\.goal: line break$/);
  const restarted = await f.restart();
  await restarted.refresh();
  assert.equal(restarted.decisions()[0].id, before.id);
  assert.equal(f.calls.length, 1, "restart must not retry on its own");
  await restarted.reply(before.id, 1, "사용자: 재개 연결 마무리해줘.");
  assert.equal(f.calls.length, 2);
  assert.equal(
    restarted.ledgers.intake.get(taskId).events.at(-1).payload.planningRetry
      .note,
    "사용자: 재개 연결 마무리해줘.",
  );
  await assert.rejects(restarted.reply(before.id, 1, "replay"), /이미 처리/);
  assert.equal(f.calls.length, 2);
  assert.equal(
    restarted.ledgers.store.list().length,
    0,
    "recovery is not task approval",
  );
});

test("plan gates show a readable contract summary and keep every document verbatim", async (t) => {
  const { officeFixture } = await import("./coordinator-fixture.mjs");
  const f = await officeFixture(t, false);
  applyDefaultSeeds(f.db);
  f.put(
    "plan.md",
    "# Proposed implementation plan\n\nRequest: r\nInput digest: d\n\nWorker could not access the snapshot; no commands ran.\n\nThis is a model proposal. No repository inspection or approval is established by this document.\n",
  );
  const { readFileSync } = await import("node:fs");
  f.put("task-plan.md", readFileSync(join(f.project, "task.md"), "utf8").replace("Plan source: N/A — small and reversible", "Plan source: plan.md"));
  const task = await f.store.register("a".repeat(64), {
    ...f.input,
    task: "task-plan.md",
    plan: "plan.md",
  });
  const office = await createNativeOffice({
    db: f.db,
    project: f.project,
    dataDir: f.root,
    token: "a".repeat(64),
    createRuntime: async () => ({
      status: () => ({ execution: "ready", active: [] }),
      assertIdle() {},
      close: async () => {},
    }),
  });
  t.after(() => office.close());
  await office.refresh();
  const decision = office.decisions().find((d) => d.task_id === task.id);
  const [readable, original] = decision.summary.split("\n상세 원문:\n");
  assert.match(readable, /^G1: 실행 계획과 범위를 확인해주세요\.\n\n\*\*작업: Input validation\*\*/);
  assert.match(readable, /Story: Validate input \(MUST 1개 · OUT 1개\)/);
  assert.match(readable, /담당 범위: M1, V1/);
  assert.match(readable, /결과: Reject invalid input\./);
  assert.match(readable, /수정 허용 경로 \(1\)\n- src/);
  assert.match(readable, /등록 검사 1개 \(서로 다른 명령 1개\)\n- V1: `node -e /);
  assert.match(readable, /팀장 계획\n> Worker could not access the snapshot; no commands ran\./);
  assert.match(readable, /고위험 결정 문서\(G3\)/);
  assert.doesNotMatch(readable, /This is a model proposal/);
  for (const path of ["story.md", "task-plan.md", "verify.json", "plan.md", "decision.md"])
    assert.ok(original.includes(`${path}\n`), path);
  assert.ok(original.includes(f.story), "documents are verbatim");
  // An already-open Decision gets the new display text without a new challenge.
  f.db.prepare("UPDATE pazmo_native_decisions SET summary='old' WHERE id=?").run(decision.id);
  await office.refresh();
  const again = office.decisions().find((d) => d.task_id === task.id);
  assert.equal(again.id, decision.id);
  assert.equal(again.summary, decision.summary);
});

test("role runner choices persist across live restarts and only CLI-listed values are accepted", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-runners-"))),
    project = join(root, "project");
  mkdirSync(project);
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  const catalogCalls = [];
  const catalog = async (...args) => (catalogCalls.push(args), {
    installs: {
      codex: { runner: "codex", status: "ready", version: "0.160.0", sha256: "a".repeat(64), path: "/c", loggedIn: true, hint: "준비됨" },
      claude: { runner: "claude", status: "ready", version: "2.1.280", sha256: "b".repeat(64), path: "/k", loggedIn: true, hint: "준비됨" },
    },
    models: { codex: [{ slug: "gpt-5.5" }], claude: [{ slug: "haiku" }] },
  });
  const received = [];
  const open = () =>
    createNativeOffice({
      db,
      project,
      dataDir: root,
      token: "a".repeat(64),
      runnerCatalog: catalog,
      live: { controller: "/c", binary: "/b", authHome: "/Users/u/.codex", socket: "/s", userHome: "/Users/u", searchPath: "/opt/bin:/usr/bin" },
      createRuntime: async (...args) => {
        received.push(args[5]);
        return { status: () => ({ execution: "ready", active: [] }), assertIdle() {}, close: async () => {}, abort() {} };
      },
    });
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const first = await open();
  const reviewer = db.prepare("SELECT id FROM agents WHERE department_id='qa' ORDER BY (role='team_leader') DESC,id LIMIT 1").get().id;
  const other = db.prepare("SELECT id FROM agents WHERE department_id='design' LIMIT 1").get()?.id;
  await first.checkAgentMutation(reviewer, { cli_provider: "claude", cli_model: "haiku", oauth_account_id: null });
  db.prepare("UPDATE agents SET cli_provider='claude', cli_model='haiku' WHERE id=?").run(reviewer);
  await assert.rejects(first.checkAgentMutation(reviewer, { cli_provider: "claude", cli_model: "opus" }), /RUNNER_MODEL_UNKNOWN|지원하지 않는 모델/);
  if (other) await assert.rejects(first.checkAgentMutation(other, { cli_provider: "claude" }), /에이전트의 실행기만/);
  assert.deepEqual(Object.keys((await first.cliStatus()).providers).sort(), ["claude", "codex"]);
  assert.deepEqual(first.cliModels().models.claude, [{ slug: "haiku" }]);
  assert.equal(typeof received[0]?.settings?.choice, "function");
  assert.deepEqual(catalogCalls[0], ["/Users/u", "/opt/bin:/usr/bin"], "discovery uses the user's home, not the isolated service HOME");
  await first.close();
  const second = await open();
  assert.equal(db.prepare("SELECT cli_provider FROM agents WHERE id=?").get(reviewer).cli_provider, "claude");
  assert.deepEqual(received[1].settings.choice("reviewer"), { runner: "claude", model: "haiku", reasoning: null });
  await second.close();
});
