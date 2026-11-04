import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageRoot } from "../src/cli/project.ts";
import { STABLE_NODE, launchLogPath, stableNodePath } from "../src/team/launch-agent.ts";
import { writeMacLink } from "../src/team/mac.ts";
import {
  RESTART_HOLD_MS,
  RESTART_RETRY_MS,
  createMacWatch,
  macRestartPath,
  restartNode,
  spawnMacRestart,
} from "../src/team/mac-watch.ts";
import { teamDir } from "../src/team/registry.ts";

const FILE = {
  version: 1,
  hub: "https://pazmo-hub.apps.example.com",
  macId: "mac-1",
  macToken: "T".repeat(43),
  memberId: "m1",
  memberName: "김",
  name: "내 Mac",
};
const OTHER = { ...FILE, macId: "mac-2", macToken: "U".repeat(43) };
const RERUN = "curl -fsSL 'https://pazmo-hub.apps.example.com/install.sh' | sh";
const unauthorized = () => Object.assign(new Error("이 Mac 연결은 해제됐습니다."), { status: 401, code: "UNAUTHORIZED" });

function tempRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-mac-watch-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * A connected Mac as the watch sees it: `file` is what the link file names (null: not connected), `presence`
 * what the Office reports, `idle` whether nothing is open, `pending` what a links-only sync leaves to add or
 * remove; `beatError` / `syncError` make the next calls fail. Every call is recorded. `watch()` makes a watch
 * over the same data root (a restarted Office makes a new one).
 */
function world(t, root = tempRoot(t)) {
  mkdirSync(teamDir(root), { recursive: true, mode: 0o700 });
  const w = {
    root,
    file: FILE,
    clock: 1_700_000_000_000,
    presence: { state: "idle", detail: null },
    idle: true,
    /** What the Office answers when asked whether it could start again (its runners are ready). */
    startable: () => true,
    startableAsks: 0,
    pending: { add: [], remove: [] },
    beatError: null,
    syncError: null,
    beats: [],
    syncs: [],
    restarts: [],
    logs: [],
  };
  w.watch = () =>
    createMacWatch({
      linkOf: () => w.file,
      clientFor: (file) => ({
        async heartbeat(state, detail) {
          w.beats.push([file.macId, state, detail]);
          if (w.beatError) throw w.beatError;
        },
        async repos() {
          throw new Error("the watch never lists repos itself");
        },
        async link() {
          throw new Error("the watch never mints links itself");
        },
      }),
      presence: () => w.presence,
      idle: () => w.idle,
      startable: () => {
        w.startableAsks++;
        return w.startable();
      },
      sync: async (file, client) => {
        assert.equal(typeof client.repos, "function");
        w.syncs.push(file.macId);
        if (w.syncError) throw w.syncError;
        return w.pending;
      },
      // What was remembered on disk when the restart was asked for.
      restart: () => w.restarts.push(existsSync(macRestartPath(root)) ? readFileSync(macRestartPath(root), "utf8") : null),
      log: (line) => w.logs.push(line),
      now: () => w.clock,
      root,
    });
  return w;
}

test("beat sends the presence state and detail when a Mac link exists and nothing without one", async (t) => {
  const w = world(t);
  w.file = null;
  const watch = w.watch();
  await watch.beat();
  await watch.check();
  assert.deepEqual([w.beats, w.syncs, w.logs], [[], [], []], "not connected: no Hub call, no line");

  w.file = FILE;
  w.presence = { state: "limited", detail: "claude: limit" };
  await watch.beat();
  w.presence = { state: "working", detail: null };
  await watch.beat();
  assert.deepEqual(w.beats, [
    ["mac-1", "limited", "claude: limit"],
    ["mac-1", "working", null],
  ]);

  // Any other failure (no network) is the timer's to log; the next beat goes out again.
  w.beatError = Object.assign(new Error("connect ECONNREFUSED\u0007"), { code: "ECONNREFUSED" });
  await assert.rejects(watch.beat(), (error) => error.code === "ECONNREFUSED" && !/[\u0000-\u001f]/.test(error.message));
  w.beatError = null;
  await watch.beat();
  assert.equal(w.beats.length, 4);
  assert.deepEqual(w.logs, []);
});

