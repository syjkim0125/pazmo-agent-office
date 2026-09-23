import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  realpathSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import test from "node:test";
const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
function call(f, ...args) {
  const r = spawnSync(
    process.execPath,
    [cli, ...args, "--project", f.project, "--data-dir", f.data],
    { encoding: "utf8", timeout: 20000 },
  );
  return {
    status: r.status,
    value: JSON.parse(r.status === 0 ? r.stdout : r.stderr),
  };
}
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "pazmo-service-"));
  const f = { root, project: join(root, "project"), data: join(root, "data") };
  mkdirSync(f.project);
  t.after(() => {
    call(f, "stop");
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(call(f, "init", "--apply").status, 0);
  return f;
}
test("operator page exposes no capability and intake listing requires the existing operator boundary", async (t) => {
  const f = setup(t),
    running = call(f, "start", "--port", "0").value;
  const state = JSON.parse(readFileSync(join(running.dataDir, "running.json")));
  const operator = JSON.parse(
    readFileSync(join(running.dataDir, `operator-${state.instance}.json`)),
  );
  const base = `http://127.0.0.1:${state.port}`;
  for (const path of [
    "/operator",
    "/operator/console.js",
    "/operator/conversation.js",
    "/operator/start.js",
    "/operator/style.css",
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/,
    );
    assert.ok(!(await response.text()).includes(operator.token));
  }
  assert.equal((await fetch(base + "/api/pazmo/intakes")).status, 401);
  const headers = { Authorization: `Bearer ${operator.token}` };
  assert.equal(
    (
      await fetch(base + "/api/pazmo/intakes", {
        headers: { ...headers, Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/pazmo/intakes?before=bad!", { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(base + "/api/pazmo/intakes?unknown=1", { headers })).status,
    400,
  );
  const created = await fetch(base + "/api/pazmo/intakes", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ request: "Review the parser.", risk: "normal" }),
  });
  assert.equal(created.status, 201);
  const item = await created.json();
  const list = await (
    await fetch(base + "/api/pazmo/intakes", { headers })
  ).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].taskId, item.taskId);
  assert.equal(list.items[0].state, "waiting_pm");
  assert.ok(!JSON.stringify(list).includes(operator.token));
});
test("operator CLI publishes a saved proposal once, retains approval gates and restores links after restart", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { OfficeStore } = await import("../src/core/store.ts");
  const { IntakeLedger } = await import("../src/core/intake.ts");
  const { proposal } = await import("./planning-fixture.mjs");
  const f = setup(t),
    started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0);
  assert.equal(call(f, "stop").status, 0);
  const db = new DatabaseSync(join(started.value.dataDir, "office.sqlite"));
  let saved;
  try {
    const project = realpathSync(f.project),
      token = "a".repeat(64);
    saved = proposal(
      new IntakeLedger(db, new OfficeStore(db, project, token), project),
      token,
      "high",
    );
  } finally {
    db.close();
  }
  assert.equal(call(f, "start", "--port", "0").status, 0);
  const running = JSON.parse(
    readFileSync(join(started.value.dataDir, "running.json")),
  );
  const operator = JSON.parse(
    readFileSync(
      join(started.value.dataDir, `operator-${running.instance}.json`),
    ),
  );
  const route =
    call(f, "status").value.url +
    "/api/pazmo/intakes/" +
    saved.taskId +
    "/publish";
  const input = { revision: saved.revision, inputDigest: saved.inputDigest };
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${operator.token}`,
        },
        body: JSON.stringify({ ...input, destination: "story.md" }),
      })
    ).status,
    400,
  );
  const file = join(f.root, "publication.json");
  writeFileSync(file, JSON.stringify(input));
  const published = call(
    f,
    "intake-publish",
    "--task-id",
    saved.taskId,
    "--file",
    file,
  );
  assert.equal(published.status, 0, JSON.stringify(published.value));
  assert.equal(published.value.state, "registered");
  assert.equal(published.value.publication.taskIds.length, 2);
  assert.ok(!JSON.stringify(published.value).includes(operator.token));
  const tasks = call(f, "contracts").value.contracts;
  assert.equal(tasks.length, 2);
  assert.ok(
    tasks.every(
      (task) =>
        task.blocker === "G1_REQUIRED" &&
        !task.approved.G3 &&
        task.execution === "locked",
    ),
  );
  assert.equal(call(f, "stop").status, 0);
  assert.equal(call(f, "start", "--port", "0").status, 0);
  assert.deepEqual(
    call(f, "intake", "--task-id", saved.taskId).value,
    published.value,
  );
  assert.deepEqual(
    call(f, "intake-publish", "--task-id", saved.taskId, "--file", file).value,
    published.value,
  );
  assert.equal(call(f, "contracts").value.contracts.length, 2);
});

test("operator CLI persists intake questions across restart and rejects stale or untrusted answers", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { OfficeStore } = await import("../src/core/store.ts");
  const { IntakeLedger } = await import("../src/core/intake.ts");
  const f = setup(t),
    file = join(f.root, "request.json");
  assert.equal(call(f, "start", "--port", "0").status, 0);
  writeFileSync(
    file,
    JSON.stringify({ request: "Validate parser input.", risk: "normal" }),
  );
  const made = call(f, "intake-create", "--file", file);
  assert.equal(made.status, 0, JSON.stringify(made.value));
  const s = made.value;
  assert.equal(s.state, "waiting_pm");
  assert.equal(call(f, "stop").status, 0);
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office/manifest.json")),
  );
  const db = new DatabaseSync(join(manifest.dataDir, "office.sqlite"));
  try {
    const intake = new IntakeLedger(
      db,
      new OfficeStore(db, manifest.project, "a".repeat(64)),
      manifest.project,
    );
    const stdout = [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({
            version: 1,
            inputDigest: s.inputDigest,
            status: "questions",
            questions: [{ id: "Q1", text: "Which parser?", reason: "Scope" }],
          }),
        },
      },
      { type: "turn.completed" },
    ]
      .map(JSON.stringify)
      .join("\n");
    intake.accept(s.taskId, s.revision, s.inputDigest, {
      closed: true,
      result: {
        exitCode: 0,
        signal: null,
        error: null,
        timedOut: false,
        stdout,
        stderr: "",
      },
    });
  } finally {
    db.close();
  }
  const running = call(f, "start", "--port", "0").value;
  const got = call(f, "intake", "--task-id", s.taskId);
  assert.equal(got.value.state, "awaiting_answer");
  const identity = JSON.parse(
    readFileSync(join(manifest.dataDir, "running.json")),
  );
  const operator = JSON.parse(
    readFileSync(join(manifest.dataDir, `operator-${identity.instance}.json`)),
  );
  const trustedHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${operator.token}`,
  };
  assert.equal(
    (
      await fetch(running.url + "/api/pazmo/intakes/" + s.taskId + "/accept", {
        method: "POST",
        headers: trustedHeaders,
        body: "{}",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(running.url + "/api/pazmo/intakes", {
        method: "POST",
        headers: trustedHeaders,
        body: JSON.stringify({
          request: "Forged approval",
          risk: "normal",
          approved: true,
        }),
      })
    ).status,
    400,
  );
  assert.ok(!JSON.stringify(got.value).includes(operator.token));
  const route = running.url + "/api/pazmo/intakes/" + s.taskId + "/answer";
  const input = {
    revision: got.value.revision,
    inputDigest: got.value.inputDigest,
    answers: [{ id: "Q1", answer: "Public parser." }],
  };
  assert.equal(
    (
      await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
    ).status,
    401,
  );
  writeFileSync(file, JSON.stringify(input));
  const answered = call(
    f,
    "intake-answer",
    "--task-id",
    s.taskId,
    "--file",
    file,
  );
  assert.equal(answered.status, 0, JSON.stringify(answered.value));
  assert.equal(answered.value.state, "waiting_pm");
  assert.equal(
    call(f, "intake-answer", "--task-id", s.taskId, "--file", file).value.code,
    "STALE_INTAKE",
  );
  writeFileSync(
    file,
    JSON.stringify({
      revision: answered.value.revision,
      inputDigest: answered.value.inputDigest,
    }),
  );
  assert.equal(
    call(f, "intake-cancel", "--task-id", s.taskId, "--file", file).value.state,
    "cancelled",
  );
  assert.equal(call(f, "stop").status, 0);
  assert.equal(call(f, "start", "--port", "0").status, 0);
  const restored = call(f, "intake", "--task-id", s.taskId).value;
  assert.equal(restored.state, "cancelled");
  assert.deepEqual(
    restored.events.map((e) => e.actor),
    ["human", "pm", "human", "human"],
  );
});
test("start/status/stop use an isolated locked Office and preserve its database", async (t) => {
  const f = setup(t);
  assert.equal(call(f, "status").value.status, "stopped");
  const started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  const { url, dataDir } = started.value;
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.equal(call(f, "status").value.status, "running");
  assert.equal(call(f, "start", "--port", "0").value.status, "running");
  const health = await (await fetch(url + "/api/pazmo/status")).json();
  assert.equal(health.execution, "locked");
  const html = await (await fetch(url)).text();
  assert.ok(html.includes("AI execution locked"));
  assert.ok(html.includes("Pazmo Agent Office — Read-only preview"));
  const agents = await (await fetch(url + "/api/agents")).json();
  assert.ok(agents.agents.length >= 3);
  const stats = await (await fetch(url + "/api/stats")).json();
  assert.equal(stats.stats.agents.total, 3);
  assert.equal(stats.stats.tasks.total, 0);
  for (const path of [
    "/api/tasks",
    "/api/tasks/fake/run",
    "/api/tasks/fake/resume",
    "/api/messages",
    "/api/auto-update",
    "/api/decision-inbox/fake",
  ]) {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await fetch(url + path, { method });
      assert.equal(response.status, 423, path + " " + method);
    }
  }
  assert.equal((await fetch(url + "/api/cli-status")).status, 423);
  assert.equal(
    (await fetch(url + "/__pazmo/stop", { method: "POST" })).status,
    401,
  );
  assert.equal(
    (
      await fetch(url + "/api/agents", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(call(f, "remove", "--apply").value.code, "RUNNING");
  assert.equal(call(f, "stop").value.status, "stopped");
  assert.equal(call(f, "status").value.status, "stopped");
  assert.ok(existsSync(join(dataDir, "office.sqlite")));
  assert.equal(call(f, "remove", "--apply").status, 0);
  assert.ok(existsSync(join(dataDir, "office.sqlite")));
});
test("port collision fails without claiming running or stopping the unrelated server", async (t) => {
  const f = setup(t);
  const server = createServer((_req, res) => res.end("unrelated"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const r = call(f, "start", "--port", String(server.address().port));
  assert.equal(r.status, 1);
  assert.equal(call(f, "status").value.status, "stopped");
  assert.equal(
    await (await fetch("http://127.0.0.1:" + server.address().port)).text(),
    "unrelated",
  );
});

test("restart reuses only this project database and keeps the same agents", async (t) => {
  const f = setup(t);
  let started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0);
  const first = await (await fetch(started.value.url + "/api/agents")).json();
  assert.equal(call(f, "stop").status, 0);
  started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  const second = await (await fetch(started.value.url + "/api/agents")).json();
  assert.deepEqual(second, first);
});

test("foreign SQLite data is rejected and preserved", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = setup(t);
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office", "manifest.json"), "utf8"),
  );
  mkdirSync(manifest.dataDir, { recursive: true });
  const file = join(manifest.dataDir, "office.sqlite");
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE user_records (value TEXT); INSERT INTO user_records VALUES ('keep'); PRAGMA user_version=1",
  );
  db.close();
  const before = readFileSync(file);
  assert.equal(call(f, "start", "--port", "0").status, 1);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(call(f, "status").value.status, "stopped");
});

