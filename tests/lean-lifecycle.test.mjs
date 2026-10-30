import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { locate } from "../src/cli/project.ts";
import { STARTUP_MS, start, vendorInstalled } from "../src/cli/lifecycle.ts";
import { assertOfficesExited, officePid } from "./office-process.mjs";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const service = new URL("../src/runtime/lean-service.ts", import.meta.url).pathname;
const slowStart = new URL("./lean-service-slow-start.mjs", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the CLI against a temp project and data dir; returns the JSON it printed.
 * The limit is a minute above what start --claw may wait for its Office, so a
 * slow start under load is reported by start itself; killing the CLI half way
 * would leave its start lock behind and an Office no state file records. */
function call(f, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--project", f.project, "--data-dir", f.data], {
    encoding: "utf8",
    timeout: STARTUP_MS.claw + 60000,
  });
  return { status: r.status, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}

/** A temp git project and data dir. Whatever Office it started is stopped, and
 * every started process must be gone, even when the test failed half way. */
function setup(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-lean-life-")));
  const f = { root, project: join(root, "project"), data: join(root, "data") };
  mkdirSync(f.project);
  execFileSync("git", ["init", "-q", f.project]);
  // The per-project data directory the CLI derives under --data-dir.
  f.dataDir = locate(f.project, f.data).dataDir;
  t.after(async () => {
    const pids = existsSync(join(f.dataDir, "running.json")) ? [officePid(f.dataDir)] : [];
    call(f, "stop");
    await assertOfficesExited(pids);
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(call(f, "init", "--apply").status, 0);
  return f;
}
const commandLine = (pid) => execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();

test("start --lean runs the lean engine on its own data, without the vendor loader", async (t) => {
  const f = setup(t);
  const started = call(f, "start", "--lean", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.equal(started.value.engine, "lean");
  assert.equal(started.value.execution, "locked");
  const dataDir = f.dataDir;
  const state = JSON.parse(readFileSync(join(dataDir, "running.json"), "utf8"));
  assert.equal(state.engine, "lean");

  const status = call(f, "status");
  assert.equal(status.status, 0);
  assert.equal(status.value.status, "running");
  assert.equal(status.value.engine, "lean");
  assert.equal(status.value.url, `http://127.0.0.1:${state.port}`);

  // Plain node on the service file: no tsx loader, no vendor path.
  const line = commandLine(state.pid);
  assert.match(line, /src\/runtime\/lean-service\.ts/);
  assert.doesNotMatch(line, /tsx/);
  assert.doesNotMatch(line, /--import/);
  assert.doesNotMatch(line, /vendor/);

  // Its own file, private; the Claw directory is neither read nor written.
  const sqlite = join(dataDir, "lean", "office.sqlite");
  assert.equal(existsSync(sqlite), true);
  assert.equal(statSync(sqlite).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dataDir, "claw")), false);

  // monitor is the local session: no viewer token is minted for lean.
  const monitor = call(f, "monitor");
  assert.equal(monitor.status, 0, JSON.stringify(monitor.value));
  assert.deepEqual(monitor.value, { url: `http://127.0.0.1:${state.port}/`, access: "local-session" });
  const session = await fetch(`${monitor.value.url}api/session`, {
    headers: { Host: `127.0.0.1:${state.port}` },
  });
  assert.equal(session.status, 200);
  assert.match((await session.json()).csrf, /^[a-f0-9]{64}$/);
  assert.match(session.headers.get("set-cookie") ?? "", /HttpOnly/);
  // The API is not open without that session.
  assert.equal((await fetch(`${monitor.value.url}api/board`)).status, 401);

  // The lean Office has no operator API: the key is not handed out.
  const key = call(f, "operator-key");
  assert.equal(key.status, 1);
  assert.equal(key.value.code, "UNSUPPORTED");

  // Same engine: start is idempotent and reports the running Office.
  const again = call(f, "start", "--lean");
  assert.equal(again.status, 0, JSON.stringify(again.value));
  assert.equal(again.value.engine, "lean");
  assert.equal(again.value.url, started.value.url);

  const stopped = call(f, "stop");
  assert.equal(stopped.status, 0, JSON.stringify(stopped.value));
  assert.equal(stopped.value.status, "stopped");
  await assertOfficesExited([state.pid]);
  assert.equal(existsSync(join(dataDir, "running.json")), false);
  assert.equal(call(f, "status").value.status, "stopped");
  // The data stays for the next start.
  assert.equal(existsSync(sqlite), true);
});

test("start --lean without the vendor dependencies refuses with NOT_INSTALLED before it starts anything", async (t) => {
  const f = setup(t);
  const p = locate(f.project, f.data);
  let checked = 0;
  const missing = () => {
    checked++;
    return false;
  };
  await assert.rejects(start(p, 0, undefined, "lean", { installed: missing }), {
    code: "NOT_INSTALLED",
    message: "Office 의존성이 설치되지 않았습니다. ./office --lean 으로 설치하세요.",
  });
  assert.equal(checked, 1);
  assert.equal(existsSync(join(f.dataDir, "start.lock")), false, "no start lock was taken");
  assert.equal(existsSync(join(f.dataDir, "running.json")), false, "nothing was started");
  assert.equal(existsSync(join(f.dataDir, "office.log")), false);
  assert.equal(call(f, "status").value.status, "stopped");
  // This checkout has them: the real check finds vendor ws the way exec-relay.ts loads it.
  assert.equal(vendorInstalled(), true);
});

test("a running legacy Office refuses start --lean, and a running lean Office refuses start and start --claw", async (t) => {
  const f = setup(t);
  const stopOffice = async () => {
    const pid = officePid(f.dataDir);
    assert.equal(call(f, "stop").status, 0);
    await assertOfficesExited([pid]);
  };
  const legacy = call(f, "start", "--port", "0");
  assert.equal(legacy.status, 0, JSON.stringify(legacy.value));
  assert.equal(legacy.value.engine, "legacy");
  const refused = call(f, "start", "--lean", "--port", "0");
  assert.equal(refused.status, 1);
  assert.equal(refused.value.code, "ENGINE_MISMATCH");
  const dataDir = f.dataDir;
  assert.equal(existsSync(join(dataDir, "lean")), false, "the refused start created no lean data");
  assert.equal(call(f, "status").value.engine, "legacy", "the refused start left the legacy Office running");
  await stopOffice();

  const lean = call(f, "start", "--lean", "--port", "0");
  assert.equal(lean.status, 0, JSON.stringify(lean.value));
  for (const flags of [[], ["--claw"]]) {
    const other = call(f, "start", ...flags, "--port", "0");
    assert.equal(other.status, 1, flags.join(" "));
    assert.equal(other.value.code, "ENGINE_MISMATCH");
  }
  assert.equal(call(f, "status").value.engine, "lean");
  await stopOffice();
  assert.equal(existsSync(join(dataDir, "claw")), false);
});

// `up` reaches its engine check before any VM, vendor or login step, so it can
// be exercised against a running Office without starting anything of its own.
const appleSilicon = process.platform === "darwin" && process.arch === "arm64";
test(
  "up refuses a running Office of another engine, in both directions, and never stops it",
  { skip: !appleSilicon && "up runs on Apple Silicon macOS only" },
  async (t) => {
    const f = setup(t);
    const stopOffice = async () => {
      const pid = officePid(f.dataDir);
      assert.equal(call(f, "stop").status, 0);
      await assertOfficesExited([pid]);
    };
    const running = (engine) => {
      const status = call(f, "status");
      assert.equal(status.value.status, "running");
      assert.equal(status.value.engine, engine, "the running Office was not touched");
    };
    const lean = call(f, "start", "--lean", "--port", "0");
    assert.equal(lean.status, 0, JSON.stringify(lean.value));
    // Plain up wants Claw: it is told to stop the lean Office, which keeps running.
    const claw = call(f, "up", "--no-open");
    assert.equal(claw.status, 1);
    assert.equal(claw.value.code, "ENGINE_MISMATCH");
    assert.match(claw.value.error, /Stop the current Office/);
    running("lean");
    // The same engine that cannot execute (a preview) is not reused: RUNNING, as before.
    const same = call(f, "up", "--lean", "--no-open");
    assert.equal(same.status, 1);
    assert.equal(same.value.code, "RUNNING");
    running("lean");
    await stopOffice();

    const native = call(f, "start", "--claw", "--port", "0");
    assert.equal(native.status, 0, JSON.stringify(native.value));
    const other = call(f, "up", "--lean", "--no-open");
    assert.equal(other.status, 1);
    assert.equal(other.value.code, "ENGINE_MISMATCH");
    assert.match(other.value.error, /Stop the current Office/);
    running("claw");
    await stopOffice();
  },
);

test("--lean is for start and up only and cannot be combined with --claw", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-lean-args-")));
  try {
    const project = join(root, "project");
    mkdirSync(project);
    const run = (...args) => {
      const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000 });
      return { status: r.status, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
    };
    const base = ["--project", project, "--data-dir", join(root, "data")];
    for (const args of [
      ["start", "--lean", "--claw", ...base],
      ["start", "--claw", "--lean", ...base],
      ["up", "--lean", "--claw", ...base],
      ["status", "--lean", ...base],
      ["stop", "--lean", ...base],
      ["monitor", "--lean", ...base],
    ]) {
      const result = run(...args);
      assert.equal(result.status, 1, args.join(" "));
      assert.equal(result.value.code, "ARGUMENT", args.join(" "));
    }
    // up accepts --lean: with no project it stops at PROJECT_REQUIRED (or PLATFORM
    // off Apple Silicon), before touching the VM, the vendor tree or any process.
    const up = run("up", "--lean", "--no-open", "--data-dir", join(root, "data"));
    assert.equal(up.status, 1);
    assert.ok(["PROJECT_REQUIRED", "PLATFORM"].includes(up.value.code), up.value.code);
    assert.equal(existsSync(join(root, "data")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the help text names the lean option", () => {
  const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /start --lean/);
  assert.match(r.stdout, /up --lean/);
});

// The service itself, as a child with the IPC channel the launcher uses.

/** A temp directory whose services are killed, and awaited, before it is removed. */
function scratch(t, prefix = "pazmo-lean-svc-") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const services = [];
  t.after(async () => {
    for (const { child, exited } of services) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, services };
}
function config(root, extra = {}) {
  const project = join(root, "project"),
    dataDir = join(root, "data");
  mkdirSync(project, { recursive: true });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    project,
    dataDir,
    port: 0,
    token: randomBytes(32).toString("hex"),
    instance: randomBytes(16).toString("hex"),
    operatorToken: randomBytes(32).toString("hex"),
    ...extra,
  };
}
/** Spawns the service and sends it `c`. `first` is its first reply (rejected if it
 * exits without one); `finished()` resolves with how it ended, within 10 s. */
