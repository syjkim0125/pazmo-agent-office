import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { teamDir } from "../src/team/registry.ts";
import { localDay, openTeamStore } from "../src/team/store.ts";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const MINUTE = 60 * 1000;

/** A temp data directory; stores opened through `open` are closed afterwards. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-store-")));
  const f = { root, data: join(root, "data"), stores: [] };
  f.dir = teamDir(f.data);
  f.open = (now) => {
    const store = openTeamStore(f.dir, now);
    f.stores.push(store);
    return store;
  };
  t.after(() => {
    for (const store of f.stores) store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return f;
}

/** A small ClaimedTask-shaped value; no Hub is involved. */
function task(n, overrides = {}) {
  return {
    taskId: `task-${n}`,
    claimId: `claim-${n}`,
    kind: "work",
    number: n,
    title: `Task ${n}`,
    spec: "Add the endpoint.",
    files: ["src/a.ts"],
    verify: [{ id: "unit", argv: ["npm", "test"], timeoutMs: 60000 }],
    storyVerify: [],
    repoId: "repo-1",
    branch: `story/1/task-${n}`,
    story: {
      id: "story-1",
      number: 1,
      title: "Story",
      body: "Why.",
      risk: "normal",
      branches: [{ repoId: "repo-1", baseBranch: "main", storyBase: "story/1" }],
    },
    upstream: [],
    lastFailure: null,
    ...overrides,
  };
}

/** The real CLI, with --data-dir; JSON from stdout on success, stderr on failure. */
function call(f, ...args) {
  const r = spawnSync(process.execPath, [cli, "team", ...args, "--data-dir", f.data], {
    encoding: "utf8",
    timeout: 30000,
  });
  return { status: r.status, value: JSON.parse(r.status === 0 ? r.stdout : r.stderr) };
}

/** Every team_claims row, oldest first, read straight from the file. */
function rowsOf(f) {
  const probe = new DatabaseSync(join(f.dir, "team.sqlite"), { readOnly: true });
  try {
    return probe.prepare("SELECT * FROM team_claims ORDER BY id").all().map((r) => ({ ...r }));
  } finally {
    probe.close();
  }
}

/** The columns of team_claims as the database reports them, in name order. */
function columnsOf(file) {
  const probe = new DatabaseSync(file, { readOnly: true });
  try {
    return probe
      .prepare("PRAGMA table_info(team_claims)")
      .all()
      .map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    probe.close();
  }
}

