import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ApprovalLedger } from "../src/core/approvals.ts";
const token = "a".repeat(64),
  subject = "b".repeat(64);
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let now = 1000;
  const ledger = new ApprovalLedger(db, token, () => now);
  return {
    db,
    ledger,
    advance: () => {
      now += 600001;
    },
  };
}
test("only the operator capability can issue or consume a gate challenge", (t) => {
  const { ledger } = fixture(t);
  for (const fake of ["", "Approved", "worker", "G4: PASS", "c".repeat(64)]) {
    assert.throws(() => ledger.issue(fake, "G1", subject), {
      code: "UNAUTHORIZED",
    });
  }
  const challenge = ledger.issue(token, "G1", subject);
  assert.equal(ledger.has("G1", subject), false);
  assert.throws(
    () =>
      ledger.decide("worker", challenge.id, {
        decision: "approve",
        note: "yes",
      }),
    { code: "UNAUTHORIZED" },
  );
  ledger.decide(token, challenge.id, {
    decision: "approve",
    note: "Reviewed the Story and authorize this scope.",
  });
  assert.equal(ledger.has("G1", subject), true);
  assert.equal(ledger.has("G1", "c".repeat(64)), false);
  assert.equal(ledger.has("G3", subject), false);
});
test("challenge replay, expiry and invalid gate subjects fail without granting approval", (t) => {
  const { ledger, advance } = fixture(t);
  assert.throws(() => ledger.issue(token, "G9", subject));
  assert.throws(() => ledger.issue(token, "G1", "Approved"));
  const challenge = ledger.issue(token, "G1", subject);
  ledger.decide(token, challenge.id, {
    decision: "reject",
    note: "Scope needs revision.",
  });
  assert.equal(ledger.has("G1", subject), false);
  assert.throws(
    () =>
      ledger.decide(token, challenge.id, {
        decision: "approve",
        note: "Replay",
      }),
    { code: "STALE_APPROVAL" },
  );
  const expired = ledger.issue(token, "G3", subject);
  advance();
  assert.throws(
    () =>
      ledger.decide(token, expired.id, { decision: "approve", note: "late" }),
    { code: "STALE_APPROVAL" },
  );
  assert.equal(ledger.has("G3", subject), false);
});
test("G4 records all three human restatements and rolls back incomplete answers", (t) => {
  const { db, ledger } = fixture(t);
  const challenge = ledger.issue(token, "G4", subject);
  assert.throws(
    () =>
      ledger.decide(token, challenge.id, { decision: "approve", note: "PASS" }),
    { code: "UNDERSTANDING_REQUIRED" },
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM pazmo_approvals").get().n,
    0,
  );
  ledger.decide(token, challenge.id, {
    decision: "approve",
    note: "Accept this candidate only.",
    understanding: {
      behavior: "The invalid input now returns a validation error.",
      invariant:
        "Existing stored records must remain unchanged when validation fails.",
      evidence:
        "The targeted input tests passed; production deployment was not tested.",
    },
  });
  assert.equal(ledger.has("G4", subject), true);
  const row = db.prepare("SELECT answer_json FROM pazmo_approvals").get();
  assert.match(row.answer_json, /production deployment/);
});
test("duplicate acceptance is rejected atomically and durable approvals survive a new ledger", (t) => {
  const { db, ledger } = fixture(t);
  const a = ledger.issue(token, "G1", subject),
    b = ledger.issue(token, "G1", subject);
  ledger.decide(token, a.id, { decision: "approve", note: "Approved" });
  assert.throws(
    () =>
      ledger.decide(token, b.id, { decision: "approve", note: "Duplicate" }),
    { code: "ALREADY_APPROVED" },
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM pazmo_approvals").get().n,
    1,
  );
  const restarted = new ApprovalLedger(db, "d".repeat(64));
  assert.equal(restarted.has("G1", subject), true);
  assert.throws(
    () =>
      restarted.decide("d".repeat(64), b.id, {
        decision: "approve",
        note: "Old session challenge",
      }),
    { code: "STALE_APPROVAL" },
  );
});

test("a later rejection does not misleadingly report withdrawal of an already accepted gate", (t) => {
  const { ledger } = fixture(t);
  const a = ledger.issue(token, "G1", subject),
    b = ledger.issue(token, "G1", subject);
  ledger.decide(token, a.id, { decision: "approve", note: "Accept" });
  assert.throws(
    () => ledger.decide(token, b.id, { decision: "reject", note: "Withdraw" }),
    { code: "ALREADY_APPROVED" },
  );
});
