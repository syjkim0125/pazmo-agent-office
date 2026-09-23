import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { HandoffLedger } from "../src/core/handoffs.ts";
import { CompletionLedger } from "../src/core/completion.ts";
import { runEngineerJob } from "../src/runners/engineer.ts";

const token = "a".repeat(64);
const receipt = {
  closed: true,
  observation: {
    exitCode: 0,
    signal: null,
    timedOut: false,
    error: null,
    output: "Engineer finished",
  },
};
export async function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "office.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  mkdirSync(join(f.project, "src"));
  f.put("src/a", "before\n");
  f.put(
    "verify.json",
    JSON.stringify({
      ...f.verification,
      workspace: { include: ["src"], exclude: [] },
    }),
  );
  const store = new OfficeStore(db, f.project, token),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification);
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const handoffs = new HandoffLedger(
    db,
    store,
    verification,
    execution,
    f.project,
    storage,
  );
  const task = await store.register(token, f.input);
  for (const gate of ["G1", "G3"]) {
    const c = store.requestApproval(token, task.id, gate);
    store.decide(token, c.id, { decision: "approve", note: "Fixture only" });
  }
  return { ...f, db, store, verification, execution, handoffs, storage, task };
}
function finishChecks(f, round, fail = false) {
  for (const node of round.nodes) {
    const l = f.execution.reserveNode(round.id, node.id),
      handle = "check-" + node.id;
    f.execution.start(l.id, handle);
    f.execution.finish(l.id, handle, {
      closed: true,
      observation: {
        ...receipt.observation,
        kind: node.kind,
        exitCode: fail && node.kind === "test" ? 1 : 0,
        ...(node.kind === "review"
          ? { report: { verdict: "pass", findings: [], summary: "fixture" } }
          : {}),
      },
    });
  }
}

test("capture precedes start; successful closure freezes the assigned workspace and creates one round", async (t) => {
  const f = await setup(t),
    a = f.handoffs.prepare(f.task.id);
  assert.equal(a.state, "prepared");
  assert.equal(f.execution.get(a.leaseId).state, "reserved");
  assert.equal(
    readFileSync(join(a.baseline.directory, "tree/src/a"), "utf8"),
    "before\n",
  );
  assert.throws(() => f.handoffs.finish(a.leaseId, "unstarted", receipt), {
    code: "STALE_EXECUTION",
  });
  f.handoffs.start(a.leaseId, "engineer-1");
  writeFileSync(join(a.workspace, "src/a"), "after\n");
  writeFileSync(join(a.workspace, "src/new"), "new\n");
  const done = f.handoffs.finish(a.leaseId, "engineer-1", receipt);
  assert.equal(done.state, "candidate_frozen");
  assert.equal(done.round.state, "checking");
  assert.equal(f.execution.get(a.leaseId).state, "released");
  assert.equal(readFileSync(join(f.project, "src/a"), "utf8"), "before\n");
  assert.equal(
    f.handoffs.forRound(done.round.id).baseline.digest,
    a.baseline.digest,
  );
  assert.throws(() => f.handoffs.finish(a.leaseId, "engineer-1", receipt), {
    code: "STALE_EXECUTION",
  });
});

test("fixes start from the failed candidate but keep the original baseline, surviving reconstruction", async (t) => {
  const f = await setup(t),
    first = f.handoffs.prepare(f.task.id);
  f.handoffs.start(first.leaseId, "engineer-1");
  writeFileSync(join(first.workspace, "src/a"), "first\n");
  const one = f.handoffs.finish(first.leaseId, "engineer-1", receipt);
  finishChecks(f, one.round, true);
  const again = new HandoffLedger(
    f.db,
    f.store,
    f.verification,
    f.execution,
    f.project,
    f.storage,
  );
  const second = again.prepare(f.task.id);
  assert.equal(second.baseline.digest, one.candidate.digest);
  assert.equal(
    readFileSync(join(second.workspace, "src/a"), "utf8"),
    "first\n",
  );
  again.start(second.leaseId, "engineer-2");
  writeFileSync(join(second.workspace, "src/a"), "fixed\n");
  const two = again.finish(second.leaseId, "engineer-2", receipt);
  assert.equal(
    again.forRound(two.round.id).baseline.digest,
    first.baseline.digest,
  );
  assert.equal(two.round.number, 2);
  finishChecks(f, two.round);
  assert.equal(f.verification.get(two.round.id).state, "awaiting_g4");
  assert.throws(() => again.prepare(f.task.id), { code: "ROUND_CLOSED" });
  const completion = new CompletionLedger(
    f.db,
    f.store,
    f.verification,
    f.execution,
    token,
    again,
  );
  const bundle = await completion.prepare(f.task.id);
  const saved = JSON.parse(
    f.db
      .prepare("SELECT evidence_json FROM pazmo_g4_evidence WHERE subject=?")
      .get(bundle.subject).evidence_json,
  );
  assert.equal(saved.diff.baselineDigest, first.baseline.digest);
  assert.equal(saved.diff.candidateDigest, two.candidate.digest);
  assert.equal(saved.handoff, second.leaseId);
  assert.equal(saved.diff.roundTripVerified, true);
  assert.equal(completion.get(f.task.id).approved, false);
});