function launch(s, c, { args = [], env = {} } = {}) {
  mkdirSync(join(s.root, "home"), { recursive: true });
  mkdirSync(join(s.root, "tmp"), { recursive: true });
  const child = spawn(process.execPath, [...args, service], {
    cwd: s.root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      PATH: dirname(process.execPath),
      HOME: join(s.root, "home"),
      TMPDIR: join(s.root, "tmp"),
      LANG: "en_US.UTF-8",
      ...env,
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.resume();
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  s.services.push({ child, exited });
  const first = new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("exit", () => reject(new Error(`exited before replying: ${stderr}`)));
  });
  first.catch(() => {}); // a service stopped during its start never replies
  child.send(c);
  return {
    child,
    first,
    stderr: () => stderr,
    finished: () =>
      Promise.race([exited, sleep(10000).then(() => Promise.reject(new Error(`still running after 10 s: ${stderr}`)))]),
  };
}
/** Launches the service and waits for its first reply. */
async function boot(s, c, options) {
  const svc = launch(s, c, options);
  svc.first = await Promise.race([svc.first, sleep(15000).then(() => Promise.reject(new Error("no reply in 15 s")))]);
  return svc;
}
const lifecycle = (port, c, path, method) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${c.token}` } });

test("the service answers ready on its port, then closes once on SIGTERM however many arrive", async (t) => {
  const s = scratch(t);
  const c = config(s.root);
  const svc = await boot(s, c);
  assert.equal(svc.first.type, "ready");
  assert.ok(Number.isInteger(svc.first.port) && svc.first.port > 0);
  const status = await lifecycle(svc.first.port, c, "/__pazmo/status", "GET");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    execution: "locked",
    active: [],
    instance: c.instance,
    project: c.project,
    status: "running",
    engine: "lean",
  });
  for (let i = 0; i < 5; i++) {
    try {
      process.kill(svc.child.pid, "SIGTERM");
    } catch {
      break; // already gone: the first signal finished the job
    }
    await sleep(1);
  }
  const { code, signal } = await svc.finished();
  assert.equal(signal, null, "a second SIGTERM must not kill the process while it closes");
  assert.equal(code, 0);
  assert.equal(svc.stderr(), "");
  assert.equal(existsSync(join(c.dataDir, "claw")), false);
});

test("a stop request followed by SIGTERM exits cleanly once", async (t) => {
  const s = scratch(t);
  const c = config(s.root);
  const svc = await boot(s, c);
  assert.equal(svc.first.type, "ready");
  // Refused without the Bearer; the Office keeps running.
  const denied = await fetch(`http://127.0.0.1:${svc.first.port}/__pazmo/stop`, { method: "POST" });
  assert.equal(denied.status, 401);
  const stop = await lifecycle(svc.first.port, c, "/__pazmo/stop", "POST");
  assert.equal(stop.status, 200);
  assert.deepEqual(await stop.json(), { instance: c.instance, project: c.project, status: "stopping" });
  try {
    process.kill(svc.child.pid, "SIGTERM");
  } catch {
    // Already exited on the stop request.
  }
  const { code, signal } = await svc.finished();
  assert.equal(signal, null);
  assert.equal(code, 0);
  assert.equal(svc.stderr(), "");
});