test("a pending startup is unknown to stop and cannot be removed", (t) => {
  const f = setup(t);
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office", "manifest.json"), "utf8"),
  );
  mkdirSync(join(manifest.dataDir, "start.lock"), { recursive: true });
  assert.equal(call(f, "status").value.status, "unknown");
  assert.equal(call(f, "stop").value.code, "UNKNOWN");
  assert.equal(call(f, "remove", "--apply").value.code, "RUNNING");
});

test("unauthenticated saved state never stops an unrelated process", async (t) => {
  const { locate } = await import("../src/cli/project.ts");
  const { status, stop, start } = await import("../src/cli/lifecycle.ts");
  const f = setup(t);
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office", "manifest.json"), "utf8"),
  );
  mkdirSync(manifest.dataDir, { recursive: true });
  const server = createServer((_req, res) => res.end("unrelated"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const file = join(manifest.dataDir, "running.json");
  const content = JSON.stringify({
    version: 1,
    project: manifest.project,
    pid: process.pid,
    port: server.address().port,
    token: "a".repeat(64),
    instance: "b".repeat(32),
  });
  writeFileSync(file, content);
  // Keep the server's event loop free: a synchronous CLI child would only test timeout.
  const project = locate(f.project, f.data);
  assert.equal((await status(project)).status, "unknown");
  await assert.rejects(stop(project), { code: "UNKNOWN" });
  await assert.rejects(start(project, 0), { code: "UNKNOWN" });
  assert.equal(readFileSync(file, "utf8"), content);
  assert.equal(
    await (await fetch("http://127.0.0.1:" + server.address().port)).text(),
    "unrelated",
  );
});

test("operator-only contracts share the real task API and invalidate approval when documents change", async (t) => {
  const { fixture } = await import("./contract-fixture.mjs");
  const source = fixture(t),
    f = setup(t);
  for (const path of ["story.md", "task.md", "decision.md", "verify.json"])
    writeFileSync(
      join(f.project, path),
      readFileSync(join(source.project, path)),
    );
  const started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  const { url, dataDir } = started.value;
  const running = JSON.parse(readFileSync(join(dataDir, "running.json")));
  const operator = JSON.parse(
    readFileSync(join(dataDir, `operator-${running.instance}.json`)),
  );
  const send = (path, body, token = operator.token) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await send("/api/pazmo/contracts", { input: source.input }, running.token))
      .status,
    401,
  );
  assert.equal((await fetch(url + "/api/pazmo/contracts")).status, 401);
  const response = await send("/api/pazmo/contracts", { input: source.input });
  assert.equal(response.status, 201);
  const item = await response.json();
  assert.equal(item.ready, false);
  for (const gate of ["G1", "G3"]) {
    const challenge = await (
      await send("/api/pazmo/approvals/request", { taskId: item.id, gate })
    ).json();
    assert.equal(
      (
        await send("/api/pazmo/approvals/decide", {
          id: challenge.id,
          answer: { decision: "approve", note: "I accept this contract." },
        })
      ).status,
      200,
    );
  }
  const tasks = await (await fetch(url + "/api/tasks")).json();
  assert.equal(tasks.tasks[0].id, item.id);
  assert.equal(tasks.tasks[0].status, "planned");
  assert.equal(
    (
      await send("/api/pazmo/approvals/request", {
        taskId: item.id,
        gate: "G4",
      })
    ).status,
    409,
  );
  assert.equal((await send(`/api/tasks/${item.id}/run`, {})).status, 423);
  writeFileSync(join(f.project, "story.md"), source.story + "\nNew scope.\n");
  const list = await (
    await fetch(url + "/api/pazmo/contracts", {
      headers: { Authorization: `Bearer ${operator.token}` },
    })
  ).json();
  assert.equal(list.contracts[0].blocker, "CONTRACT_CHANGED");
  assert.equal(list.contracts[0].ready, false);
  assert.equal(
    (await send("/api/pazmo/contracts", { input: source.input }, "worker"))
      .status,
    401,
  );
  assert.equal(
    (
      await fetch(url + "/api/pazmo/contracts", {
        headers: {
          Authorization: `Bearer ${operator.token}`,
          Origin: "https://outside.example",
        },
      })
    ).status,
    403,
  );
});

