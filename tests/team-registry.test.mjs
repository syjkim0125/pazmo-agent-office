import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { STARTUP_MS, status } from "../src/cli/lifecycle.ts";
import { init, locate } from "../src/cli/project.ts";
import {
  addTeamRepo,
  inTeam,
  readTeam,
  removeTeamRepo,
  teamDir,
  teamRunning,
} from "../src/team/registry.ts";
import { openTeamStore } from "../src/team/store.ts";
import { assertOfficesExited, officePid } from "./office-process.mjs";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const ORIGIN = "https://github.example.com/team/eevee-be.git";
const REMOTE = "github.example.com/team/eevee-be";

/** A temp data directory plus helpers to make git repos beside it. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-reg-")));
  const f = { root, data: join(root, "data") };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  /** A git repo at <root>/<name>; origin is added unless it is null. */
  f.repo = (name, origin = `https://github.example.com/team/${name}.git`) => {
    const dir = join(root, name);
    mkdirSync(dir);
    execFileSync("git", ["init", "-q", dir]);
    if (origin !== null) execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
    return dir;
  };
  return f;
}
/** Runs the real CLI; returns the JSON it printed (stdout on success, stderr on failure).
 * The limit is above what start --lean may wait for its Office, so a slow start
 * is reported by start itself instead of leaving its start lock behind. */
function call(f, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--data-dir", f.data], {
    encoding: "utf8",
    timeout: STARTUP_MS.lean + 30000,
  });
  return { status: r.status, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}
const team = (f, action, project) => call(f, "team", action, ...(project ? ["--project", project] : []));

test("add records the repo by its real path and normalized origin, and adding it again changes nothing", async (t) => {
  const f = fixture(t);
  const dir = f.repo("eevee-be", ORIGIN);
  // A path that is not canonical (macOS tmp is behind a symlink): the real path is stored.
  const link = join(f.root, "link");
  symlinkSync(dir, link);
  const first = await addTeamRepo(f.data, link);
  assert.deepEqual(first, { project: realpathSync(dir), remote: REMOTE });
  assert.deepEqual(await addTeamRepo(f.data, dir), first, "adding the same repo again is idempotent");
  assert.deepEqual(readTeam(f.data), { version: 1, repos: [first] });
  assert.equal(inTeam(f.data, realpathSync(dir)), true);
  assert.equal(inTeam(f.data, join(f.root, "elsewhere")), false);

  const file = join(teamDir(f.data), "team.json");
  assert.equal(teamDir(f.data), join(f.data, "team"));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 1, repos: [first] });
  // Written through a temporary file that is renamed away.
  assert.deepEqual(readdirSync(teamDir(f.data)), ["team.json"]);
});

test("registration order is kept, and a changed origin is refreshed on the next add", async (t) => {
  const f = fixture(t);
  const a = f.repo("alpha"),
    b = f.repo("beta");
  await addTeamRepo(f.data, a);
  await addTeamRepo(f.data, b);
  assert.deepEqual(
    readTeam(f.data).repos.map((r) => r.remote),
    ["github.example.com/team/alpha", "github.example.com/team/beta"],
  );
  execFileSync("git", ["-C", a, "remote", "set-url", "origin", "https://github.example.com/team/alpha2.git"]);
  assert.deepEqual(await addTeamRepo(f.data, a), { project: realpathSync(a), remote: "github.example.com/team/alpha2" });
  assert.deepEqual(
    readTeam(f.data).repos.map((r) => r.remote),
    ["github.example.com/team/alpha2", "github.example.com/team/beta"],
    "the entry keeps its place",
  );
});

test("a repo subfolder or a non-repo directory is NOT_GIT_ROOT, a repo without origin is NO_ORIGIN, and nothing is written", async (t) => {
  const f = fixture(t);
  const dir = f.repo("eevee-be", ORIGIN);
  const sub = join(dir, "src");
  mkdirSync(sub);
  await assert.rejects(addTeamRepo(f.data, sub), { code: "NOT_GIT_ROOT" });
  const plain = join(f.root, "plain");
  mkdirSync(plain);
  await assert.rejects(addTeamRepo(f.data, plain), { code: "NOT_GIT_ROOT" });
  await assert.rejects(addTeamRepo(f.data, f.repo("no-origin", null)), { code: "NO_ORIGIN" });
  // An origin that does not name a host and a path cannot be a team repo either.
  await assert.rejects(addTeamRepo(f.data, f.repo("odd-origin", "not-a-remote")), { code: "NO_ORIGIN" });
  assert.equal(existsSync(teamDir(f.data)), false, "a refused add creates no registry");
  const cliRefused = team(f, "add", sub);
  assert.equal(cliRefused.status, 1);
  assert.equal(cliRefused.value.code, "NOT_GIT_ROOT");
});

