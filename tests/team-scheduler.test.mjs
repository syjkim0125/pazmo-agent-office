import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createClaimScheduler } from "../src/team/scheduler.ts";
import { storyLink } from "../src/team/story-link.ts";
import { openTeamStore } from "../src/team/store.ts";
import { hubWithStory } from "./team-fixture.mjs";

const hubError = (status, code, expected) => Object.assign(new Error(code), { status, code, expected });
const NOT_YOURS = () => hubError(409, "NOT_YOURS");
const STATE = () => hubError(409, "STATE");
const UNAUTHORIZED = () => hubError(401, "UNAUTHORIZED");
const NOT_FOUND = () => hubError(404, "NOT_FOUND");
const NETWORK = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

/** A ClaimedTask-shaped value; the scheduler only needs the two ids. */
const taskOf = (n, overrides = {}) => ({
  taskId: `task-${n}`, claimId: `claim-${n}`, kind: "work", number: n, title: `Task ${n}`, spec: "", files: [],
  verify: [], storyVerify: [], repoId: "repo", branch: `feature/story-1/task-${n}`,
  story: { id: "story", number: 1, title: "Story", body: "", risk: "normal", branches: [] },
  upstream: [], lastFailure: null, ...overrides,
});
const mineOf = (n, state = "claimed") => ({ taskId: `task-${n}`, claimId: `claim-${n}`, storyId: "story", state });
/** The open record of a Task just taken: not started, no attempts, nothing to report. */
const openOf = (project, n) => ({
  taskId: `task-${n}`, claimId: `claim-${n}`, project, task: taskOf(n),
  phase: "claimed", attempts: 0, engineTask: null, report: null, rerunMemo: null, buildingSince: null, lastFailure: null, unlockOwed: false, pushedSha: null,
});
const emptyInbox = { mine: null, alerts: [], verifyReady: [] };
/** A merged report the Hub has not been told yet, as the executor leaves it in the record. */
const MERGED = {
  kind: "merged", prUrl: "https://github.example.com/team/be/pull/7", mergeCommit: "a".repeat(40),
  summary: "[변경사항]\n1. 작업\n2. 파일\n3. 확인", assumptions: ["ASSUMED: code is upper case"],
};
/** The open record of Task `n`, taken and then moved to `phase` with `report` still to send. */
const hold = (f, project, n, phase, report = null) => {
  f.store.recordClaim(project, taskOf(n), "claim");
  f.store.setPhase(`task-${n}`, phase);
  if (report) f.store.setReport(`task-${n}`, report);
  return f.store.openClaim();
};

/**
 * A fake StoryLink. `script[name]` is a value, an Error (rejects), or a function of the call's arguments
 * (whose result may be a promise or an Error to reject with); every call is kept in `calls`.
 */
function fakeLink(script = {}) {
  const calls = [];
  const run = (name, args, fallback) => {
    calls.push([name, ...args]);
    const entry = script[name] ?? fallback;
    return Promise.resolve(typeof entry === "function" ? entry(...args) : entry).then((value) =>
      value instanceof Error ? Promise.reject(value) : value,
    );
  };
  return {
    calls,
    named: (name) => calls.filter((call) => call[0] === name),
    inbox: () => run("inbox", [], emptyInbox),
    // The real link answers { task, open }; a script gives either that or just the Task (or null), with nothing open.
    claim: () => run("claim", [], null).then((reply) => (reply && "open" in reply ? reply : { task: reply, open: null })),
    task: (taskId, claimId) => run("task", [taskId, claimId], undefined),
    heartbeat: (taskId, claimId, stage) => run("heartbeat", [taskId, claimId, stage], undefined),
    merged: (report) => run("merged", [report], { already: false, ready: [] }),
  };
}

const laneOf = (project, link, overrides = {}) => ({
  project, remote: `github.example.com/team/${project}`, link, gh: { ok: true }, state: "ready", ...overrides,
});

/** A temp team store, a log collector and a scheduler factory over lanes. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-scheduler-")));
  const f = {
    root, dir: join(root, "team"), logs: [], dropped: [], stores: [], busyNow: false, canExecuteNow: true, stageOf: () => "build",
  };
  f.open = (now) => {
    const store = openTeamStore(f.dir, now);
    f.stores.push(store);
    return store;
  };
  f.store = f.open();
  f.scheduler = (lanes, store = f.store) =>
    createClaimScheduler({
      lanes, store, busy: () => f.busyNow, canExecute: () => f.canExecuteNow, stageOf: (open) => f.stageOf(open),
      onDropped: (open, reason) => f.dropped.push([open, reason]), log: (line) => f.logs.push(line),
    });
  /** The state and reason the store holds for a Task, read straight from its file. */
  f.rowOf = (taskId) => {
    const db = new DatabaseSync(join(f.dir, "team.sqlite"), { readOnly: true });
    try {
      return db.prepare("SELECT state, reason, source FROM team_claims WHERE task_id = ? ORDER BY id DESC").get(taskId);
    } finally {
      db.close();
    }
  };
  t.after(() => {
    for (const store of f.stores) store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return f;
}

test("an open record ends the tick before any Hub call", async (t) => {
  const f = fixture(t);
  f.store.recordClaim("be", taskOf(1), "claim");
  const be = fakeLink({ claim: taskOf(2) });
  assert.deepEqual(await f.scheduler([laneOf("be", be)]).tick(), { skipped: "open" });
  assert.deepEqual(be.calls, []);
});

test("paused, capped and busy each stop the tick without calling claim()", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1) });
  const scheduler = f.scheduler([laneOf("be", be)]);

  f.store.setPaused(true);
  assert.deepEqual(await scheduler.tick(), { skipped: "paused" });
  f.store.setPaused(false);

  f.busyNow = true;
  assert.deepEqual(await scheduler.tick(), { skipped: "busy" });
  f.busyNow = false;

  // Two new claims and one rerun today: only `claim` counts, so a cap of 2 is reached and a cap of 3 is not.
  const done = [taskOf(7), taskOf(8), taskOf(9)];
  for (const [i, task] of done.entries()) {
    f.store.recordClaim("be", task, i < 2 ? "claim" : "rerun");
    f.store.dropClaim(task.taskId, "test");
  }
  f.store.setDailyCap(2);
  assert.deepEqual(await scheduler.tick(), { skipped: "cap" });

  assert.deepEqual(be.named("claim"), [], "none of the three stops may reach claim()");

  f.store.setDailyCap(3);
  const result = await scheduler.tick();
  assert.equal(result.claimed.taskId, "task-1");
  assert.equal(be.named("claim").length, 1);
});

test("nothing is claimed while execution is locked, but a claim the Hub already holds is still recovered", async (t) => {
  const f = fixture(t);
  f.canExecuteNow = false;
  const be = fakeLink({ claim: taskOf(1) });
  const scheduler = f.scheduler([laneOf("be", be)]);
  assert.deepEqual(await scheduler.tick(), { skipped: "locked" });
  assert.deepEqual(be.named("claim"), [], "a locked Office never reaches claim()");
  assert.equal(f.store.openClaim(), null);
  f.canExecuteNow = true;
  assert.equal((await scheduler.tick()).claimed.taskId, "task-1");

  // A claim the Hub holds for this person is taken back whether or not the Office can run it: the record keeps its heartbeat going.
  const g = fixture(t);
  g.canExecuteNow = false;
  const held = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5), claim: taskOf(6) });
  assert.deepEqual(await g.scheduler([laneOf("be", held)]).tick(), { recovered: openOf("be", 5) });
  assert.deepEqual(held.named("claim"), []);
});