/** What stage 2 created, before a Task had a phase: the file an Office that was not updated yet leaves behind. */
function writeStage2File(f, { openTask } = {}) {
  mkdirSync(f.dir, { recursive: true, mode: 0o700 });
  const file = join(f.dir, "team.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE team_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0, 1)),
      daily_cap INTEGER CHECK(daily_cap IS NULL OR daily_cap BETWEEN 1 AND 100)
    );
    INSERT INTO team_settings (id, paused, daily_cap) VALUES (1, 1, 7);
    CREATE TABLE team_claims (
      id INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      project TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('claim', 'recovered', 'rerun')),
      task_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open', 'dropped', 'done')),
      reason TEXT,
      at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX team_one_open ON team_claims((1)) WHERE state = 'open';
  `);
  const insert = db.prepare(
    "INSERT INTO team_claims (task_id, claim_id, project, day, source, task_json, state, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const today = localDay(Date.now());
  insert.run("task-1", "claim-1", "/repo/a", today, "claim", JSON.stringify(task(1)), "dropped", "NOT_YOURS", 1);
  insert.run("task-2", "claim-2", "/repo/a", today, "claim", JSON.stringify(task(2)), "done", null, 2);
  if (openTask) insert.run("task-3", "claim-3", "/repo/b", today, "claim", JSON.stringify(openTask), "open", null, 3);
  db.close();
  return file;
}

const MERGED = {
  kind: "merged",
  prUrl: "https://github.example.com/team/repo/pull/12",
  mergeCommit: "a".repeat(40),
  summary: "It adds the endpoint. It tests it. It documents it.",
  assumptions: ["ASSUMED: the page size is 20", "ASSUMED: ids are numeric"],
};
const FAILED = { kind: "failed", reason: "The verify command failed twice." };

test("a new store has the pause switch off and a daily cap of 5; settings persist across opens", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.deepEqual(store.settings(), { paused: false, dailyCap: 5 });
  store.setPaused(true);
  store.setDailyCap(12);
  assert.deepEqual(store.settings(), { paused: true, dailyCap: 12 });
  store.close();
  const again = f.open();
  assert.deepEqual(again.settings(), { paused: true, dailyCap: 12 }, "read back from the file");
  again.setPaused(false);
  again.setDailyCap(null);
  assert.deepEqual(again.settings(), { paused: false, dailyCap: null }, "null means no limit");
  again.setDailyCap(1);
  again.setDailyCap(100);
  assert.deepEqual(again.settings(), { paused: false, dailyCap: 100 }, "1 and 100 are the bounds");
});

test("a daily cap that is not an integer from 1 to 100 is INVALID and changes nothing", (t) => {
  const f = fixture(t);
  const store = f.open();
  for (const bad of [0, 101, 2.5, -1, NaN, Infinity, "3", undefined])
    assert.throws(() => store.setDailyCap(bad), { code: "INVALID" }, String(bad));
  assert.deepEqual(store.settings(), { paused: false, dailyCap: 5 });
});

test("the database is a private WAL file in the team directory and a symlink is refused", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.setPaused(true);
  const file = join(f.dir, "team.sqlite");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(f.dir).mode & 0o777, 0o700);
  const probe = new DatabaseSync(file, { readOnly: true });
  assert.equal(probe.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  probe.close();
  // The WAL sidecars hold the same rows, so they are private too.
  for (const suffix of ["-wal", "-shm"])
    assert.equal(statSync(file + suffix).mode & 0o777, 0o600, suffix);

  const g = fixture(t);
  mkdirSync(g.dir, { recursive: true });
  const target = join(g.root, "elsewhere.sqlite");
  symlinkSync(target, join(g.dir, "team.sqlite"));
  assert.throws(() => openTeamStore(g.dir), { code: "UNSAFE_PATH" });
  assert.equal(existsSync(target), false, "the link was not followed");

  const h = fixture(t);
  const realDir = join(h.root, "real");
  mkdirSync(realDir);
  mkdirSync(h.data);
  symlinkSync(realDir, h.dir);
  assert.throws(() => openTeamStore(h.dir), { code: "UNSAFE_PATH" });
  assert.equal(existsSync(join(realDir, "team.sqlite")), false, "the linked directory was not used");
});

test("only claims count today: recovered and rerun records are not counted", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.equal(store.claimedToday(), 0);
  store.recordClaim("/repo/a", task(1), "claim");
  store.dropClaim("task-1", "done with it");
  store.recordClaim("/repo/b", task(2), "recovered");
  store.dropClaim("task-2", "done with it");
  store.recordClaim("/repo/a", task(3), "claim");
  store.dropClaim("task-3", "done with it");
  store.recordClaim("/repo/a", task(3), "rerun");
  store.dropClaim("task-3", "done with it");
  assert.equal(store.claimedToday(), 2, "two claims; the recovered and the rerun are not new takes");
  // A claim taken and then dropped was still taken today.
  store.recordClaim("/repo/b", task(4), "claim");
  assert.equal(store.claimedToday(), 3);
});

test("the day is the PC's local day: a claim at 23:59 is not counted two minutes later", (t) => {
  const f = fixture(t);
  // Built from local-time components, so the test does not depend on the time zone.
  const before = new Date(2026, 0, 5, 23, 59).getTime();
  let clock = before;
  const store = f.open(() => clock);
  assert.equal(localDay(before), "2026-01-05");
  assert.equal(localDay(before + 2 * MINUTE), "2026-01-06");
  assert.notEqual(localDay(before), localDay(before + 2 * MINUTE));
  assert.equal(localDay(new Date(2026, 8, 7, 0, 0).getTime()), "2026-09-07", "month and day are zero padded");

  store.recordClaim("/repo/a", task(1), "claim");
  assert.equal(store.claimedToday(), 1);
  clock = before + 30 * 1000;
  assert.equal(store.claimedToday(), 1, "still the same local day");
  clock = before + 2 * MINUTE;
  assert.equal(store.claimedToday(), 0, "the cap resets at the local midnight");
  store.dropClaim("task-1", "finished");
  store.recordClaim("/repo/a", task(2), "claim");
  assert.equal(store.claimedToday(), 1, "only the new day's claim counts");
  clock = before; // and the earlier day still has its own count
  assert.equal(store.claimedToday(), 1, "yesterday's claim is yesterday's");
});

test("a second open claim is OPEN_CLAIM; after dropClaim the same task can be recorded again", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.equal(store.openClaim(), null);
  store.recordClaim("/repo/a", task(1), "claim");
  assert.throws(() => store.recordClaim("/repo/b", task(2), "claim"), { code: "OPEN_CLAIM" });
  assert.throws(() => store.recordClaim("/repo/a", task(1), "rerun"), { code: "OPEN_CLAIM" });
  assert.equal(store.openClaim().taskId, "task-1", "the open claim is untouched");
  assert.equal(store.claimedToday(), 1, "a refused record counts nothing");

  // Dropping some other task leaves the open claim alone.
  store.dropClaim("task-2", "not mine");
  assert.equal(store.openClaim().taskId, "task-1");

  store.dropClaim("task-1", "taken by the PL");
  assert.equal(store.openClaim(), null);
  store.recordClaim("/repo/a", task(1), "rerun");
  assert.deepEqual(
    { taskId: store.openClaim().taskId, claimId: store.openClaim().claimId },
    { taskId: "task-1", claimId: "claim-1" },
  );
});

test("the open claim comes back whole after a reopen, project and Task included", (t) => {
  const f = fixture(t);
  const claimed = task(7, { kind: "verify", repoId: null, branch: null, lastFailure: { reason: "red", memo: null } });
  const store = f.open();
  store.recordClaim("/repo/a", claimed, "recovered");
  store.close();
  const again = f.open();
  assert.deepEqual(again.openClaim(), {
    taskId: "task-7",
    claimId: "claim-7",
    project: "/repo/a",
    task: claimed,
    phase: "claimed",
    attempts: 0,
    engineTask: null,
    report: null,
    rerunMemo: null,
    buildingSince: null,
    lastFailure: null,
    unlockOwed: false,
    pushedSha: null,
    runnerWait: null,
  });
});

test("two handles on one file see one open claim; the database itself refuses a second", (t) => {
  const f = fixture(t);
  const a = f.open();
  const b = f.open();
  a.recordClaim("/repo/a", task(1), "claim");
  assert.throws(() => b.recordClaim("/repo/b", task(2), "claim"), { code: "OPEN_CLAIM" });
  assert.equal(b.openClaim().taskId, "task-1");
  b.dropClaim("task-1", "dropped elsewhere");
  assert.equal(a.openClaim(), null);

  // Even a writer that skips the store's check cannot open two.
  a.recordClaim("/repo/a", task(2), "claim");
  const raw = new DatabaseSync(join(f.dir, "team.sqlite"));
  t.after(() => raw.close());
  assert.throws(
    () =>
      raw
        .prepare(
          "INSERT INTO team_claims (task_id, claim_id, project, day, source, task_json, state, at) VALUES ('x','y','/p','2026-01-01','claim','{}','open',0)",
        )
        .run(),
    /UNIQUE/,
  );
});

test("the clock default is the real time, so a fresh claim counts today", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  assert.equal(store.claimedToday(), 1);
  const probe = new DatabaseSync(join(f.dir, "team.sqlite"), { readOnly: true });
  const row = probe.prepare("SELECT day, at FROM team_claims").get();
  probe.close();
  assert.equal(row.day, localDay(Date.now()));
  assert.ok(Math.abs(row.at - Date.now()) < 60000);
});

test("CLI: pause, resume, cap and status change the same database, with no Office running", (t) => {
  const f = fixture(t);
  assert.deepEqual(call(f, "status"), {
    status: 0,
    value: { paused: false, dailyCap: 5, today: 0, claim: null, repos: [] },
  });
  assert.deepEqual(call(f, "pause"), { status: 0, value: { paused: true, dailyCap: 5 } });
  assert.deepEqual(call(f, "cap", "3"), { status: 0, value: { paused: true, dailyCap: 3 } });
  assert.deepEqual(call(f, "status").value, { paused: true, dailyCap: 3, today: 0, claim: null, repos: [] });
  assert.deepEqual(call(f, "resume"), { status: 0, value: { paused: false, dailyCap: 3 } });
  assert.deepEqual(call(f, "cap", "off"), { status: 0, value: { paused: false, dailyCap: null } });
  assert.deepEqual(call(f, "status").value.dailyCap, null);
  // The same file a store opens.
  const store = f.open();
  assert.deepEqual(store.settings(), { paused: false, dailyCap: null });
  store.setPaused(true);
  assert.equal(call(f, "status").value.paused, true, "the CLI reads what a store wrote");
  assert.equal(statSync(join(f.dir, "team.sqlite")).mode & 0o777, 0o600);
});

test("CLI: cap rejects 0, 101, 2.5, words and a missing value, and keeps the old cap", (t) => {
  const f = fixture(t);
  assert.equal(call(f, "cap", "4").status, 0);
  for (const bad of ["0", "101", "2.5", "-3", "abc", "OFF", "1e1", "0x10"]) {
    const r = call(f, "cap", bad);
    assert.equal(r.status, 1, bad);
    assert.equal(r.value.code, "INVALID", bad);
  }
  const missing = call(f, "cap");
  assert.equal(missing.status, 1);
  assert.equal(missing.value.code, "ARGUMENT");
  assert.equal(call(f, "status").value.dailyCap, 4);
});

test("CLI: status shows today's claims, the open claim and the registered repos", (t) => {
  const f = fixture(t);
  const repo = join(f.root, "app-be");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.example.com/team/app-be.git"]);
  const added = call(f, "add", "--project", repo);
  assert.equal(added.status, 0);

  const store = f.open();
  store.recordClaim(repo, task(1), "claim");
  const status = call(f, "status");
  assert.equal(status.status, 0);
  assert.deepEqual(status.value, {
    paused: false,
    dailyCap: 5,
    today: 1,
    claim: { taskId: "task-1", claimId: "claim-1", project: repo, title: "Task 1", phase: "claimed", attempts: 0, waiting: null },
    repos: [{ project: realpathSync(repo), remote: "github.example.com/team/app-be" }],
  });
  assert.equal(JSON.stringify(status.value).includes("Add the endpoint."), false, "the Task spec is not printed");
});

test("CLI: pause, resume and status take no --project, and an unknown action is ARGUMENT", (t) => {
  const f = fixture(t);
  // --project is accepted and ignored, as `team list` does.
  assert.equal(call(f, "pause", "--project", join(f.root, "none")).status, 0);
  const unknown = call(f, "freeze");
  assert.equal(unknown.status, 1);
  assert.equal(unknown.value.code, "ARGUMENT");
});

test("a stage-2 team.sqlite opens and gains the new columns with phase claimed", (t) => {
  const f = fixture(t);
  const file = writeStage2File(f, { openTask: task(3) });
  const before = columnsOf(file).map((c) => c.name);
  const stage3 = ["phase", "attempts", "engine_task", "report_json", "rerun_memo", "building_since", "last_failure_json", "unlock_owed", "pushed_sha", "runner_wait_json"];
  for (const name of stage3) assert.equal(before.includes(name), false, `${name} is stage 3's`);

  const store = f.open();
  assert.deepEqual(columnsOf(file).map((c) => c.name).sort(), [...before, ...stage3].sort());
  assert.deepEqual(store.openClaim(), {
    taskId: "task-3",
    claimId: "claim-3",
    project: "/repo/b",
    task: task(3),
    phase: "claimed",
    attempts: 0,
    engineTask: null,
    report: null,
    rerunMemo: null,
    buildingSince: null,
    lastFailure: null,
    unlockOwed: false,
    pushedSha: null,
    runnerWait: null,
  });
  assert.deepEqual(store.settings(), { paused: true, dailyCap: 7 }, "the settings row is untouched");
  assert.equal(store.claimedToday(), 3, "the old records still count as before");
  assert.deepEqual(
    rowsOf(f).map((r) => [r.task_id, r.state, r.phase, r.attempts]),
    [["task-1", "dropped", "claimed", 0], ["task-2", "done", "claimed", 0], ["task-3", "open", "claimed", 0]],
  );

  // The migrated record is a normal one, and opening the file again changes nothing.
  store.setPhase("task-3", "building", { engineTask: "eng-3", attempts: 1 });
  store.close();
  const again = f.open();
  const open = again.openClaim();
  assert.deepEqual(
    { phase: open.phase, attempts: open.attempts, engineTask: open.engineTask },
    { phase: "building", attempts: 1, engineTask: "eng-3" },
  );
});