test("a 401 heartbeat logs once and stops Mac calls until the link file names another macId", async (t) => {
  const w = world(t);
  const watch = w.watch();
  w.beatError = unauthorized();
  await watch.beat();
  assert.equal(w.logs.length, 1);
  assert.match(w.logs[0], /해제/);
  assert.ok(w.logs[0].includes(RERUN), w.logs[0]);
  // Revoked: neither heartbeat nor repo check goes to the Hub again under this macId, and nothing more is said.
  w.pending = { add: ["beta"], remove: [] };
  await watch.beat();
  await watch.check();
  assert.deepEqual(w.beats, [["mac-1", "idle", null]]);
  assert.deepEqual(w.syncs, []);
  assert.deepEqual(w.restarts, []);
  assert.equal(w.logs.length, 1);

  // Connected again: the new Mac is called.
  w.file = OTHER;
  w.beatError = null;
  await watch.beat();
  await watch.check();
  assert.deepEqual(w.beats.at(-1), ["mac-2", "idle", null]);
  assert.deepEqual(w.syncs, ["mac-2"]);
  assert.equal(w.restarts.length, 1);
  assert.ok(!w.logs.join("\n").includes(FILE.macToken) && !w.logs.join("\n").includes(OTHER.macToken));

  // A 401 from the repo check is the same revocation: one line, then no Mac call.
  const v = world(t);
  const other = v.watch();
  v.syncError = unauthorized();
  await other.check();
  await other.check();
  await other.beat();
  assert.deepEqual([v.syncs, v.beats, v.restarts], [["mac-1"], [], []]);
  assert.equal(v.logs.length, 1);
  assert.ok(v.logs[0].includes(RERUN), v.logs[0]);
});

test("a repo to add with nothing open holds claims and calls restart once, even over several checks", async (t) => {
  const w = world(t);
  const watch = w.watch();
  w.pending = { add: ["beta"], remove: [] };
  assert.equal(watch.holding(), false);
  await watch.check();
  assert.equal(watch.holding(), true);
  assert.equal(w.restarts.length, 1);
  assert.equal(w.logs.length, 1);
  assert.match(w.logs[0], /beta/);
  for (let i = 0; i < 3; i++) {
    w.clock += 150000;
    await watch.check();
  }
  assert.equal(watch.holding(), true);
  assert.equal(w.restarts.length, 1, "one restart while it is held");
  assert.deepEqual(w.syncs, ["mac-1"], "no repo check while it is held");
  assert.equal(w.logs.length, 1);
  // The heartbeat goes on while held.
  await watch.beat();
  assert.equal(w.beats.length, 1);
});

test("with an open claim or a busy engine, check waits, logs once, and restarts at the first check after it closes", async (t) => {
  const w = world(t);
  const watch = w.watch();
  w.pending = { add: ["beta"], remove: [] };
  w.idle = false;
  for (let i = 0; i < 3; i++) await watch.check();
  assert.deepEqual(w.restarts, []);
  assert.equal(watch.holding(), false, "claims are not held while it waits");
  assert.equal(w.logs.length, 1, w.logs.join("\n"));
  assert.match(w.logs[0], /beta/);
  assert.match(w.logs[0], /열린 Task/);
  assert.equal(existsSync(macRestartPath(w.root)), false, "nothing is remembered before a restart");

  w.idle = true;
  await watch.check();
  assert.equal(w.restarts.length, 1);
  assert.equal(watch.holding(), true);
  assert.equal(w.logs.length, 2);
});

test("while the Office could not start again (its runners are not ready) check does not restart, logs once, and restarts once they are ready", async (t) => {
  const w = world(t);
  const watch = w.watch();
  w.pending = { add: ["beta"], remove: [] };
  w.startable = async () => false;
  for (let i = 0; i < 3; i++) await watch.check();
  assert.deepEqual(w.restarts, []);
  assert.equal(watch.holding(), false, "claims are not held while it waits");
  assert.equal(w.logs.length, 1, w.logs.join("\n"));
  assert.match(w.logs[0], /beta/);
  assert.match(w.logs[0], /CLI/);
  assert.doesNotMatch(w.logs[0], /열린 Task/);
  assert.equal(existsSync(macRestartPath(w.root)), false, "nothing is remembered before a restart");

  // A check that throws counts as not ready, and says nothing more.
  w.startable = async () => {
    throw new Error("discovery failed");
  };
  await watch.check();
  assert.deepEqual([w.restarts.length, w.logs.length], [0, 1]);

  w.startable = async () => true;
  await watch.check();
  assert.equal(w.restarts.length, 1);
  assert.equal(watch.holding(), true);
  assert.equal(w.logs.length, 2);
});