test("locked is checked before pause, pause before the cap, the cap before busy, and busy before no-lane", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1) });
  for (const task of [taskOf(7), taskOf(8)]) {
    f.store.recordClaim("be", task, "claim");
    f.store.dropClaim(task.taskId, "test");
  }
  f.store.setDailyCap(2);
  f.store.setPaused(true);
  f.busyNow = true;
  f.canExecuteNow = false;
  const scheduler = f.scheduler([laneOf("be", be, { state: "gh" })]);
  assert.deepEqual(await scheduler.tick(), { skipped: "locked" });
  f.canExecuteNow = true;
  assert.deepEqual(await scheduler.tick(), { skipped: "paused" });
  f.store.setPaused(false);
  assert.deepEqual(await scheduler.tick(), { skipped: "cap" });
  f.store.setDailyCap(null);
  assert.deepEqual(await scheduler.tick(), { skipped: "busy" });
  f.busyNow = false;
  assert.deepEqual(await scheduler.tick(), { skipped: "no-lane" });
});

test("with the cap off a Task is claimed however many were taken today", async (t) => {
  const f = fixture(t);
  for (let n = 10; n < 16; n += 1) {
    f.store.recordClaim("be", taskOf(n), "claim");
    f.store.dropClaim(`task-${n}`, "test");
  }
  f.store.setDailyCap(null);
  const result = await f.scheduler([laneOf("be", fakeLink({ claim: taskOf(1) }))]).tick();
  assert.equal(result.claimed.taskId, "task-1");
});

test("a Task is claimed from the lanes in registration order and recorded as a claim", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: null });
  const fe = fakeLink({ claim: taskOf(3) });
  const result = await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick();
  assert.deepEqual(result, { claimed: openOf("fe", 3) });
  assert.equal(be.named("claim").length, 1, "the first lane is asked first");
  assert.equal(fe.named("claim").length, 1);
  assert.deepEqual(f.store.openClaim(), openOf("fe", 3));
  assert.equal(f.store.claimedToday(), 1, "a taken Task counts against the daily cap");
  assert.equal(f.rowOf("task-3").source, "claim");
});

test("a lane whose first claim wins is the only one asked", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1) });
  const fe = fakeLink({ claim: taskOf(2) });
  const result = await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick();
  assert.equal(result.claimed.project, "be");
  // Recovery looked at its inbox before the claim step began; once a Task is held nothing else is asked.
  assert.deepEqual(fe.calls, [["inbox"]], "a later lane is only asked for its inbox, never for a claim");
});

test("a lane whose gh login failed is skipped and the next repo is claimed (other Git host)", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1) });
  const fe = fakeLink({ claim: taskOf(2) });
  const gh = { ok: false, reason: "logged-out", hint: "gh auth login --hostname github.example.com" };
  const result = await f.scheduler([laneOf("be", be, { gh, state: "gh" }), laneOf("fe", fe)]).tick();
  assert.equal(result.claimed.project, "fe");
  assert.deepEqual(be.calls, [], "a lane that is not ready gets no Hub call at all, not even an inbox");
  // The same for a lane that has no link yet.
  const f2 = fixture(t);
  const none = laneOf("be", null, { state: "no-link" });
  const result2 = await f2.scheduler([none, laneOf("fe", fakeLink({ claim: taskOf(2) }))]).tick();
  assert.equal(result2.claimed.project, "fe");
});

test("nothing ready anywhere is {claimed:null}, and no lane being ready is no-lane", async (t) => {
  const f = fixture(t);
  const be = fakeLink();
  const fe = fakeLink();
  assert.deepEqual(await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick(), { claimed: null, open: null });
  assert.equal(be.named("claim").length + fe.named("claim").length, 2);
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual(await f.scheduler([]).tick(), { skipped: "no-lane" });
  const down = [laneOf("be", fakeLink(), { state: "relink" }), laneOf("fe", null, { state: "no-link" })];
  assert.deepEqual(await f.scheduler(down).tick(), { skipped: "no-lane" });
});

test("a lane that stops being ready during the tick is not asked for a claim", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: null });
  const fe = fakeLink({ claim: taskOf(2) });
  const lanes = [laneOf("be", be), laneOf("fe", fe)];
  // Task 7 flips lane state in place from its gh timer; here it happens while the first lane is being asked.
  be.claim = async () => {
    lanes[1].state = "gh";
    return { task: null, open: null };
  };
  assert.deepEqual(await f.scheduler(lanes).tick(), { claimed: null, open: null });
  assert.deepEqual(fe.named("claim"), []);
});

test("a claim already open at the Hub is recovered, never claimed again (even paused or capped)", async (t) => {
  const f = fixture(t);
  f.store.setPaused(true);
  f.store.setDailyCap(1);
  f.store.recordClaim("be", taskOf(8), "claim");
  f.store.dropClaim("task-8", "test"); // the cap is now reached too
  f.busyNow = true;
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5), claim: taskOf(6) });
  const result = await f.scheduler([laneOf("be", be)]).tick();
  assert.deepEqual(result, { recovered: openOf("be", 5) });
  assert.deepEqual(be.named("task"), [["task", "task-5", "claim-5"]]);
  assert.deepEqual(be.named("claim"), [], "recovery must not call claim()");
  assert.equal(f.rowOf("task-5").source, "recovered");
  assert.equal(f.store.claimedToday(), 1, "a recovered Task is not a new claim: only the earlier one counts");
  assert.deepEqual(await f.scheduler([laneOf("be", be)]).tick(), { skipped: "open" });
});

test("recovery asks every ready lane and reads the Task through the lane whose inbox reported it", async (t) => {
  const f = fixture(t);
  // The fe link's inbox says nothing is held; only the be link knows the claim, and answers 404 to nobody else.
  const fe = fakeLink({ inbox: emptyInbox, task: hubError(404, "NOT_FOUND"), claim: taskOf(9) });
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(4, "failed") }, task: taskOf(4) });
  const skipped = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(1) }, task: taskOf(1) });
  const lanes = [laneOf("gh-down", skipped, { state: "gh" }), laneOf("fe", fe), laneOf("be", be)];
  const result = await f.scheduler(lanes).tick();
  assert.equal(result.recovered.project, "be");
  assert.equal(result.recovered.taskId, "task-4");
  assert.deepEqual(fe.named("task"), [], "another repo's link would answer 404");
  assert.deepEqual(fe.named("claim"), []);
  assert.deepEqual(skipped.calls, [], "a lane that is not ready is not asked");
  assert.equal(be.named("task").length, 1);
});

test("inbox recovery records a failed mine in phase failed and ignores a verify Task", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(4, "failed") }, task: taskOf(4, { lastFailure: { reason: "tests failed", memo: null } }), claim: taskOf(9) });
  const scheduler = f.scheduler([laneOf("be", be)]);
  const result = await scheduler.tick();
  assert.equal(result.recovered.taskId, "task-4");
  assert.equal(result.recovered.phase, "failed");
  assert.deepEqual(result.recovered, f.store.openClaim(), "what the tick reports is what the store holds");
  assert.equal(f.store.openClaim().phase, "failed");
  assert.equal(f.rowOf("task-4").source, "recovered");
  assert.deepEqual(be.named("claim"), []);
  // A failed record is read, not heartbeated.
  await scheduler.beat();
  assert.deepEqual(be.named("heartbeat"), []);
  assert.equal(be.named("task").length, 2);

  // A claimed mine stays in phase claimed.
  const g = fixture(t);
  const held = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5) });
  assert.equal((await g.scheduler([laneOf("be", held)]).tick()).recovered.phase, "claimed");

  // The inbox also offers a Story verification Task (it has no repo, so every lane sees it), and that one is for the PL.
  const h = fixture(t);
  const verify = taskOf(7, { kind: "verify", repoId: null });
  const be2 = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(7) }, task: verify, claim: taskOf(8) });
  const fe2 = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(7) }, task: verify, claim: taskOf(8) });
  const skipped = await h.scheduler([laneOf("be", be2), laneOf("fe", fe2)]).tick();
  assert.equal(skipped.claimed.taskId, "task-8", "a verify Task is not recorded, and the claim pass goes on");
  assert.equal(h.store.openClaim().taskId, "task-8");
  assert.equal(h.rowOf("task-7"), undefined);
  assert.equal(h.logs.length, 0, "ignoring it is not a failure");
});

