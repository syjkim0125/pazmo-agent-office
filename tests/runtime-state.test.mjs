import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { STARTUP_MS, start, status, stop } from "../src/cli/lifecycle.ts";
import { locate } from "../src/cli/project.ts";
import { writeMacLink } from "../src/team/mac.ts";
import { teamDir, teamRunning } from "../src/team/registry.ts";
import { assertOfficesExited } from "./office-process.mjs";

// Runtime state an Office leaves when its process ends without `stop`: a
// logout, reboot, crash or SIGKILL of the service, or a signal to a `start`
// still under way. A service removes its own state as it shuts down; a saved
// state or start lock whose process is gone is stale and cleared; one whose
// process may still be alive is kept, as before.

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const stalled = new URL("./lifecycle-stalled-service.mjs", import.meta.url).pathname;
const leanService = new URL("../src/runtime/lean-service.ts", import.meta.url).pathname;
const slowStart = new URL("./lean-service-slow-start.mjs", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A pid that no longer exists. */
const deadPid = () => spawnSync("/usr/bin/true").pid;
/** This boot session, as the lifecycle records it (macOS kern.bootsessionuuid, Linux boot_id); undefined without one. */
const thisBoot = (() => {
  try {
    const raw =
      process.platform === "darwin"
        ? execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" })
        : readFileSync("/proc/sys/kernel/random/boot_id", "utf8");
    return raw.trim() || undefined;
  } catch {
    return undefined;
  }
})();
/** Another boot's session: what a file a crash or power loss left behind names after the reboot. */
const otherBoot = "00000000-0000-4000-8000-000000000000";
const withBoot = { skip: !thisBoot && "this machine has no boot session id" };
/** What a start lock's pid file holds: its maker's pid, then this boot's session. */
const lockText = (pid) => (thisBoot ? `${pid}\n${thisBoot}` : String(pid));
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
    // A state a failed test left naming this process or launchd is not an Office to wait for (or kill).
    const pids = existsSync(f.running)
      ? [JSON.parse(readFileSync(f.running, "utf8")).pid].filter((pid) => pid > 1 && pid !== process.pid)
      : [];
    f.call("stop");
    await assertOfficesExited(pids);
    rmSync(root, { recursive: true, force: true });
  });
  return f;
}

/** Writes a saved state for `pid` on `port` (from `boot`, if given), and its operator file; returns its instance. */
function saveState(f, { pid, port, instance = "b".repeat(32), boot }) {
  mkdirSync(f.dataDir, { recursive: true });
  writeFileSync(
    f.running,
    JSON.stringify({
      version: 1,
      engine: "lean",
      project: f.p.project,
      pid,
      port,
      token: "a".repeat(64),
      instance,
      ...(boot ? { boot } : {}),
    }),
  );
  writeFileSync(join(f.dataDir, `operator-${instance}.json`), "{}");
  return instance;
}

/** A start lock: the directory with its maker's pid (and its boot, if given), or none. */
function saveLock(f, pid, boot) {
  mkdirSync(f.lock, { recursive: true });
  if (pid !== undefined) writeFileSync(join(f.lock, "pid"), boot ? `${pid}\n${boot}` : String(pid));
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
    assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), lockText(s.child.pid), "the lock names its maker and this boot");
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
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), lockText(s.child.pid), "the killed start's lock");
  process.kill(s.service, "SIGTERM");
  await assertOfficesExited([s.service]);
  assert.deepEqual(await status(f.p), { status: "stopped", execution: "locked" });
  assert.equal(existsSync(f.lock), false);
});

