import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { VerificationLedger } from "../src/core/verification.ts";

const token = "a".repeat(64);
async function setup(t, approved = true) {
  const f = fixture(t);
  // Two commands covering the same requirement must remain two required nodes.
  f.verification.checks.push({
    id: "V1",
    argv: ["node", "--check", "input.js"],
    timeoutMs: 1000,
  });
  f.put("verify.json", JSON.stringify(f.verification));
  const db = new DatabaseSync(join(f.root, "office.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token);
  const item = await store.register(token, f.input);
  if (approved)
    for (const gate of ["G1", "G3"]) {
      const c = store.requestApproval(token, item.id, gate);
      store.decide(token, c.id, {
        decision: "approve",
        note: "Accept this exact revision.",
      });
    }
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const candidate = freezeCandidate(f.project, ["story.md"], storage);
  let now = 1000;
  const ledger = new VerificationLedger(db, store, () => now);
  return {
    ...f,
    db,
    store,
    item,
    ledger,
    candidate,
    setNow: (n) => {
      now = n;
    },
  };
}
function observation(node, verdict = "pass") {
  return {
    kind: node.kind,
    exitCode: verdict === "fail" && node.kind === "test" ? 1 : 0,
    signal: null,
    timedOut: false,
    error: null,
    output: "Controller captured output.",
    ...(node.kind === "review"
      ? {
          report: {
            verdict,
            findings: verdict === "fail" ? ["Fix input validation."] : [],
            summary: "Reviewed fixed candidate.",
          },
        }
      : {}),
  };
}
function finish(f, round, node, verdict = "pass", overrides = {}) {
  return f.ledger.record({
    roundId: round.id,
    nodeId: node.id,
    candidateDigest: round.candidate.digest,
    contractDigest: round.contractDigest,
    observation: { ...observation(node, verdict), ...overrides },
  });
}

test("controller findings preserve passed observations, bind the candidate and consume the existing fix budget", async (t) => {
  const f = await setup(t);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const round = f.ledger.begin(f.item.id, f.candidate);
    for (const node of round.nodes) finish(f, round, node);
    const before = f.ledger.get(round.id);
    const feedback = {
      roundId: round.id,
      candidateDigest: round.candidate.digest,
      contractDigest: round.contractDigest,
      source: "controller review",
      findings: ["M1: the wording contradicts the approved behavior."],
    };
    assert.throws(
      () =>
        f.ledger.requestChanges({
          ...feedback,
          candidateDigest: "0".repeat(64),
        }),
      { code: "STALE_EVIDENCE" },
    );
    const after = f.ledger.requestChanges(feedback);
    assert.deepEqual(after.nodes, before.nodes);
    assert.equal(after.g4Subject, null);
    assert.deepEqual(after.integrationFeedback.findings, feedback.findings);
    assert.equal(after.state, attempt < 3 ? "fix_required" : "human_required");
    assert.throws(() => f.ledger.requestChanges(feedback), {
      code: "ROUND_CLOSED",
    });
  }
  assert.throws(() => f.ledger.begin(f.item.id, f.candidate), {
    code: "HUMAN_REQUIRED",
  });
});

test("all required commands and review must join on the exact candidate before G4", async (t) => {
  const f = await setup(t);
  const round = f.ledger.begin(f.item.id, f.candidate);
  assert.equal(round.state, "checking");
  assert.equal(round.nodes.length, 3);
  assert.equal(new Set(round.nodes.map((n) => n.id)).size, 3);
  assert.equal(round.g4Subject, null);
  finish(f, round, round.nodes[2]);
  finish(f, round, round.nodes[0]);
  assert.equal(f.ledger.get(round.id).state, "checking");
  const done = finish(f, round, round.nodes[1]);
  assert.equal(done.state, "awaiting_g4");
  assert.match(done.g4Subject, /^[a-f0-9]{64}$/);
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(f.item.id).status,
    "review",
  );
  assert.equal(f.store.get(f.item.id).execution, "locked");
  assert.throws(() => f.store.requestApproval(token, f.item.id, "G4"), {
    code: "EVIDENCE_REQUIRED",
  });
});