test("owned v1 database gets a restorable backup before additive contract migration", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { applyBaseSchema } =
    await import("../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts");
  const { readdirSync } = await import("node:fs");
  const f = setup(t),
    manifest = JSON.parse(
      readFileSync(join(f.project, ".pazmo-office", "manifest.json")),
    );
  mkdirSync(manifest.dataDir, { recursive: true });
  const db = new DatabaseSync(join(manifest.dataDir, "office.sqlite"));
  applyBaseSchema(db);
  db.exec(
    "CREATE TABLE pazmo_instance (project TEXT NOT NULL, version INTEGER NOT NULL); PRAGMA user_version=1",
  );
  db.prepare("INSERT INTO pazmo_instance VALUES (?,1)").run(manifest.project);
  db.prepare("INSERT INTO tasks (id,title) VALUES (?,?)").run(
    "preserved",
    "Existing task",
  );
  db.close();
  const started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.equal(call(f, "stop").status, 0);
  const backups = readdirSync(manifest.dataDir).filter(
    (name) => name.startsWith("office-v1-") && name.endsWith(".sqlite"),
  );
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(manifest.dataDir, backups[0]), {
    readOnly: true,
  });
  assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 1);
  assert.equal(
    backup.prepare("SELECT title FROM tasks WHERE id=?").get("preserved").title,
    "Existing task",
  );
  backup.close();
  const migrated = new DatabaseSync(join(manifest.dataDir, "office.sqlite"), {
    readOnly: true,
  });
  assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 11);
  assert.equal(
    migrated.prepare("SELECT COUNT(*) AS n FROM pazmo_task_contracts").get().n,
    0,
  );
  migrated.close();
  assert.equal(call(f, "start", "--port", "0").status, 0);
  assert.equal(call(f, "stop").status, 0);
  assert.equal(
    readdirSync(manifest.dataDir).filter((name) =>
      name.startsWith("office-v1-"),
    ).length,
    1,
  );
});

