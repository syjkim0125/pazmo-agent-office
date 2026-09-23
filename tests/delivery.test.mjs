import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { officeFixture } from "./coordinator-fixture.mjs";
import { CompletionLedger } from "../src/core/completion.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
const token = "a".repeat(64);
async function ready(t, approve = true) {
  const f = await officeFixture(t);
  const deliveryRoot = join(f.root, "deliveries");
  const completion = new CompletionLedger(
    f.db,
    f.store,
    f.verification,
    f.execution,
    token,
    f.handoffs,
    deliveryRoot,
  );
  const attempt = f.handoffs.prepare(f.task.id);
  f.handoffs.start(attempt.leaseId, "fixture-engineer");
  writeFileSync(join(attempt.workspace, "src/a"), "after");
  chmodSync(join(attempt.workspace, "src/a"), 0o755);
  symlinkSync("a", join(attempt.workspace, "src/link"));
  const observation = {
    exitCode: 0,
    signal: null,
    timedOut: false,
    error: null,
    output: "Fixture only",
  };
  const finished = f.handoffs.finish(attempt.leaseId, "fixture-engineer", {
    closed: true,
    observation,
  });
  for (const node of finished.round.nodes) {
    const lease = f.execution.reserveNode(finished.round.id, node.id);
    f.execution.start(lease.id, node.id);
    f.execution.finish(lease.id, node.id, {
      closed: true,
      observation: {
        ...observation,
        kind: node.kind,
        ...(node.kind === "review"
          ? {
              report: {
                verdict: "pass",
                findings: [],
                summary: "Scripted fixture",
              },
            }
          : {}),
      },
    });
  }
  await completion.prepare(f.task.id);
  const request = completion.request(token, f.task.id);
  const answer = {
    decision: "approve",
    note: "Disposable test only",
    understanding: {
      behavior: "Writes after",
      invariant: "No done before delivery",
      evidence: "Fixture judgments, not live model",
    },
  };
  const submitted = completion.submit(token, request.id, answer);
  if (approve)
    completion.evaluate(
      token,
      request.id,
      submitted.answerDigest,
      Object.fromEntries(
        ["behavior", "invariant", "evidence"].map((k) => [
          k,
          { correct: true, rationale: "Fixture evaluation" },
        ]),
      ),
    );
  return {
    ...f,
    completion,
    deliveryRoot,
    round: finished.round,
    candidate: finished.candidate,
  };
}
test("delivery publishes the exact approved snapshot, evidence and modes before marking done; retry is idempotent", async (t) => {
  const f = await ready(t);
  const result = f.completion.deliver(token, f.task.id);
  assert.equal(result.status, "delivered");
  assert.equal(f.store.get(f.task.id).status, "done");
  assert.equal(f.completion.get(f.task.id).approved, true);
  assert.equal(
    verifyCandidate({
      directory: join(result.directory, "candidate"),
      digest: f.candidate.digest,
    }),
    true,
  );
  assert.equal(
    readFileSync(join(result.directory, "candidate/tree/src/a"), "utf8"),
    "after",
  );
  const evidence = JSON.parse(
    readFileSync(join(result.directory, "receipt.json"), "utf8"),
  );
  assert.equal(evidence.candidateDigest, f.candidate.digest);
  assert.equal(evidence.evidence.diff.roundTripVerified, true);
  assert.equal(
    evidence.g4.answer.understanding.evidence,
    "Fixture judgments, not live model",
  );
  assert.equal(JSON.stringify(evidence).includes(token), false);
  assert.equal(readFileSync(join(f.project, "src/a"), "utf8"), "before");
  assert.deepEqual(f.completion.deliver(token, f.task.id), result);
  assert.equal(readdirSync(f.deliveryRoot).length, 1);
});
test("submitted understanding alone and incorrect operator token cannot deliver", async (t) => {
  const f = await ready(t, false);
  assert.throws(() => f.completion.deliver("b".repeat(64), f.task.id), {
    code: "UNAUTHORIZED",
  });
  assert.throws(() => f.completion.deliver(token, f.task.id), {
    code: "G4_REQUIRED",
  });
  assert.notEqual(f.store.get(f.task.id).status, "done");
});
test("failed completion transaction leaves neither done nor a published artifact and allows retry", async (t) => {
  const f = await ready(t);
  f.db.exec(
    "CREATE TRIGGER reject_delivery BEFORE UPDATE OF status ON tasks WHEN NEW.status='done' BEGIN SELECT RAISE(ABORT,'injected delivery failure'); END",
  );
  assert.throws(
    () => f.completion.deliver(token, f.task.id),
    /injected delivery failure/,
  );
  assert.equal(f.store.get(f.task.id).status, "review");
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM pazmo_deliveries").get().n,
    0,
  );
  assert.deepEqual(readdirSync(f.deliveryRoot), []);
  f.db.exec("DROP TRIGGER reject_delivery");
  assert.equal(f.completion.deliver(token, f.task.id).status, "delivered");
});
test("missing or mutated delivered content is quarantined on inspection and cannot be redelivered", async (t) => {
  for (const damage of ["missing", "content", "receipt"])
    await t.test(damage, async (t) => {
      const f = await ready(t);
      const result = f.completion.deliver(token, f.task.id);
      if (damage === "missing") rmSync(result.directory, { recursive: true });
      else {
        const file = join(
          result.directory,
          damage === "content" ? "candidate/tree/src/a" : "receipt.json",
        );
        chmodSync(file, 0o600);
        writeFileSync(file, "tampered");
      }
      f.completion.reconcileDeliveries();
      assert.equal(f.completion.delivery(f.task.id).status, "invalid");
      assert.equal(f.store.get(f.task.id).status, "pending");
      assert.equal(f.verification.latest(f.task.id).state, "human_required");
      assert.throws(() => f.completion.deliver(token, f.task.id), {
        code: "DELIVERY_INVALID",
      });
    });
});
test("contract mutation, cancellation, changed candidate and forged done reject delivery", async (t) => {
  for (const damage of ["contract", "cancel", "candidate", "done"])
    await t.test(damage, async (t) => {
      const f = await ready(t);
      if (damage === "contract") f.put("story.md", f.story + "\nChanged\n");
      if (damage === "cancel") f.verification.cancel(f.round.id);
      if (damage === "candidate") {
        const file = join(f.candidate.directory, "tree/src/a");
        chmodSync(file, 0o600);
        writeFileSync(file, "changed");
      }
      if (damage === "done")
        f.db
          .prepare("UPDATE tasks SET status='done' WHERE id=?")
          .run(f.task.id);
      assert.throws(() => f.completion.deliver(token, f.task.id));
      assert.notEqual(f.store.get(f.task.id).status, "done");
    });
});
test("a symlink output root is rejected without writing into its target", async (t) => {
  const f = await ready(t);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, f.deliveryRoot);
  assert.throws(() => f.completion.deliver(token, f.task.id));
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(f.store.get(f.task.id).status, "review");
});