test("a stage-2 file without an open record opens too, and a fresh file ends with the same columns", (t) => {
  const f = fixture(t);
  const old = writeStage2File(f);
  const store = f.open();
  assert.equal(store.openClaim(), null);
  store.recordClaim("/repo/a", task(9), "claim");
  assert.equal(store.openClaim().phase, "claimed");
  store.close();
  const migrated = columnsOf(old);

  const g = fixture(t);
  g.open().close();
  assert.deepEqual(columnsOf(join(g.dir, "team.sqlite")), migrated, "one definition of the columns, however the file began");
  const phase = migrated.find((c) => c.name === "phase");
  assert.deepEqual(
    { type: phase.type, notnull: phase.notnull, dflt_value: phase.dflt_value },
    { type: "TEXT", notnull: 1, dflt_value: "'claimed'" },
  );

  // The database itself refuses a phase that is not one of the six, and a negative count.
  g.open().recordClaim("/repo/a", task(1), "claim");
  const raw = new DatabaseSync(join(g.dir, "team.sqlite"));
  t.after(() => raw.close());
  assert.throws(() => raw.prepare("UPDATE team_claims SET phase = 'finished'").run(), /CHECK/);
  assert.throws(() => raw.prepare("UPDATE team_claims SET attempts = -1").run(), /CHECK/);
});