test("after a restart the heartbeat goes out with the stored claim id", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(3) });
  assert.equal((await f.scheduler([laneOf("be", be)]).tick()).claimed.claimId, "claim-3");
  f.store.close();

  // A new process: a fresh store on the same file, fresh lanes and a fresh scheduler.
  const reopened = f.open();
  const again = fakeLink();
  await f.scheduler([laneOf("fe", fakeLink()), laneOf("be", again)], reopened).beat();
  assert.deepEqual(again.named("heartbeat"), [["heartbeat", "task-3", "claim-3", "build"]]);
});

test("a recovered claim is heartbeaten with the claim id the Hub reported", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5) });
  const scheduler = f.scheduler([laneOf("be", be)]);
  await scheduler.tick();
  await scheduler.beat();
  assert.deepEqual(be.named("heartbeat"), [["heartbeat", "task-5", "claim-5", "build"]]);
});

test("a heartbeat answered NOT_YOURS drops the record and the next tick claims fresh", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1), heartbeat: NOT_YOURS() });
  const scheduler = f.scheduler([laneOf("be", be)]);
  await scheduler.tick();
  assert.equal(f.store.openClaim().taskId, "task-1");
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason: "NOT_YOURS", source: "claim" });

  // The PL released it; the same member takes the same Task again under a new claim id.
  be.claim = async () => ({ task: taskOf(1, { claimId: "claim-1b" }), open: null });
  const result = await scheduler.tick();
  assert.deepEqual([result.claimed.taskId, result.claimed.claimId], ["task-1", "claim-1b"]);
  assert.equal(f.store.openClaim().claimId, "claim-1b");
});

test("the heartbeat sends the stage of the record's phase", async (t) => {
  const f = fixture(t);
  const seen = [];
  const stages = { claimed: "build", building: "build", verified: "verify", merging: "merge" };
  f.stageOf = (open) => {
    seen.push(open);
    return stages[open.phase];
  };
  const be = fakeLink();
  const scheduler = f.scheduler([laneOf("be", be)]);
  const open = hold(f, "be", 1, "building");
  await scheduler.beat();
  for (const phase of ["verified", "merging"]) {
    f.store.setPhase("task-1", phase);
    await scheduler.beat();
  }
  assert.deepEqual(
    be.named("heartbeat").map((call) => call.slice(1)),
    [["task-1", "claim-1", "build"], ["task-1", "claim-1", "verify"], ["task-1", "claim-1", "merge"]],
  );
  assert.deepEqual(seen[0], open, "stageOf gets the whole record, read for this beat");
  assert.deepEqual(seen.map((record) => record.phase), ["building", "verified", "merging"]);
});

test("a failed record is not heartbeated; its task() NOT_YOURS or NOT_FOUND drops it", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ task: taskOf(1) });
  const scheduler = f.scheduler([laneOf("be", be)]);
  hold(f, "be", 1, "failed");
  await scheduler.beat();
  assert.deepEqual(be.named("heartbeat"), [], "the Hub answers a heartbeat for a failed Task with STATE");
  assert.deepEqual(be.named("task"), [["task", "task-1", "claim-1"]], "the Hub is read instead");
  assert.equal(f.store.openClaim().phase, "failed");
  assert.deepEqual(f.dropped, []);

  // Any other answer keeps the record for the member to rerun.
  for (const error of [NETWORK(), STATE(), hubError(404, "HUB_ERROR")]) {
    be.task = async () => Promise.reject(error);
    await scheduler.beat();
    assert.equal(f.store.openClaim().taskId, "task-1", `kept on ${error.code}`);
  }
  assert.deepEqual(f.dropped, []);
  assert.deepEqual(be.named("heartbeat"), []);

  // The PL released or cancelled it (NOT_YOURS), or the Hub does not know it any more (NOT_FOUND): nothing can
  // reach this record from the Hub again, so it goes, and the executor is told.
  for (const [error, reason] of [[NOT_YOURS(), "NOT_YOURS"], [NOT_FOUND(), "NOT_FOUND"]]) {
    const g = fixture(t);
    const gone = fakeLink({ task: error });
    hold(g, "be", 1, "failed");
    await g.scheduler([laneOf("be", gone)]).beat();
    assert.equal(g.store.openClaim(), null, reason);
    assert.deepEqual({ ...g.rowOf("task-1") }, { state: "dropped", reason, source: "claim" });
    assert.deepEqual(g.dropped, [[{ ...openOf("be", 1), phase: "failed" }, reason]]);
    assert.deepEqual(gone.named("heartbeat"), []);
  }
});

test("a failed record whose task() read says relink marks only that lane", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ task: UNAUTHORIZED() });
  const lanes = [laneOf("be", be)];
  hold(f, "be", 1, "failed");
  await f.scheduler(lanes).beat();
  assert.equal(lanes[0].state, "relink");
  assert.equal(f.store.openClaim().taskId, "task-1");
});

test("a heartbeat STATE with a pending merged report resends it and closes the record as done", async (t) => {
  for (const already of [false, true]) {
    const f = fixture(t);
    const be = fakeLink({ heartbeat: STATE(), merged: { already, ready: already ? [] : [2] } });
    hold(f, "be", 1, "reporting", MERGED);
    await f.scheduler([laneOf("be", be)]).beat();
    const { kind, ...fields } = MERGED;
    assert.deepEqual(be.named("merged"), [["merged", { taskId: "task-1", claimId: "claim-1", ...fields }]]);
    assert.equal(f.store.openClaim(), null, `closed (already: ${already})`);
    assert.equal(f.rowOf("task-1").state, "done");
    assert.deepEqual(f.dropped, [], "finished work is not a dropped record");
  }

  // The resend failing keeps the record and its report; the next beat sends it again.
  const f = fixture(t);
  let answer = NETWORK();
  const be = fakeLink({ heartbeat: STATE(), merged: () => answer });
  const scheduler = f.scheduler([laneOf("be", be)]);
  hold(f, "be", 1, "reporting", MERGED);
  await scheduler.beat();
  assert.equal(f.store.openClaim().report.kind, "merged");
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("task-1") && line.includes("ECONNREFUSED")), `log was: ${f.logs}`);
  answer = { already: true, ready: [] };
  await scheduler.beat();
  assert.equal(be.named("merged").length, 2);
  assert.equal(f.store.openClaim(), null);
  assert.equal(f.rowOf("task-1").state, "done");
});

test("a merged resend answered NOT_YOURS or NOT_FOUND drops the record like a heartbeat would", async (t) => {
  for (const [error, reason] of [[NOT_YOURS(), "NOT_YOURS"], [NOT_FOUND(), "NOT_FOUND"]]) {
    const f = fixture(t);
    const be = fakeLink({ heartbeat: STATE(), merged: error });
    const open = hold(f, "be", 1, "reporting", MERGED);
    await f.scheduler([laneOf("be", be)]).beat();
    assert.equal(f.store.openClaim(), null);
    assert.equal(f.rowOf("task-1").reason, reason);
    assert.deepEqual(f.dropped, [[open, reason]]);
  }
});

