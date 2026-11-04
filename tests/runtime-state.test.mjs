import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { STARTUP_MS, start, status, stop } from "../src/cli/lifecycle.ts";
import { locate } from "../src/cli/project.ts";
import { writeMacLink } from "../src/team/mac.ts";
import { teamDir } from "../src/team/registry.ts";
import { assertOfficesExited } from "./office-process.mjs";

// Runtime state an Office leaves when its process ends without `stop`: a
// logout, reboot, crash or SIGKILL of the service, or a signal to a `start`
// still under way. A service removes its own state as it shuts down; a saved
// state or start lock whose process is gone is stale and cleared; one whose
// process may still be alive is kept, as before.

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const stalled = new URL("./lifecycle-stalled-service.mjs", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A pid that no longer exists. */
const deadPid = () => spawnSync("/usr/bin/true").pid;
/** A loopback port nothing listens on. */
async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Runs the CLI; returns its exit status and the JSON it printed. */
function run(args, env = process.env) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: STARTUP_MS.lean + 60000, env });
  return { status: r.status, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}

/** A temp git project set up for a lean Office. Whatever Office it started is stopped, and gone. */
function lean(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-state-")));
  const f = { root, project: join(root, "project"), data: join(root, "data") };
  mkdirSync(f.project);
  execFileSync("git", ["init", "-q", f.project]);
  f.call = (...args) => run([...args, "--project", f.project, "--data-dir", f.data]);
  assert.equal(f.call("init", "--apply").status, 0);
  f.p = locate(f.project, f.data);
  f.dataDir = f.p.dataDir;
  f.running = join(f.dataDir, "running.json");
  f.lock = join(f.dataDir, "start.lock");
  t.after(async () => {
    const pids = existsSync(f.running) ? [JSON.parse(readFileSync(f.running, "utf8")).pid] : [];
    f.call("stop");
    await assertOfficesExited(pids);
    rmSync(root, { recursive: true, force: true });
  });
  return f;
}

/** Writes a saved state for `pid` on `port`, and its operator file; returns its instance. */
function saveState(f, { pid, port, instance = "b".repeat(32) }) {
  mkdirSync(f.dataDir, { recursive: true });
  writeFileSync(
    f.running,
    JSON.stringify({ version: 1, engine: "lean", project: f.p.project, pid, port, token: "a".repeat(64), instance }),
  );
  writeFileSync(join(f.dataDir, `operator-${instance}.json`), "{}");
  return instance;
}

/** A start lock as a start of this version leaves it: the directory with its maker's pid. */
function saveLock(f, pid) {
  mkdirSync(f.lock, { recursive: true });
  if (pid !== undefined) writeFileSync(join(f.lock, "pid"), String(pid));
}

test("a saved state whose process is gone is stale: status and stop clear it and report stopped", async (t) => {
  const f = lean(t);
  for (const action of ["status", "stop"]) {
    const instance = saveState(f, { pid: deadPid(), port: await closedPort() });
    const result = action === "status" ? await status(f.p) : await stop(f.p);
    assert.equal(result.status, "stopped", action);
    assert.equal(existsSync(f.running), false, `${action} cleared the saved state`);
    assert.equal(existsSync(join(f.dataDir, `operator-${instance}.json`)), false, `${action} cleared its operator file`);
    assert.equal(existsSync(f.lock), false, `${action} released the start lock it cleared under`);
  }
  assert.equal(f.call("status").value.status, "stopped");
});

test("a saved state whose process is gone does not stop a fresh start", async (t) => {
  const f = lean(t);
  const stale = saveState(f, { pid: deadPid(), port: await closedPort() });
  const started = await start(f.p, 0);
  assert.equal(started.status, "running");
  const state = JSON.parse(readFileSync(f.running, "utf8"));
  assert.notEqual(state.instance, stale, "the new Office's own state");
  assert.equal(existsSync(join(f.dataDir, `operator-${stale}.json`)), false);
  assert.equal((await stop(f.p)).status, "stopped");
  await assertOfficesExited([state.pid]);
});

