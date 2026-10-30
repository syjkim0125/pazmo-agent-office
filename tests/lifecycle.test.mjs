import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
import { DatabaseSync } from "node:sqlite";
import { assertOfficesExited, officePid } from "./office-process.mjs";
import { STARTUP_MS } from "../src/cli/lifecycle.ts";

// Engine-independent lifecycle boundaries, on the default (lean) Office.
const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
function call(f, ...args) {
  const r = spawnSync(
    process.execPath,
    [cli, ...args, "--project", f.project, "--data-dir", f.data],
    { encoding: "utf8", timeout: STARTUP_MS.lean + 60000 },
  );
  return {
    status: r.status,
    value: JSON.parse(r.status === 0 ? r.stdout : r.stderr),
  };
}
function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-service-")));
  const f = { root, project: join(root, "project"), data: join(root, "data") };
  mkdirSync(f.project);
  execFileSync("git", ["init", "-q", f.project]);
  t.after(async () => {
    const pids = existsSync(join(f.dataDir ?? root, "running.json")) ? [officePid(f.dataDir)] : [];
    call(f, "stop");
    await assertOfficesExited(pids);
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(call(f, "init", "--apply").status, 0);
  f.dataDir = JSON.parse(
    readFileSync(join(f.project, ".pazmo-office", "manifest.json"), "utf8"),
  ).dataDir;
  return f;
}
const leanFile = (f) => join(f.dataDir, "lean", "office.sqlite");

test("start/status/stop run the default Office in isolation and preserve its data", async (t) => {
  const f = setup(t);
  const ignore = join(f.project, ".pazmo-office", ".gitignore");
  // An installation from before the ignore file existed gains it on start.
  rmSync(ignore, { force: true });
  assert.equal(call(f, "status").value.status, "stopped");
  const started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.ok(existsSync(ignore));
  const { url, dataDir } = started.value;
  assert.equal(started.value.engine, "lean");
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.equal(call(f, "status").value.status, "running");
  assert.equal(call(f, "start", "--port", "0").value.url, url);
  // The controller's stop needs the saved token.
  assert.equal((await fetch(url + "/__pazmo/stop", { method: "POST" })).status, 401);
  assert.equal(call(f, "remove", "--apply").value.code, "RUNNING");
  assert.equal(call(f, "stop").value.status, "stopped");
  assert.equal(call(f, "status").value.status, "stopped");
  assert.ok(existsSync(join(dataDir, "lean", "office.sqlite")));
  assert.equal(call(f, "remove", "--apply").status, 0);
  assert.equal(existsSync(join(f.project, ".pazmo-office")), false);
  assert.ok(existsSync(join(dataDir, "lean", "office.sqlite")));
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

test("restart reuses only this project's database and keeps its agents", (t) => {
  const f = setup(t);
  assert.equal(call(f, "start", "--port", "0").status, 0);
  assert.equal(call(f, "stop").status, 0);
  const db = new DatabaseSync(leanFile(f));
  db.prepare(
    "INSERT INTO agents(id,name,work_runner,work_model,review_runner,review_model) VALUES ('kept','Kept','codex','gpt-5.5','claude','haiku')",
  ).run();
  db.close();
  const started = call(f, "start", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.equal(call(f, "stop").status, 0);
  const saved = new DatabaseSync(leanFile(f), { readOnly: true });
  t.after(() => saved.close());
  assert.equal(saved.prepare("SELECT name FROM agents WHERE id='kept'").get().name, "Kept");
  assert.equal(
    saved.prepare("SELECT project FROM lean_instance").get().project,
    realpathSync(f.project),
  );
});

test("foreign SQLite data is rejected and preserved", (t) => {
  const f = setup(t);
  mkdirSync(join(f.dataDir, "lean"), { recursive: true });
  const db = new DatabaseSync(leanFile(f));
  db.exec("CREATE TABLE user_records (value TEXT); INSERT INTO user_records VALUES ('keep')");
  db.close();
  const before = readFileSync(leanFile(f));
  assert.equal(call(f, "start", "--port", "0").status, 1);
  assert.deepEqual(readFileSync(leanFile(f)), before);
  assert.equal(call(f, "status").value.status, "stopped");
});

test("a pending startup is unknown to stop and cannot be removed", (t) => {
  const f = setup(t);
  mkdirSync(join(f.dataDir, "start.lock"), { recursive: true });
  assert.equal(call(f, "status").value.status, "unknown");
  assert.equal(call(f, "stop").value.code, "UNKNOWN");
  assert.equal(call(f, "remove", "--apply").value.code, "RUNNING");
  rmSync(join(f.dataDir, "start.lock"), { recursive: true });
});

test("unauthenticated saved state never stops an unrelated process", async (t) => {
  const { locate } = await import("../src/cli/project.ts");
  const { status, stop, start } = await import("../src/cli/lifecycle.ts");
  const f = setup(t);
  mkdirSync(f.dataDir, { recursive: true });
  const server = createServer((_req, res) => res.end("unrelated"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const file = join(f.dataDir, "running.json");
  const content = JSON.stringify({
    version: 1,
    project: realpathSync(f.project),
    pid: process.pid,
    port: server.address().port,
    token: "a".repeat(64),
    instance: "b".repeat(32),
  });
  writeFileSync(file, content);
  // Removed before the test ends: setup's cleanup would otherwise wait for the
  // pid it names, which is this test process.
  try {
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
  } finally {
    rmSync(file, { force: true });
  }
});

// An Office an earlier version started (the Claw or legacy engine) keeps running
// from the code it loaded. This version shows it and stops it through the same
// authenticated controller calls, and starts nothing over it.
const appleSilicon = process.platform === "darwin" && process.arch === "arm64";
test("an Office an earlier version left running is shown, refused and stopped", async (t) => {
  const { locate } = await import("../src/cli/project.ts");
  const { monitor, start, status, stop } = await import("../src/cli/lifecycle.ts");
  const { up } = await import("../src/cli/launcher.ts");
  const f = setup(t);
  const p = locate(f.project, f.data);
  // A pid that no longer exists: controller calls, never a signal, stop it.
  const pid = spawnSync("/usr/bin/true").pid;
  const file = join(f.dataDir, "running.json");
  mkdirSync(f.dataDir, { recursive: true });
  for (const [engine, token] of [
    ["claw", "c".repeat(64)],
    ["legacy", "d".repeat(64)],
    [undefined, "e".repeat(64)],
  ]) {
    const instance = "f".repeat(32);
    const calls = [];
    const server = createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.statusCode = 401;
        return res.end();
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ instance, project: p.project, status: "running", execution: "ready" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const content = JSON.stringify({
      version: 1,
      ...(engine ? { engine } : {}),
      project: p.project,
      pid,
      port: server.address().port,
      token,
      instance,
    });
    writeFileSync(file, content);
    try {
      const shown = await status(p);
      assert.equal(shown.status, "running", String(engine));
      assert.equal(shown.engine, engine ?? "legacy");
      await assert.rejects(start(p, 0), { code: "ENGINE_MISMATCH" });
      await assert.rejects(monitor(p), { code: "ENGINE_MISMATCH" });
      if (appleSilicon) {
        let prepared = 0;
        await assert.rejects(
          up({ project: f.project, dataDir: f.data, open: false }, async () => prepared++),
          { code: "ENGINE_MISMATCH" },
        );
        assert.equal(prepared, 0, "a refusal installs nothing");
      }
      assert.equal(readFileSync(file, "utf8"), content, "nothing was started over it");
      assert.equal(existsSync(join(f.dataDir, "lean")), false);
      // The legacy engine also left its operator capability next to the state.
      const operator = join(f.dataDir, `operator-${instance}.json`);
      writeFileSync(operator, JSON.stringify({ instance, token: "9".repeat(64) }), { mode: 0o600 });
      assert.equal((await stop(p)).status, "stopped");
      assert.ok(calls.includes("POST /__pazmo/stop"), String(engine));
      assert.equal(existsSync(file), false);
      assert.equal(existsSync(operator), false, "the stopped Office's operator file went with it");
    } finally {
      rmSync(file, { force: true });
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

// `up` reuses a running Office that can execute: its claude jobs start the
// tool bridge from disk, so the root dependencies are put in place first. A
// refusal installs nothing, and a failed install reuses nothing.
test(
  "up prepares the root dependencies before it reuses a running Office, never for a refusal",
  { skip: !appleSilicon && "up runs on Apple Silicon macOS only" },
  async (t) => {
    const { locate } = await import("../src/cli/project.ts");
    const { up } = await import("../src/cli/launcher.ts");
    const f = setup(t);
    const p = locate(f.project, f.data);
    const pid = spawnSync("/usr/bin/true").pid;
    const file = join(f.dataDir, "running.json");
    mkdirSync(f.dataDir, { recursive: true });
    const token = "a".repeat(64),
      instance = "b".repeat(32);
    for (const execution of ["ready", "locked"]) {
      const calls = [];
      const server = createServer((req, res) => {
        calls.push(`${req.method} ${req.url}`);
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.statusCode = 401;
          return res.end();
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ instance, project: p.project, status: "running", execution }));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const content = JSON.stringify({
        version: 1,
        engine: "lean",
        project: p.project,
        pid,
        port: server.address().port,
        token,
        instance,
      });
      writeFileSync(file, content);
      try {
        const options = { project: f.project, dataDir: f.data, open: false };
        const order = [];
        const prepare = async () => order.push("prepare");
        if (execution === "ready") {
          const reused = await up(options, prepare);
          assert.equal(reused.reused, true);
          assert.equal(reused.url, `http://127.0.0.1:${server.address().port}/`);
          assert.deepEqual(order, ["prepare"], "installed once, before the Office was reused");
          // A failed install reuses nothing and touches nothing.
          const failing = async () => {
            throw Object.assign(new Error("npm ci: offline"), { code: "SETUP_FAILED" });
          };
          await assert.rejects(up(options, failing), { code: "SETUP_FAILED" });
        } else {
          await assert.rejects(up(options, prepare), { code: "RUNNING" });
          assert.deepEqual(order, [], "a refusal installs nothing");
        }
        assert.ok(!calls.includes("POST /__pazmo/stop"), "the running Office was never stopped");
        assert.equal(readFileSync(file, "utf8"), content);
      } finally {
        rmSync(file, { force: true });
        await new Promise((resolve) => server.close(resolve));
      }
    }
  },
);