test("setPhase moves the open record, patches attempts and the engine task, and leaves other records alone", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  for (const phase of ["claimed", "building", "verified", "merging", "reporting", "failed"]) {
    store.setPhase("task-1", phase);
    assert.equal(store.openClaim().phase, phase);
  }
  store.setPhase("task-1", "building", { engineTask: "eng-1", attempts: 2 });
  assert.deepEqual(
    { phase: store.openClaim().phase, attempts: store.openClaim().attempts, engineTask: store.openClaim().engineTask },
    { phase: "building", attempts: 2, engineTask: "eng-1" },
  );
  store.setPhase("task-1", "verified", {});
  assert.equal(store.openClaim().engineTask, "eng-1", "a key that is not in the patch stays as it was");
  assert.equal(store.openClaim().attempts, 2);
  store.setPhase("task-1", "building", { attempts: 3 });
  assert.equal(store.openClaim().engineTask, "eng-1");
  store.setPhase("task-1", "building", { engineTask: null });
  assert.equal(store.openClaim().engineTask, null, "null clears the engine task");
  assert.equal(store.openClaim().attempts, 3);

  // Another Task, or no open record at all, changes nothing (as dropClaim).
  store.setPhase("task-2", "failed", { attempts: 1, engineTask: "x" });
  assert.deepEqual(
    { phase: store.openClaim().phase, attempts: store.openClaim().attempts },
    { phase: "building", attempts: 3 },
  );
  store.dropClaim("task-1", "taken by the PL");
  store.setPhase("task-1", "failed", { attempts: 1 });
  assert.equal(store.openClaim(), null);
  assert.deepEqual(
    rowsOf(f).map((r) => [r.state, r.phase, r.attempts]),
    [["dropped", "building", 3]],
    "a closed record is not edited",
  );
});

test("setPhase refuses an unknown phase and a bad patch as INVALID and changes nothing", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  store.setPhase("task-1", "building", { engineTask: "eng-1", attempts: 1 });
  for (const phase of ["finished", "", "Building", undefined, null, 3])
    assert.throws(() => store.setPhase("task-1", phase), { code: "INVALID" }, String(phase));
  for (const attempts of [-1, 1.5, NaN, Infinity, "2", null])
    assert.throws(() => store.setPhase("task-1", "failed", { attempts }), { code: "INVALID" }, String(attempts));
  for (const engineTask of [5, {}, ""])
    assert.throws(() => store.setPhase("task-1", "failed", { engineTask }), { code: "INVALID" }, String(engineTask));
  const open = store.openClaim();
  assert.deepEqual(
    { phase: open.phase, attempts: open.attempts, engineTask: open.engineTask },
    { phase: "building", attempts: 1, engineTask: "eng-1" },
  );
});

test("setPhase keeps the build start and the last failure until a patch changes them, and both survive a reopen", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  assert.deepEqual([store.openClaim().buildingSince, store.openClaim().lastFailure], [null, null]);

  store.setPhase("task-1", "building", { engineTask: "eng-1", buildingSince: 1_700_000_000_000 });
  const failure = { reason: "Merging feature/story-1/base conflicted.", conflict: ["src/a.ts", "README.md"] };
  store.setPhase("task-1", "claimed", { attempts: 1, lastFailure: failure });
  assert.equal(store.openClaim().buildingSince, 1_700_000_000_000, "a key that is not in the patch stays as it was");
  assert.deepEqual(store.openClaim().lastFailure, failure);
  store.setPhase("task-1", "building", { buildingSince: 1_700_000_100_000 });
  store.close();

  const again = f.open();
  assert.deepEqual(
    [again.openClaim().buildingSince, again.openClaim().lastFailure],
    [1_700_000_100_000, failure],
    "a restart neither resets the build clock nor loses why the last attempt failed",
  );
  again.setPhase("task-1", "claimed", { buildingSince: null, lastFailure: null });
  assert.deepEqual([again.openClaim().buildingSince, again.openClaim().lastFailure], [null, null], "null clears them");
});