for (const oldVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10])
  test(`owned v${oldVersion} migration backs up data before adding execution tables`, async (t) => {
    const { DatabaseSync } = await import("node:sqlite");
    const { applyBaseSchema } =
      await import("../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts");
    const { OfficeStore } = await import("../src/core/store.ts");
    const { VerificationLedger } = await import("../src/core/verification.ts");
    const { readdirSync } = await import("node:fs");
    const f = setup(t);
    const manifest = JSON.parse(
      readFileSync(join(f.project, ".pazmo-office/manifest.json")),
    );
    mkdirSync(manifest.dataDir, { recursive: true });
    const db = new DatabaseSync(join(manifest.dataDir, "office.sqlite"));
    applyBaseSchema(db);
    db.exec(
      `CREATE TABLE pazmo_instance (project TEXT NOT NULL, version INTEGER NOT NULL); PRAGMA user_version=${oldVersion}`,
    );
    db.prepare("INSERT INTO pazmo_instance VALUES (?,?)").run(
      manifest.project,
      oldVersion,
    );
    const store = new OfficeStore(db, manifest.project, "a".repeat(64));
    db.exec(
      "DROP TABLE pazmo_kit_receipts; DROP TABLE pazmo_kit_assignments",
    );
    if (oldVersion >= 3) {
      const verification = new VerificationLedger(db, store);
      db.exec("DROP TABLE pazmo_integration_feedback");
      if (oldVersion >= 4) {
        const { ExecutionLedger } = await import("../src/core/budgets.ts");
        const execution = new ExecutionLedger(db, store, verification);
        if (oldVersion >= 6) {
          const { HandoffLedger } = await import("../src/core/handoffs.ts");
          new HandoffLedger(
            db,
            store,
            verification,
            execution,
            manifest.project,
            join(manifest.dataDir, "candidates"),
          );
        }
        if (oldVersion >= 5) {
          const { CompletionLedger } =
            await import("../src/core/completion.ts");
          new CompletionLedger(
            db,
            store,
            verification,
            execution,
            "a".repeat(64),
            undefined,
          );
        }
      }
    }
    if (oldVersion < 7) db.exec("DROP TABLE IF EXISTS pazmo_deliveries");
    let priorIntake;
    if (oldVersion >= 8) {
      const { IntakeLedger } = await import("../src/core/intake.ts");
      priorIntake = new IntakeLedger(db, store, manifest.project).create(
        "a".repeat(64),
        "Preserve pending planning request.",
        "normal",
      );
      if (oldVersion < 9) db.exec("DROP TABLE pazmo_intake_publications");
    }
    db.exec("DROP TABLE IF EXISTS pazmo_planning_leases");
    db.prepare(
      "INSERT INTO tasks (id,title) VALUES ('preserved','Preserve v2 task')",
    ).run();
    db.close();
    assert.equal(call(f, "start", "--port", "0").status, 0);
    assert.equal(call(f, "stop").status, 0);
    const backups = readdirSync(manifest.dataDir).filter(
      (name) =>
        name.startsWith(`office-v${oldVersion}-`) && name.endsWith(".sqlite"),
    );
    assert.equal(backups.length, 1);
    const original = new DatabaseSync(join(manifest.dataDir, backups[0]), {
      readOnly: true,
    });
    assert.equal(
      original.prepare("PRAGMA user_version").get().user_version,
      oldVersion,
    );
    assert.equal(
      original.prepare("SELECT title FROM tasks WHERE id='preserved'").get()
        .title,
      "Preserve v2 task",
    );
    assert.equal(
      Boolean(
        original
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='pazmo_execution_leases'",
          )
          .get(),
      ),
      oldVersion >= 4,
    );
    assert.equal(
      Boolean(
        original
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='pazmo_g4_requests'",
          )
          .get(),
      ),
      oldVersion >= 5,
    );
    assert.equal(
      Boolean(
        original
          .prepare("SELECT name FROM sqlite_master WHERE name='pazmo_handoffs'")
          .get(),
      ),
      oldVersion >= 6,
    );
    assert.equal(
      Boolean(
        original
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='pazmo_deliveries'",
          )
          .get(),
      ),
      oldVersion >= 7,
    );
    if (priorIntake) {
      assert.equal(
        original
          .prepare("SELECT revision FROM pazmo_intakes WHERE task_id=?")
          .get(priorIntake.taskId).revision,
        priorIntake.revision,
      );
      assert.equal(
        original.prepare("SELECT count(*) n FROM pazmo_intake_events").get().n,
        1,
      );
      assert.equal(
        Boolean(
          original
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='pazmo_intake_publications'",
            )
            .get(),
        ),
        oldVersion >= 9,
      );
    }
    original.close();
    const current = new DatabaseSync(join(manifest.dataDir, "office.sqlite"), {
      readOnly: true,
    });
    assert.equal(current.prepare("PRAGMA user_version").get().user_version, 11);
    assert.equal(
      current.prepare("SELECT count(*) n FROM pazmo_kit_assignments").get().n,
      0,
    );
    assert.equal(
      current.prepare("SELECT count(*) n FROM pazmo_kit_receipts").get().n,
      0,
    );
    assert.equal(
      current.prepare("SELECT count(*) n FROM pazmo_intake_publications").get()
        .n,
      0,
    );
    assert.equal(
      current.prepare("SELECT count(*) n FROM pazmo_intakes").get().n,
      priorIntake ? 1 : 0,
    );
    if (priorIntake) {
      assert.equal(
        current
          .prepare("SELECT packet_json FROM pazmo_intakes WHERE task_id=?")
          .get(priorIntake.taskId).packet_json,
        JSON.stringify(
          (await import("../src/runners/planning.ts")).beginPlanning(
            priorIntake.taskId,
            priorIntake.request,
            priorIntake.risk,
          ),
        ),
      );
      assert.equal(
        current.prepare("SELECT count(*) n FROM pazmo_intake_events").get().n,
        1,
      );
    }
    assert.equal(
      current.prepare("SELECT COUNT(*) AS n FROM pazmo_handoffs").get().n,
      0,
    );
    assert.equal(
      current.prepare("SELECT COUNT(*) AS n FROM pazmo_g4_requests").get().n,
      0,
    );
    assert.equal(
      current.prepare("SELECT COUNT(*) AS n FROM pazmo_execution_leases").get()
        .n,
      0,
    );
    assert.equal(
      current
        .prepare("SELECT COUNT(*) AS n FROM pazmo_verification_rounds")
        .get().n,
      0,
    );
    assert.equal(
      current.prepare("SELECT COUNT(*) n FROM pazmo_deliveries").get().n,
      0,
    );
    current.close();
    assert.equal(call(f, "start", "--port", "0").status, 0);
    assert.equal(call(f, "stop").status, 0);
    assert.equal(
      readdirSync(manifest.dataDir).filter((name) =>
        name.startsWith(`office-v${oldVersion}-`),
      ).length,
      1,
    );
  });