test("a second clone with the same origin is DUPLICATE_REMOTE, however the origin is spelled", async (t) => {
  const f = fixture(t);
  const first = await addTeamRepo(f.data, f.repo("eevee-be", ORIGIN));
  for (const [name, origin] of [
    ["clone-same", ORIGIN],
    ["clone-ssh", "git@github.example.com:Team/Eevee-BE.git"],
    ["clone-token", "https://user:secret@github.example.com/team/eevee-be"],
  ])
    await assert.rejects(addTeamRepo(f.data, f.repo(name, origin)), { code: "DUPLICATE_REMOTE" }, name);
  assert.deepEqual(readTeam(f.data).repos, [first]);
  // Another repo on the same host is a different repo.
  await addTeamRepo(f.data, f.repo("other"));
  assert.equal(readTeam(f.data).repos.length, 2);
});

test("the 21st repo is LIMIT, and the CLI reports it", async (t) => {
  const f = fixture(t);
  for (let i = 1; i <= 20; i++) await addTeamRepo(f.data, f.repo(`repo-${i}`));
  assert.equal(readTeam(f.data).repos.length, 20);
  await assert.rejects(addTeamRepo(f.data, f.repo("repo-21")), { code: "LIMIT" });
  // Adding one that is already registered is not a 21st.
  await addTeamRepo(f.data, join(f.root, "repo-7"));
  assert.equal(readTeam(f.data).repos.length, 20);
  const refused = team(f, "add", join(f.root, "repo-21"));
  assert.equal(refused.status, 1);
  assert.equal(refused.value.code, "LIMIT");
  assert.equal(readTeam(f.data).repos.length, 20);
});

/** A repo whose single Office is up: its manifest, a status server that answers
 * as that Office, and the running.json that names it. */
async function runningOffice(t, f, project, { listen = true } = {}) {
  const p = locate(project, f.data);
  init(p, true);
  const token = randomBytes(32).toString("hex"),
    instance = randomBytes(16).toString("hex");
  const server = createServer((req, res) => {
    if (req.url !== "/__pazmo/status" || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ instance, project: p.project, status: "running", execution: "locked", engine: "lean" }));
  });
  if (listen) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => (listen ? server.close(resolve) : resolve())));
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  const runningJson = join(p.dataDir, "running.json");
  writeFileSync(
    runningJson,
    JSON.stringify({
      version: 1,
      engine: "lean",
      project: p.project,
      pid: process.pid,
      port: listen ? server.address().port : 9,
      token,
      instance,
    }),
    { mode: 0o600 },
  );
  return { p, runningJson };
}

test("a repo whose single Office is running is RUNNING, and it can be added once that Office is gone", async (t) => {
  const f = fixture(t);
  const dir = f.repo("eevee-be", ORIGIN);
  const office = await runningOffice(t, f, dir);
  // The fake answers as a real Office would: status() sees it running, not merely unknown.
  assert.equal((await status(office.p)).status, "running");
  await assert.rejects(addTeamRepo(f.data, dir), { code: "RUNNING" });
  assert.equal(existsSync(teamDir(f.data)), false, "a refused add registers nothing");
  rmSync(office.runningJson);
  assert.deepEqual(await addTeamRepo(f.data, dir), { project: realpathSync(dir), remote: REMOTE });
});

test("a single Office whose state cannot be authenticated also blocks the add, because it may still be running", async (t) => {
  const f = fixture(t);
  const dir = f.repo("eevee-be", ORIGIN);
  await runningOffice(t, f, dir, { listen: false });
  await assert.rejects(addTeamRepo(f.data, dir), { code: "RUNNING" });
});

test("a repo that was never initialised has no Office to be running, so it can be added", async (t) => {
  const f = fixture(t);
  const dir = f.repo("eevee-be", ORIGIN);
  const p = locate(dir, f.data);
  assert.equal(existsSync(join(p.directory, "manifest.json")), false);
  await addTeamRepo(f.data, dir);
  assert.equal(existsSync(p.directory), false, "adding a repo does not install Office metadata into it");
});

