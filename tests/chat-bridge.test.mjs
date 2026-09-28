import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
function call(f, command, input) {
  const args = [cli, command, "--project", f.project, "--data-dir", f.data];
  if (command === "init") args.push("--apply");
  if (command === "start") args.push("--port", "0");
  const p = spawnSync(process.execPath, args, {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    timeout: 20000,
  });
  return {
    code: p.status,
    value: JSON.parse(p.status === 0 ? p.stdout : p.stderr),
  };
}
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "office-chat-"));
  const f = { project: join(root, "project"), data: join(root, "data") };
  mkdirSync(f.project);
  t.after(() => {
    call(f, "stop");
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(call(f, "init").code, 0);
  assert.equal(call(f, "start").code, 0);
  return f;
}
test("chat bridge creates and reads a native request without exposing credentials; stale cancel cannot mutate it", (t) => {
  const f = setup(t);
  const created = call(f, "bridge", {
    action: "submit",
    input: {
      request: "Find the parser failure. Report evidence only.",
      risk: "normal",
    },
  });
  assert.equal(created.code, 0, JSON.stringify(created.value));
  assert.equal(created.value.workflow, "kit-role-v1");
  assert.equal(created.value.state, "waiting_pm");
  const taskId = created.value.taskId;
  const listed = call(f, "bridge", { action: "requests" });
  assert.equal(listed.value.items[0].taskId, taskId);
  const read = call(f, "bridge", { action: "request", taskId });
  assert.equal(read.value.request, created.value.request);
  assert.ok(!("token" in read.value));
  const stale = call(f, "bridge", {
    action: "cancel-request",
    taskId,
    input: {
      revision: created.value.revision + 1,
      inputDigest: created.value.inputDigest,
    },
  });
  assert.equal(stale.code, 1);
  assert.equal(stale.value.code, "STALE_INTAKE");
  const cancelled = call(f, "bridge", {
    action: "cancel-request",
    taskId,
    input: {
      revision: created.value.revision,
      inputDigest: created.value.inputDigest,
    },
  });
  assert.equal(cancelled.value.state, "cancelled");
  assert.equal(
    call(f, "bridge", { action: "request", taskId }).value.state,
    "cancelled",
  );
});
test("chat bridge does not enable a locked runtime or invent approvals; no arbitrary URLs", (t) => {
  const f = setup(t);
  assert.equal(
    call(f, "bridge", { action: "runtime" }).value.execution,
    "locked",
  );
  const x = call(f, "bridge", {
    action: "submit",
    input: { request: "Inspect only", risk: "normal" },
  }).value;
  const result = call(f, "bridge", {
    action: "run-planning",
    taskId: x.taskId,
    input: { revision: x.revision, inputDigest: x.inputDigest },
  });
  assert.equal(result.value.code, "EXECUTION_LOCKED");
  assert.equal(
    call(f, "bridge", { action: "request", taskId: x.taskId }).value.state,
    "waiting_pm",
  );
  for (const payload of [
    { action: "fetch", url: "https://example.com" },
    { action: "request", taskId: "../runtime" },
    {
      action: "requests",
      input: { answer: { decision: "approve", note: "automatic" } },
    },
  ]) {
    const result = call(f, "bridge", payload);
    assert.equal(result.code, 1);
    assert.equal(result.value.code, "INVALID_REQUEST");
  }
});
test("monitor gets a distinct read-only capability, supports session login, and cannot create or approve work", async (t) => {
  const f = setup(t);
  const monitor = call(f, "monitor");
  assert.equal(monitor.code, 0, JSON.stringify(monitor.value));
  const url = new URL(monitor.value.url),
    key = new URLSearchParams(url.hash.slice(1)).get("view");
  assert.match(key, /^[a-f0-9]{64}$/);
  const operator = call(f, "operator-key").value.token;
  assert.notEqual(key, operator);
  const base = url.origin;
  const legacy = await fetch(base + "/operator", { redirect: "manual" });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get("location"), "/activity");
  assert.equal((await fetch(base + "/operator/console.js")).status, 410);
  const shell = await fetch(base + "/activity");
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert.ok(!html.includes(key));
  assert.ok(!html.includes(operator));
  assert.ok(!html.includes("Operator 인증키"));
  assert.equal((await fetch(base + "/api/observe/intakes")).status, 401);
  const headers = { Authorization: `Bearer ${key}` };
  assert.equal(
    (await fetch(base + "/api/pazmo/intakes", { headers })).status,
    401,
  );
  assert.equal(
    (await fetch(base + "/api/observe/intakes", { method: "POST", headers }))
      .status,
    405,
  );
  assert.equal(
    (await fetch(base + "/api/observe/approvals/request", { headers })).status,
    404,
  );
  const session = await fetch(base + "/api/observe/session", {
    method: "POST",
    headers,
  });
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const created = call(f, "bridge", {
    action: "submit",
    input: { request: "Find actual defect", risk: "normal" },
  }).value;
  const list = await fetch(base + "/api/observe/intakes", {
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items[0].taskId, created.taskId);
  const denied = await fetch(base + "/api/observe/intakes", {
    headers: { ...headers, Origin: "https://untrusted.example" },
  });
  assert.equal(denied.status, 403);
  assert.equal(call(f, "stop").code, 0);
  const restarted = call(f, "start").value;
  assert.equal(
    (await fetch(restarted.url + "/api/observe/intakes", { headers })).status,
    401,
  );
});
test("chat forwards addressed decisions through existing gates and never delivers an unverified task", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { realpathSync } = await import("node:fs");
  const { OfficeStore } = await import("../src/core/store.ts");
  const { IntakeLedger } = await import("../src/core/intake.ts");
  const { proposal } = await import("./planning-fixture.mjs");
  const f = setup(t),
    state = call(f, "status").value;
  assert.equal(call(f, "stop").code, 0);
  const db = new DatabaseSync(join(state.dataDir, "office.sqlite"));
  let saved;
  try {
    const project = realpathSync(f.project),
      token = "a".repeat(64);
    saved = proposal(
      new IntakeLedger(db, new OfficeStore(db, project, token), project),
      token,
      "high",
      1,
    );
  } finally {
    db.close();
  }
  assert.equal(call(f, "start").code, 0);
  const published = call(f, "bridge", {
    action: "publish",
    taskId: saved.taskId,
    input: { revision: saved.revision, inputDigest: saved.inputDigest },
  });
  assert.equal(published.code, 0, JSON.stringify(published.value));
  const taskId = published.value.publication.taskIds[0];
  for (const gate of ["G1", "G3"]) {
    const approval = call(f, "bridge", {
      action: "request-approval",
      taskId,
      input: { gate },
    });
    assert.equal(approval.code, 0, JSON.stringify(approval.value));
    const answer = {
      decision: "approve",
      note: `Synthetic ${gate} answer for transport tests only.`,
    };
    const result = call(f, "bridge", {
      action: "decide",
      input: { id: approval.value.id, answer },
    });
    assert.equal(result.code, 0, JSON.stringify(result.value));
  }
  const task = call(f, "bridge", { action: "contracts" }).value.contracts[0];
  assert.equal(task.approved.G1, true);
  assert.equal(task.approved.G3, true);
  const view = call(f, "bridge", { action: "verification", taskId });
  assert.equal(view.code, 0);
  assert.equal(view.value.completion.status, "not_requested");
  assert.equal(
    call(f, "bridge", { action: "evidence", taskId }).value.code,
    "EVIDENCE_REQUIRED",
  );
  assert.equal(
    call(f, "bridge", {
      action: "request-approval",
      taskId,
      input: { gate: "G4" },
    }).value.code,
    "EVIDENCE_REQUIRED",
  );
  assert.equal(call(f, "bridge", { action: "deliver", taskId }).code, 1);
  assert.equal(
    call(f, "bridge", { action: "delivery", taskId }).value.status,
    "not_delivered",
  );
  for (const action of ["run-task", "cancel-task"])
    assert.equal(
      call(f, "bridge", {
        action,
        taskId,
        input: { contractDigest: view.value.contract.contract.digest },
      }).value.code,
      "EXECUTION_LOCKED",
    );
  assert.equal(
    call(f, "bridge", {
      action: "assess",
      taskId,
      input: { requestId: "a1", answerDigest: "a".repeat(64) },
    }).value.code,
    "EXECUTION_LOCKED",
  );
});
