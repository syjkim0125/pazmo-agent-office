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
  const repo = join(f.root, "eevee-be");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.example.com/team/eevee-be.git"]);
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
    claim: { taskId: "task-1", claimId: "claim-1", project: repo, title: "Task 1" },
    repos: [{ project: realpathSync(repo), remote: "github.example.com/team/eevee-be" }],
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
