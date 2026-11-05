import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { serviceEnv } from "../src/cli/lifecycle.ts";
import { locate } from "../src/cli/project.ts";
import { writeMacLink } from "../src/team/mac.ts";
import { teamDir } from "../src/team/registry.ts";
import { openTeamStore } from "../src/team/store.ts";
import { assertOfficesExited } from "./office-process.mjs";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const appleSilicon = process.platform === "darwin" && process.arch === "arm64";

/**
 * A temp data root, an empty HOME and a PATH whose `gh` is a `#!/bin/sh` fake:
 * it records its arguments and is logged in to github.example.com only. Whatever
 * team Office a test started is stopped, and its process must be gone.
 */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-life-")));
  const f = { root, data: join(root, "data"), home: join(root, "home"), bin: join(root, "bin"), ghArgs: join(root, "gh-args") };
  mkdirSync(f.home);
  mkdirSync(f.bin);
  writeFileSync(
    join(f.bin, "gh"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(f.ghArgs)}\n[ "$4" = "github.example.com" ] && exit 0\nexit 1\n`,
  );
  chmodSync(join(f.bin, "gh"), 0o755);
  f.env = { ...process.env, HOME: f.home, PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
  f.running = join(teamDir(f.data), "running.json");
  t.after(async () => {
    const pids = existsSync(f.running) ? [JSON.parse(readFileSync(f.running, "utf8")).pid] : [];
    call(f, "stop", "--team");
    await assertOfficesExited(pids);
    rmSync(root, { recursive: true, force: true });
  });
  /** A git repo on `host`; returns its real path. */
  f.repo = (name, host = "github.example.com") => {
    const dir = join(root, name);
    mkdirSync(dir);
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", `https://${host}/team/${name}.git`]);
    return realpathSync(dir);
  };
  return f;
}
/** Runs the real CLI against the fixture's data root; returns the JSON it printed. */
function call(f, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--data-dir", f.data], {
    encoding: "utf8",
    timeout: 30000,
    env: f.env,
  });
  return { status: r.status, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}
const commandLine = (pid) => execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim();