test("real operator CLI delivers once, survives restart and removes invalid output from the queue on restart", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { backup } = await import("node:sqlite");
  const f = await ready(t);
  const data = join(f.root, "service");
  const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
  const call = (...args) => {
    const r = spawnSync(
      process.execPath,
      [cli, ...args, "--project", f.project, "--data-dir", data],
      { encoding: "utf8", timeout: 20000 },
    );
    return {
      code: r.status,
      value: JSON.parse(r.status === 0 ? r.stdout : r.stderr),
    };
  };
  t.after(() => call("stop"));
  assert.equal(call("init", "--apply").code, 0);
  f.db.exec(
    "CREATE TABLE pazmo_instance (project TEXT NOT NULL, version INTEGER NOT NULL); PRAGMA user_version=7",
  );
  f.db.prepare("INSERT INTO pazmo_instance VALUES (?,7)").run(f.project);
  const dataDir = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office/manifest.json")),
  ).dataDir;
  mkdirSync(dataDir, { recursive: true });
  await backup(f.db, join(dataDir, "office.sqlite"));
  const started = call("start", "--port", "0");
  assert.equal(started.code, 0, JSON.stringify(started));
  assert.equal(
    (
      await fetch(started.value.url + "/api/pazmo/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: f.task.id }),
      })
    ).status,
    401,
  );
  const delivered = call("deliver", "--task-id", f.task.id);
  assert.equal(delivered.code, 0, JSON.stringify(delivered));
  assert.equal(delivered.value.status, "delivered");
  assert.equal(call("stop").code, 0);
  assert.equal(call("start", "--port", "0").code, 0);
  assert.deepEqual(
    call("delivery", "--task-id", f.task.id).value,
    delivered.value,
  );
  assert.equal(call("stop").code, 0);
  rmSync(delivered.value.directory, { recursive: true });
  const restarted = call("start", "--port", "0");
  assert.equal(restarted.code, 0);
  assert.equal(
    call("delivery", "--task-id", f.task.id).value.status,
    "invalid",
  );
  const tasks = await (await fetch(restarted.value.url + "/api/tasks")).json();
  assert.equal(
    tasks.tasks.find((task) => task.id === f.task.id).status,
    "pending",
  );
});