test("a live team Office blocks add and remove with TEAM_RUNNING; a dead pid does not", async (t) => {
  const f = fixture(t);
  const a = f.repo("alpha"),
    b = f.repo("beta");
  const entry = await addTeamRepo(f.data, a);
  const running = join(teamDir(f.data), "running.json");
  assert.equal(teamRunning(f.data), false, "no running.json");

  writeFileSync(running, JSON.stringify({ pid: process.pid }));
  assert.equal(teamRunning(f.data), true);
  await assert.rejects(addTeamRepo(f.data, b), { code: "TEAM_RUNNING" });
  await assert.rejects(removeTeamRepo(f.data, a), { code: "TEAM_RUNNING" });
  const cliRefused = team(f, "remove", a);
  assert.equal(cliRefused.status, 1);
  assert.equal(cliRefused.value.code, "TEAM_RUNNING");
  assert.deepEqual(readTeam(f.data).repos, [entry], "a refused change leaves the registry as it was");

  // A pid that no longer exists is a Office that crashed: the registry may change.
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(running, JSON.stringify({ pid: dead }));
  assert.equal(teamRunning(f.data), false);
  await addTeamRepo(f.data, b);
  await removeTeamRepo(f.data, a);
  assert.deepEqual(
    readTeam(f.data).repos.map((r) => r.remote),
    ["github.example.com/team/beta"],
  );
});

test("teamRunning is false for a missing, unreadable or pid-less running.json", (t) => {
  const f = fixture(t);
  mkdirSync(teamDir(f.data), { recursive: true });
  const running = join(teamDir(f.data), "running.json");
  assert.equal(teamRunning(f.data), false);
  for (const text of ["not json", "{}", JSON.stringify({ pid: "1" }), JSON.stringify({ pid: 0 }), JSON.stringify({ pid: -1 })]) {
    writeFileSync(running, text);
    assert.equal(teamRunning(f.data), false, text);
  }
});

test("remove drops the repo, keeps the others, and refuses one that is not registered", async (t) => {
  const f = fixture(t);
  const a = f.repo("alpha"),
    b = f.repo("beta"),
    c = f.repo("gamma");
  for (const d of [a, b, c]) await addTeamRepo(f.data, d);
  await removeTeamRepo(f.data, b);
  assert.deepEqual(
    readTeam(f.data).repos.map((r) => r.project),
    [realpathSync(a), realpathSync(c)],
  );
  await assert.rejects(removeTeamRepo(f.data, b), { code: "INVALID" });
  await removeTeamRepo(f.data, a);
  await removeTeamRepo(f.data, c);
  assert.deepEqual(readTeam(f.data), { version: 1, repos: [] });
  const fresh = fixture(t);
  await assert.rejects(removeTeamRepo(fresh.data, a), { code: "INVALID" });
});

test("a repo whose folder is gone can still be removed", async (t) => {
  const f = fixture(t);
  const dir = f.repo("alpha");
  const entry = await addTeamRepo(f.data, dir);
  rmSync(dir, { recursive: true });
  await removeTeamRepo(f.data, entry.project);
  assert.deepEqual(readTeam(f.data).repos, []);
});

test("a repo that holds the open claim cannot be removed (OPEN_CLAIM) until the claim is dropped", async (t) => {
  const f = fixture(t);
  const a = await addTeamRepo(f.data, f.repo("alpha"));
  const b = await addTeamRepo(f.data, f.repo("beta"));
  const task = { taskId: "t1", claimId: "c1", number: 1, title: "T", story: { number: 1 } };
  const store = openTeamStore(teamDir(f.data));
  t.after(() => store.close());
  store.recordClaim(a.project, task, "claim");

  await assert.rejects(removeTeamRepo(f.data, a.project), { code: "OPEN_CLAIM" });
  const cli = team(f, "remove", a.project);
  assert.equal(cli.status, 1);
  assert.equal(cli.value.code, "OPEN_CLAIM");
  // A running team Office heartbeats every 60 s, so the Task never goes held and the PL cannot release it: only a cancel frees it.
  assert.match(cli.value.error, /cancel/);
  assert.doesNotMatch(cli.value.error, /release/);
  assert.deepEqual(readTeam(f.data).repos, [a, b], "a refused remove leaves the registry as it was");
  // Another repo is not held up by it.
  await removeTeamRepo(f.data, b.project);
  store.dropClaim("t1", "test");
  await removeTeamRepo(f.data, a.project);
  assert.deepEqual(readTeam(f.data).repos, []);
});