test("failed verification migration preserves the previous schema and backup", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readdirSync } = await import("node:fs");
  const { applyBaseSchema } =
    await import("../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts");
  const { OfficeStore } = await import("../src/core/store.ts");
  const f = setup(t);
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office/manifest.json")),
  );
  mkdirSync(manifest.dataDir, { recursive: true });
  const dbPath = join(manifest.dataDir, "office.sqlite");
  const db = new DatabaseSync(dbPath);
  applyBaseSchema(db);
  db.exec(
    "CREATE TABLE pazmo_instance (project TEXT NOT NULL, version INTEGER NOT NULL); PRAGMA user_version=2",
  );
  db.prepare("INSERT INTO pazmo_instance VALUES (?,2)").run(manifest.project);
  new OfficeStore(db, manifest.project, "a".repeat(64));
  db.exec(
    "CREATE TRIGGER reject_migration BEFORE UPDATE ON pazmo_instance BEGIN SELECT RAISE(ABORT, 'migration fault'); END",
  );
  db.close();
  const failed = call(f, "start", "--port", "0");
  assert.notEqual(failed.status, 0);
  assert.equal(call(f, "status").value.status, "stopped");
  const backups = readdirSync(manifest.dataDir).filter(
    (name) => name.startsWith("office-v2-") && name.endsWith(".sqlite"),
  );
  assert.equal(backups.length, 1);
  for (const path of [dbPath, join(manifest.dataDir, backups[0])]) {
    const check = new DatabaseSync(path, { readOnly: true });
    assert.equal(check.prepare("PRAGMA user_version").get().user_version, 2);
    assert.equal(
      check.prepare("SELECT version FROM pazmo_instance").get().version,
      2,
    );
    assert.equal(
      check
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='pazmo_verification_rounds'",
        )
        .get(),
      undefined,
    );
    assert.equal(
      check
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='pazmo_g4_requests'",
        )
        .get(),
      undefined,
    );
    check.close();
  }
});

