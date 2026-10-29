import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { locate } from "../src/cli/project.ts";
import { teamDir } from "../src/team/registry.ts";
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

  // Each repo engine has its own lean data; the repos themselves were not touched.
  for (const dir of [a, b]) {
    assert.equal(existsSync(join(locate(dir, f.data).dataDir, "lean", "office.sqlite")), true, dir);
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

test("--team cannot be combined with --project, --lean or --claw and is for start, up, status, stop and monitor only", (t) => {
  const f = fixture(t);
  const dir = f.repo("alpha");
  for (const args of [
    ["start", "--team", "--project", dir],
    ["up", "--team", "--project", dir],
    ["status", "--team", "--project", dir],
    ["stop", "--team", "--project", dir],
    ["start", "--team", "--lean"],
    ["start", "--team", "--claw"],
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

test("the help text names the team Office", () => {
  const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /start --team/);
  assert.match(r.stdout, /up --team/);
  assert.match(r.stdout, /status --team/);
});
