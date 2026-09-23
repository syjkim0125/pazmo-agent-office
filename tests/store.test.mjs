import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
const token = "a".repeat(64);
function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  return { ...f, db, store: new OfficeStore(db, f.project, token) };
}
function approve(store, id, gate) {
  const challenge = store.requestApproval(token, id, gate);
  store.decide(token, challenge.id, {
    decision: "approve",
    note: "I accept the displayed contract.",
  });
  return challenge;
}
test("same Claw queue stays blocked until exact G1 and high-risk G3 are accepted", async (t) => {
  const { store, db, input } = setup(t);
  const item = await store.register(token, input);
  assert.equal(item.ready, false);
  assert.equal(
    db.prepare("SELECT status FROM tasks WHERE id=?").get(item.id).status,
    "inbox",
  );
  approve(store, item.id, "G1");
  assert.equal(store.get(item.id).ready, false);
  approve(store, item.id, "G3");
  assert.equal(store.get(item.id).ready, true);
  assert.equal(
    db.prepare("SELECT status FROM tasks WHERE id=?").get(item.id).status,
    "planned",
  );
  assert.throws(() => store.requestApproval(token, item.id, "G4"), {
    code: "EVIDENCE_REQUIRED",
  });
  const other = await store.register(token, input);
  assert.equal(
    other.ready,
    false,
    "approval must not transfer to another task",
  );
});
test("edits invalidate readiness and pending approvals, including after refresh", async (t) => {
  const f = setup(t),
    item = await f.store.register(token, f.input);
  approve(f.store, item.id, "G1");
  approve(f.store, item.id, "G3");
  const pending = f.store.requestApproval(token, item.id, "G1");
  f.put("story.md", f.story + "\nChanged scope.\n");
  assert.equal(f.store.get(item.id).blocker, "CONTRACT_CHANGED");
  assert.throws(
    () =>
      f.store.decide(token, pending.id, {
        decision: "approve",
        note: "Old scope",
      }),
    { code: "CONTRACT_CHANGED" },
  );
  const updated = await f.store.register(token, f.input, item.id);
  assert.equal(updated.revision, 2);
  assert.equal(updated.ready, false);
  assert.throws(
    () =>
      f.store.decide(token, pending.id, {
        decision: "approve",
        note: "Old revision",
      }),
    { code: "STALE_APPROVAL" },
  );
  approve(f.store, item.id, "G1");
  approve(f.store, item.id, "G3");
  assert.equal(f.store.get(item.id).ready, true);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n, 1);
});
test("unauthorized writes and registration failures leave no queue or approval fragments", async (t) => {
  const f = setup(t);
  await assert.rejects(f.store.register("worker", f.input), {
    code: "UNAUTHORIZED",
  });
  f.db.exec(
    `CREATE TRIGGER reject_contract BEFORE INSERT ON pazmo_contract_revisions BEGIN SELECT RAISE(ABORT, 'injected'); END;`,
  );
  await assert.rejects(f.store.register(token, f.input), /injected/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n, 0);
  f.db.exec("DROP TRIGGER reject_contract");
  const item = await f.store.register(token, f.input);
  const challenge = f.store.requestApproval(token, item.id, "G1");
  assert.throws(
    () =>
      f.store.decide("worker", challenge.id, {
        decision: "approve",
        note: "forged",
      }),
    { code: "UNAUTHORIZED" },
  );
  assert.equal(f.store.get(item.id).ready, false);
});
test("restart preserves approvals, freezes active contracts and never infers approval from Markdown", async (t) => {
  const f = setup(t);
  f.put("g1.md", "An AI wrote that a human accepted.");
  f.put(
    "story.md",
    f.story.replace(
      "Status: Draft",
      "Status: Approved\nUnderstanding gate (G1): g1.md · 2026-09-19 · Check-in: accepted",
    ),
  );
  const item = await f.store.register(token, f.input);
  assert.equal(item.ready, false);
  approve(f.store, item.id, "G1");
  approve(f.store, item.id, "G3");
  const restarted = new OfficeStore(f.db, f.project, "b".repeat(64));
  assert.equal(restarted.get(item.id).ready, true);
  f.db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(item.id);
  await assert.rejects(restarted.register("b".repeat(64), f.input, item.id), {
    code: "TASK_ACTIVE",
  });
});

test("queue update failure rolls back the accepted approval and challenge consumption together", async (t) => {
  const f = setup(t),
    item = await f.store.register(token, f.input);
  const challenge = f.store.requestApproval(token, item.id, "G1");
  f.db.exec(
    `CREATE TRIGGER fail_status BEFORE UPDATE OF status ON tasks BEGIN SELECT RAISE(ABORT, 'status failure'); END;`,
  );
  assert.throws(
    () =>
      f.store.decide(token, challenge.id, {
        decision: "approve",
        note: "Approve",
      }),
    /status failure/,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM pazmo_approvals").get().n,
    0,
  );
  assert.equal(
    f.db
      .prepare("SELECT consumed_at FROM pazmo_approval_challenges WHERE id=?")
      .get(challenge.id).consumed_at,
    null,
  );
  f.db.exec("DROP TRIGGER fail_status");
  f.store.decide(token, challenge.id, {
    decision: "approve",
    note: "Approve after recovery",
  });
  assert.equal(f.store.get(item.id).approved.G1, true);
});