test("runtime exposes private verification evidence and quarantines interrupted rounds on restart", async (t) => {
  const { fixture } = await import("./contract-fixture.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const { OfficeStore } = await import("../src/core/store.ts");
  const { VerificationLedger } = await import("../src/core/verification.ts");
  const { freezeCandidate } = await import("../src/core/candidates.ts");
  const { chmodSync } = await import("node:fs");
  const source = fixture(t),
    f = setup(t);
  for (const path of ["story.md", "task.md", "decision.md", "verify.json"])
    writeFileSync(
      join(f.project, path),
      readFileSync(join(source.project, path)),
    );
  const initial = call(f, "start", "--port", "0");
  assert.equal(initial.status, 0);
  assert.equal(call(f, "stop").status, 0);
  // Prepare controller-owned records while the real service is stopped. No model result is claimed.
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office/manifest.json")),
  );
  const db = new DatabaseSync(join(manifest.dataDir, "office.sqlite"));
  const token = "c".repeat(64),
    store = new OfficeStore(db, manifest.project, token);
  const ledger = new VerificationLedger(db, store);
  const { ExecutionLedger } = await import("../src/core/budgets.ts");
  const execution = new ExecutionLedger(db, store, ledger);
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const candidate = freezeCandidate(manifest.project, ["story.md"], storage);
  const rounds = [];
  for (let i = 0; i < 2; i++) {
    const task = await store.register(token, source.input);
    for (const gate of ["G1", "G3"]) {
      const c = store.requestApproval(token, task.id, gate);
      store.decide(token, c.id, {
        decision: "approve",
        note: "Accept fixture contract.",
      });
    }
    const round = ledger.begin(task.id, candidate);
    if (i === 1)
      for (const node of round.nodes)
        ledger.record({
          roundId: round.id,
          nodeId: node.id,
          candidateDigest: candidate.digest,
          contractDigest: round.contractDigest,
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
    rounds.push(ledger.get(round.id));
  }
  const interruptedLease = execution.reserveNode(
    rounds[0].id,
    rounds[0].nodes[0].id,
  );
  const empty = await store.register(token, source.input);
  db.close();
  const started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  const { url, dataDir } = started.value;
  const running = JSON.parse(readFileSync(join(dataDir, "running.json")));
  const operator = JSON.parse(
    readFileSync(join(dataDir, `operator-${running.instance}.json`)),
  );
  const endpoint = (id) => url + "/api/pazmo/verification/" + id;
  const headers = { Authorization: `Bearer ${operator.token}` };
  assert.equal((await fetch(endpoint(rounds[0].taskId))).status, 401);
  assert.equal(
    (
      await fetch(endpoint(rounds[0].taskId), {
        headers: { Authorization: `Bearer ${running.token}` },
      })
    ).status,
    401,
  );
  const interrupted = call(f, "verification", "--task-id", rounds[0].taskId);
  assert.equal(interrupted.status, 0, JSON.stringify(interrupted.value));
  assert.equal(interrupted.value.verification.state, "human_required");
  assert.equal(interrupted.value.verification.reason, "CONTROLLER_RESTARTED");
  assert.equal(interrupted.value.executions[0].id, interruptedLease.id);
  assert.equal(interrupted.value.executions[0].state, "unknown");
  assert.equal(interrupted.value.executions[0].reason, "CONTROLLER_RESTARTED");
  const completed = await (
    await fetch(endpoint(rounds[1].taskId), { headers })
  ).json();
  assert.equal(completed.verification.state, "awaiting_g4");
  assert.equal(completed.verification.g4Subject, rounds[1].g4Subject);
  assert.equal(completed.execution, "locked");
  assert.equal(
    call(f, "approval-request", "--task-id", rounds[1].taskId, "--gate", "G4")
      .value.code,
    "EVIDENCE_REQUIRED",
  );
  assert.ok(!JSON.stringify(completed).includes(operator.token));
  assert.equal(
    (await fetch(endpoint(rounds[1].taskId), { method: "POST", headers }))
      .status,
    405,
  );
  assert.equal((await fetch(endpoint("aaaa"), { headers })).status, 404);
  assert.equal(
    call(f, "verification", "--task-id", empty.id).value.verification,
    null,
  );
  const file = join(candidate.directory, "tree/story.md");
  chmodSync(file, 0o600);
  writeFileSync(file, "tampered");
  const changed = call(f, "verification", "--task-id", rounds[1].taskId).value;
  assert.equal(changed.verification.state, "human_required");
  assert.equal(changed.verification.g4Subject, null);
  assert.equal(call(f, "stop").status, 0);
});

test("real CLI submits G4 understanding without granting approval and survives restart", async (t) => {
  const { fixture } = await import("./contract-fixture.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const { OfficeStore } = await import("../src/core/store.ts");
  const { VerificationLedger } = await import("../src/core/verification.ts");
  const { ExecutionLedger } = await import("../src/core/budgets.ts");
  const { CompletionLedger } = await import("../src/core/completion.ts");
  const { HandoffLedger } = await import("../src/core/handoffs.ts");
  const source = fixture(t),
    f = setup(t);
  for (const name of ["story.md", "task.md", "verify.json", "decision.md"])
    writeFileSync(
      join(f.project, name),
      readFileSync(join(source.project, name)),
    );
  writeFileSync(
    join(f.project, "verify.json"),
    JSON.stringify({
      ...source.verification,
      workspace: { include: ["story.md", "input.js"], exclude: [] },
    }),
  );
  const initialized = call(f, "start", "--port", "0");
  assert.equal(initialized.status, 0);
  assert.equal(call(f, "stop").status, 0);
  const db = new DatabaseSync(join(initialized.value.dataDir, "office.sqlite"));
  const token = "c".repeat(64),
    store = new OfficeStore(db, realpathSync(f.project), token),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification),
    handoffs = new HandoffLedger(
      db,
      store,
      verification,
      execution,
      realpathSync(f.project),
      join(realpathSync(f.root), "candidate"),
    ),
    completion = new CompletionLedger(
      db,
      store,
      verification,
      execution,
      token,
      handoffs,
    );
  const item = await store.register(token, source.input);
  for (const gate of ["G1", "G3"]) {
    const c = store.requestApproval(token, item.id, gate);
    store.decide(token, c.id, { decision: "approve", note: "Fixture only." });
  }
  const attempt = handoffs.prepare(item.id);
  handoffs.start(attempt.leaseId, "fixture-engineer");
  writeFileSync(join(attempt.workspace, "input.js"), "validate(input)\n");
  const { round } = handoffs.finish(attempt.leaseId, "fixture-engineer", {
    closed: true,
    observation: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
      output: "Fixture engineer",
    },
  });
  for (const node of round.nodes) {
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
        output: "Controlled fixture result",
        ...(node.kind === "review"
          ? {
              report: {
                verdict: "pass",
                findings: [],
                summary: "Controlled fixture review",
              },
            }
          : {}),
      },
    });
  }
  await completion.prepare(item.id);
  db.close();
  assert.equal(call(f, "start", "--port", "0").status, 0);
  const request = call(
    f,
    "approval-request",
    "--task-id",
    item.id,
    "--gate",
    "G4",
  );
  assert.equal(request.status, 0, JSON.stringify(request.value));
  assert.equal(request.value.status, "awaiting_answer");
  assert.equal(request.value.questions.length, 3);
  const answerPath = join(f.root, "answer.json");
  writeFileSync(
    answerPath,
    JSON.stringify({
      decision: "approve",
      note: "Fixture submission only",
      understanding: {
        behavior: "A changed fixture.",
        invariant: "No real project affected.",
        evidence: "Controller records are simulated.",
      },
    }),
  );
  const submitted = call(
    f,
    "approval-decide",
    "--challenge",
    request.value.id,
    "--file",
    answerPath,
  );
  assert.equal(submitted.status, 0, JSON.stringify(submitted.value));
  assert.equal(submitted.value.status, "awaiting_evaluation");
  assert.equal(submitted.value.approved, false);
  const viewed = call(f, "verification", "--task-id", item.id);
  assert.equal(viewed.value.completion.status, "awaiting_evaluation");
  assert.equal(viewed.value.execution, "locked");
  assert.equal(call(f, "stop").status, 0);
  assert.equal(call(f, "start", "--port", "0").status, 0);
  const restarted = call(f, "verification", "--task-id", item.id);
  assert.equal(restarted.value.completion.status, "expired");
  assert.equal(restarted.value.completion.approved, false);
  assert.equal(
    restarted.value.completion.answer.understanding.evidence,
    "Controller records are simulated.",
  );
});

