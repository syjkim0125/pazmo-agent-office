import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClaimScheduler } from "../src/team/scheduler.ts";
import { storyLink } from "../src/team/story-link.ts";
import { openTeamStore } from "../src/team/store.ts";
import { hubWithStory } from "./team-fixture.mjs";

// The ruling these tests pin: what a member does on the Hub web (작업하기, 다시 시도, the switch 자동으로 일하기,
// and the PL's 풀기) changes only Hub state, and the member's team Office takes it through the code it already
// had: recovery from the inbox, the failed record's Task read, and the Hub's claim answer. The web bundle changed
// no Office code for this; these tests show that is enough.

/** A merged report as the executor sends it once the PR is merged. */
const MERGED = {
  prUrl: "https://github.example.com/team/be/pull/7",
  mergeCommit: "a".repeat(40),
  summary: "[변경사항]\n1. 작업\n2. 파일\n3. 확인",
  assumptions: ["ASSUMED: code is upper case"],
};
const NO_LONGER_MINE = /is no longer this Office's claim \(NOT_YOURS\); the record was dropped/;

/**
 * Member A's team Office against a real Hub (`hubWithStory`): the real Story links of A's repos be and fe, in the
 * order the Office registered them, a team store, and the scheduler as the Office builds it (its timers are the
 * test's `tick` and `beat` calls). `web` is what the Hub web's buttons call in the Hub store, with A (or the PL, for
 * 풀기) as the person on the page; Task 5 pins the web → store wiring.
 */
async function office(t, { laneState = {} } = {}) {
  const h = await hubWithStory(t);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-hub-web-office-")));
  const store = openTeamStore(join(root, "team"));
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const cfg = h.cfgOf("be");
  const member = { id: cfg.memberId, name: cfg.memberName, admin: false };
  const lanes = ["be", "fe"].map((name) => ({
    project: name, remote: `github.example.com/team/${name}`, link: storyLink(h.cfgOf(name)), gh: { ok: true },
    state: laneState[name] ?? "ready",
  }));
  const logs = [];
  const dropped = [];
  const scheduler = createClaimScheduler({
    lanes,
    store,
    busy: () => false,
    canExecute: () => true,
    stageOf: () => "build",
    onDropped: (open, reason) => dropped.push([open.taskId, open.claimId, reason]),
    log: (line) => logs.push(line),
  });
  const linkOf = (project) => lanes.find((lane) => lane.project === project).link;
  return {
    h, store, scheduler, member, logs, dropped,
    /** The Task as the Hub board shows it. */
    view: (title) => h.board.story(h.plLink, h.story.id).tasks.find((x) => x.title === title),
    /** The member's open Task at the Hub as `project`'s link reads it from the inbox. */
    mine: async (project) => (await storyLink(h.cfgOf(project)).inbox()).mine,
    web: {
      autoWork: (on) => h.board.setAutoWork(member, on),
      pick: (taskId) => h.board.pickTask(member, taskId, h.store.reachableRepos(member.id)),
      rerun: (taskId, memo) => h.board.rerunTask(member, taskId, memo, h.store.reachableRepos(member.id)),
      /** The repos the Hub web counts as reachable for A: the links A's Office used lately. */
      reachable: () => [...h.store.reachableRepos(member.id)].sort(),
      release: (taskId) => h.board.releaseTask({ member: h.pl }, taskId),
    },
    /** What the executor does when it gives up on a claim: the failed report, then the record held in phase failed. */
    async gaveUp(open, reason) {
      await linkOf(open.project).failed(open.taskId, open.claimId, reason);
      store.setPhase(open.taskId, "failed", { attempts: 3, unlockOwed: false });
      store.setReport(open.taskId, null);
    },
    /** What the executor does when the PR is merged: the merged report under the merge lock, then the record done. */
    async merged(open) {
      const link = linkOf(open.project);
      assert.deepEqual(await link.mergeLock(open.taskId, open.claimId), { granted: true, holder: null });
      assert.equal((await link.merged({ taskId: open.taskId, claimId: open.claimId, ...MERGED })).already, false);
      store.finishClaim(open.taskId);
    },
  };
}

const recordOf = (open) => open && [open.project, open.taskId, open.claimId, open.phase, open.attempts];
/** The record a tick took (`claimed`) or took back (`recovered`); any other tick result fails, naming what it was. */
async function took(scheduler, how) {
  const result = await scheduler.tick();
  assert.ok(result[how], `expected the tick to have ${how} a Task, got ${JSON.stringify(result)}`);
  return result[how];
}

