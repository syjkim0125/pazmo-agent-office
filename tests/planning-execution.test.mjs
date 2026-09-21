import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
const token = "a".repeat(64),
  context = "b".repeat(64);
function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "planning.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token),
    intake = new IntakeLedger(db, store, f.project),
    verification = new VerificationLedger(db, store);
  let now = 1000;
  const execution = new ExecutionLedger(
    db,
    store,
    verification,
    () => now,
    intake,
  );
  const create = () => intake.create(token, "Validate parser input.", "normal");
  const reserve = (s, timeout = 1000) =>
    execution.reservePlanning(
      s.taskId,
      s.revision,
      s.inputDigest,
      context,
      timeout,
    );
  async function engineer() {
    const item = await store.register(token, f.input);
    for (const gate of ["G1", "G3"]) {
      const c = store.requestApproval(token, item.id, gate);
      store.decide(token, c.id, {
        decision: "approve",
        note: "Fixture approval.",
      });
    }
    return item;
  }
  return {
    ...f,
    db,
    store,
    intake,
    verification,
    execution,
    create,
    reserve,
    engineer,
    setNow: (v) => (now = v),
  };
}
function response(s) {
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
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              version: 1,
              inputDigest: s.inputDigest,
              status: "questions",
              questions: [
                { id: "Q1", text: "Which parser?", reason: "Determine scope." },
              ],
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

test("planning and approved execution consume the same three slots in both directions", async (t) => {
  const f = setup(t),
    e = await f.engineer(),
    s = f.create(),
    a = f.reserve(s),
    b = f.reserve(f.create());
  const eng = f.execution.reserveEngineer(e.id);
  assert.throws(() => f.reserve(f.create()), { code: "SLOT_LIMIT" });
  assert.throws(() => f.reserve(s), { code: "DUPLICATE_EXECUTION" });
  f.execution.startPlanning(a.id, "planner-a");
  f.execution.finishPlanning(a.id, "planner-a", response(s));
  const c = f.reserve(f.create());
  f.execution.start(eng.id, "engineer");
  f.execution.finish(eng.id, "engineer", { closed: true });
  f.reserve(f.create());
  const e2 = await f.engineer();
  assert.throws(() => f.execution.reserveEngineer(e2.id), {
    code: "SLOT_LIMIT",
  });
  assert.equal(f.execution.getPlanning(b.id).state, "reserved");
  assert.equal(f.execution.getPlanning(c.id).context_digest, context);
});

test("planning finish atomically stores addressed questions and releases only the owned handle", (t) => {
  const f = setup(t),
    s = f.create(),
    l = f.reserve(s);
  f.execution.startPlanning(l.id, "pm");
  assert.throws(() => f.execution.finishPlanning(l.id, "wrong", response(s)), {
    code: "STALE_EXECUTION",
  });
  f.db.exec(
    "CREATE TRIGGER reject_event BEFORE INSERT ON pazmo_intake_events BEGIN SELECT RAISE(ABORT,'injected'); END",
  );
  assert.throws(
    () => f.execution.finishPlanning(l.id, "pm", response(s)),
    /injected/,
  );
  assert.equal(f.intake.get(s.taskId).revision, 1);
  assert.equal(f.execution.getPlanning(l.id).state, "running");
  f.db.exec("DROP TRIGGER reject_event");
  f.execution.finishPlanning(l.id, "pm", response(s));
  const waiting = f.intake.get(s.taskId);
  assert.equal(waiting.state, "awaiting_answer");
  assert.equal(waiting.events.at(-1).actor, "pm");
  assert.equal(f.execution.getPlanning(l.id).state, "released");
  assert.throws(() => f.execution.finishPlanning(l.id, "pm", response(s)), {
    code: "STALE_EXECUTION",
  });
  const next = f.intake.answer(
    token,
    s.taskId,
    waiting.revision,
    waiting.inputDigest,
    [{ id: "Q1", answer: "Public parser." }],
  );
  assert.notEqual(f.reserve(next).input_digest, l.input_digest);
});

test("cancelled planning never revives on a late response but confirmed closure frees its slot", (t) => {
  const f = setup(t),
    s = f.create(),
    l = f.reserve(s);
  f.execution.startPlanning(l.id, "pm");
  const cancelled = f.intake.cancel(token, s.taskId, s.revision, s.inputDigest);
  f.execution.finishPlanning(l.id, "pm", response(s));
  assert.deepEqual(f.intake.get(s.taskId), cancelled);
  assert.equal(f.execution.getPlanning(l.id).reason, "INTAKE_CLOSED");
  assert.equal(f.execution.getPlanning(l.id).state, "released");
});

test("restart and timeout quarantine planning without freeing capacity or accepting late evidence", (t) => {
  const f = setup(t),
    s = f.create(),
    l = f.reserve(s);
  f.execution.startPlanning(l.id, "pm");
  const restored = new ExecutionLedger(
    f.db,
    f.store,
    f.verification,
    () => 1000,
    f.intake,
  );
  restored.recoverInterrupted();
  assert.equal(restored.getPlanning(l.id).reason, "CONTROLLER_RESTARTED");
  assert.equal(f.intake.get(s.taskId).state, "human_required");
  assert.throws(() => restored.finishPlanning(l.id, "pm", response(s)), {
    code: "STALE_EXECUTION",
  });
  const timeout = f.reserve(f.create());
  f.reserve(f.create());
  f.setNow(2000);
  f.execution.expire();
  assert.equal(f.execution.getPlanning(timeout.id).reason, "DEADLINE_EXCEEDED");
  assert.throws(() => f.reserve(f.create()), { code: "SLOT_LIMIT" });
});

test("unknown liveness and malformed output require human action; handles are unique across roles", async (t) => {
  const f = setup(t),
    e = await f.engineer(),
    eng = f.execution.reserveEngineer(e.id),
    s = f.create(),
    l = f.reserve(s);
  f.execution.start(eng.id, "owned");
  assert.throws(() => f.execution.startPlanning(l.id, "owned"), {
    code: "INVALID_EXECUTION",
  });
  f.execution.startPlanning(l.id, "pm");
  const e2 = await f.engineer(),
    eng2 = f.execution.reserveEngineer(e2.id);
  assert.throws(() => f.execution.start(eng2.id, "pm"), {
    code: "INVALID_EXECUTION",
  });
  f.execution.finishPlanning(l.id, "pm", { ...response(s), closed: false });
  assert.equal(f.execution.getPlanning(l.id).state, "unknown");
  assert.equal(f.intake.get(s.taskId).state, "human_required");
  f.execution.start(eng2.id, "engineer2");
  f.execution.finish(eng2.id, "engineer2", { closed: true });
  const s2 = f.create(),
    l2 = f.reserve(s2);
  f.execution.startPlanning(l2.id, "pm2");
  const bad = response(s2);
  bad.result.error = "FAILED";
  f.execution.finishPlanning(l2.id, "pm2", bad);
  assert.equal(f.intake.get(s2.taskId).state, "human_required");
  assert.equal(f.execution.getPlanning(l2.id).state, "released");
});

test("stale packets and invalid reservation inputs cannot acquire a slot", (t) => {
  const f = setup(t),
    s = f.create();
  assert.throws(
    () =>
      f.execution.reservePlanning(
        s.taskId,
        s.revision,
        "c".repeat(64),
        context,
        1000,
      ),
    { code: "STALE_INTAKE" },
  );
  for (const timeout of [0, 600001, NaN])
    assert.throws(() => f.reserve(s, timeout), { code: "INVALID_EXECUTION" });
  const l = f.reserve(s);
  f.intake.cancel(token, s.taskId, s.revision, s.inputDigest);
  assert.throws(() => f.execution.startPlanning(l.id, "pm"), {
    code: "STALE_INTAKE",
  });
  f.execution.markPlanningUnknown(l.id);
  assert.equal(f.intake.get(s.taskId).state, "cancelled");
});

test("independent SQLite controllers cannot overbook mixed planning and implementation", async (t) => {
  const { Worker } = await import("node:worker_threads");
  const f = setup(t),
    requests = [];
  for (let i = 0; i < 3; i++)
    requests.push({ kind: "planning", item: f.create() });
  for (let i = 0; i < 2; i++)
    requests.push({ kind: "engineer", item: await f.engineer() });
  const source = `const {parentPort,workerData:w}=require('node:worker_threads');(async()=>{
    const {DatabaseSync}=await import('node:sqlite');
    const {OfficeStore}=await import(w.root+'/src/core/store.ts');
    const {IntakeLedger}=await import(w.root+'/src/core/intake.ts');
    const {VerificationLedger}=await import(w.root+'/src/core/verification.ts');
    const {ExecutionLedger}=await import(w.root+'/src/core/budgets.ts');
    const db=new DatabaseSync(w.path);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
    const store=new OfficeStore(db,w.project,w.token),intake=new IntakeLedger(db,store,w.project),verification=new VerificationLedger(db,store),execution=new ExecutionLedger(db,store,verification,()=>1000,intake);
    parentPort.postMessage('ready');parentPort.once('message',()=>{
      try {if(w.kind==='planning')execution.reservePlanning(w.item.taskId,w.item.revision,w.item.inputDigest,w.context);else execution.reserveEngineer(w.item.id);parentPort.postMessage({ok:true});}
      catch(e){parentPort.postMessage({ok:false,code:e.code,message:e.message});}finally{db.close();parentPort.close();}
    });})();`;
  const workers = requests.map(
    (request) =>
      new Worker(source, {
        eval: true,
        workerData: {
          ...request,
          root: new URL("..", import.meta.url).href.replace(/\/$/, ""),
          path: join(f.root, "planning.sqlite"),
          project: f.project,
          token,
          context,
        },
      }),
  );
  t.after(() => Promise.all(workers.map((w) => w.terminate())));
  await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
        }),
    ),
  );
  const results = await Promise.all(
    workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
          w.postMessage("reserve");
        }),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 3, JSON.stringify(results));
  assert.ok(
    results.filter((r) => !r.ok).every((r) => r.code === "SLOT_LIMIT"),
    JSON.stringify(results),
  );
});