test("a merged resend refused for good (STATE, INVALID, LOCK_REQUIRED) drops the record as HUB_REFUSED_REPORT with its PR, and no tick takes it back", async (t) => {
  const { kind, ...fields } = MERGED;
  const open = { storyNumber: 1, taskNumber: 1, repoName: "be", state: "claimed" };
  for (const beat of [STATE, NOT_YOURS])
    for (const error of [STATE(), hubError(400, "INVALID"), hubError(409, "LOCK_REQUIRED")]) {
      const f = fixture(t);
      const be = fakeLink({ heartbeat: beat(), merged: error, inbox: { ...emptyInbox, mine: mineOf(1) }, task: taskOf(1), claim: { task: null, open } });
      const record = hold(f, "be", 1, "reporting", MERGED);
      const scheduler = f.scheduler([laneOf("be", be)]);
      await scheduler.beat();
      const what = `${beat().code} then ${error.code}`;
      assert.deepEqual(be.named("merged"), [["merged", { taskId: "task-1", claimId: "claim-1", ...fields }]], what);
      assert.equal(f.store.openClaim(), null, what);
      assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason: "HUB_REFUSED_REPORT", source: "claim" }, what);
      assert.deepEqual(f.dropped, [[record, "HUB_REFUSED_REPORT"]], what);
      assert.ok(f.logs.some((line) => line.includes(MERGED.prUrl) && line.includes(MERGED.mergeCommit) && line.includes("HUB_REFUSED_REPORT")), f.logs.join("\n"));
      const ticked = await scheduler.tick();
      assert.deepEqual(ticked, { claimed: null, open }, `${what}: not taken back`);
      assert.equal(f.store.openClaim(), null);
    }
});

test("a claim whose report the Hub refused for good is not taken back: one line, blockedBy names it, no heartbeat; a new claim of the Task is", async (t) => {
  const f = fixture(t);
  f.store.recordClaim("be", taskOf(5), "claim");
  f.store.dropClaim("task-5", "HUB_REFUSED_REPORT");
  const open = { storyNumber: 1, taskNumber: 5, repoName: "be", state: "claimed" };
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5), claim: { task: null, open } });
  const scheduler = f.scheduler([laneOf("be", be)]);
  // Paused: the claim pass is not reached, and blockedBy still names the Task.
  f.store.setPaused(true);
  assert.deepEqual(await scheduler.tick(), { skipped: "paused" });
  assert.deepEqual(be.named("task"), [], "not read again, not recorded");
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual(scheduler.blockedBy(), { storyNumber: 1, taskNumber: 5, repoName: null, state: "claimed" });
  // The claim reply names it with its repo; later ticks change nothing.
  f.store.setPaused(false);
  assert.deepEqual(await scheduler.tick(), { claimed: null, open });
  assert.deepEqual(await scheduler.tick(), { claimed: null, open });
  assert.deepEqual(scheduler.blockedBy(), open);
  assert.equal(f.logs.filter((line) => /task-5.*HUB_REFUSED_REPORT.*not taken back/.test(line)).length, 1, f.logs.join("\n"));
  assert.equal(f.logs.filter((line) => /blocked by story-1 task-5/.test(line)).length, 2, "the Office's note, then the Hub's");
  await scheduler.beat();
  assert.deepEqual(be.named("heartbeat"), [], "no record, so no heartbeat: the Hub shows the Task held after 10 minutes");

  // The PL released it and it was claimed again under a new claim: that one is taken back as usual.
  const g = fixture(t);
  g.store.recordClaim("be", taskOf(5), "claim");
  g.store.dropClaim("task-5", "HUB_REFUSED_REPORT");
  const again = fakeLink({ inbox: { ...emptyInbox, mine: { ...mineOf(5), claimId: "claim-5b" } }, task: taskOf(5, { claimId: "claim-5b" }) });
  const result = await g.scheduler([laneOf("be", again)]).tick();
  assert.equal(result.recovered?.claimId, "claim-5b");
});

test("a heartbeat STATE with a failed report still to send keeps the record and sends nothing", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ heartbeat: STATE() });
  const scheduler = f.scheduler([laneOf("be", be)]);
  hold(f, "be", 1, "reporting", { kind: "failed", reason: "engine stopped" });
  await scheduler.beat();
  assert.equal(f.store.openClaim().report.kind, "failed");
  assert.deepEqual(be.named("merged"), []);
  assert.deepEqual(f.dropped, []);
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("STATE")), `no log for STATE: ${f.logs}`);
  assert.deepEqual(await scheduler.tick(), { skipped: "open" });
});

test("a heartbeat answered NOT_YOURS with a pending merged report resends it before anything is dropped", async (t) => {
  // The PL released the Task after the merge went through; the Hub still counts the late report of the last lock holder.
  const { kind, ...fields } = MERGED;
  for (const already of [false, true]) {
    const f = fixture(t);
    const be = fakeLink({ heartbeat: NOT_YOURS(), merged: { already, ready: [] } });
    hold(f, "be", 1, "reporting", MERGED);
    await f.scheduler([laneOf("be", be)]).beat();
    assert.deepEqual(be.named("merged"), [["merged", { taskId: "task-1", claimId: "claim-1", ...fields }]]);
    assert.equal(f.store.openClaim(), null);
    assert.equal(f.rowOf("task-1").state, "done", `done (already: ${already})`);
    assert.deepEqual(f.dropped, []);
  }

  // The resend itself refused for good (NOT_YOURS, NOT_FOUND): dropped, and the executor is told.
  for (const [error, reason] of [[NOT_YOURS(), "NOT_YOURS"], [NOT_FOUND(), "NOT_FOUND"]]) {
    const f = fixture(t);
    const be = fakeLink({ heartbeat: NOT_YOURS(), merged: error });
    const open = hold(f, "be", 1, "reporting", MERGED);
    await f.scheduler([laneOf("be", be)]).beat();
    assert.equal(f.store.openClaim(), null);
    assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason, source: "claim" });
    assert.deepEqual(f.dropped, [[open, reason]]);
  }

  // Any other answer keeps the record and its report; the next beat tries again.
  const f = fixture(t);
  let answer = NETWORK();
  const be = fakeLink({ heartbeat: NOT_YOURS(), merged: () => answer });
  const scheduler = f.scheduler([laneOf("be", be)]);
  hold(f, "be", 1, "reporting", MERGED);
  await scheduler.beat();
  assert.equal(f.store.openClaim().report.kind, "merged");
  assert.deepEqual(f.dropped, []);
  answer = { already: false, ready: [] };
  await scheduler.beat();
  assert.equal(be.named("merged").length, 2);
  assert.equal(f.rowOf("task-1").state, "done");
});

test("a heartbeat answered NOT_YOURS with no report, or only a failed one, still drops the record", async (t) => {
  for (const report of [null, { kind: "failed", reason: "engine stopped" }]) {
    const f = fixture(t);
    const be = fakeLink({ heartbeat: NOT_YOURS() });
    const open = hold(f, "be", 1, report ? "reporting" : "building", report);
    await f.scheduler([laneOf("be", be)]).beat();
    assert.equal(f.store.openClaim(), null);
    assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason: "NOT_YOURS", source: "claim" });
    assert.deepEqual(be.named("merged"), []);
    assert.deepEqual(f.dropped, [[open, "NOT_YOURS"]]);
  }
});