test("a saved state whose process may still be alive stays unknown and is preserved", async (t) => {
  const f = lean(t);
  // This test process (alive), and launchd (alive, another user's: EPERM).
  for (const pid of [process.pid, 1]) {
    saveState(f, { pid, port: await closedPort() });
    const content = readFileSync(f.running, "utf8");
    try {
      assert.equal((await status(f.p)).status, "unknown", String(pid));
      await assert.rejects(stop(f.p), { code: "UNKNOWN" });
      await assert.rejects(start(f.p, 0), { code: "UNKNOWN" });
      assert.equal(readFileSync(f.running, "utf8"), content, "nothing was changed");
      assert.equal(existsSync(f.lock), false);
    } finally {
      // setup's cleanup would otherwise wait for this pid.
      rmSync(f.running, { force: true });
    }
  }
});

test("a stale saved state is kept while a live process holds the start lock", async (t) => {
  const f = lean(t);
  saveLock(f, process.pid);
  saveState(f, { pid: deadPid(), port: await closedPort() });
  const content = readFileSync(f.running, "utf8");
  assert.equal((await status(f.p)).status, "unknown");
  await assert.rejects(stop(f.p), { code: "UNKNOWN" });
  assert.equal(readFileSync(f.running, "utf8"), content);
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), String(process.pid), "the holder's lock was not touched");
  rmSync(f.lock, { recursive: true });
  assert.equal((await status(f.p)).status, "stopped", "cleared once the lock is free");
  assert.equal(existsSync(f.running), false);
});

test("a start lock whose maker is gone is stale; a live or pid-less one still blocks", async (t) => {
  const f = lean(t);
  saveLock(f, deadPid());
  assert.deepEqual(await status(f.p), { status: "stopped", execution: "locked" });
  assert.equal(existsSync(f.lock), false, "status removed the stale lock");
  saveLock(f, deadPid());
  assert.equal((await stop(f.p)).status, "stopped");
  assert.equal(existsSync(f.lock), false, "stop removed the stale lock");
  saveLock(f, deadPid());
  const started = await start(f.p, 0);
  assert.equal(started.status, "running");
  const pid = JSON.parse(readFileSync(f.running, "utf8")).pid;
  assert.equal(existsSync(f.lock), false, "start released the lock it took over");
  assert.equal((await stop(f.p)).status, "stopped");
  await assertOfficesExited([pid]);

  // A pid-less lock is an earlier version's, or one being made this instant.
  for (const holder of [process.pid, undefined]) {
    saveLock(f, holder);
    assert.equal((await status(f.p)).status, "unknown", String(holder));
    await assert.rejects(stop(f.p), { code: "UNKNOWN" });
    await assert.rejects(start(f.p, 0), { code: "UNKNOWN" });
    assert.ok(existsSync(f.lock), "the lock is kept");
    rmSync(f.lock, { recursive: true });
  }
});

/** SIGTERMs the Office a CLI start recorded and waits for it to exit; returns the state it had. */
async function terminate(running) {
  const state = JSON.parse(readFileSync(running, "utf8"));
  process.kill(state.pid, "SIGTERM");
  await assertOfficesExited([state.pid], 15000);
  return state;
}

test("the lean service removes its own saved state when it shuts down, never another instance's", async (t) => {
  const f = lean(t);
  assert.equal(f.call("start", "--port", "0").status, 0);
  const own = JSON.parse(readFileSync(f.running, "utf8"));
  writeFileSync(join(f.dataDir, `operator-${own.instance}.json`), "{}");
  await terminate(f.running);
  assert.equal(existsSync(f.running), false, "its state went with it");
  assert.equal(existsSync(join(f.dataDir, `operator-${own.instance}.json`)), false);
  assert.equal(f.call("status").value.status, "stopped");

  assert.equal(f.call("start", "--port", "0").status, 0);
  const state = JSON.parse(readFileSync(f.running, "utf8"));
  const replaced = JSON.stringify({ ...state, instance: "c".repeat(32) });
  writeFileSync(f.running, replaced);
  try {
    await terminate(f.running);
    assert.equal(readFileSync(f.running, "utf8"), replaced, "another instance's state is kept");
  } finally {
    rmSync(f.running, { force: true });
  }
});