// After a crash, power loss or panic the old pid often names a live login
// process: macOS hands out pids from 1 again at every boot. A state or lock from
// another boot is stale whatever that pid names now.
test("a saved state or start lock from another boot is stale whatever its pid names now", withBoot, async (t) => {
  const f = lean(t);
  for (const action of ["status", "stop"]) {
    // This test process stands in for the login process that got the old pid.
    const instance = saveState(f, { pid: process.pid, port: await closedPort(), boot: otherBoot });
    try {
      const result = action === "status" ? await status(f.p) : await stop(f.p);
      assert.equal(result.status, "stopped", action);
      assert.equal(existsSync(f.running), false, `${action} cleared it`);
      assert.equal(existsSync(join(f.dataDir, `operator-${instance}.json`)), false);
    } finally {
      rmSync(f.running, { force: true });
    }
  }
  saveLock(f, process.pid, otherBoot);
  assert.deepEqual(await status(f.p), { status: "stopped", execution: "locked" });
  assert.equal(existsSync(f.lock), false, "the lock from another boot was removed");
});

test("start records this boot in its saved state; one from this boot with a live pid stays unknown", withBoot, async (t) => {
  const f = lean(t);
  saveState(f, { pid: process.pid, port: await closedPort(), boot: otherBoot });
  assert.equal((await start(f.p, 0)).status, "running");
  const state = JSON.parse(readFileSync(f.running, "utf8"));
  assert.equal(state.boot, thisBoot);
  assert.equal((await stop(f.p)).status, "stopped");
  await assertOfficesExited([state.pid]);

  saveState(f, { pid: process.pid, port: await closedPort(), boot: thisBoot });
  try {
    assert.equal((await status(f.p)).status, "unknown");
    await assert.rejects(stop(f.p), { code: "UNKNOWN" });
    await assert.rejects(start(f.p, 0), { code: "UNKNOWN" });
    assert.ok(existsSync(f.running));
  } finally {
    rmSync(f.running, { force: true });
  }
  saveLock(f, process.pid, thisBoot);
  assert.equal((await status(f.p)).status, "unknown");
  assert.ok(existsSync(f.lock), "a live lock of this boot is kept");
});

test("an UNKNOWN names the file to remove when no Office is running", async (t) => {
  const f = lean(t);
  const names = (file) => (error) => error.code === "UNKNOWN" && error.message.includes(file);
  saveState(f, { pid: process.pid, port: await closedPort() });
  try {
    assert.ok((await status(f.p)).reason.includes(f.running), "status");
    await assert.rejects(stop(f.p), names(f.running));
    await assert.rejects(start(f.p, 0), names(f.running));
    for (const text of ["not json", "{}"]) {
      writeFileSync(f.running, text);
      await assert.rejects(status(f.p), names(f.running), text);
    }
  } finally {
    rmSync(f.running, { force: true });
  }
  saveLock(f, process.pid);
  assert.ok((await status(f.p)).reason?.includes(f.lock), "status");
  await assert.rejects(stop(f.p), names(f.lock));
  await assert.rejects(start(f.p, 0), names(f.lock));
});

test("a start lock without a readable pid is stale once it is a minute old; a newer one still blocks", async (t) => {
  const f = lean(t);
  for (const text of [undefined, "not a pid"]) {
    saveLock(f);
    if (text) writeFileSync(join(f.lock, "pid"), text);
    assert.equal((await status(f.p)).status, "unknown", "its maker may be writing its pid now");
    const minuteAgo = (Date.now() - 61000) / 1000;
    utimesSync(f.lock, minuteAgo, minuteAgo);
    assert.deepEqual(await status(f.p), { status: "stopped", execution: "locked" }, String(text));
    assert.equal(existsSync(f.lock), false);
  }
});

test("teamRunning judges a start lock and a saved state by the lifecycle's rule", withBoot, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-state-registry-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = teamDir(root);
  mkdirSync(dir, { recursive: true });
  const f = { lock: join(dir, "start.lock") };
  const running = join(dir, "running.json");
  for (const [pid, boot, expected] of [
    [process.pid, thisBoot, true],
    [process.pid, undefined, true],
    [process.pid, otherBoot, false],
    [deadPid(), thisBoot, false],
    // Not a boot id at all: the pid rule only.
    [process.pid, "not-a-boot", true],
  ]) {
    saveLock(f, pid, boot);
    assert.equal(teamRunning(root), expected, `lock ${pid} ${boot}`);
    rmSync(f.lock, { recursive: true });
    writeFileSync(running, JSON.stringify({ pid, ...(boot ? { boot } : {}) }));
    assert.equal(teamRunning(root), expected, `running.json ${pid} ${boot}`);
    rmSync(running);
  }
  saveLock(f);
  assert.equal(teamRunning(root), true, "a new pid-less lock");
  const minuteAgo = (Date.now() - 61000) / 1000;
  utimesSync(f.lock, minuteAgo, minuteAgo);
  assert.equal(teamRunning(root), false, "a minute-old pid-less lock");
  assert.ok(existsSync(f.lock), "teamRunning only reads the lock");
});

