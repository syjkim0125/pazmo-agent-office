import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { runRegisteredCheck } from "../src/runners/verification.ts";

const token = "a".repeat(64);
async function setup(t) {
  const f = fixture(t),
    path = join(f.root, "office.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  applyBaseSchema(db);
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token);
  let now = 1000;
  const verification = new VerificationLedger(db, store, () => now);
  const execution = new ExecutionLedger(db, store, verification, () => now);
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const candidate = freezeCandidate(f.project, ["story.md"], storage);
  async function task(approve = true) {
    const item = await store.register(token, f.input);
    if (approve)
      for (const gate of ["G1", "G3"]) {
        const c = store.requestApproval(token, item.id, gate);
        store.decide(token, c.id, {
          decision: "approve",
          note: "Accept fixture contract.",
        });
      }
    return item;
  }
  return {
    ...f,
    db,
    path,
    store,
    verification,
    execution,
    candidate,
    task,
    setNow: (n) => (now = n),
  };
}
const result = (kind) => ({
  kind,
  exitCode: 0,
  signal: null,
  timedOut: false,
  error: null,
  output: "Fixture captured process output",
  ...(kind === "review"
    ? { report: { verdict: "pass", findings: [], summary: "Fixture review" } }
    : {}),
});
function launch(f, lease) {
  const handle = "container-" + lease.id;
  f.execution.start(lease.id, handle);
  return handle;
}

test("reserve requires approval, counts reservations and caps engineers at two", async (t) => {
  const f = await setup(t),
    unapproved = await f.task(false);
  assert.throws(() => f.execution.reserveEngineer(unapproved.id), {
    code: "CONTRACT_NOT_READY",
  });
  const tasks = await Promise.all([f.task(), f.task(), f.task()]);
  const one = f.execution.reserveEngineer(tasks[0].id);
  f.execution.reserveEngineer(tasks[1].id);
  assert.throws(() => f.execution.reserveEngineer(tasks[2].id), {
    code: "ENGINEER_LIMIT",
  });
  assert.equal(f.execution.get(one.id).state, "reserved");
  assert.equal(f.store.get(tasks[0].id).status, "in_progress");
  assert.throws(() => f.execution.reserveEngineer(tasks[0].id), {
    code: "DUPLICATE_EXECUTION",
  });
});

test("all worker kinds share three slots; resources remain exclusive until confirmed closed", async (t) => {
  const f = await setup(t),
    tasks = await Promise.all([f.task(), f.task(), f.task()]);
  const one = f.execution.reserveEngineer(tasks[0].id, {
    resources: ["db:migration"],
  });
  assert.throws(
    () =>
      f.execution.reserveEngineer(tasks[1].id, { resources: ["db:migration"] }),
    { code: "RESOURCE_BUSY" },
  );
  const two = f.execution.reserveEngineer(tasks[1].id);
  const round = f.verification.begin(tasks[2].id, f.candidate);
  const review = round.nodes.find((n) => n.kind === "review"),
    check = round.nodes.find((n) => n.kind === "test");
  f.execution.reserveNode(round.id, review.id);
  assert.throws(() => f.execution.reserveNode(round.id, check.id), {
    code: "SLOT_LIMIT",
  });
  const handle = launch(f, one);
  f.execution.finish(one.id, handle, { closed: false });
  assert.equal(f.execution.get(one.id).state, "unknown");
  assert.throws(() => f.execution.reserveNode(round.id, check.id), {
    code: "SLOT_LIMIT",
  });
  f.execution.finish(two.id, launch(f, two), { closed: true });
  f.execution.reserveNode(round.id, check.id);
});

