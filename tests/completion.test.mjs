import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { CompletionLedger } from "../src/core/completion.ts";
import { HandoffLedger } from "../src/core/handoffs.ts";
import { handleOperator } from "../src/runtime/operator.ts";

const token = "a".repeat(64);

test("operator evidence is authenticated, read-only and bound to the current verified candidate", async (t) => {
  const f = await setup(t);
  const server = createServer(
    (req, res) =>
      void handleOperator(
        req,
        res,
        new URL(req.url, "http://localhost").pathname,
        f,
      ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/pazmo/evidence/${f.task.id}`;
  const get = (auth = token) =>
    fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
  assert.equal((await get("worker")).status, 401);
  assert.equal((await get()).status, 409);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const response = await get();
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.equal(view.roundId, f.round.id);
  assert.equal(view.evidence.diff.candidateDigest, f.round.candidate.digest);
  assert.match(view.evidence.diff.rawDiff, /validate\(input\)/);
  assert.equal(view.questions.length, 3);
  assert.equal(view.completion.status, "not_requested");
  assert.equal(f.completion.get(f.task.id).status, "not_requested");
  const request = f.completion.request(token, f.task.id);
  assert.equal((await (await get()).json()).completion.id, request.id);
  f.verification.invalidate(f.round.id, "TEST_INVALIDATION");
  assert.equal((await get()).status, 409);
});

test("operator HTTP can submit an answer but cannot forge its evaluation", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const server = createServer(
    (req, res) =>
      void handleOperator(
        req,
        res,
        new URL(req.url, "http://localhost").pathname,
        f,
      ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port;
  const send = (path, value, auth = token) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + auth,
      },
      body: JSON.stringify(value),
    });
  assert.equal(
    (
      await send(
        "/api/pazmo/approvals/request",
        { taskId: f.task.id, gate: "G4" },
        "worker",
      )
    ).status,
    401,
  );
  const response = await send("/api/pazmo/approvals/request", {
    taskId: f.task.id,
    gate: "G4",
  });
  assert.equal(response.status, 201);
  const request = await response.json();
  const submitted = await (
    await send("/api/pazmo/approvals/decide", {
      id: request.id,
      answer: { ...answer, evaluation, approved: true },
    })
  ).json();
  assert.equal(submitted.status, "awaiting_evaluation");
  assert.equal(submitted.approved, false);
  assert.equal(
    (
      await send("/api/pazmo/approvals/evaluate", {
        id: request.id,
        evaluation,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await send("/api/pazmo/approvals/prepare", {
        taskId: f.task.id,
        rawDiff: diff,
      })
    ).status,
    404,
  );
  f.completion.evaluate(token, request.id, submitted.answerDigest, evaluation);
  const view = await (
    await fetch(url + "/api/pazmo/verification/" + f.task.id, {
      headers: { Authorization: "Bearer " + token },
    })
  ).json();
  assert.equal(view.completion.approved, true);
  assert.equal(view.execution, "locked");
  assert.ok(!JSON.stringify(view).includes(token));
});
const answer = {
  decision: "approve",
  note: "Accept this exact candidate after evaluation.",
  understanding: {
    behavior: "Invalid input returns a validation error.",
    invariant: "A rejected input preserves existing records.",
    evidence: "The fixture tests ran; production deployment is untested.",
  },
};
const evaluation = {
  behavior: {
    correct: true,
    rationale: "Matches the changed validation branch.",
  },
  invariant: {
    correct: true,
    rationale: "Matches the unchanged-record assertion.",
  },
  evidence: {
    correct: true,
    rationale: "Correctly limits the test evidence to the fixture.",
  },
};
const diff =
  "--- a/input.js\n+++ b/input.js\n@@ -1 +1 @@\n-accept(input)\n+validate(input)\n";

test("multiple open questions cannot hide an accepted answer or swap its response digest", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const first = f.completion.request(token, f.task.id),
    second = f.completion.request(token, f.task.id);
  const submitted = f.completion.submit(token, first.id, answer);
  assert.equal(submitted.id, first.id);
  assert.match(submitted.answerDigest, /^[a-f0-9]{64}$/);
  f.completion.evaluate(token, first.id, submitted.answerDigest, evaluation);
  assert.equal(f.completion.get(f.task.id).id, first.id);
  assert.equal(f.completion.get(f.task.id).approved, true);
  assert.throws(() => f.completion.submit(token, second.id, answer), {
    code: "ALREADY_APPROVED",
  });
});

test("expired questions are visible as expired and cannot accept an answer", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  f.db
    .prepare("UPDATE pazmo_approval_challenges SET expires_at=0 WHERE id=?")
    .run(request.id);
  assert.equal(f.completion.get(f.task.id).status, "expired");
  assert.throws(() => f.completion.submit(token, request.id, answer), {
    code: "STALE_APPROVAL",
  });
  assert.equal(f.completion.get(f.task.id).approved, false);
});
async function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "office.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  f.put(
    "verify.json",
    JSON.stringify({
      ...f.verification,
      workspace: { include: ["story.md", "input.js"], exclude: [] },
    }),
  );
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const store = new OfficeStore(db, f.project, token),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification);
  const handoffs = new HandoffLedger(
    db,
    store,
    verification,
    execution,
    f.project,
    storage,
  );
  const completion = new CompletionLedger(
    db,
    store,
    verification,
    execution,
    token,
    handoffs,
  );
  const task = await store.register(token, f.input);
  for (const gate of ["G1", "G3"]) {
    const c = store.requestApproval(token, task.id, gate);
    store.decide(token, c.id, {
      decision: "approve",
      note: "Fixture contract only.",
    });
  }
  const attempt = handoffs.prepare(task.id);
  handoffs.start(attempt.leaseId, "fixture-engineer");
  writeFileSync(join(attempt.workspace, "input.js"), "validate(input)\n");
  const completed = handoffs.finish(attempt.leaseId, "fixture-engineer", {
    closed: true,
    observation: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
      output: "Fixture engineer",
    },
  });
  const candidate = completed.candidate,
    round = completed.round,
    baseline = attempt.baseline;
  function finish(node) {
    const lease = execution.reserveNode(round.id, node.id),
      handle = "fixture-" + node.id;
    execution.start(lease.id, handle);
    execution.finish(lease.id, handle, {
      closed: true,
      observation: {
        kind: node.kind,
        exitCode: 0,
        signal: null,
        timedOut: false,
        error: null,
        output: "Fixture observation",
        ...(node.kind === "review"
          ? {
              report: {
                verdict: "pass",
                findings: [],
                summary: "Fixture review",
              },
            }
          : {}),
      },
    });
  }
  return {
    ...f,
    db,
    store,
    verification,
    execution,
    completion,
    task,
    candidate,
    baseline,
    handoffs,
    storage,
    round,
    finish,
  };
}
test("G4 requires joined evidence, closed execution receipts and a frozen raw diff", async (t) => {
  const f = await setup(t);
  assert.throws(() => f.completion.request(token, f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  f.finish(f.round.nodes[0]);
  await assert.rejects(f.completion.prepare(f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  f.finish(f.round.nodes[1]);
  assert.throws(() => f.completion.request(token, f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  await f.completion.prepare(f.task.id);
  assert.deepEqual(
    await f.completion.prepare(f.task.id, f.candidate),
    await f.completion.prepare(f.task.id),
  );
  assert.throws(() => f.completion.request("worker", f.task.id), {
    code: "UNAUTHORIZED",
  });
  const request = f.completion.request(token, f.task.id);
  assert.match(request.evidence.diff.rawDiff, /new file mode/);
  assert.equal(request.evidence.diff.baselineDigest, f.baseline.digest);
  assert.equal(request.evidence.diff.roundTripVerified, true);
  assert.equal(request.evidence.diff.candidateDigest, f.candidate.digest);
  assert.equal(request.status, "awaiting_answer");
  assert.equal(request.questions.length, 3);
  assert.equal(request.evaluation, null);
  assert.equal(f.completion.get(f.task.id).approved, false);
});

test("joined fixture results without supervised execution receipts cannot open G4", async (t) => {
  const f = await setup(t);
  for (const node of f.round.nodes)
    f.verification.record({
      roundId: f.round.id,
      nodeId: node.id,
      candidateDigest: f.candidate.digest,
      contractDigest: f.round.contractDigest,
      observation: {
        kind: node.kind,
        exitCode: 0,
        signal: null,
        timedOut: false,
        error: null,
        output: "Direct fixture observation",
        ...(node.kind === "review"
          ? {
              report: {
                verdict: "pass",
                findings: [],
                summary: "Direct fixture review",
              },
            }
          : {}),
      },
    });
  assert.equal(f.verification.get(f.round.id).state, "awaiting_g4");
  await assert.rejects(f.completion.prepare(f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  assert.equal(f.completion.get(f.task.id).approved, false);
});
test("human text alone cannot approve G4; evaluation binds the exact answer and candidate", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  assert.throws(
    () =>
      f.completion.submit(token, request.id, {
        decision: "approve",
        note: "yes",
      }),
    { code: "UNDERSTANDING_REQUIRED" },
  );
  const submitted = f.completion.submit(token, request.id, {
    ...answer,
    evaluation,
  });
  assert.equal(submitted.status, "awaiting_evaluation");
  assert.equal(f.completion.get(f.task.id).approved, false);
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM pazmo_approvals WHERE gate='G4'")
      .get().n,
    0,
  );
  assert.throws(
    () => f.completion.evaluate(token, request.id, "b".repeat(64), evaluation),
    { code: "STALE_APPROVAL" },
  );
  assert.throws(
    () =>
      f.completion.evaluate(
        "worker",
        request.id,
        submitted.answerDigest,
        evaluation,
      ),
    { code: "UNAUTHORIZED" },
  );
  f.completion.evaluate(token, request.id, submitted.answerDigest, evaluation);
  assert.equal(f.completion.get(f.task.id).approved, true);
  assert.equal(f.store.get(f.task.id).status, "review");
  assert.equal(f.store.get(f.task.id).execution, "locked");
  assert.throws(() => f.completion.submit(token, request.id, answer), {
    code: "STALE_APPROVAL",
  });
  assert.throws(() => f.completion.request(token, f.task.id), {
    code: "ALREADY_APPROVED",
  });
});
test("an incorrect restatement requires a new answer before it can be accepted", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const first = f.completion.request(token, f.task.id),
    submitted = f.completion.submit(token, first.id, answer);
  f.completion.evaluate(token, first.id, submitted.answerDigest, {
    ...evaluation,
    evidence: {
      correct: false,
      rationale: "Must distinguish mocked review from a real model review.",
    },
  });
  assert.equal(f.completion.get(f.task.id).status, "needs_restatement");
  assert.equal(f.completion.get(f.task.id).approved, false);
  assert.throws(
    () =>
      f.completion.evaluate(
        token,
        first.id,
        submitted.answerDigest,
        evaluation,
      ),
    { code: "STALE_APPROVAL" },
  );
  const second = f.completion.request(token, f.task.id),
    next = f.completion.submit(token, second.id, answer);
  f.completion.evaluate(token, second.id, next.answerDigest, evaluation);
  assert.equal(f.completion.get(f.task.id).approved, true);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM pazmo_g4_requests WHERE answer_json IS NOT NULL",
      )
      .get().n,
    2,
  );
});
test("candidate mutation permanently invalidates pending and accepted G4 evidence", async (t) => {
  for (const accepted of [false, true])
    await t.test(
      accepted ? "after acceptance" : "before evaluation",
      async (t) => {
        const f = await setup(t);
        f.round.nodes.forEach(f.finish);
        await f.completion.prepare(f.task.id);
        const request = f.completion.request(token, f.task.id),
          submitted = f.completion.submit(token, request.id, answer);
        if (accepted)
          f.completion.evaluate(
            token,
            request.id,
            submitted.answerDigest,
            evaluation,
          );
        const path = join(f.candidate.directory, "tree/story.md");
        chmodSync(path, 0o600);
        writeFileSync(path, "changed");
        assert.equal(f.completion.get(f.task.id).approved, false);
        assert.equal(f.completion.get(f.task.id).status, "stale");
        assert.throws(() =>
          f.completion.evaluate(
            token,
            request.id,
            submitted.answerDigest,
            evaluation,
          ),
        );
        writeFileSync(path, f.story);
        chmodSync(path, 0o444);
        assert.equal(f.completion.get(f.task.id).approved, false);
        assert.equal(f.verification.get(f.round.id).state, "human_required");
      },
    );
});
test("evaluation failure rolls back final approval and preserves the submitted answer", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id),
    submitted = f.completion.submit(token, request.id, answer);
  f.db.exec(
    "CREATE TRIGGER reject_g4_evaluation BEFORE UPDATE OF evaluation_json ON pazmo_g4_requests BEGIN SELECT RAISE(ABORT,'evaluation fault'); END",
  );
  assert.throws(
    () =>
      f.completion.evaluate(
        token,
        request.id,
        submitted.answerDigest,
        evaluation,
      ),
    /evaluation fault/,
  );
  assert.equal(f.completion.get(f.task.id).status, "awaiting_evaluation");
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM pazmo_approvals WHERE gate='G4'")
      .get().n,
    0,
  );
  assert.equal(
    f.db
      .prepare("SELECT consumed_at FROM pazmo_approval_challenges WHERE id=?")
      .get(request.id).consumed_at,
    null,
  );
  f.db.exec("DROP TRIGGER reject_g4_evaluation");
  f.completion.evaluate(token, request.id, submitted.answerDigest, evaluation);
  assert.equal(f.completion.get(f.task.id).approved, true);
});

test("contract edits and cancellation invalidate G4 without consuming its answer", async (t) => {
  for (const cause of ["contract", "cancel"])
    await t.test(cause, async (t) => {
      const f = await setup(t);
      f.round.nodes.forEach(f.finish);
      await f.completion.prepare(f.task.id);
      const request = f.completion.request(token, f.task.id),
        submitted = f.completion.submit(token, request.id, answer);
      if (cause === "contract")
        f.put("story.md", f.story + "\nChanged scope\n");
      else f.verification.cancel(f.round.id);
      assert.throws(
        () =>
          f.completion.evaluate(
            token,
            request.id,
            submitted.answerDigest,
            evaluation,
          ),
        { code: "EVIDENCE_REQUIRED" },
      );
      assert.equal(f.completion.get(f.task.id).approved, false);
      assert.equal(f.completion.get(f.task.id).status, "stale");
      assert.equal(
        f.db
          .prepare(
            "SELECT consumed_at FROM pazmo_approval_challenges WHERE id=?",
          )
          .get(request.id).consumed_at,
        null,
      );
      if (cause === "contract")
        assert.equal(f.verification.get(f.round.id).state, "human_required");
    });
});

test("human rejection records no acceptance and cannot be overwritten by evaluation", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  const rejected = f.completion.submit(token, request.id, {
    decision: "reject",
    note: "This behavior needs revision.",
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.approved, false);
  assert.throws(
    () =>
      f.completion.evaluate(
        token,
        request.id,
        rejected.answerDigest,
        evaluation,
      ),
    { code: "STALE_APPROVAL" },
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM pazmo_approvals WHERE gate='G4'")
      .get().n,
    0,
  );
});
test("restart preserves accepted evidence but old pending challenges cannot cross operator sessions", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id),
    submitted = f.completion.submit(token, request.id, answer);
  const nextToken = "d".repeat(64),
    store = new OfficeStore(f.db, f.project, nextToken),
    verification = new VerificationLedger(f.db, store),
    execution = new ExecutionLedger(f.db, store, verification),
    restarted = new CompletionLedger(
      f.db,
      store,
      verification,
      execution,
      nextToken,
      new HandoffLedger(
        f.db,
        store,
        verification,
        execution,
        f.project,
        f.storage,
      ),
    );
  assert.throws(
    () =>
      restarted.evaluate(
        nextToken,
        request.id,
        submitted.answerDigest,
        evaluation,
      ),
    { code: "STALE_APPROVAL" },
  );
  const next = restarted.request(nextToken, f.task.id),
    fresh = restarted.submit(nextToken, next.id, answer);
  restarted.evaluate(nextToken, next.id, fresh.answerDigest, evaluation);
  assert.equal(
    new CompletionLedger(
      f.db,
      store,
      verification,
      execution,
      "e".repeat(64),
      new HandoffLedger(
        f.db,
        store,
        verification,
        execution,
        f.project,
        f.storage,
      ),
    ).get(f.task.id).approved,
    true,
  );
});

test("G4 ignores caller diff overrides and rejects legacy bundles and stale capture", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  assert.deepEqual(
    await f.completion.prepare(f.task.id, diff),
    await f.completion.prepare(f.task.id),
  );
  await f.completion.prepare(f.task.id);
  const stored = f.db.prepare("SELECT * FROM pazmo_g4_evidence").get();
  const altered = JSON.parse(stored.evidence_json);
  altered.diff.modeChanges = [
    { path: "story.md", before: "0644", after: "0777" },
  ];
  f.db
    .prepare("UPDATE pazmo_g4_evidence SET evidence_json=?")
    .run(JSON.stringify(altered));
  assert.throws(() => f.completion.request(token, f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  f.db
    .prepare("UPDATE pazmo_g4_evidence SET evidence_json=?")
    .run(JSON.stringify({ rawDiff: diff }));
  assert.throws(() => f.completion.request(token, f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  f.db
    .prepare("UPDATE pazmo_g4_evidence SET evidence_json=?")
    .run(stored.evidence_json);
  const pending = f.completion.prepare(f.task.id);
  f.verification.cancel(f.round.id);
  await assert.rejects(pending, { code: "EVIDENCE_REQUIRED" });
  assert.equal(f.completion.get(f.task.id).approved, false);
});

test("restoring a tampered original baseline cannot revive G4 eligibility", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  const path = join(f.baseline.directory, "tree/story.md");
  chmodSync(path, 0o600);
  writeFileSync(path, "tampered");
  assert.equal(f.completion.get(f.task.id).approved, false);
  assert.equal(f.verification.get(f.round.id).reason, "BASELINE_CHANGED");
  writeFileSync(path, f.story);
  chmodSync(path, 0o444);
  assert.equal(f.completion.get(f.task.id).status, "stale");
  assert.throws(() => f.completion.submit(token, request.id, answer), {
    code: "EVIDENCE_REQUIRED",
  });
});

test("even passing supervised checks cannot use an unbound Engineer candidate", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  f.db.prepare("DELETE FROM pazmo_handoffs").run();
  await assert.rejects(f.completion.prepare(f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  assert.equal(f.completion.get(f.task.id).approved, false);
});

test("G4 assessment input keeps the human answer and evidence visible while a bounded readonly lease runs", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  const submitted = f.completion.submit(token, request.id, answer);
  assert.equal(typeof f.completion.assessmentInput, "function");
  const input = f.completion.assessmentInput(
    token,
    f.task.id,
    request.id,
    submitted.answerDigest,
  );
  assert.deepEqual(input.answer, answer);
  assert.equal(input.subject, request.subject);
  assert.equal(input.candidate.digest, f.candidate.digest);
  assert.match(input.evidence.diff.rawDiff, /validate\(input\)/);
  assert.throws(
    () =>
      f.completion.assessmentInput(
        token,
        f.task.id,
        request.id,
        "b".repeat(64),
      ),
    { code: "STALE_APPROVAL" },
  );
  const lease = f.execution.reserveUnderstanding(
    f.round.id,
    request.id,
    submitted.answerDigest,
    10000,
  );
  f.execution.start(lease.id, "fixture-understanding");
  assert.equal(f.completion.get(f.task.id).status, "awaiting_evaluation");
  assert.equal(
    f.completion.evidence(token, f.task.id).subject,
    request.subject,
  );
  assert.throws(
    () =>
      f.completion.evaluate(
        token,
        request.id,
        submitted.answerDigest,
        evaluation,
      ),
    { code: "EVIDENCE_REQUIRED" },
  );
  assert.throws(() => f.completion.deliver(token, f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  f.execution.finish(lease.id, "fixture-understanding", { closed: true });
  f.completion.evaluate(token, request.id, submitted.answerDigest, evaluation);
  assert.equal(f.completion.get(f.task.id).approved, true);
  assert.deepEqual(f.completion.get(f.task.id).answer, answer);
});

test("G4 assessment restart retains the unknown slot and refuses replay; closed attempts are bounded", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  const submitted = f.completion.submit(token, request.id, answer);
  assert.equal(typeof f.execution.reserveUnderstanding, "function");
  for (let n = 0; n < 2; n++) {
    const lease = f.execution.reserveUnderstanding(
      f.round.id,
      request.id,
      submitted.answerDigest,
      10000,
    );
    f.execution.start(lease.id, "assessment-" + n);
    if (n === 0)
      f.execution.finish(lease.id, "assessment-" + n, { closed: true });
    else {
      f.execution.recoverInterrupted();
      assert.equal(f.execution.get(lease.id).state, "unknown");
      assert.equal(f.completion.get(f.task.id).approved, false);
      assert.throws(
        () =>
          f.completion.assessmentInput(
            token,
            f.task.id,
            request.id,
            submitted.answerDigest,
          ),
        { code: "EVIDENCE_REQUIRED" },
      );
      assert.throws(
        () =>
          f.execution.reserveUnderstanding(
            f.round.id,
            request.id,
            submitted.answerDigest,
            10000,
          ),
        { code: "TASK_ACTIVE" },
      );
    }
  }
});

for (const scenario of [
  "pass",
  "needs_restatement",
  "forged_subject",
  "string_boolean",
  "missing_aspect",
  "extra_key",
  "tool_output",
  "cancel",
  "abort",
  "expired",
  "unknown",
  "failed_process",
]) {
  test(`trusted G4 runner ${scenario} never replaces the human answer or bypasses closure`, async (t) => {
    const { UnderstandingRunner } =
      await import("../src/runners/understanding.ts");
    const f = await setup(t);
    f.round.nodes.forEach(f.finish);
    await f.completion.prepare(f.task.id);
    const request = f.completion.request(token, f.task.id);
    const submitted = f.completion.submit(token, request.id, answer);
    const report = {
      version: 1,
      requestId: request.id,
      subject: request.subject,
      answerDigest: submitted.answerDigest,
      evaluation: structuredClone(evaluation),
    };
    if (scenario === "needs_restatement")
      report.evaluation.evidence.correct = false;
    if (scenario === "forged_subject") report.subject = "b".repeat(64);
    if (scenario === "string_boolean")
      report.evaluation.behavior.correct = "true";
    if (scenario === "missing_aspect") delete report.evaluation.invariant;
    if (scenario === "extra_key") report.approved = true;
    const events = [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          type:
            scenario === "tool_output" ? "command_execution" : "agent_message",
          text: JSON.stringify(report),
        },
      },
      { type: "turn.completed" },
    ]
      .map(JSON.stringify)
      .join("\n");
    const parent = new AbortController();
    const runner = new UnderstandingRunner({
      completion: f.completion,
      execution: f.execution,
      token,
      jobFor(prompt) {
        assert.ok(prompt.includes(answer.understanding.behavior));
        assert.ok(!prompt.includes(token));
        return { timeoutMs: 10000 };
      },
      planner: {
        async run(candidate, _job, start) {
          assert.equal(candidate.digest, f.candidate.digest);
          start("understanding-fixture");
          assert.equal(
            f.completion.get(f.task.id).status,
            "awaiting_evaluation",
          );
          if (scenario === "abort") parent.abort();
          if (scenario === "cancel") f.verification.cancel(f.round.id);
          if (scenario === "expired")
            f.db
              .prepare(
                "UPDATE pazmo_approval_challenges SET expires_at=0 WHERE id=?",
              )
              .run(request.id);
          return {
            handle: "understanding-fixture",
            closed: scenario !== "unknown",
            result: {
              exitCode: scenario === "failed_process" ? 1 : 0,
              error: null,
              signal: null,
              timedOut: false,
              stdout: events,
              stderr: "",
            },
          };
        },
      },
    });
    if (["pass", "needs_restatement"].includes(scenario))
      await runner.run(f.task.id, request.id, submitted.answerDigest);
    else
      await assert.rejects(
        runner.run(
          f.task.id,
          request.id,
          submitted.answerDigest,
          parent.signal,
        ),
      );
    const current = f.completion.get(f.task.id);
    assert.equal(current.approved, scenario === "pass");
    assert.deepEqual(current.answer, answer);
    if (scenario === "needs_restatement")
      assert.equal(current.status, "needs_restatement");
    const leases = f.execution
      .list(f.task.id)
      .filter((l) => l.purpose.startsWith("g4:"));
    assert.equal(leases.length, 1);
    assert.equal(
      leases[0].state,
      scenario === "unknown" ? "unknown" : "released",
    );
    if (scenario === "failed_process")
      assert.equal(leases[0].reason, "EVALUATION_FAILED");
    if (scenario === "extra_key")
      assert.equal(leases[0].reason, "INVALID_EVALUATION");
    if (scenario === "pass") {
      await assert.rejects(
        runner.run(f.task.id, request.id, submitted.answerDigest),
      );
      assert.equal(
        f.execution.list(f.task.id).filter((l) => l.purpose.startsWith("g4:"))
          .length,
        1,
      );
    }
  });
}

test("operator assessment launch rejects unauthenticated, stale, duplicate and caller-evaluated requests", async (t) => {
  const { LiveRuntime } = await import("../src/runtime/live.ts");
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  const submitted = f.completion.submit(token, request.id, answer);
  let calls = 0,
    release;
  const live = new LiveRuntime(f, {
    planning: async () => assert.fail("wrong runner"),
    implementation: async () => assert.fail("wrong runner"),
    understanding: async (id, rid, ad, signal) => {
      calls++;
      assert.equal(id, f.task.id);
      assert.equal(rid, request.id);
      assert.equal(ad, submitted.answerDigest);
      await new Promise((resolve) => {
        release = resolve;
        signal.addEventListener("abort", resolve);
      });
    },
    dispose() {},
  });
  const server = createServer(
    (req, res) =>
      void handleOperator(
        req,
        res,
        new URL(req.url, "http://localhost").pathname,
        { ...f, live },
      ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await live.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/pazmo/executions/${f.task.id}/understanding`;
  const send = (body, auth = token) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const input = { requestId: request.id, answerDigest: submitted.answerDigest };
  assert.equal((await send(input, "b".repeat(64))).status, 401);
  assert.equal((await send({ ...input, evaluation })).status, 400);
  assert.equal(
    (await send({ ...input, answerDigest: "b".repeat(64) })).status,
    409,
  );
  assert.equal(calls, 0);
  assert.equal((await send(input)).status, 202);
  assert.equal((await send(input)).status, 409);
  assert.equal(calls, 1);
  assert.equal(f.completion.get(f.task.id).approved, false);
  release();
  await live.close();
});

test("two confirmed-closed failed assessments cannot renew their per-answer budget", async (t) => {
  const f = await setup(t);
  f.round.nodes.forEach(f.finish);
  await f.completion.prepare(f.task.id);
  const request = f.completion.request(token, f.task.id);
  const submitted = f.completion.submit(token, request.id, answer);
  for (let n = 0; n < 2; n++) {
    const lease = f.execution.reserveUnderstanding(
      f.round.id,
      request.id,
      submitted.answerDigest,
      10000,
    );
    f.execution.start(lease.id, "bounded-" + n);
    f.execution.finish(lease.id, "bounded-" + n, { closed: true });
  }
  assert.throws(
    () =>
      f.execution.reserveUnderstanding(
        f.round.id,
        request.id,
        submitted.answerDigest,
        10000,
      ),
    { code: "ASSESSMENT_LIMIT" },
  );
  assert.equal(f.completion.get(f.task.id).status, "awaiting_evaluation");
  assert.equal(f.completion.get(f.task.id).approved, false);
});