test("with an open claim the runners are not asked; a claim that opens while they are asked is waited for", async (t) => {
  const w = world(t);
  const watch = w.watch();
  w.pending = { add: ["beta"], remove: [] };
  w.idle = false;
  await watch.check();
  assert.equal(w.startableAsks, 0, "nothing to ask while a Task is open");
  assert.match(w.logs.at(-1), /열린 Task/);

  // Idle when asked, but a claim tick takes a Task while the runners are checked.
  w.idle = true;
  w.startable = async () => {
    w.idle = false;
    return true;
  };
  await watch.check();
  assert.equal(w.startableAsks, 1);
  assert.deepEqual(w.restarts, [], "not restarted under a claim that opened meanwhile");
  assert.equal(watch.holding(), false);
});

test("the hold ends after 600000 ms if this Office was never stopped, and the next check tries again", async (t) => {
  assert.equal(RESTART_HOLD_MS, 600000);
  const w = world(t);
  const watch = w.watch();
  w.pending = { add: ["beta"], remove: [] };
  await watch.check();
  assert.equal(w.restarts.length, 1);
  w.clock += 599999;
  assert.equal(watch.holding(), true);
  await watch.check();
  assert.equal(w.restarts.length, 1);
  w.clock += 1;
  assert.equal(watch.holding(), false, "claims are taken again");
  // The restart never happened (this Office still runs): the same set is tried again, and the line says where the
  // restart wrote why.
  const said = w.logs.length;
  await watch.check();
  assert.equal(w.restarts.length, 2);
  assert.equal(watch.holding(), true);
  const expired = w.logs.slice(said).find((line) => line.includes("10분"));
  assert.ok(expired?.includes(launchLogPath(w.root)), w.logs.join("\n"));

  // Run out again, with the Hub out of reach at the next check: the set is no longer remembered as restarted for,
  // so a later Office does not take it for one its restart already tried.
  w.clock += RESTART_HOLD_MS;
  w.syncError = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
  await assert.rejects(watch.check(), { code: "ETIMEDOUT" });
  assert.equal(watch.holding(), false);
  assert.equal(existsSync(macRestartPath(w.root)), false);
  w.syncError = null;
  await w.watch().check();
  assert.equal(w.restarts.length, 3, "a new Office restarts for it");
});

test("a change that sync fixed in place (no add or remove) needs no restart", async (t) => {
  const w = world(t);
  const watch = w.watch();
  await watch.check();
  await watch.check();
  assert.deepEqual(w.syncs, ["mac-1", "mac-1"]);
  assert.deepEqual(w.restarts, []);
  assert.equal(watch.holding(), false);
  assert.deepEqual(w.logs, []);
  assert.equal(existsSync(macRestartPath(w.root)), false);
});

test("the same pending set after a restart does not restart again and logs once, also across a new createMacWatch instance reading the file", async (t) => {
  const w = world(t);
  const first = w.watch();
  w.pending = { add: ["beta", "alpha"], remove: ["/data/repos/gone"] };
  await first.check();
  assert.equal(w.restarts.length, 1);
  // Remembered before the restart was asked for, 0600, in a stable order.
  assert.deepEqual(JSON.parse(w.restarts[0]), { version: 1, add: ["alpha", "beta"], remove: ["/data/repos/gone"], at: w.clock });
  assert.equal(statSync(macRestartPath(w.root)).mode & 0o777, 0o600);
  await first.check();
  assert.equal(w.restarts.length, 1, "held: no second restart");

  // The restarted Office: its full sync could not add these, so the links-only check names them again.
  const second = w.watch();
  w.pending = { add: ["alpha", "beta"], remove: ["/data/repos/gone"] };
  const said = w.logs.length;
  for (let i = 0; i < 3; i++) await second.check();
  assert.equal(w.restarts.length, 1, "no restart for the set it restarted for");
  assert.equal(second.holding(), false, "and claims are not held");
  const lines = w.logs.slice(said);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /담당 repo 변경을 맞추지 못했습니다/);
  for (const name of ["alpha", "beta", "/data/repos/gone"]) assert.ok(lines[0].includes(name), lines[0]);
  assert.ok(lines[0].includes(`mac restart --data-dir ${w.root}`), lines[0]);
});