test("an invalid start message is answered with an error and the process exits non-zero", async (t) => {
  const s = scratch(t);
  for (const bad of [{ token: "short" }, { instance: "short" }, { port: 70000 }, { port: 1.5 }]) {
    const svc = await boot(s, config(s.root, bad));
    assert.equal(svc.first.type, "error", JSON.stringify(bad));
    assert.equal(svc.first.error, "INVALID_HOST_CONFIG");
    const { code } = await svc.finished();
    assert.equal(code, 1);
  }
  assert.equal(existsSync(join(s.root, "data", "lean")), false, "nothing is created for a refused message");
});

test("a start that cannot listen closes what it opened and exits non-zero", async (t) => {
  const a = scratch(t, "pazmo-lean-svc-a-");
  const b = scratch(t, "pazmo-lean-svc-b-");
  const first = await boot(a, config(a.root));
  assert.equal(first.first.type, "ready");
  const second = await boot(b, config(b.root, { port: first.first.port }));
  assert.equal(second.first.type, "error");
  assert.match(second.first.error, /EADDRINUSE/);
  assert.equal((await second.finished()).code, 1);
  // The first Office was not disturbed: it still closes on its own SIGTERM.
  first.child.kill("SIGTERM");
  assert.equal((await first.finished()).code, 0);
});