test("a repo whose folder is gone is removed even while it holds the open claim: the record is dropped as REPO_REMOVED", async (t) => {
  const f = fixture(t);
  const a = await addTeamRepo(f.data, f.repo("alpha"));
  const b = await addTeamRepo(f.data, f.repo("beta"));
  const store = openTeamStore(teamDir(f.data));
  t.after(() => store.close());
  store.recordClaim(a.project, { taskId: "t1", claimId: "c1", number: 1, title: "T", story: { number: 1 } }, "claim");
  rmSync(a.project, { recursive: true });

  // The registered path as the person gives it: the folder is gone, so it cannot be resolved any further.
  await removeTeamRepo(f.data, a.project);
  assert.deepEqual(readTeam(f.data).repos, [b]);
  assert.equal(store.openClaim(), null, "nothing is left to heartbeat it or to block the next claim");
  const db = new DatabaseSync(join(teamDir(f.data), "team.sqlite"), { readOnly: true });
  try {
    assert.deepEqual(
      { ...db.prepare("SELECT state, reason FROM team_claims WHERE task_id = 't1'").get() },
      { state: "dropped", reason: "REPO_REMOVED" },
    );
  } finally {
    db.close();
  }
});

test("a gone repo that does not hold the open claim leaves another repo's record alone", async (t) => {
  const f = fixture(t);
  const a = await addTeamRepo(f.data, f.repo("alpha"));
  const b = await addTeamRepo(f.data, f.repo("beta"));
  const store = openTeamStore(teamDir(f.data));
  t.after(() => store.close());
  store.recordClaim(b.project, { taskId: "t1", claimId: "c1", number: 1, title: "T", story: { number: 1 } }, "claim");
  rmSync(a.project, { recursive: true });
  await removeTeamRepo(f.data, a.project);
  assert.deepEqual(readTeam(f.data).repos, [b]);
  assert.equal(store.openClaim().taskId, "t1");
});

test("a team Office still starting (start.lock) counts as running: add and remove are TEAM_RUNNING", async (t) => {
  const f = fixture(t);
  const a = f.repo("alpha"),
    b = f.repo("beta");
  const entry = await addTeamRepo(f.data, a);
  const lock = join(teamDir(f.data), "start.lock");
  mkdirSync(lock);
  assert.equal(teamRunning(f.data), true);
  await assert.rejects(addTeamRepo(f.data, b), { code: "TEAM_RUNNING" });
  await assert.rejects(removeTeamRepo(f.data, a), { code: "TEAM_RUNNING" });
  assert.deepEqual(readTeam(f.data).repos, [entry]);
  rmSync(lock, { recursive: true });
  assert.equal(teamRunning(f.data), false);
  await addTeamRepo(f.data, b);
});

test("remove opens no team database when there is none", async (t) => {
  const f = fixture(t);
  const a = await addTeamRepo(f.data, f.repo("alpha"));
  await removeTeamRepo(f.data, a.project);
  assert.deepEqual(readdirSync(teamDir(f.data)), ["team.json"]);
});

test("a registry that is not valid is INVALID rather than read as empty", async (t) => {
  const f = fixture(t);
  mkdirSync(teamDir(f.data), { recursive: true });
  const file = join(teamDir(f.data), "team.json");
  for (const text of [
    "not json",
    "[]",
    JSON.stringify({ version: 2, repos: [] }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, repos: [{ project: "/x" }] }),
    JSON.stringify({ version: 1, repos: [{ project: "/x", remote: 5 }] }),
  ]) {
    writeFileSync(file, text);
    assert.throws(() => readTeam(f.data), { code: "INVALID" }, text);
    assert.throws(() => inTeam(f.data, "/x"), { code: "INVALID" }, text);
  }
  assert.deepEqual(readTeam(fixture(t).data), { version: 1, repos: [] }, "no file is an empty registry");
});

test("team list prints the repos as JSON, with or without a project", async (t) => {
  const f = fixture(t);
  assert.deepEqual(team(f, "list").value, { repos: [] });
  const a = f.repo("alpha"),
    b = f.repo("beta");
  const added = team(f, "add", a);
  assert.equal(added.status, 0, JSON.stringify(added.value));
  assert.deepEqual(added.value, { project: realpathSync(a), remote: "github.example.com/team/alpha" });
  assert.equal(team(f, "add", b).status, 0);
  const expected = {
    repos: [
      { project: realpathSync(a), remote: "github.example.com/team/alpha" },
      { project: realpathSync(b), remote: "github.example.com/team/beta" },
    ],
  };
  const listed = team(f, "list");
  assert.equal(listed.status, 0);
  assert.deepEqual(listed.value, expected);
  assert.deepEqual(team(f, "list", a).value, expected, "list accepts --project and ignores it");
  const removed = team(f, "remove", a);
  assert.equal(removed.status, 0, JSON.stringify(removed.value));
  assert.deepEqual(removed.value, { removed: true });
  assert.deepEqual(team(f, "list").value.repos, [expected.repos[1]]);
});