test("setPhase records an owed merge unlock until a patch clears it, across a reopen, and refuses a non-boolean", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  assert.equal(store.openClaim().unlockOwed, false);
  store.setPhase("task-1", "claimed", { attempts: 1, unlockOwed: true });
  store.setPhase("task-1", "building", { engineTask: "eng-2" });
  assert.equal(store.openClaim().unlockOwed, true, "a key that is not in the patch stays as it was");
  store.close();
  const again = f.open();
  assert.equal(again.openClaim().unlockOwed, true, "a restart still owes the Hub the unlock");
  for (const unlockOwed of [1, 0, "true", null])
    assert.throws(() => again.setPhase("task-1", "building", { unlockOwed }), { code: "INVALID" }, String(unlockOwed));
  again.setPhase("task-1", "building", { unlockOwed: false });
  assert.equal(again.openClaim().unlockOwed, false);
});

test("setPhase records the Task branch head the Office pushed until a patch changes it, across a reopen, and refuses anything but a full commit id", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  assert.equal(store.openClaim().pushedSha, null);
  store.setPhase("task-1", "verified", { pushedSha: "c".repeat(40) });
  store.setPhase("task-1", "merging");
  assert.equal(store.openClaim().pushedSha, "c".repeat(40), "a key that is not in the patch stays as it was");
  store.setPhase("task-1", "merging", { pushedSha: "d".repeat(64) });
  store.close();
  const again = f.open();
  assert.equal(again.openClaim().pushedSha, "d".repeat(64), "a restart still knows what was pushed");
  for (const pushedSha of ["c".repeat(39), "C".repeat(40), "g".repeat(40), "", 5, "c".repeat(41)])
    assert.throws(() => again.setPhase("task-1", "merging", { pushedSha }), { code: "INVALID" }, String(pushedSha));
  assert.equal(again.openClaim().pushedSha, "d".repeat(64));
  again.setPhase("task-1", "claimed", { pushedSha: null });
  assert.equal(again.openClaim().pushedSha, null, "null clears it");
});

test("setPhase records the runner wait until a patch clears it, across a reopen; a bad one is INVALID and an unreadable copy is none", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  assert.equal(store.openClaim().runnerWait, null);
  const wait = { runner: "claude", kind: "limit", message: "You've hit your limit", since: 1000, retryAt: 1_801_000, runs: 1 };
  store.setPhase("task-1", "claimed", { runnerWait: wait });
  store.setPhase("task-1", "claimed", { buildingSince: null });
  assert.deepEqual(store.openClaim().runnerWait, wait, "a key that is not in the patch stays as it was");
  store.close();
  const again = f.open();
  assert.deepEqual(again.openClaim().runnerWait, wait, "a restart still waits");
  for (const runnerWait of [
    "limit",
    {},
    { ...wait, runner: "gemini" },
    { ...wait, kind: "crash" },
    { ...wait, message: 5 },
    { ...wait, message: "x".repeat(301) },
    { ...wait, since: -1 },
    { ...wait, retryAt: 1.5 },
    { ...wait, runs: 0 },
    { ...wait, extra: true },
  ])
    assert.throws(() => again.setPhase("task-1", "claimed", { runnerWait }), { code: "INVALID" }, JSON.stringify(runnerWait));
  assert.deepEqual(again.openClaim().runnerWait, wait);
  again.setPhase("task-1", "building", { runnerWait: null });
  assert.equal(again.openClaim().runnerWait, null, "null clears it");
  // An unreadable copy is no wait, not an error: the next run finds out again.
  again.setPhase("task-1", "claimed", { runnerWait: wait });
  const raw = new DatabaseSync(join(f.dir, "team.sqlite"));
  t.after(() => raw.close());
  raw.prepare("UPDATE team_claims SET runner_wait_json = '{not json' WHERE state = 'open'").run();
  assert.equal(again.openClaim().runnerWait, null);
});

test("setPhase refuses a bad build start or last failure as INVALID and changes nothing", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  const failure = { reason: "verify failed", conflict: [] };
  store.setPhase("task-1", "building", { buildingSince: 10, lastFailure: failure });
  for (const buildingSince of [-1, 1.5, NaN, Infinity, "10", {}])
    assert.throws(() => store.setPhase("task-1", "claimed", { buildingSince }), { code: "INVALID" }, String(buildingSince));
  for (const lastFailure of [
    "verify failed",
    {},
    { reason: 5, conflict: [] },
    { reason: "x" },
    { reason: "x", conflict: "src/a.ts" },
    { reason: "x", conflict: [1] },
    { reason: "x".repeat(4001), conflict: [] },
    { reason: "x", conflict: Array.from({ length: 1001 }, (_, i) => `f${i}`) },
  ])
    assert.throws(() => store.setPhase("task-1", "claimed", { lastFailure }), { code: "INVALID" }, JSON.stringify(lastFailure)?.slice(0, 60));
  const open = store.openClaim();
  assert.deepEqual([open.phase, open.buildingSince, open.lastFailure], ["building", 10, failure]);
  // A stored failure that cannot be read is no failure, not an error: it only feeds the next contract's notes.
  const raw = new DatabaseSync(join(f.dir, "team.sqlite"));
  t.after(() => raw.close());
  raw.prepare("UPDATE team_claims SET last_failure_json = '{not json' WHERE state = 'open'").run();
  assert.equal(store.openClaim().lastFailure, null);
});