test("verification results join only through the matching started lease and atomic completion", async (t) => {
  const f = await setup(t),
    task = await f.task();
  const round = f.verification.begin(task.id, f.candidate);
  const node = round.nodes[0],
    lease = f.execution.reserveNode(round.id, node.id);
  assert.throws(
    () =>
      f.execution.finish(lease.id, "wrong", {
        closed: true,
        observation: result(node.kind),
      }),
    { code: "STALE_EXECUTION" },
  );
  const handle = launch(f, lease);
  assert.throws(
    () =>
      f.execution.finish(lease.id, handle, {
        closed: true,
        observation: result("review"),
      }),
    { code: "INVALID_EVIDENCE" },
  );
  assert.equal(f.execution.get(lease.id).state, "running");
  assert.equal(f.verification.get(round.id).nodes[0].result, null);
  f.execution.finish(lease.id, handle, {
    closed: true,
    observation: result(node.kind),
  });
  assert.equal(f.execution.get(lease.id).state, "released");
  assert.throws(
    () =>
      f.execution.finish(lease.id, handle, {
        closed: true,
        observation: result(node.kind),
      }),
    { code: "STALE_EXECUTION" },
  );
  const review = round.nodes[1],
    second = f.execution.reserveNode(round.id, review.id);
  f.execution.finish(second.id, launch(f, second), {
    closed: true,
    observation: result(review.kind),
  });
  assert.equal(f.verification.get(round.id).state, "awaiting_g4");
  assert.throws(() => f.execution.reserveNode(round.id, review.id), {
    code: "ROUND_CLOSED",
  });
});

test("one initial implementation and at most one fix per failed round survive reconstruction", async (t) => {
  const f = await setup(t),
    task = await f.task();
  const first = f.execution.reserveEngineer(task.id);
  f.execution.finish(first.id, launch(f, first), { closed: true });
  assert.throws(() => f.execution.reserveEngineer(task.id), {
    code: "DUPLICATE_EXECUTION",
  });
  for (let i = 0; i < 3; i++) {
    const round = f.verification.begin(task.id, f.candidate);
    for (const node of round.nodes)
      f.verification.record({
        roundId: round.id,
        nodeId: node.id,
        candidateDigest: f.candidate.digest,
        contractDigest: round.contractDigest,
        observation: { ...result(node.kind), exitCode: 1 },
      });
    const reopened = new ExecutionLedger(f.db, f.store, f.verification);
    if (i === 2)
      assert.throws(() => reopened.reserveEngineer(task.id), {
        code: "ROUND_CLOSED",
      });
    else {
      const fix = reopened.reserveEngineer(task.id);
      const handle = launch(f, fix);
      f.execution.finish(fix.id, handle, { closed: true });
      assert.throws(() => reopened.reserveEngineer(task.id), {
        code: "DUPLICATE_EXECUTION",
      });
    }
  }
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM pazmo_execution_leases WHERE role='engineer'",
      )
      .get().n,
    3,
  );
});

test("restart and expired leases keep capacity occupied and reject late callbacks", async (t) => {
  const f = await setup(t),
    tasks = await Promise.all([f.task(), f.task(), f.task()]);
  const one = f.execution.reserveEngineer(tasks[0].id, { timeoutMs: 100 });
  const two = f.execution.reserveEngineer(tasks[1].id);
  const handle = launch(f, one);
  f.setNow(1100);
  f.execution.expire();
  assert.equal(f.execution.get(one.id).state, "unknown");
  assert.throws(() => f.execution.finish(one.id, handle, { closed: true }), {
    code: "STALE_EXECUTION",
  });
  f.execution.recoverInterrupted();
  assert.equal(f.execution.get(two.id).state, "unknown");
  assert.throws(() => f.execution.start(two.id, "new-handle"), {
    code: "STALE_EXECUTION",
  });
  assert.throws(() => f.execution.reserveEngineer(tasks[2].id), {
    code: "ENGINEER_LIMIT",
  });
});

test("changed contracts and cancelled tasks cannot start a reserved process", async (t) => {
  const f = await setup(t),
    task = await f.task();
  const lease = f.execution.reserveEngineer(task.id);
  f.put("story.md", f.story + "\nChanged requirement\n");
  assert.throws(() => f.execution.start(lease.id, "container-stale"), {
    code: "CONTRACT_NOT_READY",
  });
  f.put("story.md", f.story);
  f.db.prepare("UPDATE tasks SET status='cancelled' WHERE id=?").run(task.id);
  assert.throws(() => f.execution.start(lease.id, "container-cancelled"), {
    code: "TASK_ACTIVE",
  });
});

