// Story `story-format-story-qa`, Q8 (M6, person's choice (가) for H1): a plan whose saved PM Story is in the Story
// format before story-qa stops with a plain reason and nothing more runs for it; other plans keep planning.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./contract-fixture.mjs";
import { STORY, observation, pmReady } from "./planning-fixture.mjs";
import { PLAN_ID, planRecord, round } from "./plan-fixture.mjs";
import { addRoleAgents } from "./role-agents-fixture.mjs";
import { applyLeanSchema } from "../src/lean/schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { digest, freezeCandidate } from "../src/core/candidates.ts";
import { LEGACY_STORY, LEGACY_STORY_MESSAGE, reasonText } from "../src/core/legacy-tasks.ts";
import { PlanningCoordinator } from "../src/runners/planning-coordinator.ts";
import { decidedOf, renderTeamStory } from "../src/runners/team-planning.ts";
import { createNativeOffice } from "../src/runtime/native-office.ts";
import { planTextHash } from "../src/hub/plan-protocol.ts";
import { OLD_FORMAT, PlanGateError, checkApprovals } from "../src/team/plan-gates.ts";

const token = "a".repeat(64);
const REASON = "옛 Story 형식으로 만든 기획입니다. 취소하고 다시 만드세요.";
/** A PM Story as Office saved it before story-qa (Goal/Domain/SHOULD/ASSUMED/Verify): it has no `qa`. */
const OLD_STORY = {
  title: "Validate input",
  goal: "Reject invalid input.",
  domain: "Preserve records.",
  must: ["Reject invalid input."],
  should: [],
  out: ["Deployment."],
  assumptions: ["Local use only."],
  verify: [{ must: [1], scenario: "Invalid input returns error." }],
};
const LEAD = {
  plan: "Inspect parser and test.",
  tasks: [
    {
      title: "Input validation",
      outcome: "Reject input.",
      scope: "Parser and tests.",
      constraints: "Keep records.",
      must: [1],
      verify: [1, 2, 3],
      checks: [1, 2, 3].map((n) => ({ id: `Q${n}`, argv: ["node", "--test"], timeoutMs: 1000 })),
      workspace: { include: ["src"], exclude: [] },
    },
  ],
};

/** One project's planning ledgers and a coordinator whose scripted PM returns STORY and Lead returns LEAD. */
function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "planning.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyLeanSchema(db, "/office-test-project");
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token),
    intake = new IntakeLedger(db, store, f.project),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification, Date.now, intake);
  mkdirSync(join(f.root, "context"));
  const context = freezeCandidate(f.project, ["story.md"], join(f.root, "context"));
  const runs = [];
  const planner = {
    async run(candidate, job, beforeStart) {
      runs.push(job.packet.role);
      beforeStart(`fixture-${runs.length}`);
      const body = job.packet.role === "pm" ? { status: "ready", story: STORY } : LEAD;
      const report = observation(job.packet.inputDigest, body, { inspect: job.packet.role === "lead" });
      return { handle: `fixture-${runs.length}`, cleanupErrors: [], ...report };
    },
  };
  const dataDir = join(f.root, "data");
  mkdirSync(dataDir);
  const deps = { intake, execution, planner, jobFor: (packet) => ({ binary: "unused-fixture", timeoutMs: 10000, packet }), dataDir };
  return { ...f, db, store, intake, execution, context, runs, coordinator: new PlanningCoordinator(deps) };
}

/** Puts an old-format PM Story into the request's saved packet, as a request planned before the upgrade has it,
 * keeping its state; the packet's inputDigest is recomputed as Office seals it. */
function markOldStory(db, intake, taskId) {
  const p = JSON.parse(db.prepare("SELECT packet_json FROM pazmo_intakes WHERE task_id=?").get(taskId).packet_json);
  assert.ok(p.story && "qa" in p.story, "the request had a Story before the mark");
  const { inputDigest: _, ...data } = { ...p, story: OLD_STORY };
  db.prepare("UPDATE pazmo_intakes SET packet_json=? WHERE task_id=?").run(
    JSON.stringify({ ...data, inputDigest: digest(JSON.stringify(data)) }),
    taskId,
  );
  return intake.get(taskId);
}