test("a changed pending set restarts once more", async (t) => {
  const w = world(t);
  w.pending = { add: ["beta"], remove: [] };
  await w.watch().check();
  assert.equal(w.restarts.length, 1);
  // Restarted: another repo became the member's in the meantime.
  const second = w.watch();
  w.pending = { add: ["beta", "gamma"], remove: [] };
  await second.check();
  assert.equal(w.restarts.length, 2);
  assert.deepEqual(JSON.parse(w.restarts[1]), { version: 1, add: ["beta", "gamma"], remove: [], at: w.clock });
  // And the Office after that knows this set.
  const third = w.watch();
  await third.check();
  assert.equal(w.restarts.length, 2);
});

test("a remembered pending set is tried again once it is 3600000 ms old, and the file keeps the new time", async (t) => {
  assert.equal(RESTART_RETRY_MS, 3600000);
  const w = world(t);
  w.pending = { add: ["beta"], remove: [] };
  await w.watch().check();
  assert.equal(w.restarts.length, 1);
  const restartedAt = w.clock;

  // The restarted Office: its full sync could not add beta (the Hub was out of reach for a moment).
  const second = w.watch();
  w.clock = restartedAt + 3599999;
  await second.check();
  assert.equal(w.restarts.length, 1, "not before an hour");
  assert.equal(second.holding(), false);
  w.clock = restartedAt + 3600000;
  await second.check();
  assert.equal(w.restarts.length, 2, "an hour on, once more");
  assert.equal(second.holding(), true);
  assert.deepEqual(JSON.parse(readFileSync(macRestartPath(w.root), "utf8")), { version: 1, add: ["beta"], remove: [], at: restartedAt + 3600000 });
  await second.check();
  assert.equal(w.restarts.length, 2, "held");

  // An Office that starts with an old file (the Mac was asleep) restarts for the set at its first check.
  writeFileSync(macRestartPath(w.root), JSON.stringify({ version: 1, add: ["beta"], remove: [], at: w.clock - RESTART_RETRY_MS }));
  await w.watch().check();
  assert.equal(w.restarts.length, 3);
  // One from before the time was kept (no `at`) counts as nothing remembered.
  writeFileSync(macRestartPath(w.root), JSON.stringify({ version: 1, add: ["beta"], remove: [] }));
  await w.watch().check();
  assert.equal(w.restarts.length, 4);
});

test("an empty pending set clears the remembered set", async (t) => {
  const w = world(t);
  w.pending = { add: ["beta"], remove: [] };
  await w.watch().check();
  assert.equal(w.restarts.length, 1);
  const second = w.watch();
  w.pending = { add: [], remove: [] };
  await second.check();
  assert.equal(existsSync(macRestartPath(w.root)), false);
  assert.equal(w.restarts.length, 1);
  // The same repo to add again (the member's ownership came back): a restart, as for any change.
  w.pending = { add: ["beta"], remove: [] };
  await second.check();
  assert.equal(w.restarts.length, 2);
  assert.equal(second.holding(), true);
});

test("a pending set that cannot be remembered is not restarted for, and the line is said once", async (t) => {
  const root = tempRoot(t);
  const w = world(t, root);
  // The team folder is a file: nothing can be written in it.
  rmSync(teamDir(root), { recursive: true });
  writeFileSync(teamDir(root), "");
  const watch = w.watch();
  w.pending = { add: ["beta"], remove: [] };
  await watch.check();
  await watch.check();
  assert.deepEqual(w.restarts, []);
  assert.equal(watch.holding(), false);
  assert.equal(w.logs.length, 1, w.logs.join("\n"));
  assert.match(w.logs[0], /beta/);
});