test("a start releases only a start lock that still names it", async (t) => {
  const f = lean(t);
  const s = await stalledStart(f);
  t.after(() => {
    s.child.kill("SIGKILL");
    return assertOfficesExited([s.service]);
  });
  // Another process holds the lock by now; this test process stands in for it.
  writeFileSync(join(f.lock, "pid"), lockText(process.pid));
  s.child.kill("SIGTERM");
  await s.exited;
  await assertOfficesExited([s.service]);
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), lockText(process.pid), "the other holder's lock is kept");
  rmSync(f.lock, { recursive: true });
});

test("a stale start lock is moved aside before it is removed: one that turned live is put back, nothing is left", async (t) => {
  const f = lean(t);
  const { removeStaleStartLock } = await import("../src/cli/lifecycle.ts");
  const debris = () => readdirSync(f.dataDir).filter((name) => name.startsWith("start.lock."));
  // Live by the time this remover acts: another taker replaced the stale lock a moment before.
  saveLock(f, process.pid);
  assert.equal(removeStaleStartLock(f.lock), false);
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), String(process.pid), "put back as it was");
  assert.deepEqual(debris(), []);
  writeFileSync(join(f.lock, "pid"), String(deadPid()));
  assert.equal(removeStaleStartLock(f.lock), true);
  assert.equal(existsSync(f.lock), false);
  assert.deepEqual(debris(), []);
  assert.equal(removeStaleStartLock(f.lock), true, "gone already");
});

test("the lean service removes its saved state when its close begins, and again when the close runs out of time", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-state-close-")));
  const c = {
    project: join(root, "project"),
    dataDir: join(root, "data"),
    port: 0,
    token: randomBytes(32).toString("hex"),
    instance: randomBytes(16).toString("hex"),
  };
  for (const dir of [c.project, c.dataDir, join(root, "home"), join(root, "tmp")]) mkdirSync(dir, { recursive: true });
  const events = join(root, "events.log");
  writeFileSync(events, "");
  const child = spawn(process.execPath, ["--import", slowStart, leanService], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: {
      PATH: dirname(process.execPath),
      HOME: join(root, "home"),
      TMPDIR: join(root, "tmp"),
      LANG: "en_US.UTF-8",
      LEAN_TEST_SLOW: "close",
      LEAN_TEST_EVENTS: events,
    },
  });
  child.stderr.resume();
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    rmSync(root, { recursive: true, force: true });
  });
  child.send(c);
  const ready = await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("exit", () => reject(new Error("the service exited before it was ready")));
  });
  assert.equal(ready.type, "ready");
  const running = join(c.dataDir, "running.json");
  const own = JSON.stringify({ instance: c.instance });
  writeFileSync(running, own);
  child.kill("SIGTERM");
  const deadline = Date.now() + 5000;
  while (existsSync(running)) {
    assert.ok(Date.now() < deadline, "the saved state was not removed while the close hung");
    await sleep(20);
  }
  assert.equal(child.exitCode, null, "removed before the close finished: it never does");
  assert.ok(readFileSync(events, "utf8").includes("office:close"));
  // Written again meanwhile: the shutdown limit's exit removes it too.
  writeFileSync(running, own);
  const { code } = await exited;
  assert.equal(code, 1, "the shutdown limit ended it");
  assert.equal(existsSync(running), false);
});
