import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { runRegisteredChecks } from "../src/runners/dispatch.ts";

async function setup(t, count = 5, timeoutMs = 30000) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "office.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  f.put(
    "verify.json",
    JSON.stringify({
      version: 1,
      checks: Array.from({ length: count }, (_, i) => ({
        id: "V1",
        argv: ["node", "--eval", String(i)],
        timeoutMs,
      })),
    }),
  );
  const token = "a".repeat(64),
    store = new OfficeStore(db, f.project, token);
  async function newTask() {
    const item = await store.register(token, f.input);
    for (const gate of ["G1", "G3"]) {
      const c = store.requestApproval(token, item.id, gate);
      store.decide(token, c.id, {
        decision: "approve",
        note: "Disposable dispatch fixture.",
      });
    }
    return item;
  }
  const item = await newTask(),
    storage = join(f.root, "candidates");
  mkdirSync(storage);
  const candidate = freezeCandidate(f.project, ["story.md"], storage);
  const verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification);
  const round = verification.begin(item.id, candidate);
  return { ...f, store, item, verification, execution, round, newTask };
}
function controlledVerifier() {
  const calls = [];
  let active = 0,
    maximum = 0;
  return {
    calls,
    get maximum() {
      return maximum;
    },
    async run(candidate, check, beforeStart, signal) {
      const handle = "fixture-" + check.argv.at(-1),
        deferred = Promise.withResolvers();
      beforeStart(handle);
      active++;
      maximum = Math.max(maximum, active);
      const cancel = () =>
        deferred.resolve({ error: "CANCELLED", exitCode: null });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      calls.push({
        handle,
        candidate,
        finish: deferred.resolve,
        fail: deferred.reject,
      });
      try {
        const overrides = await deferred.promise;
        return {
          handle,
          closed: true,
          cleanupErrors: [],
          observation: {
            kind: "test",
            exitCode: 0,
            signal: null,
            timedOut: false,
            error: null,
            output: handle,
            ...overrides,
          },
        };
      } finally {
        active--;
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}
async function until(predicate) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail("Dispatcher did not reach expected state");
}
function start(f, verifier, signal) {
  return runRegisteredChecks(
    f.execution,
    f.verification,
    verifier,
    f.round.id,
    signal,
  );
}

test(
  "dispatch drains checks with at most three workers and leaves the required review pending",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      v = controlledVerifier(),
      pending = start(f, v);
    await until(() => v.calls.length === 3);
    assert.equal(v.maximum, 3);
    v.calls[2].finish({ exitCode: 7 });
    await until(() => v.calls.length === 4);
    v.calls[0].finish({});
    await until(() => v.calls.length === 5);
    v.calls.forEach((c) => c.finish({}));
    const result = await pending;
    assert.equal(result.round.state, "checking");
    assert.equal(result.round.nodes.filter((n) => n.result).length, 5);
    assert.equal(result.round.nodes[2].result.verdict, "fail");
    assert.equal(result.round.nodes.at(-1).result, null);
    assert.ok(result.executions.every((l) => l.state === "released"));
    assert.equal(result.pending.length, 0);
    await start(f, v);
    assert.equal(v.calls.length, 5);
  },
);

test(
  "an unknown result aborts siblings, drains cleanup and never launches queued checks",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      v = controlledVerifier(),
      pending = start(f, v);
    await until(() => v.calls.length === 3);
    v.calls[0].finish({ error: "UNCONFIRMED_OUTPUT", exitCode: null });
    const result = await pending;
    assert.equal(v.calls.length, 3);
    assert.equal(result.round.state, "human_required");
    assert.equal(result.round.nodes.filter((n) => n.result).length, 1);
    assert.ok(result.executions.every((l) => l.state === "released"));
    assert.equal(
      result.executions.filter((l) => l.reason === "ROUND_CLOSED").length,
      2,
    );
  },
);