test("spawnMacRestart runs mac restart --data-dir <root> detached with the person's PATH, HOME and ssh agent, logs to launchd.log, and its argv and env hold no token", (t) => {
  const root = tempRoot(t);
  writeMacLink(root, FILE);
  const calls = [];
  const fake = (command, args, options) => {
    const call = { command, args, options, unref: false, listeners: {} };
    calls.push(call);
    // The child's output, written while its log is open.
    writeSync(options.stdio[1], `out ${calls.length}\n`);
    writeSync(options.stdio[2], `err ${calls.length}\n`);
    const child = {
      on(event, listener) {
        call.listeners[event] = listener;
        return child;
      },
      once(event, listener) {
        call.listeners[event] = listener;
        return child;
      },
      unref() {
        call.unref = true;
      },
    };
    return child;
  };
  const host = { pathEnv: "/opt/homebrew/bin:/usr/bin:/bin", home: "/Users/jane", sshAuthSock: "/private/tmp/agent.sock" };
  spawnMacRestart(root, host, fake, { env: {} });
  assert.equal(calls.length, 1);
  const [{ command, args, options }] = calls;
  assert.equal(command, stableNodePath(process.execPath), "this node, as the LaunchAgent names it");
  assert.deepEqual(args, [join(packageRoot, "bin", "pazmo-office.mjs"), "mac", "restart", "--data-dir", root]);
  assert.ok(existsSync(args[0]));
  assert.equal(options.detached, true);
  assert.equal(options.stdio[0], "ignore");
  assert.deepEqual(options.env, {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    HOME: "/Users/jane",
    LANG: "en_US.UTF-8",
    SSH_AUTH_SOCK: "/private/tmp/agent.sock",
  });
  assert.equal(calls[0].unref, true, "the Office does not wait for it");
  const seen = JSON.stringify([command, args, options.env]);
  assert.ok(!seen.includes(FILE.macToken), "no token in argv or env");

  // Without an ssh agent there is none; the log is appended to, 0600.
  spawnMacRestart(root, { pathEnv: host.pathEnv, home: host.home }, fake, { env: {} });
  assert.deepEqual(Object.keys(calls[1].options.env).sort(), ["HOME", "LANG", "PATH"]);
  const log = launchLogPath(root);
  assert.equal(readFileSync(log, "utf8"), "out 1\nerr 1\nout 2\nerr 2\n");
  assert.equal(statSync(log).mode & 0o777, 0o600);

  // A child that cannot start is said in that log, never thrown into the Office.
  assert.equal(typeof calls[1].listeners.error, "function");
  calls[1].listeners.error(Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }));
  assert.match(readFileSync(log, "utf8"), /ENOENT/);
});

test("a restart runs on Homebrew's node once an upgrade removed the running one", (t) => {
  const root = tempRoot(t);
  mkdirSync(teamDir(root), { recursive: true });
  const gone = join(root, "Cellar", "node@24", "24.0.0", "bin", "node");
  const stable = join(root, "opt", "node@24", "bin", "node");
  assert.equal(restartNode(gone, stable), stable);
  assert.equal(restartNode(gone), STABLE_NODE);
  // While it is there, the node that runs: Homebrew's own path to it, or itself.
  assert.equal(restartNode(process.execPath, stable), process.execPath);
  mkdirSync(join(root, "opt", "node@24", "bin"), { recursive: true });
  writeFileSync(stable, "");
  const present = join(root, "present-node");
  writeFileSync(present, "");
  assert.equal(restartNode(present, stable), present);

  const commands = [];
  const fake = (command) => {
    commands.push(command);
    return { once() {}, on() {}, unref() {} };
  };
  spawnMacRestart(root, { pathEnv: "/usr/bin:/bin", home: "/Users/jane" }, fake, { execPath: gone, stableNode: stable, env: {} });
  spawnMacRestart(root, { pathEnv: "/usr/bin:/bin", home: "/Users/jane" }, fake, { execPath: gone, env: {} });
  assert.deepEqual(commands, [stable, STABLE_NODE]);
});

test("a restart carries NODE_EXTRA_CA_CERTS only when it is an absolute path, and changes no other variable", (t) => {
  const root = tempRoot(t);
  mkdirSync(teamDir(root), { recursive: true });
  const envs = [];
  const fake = (_command, _args, options) => {
    envs.push(options.env);
    return { once() {}, on() {}, unref() {} };
  };
  const host = { pathEnv: "/usr/bin:/bin", home: "/Users/jane" };
  const base = { PATH: "/usr/bin:/bin", HOME: "/Users/jane", LANG: "en_US.UTF-8" };
  for (const value of ["/Users/jane/corp-ca.pem", "corp-ca.pem", "/Users/jane/corp\nca.pem", "", undefined])
    spawnMacRestart(root, host, fake, { env: value === undefined ? {} : { NODE_EXTRA_CA_CERTS: value, OTHER: "x" } });
  assert.deepEqual(envs, [{ ...base, NODE_EXTRA_CA_CERTS: "/Users/jane/corp-ca.pem" }, base, base, base, base]);
});