test("a merged report survives a reopen and finishClaim closes the record as done", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  store.setPhase("task-1", "reporting", { engineTask: "eng-1", attempts: 2 });
  store.setReport("task-1", MERGED);
  assert.deepEqual(store.openClaim().report, MERGED);
  store.close();

  const again = f.open();
  const open = again.openClaim();
  assert.deepEqual(open.report, MERGED, "the outbox is read back from the file");
  assert.deepEqual(
    { phase: open.phase, attempts: open.attempts, engineTask: open.engineTask, claimId: open.claimId },
    { phase: "reporting", attempts: 2, engineTask: "eng-1", claimId: "claim-1" },
  );

  again.finishClaim("task-2"); // some other Task: nothing happens
  assert.equal(again.openClaim().taskId, "task-1");
  again.finishClaim("task-1");
  assert.equal(again.openClaim(), null, "the record is closed");
  assert.deepEqual(rowsOf(f).map((r) => r.state), ["done"]);
  assert.equal(again.claimedToday(), 1, "a finished Task was still taken today");
  again.finishClaim("task-1"); // twice is harmless
  again.recordClaim("/repo/a", task(2), "claim");
  assert.equal(again.openClaim().taskId, "task-2", "the next Task can be recorded");
  assert.equal(again.openClaim().report, null, "a new record starts without a report");
});

test("a failed report round-trips, null clears it, and the stored copy keeps only the report's own fields", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  store.setReport("task-1", FAILED);
  assert.deepEqual(store.openClaim().report, FAILED);
  store.setReport("task-1", MERGED);
  assert.deepEqual(store.openClaim().report, MERGED, "a later report replaces the earlier one");
  store.setReport("task-1", null);
  assert.equal(store.openClaim().report, null);
  assert.equal(rowsOf(f)[0].report_json, null, "cleared in the file, not stored as the text null");

  store.setReport("task-1", { ...FAILED, extra: "x", at: 5 });
  assert.deepEqual(store.openClaim().report, FAILED);
  assert.deepEqual(Object.keys(JSON.parse(rowsOf(f)[0].report_json)).sort(), ["kind", "reason"]);

  // Another Task, or a closed record, takes nothing.
  store.setReport("task-2", MERGED);
  assert.deepEqual(store.openClaim().report, FAILED);
  store.dropClaim("task-1", "taken by the PL");
  store.setReport("task-1", MERGED);
  assert.equal(JSON.parse(rowsOf(f)[0].report_json).kind, "failed", "a closed record is not edited");
});

test("a report at the limits is stored; one outside them or of the wrong shape is INVALID and changes nothing", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  const host = "https://github.example.com/";
  const longest = {
    kind: "merged",
    prUrl: host + "p".repeat(500 - host.length),
    mergeCommit: "f".repeat(64),
    summary: "s".repeat(4000),
    assumptions: Array.from({ length: 50 }, () => "a".repeat(500)),
  };
  store.setReport("task-1", longest);
  assert.deepEqual(store.openClaim().report, longest, "the Hub's limits are the store's limits");
  store.setReport("task-1", { kind: "failed", reason: "r".repeat(4000) });
  assert.equal(store.openClaim().report.reason.length, 4000);
  store.setReport("task-1", FAILED);

  const bad = [
    undefined,
    "failed",
    42,
    [],
    {},
    { kind: "other" },
    { kind: "failed" },
    { kind: "failed", reason: 5 },
    { kind: "failed", reason: "r".repeat(4001) },
    { ...MERGED, kind: undefined },
    { ...MERGED, prUrl: undefined },
    { ...MERGED, prUrl: "" },
    { ...MERGED, prUrl: 5 },
    { ...MERGED, prUrl: host + "p".repeat(500) },
    // The Hub takes only an https address with a host, no account part, and nothing a page or log could trip on.
    { ...MERGED, prUrl: "http://github.example.com/team/repo/pull/12" },
    { ...MERGED, prUrl: "github.example.com/team/repo/pull/12" },
    { ...MERGED, prUrl: "https://" },
    { ...MERGED, prUrl: "https://user@github.example.com/team/repo/pull/12" },
    { ...MERGED, prUrl: "https://user:token@github.example.com/team/repo/pull/12" },
    { ...MERGED, prUrl: "https://github.example.com/team/repo/pull/12 x" },
    { ...MERGED, prUrl: "https://github.example.com/team/repo/pull/12\n" },
    { ...MERGED, prUrl: 'https://github.example.com/"team"/pull/12' },
    { ...MERGED, prUrl: "https://github.example.com/<team>/pull/12" },
    { ...MERGED, mergeCommit: undefined },
    { ...MERGED, mergeCommit: "abc123" },
    { ...MERGED, mergeCommit: "A".repeat(40) },
    { ...MERGED, mergeCommit: "a".repeat(41) },
    { ...MERGED, summary: undefined },
    { ...MERGED, summary: 5 },
    { ...MERGED, summary: "s".repeat(4001) },
    { ...MERGED, assumptions: undefined },
    { ...MERGED, assumptions: "ASSUMED: one" },
    { ...MERGED, assumptions: ["ASSUMED: one", 2] },
    { ...MERGED, assumptions: Array.from({ length: 51 }, () => "a") },
    { ...MERGED, assumptions: ["a".repeat(501)] },
  ];
  for (const report of bad)
    assert.throws(() => store.setReport("task-1", report), { code: "INVALID" }, JSON.stringify(report)?.slice(0, 80));
  assert.deepEqual(store.openClaim().report, FAILED, "every refusal left the report as it was");
});