test("team needs a known action, and add and remove need --project", (t) => {
  const f = fixture(t);
  for (const args of [
    ["team"],
    ["team", "frobnicate"],
    ["team", "add"],
    ["team", "remove"],
    ["team", "add", "--project", join(f.root, "x"), "--apply"],
    ["team", "list", "--lean"],
    ["team", "list", "--port", "1"],
  ]) {
    const r = call(f, ...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.value.code, "ARGUMENT", args.join(" "));
  }
  assert.equal(existsSync(f.data), false, "a refused command creates no data directory");
});

test("a registered repo cannot be started as a single Office; after remove it can", async (t) => {
  const f = fixture(t);
  const dir = f.repo("eevee-be", ORIGIN);
  const single = ["--project", dir];
  const p = locate(dir, f.data);
  t.after(async () => {
    const pids = existsSync(join(p.dataDir, "running.json")) ? [officePid(p.dataDir)] : [];
    call(f, "stop", ...single);
    await assertOfficesExited(pids);
  });
  assert.equal(call(f, "init", "--apply", ...single).status, 0);
  assert.equal(team(f, "add", dir).status, 0);

  const refused = call(f, "start", "--lean", "--port", "0", ...single);
  assert.equal(refused.status, 1, JSON.stringify(refused.value));
  assert.equal(refused.value.code, "IN_TEAM_OFFICE");
  for (const flags of [[], ["--claw"]]) {
    const other = call(f, "start", ...flags, "--port", "0", ...single);
    assert.equal(other.value.code, "IN_TEAM_OFFICE", flags.join(" "));
  }
  assert.equal(existsSync(join(p.dataDir, "start.lock")), false, "no start lock was taken");
  assert.equal(existsSync(join(p.dataDir, "running.json")), false, "nothing was started");
  assert.equal(existsSync(join(p.dataDir, "office.log")), false);
  // status and stop still work: a registered repo's Office can always be inspected.
  assert.equal(call(f, "status", ...single).value.status, "stopped");

  assert.equal(team(f, "remove", dir).status, 0);
  const started = call(f, "start", "--lean", "--port", "0", ...single);
  assert.equal(started.status, 0, JSON.stringify(started.value));
  assert.equal(started.value.engine, "lean");
  // A running single Office keeps the repo out of the team Office.
  const blocked = team(f, "add", dir);
  assert.equal(blocked.status, 1);
  assert.equal(blocked.value.code, "RUNNING");
  assert.equal(call(f, "stop", ...single).status, 0);
  assert.equal(team(f, "add", dir).status, 0);
});

// `up` reaches the team check before any VM, vendor or login step.
const appleSilicon = process.platform === "darwin" && process.arch === "arm64";
test(
  "up refuses a registered repo before installing anything into it",
  { skip: !appleSilicon && "up runs on Apple Silicon macOS only" },
  async (t) => {
    const f = fixture(t);
    const dir = f.repo("eevee-be", ORIGIN);
    assert.equal(team(f, "add", dir).status, 0);
    // An empty HOME and a PATH without runner CLIs: were the check missing, `up` would stop
    // at LOGIN_REQUIRED instead of reaching for the VM or the vendor install.
    const home = join(f.root, "home");
    mkdirSync(home);
    const env = { ...process.env, HOME: home, PATH: dirname(process.execPath) };
    for (const flags of [[], ["--lean"]]) {
      const r = spawnSync(
        process.execPath,
        [cli, "up", "--no-open", ...flags, "--project", dir, "--data-dir", f.data],
        { encoding: "utf8", timeout: 30000, env },
      );
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(JSON.parse(r.stderr).code, "IN_TEAM_OFFICE", flags.join(" "));
    }
    assert.equal(existsSync(join(dir, ".pazmo-office")), false, "the repo was not initialised");
    assert.equal(existsSync(locate(dir, f.data).dataDir), false);
  },
);

test("the help text names the team commands", () => {
  const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /team add/);
  assert.match(r.stdout, /team list/);
});