test("missing approval and mismatched, duplicate, unknown-node observations cannot grant success", async (t) => {
  const f = await setup(t, false);
  assert.throws(() => f.ledger.begin(f.item.id, f.candidate), {
    code: "CONTRACT_NOT_READY",
  });
  for (const gate of ["G1", "G3"]) {
    const c = f.store.requestApproval(token, f.item.id, gate);
    f.store.decide(token, c.id, { decision: "approve", note: "Accept." });
  }
  const round = f.ledger.begin(f.item.id, f.candidate),
    node = round.nodes[0];
  const receipt = {
    roundId: round.id,
    nodeId: node.id,
    candidateDigest: "0".repeat(64),
    contractDigest: round.contractDigest,
    observation: observation(node),
  };
  assert.throws(() => f.ledger.record(receipt), { code: "STALE_EVIDENCE" });
  assert.throws(
    () =>
      f.ledger.record({
        ...receipt,
        candidateDigest: round.candidate.digest,
        nodeId: "invented",
      }),
    { code: "STALE_EVIDENCE" },
  );
  finish(f, round, node);
  assert.throws(() => finish(f, round, node), { code: "DUPLICATE_EVIDENCE" });
  assert.equal(f.ledger.get(round.id).state, "checking");
  assert.throws(() => f.ledger.begin(f.item.id, f.candidate), {
    code: "ROUND_ACTIVE",
  });
});

test("failed checks route to at most two automatic fixes, including after reopen", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 3; i++) {
    const round = f.ledger.begin(f.item.id, f.candidate);
    assert.equal(round.number, i + 1);
    finish(f, round, round.nodes[0], "fail");
    assert.equal(
      f.ledger.get(round.id).state,
      "checking",
      "join waits for every required result",
    );
    for (const node of round.nodes.slice(1)) finish(f, round, node);
    assert.equal(
      f.ledger.get(round.id).state,
      i < 2 ? "fix_required" : "human_required",
    );
    f.ledger = new VerificationLedger(f.db, f.store, () => 1000);
  }
  assert.throws(() => f.ledger.begin(f.item.id, f.candidate), {
    code: "HUMAN_REQUIRED",
  });
});

test("timeout, signal, malformed review and review findings never count as pass", async (t) => {
  for (const overrides of [
    { timedOut: true },
    { signal: "SIGTERM" },
    { error: "Runner disconnected" },
    { report: null },
    {
      report: {
        verdict: "pass",
        findings: ["Unresolved defect"],
        summary: "Contradiction",
      },
    },
  ]) {
    await t.test(JSON.stringify(overrides), async (t) => {
      const f = await setup(t),
        round = f.ledger.begin(f.item.id, f.candidate);
      const review = round.nodes.find((n) => n.kind === "review");
      finish(f, round, review, "pass", overrides);
      for (const node of round.nodes.filter((n) => n.kind === "test")) {
        if (f.ledger.get(round.id).state === "checking") finish(f, round, node);
      }
      const result = f.ledger.get(round.id);
      assert.notEqual(result.state, "awaiting_g4");
      assert.equal(result.g4Subject, null);
    });
  }
});

test("candidate and contract changes invalidate even completed evidence permanently", async (t) => {
  for (const target of ["candidate", "contract"])
    await t.test(target, async (t) => {
      const f = await setup(t),
        round = f.ledger.begin(f.item.id, f.candidate);
      for (const node of round.nodes) finish(f, round, node);
      if (target === "candidate") {
        const file = join(f.candidate.directory, "tree/story.md");
        chmodSync(file, 0o600);
        writeFileSync(file, "changed");
      } else f.put("story.md", f.story + "\nChanged contract.\n");
      assert.equal(f.ledger.get(round.id).state, "human_required");
      assert.equal(f.ledger.get(round.id).g4Subject, null);
      if (target === "contract") f.put("story.md", f.story);
      assert.equal(f.ledger.get(round.id).state, "human_required");
    });
});