test("CLI registers, reviews and approves a contract without exposing operator credentials", async (t) => {
  const { fixture } = await import("./contract-fixture.mjs");
  const source = fixture(t),
    f = setup(t);
  for (const path of ["story.md", "task.md", "decision.md", "verify.json"])
    writeFileSync(
      join(f.project, path),
      readFileSync(join(source.project, path)),
    );
  const inputFile = join(f.root, "contract.json"),
    answerFile = join(f.root, "answer.json");
  writeFileSync(inputFile, JSON.stringify(source.input));
  writeFileSync(
    answerFile,
    JSON.stringify({
      decision: "approve",
      note: "I reviewed the exact documents and verification command.",
    }),
  );
  assert.equal(call(f, "start", "--port", "0").status, 0);
  const registered = call(f, "contract", "--file", inputFile);
  assert.equal(registered.status, 0, JSON.stringify(registered.value));
  assert.equal(call(f, "contracts").value.contracts.length, 1);
  for (const gate of ["G1", "G3"]) {
    const challenge = call(
      f,
      "approval-request",
      "--task-id",
      registered.value.id,
      "--gate",
      gate,
    );
    assert.equal(challenge.status, 0, JSON.stringify(challenge.value));
    assert.equal(
      call(
        f,
        "approval-decide",
        "--challenge",
        challenge.value.id,
        "--file",
        answerFile,
      ).status,
      0,
    );
    assert.equal(
      call(
        f,
        "approval-decide",
        "--challenge",
        challenge.value.id,
        "--file",
        answerFile,
      ).value.code,
      "STALE_APPROVAL",
    );
  }
  const item = call(f, "contracts").value.contracts[0];
  assert.equal(item.ready, true);
  assert.equal(item.execution, "locked");
  const state = call(f, "status").value;
  const running = JSON.parse(readFileSync(join(state.dataDir, "running.json")));
  const operator = JSON.parse(
    readFileSync(join(state.dataDir, `operator-${running.instance}.json`)),
  );
  assert.ok(!JSON.stringify(item).includes(operator.token));
  assert.equal(call(f, "stop").status, 0);
  assert.equal(
    existsSync(join(state.dataDir, `operator-${running.instance}.json`)),
    false,
  );
});