test("late cancellation cannot undo a committed delivery", async (t) => {
  const f = await ready(t);
  f.completion.deliver(token, f.task.id);
  f.verification.cancel(f.round.id);
  assert.equal(f.store.get(f.task.id).status, "done");
  assert.equal(f.completion.delivery(f.task.id).status, "delivered");
});
test("nested transactions cannot report an uncommitted delivery and orphan output is not adopted", async (t) => {
  const f = await ready(t);
  f.db.exec("BEGIN IMMEDIATE");
  assert.throws(() => f.completion.deliver(token, f.task.id), {
    code: "TRANSACTION_ACTIVE",
  });
  f.db.exec("ROLLBACK");
  mkdirSync(f.deliveryRoot);
  const orphan = join(f.deliveryRoot, "delivery-orphan");
  mkdirSync(orphan);
  writeFileSync(join(orphan, "receipt.json"), "orphaned output, not a receipt");
  f.completion.reconcileDeliveries();
  assert.equal(f.completion.delivery(f.task.id).status, "not_delivered");
  assert.equal(f.store.get(f.task.id).status, "review");
  const delivered = f.completion.deliver(token, f.task.id);
  assert.notEqual(delivered.directory, orphan);
  assert.equal(
    readFileSync(join(orphan, "receipt.json"), "utf8"),
    "orphaned output, not a receipt",
  );
});

test("reinvoking the coordinator after delivery cannot launch or cancel the completed task", async (t) => {
  const { OfficeCoordinator } = await import("../src/runners/coordinator.ts");
  const f = await ready(t);
  f.completion.deliver(token, f.task.id);
  const coordinator = new OfficeCoordinator({
    ...f,
    jobFor: () => {
      throw new Error("must not launch");
    },
  });
  const result = await coordinator.run(f.task.id, AbortSignal.abort());
  assert.equal(result.state, "delivered");
  assert.equal(f.store.get(f.task.id).status, "done");
});

test("the verification guard does not preserve done when G4 or joined evidence no longer matches", async (t) => {
  for (const damage of ["approval", "evidence"])
    await t.test(damage, async (t) => {
      const f = await ready(t);
      f.completion.deliver(token, f.task.id);
      if (damage === "approval")
        f.db.exec("DELETE FROM pazmo_approvals WHERE gate='G4'");
      else {
        const node = f.round.nodes[0];
        const row = f.db
          .prepare(
            "SELECT result_json FROM pazmo_verification_nodes WHERE node_id=?",
          )
          .get(node.id);
        const result = JSON.parse(row.result_json);
        result.digest = "0".repeat(64);
        f.db
          .prepare(
            "UPDATE pazmo_verification_nodes SET result_json=? WHERE node_id=?",
          )
          .run(JSON.stringify(result), node.id);
      }
      assert.equal(f.verification.latest(f.task.id).state, "human_required");
      assert.equal(f.store.get(f.task.id).status, "pending");
    });
});