test("a heartbeat NOT_YOURS on a record keepOnNotYours holds keeps it with one line; once it lets go, NOT_YOURS drops it", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ heartbeat: NOT_YOURS() });
  let holding = true;
  const seen = [];
  const scheduler = createClaimScheduler({
    lanes: [laneOf("be", be)], store: f.store, busy: () => false, canExecute: () => true, stageOf: () => "merge",
    onDropped: (open, reason) => f.dropped.push([open, reason]), log: (line) => f.logs.push(line),
    keepOnNotYours: (open) => {
      seen.push(open.phase);
      return holding;
    },
  });
  const open = hold(f, "be", 1, "merging");
  await scheduler.beat();
  await scheduler.beat();
  assert.equal(f.store.openClaim().phase, "merging", "kept");
  assert.deepEqual(seen, ["merging", "merging"], "asked with the record as stored");
  assert.equal(f.logs.filter((line) => /NOT_YOURS while the record is merging; it is kept/.test(line)).length, 1, f.logs.join("\n"));
  assert.deepEqual(f.dropped, []);
  holding = false;
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason: "NOT_YOURS", source: "claim" });
  assert.deepEqual(f.dropped, [[open, "NOT_YOURS"]]);
});

test("a heartbeat STATE without a pending report drops the record (reason STATE)", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1), heartbeat: STATE() });
  const scheduler = f.scheduler([laneOf("be", be)]);
  await scheduler.tick();
  await scheduler.beat();
  assert.equal(be.named("heartbeat").length, 1);
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason: "STATE", source: "claim" });
  assert.deepEqual(be.named("merged"), []);
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("task-1") && line.includes("STATE")), `no log for STATE: ${f.logs}`);
  // The Hub says the Task is already reported: the next tick's inbox looks at it again, and claims nothing while the Hub holds one.
  assert.equal(f.dropped.length, 1);
});

test("a STATE answered for an older claim never closes or drops a newer record of the same Task", async (t) => {
  const f = fixture(t);
  hold(f, "be", 1, "merging");
  const be = fakeLink({
    heartbeat: () => {
      f.store.dropClaim("task-1", "operator");
      f.store.recordClaim("be", taskOf(1, { claimId: "claim-1b" }), "rerun");
      return STATE();
    },
  });
  await f.scheduler([laneOf("be", be)]).beat();
  assert.equal(f.store.openClaim().claimId, "claim-1b");
  assert.equal(f.store.openClaim().phase, "claimed");
  assert.deepEqual(f.dropped, []);
  assert.deepEqual(be.named("merged"), []);

  // The same when the record that was replaced held a report: the one the Office holds now has none, so it is not resent.
  const g = fixture(t);
  hold(g, "be", 2, "reporting", MERGED);
  const racing = fakeLink({
    heartbeat: () => {
      g.store.dropClaim("task-2", "operator");
      g.store.recordClaim("be", taskOf(2, { claimId: "claim-2b" }), "rerun");
      return STATE();
    },
  });
  await g.scheduler([laneOf("be", racing)]).beat();
  assert.equal(g.store.openClaim().claimId, "claim-2b");
  assert.deepEqual(racing.named("merged"), []);
  assert.deepEqual(g.dropped, []);
});

test("every drop (NOT_YOURS, NOT_FOUND, STATE) calls onDropped with the record and the reason", async (t) => {
  for (const [error, reason] of [[NOT_YOURS(), "NOT_YOURS"], [NOT_FOUND(), "NOT_FOUND"], [STATE(), "STATE"]]) {
    const f = fixture(t);
    const open = hold(f, "be", 1, "building");
    f.store.setPhase("task-1", "building", { engineTask: "engine-9", attempts: 1 });
    await f.scheduler([laneOf("be", fakeLink({ heartbeat: error }))]).beat();
    assert.equal(f.store.openClaim(), null, reason);
    assert.equal(f.rowOf("task-1").reason, reason);
    assert.equal(f.dropped.length, 1, `${reason} drops once`);
    const [record, why] = f.dropped[0];
    assert.equal(why, reason);
    // The record as the store held it when it was dropped, so the executor can find its engine run.
    assert.deepEqual(record, { ...open, engineTask: "engine-9", attempts: 1 });
  }

  // A scheduler built without onDropped drops all the same.
  const g = fixture(t);
  g.store.recordClaim("be", taskOf(1), "claim");
  const lone = createClaimScheduler({
    lanes: [laneOf("be", fakeLink({ heartbeat: NOT_YOURS() }))], store: g.store, busy: () => false,
    canExecute: () => true, stageOf: () => "build", log: () => {},
  });
  await lone.beat();
  assert.equal(g.store.openClaim(), null);
});

test("an onDropped that throws is logged and the record stays dropped", async (t) => {
  const f = fixture(t);
  f.store.recordClaim("be", taskOf(1), "claim");
  const scheduler = createClaimScheduler({
    lanes: [laneOf("be", fakeLink({ heartbeat: NOT_YOURS() }))], store: f.store, busy: () => false,
    canExecute: () => true, stageOf: () => "build", log: (line) => f.logs.push(line),
    onDropped: () => {
      throw new Error("engine is gone");
    },
  });
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  assert.ok(f.logs.some((line) => line.includes("task-1") && line.includes("engine is gone")), `log was: ${f.logs}`);
});

test("an onDropped that returns a rejected promise is logged, never an unhandled rejection", async (t) => {
  const unhandled = [];
  const seen = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", seen);
  t.after(() => process.off("unhandledRejection", seen));
  const f = fixture(t);
  f.store.recordClaim("be", taskOf(1), "claim");
  const stopped = [];
  const scheduler = createClaimScheduler({
    lanes: [laneOf("be", fakeLink({ heartbeat: NOT_YOURS() }))], store: f.store, busy: () => false,
    canExecute: () => true, stageOf: () => "build", log: (line) => f.logs.push(line),
    onDropped: async (open) => {
      stopped.push(open.taskId);
      throw new Error("engine cancel failed");
    },
  });
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null, "the record is dropped without waiting for the cleanup");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stopped, ["task-1"]);
  assert.deepEqual(unhandled, []);
  assert.ok(f.logs.some((line) => line.includes("task-1") && line.includes("engine cancel failed")), `log was: ${f.logs}`);
});

test("a claim with nothing to give records blockedBy and logs it once until it changes", async (t) => {
  const f = fixture(t);
  const blocker = { storyNumber: 2, taskNumber: 5, repoName: "fe", state: "claimed" };
  let reply = { task: null, open: blocker };
  const scheduler = f.scheduler([laneOf("be", fakeLink({ claim: () => reply }))]);
  const lines = () => f.logs.filter((line) => line.includes("blocked"));
  assert.equal(scheduler.blockedBy(), null);

  assert.deepEqual(await scheduler.tick(), { claimed: null, open: blocker });
  assert.deepEqual(scheduler.blockedBy(), blocker);
  await scheduler.tick();
  assert.deepEqual(lines(), ["team: blocked by story-2 task-5 (fe, claimed)"], "the same blocker is logged once");

  // Only a claim reply moves it: a tick that stops before the claim, or a claim that fails, leaves it alone.
  f.store.setPaused(true);
  assert.deepEqual(await scheduler.tick(), { skipped: "paused" });
  f.store.setPaused(false);
  reply = NETWORK();
  assert.deepEqual(await scheduler.tick(), { claimed: null, open: null });
  assert.deepEqual(scheduler.blockedBy(), blocker);
  assert.equal(lines().length, 1);

  // A change of the same Task's state, or of the Task, is a new line; a verify Task has no repo to name.
  reply = { task: null, open: { ...blocker, state: "failed" } };
  await scheduler.tick();
  reply = { task: null, open: { storyNumber: 2, taskNumber: 6, repoName: null, state: "claimed" } };
  await scheduler.tick();
  assert.deepEqual(lines().slice(1), ["team: blocked by story-2 task-5 (fe, failed)", "team: blocked by story-2 task-6 (claimed)"]);

  // Nothing in the way any more, from a reply with no open Task and from a Task taken.
  reply = { task: null, open: null };
  await scheduler.tick();
  assert.equal(scheduler.blockedBy(), null);
  await scheduler.tick();
  assert.deepEqual(lines().slice(3), ["team: no longer blocked"], "and once");

  reply = { task: null, open: blocker };
  await scheduler.tick();
  assert.deepEqual(scheduler.blockedBy(), blocker);
  reply = { task: taskOf(1), open: null };
  assert.equal((await scheduler.tick()).claimed.taskId, "task-1");
  assert.equal(scheduler.blockedBy(), null);
  assert.equal(lines().at(-1), "team: no longer blocked");
});