test("start --team runs every registered repo in one Office; status --team shows each repo; stop --team ends it", async (t) => {
  const f = fixture(t);
  const a = f.repo("alpha");
  const b = f.repo("beta", "ghe.example.com");
  assert.equal(call(f, "team", "add", "--project", a).status, 0);
  assert.equal(call(f, "team", "add", "--project", b).status, 0);
  assert.deepEqual(call(f, "status", "--team").value, { status: "stopped", execution: "locked" }, "never started");

  const started = call(f, "start", "--team", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.equal(started.value.status, "running");
  assert.equal(started.value.engine, "team");
  assert.equal(started.value.execution, "locked", "no --live: nothing can run");
  assert.equal(started.value.url, undefined, "the team Office has no page yet");
  const state = JSON.parse(readFileSync(f.running, "utf8"));
  assert.equal(state.engine, "team");
  assert.equal(state.project, teamDir(f.data));
  assert.equal(existsSync(join(teamDir(f.data), "meta", "manifest.json")), true);

  // Plain node on the team service: no tsx loader, no vendor path.
  const line = commandLine(state.pid);
  assert.match(line, /src\/runtime\/team-service\.ts/);
  assert.doesNotMatch(line, /tsx|--import|vendor/);

  const status = call(f, "status", "--team");
  assert.equal(status.status, 0, JSON.stringify(status.value));
  const { repos, ...rest } = status.value;
  assert.deepEqual(rest, {
    status: "running",
    execution: "locked",
    engine: "team",
    dataDir: teamDir(f.data),
    paused: false,
    dailyCap: 5,
    today: 0,
    claim: null,
    blockedBy: null,
    busy: false,
  });
  assert.equal(repos.length, 2);
  assert.deepEqual(repos[0], { project: a, remote: "github.example.com/team/alpha", state: "no-link", gh: { ok: true } });
  assert.equal(repos[1].project, b);
  assert.equal(repos[1].state, "no-link", "no hub-link.json: no-link comes before the gh check");
  assert.equal(repos[1].gh.reason, "logged-out");
  assert.match(repos[1].gh.hint, /gh auth login --hostname ghe\.example\.com/);
  // gh ran with the person's own PATH, once per host.
  assert.deepEqual(readFileSync(f.ghArgs, "utf8").trim().split("\n").toSorted(), [
    "auth status --hostname ghe.example.com",
    "auth status --hostname github.example.com",
  ]);

  // Each repo has its own Story engine data, never the repo's lean data; without --live no checkout is
  // made, and the repos themselves were not touched.
  for (const dir of [a, b]) {
    const { dataDir } = locate(dir, f.data);
    assert.equal(existsSync(join(dataDir, "story", "lean", "office.sqlite")), true, dir);
    assert.equal(existsSync(join(dataDir, "lean")), false, dir);
    assert.equal(existsSync(join(dataDir, "story-checkout")), false, dir);
    assert.equal(existsSync(join(dir, ".pazmo-office")), false, dir);
  }

  // Same engine: start is idempotent; the registry cannot change while it runs.
  const again = call(f, "start", "--team", "--port", "0");
  assert.equal(again.status, 0, JSON.stringify(again.value));
  assert.equal(again.value.engine, "team");
  assert.equal(call(f, "team", "add", "--project", f.repo("gamma")).value.code, "TEAM_RUNNING");

  const stopped = call(f, "stop", "--team");
  assert.equal(stopped.status, 0, JSON.stringify(stopped.value));
  assert.equal(stopped.value.status, "stopped");
  await assertOfficesExited([state.pid]);
  assert.equal(existsSync(f.running), false);
  assert.equal(call(f, "status", "--team").value.status, "stopped");
  assert.equal(call(f, "stop", "--team").value.status, "stopped", "stopping again is harmless");
  assert.equal(call(f, "team", "remove", "--project", b).status, 0, "the registry can change again");
});

test("with no registered repo, start --team and up --team are NO_REPOS and start nothing", async (t) => {
  const f = fixture(t);
  const start = call(f, "start", "--team", "--port", "0");
  assert.equal(start.status, 1);
  assert.equal(start.value.code, "NO_REPOS");
  const up = call(f, "up", "--team", "--no-open");
  assert.equal(up.status, 1);
  assert.equal(up.value.code, appleSilicon ? "NO_REPOS" : "PLATFORM");
  assert.equal(existsSync(f.running), false);
  assert.equal(existsSync(join(teamDir(f.data), "office.log")), false);
});

test("with a Mac link and no repo, start --team runs with no repos; without one it is still NO_REPOS", async (t) => {
  const f = fixture(t);
  assert.equal(call(f, "start", "--team", "--port", "0").value.code, "NO_REPOS", "no Mac link yet");
  // Nobody listens on port 1: a Hub this Mac cannot reach, without leaving the machine.
  writeMacLink(f.data, {
    version: 1,
    hub: "https://127.0.0.1:1",
    macId: "mac-1",
    macToken: "T".repeat(43),
    memberId: "m1",
    memberName: "김",
    name: "내 Mac",
  });
  const started = call(f, "start", "--team", "--port", "0");
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.equal(started.value.status, "running");
  assert.equal(started.value.engine, "team");
  const status = call(f, "status", "--team");
  assert.equal(status.value.status, "running");
  assert.deepEqual(status.value.repos, [], "a team Office with no lanes");
  const pid = JSON.parse(readFileSync(f.running, "utf8")).pid;
  assert.equal(call(f, "stop", "--team").value.status, "stopped");
  await assertOfficesExited([pid]);

  if (!appleSilicon) return;
  // up --team syncs first (the Hub is out of reach: one line) and is not stopped by the empty registry; the
  // machine preparation stops it at its first check, as in the up --team test below.
  const r = spawnSync(process.execPath, [cli, "up", "--team", "--no-open", "--codex-runtime", "pinned", "--data-dir", f.data], {
    encoding: "utf8",
    timeout: 30000,
    env: f.env,
  });
  assert.equal(r.status, 1, r.stderr);
  const lines = r.stderr.trim().split("\n");
  const error = JSON.parse(lines.at(-1));
  assert.ok(["PREREQUISITE", "LOGIN_REQUIRED"].includes(error.code), error.code);
  assert.ok(lines.some((line) => line.startsWith("Mac 담당 repo 맞추기를 건너뜁니다 — ")), r.stderr);
  assert.ok(!r.stderr.includes("T".repeat(43)), "no token in the output");
  assert.equal(existsSync(f.running), false);
});

test("serviceEnv: the team service gets NODE_EXTRA_CA_CERTS only when it is an absolute path; nothing else changes", () => {
  const base = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/d/home", TMPDIR: "/d/tmp", LANG: "en_US.UTF-8" };
  assert.deepEqual(serviceEnv("team", "/d", { NODE_EXTRA_CA_CERTS: "/Users/jane/corp-ca.pem", OTHER: "x" }), {
    ...base,
    NODE_EXTRA_CA_CERTS: "/Users/jane/corp-ca.pem",
  });
  for (const value of ["corp-ca.pem", "/Users/jane/corp\nca.pem", ""])
    assert.deepEqual(serviceEnv("team", "/d", { NODE_EXTRA_CA_CERTS: value }), base, JSON.stringify(value));
  assert.deepEqual(serviceEnv("team", "/d", {}), base);
  // The lean service's environment is as it was.
  assert.deepEqual(serviceEnv("lean", "/d", { NODE_EXTRA_CA_CERTS: "/Users/jane/corp-ca.pem" }), base);
});

test("a started team service has the extra CA file of an absolute NODE_EXTRA_CA_CERTS, and none for a relative one", async (t) => {
  const f = fixture(t);
  // Nobody listens on port 1: the service's first beat is a TLS call that fails without leaving the machine.
  writeMacLink(f.data, {
    version: 1,
    hub: "https://127.0.0.1:1",
    macId: "mac-1",
    macToken: "T".repeat(43),
    memberId: "m1",
    memberName: "김",
    name: "내 Mac",
  });
  const log = join(teamDir(f.data), "office.log");
  const since = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  // Node loads the extra CA file at the first TLS call and says in the service's log that a missing one was ignored.
  for (const [value, carried] of [[join(f.root, "missing-ca.pem"), true], ["missing-ca.pem", false]]) {
    const before = since().length;
    const started = call({ ...f, env: { ...f.env, NODE_EXTRA_CA_CERTS: value } }, "start", "--team", "--port", "0");
    assert.equal(started.status, 0, JSON.stringify(started.value));
    const pid = JSON.parse(readFileSync(f.running, "utf8")).pid;
    for (let i = 0; i < 400 && !since().slice(before).includes("the presence failed"); i++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    const text = since().slice(before);
    assert.ok(text.includes("the presence failed"), text);
    assert.equal(text.includes(`Ignoring extra certs from \`${value}\``), carried, text);
    assert.equal(call(f, "stop", "--team").value.status, "stopped");
    await assertOfficesExited([pid]);
  }
});

test("a registered repo whose folder is gone stops start --team and up --team with REPO_MISSING and its remedy", (t) => {
  const f = fixture(t);
  const a = f.repo("alpha");
  const b = f.repo("beta");
  for (const dir of [a, b]) assert.equal(call(f, "team", "add", "--project", dir).status, 0);
  rmSync(b, { recursive: true });
  const start = call(f, "start", "--team", "--port", "0");
  assert.equal(start.status, 1, JSON.stringify(start.value));
  assert.equal(start.value.code, "REPO_MISSING");
  assert.ok(start.value.error.includes(`pazmo-office team remove --project ${b}`), start.value.error);
  assert.equal(existsSync(f.running), false, "nothing was started");
  assert.equal(existsSync(join(teamDir(f.data), "office.log")), false, "no service was spawned");
  const up = call(f, "up", "--team", "--no-open");
  assert.equal(up.status, 1, JSON.stringify(up.value));
  assert.equal(up.value.code, appleSilicon ? "REPO_MISSING" : "PLATFORM");
  if (appleSilicon) assert.ok(up.value.error.includes(`pazmo-office team remove --project ${b}`), up.value.error);
  assert.equal(existsSync(join(a, ".pazmo-office")), false, "checked before any repo is prepared");
  assert.equal(existsSync(f.running), false);
  // The remedy the error names works.
  assert.equal(call(f, "team", "remove", "--project", b).status, 0);
});

test("--team cannot be combined with --project or --lean and is for start, up, status, stop and monitor only", (t) => {
  const f = fixture(t);
  const dir = f.repo("alpha");
  // --claw is refused before this check (CLAW_REMOVED, tests/lean-lifecycle.test.mjs).
  for (const args of [
    ["start", "--team", "--project", dir],
    ["up", "--team", "--project", dir],
    ["status", "--team", "--project", dir],
    ["stop", "--team", "--project", dir],
    ["start", "--team", "--lean"],
    ["up", "--team", "--lean"],
    ["init", "--team"],
    ["doctor", "--team"],
    ["hub-link", "--team"],
    ["team", "list", "--team"],
  ]) {
    const result = call(f, ...args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.value.code, "ARGUMENT", args.join(" "));
  }
});

test("monitor --team is UNSUPPORTED: the team Office has no screen yet", (t) => {
  const f = fixture(t);
  const result = call(f, "monitor", "--team");
  assert.equal(result.status, 1);
  assert.equal(result.value.code, "UNSUPPORTED");
  assert.match(result.value.error, /status --team/);
});

test(
  "up --team initialises every registered repo and the team Office, then prepares the machine as lean does",
  { skip: !appleSilicon && "up runs on Apple Silicon macOS only" },
  (t) => {
    const f = fixture(t);
    const a = f.repo("alpha");
    const b = f.repo("beta");
    for (const dir of [a, b]) assert.equal(call(f, "team", "add", "--project", dir).status, 0);
    // The pinned runtime needs ~/.codex/auth.json, which the empty HOME lacks: the machine
    // preparation stops at its first check (colima missing, or the login), before any install.
    const r = call(f, "up", "--team", "--no-open", "--codex-runtime", "pinned");
    assert.equal(r.status, 1, JSON.stringify(r.value));
    assert.ok(["PREREQUISITE", "LOGIN_REQUIRED"].includes(r.value.code), r.value.code);
    for (const dir of [a, b]) assert.equal(existsSync(join(dir, ".pazmo-office", "manifest.json")), true, dir);
    assert.equal(existsSync(join(teamDir(f.data), "meta", "manifest.json")), true);
    assert.equal(existsSync(f.running), false, "nothing was started");
  },
);

test("team rerun --memo writes the request; NO_FAILED_CLAIM without a failed record", (t) => {
  const f = fixture(t);
  const a = f.repo("alpha");
  assert.equal(call(f, "team", "add", "--project", a).status, 0);
  const refused = (r) => [r.status, r.value.code];
  assert.deepEqual(refused(call(f, "team", "rerun", "--memo", "try again")), [1, "NO_FAILED_CLAIM"], "no record at all");

  const store = openTeamStore(teamDir(f.data));
  t.after(() => store.close());
  const task = { taskId: "t1", claimId: "c1", number: 2, title: "Endpoint", story: { number: 7 } };
  store.recordClaim(a, task, "claim");
  assert.deepEqual(refused(call(f, "team", "rerun", "--memo", "try again")), [1, "NO_FAILED_CLAIM"], "a record that did not fail");
  assert.equal(store.openClaim().rerunMemo, null);
  // A runner account problem the attempt waits out shows with the runner's words and times (D37).
  const since = Date.UTC(2026, 10, 2, 9, 0);
  const login = "Your access token could not be refreshed. Please log out and sign in again.";
  store.setPhase("t1", "claimed", { runnerWait: { runner: "codex", kind: "login", message: login, since, retryAt: since + 1800000, runs: 1 } });
  assert.deepEqual(call(f, "team", "status").value.claim.waiting, {
    runner: "codex",
    kind: "login",
    message: login,
    since: "2026-11-02T09:00:00.000Z",
    retryAt: "2026-11-02T09:30:00.000Z",
  });

  // The Office reported the Task failed; it is stopped now, and the request waits for its next start.
  store.setPhase("t1", "failed", { attempts: 3 });
  const status = call(f, "team", "status").value;
  assert.deepEqual(status.claim, { taskId: "t1", claimId: "c1", project: a, title: "Endpoint", phase: "failed", attempts: 3, waiting: null });
  assert.deepEqual(call(f, "team", "rerun", "--memo", "use the v2 endpoint"), { status: 0, value: { requested: true } });
  assert.equal(store.openClaim().rerunMemo, "use the v2 endpoint");
  assert.equal(existsSync(f.running), false, "no Office was started");

  // A memo of up to 2000 characters, given with --memo, and only to team rerun.
  assert.deepEqual(refused(call(f, "team", "rerun", "--memo", "x".repeat(2001))), [1, "INVALID"]);
  assert.deepEqual(refused(call(f, "team", "rerun")), [1, "ARGUMENT"]);
  assert.deepEqual(refused(call(f, "team", "status", "--memo", "x")), [1, "ARGUMENT"]);
  assert.deepEqual(refused(call(f, "status", "--team", "--memo", "x")), [1, "ARGUMENT"]);
  assert.equal(store.openClaim().rerunMemo, "use the v2 endpoint", "the refused requests changed nothing");
  assert.deepEqual(call(f, "team", "rerun", "--memo", "x".repeat(2000)).value, { requested: true });
});

test("the team service refuses a host config whose ssh agent socket is not text, and takes one that is", async (t) => {
  const f = fixture(t);
  const dataDir = teamDir(f.data);
  mkdirSync(dataDir, { recursive: true });
  const service = new URL("../src/runtime/team-service.ts", import.meta.url).pathname;
  /** The service's first reply to a startup message with this `host`; it is gone before this resolves. */
  const reply = (host) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [service], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { PATH: dirname(process.execPath), HOME: f.home, LANG: "C" },
      });
      let message;
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.once("message", (m) => {
        message = m;
        child.kill("SIGTERM");
      });
      child.once("exit", () => {
        clearTimeout(timer);
        if (message) resolve(message);
        else reject(new Error("the service exited without a reply"));
      });
      child.send({ project: dataDir, dataDir, port: 0, token: "a".repeat(64), instance: "b".repeat(32), host });
    });
  assert.deepEqual(await reply({ pathEnv: "", home: f.home, sshAuthSock: 5 }), { type: "error", error: "INVALID_HOST_CONFIG" });
  assert.deepEqual(await reply(undefined), { type: "error", error: "INVALID_HOST_CONFIG" }, "the host is required");
  // Past the check, the start goes on and stops at the empty registry.
  const accepted = await reply({ pathEnv: "", home: f.home, sshAuthSock: join(f.root, "agent.sock") });
  assert.equal(accepted.type, "error");
  assert.match(accepted.error, /No repo is registered/);
});

test("the help text names the team Office", () => {
  const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /start --team/);
  assert.match(r.stdout, /up --team/);
  assert.match(r.stdout, /status --team/);
  assert.match(r.stdout, /team rerun --memo/);
  assert.match(r.stdout, /a live team Office/, "a rerun waits for a live team Office");
});