test("cancel, deadline and restart reject late callbacks without freeing a retry", async (t) => {
  for (const reason of ["cancel", "deadline", "restart"])
    await t.test(reason, async (t) => {
      const f = await setup(t),
        round = f.ledger.begin(f.item.id, f.candidate);
      if (reason === "cancel") f.ledger.cancel(round.id);
      if (reason === "deadline") f.setNow(round.deadline);
      if (reason === "restart") f.ledger.recoverInterrupted();
      assert.throws(() => finish(f, round, round.nodes[0]), {
        code: "ROUND_CLOSED",
      });
      assert.equal(f.ledger.get(round.id).g4Subject, null);
      assert.throws(() => f.ledger.begin(f.item.id, f.candidate), {
        code: "HUMAN_REQUIRED",
      });
    });
});

test("queue failure rolls back result and routing together; restart reads persisted evidence", async (t) => {
  const f = await setup(t),
    round = f.ledger.begin(f.item.id, f.candidate);
  for (const node of round.nodes.slice(0, 2)) finish(f, round, node);
  f.db.exec(
    "CREATE TRIGGER fail_queue BEFORE UPDATE OF status ON tasks BEGIN SELECT RAISE(ABORT, 'queue failed'); END",
  );
  assert.throws(() => finish(f, round, round.nodes[2]), /queue failed/);
  assert.equal(f.ledger.get(round.id).nodes[2].result, null);
  f.db.exec("DROP TRIGGER fail_queue");
  const done = finish(f, round, round.nodes[2]);
  const another = new DatabaseSync(join(f.root, "office.sqlite"));
  try {
    const reopened = new VerificationLedger(
      another,
      new OfficeStore(another, f.project, token),
      () => 1000,
    );
    assert.equal(reopened.get(round.id).g4Subject, done.g4Subject);
  } finally {
    another.close();
  }
});

test("historical cancellation cannot mutate the newer round queue state", async (t) => {
  const f = await setup(t),
    old = f.ledger.begin(f.item.id, f.candidate);
  for (const node of old.nodes) finish(f, old, node, "fail");
  const current = f.ledger.begin(f.item.id, f.candidate);
  f.ledger.cancel(old.id);
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(f.item.id).status,
    "review",
  );
  for (const node of current.nodes) finish(f, current, node);
  assert.equal(f.ledger.get(current.id).state, "awaiting_g4");
});

test("external queue cancellation prevents pending observations from reaching G4", async (t) => {
  const f = await setup(t),
    round = f.ledger.begin(f.item.id, f.candidate);
  f.db.prepare("UPDATE tasks SET status='cancelled' WHERE id=?").run(f.item.id);
  assert.throws(() => finish(f, round, round.nodes[0]), {
    code: "ROUND_CLOSED",
  });
  assert.equal(f.ledger.get(round.id).g4Subject, null);
  assert.equal(
    f.db.prepare("SELECT status FROM tasks WHERE id=?").get(f.item.id).status,
    "cancelled",
  );
});

test("round creation rolls back with queue failure and malformed evidence stays unrecorded", async (t) => {
  const f = await setup(t);
  f.db.exec(
    "CREATE TRIGGER fail_begin BEFORE UPDATE OF status ON tasks BEGIN SELECT RAISE(ABORT, 'begin failed'); END",
  );
  assert.throws(() => f.ledger.begin(f.item.id, f.candidate), /begin failed/);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM pazmo_verification_rounds").get().n,
    0,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM pazmo_verification_nodes").get().n,
    0,
  );
  f.db.exec("DROP TRIGGER fail_begin");
  const round = f.ledger.begin(f.item.id, f.candidate);
  for (const overrides of [
    { exitCode: undefined },
    { output: "x".repeat(1024 * 1024) },
    { kind: "review" },
  ]) {
    assert.throws(() => finish(f, round, round.nodes[0], "pass", overrides), {
      code: "INVALID_EVIDENCE",
    });
    assert.equal(f.ledger.get(round.id).nodes[0].result, null);
  }
});