test("reservation and queue mutation roll back together", async (t) => {
  const f = await setup(t),
    task = await f.task();
  f.db.exec(
    "CREATE TRIGGER refuse_execution BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'queue fault'); END",
  );
  assert.throws(() => f.execution.reserveEngineer(task.id), /queue fault/);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM pazmo_execution_leases").get().n,
    0,
  );
  assert.equal(f.store.get(task.id).status, "planned");
});

test("concurrent database connections cannot overbook the three global slots", async (t) => {
  const f = await setup(t),
    requests = [];
  for (let i = 0; i < 6; i++) {
    const task = await f.task(),
      round = f.verification.begin(task.id, f.candidate);
    requests.push({
      roundId: round.id,
      nodeId: round.nodes.find((n) => n.kind === "review").id,
    });
  }
  const source = `
    const {parentPort,workerData}=require('node:worker_threads');
    (async()=> {
      const {DatabaseSync}=await import('node:sqlite');
      const {OfficeStore}=await import(workerData.store);
      const {VerificationLedger}=await import(workerData.verification);
      const {ExecutionLedger}=await import(workerData.execution);
      const db=new DatabaseSync(workerData.path); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
      const store=new OfficeStore(db,workerData.project,workerData.token);
      const verification=new VerificationLedger(db,store,()=>1000);
      const ledger=new ExecutionLedger(db,store,verification,()=>1000);
      parentPort.postMessage('ready');
      parentPort.once('message',()=> {
        try { ledger.reserveNode(workerData.roundId,workerData.nodeId); parentPort.postMessage({ok:true}); }
        catch(e) {parentPort.postMessage({ok:false,code:e.code,message:e.message});}
        finally {db.close();parentPort.close();}
      });
    })().catch(e=>{throw e});`;
  const workers = requests.map(
    (request) =>
      new Worker(source, {
        eval: true,
        workerData: {
          ...request,
          path: f.path,
          project: f.project,
          token,
          store: new URL("../src/core/store.ts", import.meta.url).href,
          verification: new URL("../src/core/verification.ts", import.meta.url)
            .href,
          execution: new URL("../src/core/budgets.ts", import.meta.url).href,
        },
      }),
  );
  t.after(async () => {
    await Promise.all(workers.map((w) => w.terminate()));
  });
  await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
        }),
    ),
  );
  const results = workers.map(
    (w) =>
      new Promise((resolve, reject) => {
        w.once("message", resolve);
        w.once("error", reject);
        w.postMessage("reserve");
      }),
  );
  const settled = await Promise.all(results);
  assert.equal(settled.filter((x) => x.ok).length, 3, JSON.stringify(settled));
  assert.ok(
    settled.filter((x) => !x.ok).every((x) => x.code === "SLOT_LIMIT"),
    JSON.stringify(settled),
  );
});

test("time budgets survive release and node reservation cannot erase candidate invalidation", async (t) => {
  const f = await setup(t);
  f.put(
    "verify.json",
    JSON.stringify({
      version: 1,
      checks: Array.from({ length: 7 }, () => ({
        id: "V1",
        argv: ["node", "--test"],
        timeoutMs: 600000,
      })),
    }),
  );
  const task = await f.task(),
    round = f.verification.begin(task.id, f.candidate);
  for (const node of round.nodes.slice(0, 6)) {
    const lease = f.execution.reserveNode(round.id, node.id);
    f.execution.finish(lease.id, launch(f, lease), {
      closed: true,
      observation: result(node.kind),
    });
  }
  assert.throws(() => f.execution.reserveNode(round.id, round.nodes[6].id), {
    code: "TIME_BUDGET",
  });
  const { chmodSync, writeFileSync } = await import("node:fs");
  const path = join(f.candidate.directory, "tree/story.md");
  chmodSync(path, 0o600);
  writeFileSync(path, "tampered");
  assert.throws(() => f.execution.reserveNode(round.id, round.nodes[6].id), {
    code: "ROUND_CLOSED",
  });
  assert.equal(
    f.db
      .prepare("SELECT state FROM pazmo_verification_rounds WHERE id=?")
      .get(round.id).state,
    "human_required",
  );
});

