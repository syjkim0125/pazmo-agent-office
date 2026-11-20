import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fixture } from "./contract-fixture.mjs";
import { applyLeanSchema } from "../src/lean/schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
const token = "a".repeat(64);
function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "intake.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyLeanSchema(db, "/office-test-project");
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token),
    intake = new IntakeLedger(db, store, f.project);
  return { ...f, db, store, intake };
}
/** A closed turn reporting `body`; `inspect` adds the readonly snapshot command a Lead proposal needs. */
function report(packet, body, inspect = false) {
  return {
    closed: true,
    result: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
      stderr: "",
      stdout: [
        { type: "turn.started" },
        ...(inspect
          ? [
              {
                type: "item.completed",
                item: { type: "command_execution", command: "ls /candidate/tree", exit_code: 0, status: "completed" },
              },
            ]
          : []),
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              version: 1,
              inputDigest: packet.inputDigest,
              ...body,
            }),
          },
        },
        { type: "turn.completed" },
      ]
        .map(JSON.stringify)
        .join("\n"),
    },
  };
}
function ask(f, s) {
  return f.intake.accept(
    s.taskId,
    s.revision,
    s.inputDigest,
    report(f.intake.packet(s.taskId, s.revision, s.inputDigest), {
      status: "questions",
      questions: [
        { id: "Q1", text: "Which parser?", reason: "Determine scope." },
      ],
    }),
  );
}
test("operator listing is bounded, stable across ties and scoped to this project", (t) => {
  const f = setup(t);
  const ids = Array.from(
    { length: 53 },
    (_, n) => f.intake.create(token, `Request ${n}`, "normal").taskId,
  );
  f.db.prepare("UPDATE tasks SET created_at=1234").run();
  const other = new IntakeLedger(f.db, f.store, join(f.root, "other-project"));
  const foreign = other.create(token, "Other project", "normal");
  const first = f.intake.list();
  assert.equal(first.items.length, 50);
  assert.ok(first.nextCursor);
  const second = f.intake.list(first.nextCursor);
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.items, ...second.items].map((x) => x.taskId),
    ids.sort().reverse(),
  );
  assert.ok(first.items.every((x) => !("events" in x) && !("packet" in x)));
  assert.throws(() => f.intake.list(foreign.taskId), { code: "NOT_FOUND" });
  const cancelled = f.intake.get(ids[0]);
  f.intake.cancel(
    token,
    cancelled.taskId,
    cancelled.revision,
    cancelled.inputDigest,
  );
  assert.equal(
    f.intake.list().items.find((x) => x.taskId === ids[0]).state,
    "cancelled",
  );
});
test("intake persists questions and addressed answers in the existing task queue across ledger reconstruction", (t) => {
  const f = setup(t),
    created = f.intake.create(token, "Validate parser input.", "normal");
  assert.equal(created.state, "waiting_pm");
  assert.equal(f.db.prepare("SELECT count(*) n FROM tasks").get().n, 1);
  assert.equal(f.store.list().length, 0);
  const waiting = ask(f, created);
  assert.equal(waiting.state, "awaiting_answer");
  const restored = new IntakeLedger(
    f.db,
    new OfficeStore(f.db, f.project, "b".repeat(64)),
    f.project,
  );
  assert.deepEqual(restored.get(waiting.taskId), waiting);
  assert.throws(
    () =>
      restored.answer(
        token,
        waiting.taskId,
        waiting.revision,
        waiting.inputDigest,
        [{ id: "Q1", answer: "Public parser." }],
      ),
    { code: "UNAUTHORIZED" },
  );
  const next = restored.answer(
    "b".repeat(64),
    waiting.taskId,
    waiting.revision,
    waiting.inputDigest,
    [{ id: "Q1", answer: "Public parser." }],
  );
  assert.equal(next.state, "waiting_pm");
  assert.notEqual(next.inputDigest, waiting.inputDigest);
  assert.deepEqual(
    next.events.map((e) => e.actor),
    ["human", "pm", "human"],
  );
  assert.equal(
    restored.packet(next.taskId, next.revision, next.inputDigest).dialogue[0]
      .answers[0].answer,
    "Public parser.",
  );
  assert.throws(
    () =>
      restored.answer(
        "b".repeat(64),
        waiting.taskId,
        waiting.revision,
        waiting.inputDigest,
        [{ id: "Q1", answer: "Late duplicate." }],
      ),
    { code: "STALE_INTAKE" },
  );
});
test("cancelled, stale and malformed model results cannot overwrite progress or create approval", (t) => {
  const f = setup(t),
    s = f.intake.create(token, "Validate input.", "high"),
    p = f.intake.packet(s.taskId, s.revision, s.inputDigest);
  assert.throws(() => f.intake.create("bad", "Request", "normal"), {
    code: "UNAUTHORIZED",
  });
  assert.throws(
    () =>
      f.intake.accept(s.taskId, s.revision + 1, s.inputDigest, report(p, {})),
    { code: "STALE_INTAKE" },
  );
  const cancelled = f.intake.cancel(token, s.taskId, s.revision, s.inputDigest);
  assert.equal(cancelled.state, "cancelled");
  assert.throws(
    () => f.intake.accept(s.taskId, s.revision, s.inputDigest, report(p, {})),
    { code: "STALE_INTAKE" },
  );
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(s.taskId).status,
    "cancelled",
  );
  const other = f.intake.create(token, "Another request.", "normal");
  const failed = f.intake.accept(
    other.taskId,
    other.revision,
    other.inputDigest,
    { closed: false, result: { stdout: "", exitCode: 0 } },
  );
  assert.equal(failed.state, "human_required");
  assert.equal(failed.reason, "PLANNING_INVALID");
  assert.deepEqual(failed.events.at(-1).payload, {
    error: "PLANNING_INVALID",
    detail: "process not closed",
    origin: "output",
  });
  assert.throws(
    () => f.intake.packet(failed.taskId, failed.revision, failed.inputDigest),
    { code: "INTAKE_STATE" },
  );
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM pazmo_approvals").get().n,
    0,
  );
});
test("wrong question answers and database failure roll back state and transcript together", (t) => {
  const f = setup(t),
    s = ask(f, f.intake.create(token, "Request", "normal"));
  assert.throws(
    () =>
      f.intake.answer(token, s.taskId, s.revision, s.inputDigest, [
        { id: "Q2", answer: "Wrong" },
      ]),
    { code: "PLANNING_INVALID" },
  );
  assert.deepEqual(f.intake.get(s.taskId), s);
  f.db.exec(
    "CREATE TRIGGER reject_intake_event BEFORE INSERT ON pazmo_intake_events BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  const count = f.db.prepare("SELECT count(*) n FROM tasks").get().n;
  assert.throws(
    () => f.intake.create(token, "Must roll back.", "normal"),
    /fixture failure/,
  );
  assert.equal(f.db.prepare("SELECT count(*) n FROM tasks").get().n, count);
  assert.throws(
    () =>
      f.intake.answer(token, s.taskId, s.revision, s.inputDigest, [
        { id: "Q1", answer: "Public parser" },
      ]),
    /fixture failure/,
  );
  assert.deepEqual(f.intake.get(s.taskId), s);
});

test("PM requirements wait for the person's G1, then the Lead proposal survives reconstruction without granting a contract", (t) => {
  const f = setup(t),
    s = f.intake.create(token, "Validate input.", "normal");
  const p = f.intake.packet(s.taskId, s.revision, s.inputDigest);
  const lead = f.intake.accept(
    s.taskId,
    s.revision,
    s.inputDigest,
    report(p, {
      status: "ready",
      story: {
        title: "Validate input",
        goal: "Reject invalid input.",
        domain: "Preserve records.",
        must: ["Reject invalid input."],
        should: [],
        out: ["Deployment."],
        assumptions: [],
        verify: [{ must: [1], scenario: "Invalid input returns error." }],
      },
    }),
  );
  assert.equal(lead.state, "human_required");
  assert.equal(lead.reason, "G1_REQUIRED");
  assert.equal(lead.role, "lead");
  // No Lead turn before G1.
  assert.throws(() => f.intake.packet(lead.taskId, lead.revision, lead.inputDigest), { code: "INTAKE_STATE" });
  const approved = f.intake.approveStory(token, lead.taskId, lead.revision, lead.inputDigest, {
    decision: "approve",
    note: "Fixture human Story approval",
  });
  assert.equal(approved.state, "waiting_lead");
  const packet = f.intake.packet(approved.taskId, approved.revision, approved.inputDigest);
  const body = {
    plan: "Inspect parser, implement and test.",
    tasks: [
      {
        title: "Input validation",
        outcome: "Reject input.",
        scope: "Parser and tests.",
        constraints: "Keep records.",
        must: [1],
        verify: [1],
        checks: [{ id: "V1", argv: ["node", "--test"], timeoutMs: 1000 }],
        workspace: { include: ["src"], exclude: [] },
      },
    ],
  };
  const observation = report(packet, body, true);
  const ready = f.intake.accept(
    approved.taskId,
    approved.revision,
    approved.inputDigest,
    observation,
  );
  assert.equal(ready.state, "proposal");
  const restored = new IntakeLedger(f.db, f.store, f.project).get(s.taskId);
  assert.deepEqual(restored, ready);
  assert.match(restored.proposal.files["story.md"], /Status: Draft/);
  assert.deepEqual(
    restored.events.map((e) => e.actor),
    ["human", "pm", "human", "lead"],
  );
  assert.throws(
    () =>
      f.intake.accept(
        approved.taskId,
        approved.revision,
        approved.inputDigest,
        observation,
      ),
    { code: "STALE_INTAKE" },
  );
  assert.deepEqual(f.store.list(), []);

  // A Lead proposal with no successful command on the readonly snapshot stops for a person.
  const g = setup(t),
    other = g.intake.create(token, "Validate input.", "normal");
  const pm = g.intake.accept(other.taskId, other.revision, other.inputDigest, report(other, { status: "ready", story: restored.story }));
  const toLead = g.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, { decision: "approve", note: "ok" });
  const ungrounded = g.intake.accept(toLead.taskId, toLead.revision, toLead.inputDigest, report(toLead, body));
  assert.equal(ungrounded.state, "human_required");
  assert.equal(ungrounded.reason, "INSPECTION_REQUIRED");
  assert.equal(ungrounded.proposal, null);
});

test("the PM may ask at most three rounds of questions", (t) => {
  const f = setup(t);
  let s = f.intake.create(token, "Validate input.", "normal");
  for (let round = 1; round <= 3; round++) {
    s = ask(f, s);
    assert.equal(s.state, "awaiting_answer");
    s = f.intake.answer(token, s.taskId, s.revision, s.inputDigest, [{ id: "Q1", answer: `answer ${round}` }]);
    assert.equal(s.state, "waiting_pm");
  }
  const fourth = ask(f, s);
  assert.equal(fourth.state, "human_required");
  assert.equal(fourth.reason, "PLANNING_INVALID");
  assert.equal(fourth.events.at(-1).payload.detail, "report: question rounds exhausted");
});