test("blockedBy is the open Task the claim replies name, across lanes, and never moves on a lane that fails", async (t) => {
  const f = fixture(t);
  const blocker = { storyNumber: 3, taskNumber: 9, repoName: "be", state: "failed" };
  const be = fakeLink({ claim: NETWORK() });
  const fe = fakeLink({ claim: { task: null, open: blocker } });
  const scheduler = f.scheduler([laneOf("be", be), laneOf("fe", fe)]);
  assert.deepEqual(await scheduler.tick(), { claimed: null, open: blocker });
  assert.deepEqual(scheduler.blockedBy(), blocker);
  assert.equal(f.logs.filter((line) => line.includes("blocked by")).length, 1);
});

test("a heartbeat answered 401 marks only that lane relink and keeps the record", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1), heartbeat: UNAUTHORIZED() });
  const fe = fakeLink();
  const lanes = [laneOf("fe", fe), laneOf("be", be)];
  const scheduler = f.scheduler(lanes);
  f.store.recordClaim("be", taskOf(1), "claim");
  await scheduler.beat();
  assert.equal(lanes[1].state, "relink");
  assert.equal(lanes[0].state, "ready");
  assert.equal(f.store.openClaim().taskId, "task-1");
  assert.deepEqual(fe.calls, [], "the heartbeat goes only to the repo of the open record");
});

test("a heartbeat that fails with retry changes nothing but is logged with the project and code", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ heartbeat: NETWORK() });
  const lanes = [laneOf("be", be)];
  f.store.recordClaim("be", taskOf(1), "claim");
  await f.scheduler(lanes).beat();
  assert.equal(lanes[0].state, "ready");
  assert.equal(f.store.openClaim().taskId, "task-1");
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("ECONNREFUSED")), `log was: ${f.logs}`);
});

test("beat does nothing without an open record, and logs when the record's lane is gone or unlinked", async (t) => {
  const f = fixture(t);
  const be = fakeLink();
  const scheduler = f.scheduler([laneOf("be", be)]);
  await scheduler.beat();
  assert.deepEqual(be.calls, []);
  assert.deepEqual(f.logs, []);

  f.store.recordClaim("gone", taskOf(1), "claim");
  await scheduler.beat();
  assert.deepEqual(be.calls, [], "a record of a repo that is not registered is never sent to another repo's link");
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].includes("gone"));
  await f.scheduler([laneOf("gone", null, { state: "no-link" })]).beat();
  assert.equal(f.logs.length, 2);
  assert.ok(f.logs[1].includes("heartbeat"), `log was: ${f.logs[1]}`);

  // A failed record is not heartbeated, so its line must not say a heartbeat was to be sent.
  const g = fixture(t);
  hold(g, "gone", 1, "failed");
  await g.scheduler([]).beat();
  assert.equal(g.logs.length, 1);
  assert.ok(g.logs[0].includes("gone") && g.logs[0].includes("failed Task") && !g.logs[0].includes("heartbeat"), `log was: ${g.logs[0]}`);
  assert.equal(f.store.openClaim().taskId, "task-1");
});

test("beat keeps heartbeating a Task while its gh login is down: a Hub call needs no gh", async (t) => {
  const f = fixture(t);
  const be = fakeLink();
  f.store.recordClaim("be", taskOf(1), "claim");
  await f.scheduler([laneOf("be", be, { state: "gh", gh: { ok: false, reason: "logged-out", hint: "x" } })]).beat();
  assert.equal(be.named("heartbeat").length, 1);
});

test("a NOT_YOURS for an older claim never drops a newer record of the same Task", async (t) => {
  const f = fixture(t);
  f.store.recordClaim("be", taskOf(1), "claim");
  const be = fakeLink({
    heartbeat: () => {
      // While the heartbeat is in flight the record is dropped and the Task taken again under a new claim id.
      f.store.dropClaim("task-1", "operator");
      f.store.recordClaim("be", taskOf(1, { claimId: "claim-1b" }), "rerun");
      return NOT_YOURS();
    },
  });
  await f.scheduler([laneOf("be", be)]).beat();
  assert.equal(f.store.openClaim().claimId, "claim-1b");
});

test("a heartbeat answered 404 NOT_FOUND drops the record; a tick whose inbox still reports the claim records it again as recovered", async (t) => {
  const f = fixture(t);
  // The Hub was wiped or re-created, or the repo re-linked: it no longer knows this Task under this link.
  const be = fakeLink({ heartbeat: NOT_FOUND(), inbox: { ...emptyInbox, mine: mineOf(1) }, task: taskOf(1) });
  const scheduler = f.scheduler([laneOf("be", be)]);
  f.store.recordClaim("be", taskOf(1), "claim");
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null, "the record is not kept forever: every tick would be skipped as open");
  assert.deepEqual({ ...f.rowOf("task-1") }, { state: "dropped", reason: "NOT_FOUND", source: "claim" });
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("task-1") && line.includes("NOT_FOUND")), `log was: ${f.logs}`);

  // If the Hub does still hold the claim for this member, the next tick takes it back rather than claiming afresh.
  const result = await scheduler.tick();
  assert.deepEqual(result, { recovered: openOf("be", 1) });
  assert.deepEqual(be.named("claim"), []);
  assert.equal(f.rowOf("task-1").source, "recovered");
  assert.equal(f.store.openClaim().claimId, "claim-1");
});

test("a NOT_FOUND for an older claim never drops a newer record of the same Task", async (t) => {
  const f = fixture(t);
  f.store.recordClaim("be", taskOf(1), "claim");
  const be = fakeLink({
    heartbeat: () => {
      f.store.dropClaim("task-1", "operator");
      f.store.recordClaim("be", taskOf(1, { claimId: "claim-1b" }), "rerun");
      return NOT_FOUND();
    },
  });
  await f.scheduler([laneOf("be", be)]).beat();
  assert.equal(f.store.openClaim().claimId, "claim-1b");
});

test("other 404s on a heartbeat (no NOT_FOUND code) keep the record and are retried", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ heartbeat: hubError(404, "HUB_ERROR") });
  f.store.recordClaim("be", taskOf(1), "claim");
  await f.scheduler([laneOf("be", be)]).beat();
  assert.equal(f.store.openClaim().taskId, "task-1");
});

test("a 401 on claim marks that lane relink and the next lane is claimed", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: UNAUTHORIZED() });
  const fe = fakeLink({ claim: taskOf(2) });
  const lanes = [laneOf("be", be), laneOf("fe", fe)];
  const result = await f.scheduler(lanes).tick();
  assert.equal(result.claimed.project, "fe");
  assert.equal(lanes[0].state, "relink");
  assert.equal(lanes[1].state, "ready");
});

test("a 426 that expects protocol 2 marks the lane hub-too-old and the next lane is claimed", async (t) => {
  const f = fixture(t);
  for (const expected of ["2", "1"]) {
    const be = fakeLink({ claim: hubError(426, "PROTOCOL_MISMATCH", expected) });
    const fe = fakeLink({ claim: taskOf(2) });
    const lanes = [laneOf("be", be), laneOf("fe", fe)];
    const result = await f.scheduler(lanes).tick();
    assert.equal(result.claimed.project, "fe");
    assert.equal(lanes[0].state, "hub-too-old");
    f.store.dropClaim("task-2", "test");
  }
});