test("옛 Story 형식으로 만든 기획입니다: a request waiting for G1 with an old-format Story stops as LEGACY_STORY, its answer, G1 and retry are refused, no model runs, and a new request still plans", async (t) => {
  const f = setup(t);
  const item = f.intake.create(token, "Validate input.", "normal");
  const pm = (await f.coordinator.run(item.taskId, f.context)).intake;
  assert.deepEqual([pm.state, pm.reason], ["human_required", "G1_REQUIRED"]);
  assert.deepEqual(f.runs, ["pm"]);
  const g1 = markOldStory(f.db, f.intake, item.taskId);
  assert.equal(f.intake.legacy(g1.taskId), true);

  const refused = { code: LEGACY_STORY, message: LEGACY_STORY_MESSAGE };
  assert.throws(
    () => f.intake.approveStory(token, g1.taskId, g1.revision, g1.inputDigest, { decision: "approve", note: "Fixture G1" }),
    refused,
  );
  assert.throws(() => f.intake.answer(token, g1.taskId, g1.revision, g1.inputDigest, [{ id: "Q1", answer: "Public." }]), refused);
  assert.throws(() => f.intake.retryPlanning(token, g1.taskId, g1.revision, g1.inputDigest, "retry"), refused);
  assert.equal(f.intake.get(g1.taskId).revision, g1.revision, "a refusal changes nothing");

  const stopped = f.intake.stopLegacy(g1.taskId);
  assert.deepEqual([stopped.state, stopped.reason], ["human_required", LEGACY_STORY]);
  assert.equal(f.intake.stopLegacy(g1.taskId).revision, stopped.revision, "stopping again changes nothing");
  assert.equal(reasonText(stopped.reason), LEGACY_STORY_MESSAGE);
  assert.ok(LEGACY_STORY_MESSAGE.startsWith(REASON), LEGACY_STORY_MESSAGE);
  assert.deepEqual(f.intake.get(g1.taskId).story, OLD_STORY, "the saved data is kept, not rewritten");
  assert.deepEqual(f.runs, ["pm"], "no model ran for it");
  assert.equal(f.store.list().length, 0, "no contract registered");

  // Another request, made after the upgrade, plans in the new format.
  const other = f.intake.create(token, "Other work.", "normal");
  const next = (await f.coordinator.run(other.taskId, f.context)).intake;
  assert.deepEqual([next.state, next.reason], ["human_required", "G1_REQUIRED"]);
  assert.equal(f.intake.legacy(other.taskId), false);
  assert.deepEqual(next.story, STORY);
});

test("옛 Story 형식으로 만든 기획입니다: a request whose old-format Story was approved before the upgrade stops before its Lead turn, and the controller logs it once", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const f = setup(t);
  const item = f.intake.create(token, "Validate input.", "normal");
  const pm = (await f.coordinator.run(item.taskId, f.context)).intake;
  const approved = f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, { decision: "approve", note: "Fixture G1" });
  assert.equal(approved.state, "waiting_lead");
  markOldStory(f.db, f.intake, item.taskId);
  const planned = f.execution.listPlanning(item.taskId).length;

  const result = await f.coordinator.run(item.taskId, f.context);
  assert.equal(result.state, "human_required");
  assert.equal(result.intake.reason, LEGACY_STORY);
  assert.deepEqual(f.runs, ["pm"], "no Lead turn");
  assert.equal(f.execution.listPlanning(item.taskId).length, planned, "no planning run reserved");
  assert.equal(warnings.mock.calls.filter((c) => String(c.arguments[0]).includes(item.taskId)).length, 1);
  // Its finished state refuses a G1 again with the same code.
  const now = f.intake.get(item.taskId);
  assert.throws(
    () => f.intake.approveStory(token, now.taskId, now.revision, now.inputDigest, { decision: "approve", note: "n" }),
    { code: LEGACY_STORY },
  );
});

