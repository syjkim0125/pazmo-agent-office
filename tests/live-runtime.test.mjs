import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { officeFixture } from "./coordinator-fixture.mjs";
import { IntakeLedger } from "../src/core/intake.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { CompletionLedger } from "../src/core/completion.ts";
import {
  LiveRuntime,
  planningSnapshot,
  createLiveRuntime,
} from "../src/runtime/live.ts";
import { handleOperator } from "../src/runtime/operator.ts";
const token = "a".repeat(64);
const turn = () => new Promise((resolve) => setImmediate(resolve));
test("planning file discovery cannot execute the project's fsmonitor on the host", async (t) => {
  const f = await setup(t);
  execFileSync("/usr/bin/git", ["init", "-q", f.project]);
  const monitor = join(f.root, "project-monitor"),
    marker = join(f.root, "unexpected-host-execution");
  writeFileSync(
    monitor,
    `#!/bin/sh\ntouch '${marker}'\nprintf 'fixture-token\\0'\n`,
    { mode: 0o700 },
  );
  execFileSync("/usr/bin/git", [
    "-C",
    f.project,
    "config",
    "core.fsmonitor",
    monitor,
  ]);
  await planningSnapshot(f.project, f.root, "monitor-test");
  assert.equal(existsSync(marker), false);
});
async function setup(t, approved = true) {
  const f = await officeFixture(t, approved);
  f.intake = new IntakeLedger(f.db, f.store, f.project);
  f.execution = new ExecutionLedger(
    f.db,
    f.store,
    f.verification,
    Date.now,
    f.intake,
  );
  f.completion = new CompletionLedger(
    f.db,
    f.store,
    f.verification,
    f.execution,
    token,
    f.handoffs,
  );
  return f;
}
test("live admission rejects stale/duplicate planning and retains ownership through cancellation cleanup", async (t) => {
  const f = await setup(t),
    item = f.intake.create(token, "Improve parser.", "normal", true);
  let calls = 0,
    released = false,
    finish;
  const runtime = new LiveRuntime(f, {
    planning: async (id, signal) => {
      calls++;
      assert.equal(id, item.taskId);
      await new Promise((resolve) => {
        finish = resolve;
        signal.addEventListener("abort", () => {
          assert.equal(f.intake.get(id).state, "cancelled");
        });
      });
      released = true;
    },
    implementation: async () => assert.fail("Wrong role"),
    dispose() {
      assert.ok(released);
    },
  });
  assert.throws(
    () =>
      runtime.startPlanning(item.taskId, item.revision + 1, item.inputDigest),
    { code: "STALE_INTAKE" },
  );
  runtime.startPlanning(item.taskId, item.revision, item.inputDigest);
  assert.throws(
    () => runtime.startPlanning(item.taskId, item.revision, item.inputDigest),
    { code: "TASK_ACTIVE" },
  );
  await turn();
  assert.equal(calls, 1);
  f.intake.cancel(token, item.taskId, item.revision, item.inputDigest);
  runtime.abort(item.taskId);
  assert.throws(() => runtime.assertIdle(), { code: "TASK_ACTIVE" });
  finish();
  await runtime.close();
  assert.deepEqual(runtime.status().active, []);
  assert.equal(calls, 1);
  assert.equal(f.intake.get(item.taskId).state, "cancelled");
});
test("implementation start requires the exact approved contract and shutdown drains before disposal", async (t) => {
  const f = await setup(t, false);
  let runs = 0,
    stopped = false,
    disposed = false;
  const runtime = new LiveRuntime(f, {
    planning: async () => assert.fail("Wrong role"),
    implementation: async (_id, signal) => {
      runs++;
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      stopped = true;
    },
    dispose() {
      assert.ok(stopped);
      disposed = true;
    },
  });
  assert.throws(() => runtime.startImplementation(f.task.id, "stale"), {
    code: "CONTRACT_CHANGED",
  });
  assert.throws(
    () => runtime.startImplementation(f.task.id, f.task.contract.digest),
    { code: "CONTRACT_NOT_READY" },
  );
  for (const gate of ["G1", "G3"]) {
    const c = f.store.requestApproval(token, f.task.id, gate);
    f.store.decide(token, c.id, {
      decision: "approve",
      note: "Test fixture only",
    });
  }
  runtime.startImplementation(f.task.id, f.task.contract.digest);
  await turn();
  assert.equal(runs, 1);
  assert.equal(disposed, false);
  await runtime.close();
  assert.ok(disposed);
  assert.throws(
    () => runtime.startImplementation(f.task.id, f.task.contract.digest),
    { code: "EXECUTION_LOCKED" },
  );
});
test("unknown planning leases survive runtime reconstruction without another model launch", async (t) => {
  const f = await setup(t),
    item = f.intake.create(token, "Improve parser.", "normal", true);
  const lease = f.execution.reservePlanning(
    item.taskId,
    item.revision,
    item.inputDigest,
    "b".repeat(64),
    10000,
  );
  f.execution.startPlanning(lease.id, "fixture-handle");
  f.execution.recoverInterrupted();
  const runtime = new LiveRuntime(f, {
    planning: async () => assert.fail("Replay"),
    implementation: async () => assert.fail("Replay"),
    dispose() {},
  });
  const current = f.intake.get(item.taskId);
  assert.throws(
    () =>
      runtime.startPlanning(item.taskId, current.revision, current.inputDigest),
    { code: "INTAKE_STATE" },
  );
  assert.equal(f.execution.getPlanning(lease.id).state, "unknown");
  await runtime.close();
});
test("planning snapshots preserve original project edits and reuse the same context after restart", async (t) => {
  const f = await setup(t);
  execFileSync("/usr/bin/git", ["init", "-q", f.project]);
  f.put(".env", "secret-fixture");
  f.put("new.txt", "first");
  const first = await planningSnapshot(f.project, f.root, "request-1");
  f.put("new.txt", "user changed this while PM waited");
  const again = await planningSnapshot(f.project, f.root, "request-1");
  assert.deepEqual(again, first);
  assert.equal(
    readFileSync(join(first.directory, "tree/new.txt"), "utf8"),
    "first",
  );
  assert.equal(
    readFileSync(join(f.project, "new.txt"), "utf8"),
    "user changed this while PM waited",
  );
  assert.ok(
    !readFileSync(join(first.directory, "manifest.json"), "utf8").includes(
      '".env"',
    ),
  );
});
test("preflight refuses an unqualified controller before touching model authentication or VM", async (t) => {
  const f = await setup(t),
    bad = join(f.root, "unqualified");
  writeFileSync(bad, "not a controller");
  await assert.rejects(
    createLiveRuntime(
      {
        controller: bad,
        binary: bad,
        authHome: f.root,
        socket: join(f.root, ".colima/pazmo-office/docker.sock"),
      },
      f.project,
      f.root,
      f,
    ),
    /UNVERIFIED_CONTROLLER_BINARY/,
  );
});
test("authenticated HTTP launch and cancel own the same planning operation without granting approval", async (t) => {
  const f = await setup(t),
    item = f.intake.create(token, "Improve parser.", "normal", true);
  let ran = 0;
  const live = new LiveRuntime(f, {
    planning: async (_id, signal) => {
      ran++;
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
    },
    implementation: async () => assert.fail("Unexpected implementation"),
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
  const base = `http://127.0.0.1:${server.address().port}`;
  const submit = (suffix, body, credential = token) =>
    fetch(base + `/api/pazmo/intakes/${item.taskId}/` + suffix, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const addressed = { revision: item.revision, inputDigest: item.inputDigest };
  assert.equal((await submit("run", addressed, "b".repeat(64))).status, 401);
  assert.equal(ran, 0);
  const launched = await submit("run", addressed);
  assert.equal(launched.status, 202);
  await turn();
  assert.equal(ran, 1);
  assert.equal((await submit("run", addressed)).status, 409);
  assert.equal((await submit("cancel", addressed)).status, 200);
  await turn();
  assert.equal(f.intake.get(item.taskId).state, "cancelled");
  assert.equal(live.status().active.length, 0);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM pazmo_approvals").get().n,
    2,
    "Only unrelated fixture approvals exist",
  );
});