test("relink and hub-too-old found while recovering also move on to the next lane", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: UNAUTHORIZED() });
  const old = fakeLink({ inbox: hubError(426, "PROTOCOL_MISMATCH", "2") });
  const fe = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(7) }, task: taskOf(7) });
  const lanes = [laneOf("be", be), laneOf("old", old), laneOf("fe", fe)];
  const result = await f.scheduler(lanes).tick();
  assert.equal(result.recovered.project, "fe");
  assert.deepEqual(lanes.map((lane) => lane.state), ["relink", "hub-too-old", "ready"]);
});

test("a 404 on one lane's claim is logged and the next lane is still claimed; the lane stays ready", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: hubError(404, "NOT_FOUND") });
  const fe = fakeLink({ claim: taskOf(2) });
  const lanes = [laneOf("be", be), laneOf("fe", fe)];
  const result = await f.scheduler(lanes).tick();
  assert.equal(result.claimed.project, "fe", "a permanent failure of an early repo must not starve a later one");
  assert.equal(result.claimed.taskId, "task-2");
  assert.equal(be.named("claim").length, 1);
  assert.equal(fe.named("claim").length, 1);
  assert.equal(lanes[0].state, "ready", "a retry-class failure never changes the lane state");
  assert.equal(f.store.openClaim().project, "fe");
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].includes("be") && f.logs[0].includes("404 NOT_FOUND"), `log was: ${f.logs}`);
});

test("a network failure on claim is logged with project and code, the next lane is claimed, and the lane stays ready", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: NETWORK() });
  const fe = fakeLink({ claim: taskOf(2) });
  const lanes = [laneOf("be", be), laneOf("fe", fe)];
  assert.equal((await f.scheduler(lanes).tick()).claimed.project, "fe");
  assert.equal(lanes[0].state, "ready");
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("ECONNREFUSED")), `log was: ${f.logs}`);
});

test("when every lane fails with retry the tick is {claimed:null}, nothing is stored and each lane is logged", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: hubError(404, "NOT_FOUND") });
  const fe = fakeLink({ claim: hubError(503, "HUB_503") });
  const lanes = [laneOf("be", be), laneOf("fe", fe)];
  assert.deepEqual(await f.scheduler(lanes).tick(), { claimed: null, open: null });
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual(lanes.map((lane) => lane.state), ["ready", "ready"]);
  assert.equal(f.logs.length, 2);
  assert.ok(f.logs[0].includes("be") && f.logs[0].includes("404 NOT_FOUND"));
  assert.ok(f.logs[1].includes("fe") && f.logs[1].includes("503 HUB_503"));
});

test("a 404 on one lane's inbox is logged and a later lane's open claim is still recovered, never claimed again", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: hubError(404, "NOT_FOUND"), claim: taskOf(8) });
  const fe = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5), claim: taskOf(9) });
  const lanes = [laneOf("be", be), laneOf("fe", fe)];
  const result = await f.scheduler(lanes).tick();
  assert.equal(result.recovered.project, "fe");
  assert.equal(result.recovered.taskId, "task-5");
  assert.deepEqual(fe.named("task"), [["task", "task-5", "claim-5"]]);
  assert.deepEqual(be.named("claim"), [], "recovery must not call claim()");
  assert.deepEqual(fe.named("claim"), [], "recovery must not call claim()");
  assert.deepEqual(be.named("task"), []);
  assert.equal(lanes[0].state, "ready");
  assert.equal(f.rowOf("task-5").source, "recovered");
  assert.equal(f.logs.length, 1);
  assert.ok(f.logs[0].includes("be") && f.logs[0].includes("404 NOT_FOUND"), `log was: ${f.logs}`);
});

test("a failing inbox read does not stop the claim pass: the lane is still asked for a claim and the next lane too", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: NETWORK(), claim: null });
  const fe = fakeLink({ claim: taskOf(2) });
  const result = await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick();
  assert.equal(result.claimed.project, "fe");
  assert.equal(be.named("claim").length, 1);
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("ECONNREFUSED")), `log was: ${f.logs}`);
});

test("a failing task() read in recovery is logged and recovery goes on to the later lanes", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(4) }, task: hubError(404, "NOT_FOUND"), claim: taskOf(8) });
  const fe = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: taskOf(5) });
  const result = await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick();
  assert.equal(result.recovered.project, "fe");
  assert.deepEqual(be.named("claim"), []);
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("404 NOT_FOUND")), `log was: ${f.logs}`);
});

test("a recovery race where the Hub no longer knows the claim is logged and the claim pass goes on", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: NOT_YOURS(), claim: taskOf(6) });
  const result = await f.scheduler([laneOf("be", be)]).tick();
  // The PL released it between inbox and task: the Hub now gives out a fresh claim (one open Task per person still holds there).
  assert.equal(result.claimed.taskId, "task-6");
  assert.equal(f.store.openClaim().taskId, "task-6");
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("409 NOT_YOURS")), `log was: ${f.logs}`);
});

test("a Task without string ids is never recorded: it is logged and the next lane is tried", async (t) => {
  for (const bad of [{ ...taskOf(1), claimId: 5 }, { ...taskOf(1), taskId: undefined }, {}]) {
    const f = fixture(t);
    const fe = fakeLink({ claim: taskOf(2) });
    const be = fakeLink({ claim: bad });
    const result = await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick();
    assert.equal(result.claimed.project, "fe");
    assert.deepEqual(f.store.openClaim(), openOf("fe", 2));
    assert.equal(f.logs.length, 1);
    assert.ok(f.logs[0].includes("be"), `log was: ${f.logs}`);
  }

  // With no other lane to try nothing is stored and the tick is {claimed:null}.
  const alone = fixture(t);
  assert.deepEqual(await alone.scheduler([laneOf("be", fakeLink({ claim: { ...taskOf(1), claimId: 5 } }))]).tick(), { claimed: null, open: null });
  assert.equal(alone.store.openClaim(), null);
  assert.equal(alone.logs.length, 1);

  // A recovered Task without ids is not stored either; recovery and then the claim pass go on.
  const recovering = fixture(t);
  const bad = fakeLink({ inbox: { ...emptyInbox, mine: mineOf(5) }, task: { ...taskOf(5), claimId: null }, claim: null });
  const fe = fakeLink({ claim: taskOf(2) });
  const result = await recovering.scheduler([laneOf("be", bad), laneOf("fe", fe)]).tick();
  assert.equal(result.claimed.project, "fe");
  assert.equal(recovering.store.openClaim().taskId, "task-2");
  assert.equal(recovering.logs.length, 1);
  assert.ok(recovering.logs[0].includes("be"));
});

test("an overlapping tick() shares the running one: one Hub claim, one result", async (t) => {
  const f = fixture(t);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const be = fakeLink({ claim: () => gate.then(() => taskOf(1)) });
  const scheduler = f.scheduler([laneOf("be", be)]);
  const first = scheduler.tick();
  const second = scheduler.tick();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(be.named("claim").length, 1);
  assert.deepEqual(a, b);
  assert.equal(a.claimed.taskId, "task-1");
  // Once it finished, the next call runs for real again.
  assert.deepEqual(await scheduler.tick(), { skipped: "open" });
});