test("옛 Story 형식으로 만든 기획입니다: the Office drops the pending G1 card of an old-format Story and tells the person why; nothing plans it", async (t) => {
  t.mock.method(console, "warn", () => {});
  const root = realpathSync(mkdtempSync(join(tmpdir(), "story-format-legacy-"))),
    project = join(root, "project");
  mkdirSync(project);
  const db = new DatabaseSync(":memory:");
  applyLeanSchema(db, "/office-test-project");
  addRoleAgents(db);
  const calls = [];
  const office = await createNativeOffice({
    db,
    project,
    dataDir: root,
    token,
    createRuntime: async () => ({
      status: () => ({ execution: "ready", active: [] }),
      startPlanning: (...args) => calls.push(args),
      assertIdle() {},
      close: async () => {},
      abort() {},
    }),
  });
  t.after(async () => {
    await office.close();
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  for (const id of ids) {
    db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,'inbox')").run(id, "Update README");
    await office.assign(id);
    pmReady(office.ledgers.intake, id, STORY);
  }
  await office.refresh();
  assert.deepEqual(office.decisions().map((d) => [d.task_id, d.decision_kind]).sort(), ids.map((id) => [id, "story"]));

  markOldStory(db, office.ledgers.intake, ids[0]);
  const started = calls.length;
  await office.refresh();
  await office.refresh();
  assert.deepEqual(office.decisions().map((d) => d.task_id), [ids[1]], "only the new-format Story keeps its G1 card");
  const i = office.ledgers.intake.get(ids[0]);
  assert.deepEqual([i.state, i.reason], ["human_required", LEGACY_STORY]);
  assert.equal(calls.length, started, "no planning started");
  const notices = db
    .prepare("SELECT content FROM messages WHERE task_id=? AND content LIKE '작업이 멈췄습니다:%'")
    .all(ids[0])
    .map((m) => m.content);
  assert.deepEqual(notices, [`작업이 멈췄습니다: ${LEGACY_STORY_MESSAGE}`]);
  assert.ok(notices[0].includes(REASON));
});

test("옛 Story 형식으로 만든 기획입니다: a team plan whose stored draft has an old-format Story is refused by checkApprovals (OLD_FORMAT); a new-format plan passes", () => {
  const g1 = (text) => ({
    approvalId: "0b6d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4",
    gate: "G1",
    memberId: "m-pl",
    at: Date.UTC(2026, 10, 6, 23, 30),
    textHash: planTextHash(text),
  });
  const rounds = [round("기간은?", "최근 30일")];
  // The draft text the Hub stored and the PL approved before the upgrade, with the PM Story it was rendered from.
  const oldText =
    "# Story: Validate input\nStatus: Draft\nOwner: Human\nUnderstanding gate (G1): pending\nUnderstanding gate (G4): pending\n\n## Goal\nReject invalid input.\n\n## Domain\nPreserve records.\n\n## MUST\n- M1. Reject invalid input.\n\n## SHOULD\n- None.\n\n## OUT\n- O1. Deployment.\n\n## Decisions\n- D1. ASSUMED: Local use only.\n- D2. PL 답: 기간은? → 최근 30일\n\n## Verify\n- V1 [M1]. Invalid input returns error.\n";
  const old = planRecord({ state: "splitting", rounds, draft: { text: oldText, story: OLD_STORY }, g1: g1(oldText) });
  assert.throws(
    () => checkApprovals(old, { needSplit: false }),
    (error) => {
      assert.ok(error instanceof PlanGateError, String(error));
      assert.equal(error.code, "PLAN_GATE");
      assert.equal(error.message, OLD_FORMAT);
      assert.equal(error.message, REASON);
      return true;
    },
  );
  // The same plan made in the new format passes.
  const text = renderTeamStory(STORY, decidedOf(rounds));
  const fresh = planRecord({ state: "splitting", rounds, draft: { text, story: JSON.parse(JSON.stringify(STORY)) }, g1: g1(text) });
  const passed = checkApprovals(fresh, { needSplit: false });
  assert.deepEqual(passed.story, STORY);
  assert.equal(fresh.id, PLAN_ID);
});