test("the team service removes its own saved state when it shuts down, never another instance's", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-state-team-")));
  const data = join(root, "data"),
    home = join(root, "home");
  mkdirSync(home);
  const env = { ...process.env, HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  const call = (...args) => run([...args, "--data-dir", data], env);
  const running = join(teamDir(data), "running.json");
  t.after(async () => {
    const pids = existsSync(running) ? [JSON.parse(readFileSync(running, "utf8")).pid] : [];
    call("stop", "--team");
    await assertOfficesExited(pids);
    rmSync(root, { recursive: true, force: true });
  });
  // A Mac link lets it start with no repo; nobody listens on port 1, so its Hub calls fail on this machine.
  writeMacLink(data, {
    version: 1,
    hub: "https://127.0.0.1:1",
    macId: "mac-1",
    macToken: "T".repeat(43),
    memberId: "m1",
    memberName: "김",
    name: "내 Mac",
  });
  const first = call("start", "--team", "--port", "0");
  assert.equal(first.status, 0, JSON.stringify(first.value));
  const own = JSON.parse(readFileSync(running, "utf8"));
  writeFileSync(join(teamDir(data), `operator-${own.instance}.json`), "{}");
  await terminate(running);
  assert.equal(existsSync(running), false, "its state went with it");
  assert.equal(existsSync(join(teamDir(data), `operator-${own.instance}.json`)), false);
  assert.equal(call("status", "--team").value.status, "stopped");

  const again = call("start", "--team", "--port", "0");
  assert.equal(again.status, 0, JSON.stringify(again.value));
  const state = JSON.parse(readFileSync(running, "utf8"));
  const replaced = JSON.stringify({ ...state, instance: "c".repeat(32) });
  writeFileSync(running, replaced);
  try {
    await terminate(running);
    assert.equal(readFileSync(running, "utf8"), replaced, "another instance's state is kept");
  } finally {
    rmSync(running, { force: true });
  }
});

/** Runs `start` through the CLI with the stalled service; resolves once that service waits for its ready. */
async function stalledStart(f) {
  const log = join(f.dataDir, "office.log");
  const before = existsSync(log) ? readFileSync(log, "utf8").length : 0;
  const child = spawn(
    process.execPath,
    ["--import", stalled, cli, "start", "--port", "0", "--project", f.project, "--data-dir", f.data],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const since = () => (existsSync(log) ? readFileSync(log, "utf8").slice(before) : "");
  const deadline = Date.now() + 15000;
  let waiting;
  while (!(waiting = /stalled-service: waiting (\d+)/.exec(since()))) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`the stalled service never started: ${stderr}`);
    }
    await sleep(20);
  }
  return { child, exited, stderr: () => stderr, since, service: Number(waiting[1]) };
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`a start interrupted by ${signal} stops its service, leaves no start lock and exits non-zero`, async (t) => {
    const f = lean(t);
    const s = await stalledStart(f);
    t.after(() => {
      s.child.kill("SIGKILL");
      return assertOfficesExited([s.service]);
    });
    assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), String(s.child.pid), "the lock names its maker");
    s.child.kill(signal);
    const { code, signal: killedBy } = await s.exited;
    assert.equal(killedBy, null, "start handled the signal");
    assert.notEqual(code, 0);
    assert.equal(JSON.parse(s.stderr().trim().split("\n").at(-1)).code, "INTERRUPTED");
    assert.equal(existsSync(f.lock), false, "no start lock is left");
    assert.equal(existsSync(f.running), false, "nothing was recorded as running");
    await assertOfficesExited([s.service]);
    assert.match(s.since(), /stalled-service: SIGTERM/, "start stopped the service it spawned");
    assert.equal(f.call("status").value.status, "stopped");
  });
}

test("a start killed outright leaves its lock, which the next status finds stale and clears", async (t) => {
  const f = lean(t);
  const s = await stalledStart(f);
  t.after(() => {
    s.child.kill("SIGKILL");
    return assertOfficesExited([s.service]);
  });
  s.child.kill("SIGKILL");
  await s.exited;
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), String(s.child.pid), "the killed start's lock");
  process.kill(s.service, "SIGTERM");
  await assertOfficesExited([s.service]);
  assert.deepEqual(await status(f.p), { status: "stopped", execution: "locked" });
  assert.equal(existsSync(f.lock), false);
});
