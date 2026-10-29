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
const NETWORK = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

/** A ClaimedTask-shaped value; the scheduler only needs the two ids. */
const taskOf = (n, overrides = {}) => ({
  taskId: `task-${n}`, claimId: `claim-${n}`, kind: "work", number: n, title: `Task ${n}`, spec: "", files: [],
  verify: [], storyVerify: [], repoId: "repo", branch: `feature/story-1/task-${n}`,
  story: { id: "story", number: 1, title: "Story", body: "", risk: "normal", branches: [] },
  upstream: [], lastFailure: null, ...overrides,
});
const mineOf = (n, state = "claimed") => ({ taskId: `task-${n}`, claimId: `claim-${n}`, storyId: "story", state });
const emptyInbox = { mine: null, alerts: [], verifyReady: [] };

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
    claim: () => run("claim", [], null),
    task: (taskId, claimId) => run("task", [taskId, claimId], undefined),
    heartbeat: (taskId, claimId, stage) => run("heartbeat", [taskId, claimId, stage], undefined),
  };
}

const laneOf = (project, link, overrides = {}) => ({
  project, remote: `github.example.com/team/${project}`, link, gh: { ok: true }, state: "ready", ...overrides,
});

/** A temp team store, a log collector and a scheduler factory over lanes. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-scheduler-")));
  const f = { root, dir: join(root, "team"), logs: [], stores: [], busyNow: false };
  f.open = (now) => {
    const store = openTeamStore(f.dir, now);
    f.stores.push(store);
    return store;
  };
  f.store = f.open();
  f.scheduler = (lanes, store = f.store) =>
    createClaimScheduler({ lanes, store, busy: () => f.busyNow, log: (line) => f.logs.push(line) });
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

test("pause is checked before the cap, the cap before busy, and busy before no-lane", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1) });
  for (const task of [taskOf(7), taskOf(8)]) {
    f.store.recordClaim("be", task, "claim");
    f.store.dropClaim(task.taskId, "test");
  }
  f.store.setDailyCap(2);
  f.store.setPaused(true);
  f.busyNow = true;
  const scheduler = f.scheduler([laneOf("be", be, { state: "gh" })]);
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
  assert.deepEqual(result, { claimed: { taskId: "task-3", claimId: "claim-3", project: "fe", task: taskOf(3) } });
  assert.equal(be.named("claim").length, 1, "the first lane is asked first");
  assert.equal(fe.named("claim").length, 1);
  assert.deepEqual(f.store.openClaim(), { taskId: "task-3", claimId: "claim-3", project: "fe", task: taskOf(3) });
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
  assert.deepEqual(await f.scheduler([laneOf("be", be), laneOf("fe", fe)]).tick(), { claimed: null });
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
    return null;
  };
  assert.deepEqual(await f.scheduler(lanes).tick(), { claimed: null });
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
  assert.deepEqual(result, { recovered: { taskId: "task-5", claimId: "claim-5", project: "be", task: taskOf(5) } });
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
  be.claim = async () => taskOf(1, { claimId: "claim-1b" });
  const result = await scheduler.tick();
  assert.deepEqual([result.claimed.taskId, result.claimed.claimId], ["task-1", "claim-1b"]);
  assert.equal(f.store.openClaim().claimId, "claim-1b");
});

test("a heartbeat answered STATE keeps the record and only logs", async (t) => {
  const f = fixture(t);
  const be = fakeLink({ claim: taskOf(1), heartbeat: STATE() });
  const scheduler = f.scheduler([laneOf("be", be)]);
  await scheduler.tick();
  await scheduler.beat();
  assert.equal(f.store.openClaim().claimId, "claim-1");
  assert.equal(f.rowOf("task-1").state, "open");
  assert.equal(be.named("heartbeat").length, 1);
  assert.ok(f.logs.some((line) => line.includes("be") && line.includes("STATE")), `no log for STATE: ${f.logs}`);
  assert.deepEqual(await scheduler.tick(), { skipped: "open" });
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
  assert.deepEqual(await f.scheduler(lanes).tick(), { claimed: null });
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
    assert.deepEqual(f.store.openClaim(), { taskId: "task-2", claimId: "claim-2", project: "fe", task: taskOf(2) });
    assert.equal(f.logs.length, 1);
    assert.ok(f.logs[0].includes("be"), `log was: ${f.logs}`);
  }

  // With no other lane to try nothing is stored and the tick is {claimed:null}.
  const alone = fixture(t);
  assert.deepEqual(await alone.scheduler([laneOf("be", fakeLink({ claim: { ...taskOf(1), claimId: 5 } }))]).tick(), { claimed: null });
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
  assert.equal(await storyLink(cfgOf("fe")).claim(), null);
});

test("real Hub: a lost local record is recovered through the be link even though fe is registered first", async (t) => {
  const f = fixture(t);
  const { cfgOf } = await hubWithStory(t);
  const taken = await storyLink(cfgOf("be")).claim();
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