test("a Task picked on the web is recovered by the member's scheduler at the next tick, even with the local pause on and auto work off, and its claim id is the Hub's", async (t) => {
  const o = await office(t);
  o.store.setPaused(true);
  o.web.autoWork(false);
  assert.deepEqual(await o.scheduler.tick(), { skipped: "paused" }, "nothing is taken on its own");

  // fe-1, not the oldest ready Task of the first lane: what the member chose, claimed for them on the Hub.
  const fe1 = o.view("fe-1");
  assert.equal(fe1.state, "ready");
  assert.deepEqual(o.web.pick(fe1.id), { ok: true });
  const hub = await o.mine("fe");
  assert.deepEqual([hub.taskId, hub.state], [fe1.id, "claimed"]);
  assert.equal(o.store.openClaim(), null, "the web changed only the Hub");

  const recovered = await took(o.scheduler, "recovered");
  assert.deepEqual(recordOf(recovered), ["fe", fe1.id, hub.claimId, "claimed", 0]);
  assert.equal(recovered.task.title, "fe-1");
  assert.equal(recovered.task.lastFailure, null);
  assert.deepEqual(recordOf(o.store.openClaim()), recordOf(recovered));
  assert.equal(o.store.settings().paused, true, "the pause is left as it was");

  // From here it is the Office's claim like any other: the heartbeat under the Hub's claim id is taken.
  await o.scheduler.beat();
  assert.deepEqual(o.logs, []);
  const after = o.view("fe-1");
  assert.deepEqual([after.state, after.assignee?.id, after.stage], ["claimed", o.member.id, "build"]);
  assert.deepEqual(await o.scheduler.tick(), { skipped: "open" });
});

test("a web rerun of a failed Task: the next beat drops the failed record as NOT_YOURS, the next tick recovers the new claim at attempt 0, and the Task read carries the last failure and the memo; the Hub holds one open Task for the member", async (t) => {
  const o = await office(t);
  const claimed = await took(o.scheduler, "claimed");
  assert.equal(claimed.task.title, "be-1");
  await o.gaveUp(claimed, "verify failed: npm test");
  // Held in phase failed, the record is read at each beat and kept while the failed claim is still the member's.
  await o.scheduler.beat();
  assert.deepEqual(recordOf(o.store.openClaim()), ["be", claimed.taskId, claimed.claimId, "failed", 3]);
  assert.deepEqual(o.logs, []);

  // 다시 시도 on the web, with a memo (trimmed by the Hub).
  assert.deepEqual(o.web.rerun(claimed.taskId, "  only touch src/a.ts  "), { ok: true });
  const hub = await o.mine("be");
  assert.deepEqual([hub.taskId, hub.state], [claimed.taskId, "claimed"]);
  assert.notEqual(hub.claimId, claimed.claimId);
  assert.equal(o.store.openClaim().phase, "failed", "the web changed only the Hub");
  // Until the next beat the failed record is still open, so a tick takes nothing.
  assert.deepEqual(await o.scheduler.tick(), { skipped: "open" });

  await o.scheduler.beat();
  assert.equal(o.store.openClaim(), null);
  assert.deepEqual(o.dropped, [[claimed.taskId, claimed.claimId, "NOT_YOURS"]]);
  assert.equal(o.logs.length, 1);
  assert.match(o.logs[0], NO_LONGER_MINE);

  const recovered = await took(o.scheduler, "recovered");
  assert.deepEqual(recordOf(recovered), ["be", claimed.taskId, hub.claimId, "claimed", 0]);
  assert.equal(recovered.lastFailure, null, "a new record: no attempt of this claim has failed yet");
  assert.deepEqual(recovered.task.lastFailure, { reason: "verify failed: npm test", memo: "only touch src/a.ts" });

  // The Hub holds one open Task for A: this one. Another repo's claim gets nothing and names it.
  const open = o.h.board.story(o.h.plLink, o.h.story.id).tasks.filter((x) => x.assignee?.id === o.member.id);
  assert.deepEqual(open.map((x) => [x.title, x.state]), [["be-1", "claimed"]]);
  assert.deepEqual(await storyLink(o.h.cfgOf("fe")).claim(), {
    task: null,
    open: { storyNumber: o.h.story.number, taskNumber: claimed.task.number, repoName: "be", state: "claimed" },
  });
  // And the new claim takes the heartbeat.
  await o.scheduler.beat();
  assert.equal(o.logs.length, 1);
  assert.equal(o.view("be-1").stage, "build");
});