test("a database that belongs to another project is refused and the service exits non-zero", async (t) => {
  const s = scratch(t);
  const c = config(s.root);
  const one = await boot(s, c);
  assert.equal(one.first.type, "ready");
  one.child.kill("SIGTERM");
  assert.equal((await one.finished()).code, 0);
  const other = join(s.root, "other");
  mkdirSync(other);
  const refused = await boot(s, { ...c, project: other, token: randomBytes(32).toString("hex") });
  assert.equal(refused.first.type, "error");
  assert.match(refused.first.error, /does not belong/);
  assert.equal((await refused.finished()).code, 1);
});

// A SIGTERM that arrives while a start step is still running. The preload
// (tests/lean-service-slow-start.mjs) makes one step take 1.5 s and logs what
// happens to the office and the server, so the order is observable.
const BEGIN_STOP_AND_CLOSE = ["office:beginStop", "office:close", "office:closed"];
const DURING_START = {
  office: [
    "office:begin",
    "office:end",
    "office:created",
    ...BEGIN_STOP_AND_CLOSE,
  ],
  ensureDefault: [
    "office:created",
    "ensureDefault:called",
    "ensureDefault:begin",
    "ensureDefault:end",
    ...BEGIN_STOP_AND_CLOSE,
  ],
  // The server closes before the office, as at any other shutdown.
  server: [
    "office:created",
    "server:begin",
    "server:end",
    "server:listening",
    "office:beginStop",
    "server:close",
    "server:closed",
    "office:close",
    "office:closed",
  ],
};
for (const step of Object.keys(DURING_START)) {
  test(`a SIGTERM during the ${step} start step lets it finish, closes what was opened and exits 0`, async (t) => {
    const s = scratch(t);
    const events = join(s.root, "events.log");
    writeFileSync(events, "");
    const lines = () => readFileSync(events, "utf8").split("\n").filter(Boolean);
    // The ensureDefault step only runs for a live start; the preload swaps in a
    // stand-in office, so a placeholder live config is all the service sees.
    const c = config(s.root, step === "ensureDefault" ? { live: {} } : {});
    const svc = launch(s, c, {
      args: ["--import", slowStart],
      env: { LEAN_TEST_SLOW: step, LEAN_TEST_EVENTS: events },
    });
    const deadline = Date.now() + 10000;
    while (!lines().includes(`${step}:begin`)) {
      assert.ok(Date.now() < deadline, `the ${step} step never began: ${svc.stderr()}`);
      await sleep(5);
    }
    process.kill(svc.child.pid, "SIGTERM");
    const { code, signal } = await svc.finished();
    assert.deepEqual(lines(), DURING_START[step]);
    assert.equal(signal, null);
    assert.equal(code, 0);
    assert.equal(svc.stderr(), "");
  });
}