test("refusedClaim finds the Task of a claim whose last record was dropped because the Hub refused its report for good", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.equal(store.refusedClaim("task-1", "claim-1"), null);
  store.recordClaim("/repo/a", task(1), "claim");
  assert.equal(store.refusedClaim("task-1", "claim-1"), null, "an open record is not refused");
  store.dropClaim("task-1", "HUB_REFUSED_REPORT");
  assert.deepEqual(store.refusedClaim("task-1", "claim-1"), task(1));
  assert.equal(store.refusedClaim("task-1", "claim-other"), null, "another claim of the Task is not");
  assert.equal(store.refusedClaim("task-2", "claim-1"), null);

  // Another reason, or a later record of the same claim, is not a refusal any more.
  store.recordClaim("/repo/a", task(2), "claim");
  store.dropClaim("task-2", "NOT_FOUND");
  assert.equal(store.refusedClaim("task-2", "claim-2"), null);
  store.recordClaim("/repo/a", task(1), "recovered");
  assert.equal(store.refusedClaim("task-1", "claim-1"), null);
  store.finishClaim("task-1");
  assert.equal(store.refusedClaim("task-1", "claim-1"), null);
  store.close();
  const again = f.open();
  again.recordClaim("/repo/a", task(3), "claim");
  again.dropClaim("task-3", "HUB_REFUSED_REPORT");
  again.close();
  assert.deepEqual(f.open().refusedClaim("task-3", "claim-3"), task(3), "it survives a restart");
});

test("an unreadable stored report is an error, not a missing report", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  store.setReport("task-1", MERGED);
  const raw = new DatabaseSync(join(f.dir, "team.sqlite"));
  t.after(() => raw.close());
  const corrupt = [
    "not json",
    "null",
    "[]",
    '"merged"',
    '{"kind":"merged"}',
    '{"kind":"failed","reason":5}',
    JSON.stringify({ ...MERGED, mergeCommit: "nope" }),
    JSON.stringify({ ...MERGED, assumptions: [1] }),
    JSON.stringify({ kind: "failed", reason: "r".repeat(4001) }),
  ];
  for (const text of corrupt) {
    raw.prepare("UPDATE team_claims SET report_json = ?").run(text);
    assert.throws(() => store.openClaim(), { code: "INVALID", message: /task-1/ }, text.slice(0, 40));
  }
  raw.prepare("UPDATE team_claims SET report_json = ?").run(JSON.stringify(FAILED));
  assert.deepEqual(store.openClaim().report, FAILED, "and a good one reads again");
  raw.prepare("UPDATE team_claims SET report_json = NULL").run();
  assert.equal(store.openClaim().report, null);
});

test("requestRerun refuses NO_FAILED_CLAIM unless the open record failed", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.throws(() => store.requestRerun("try again"), { code: "NO_FAILED_CLAIM" }, "no record at all");
  store.recordClaim("/repo/a", task(1), "claim");
  for (const phase of ["claimed", "building", "verified", "merging", "reporting"]) {
    store.setPhase("task-1", phase);
    assert.throws(() => store.requestRerun("try again"), { code: "NO_FAILED_CLAIM" }, phase);
    assert.equal(store.openClaim().rerunMemo, null, `${phase}: nothing was written`);
  }
  store.setPhase("task-1", "failed");
  store.requestRerun("the fixture file was wrong; it is fixed now");
  assert.equal(store.openClaim().rerunMemo, "the fixture file was wrong; it is fixed now");
  store.requestRerun("second thought");
  assert.equal(store.openClaim().rerunMemo, "second thought", "the latest request wins");
  store.close();

  const again = f.open();
  assert.equal(again.openClaim().rerunMemo, "second thought", "the request waits in the file for the Office");
  // A closed failed record is no failed claim either.
  again.dropClaim("task-1", "taken by the PL");
  assert.throws(() => again.requestRerun("again"), { code: "NO_FAILED_CLAIM" });
});

test("requestRerun takes a memo of up to 2000 characters, an empty one as a request without a note, and nothing else", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  store.setPhase("task-1", "failed");
  store.requestRerun("m".repeat(2000));
  assert.equal(store.openClaim().rerunMemo.length, 2000);
  for (const memo of ["m".repeat(2001), undefined, null, 5, {}, ["x"]])
    assert.throws(() => store.requestRerun(memo), { code: "INVALID" }, String(memo).slice(0, 20));
  assert.equal(store.openClaim().rerunMemo.length, 2000, "a refused memo changed nothing");
  store.requestRerun("");
  assert.equal(store.openClaim().rerunMemo, "", "a request with no note still is a request");
  assert.equal(store.takeRerun("task-1"), "");
});