test(
  "pre-cancel and externally cancelled rounds do not gain evidence",
  { timeout: 10000 },
  async (t) => {
    for (const before of [true, false])
      await t.test(before ? "before launch" : "during execution", async (t) => {
        const f = await setup(t),
          v = controlledVerifier(),
          abort = new AbortController();
        if (before) abort.abort();
        const pending = start(f, v, abort.signal);
        if (!before) {
          await until(() => v.calls.length === 3);
          f.verification.cancel(f.round.id);
        }
        const result = await pending;
        assert.equal(result.round.state, "cancelled");
        assert.ok(result.round.nodes.every((n) => n.result === null));
        assert.ok(result.executions.every((l) => l.state === "released"));
        assert.equal(v.calls.length, before ? 0 : 3);
      });
  },
);

test(
  "operator abort closes the round before cancelled worker observations arrive",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      v = controlledVerifier(),
      abort = new AbortController(),
      pending = start(f, v, abort.signal);
    await until(() => v.calls.length === 3);
    abort.abort();
    const result = await pending;
    assert.equal(result.round.state, "cancelled");
    assert.ok(result.round.nodes.every((n) => n.result === null));
    assert.ok(result.executions.every((l) => l.state === "released"));
  },
);

test(
  "supervisor rejection stops siblings and retains only the unconfirmed slot",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      v = controlledVerifier(),
      pending = start(f, v);
    await until(() => v.calls.length === 3);
    v.calls[0].fail(new Error("Supervisor disconnected"));
    const result = await pending;
    assert.equal(v.calls.length, 3);
    assert.equal(result.round.state, "human_required");
    assert.equal(
      result.executions.filter((l) => l.state === "unknown").length,
      1,
    );
    assert.equal(
      result.executions.filter((l) => l.state === "released").length,
      2,
    );
    assert.equal(result.errors.length, 1);
  },
);

test(
  "global occupancy reduces fan-out and unknown occupancy defers without launching",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      v = controlledVerifier();
    const other1 = await f.newTask(),
      other2 = await f.newTask();
    f.execution.reserveEngineer(other1.id);
    f.execution.reserveEngineer(other2.id);
    const pending = start(f, v);
    for (let i = 0; i < 5; i++) {
      await until(() => v.calls.length === i + 1);
      v.calls[i].finish({});
    }
    const result = await pending;
    assert.equal(v.maximum, 1);
    assert.equal(result.pending.length, 0);
    const other3 = await f.newTask(),
      round = f.verification.begin(other3.id, f.round.candidate);
    f.execution.reserveNode(round.id, round.nodes[0].id);
    f.execution.recoverInterrupted();
    const other4 = await f.newTask(),
      fourth = f.verification.begin(other4.id, f.round.candidate),
      untouched = controlledVerifier();
    const deferred = await runRegisteredChecks(
      f.execution,
      f.verification,
      untouched,
      fourth.id,
    );
    assert.equal(untouched.calls.length, 0);
    assert.equal(deferred.round.state, "checking");
    assert.equal(deferred.pending.length, 5);
    assert.equal(deferred.deferredReason, "SLOT_LIMIT");
  },
);

test(
  "two dispatch calls cannot execute a verification node twice",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      v = controlledVerifier(),
      first = start(f, v);
    await until(() => v.calls.length === 3);
    const second = await start(f, v);
    assert.equal(second.executions.length, 3);
    assert.equal(v.calls.length, 3);
    v.calls.forEach((c) => c.finish({}));
    await until(() => v.calls.length === 5);
    v.calls.forEach((c) => c.finish({}));
    const done = await first;
    assert.equal(new Set(v.calls.map((c) => c.handle)).size, 5);
    assert.equal(done.executions.length, 5);
  },
);

test(
  "reservation budget exhaustion becomes human-required and stops further dispatch",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t, 7, 600000),
      v = controlledVerifier(),
      pending = start(f, v);
    await until(() => v.calls.length === 3);
    v.calls.slice().forEach((c) => c.finish({}));
    await until(() => v.calls.length === 6);
    v.calls[3].finish({});
    const result = await pending;
    assert.equal(v.calls.length, 6);
    assert.equal(result.round.state, "human_required");
    assert.equal(result.round.reason, "EXECUTION_BUDGET_EXHAUSTED");
    assert.ok(result.executions.every((l) => l.state === "released"));
  },
);