test("service startup quarantines a running planning role and preserves its occupied slot", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { OfficeStore } = await import("../src/core/store.ts");
  const { IntakeLedger } = await import("../src/core/intake.ts");
  const { VerificationLedger } = await import("../src/core/verification.ts");
  const { ExecutionLedger } = await import("../src/core/budgets.ts");
  const f = setup(t);
  assert.equal(call(f, "start", "--port", "0").status, 0);
  assert.equal(call(f, "stop").status, 0);
  const manifest = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office/manifest.json")),
  );
  const path = join(manifest.dataDir, "office.sqlite");
  const db = new DatabaseSync(path),
    token = "a".repeat(64),
    store = new OfficeStore(db, manifest.project, token),
    intake = new IntakeLedger(db, store, manifest.project),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification, Date.now, intake);
  const s = intake.create(token, "Review parser requirements.", "normal");
  const lease = execution.reservePlanning(
    s.taskId,
    s.revision,
    s.inputDigest,
    "b".repeat(64),
  );
  execution.startPlanning(lease.id, "interrupted-pm");
  db.close();
  assert.equal(call(f, "start", "--port", "0").status, 0);
  const current = call(f, "intake", "--task-id", s.taskId).value;
  assert.equal(current.state, "human_required");
  assert.equal(current.reason, "CONTROLLER_RESTARTED");
  assert.equal(call(f, "stop").status, 0);
  const saved = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    saved
      .prepare("SELECT state FROM pazmo_planning_leases WHERE id=?")
      .get(lease.id).state,
    "unknown",
  );
  assert.equal(
    saved
      .prepare("SELECT count(*) n FROM pazmo_intake_events WHERE task_id=?")
      .get(s.taskId).n,
    2,
  );
  saved.close();
});