test("with auto work off the scheduler's tick claims nothing and says no open Task; turned on, the next tick claims the oldest ready Task", async (t) => {
  const o = await office(t);
  o.web.autoWork(false);
  assert.deepEqual(await o.scheduler.tick(), { claimed: null, open: null });
  assert.equal(o.scheduler.blockedBy(), null);
  assert.equal(o.store.openClaim(), null);
  assert.deepEqual(["be-1", "fe-1"].map((title) => o.view(title).state), ["ready", "ready"]);

  o.web.autoWork(true);
  const first = await took(o.scheduler, "claimed");
  assert.equal(first.task.title, "be-1");
  assert.equal(first.claimId, (await o.mine("be")).claimId);

  // Turned off while A holds a Task: that Task goes on to the end, its heartbeat and merged report are taken.
  o.web.autoWork(false);
  await o.scheduler.beat();
  assert.deepEqual(o.logs, []);
  assert.equal(o.view("be-1").stage, "build");
  await o.merged(first);
  assert.equal(o.view("be-1").state, "merged");
  // Then nothing new comes, though be-2 is ready now and fe-1 still is.
  assert.deepEqual(await o.scheduler.tick(), { claimed: null, open: null });
  assert.equal(o.store.openClaim(), null);
  assert.deepEqual(["be-2", "fe-1"].map((title) => o.view(title).state), ["ready", "ready"]);

  o.web.autoWork(true);
  const next = await took(o.scheduler, "claimed");
  assert.equal(next.task.title, "be-2");
  assert.equal(next.claimId, (await o.mine("be")).claimId);
  assert.deepEqual(o.logs, []);
});

test("a PL release from the web drops the assignee's record at its next beat (NOT_YOURS)", async (t) => {
  const o = await office(t);
  // A held Task: claimed, and the Office went quiet for over 10 minutes.
  const held = await took(o.scheduler, "claimed");
  o.h.tick(600001);
  assert.equal(o.view("be-1").state, "held");
  assert.deepEqual(o.web.release(held.taskId), { ok: true });
  assert.equal(o.store.openClaim().claimId, held.claimId, "the web changed only the Hub");
  await o.scheduler.beat();
  assert.equal(o.store.openClaim(), null);
  assert.deepEqual(o.dropped, [[held.taskId, held.claimId, "NOT_YOURS"]]);
  assert.equal(o.logs.length, 1);
  assert.match(o.logs[0], NO_LONGER_MINE);

  // A failed Task: the record held in phase failed is read at the beat and dropped the same way.
  const again = await took(o.scheduler, "claimed");
  assert.equal(again.taskId, held.taskId);
  assert.notEqual(again.claimId, held.claimId);
  await o.gaveUp(again, "verify failed: npm test");
  await o.scheduler.beat();
  assert.equal(o.store.openClaim().phase, "failed");
  assert.deepEqual(o.web.release(again.taskId), { ok: true });
  await o.scheduler.beat();
  assert.equal(o.store.openClaim(), null);
  assert.deepEqual(o.dropped.at(-1), [again.taskId, again.claimId, "NOT_YOURS"]);
  assert.equal(o.logs.length, 2);
  assert.match(o.logs[1], NO_LONGER_MINE);

  // The Hub: ready again and nobody's.
  const view = o.view("be-1");
  assert.deepEqual([view.state, view.assignee], ["ready", null]);
  assert.equal(await o.mine("be"), null);
});

test("a lane that is not ready (gh) is not reachable, so the web cannot pick its Task, while the ready lane's Task can be picked", async (t) => {
  const o = await office(t, { laneState: { fe: "gh" } });
  o.web.autoWork(false);
  const be1 = o.view("be-1"), fe1 = o.view("fe-1");
  assert.deepEqual(o.web.reachable(), [], "before the Office's first tick no link has been used");
  assert.throws(() => o.web.pick(be1.id), (e) => e.code === "NOT_LINKED");

  // One tick with no record: recovery reads the inbox of every ready lane, and the claim asks them; fe is skipped.
  assert.deepEqual(await o.scheduler.tick(), { claimed: null, open: null });
  assert.deepEqual(o.web.reachable(), [o.h.repos.be]);
  const work = o.h.board.memberWork(o.member.id, o.h.store.reachableRepos(o.member.id));
  assert.deepEqual(
    work.ready.map((c) => [c.title, c.pick]),
    [["be-1", "yes"], ["fe-1", "not-linked"]],
    "home offers 작업하기 only where the Office takes it",
  );

  // fe-1: refused, and nothing changes; the member is not made busy for every repo.
  assert.throws(() => o.web.pick(fe1.id), (e) => e.code === "NOT_LINKED" && e.status === 409);
  assert.deepEqual([o.view("fe-1").state, o.view("fe-1").assignee], ["ready", null]);
  assert.equal(await o.mine("be"), null);

  // be-1: picked, and the next tick takes it back.
  assert.deepEqual(o.web.pick(be1.id), { ok: true });
  const recovered = await took(o.scheduler, "recovered");
  assert.deepEqual([recovered.project, recovered.taskId], ["be", be1.id]);
  assert.deepEqual(o.logs, []);
});