test("one supervisor handle cannot be bound to two active executions", async (t) => {
  const f = await setup(t),
    first = f.execution.reserveEngineer((await f.task()).id),
    second = f.execution.reserveEngineer((await f.task()).id);
  f.execution.start(first.id, "same-container");
  assert.throws(() => f.execution.start(second.id, "same-container"));
  assert.equal(f.execution.get(second.id).state, "reserved");
});

test("result and lease release roll back together when the queue transition fails", async (t) => {
  const f = await setup(t),
    task = await f.task(),
    round = f.verification.begin(task.id, f.candidate);
  const first = f.execution.reserveNode(round.id, round.nodes[0].id);
  f.execution.finish(first.id, launch(f, first), {
    closed: true,
    observation: result("test"),
  });
  const last = f.execution.reserveNode(round.id, round.nodes[1].id),
    handle = launch(f, last);
  f.db.exec(
    "CREATE TRIGGER reject_completion BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'queue fault'); END",
  );
  assert.throws(
    () =>
      f.execution.finish(last.id, handle, {
        closed: true,
        observation: result("review"),
      }),
    /queue fault/,
  );
  assert.equal(f.execution.get(last.id).state, "running");
  assert.equal(f.verification.get(round.id).nodes[1].result, null);
  f.db.exec("DROP TRIGGER reject_completion");
  f.execution.finish(last.id, handle, {
    closed: true,
    observation: result("review"),
  });
  assert.equal(f.execution.get(last.id).state, "released");
  assert.equal(f.verification.get(round.id).state, "awaiting_g4");
});

test("preparation failure quarantines an unstarted node without freeing capacity", async (t) => {
  const f = await setup(t),
    task = await f.task(),
    round = f.verification.begin(task.id, f.candidate);
  const lease = f.execution.reserveNode(round.id, round.nodes[0].id);
  f.execution.markUnknown(lease.id);
  assert.equal(f.execution.get(lease.id).state, "unknown");
  assert.equal(f.verification.get(round.id).state, "human_required");
  assert.throws(() => f.execution.start(lease.id, "late-start"), {
    code: "STALE_EXECUTION",
  });
});

test("confirmed sibling closure frees capacity without reopening a cancelled round", async (t) => {
  const f = await setup(t),
    task = await f.task();
  const round = f.verification.begin(task.id, f.candidate);
  const lease = f.execution.reserveNode(round.id, round.nodes[0].id);
  const handle = launch(f, lease);
  f.verification.cancel(round.id);
  f.execution.finish(lease.id, handle, {
    closed: true,
    observation: result("test"),
  });
  assert.equal(f.execution.get(lease.id).state, "released");
  assert.equal(f.execution.get(lease.id).reason, "ROUND_CLOSED");
  assert.equal(f.verification.get(round.id).state, "cancelled");
  assert.equal(f.verification.get(round.id).nodes[0].result, null);
  assert.equal(f.store.get(task.id).status, "cancelled");
});

test("unexpected verifier rejection quarantines both reserved and running executions", async (t) => {
  for (const started of [false, true]) {
    await t.test(started ? "after launch" : "before launch", async (t) => {
      const f = await setup(t),
        task = await f.task(),
        round = f.verification.begin(task.id, f.candidate);
      const fault = new Error("Unexpected supervisor failure");
      const verifier = {
        async run(candidate, check, beforeStart) {
          assert.equal(candidate.digest, f.candidate.digest);
          assert.deepEqual(check, round.nodes[0].check);
          if (started) beforeStart("fixture-supervisor");
          throw fault;
        },
      };
      await assert.rejects(
        runRegisteredCheck(
          f.execution,
          f.verification,
          verifier,
          round.id,
          round.nodes[0].id,
        ),
        (error) => error === fault,
      );
      const [lease] = f.execution.list(task.id);
      assert.equal(lease.state, "unknown");
      assert.equal(f.verification.get(round.id).state, "human_required");
      assert.throws(() => f.execution.reserveNode(round.id, round.nodes[0].id));
    });
  }
});