test("an overlapping beat() shares the running one, and a failed tick() does not wedge the next", async (t) => {
  const f = fixture(t);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const be = fakeLink({ heartbeat: () => gate });
  f.store.recordClaim("be", taskOf(1), "claim");
  const scheduler = f.scheduler([laneOf("be", be)]);
  const first = scheduler.beat();
  const second = scheduler.beat();
  release();
  await Promise.all([first, second]);
  assert.equal(be.named("heartbeat").length, 1);
  await scheduler.beat();
  assert.equal(be.named("heartbeat").length, 2);

  // A store failure (here the record already open when recording) rejects that call but not the next one.
  const g = fixture(t);
  const racing = fakeLink({ claim: () => { g.store.recordClaim("be", taskOf(9), "claim"); return taskOf(1); } });
  const racer = g.scheduler([laneOf("be", racing)]);
  await assert.rejects(() => racer.tick(), { code: "OPEN_CLAIM" });
  assert.deepEqual(await racer.tick(), { skipped: "open" });
});

test("lanes() returns the lane objects the scheduler holds, so their state can be updated in place", async (t) => {
  const f = fixture(t);
  const lane = laneOf("be", fakeLink({ claim: taskOf(1) }));
  const scheduler = f.scheduler([lane]);
  assert.equal(scheduler.lanes()[0], lane);
  scheduler.lanes()[0].state = "gh";
  assert.deepEqual(await scheduler.tick(), { skipped: "no-lane" });
});

const realLane = (project, cfg) => laneOf(project, storyLink(cfg));

test("real Hub: tick claims the be Task across two lanes, beat succeeds, the second tick is open", async (t) => {
  const f = fixture(t);
  const { cfgOf, repos } = await hubWithStory(t);
  const scheduler = f.scheduler([realLane("be", cfgOf("be")), realLane("fe", cfgOf("fe"))]);
  const result = await scheduler.tick();
  assert.equal(result.claimed.project, "be");
  assert.equal(result.claimed.task.title, "be-1");
  assert.equal(result.claimed.task.repoId, repos.be);
  assert.equal(f.store.openClaim().claimId, result.claimed.claimId);
  await scheduler.beat();
  assert.deepEqual(f.logs, [], "a successful heartbeat logs nothing");
  assert.equal(f.store.openClaim().taskId, result.claimed.taskId);
  assert.deepEqual(await scheduler.tick(), { skipped: "open" });
  // The Hub holds exactly this one open Task for A (one per person).
  const { task } = result.claimed;
  assert.deepEqual(await storyLink(cfgOf("fe")).claim(), {
    task: null,
    open: { storyNumber: task.story.number, taskNumber: task.number, repoName: "be", state: "claimed" },
  });
});

test("real Hub: a lost local record is recovered through the be link even though fe is registered first", async (t) => {
  const f = fixture(t);
  const { cfgOf } = await hubWithStory(t);
  const { task: taken } = await storyLink(cfgOf("be")).claim();
  // The Office never saved it (lost reply or restart before the write): the store is empty.
  assert.equal(f.store.openClaim(), null);
  const scheduler = f.scheduler([realLane("fe", cfgOf("fe")), realLane("be", cfgOf("be"))]);
  const result = await scheduler.tick();
  assert.equal(result.recovered.project, "be");
  assert.equal(result.recovered.claimId, taken.claimId);
  assert.deepEqual(result.recovered.task, taken);
  assert.equal(f.store.claimedToday(), 0);
  await scheduler.beat();
  assert.deepEqual(f.logs, []);
});

test("real Hub: after the PL releases the Task the heartbeat drops the record and a later tick claims it again", async (t) => {
  const f = fixture(t);
  const { cfgOf, tick: advance, release } = await hubWithStory(t);
  const scheduler = f.scheduler([realLane("be", cfgOf("be")), realLane("fe", cfgOf("fe"))]);
  const first = (await scheduler.tick()).claimed;
  advance(600001);
  release(first.taskId);
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  const again = (await scheduler.tick()).claimed;
  assert.equal(again.taskId, first.taskId);
  assert.notEqual(again.claimId, first.claimId);
});

test("real Hub: after the claimant's own failed report the heartbeat is STATE, and the next tick takes the failed Task back as a failed record", async (t) => {
  const f = fixture(t);
  const { cfgOf } = await hubWithStory(t);
  const scheduler = f.scheduler([realLane("be", cfgOf("be")), realLane("fe", cfgOf("fe"))]);
  const { claimed } = await scheduler.tick();
  await storyLink(cfgOf("be")).failed(claimed.taskId, claimed.claimId, "engine stopped");
  // The Hub still counts it as A's open Task, but takes no heartbeat for it; nothing is waiting to be reported.
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  assert.deepEqual({ ...f.rowOf(claimed.taskId) }, { state: "dropped", reason: "STATE", source: "claim" });
  assert.deepEqual(f.dropped.map(([open, reason]) => [open.taskId, reason]), [[claimed.taskId, "STATE"]]);

  const back = (await scheduler.tick()).recovered;
  assert.deepEqual([back.taskId, back.claimId, back.phase], [claimed.taskId, claimed.claimId, "failed"]);
  assert.equal(back.task.lastFailure.reason, "engine stopped");
  // Held as a failed record it is read, never heartbeated, so the Hub raises no STATE again.
  const before = f.logs.length;
  await scheduler.beat();
  assert.equal(f.store.openClaim().taskId, claimed.taskId);
  assert.equal(f.logs.length, before);
  // Meanwhile the Hub says what is in the way, for a claim made by another lane of the same person.
  assert.equal((await storyLink(cfgOf("fe")).claim()).open.state, "failed");
});

test("real Hub: a merged report the Hub already has is resent on the heartbeat's STATE, answered already, and closes the record as done", async (t) => {
  const f = fixture(t);
  const { cfgOf } = await hubWithStory(t);
  const scheduler = f.scheduler([realLane("be", cfgOf("be"))]);
  const { claimed } = await scheduler.tick();
  const link = storyLink(cfgOf("be"));
  const { kind, ...fields } = MERGED;
  // The merge went through and the Hub took the report, but the Office stopped before it could close its record.
  await link.mergeLock(claimed.taskId, claimed.claimId);
  assert.equal((await link.merged({ taskId: claimed.taskId, claimId: claimed.claimId, ...fields })).already, false);
  f.store.setPhase(claimed.taskId, "reporting");
  f.store.setReport(claimed.taskId, MERGED);
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  assert.equal(f.rowOf(claimed.taskId).state, "done");
  assert.deepEqual(f.dropped, []);
  assert.deepEqual(f.logs, []);
  // be-2 became ready with it, and the next claim takes it.
  assert.equal((await scheduler.tick()).claimed.task.title, "be-2");
});

test("real Hub: a PL release after the merge does not lose the report: the heartbeat's NOT_YOURS resends it, the Hub counts it, the record is done", async (t) => {
  const f = fixture(t);
  const { cfgOf, tick: advance, release } = await hubWithStory(t);
  const scheduler = f.scheduler([realLane("be", cfgOf("be")), realLane("fe", cfgOf("fe"))]);
  const { claimed } = await scheduler.tick();
  const link = storyLink(cfgOf("be"));
  assert.deepEqual(await link.mergeLock(claimed.taskId, claimed.claimId), { granted: true, holder: null });
  // The merge went through but its report is still only in the record, and the Task went quiet: the PL releases it.
  f.store.setPhase(claimed.taskId, "reporting");
  f.store.setReport(claimed.taskId, MERGED);
  advance(600001);
  release(claimed.taskId);
  await scheduler.beat();
  assert.equal(f.store.openClaim(), null);
  assert.equal(f.rowOf(claimed.taskId).state, "done");
  assert.deepEqual(f.dropped, []);
  assert.deepEqual(f.logs, []);
  // The Hub counts it: the same report is answered already, and the next Task of the be repo is ready.
  const { kind, ...fields } = MERGED;
  assert.equal((await link.merged({ taskId: claimed.taskId, claimId: claimed.claimId, ...fields })).already, true);
  assert.equal((await scheduler.tick()).claimed.task.title, "be-2");
});