test("takeRerun hands the memo over once and only for its own Task", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.equal(store.takeRerun("task-1"), null, "no record");
  store.recordClaim("/repo/a", task(1), "claim");
  store.setPhase("task-1", "failed");
  assert.equal(store.takeRerun("task-1"), null, "failed but nobody asked");
  store.requestRerun("fixed the fixture");
  assert.equal(store.takeRerun("task-2"), null, "another Task's id gets nothing");
  assert.equal(store.openClaim().rerunMemo, "fixed the fixture", "and does not consume the request");
  assert.equal(store.takeRerun("task-1"), "fixed the fixture");
  assert.equal(store.openClaim().rerunMemo, null);
  assert.equal(store.takeRerun("task-1"), null, "taken once");
  assert.equal(store.openClaim().phase, "failed", "taking the memo does not move the phase");
});

test("replaceClaim keeps one open record, resets attempts and leaves claimedToday unchanged", (t) => {
  const f = fixture(t);
  const store = f.open();
  store.recordClaim("/repo/a", task(1), "claim");
  store.setPhase("task-1", "building", {
    engineTask: "eng-1",
    attempts: 3,
    buildingSince: 5,
    lastFailure: { reason: "verify failed", conflict: ["src/a.ts"] },
    unlockOwed: true,
  });
  store.setPhase("task-1", "failed");
  store.setReport("task-1", FAILED);
  store.requestRerun("fixed the fixture");
  assert.equal(store.claimedToday(), 1);

  const again = task(1, { claimId: "claim-1b", lastFailure: { reason: FAILED.reason, memo: "fixed the fixture" } });
  store.replaceClaim("task-1", again);
  assert.deepEqual(store.openClaim(), {
    taskId: "task-1",
    claimId: "claim-1b",
    project: "/repo/a",
    task: again,
    phase: "claimed",
    attempts: 0,
    engineTask: null,
    report: null,
    rerunMemo: null,
    buildingSince: null,
    lastFailure: null,
    unlockOwed: false,
    pushedSha: null,
    runnerWait: null,
  });
  assert.equal(store.claimedToday(), 1, "a rerun is not a new take");
  assert.equal(rowsOf(f).filter((r) => r.state === "open").length, 1, "exactly one open record");
  assert.throws(() => store.recordClaim("/repo/b", task(2), "claim"), { code: "OPEN_CLAIM" }, "and it still blocks the next claim");

  // The old claim stays on file as a dropped record; the new one is a rerun.
  assert.deepEqual(
    rowsOf(f).map((r) => [r.task_id, r.claim_id, r.source, r.state, r.reason]),
    [["task-1", "claim-1", "claim", "dropped", "RERUN"], ["task-1", "claim-1b", "rerun", "open", null]],
  );

  // It survives a reopen and works like any open record: another failure, another rerun.
  store.close();
  const reopened = f.open();
  assert.equal(reopened.openClaim().claimId, "claim-1b");
  reopened.setPhase("task-1", "failed", { attempts: 3 });
  reopened.requestRerun("one more time");
  reopened.replaceClaim("task-1", task(1, { claimId: "claim-1c" }));
  assert.equal(reopened.openClaim().claimId, "claim-1c");
  assert.equal(reopened.openClaim().attempts, 0);
  assert.equal(reopened.claimedToday(), 1);
  assert.equal(rowsOf(f).length, 3);
});

test("replaceClaim on another local day still counts nothing: the rerun is no new take", (t) => {
  const f = fixture(t);
  let clock = new Date(2026, 0, 5, 23, 59).getTime();
  const store = f.open(() => clock);
  store.recordClaim("/repo/a", task(1), "claim");
  store.setPhase("task-1", "failed");
  clock += 2 * MINUTE; // after midnight
  assert.equal(store.claimedToday(), 0);
  store.replaceClaim("task-1", task(1, { claimId: "claim-1b" }));
  assert.equal(store.claimedToday(), 0, "the new day's cap is not used up by a rerun");
  assert.equal(rowsOf(f)[1].day, localDay(clock), "the new record is of the day it was made");
  clock -= 2 * MINUTE;
  assert.equal(store.claimedToday(), 1, "and yesterday's claim is still yesterday's");
});

test("replaceClaim without a failed record of that Task is NO_FAILED_CLAIM, and a Task with another id is INVALID", (t) => {
  const f = fixture(t);
  const store = f.open();
  assert.throws(() => store.replaceClaim("task-1", task(1, { claimId: "claim-1b" })), { code: "NO_FAILED_CLAIM" }, "no record");
  store.recordClaim("/repo/a", task(1), "claim");
  for (const phase of ["claimed", "building", "verified", "merging", "reporting"]) {
    store.setPhase("task-1", phase, { attempts: 2 });
    assert.throws(() => store.replaceClaim("task-1", task(1, { claimId: "claim-1b" })), { code: "NO_FAILED_CLAIM" }, phase);
  }
  store.setPhase("task-1", "failed");
  assert.throws(() => store.replaceClaim("task-2", task(2, { claimId: "claim-2b" })), { code: "NO_FAILED_CLAIM" }, "the failed record is another Task's");
  assert.throws(() => store.replaceClaim("task-1", task(2, { claimId: "claim-2b" })), { code: "INVALID" }, "a rerun keeps the Hub task id");
  assert.throws(() => store.replaceClaim("task-1", { ...task(1), claimId: undefined }), { code: "INVALID" }, "the new claim id is needed");
  assert.throws(() => store.replaceClaim("task-1", null), { code: "INVALID" });
  const open = store.openClaim();
  assert.deepEqual(
    { claimId: open.claimId, phase: open.phase, attempts: open.attempts },
    { claimId: "claim-1", phase: "failed", attempts: 2 },
    "every refusal left the failed record as it was",
  );
  assert.equal(rowsOf(f).length, 1);
});