test("preparation requires explicit approved scope and the registered project", async (t) => {
  const f = await setup(t);
  const elsewhere = join(f.root, "elsewhere");
  mkdirSync(elsewhere);
  const wrongProject = new HandoffLedger(
    f.db,
    f.store,
    f.verification,
    f.execution,
    elsewhere,
    f.storage,
  );
  assert.throws(() => wrongProject.prepare(f.task.id), { code: "UNSAFE_PATH" });
  assert.equal(f.execution.list(f.task.id).length, 0);
  const contract = JSON.parse(
    readFileSync(join(f.project, "verify.json"), "utf8"),
  );
  delete contract.workspace;
  f.put("verify.json", JSON.stringify(contract));
  const task = await f.store.register(token, f.input);
  for (const gate of ["G1", "G3"]) {
    const request = f.store.requestApproval(token, task.id, gate);
    f.store.decide(token, request.id, {
      decision: "approve",
      note: "Fixture only",
    });
  }
  assert.throws(() => f.handoffs.prepare(task.id), {
    code: "WORKSPACE_REQUIRED",
  });
  assert.equal(f.execution.list(task.id).length, 0);
});

test("failed/unknown/cancelled Engineer cannot create a verification candidate", async (t) => {
  for (const scenario of ["fail", "unknown", "cancel", "scope"])
    await t.test(scenario, async (t) => {
      const f = await setup(t),
        a = f.handoffs.prepare(f.task.id);
      f.handoffs.start(a.leaseId, "engineer");
      if (scenario === "cancel")
        f.db
          .prepare("UPDATE tasks SET status='cancelled' WHERE id=?")
          .run(f.task.id);
      if (scenario === "scope")
        writeFileSync(join(a.workspace, "unauthorized"), "bad");
      const r = f.handoffs.finish(a.leaseId, "engineer", {
        ...receipt,
        closed: scenario !== "unknown",
        observation: {
          ...receipt.observation,
          exitCode: scenario === "fail" ? 1 : 0,
        },
      });
      assert.equal(r.state, "human_required");
      assert.equal(f.verification.latest(f.task.id), null);
      assert.equal(
        f.execution.get(a.leaseId).state,
        scenario === "unknown" ? "unknown" : "released",
      );
      if (scenario === "cancel")
        assert.equal(f.store.get(f.task.id).status, "cancelled");
    });
});

test("changed staging/baseline/contract and interrupted reservations cannot start", async (t) => {
  for (const scenario of ["staging", "baseline", "contract", "restart"])
    await t.test(scenario, async (t) => {
      const f = await setup(t),
        a = f.handoffs.prepare(f.task.id);
      if (scenario === "staging")
        writeFileSync(join(a.workspace, "src/a"), "tampered");
      if (scenario === "baseline") {
        const p = join(a.baseline.directory, "tree/src/a");
        chmodSync(p, 0o600);
        writeFileSync(p, "tampered");
      }
      if (scenario === "contract") f.put("story.md", f.story + "\n");
      if (scenario === "restart") f.execution.recoverInterrupted();
      assert.throws(() => f.handoffs.start(a.leaseId, "engineer"));
      assert.notEqual(f.execution.get(a.leaseId).state, "running");
    });
});

test("preparation rollback leaves no reservation or owned snapshots and completion rollback cannot leave a round", async (t) => {
  const f = await setup(t);
  f.db.exec(
    "CREATE TRIGGER reject_prepare BEFORE INSERT ON pazmo_handoffs BEGIN SELECT RAISE(ABORT,'prepare fault'); END",
  );
  assert.throws(() => f.handoffs.prepare(f.task.id));
  assert.equal(f.execution.list(f.task.id).length, 0);
  assert.deepEqual(readdirSync(f.storage), ["snapshots"]);
  assert.deepEqual(readdirSync(join(f.storage, "snapshots")), []);
  f.db.exec("DROP TRIGGER reject_prepare");
  const a = f.handoffs.prepare(f.task.id);
  f.handoffs.start(a.leaseId, "engineer");
  f.db.exec(
    "CREATE TRIGGER reject_candidate BEFORE UPDATE ON pazmo_handoffs WHEN NEW.round_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'candidate fault'); END",
  );
  assert.throws(() => f.handoffs.finish(a.leaseId, "engineer", receipt));
  assert.equal(f.verification.latest(f.task.id), null);
});

test("a rejected Engineer supervisor promise quarantines the attempt without a candidate", async (t) => {
  for (const started of [false, true]) {
    const f = await setup(t);
    const supervisor = {
      async run(_baseline, _scope, _destination, _job, beforeStart) {
        if (started) beforeStart("fixture-supervisor");
        throw new Error("lost supervisor");
      },
    };
    await assert.rejects(
      runEngineerJob(f.execution, f.handoffs, supervisor, f.task.id, {
        argv: ["fixture"],
        timeoutMs: 1000,
      }),
      /lost supervisor/,
    );
    assert.equal(f.execution.list(f.task.id)[0].state, "unknown");
    assert.equal(f.handoffs.list(f.task.id)[0].state, "human_required");
    assert.equal(f.verification.latest(f.task.id), null);
  }
});
