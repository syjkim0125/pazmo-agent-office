import test from "node:test";
import assert from "node:assert/strict";
import { storyLink, classifyLinkError } from "../src/team/story-link.ts";
import { hubWithStory } from "./team-fixture.mjs";

const hubError = (status, code, expected) => Object.assign(new Error(code), { status, code, expected });
/** A fake `hubCall` that records its arguments and answers with `reply` (or throws it when it is an Error). */
function fakeCall(reply) {
  const calls = [];
  const call = async (...args) => {
    calls.push(args);
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(...args) : reply;
  };
  return { call, calls };
}
const mergeReport = (task, over = {}) => ({
  taskId: task.taskId, claimId: task.claimId, prUrl: "https://github.example.com/team/be/pull/7", mergeCommit: "a".repeat(40),
  summary: "[변경사항]\n1. 작업\n2. 파일\n3. 확인", assumptions: ["ASSUMED: code is upper case"], ...over,
});
const cfg = { hub: "https://hub.example.com", caPem: null, fingerprint: null, token: "t", memberId: "m", memberName: "A", repoId: "r" };

test("claim gives the first Task of the repo on a story branch, and a second claim by the same person is null", async (t) => {
  const { cfgOf, story } = await hubWithStory(t);
  const { task, open } = await storyLink(cfgOf("be")).claim();
  assert.equal(open, null);
  assert.equal(task.title, "be-1");
  assert.equal(task.kind, "work");
  assert.equal(task.repoId, cfgOf("be").repoId);
  assert.match(task.branch, /^feature\/story-\d+\/task-\d+$/);
  assert.equal(task.branch, `feature/story-${story.number}/task-${story.number + 1}`);
  assert.deepEqual(await storyLink(cfgOf("fe")).claim(), {
    task: null,
    open: { storyNumber: story.number, taskNumber: task.number, repoName: "be", state: "claimed" },
  });
});

test("a claim names the open Task in the way, failed or not, and is {task:null, open:null} when nothing is open", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const be = storyLink(cfgOf("be"));
  const fe = storyLink(cfgOf("fe"));
  const { task } = await fe.claim();
  assert.equal(task.title, "fe-1");
  const inWay = { storyNumber: task.story.number, taskNumber: task.number, repoName: "fe" };
  assert.deepEqual(await be.claim(), { task: null, open: { ...inWay, state: "claimed" } });
  await fe.failed(task.taskId, task.claimId, "verify failed");
  assert.deepEqual(await be.claim(), { task: null, open: { ...inWay, state: "failed" } });
  // Merged for good, the Task is no longer open: the repo has nothing more and nothing blocks it.
  const rerun = await fe.rerun(task.taskId, "again");
  await fe.mergeLock(task.taskId, rerun.claimId);
  await fe.merged({ ...mergeReport(rerun), mergeCommit: "c".repeat(40) });
  assert.deepEqual(await fe.claim(), { task: null, open: null });
});

test("the inbox shows the claim the Office was given, and task() returns the same Task for it", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  assert.equal((await link.inbox()).mine, null);
  const { task } = await link.claim();
  const inbox = await link.inbox();
  assert.equal(inbox.mine.claimId, task.claimId);
  assert.equal(inbox.mine.taskId, task.taskId);
  assert.equal(inbox.mine.state, "claimed");
  // A work Task shows only in the inbox of the link of its own repo: the fe link cannot report on it.
  assert.equal((await storyLink(cfgOf("fe")).inbox()).mine, null);
  assert.deepEqual(await link.task(task.taskId, task.claimId), task);
});

test("heartbeat resolves with nothing while the claim is held", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const { task } = await link.claim();
  assert.equal(await link.heartbeat(task.taskId, task.claimId, "build"), undefined);
});

test("after the PL releases a held Task the old claim is rejected as not-yours", async (t) => {
  const { cfgOf, tick, release } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const { task } = await link.claim();
  tick(600001);
  release(task.taskId);
  const beat = await link.heartbeat(task.taskId, task.claimId, "build").then(() => null, (e) => e);
  assert.ok(beat, "the late heartbeat must fail");
  assert.equal(classifyLinkError(beat), "not-yours");
  const fetched = await link.task(task.taskId, task.claimId).then(() => null, (e) => e);
  assert.equal(classifyLinkError(fetched), "not-yours");
  // The released Task is free again and the member can take it fresh, under a new claim.
  const { task: again } = await link.claim();
  assert.equal(again.taskId, task.taskId);
  assert.notEqual(again.claimId, task.claimId);
});

test("a Task that is not yet held cannot be released (state), so its claim stays valid", async (t) => {
  const { cfgOf, tick, release } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const { task } = await link.claim();
  tick(600000); // exactly the limit is not held yet
  assert.throws(() => release(task.taskId), (e) => classifyLinkError(e) === "state");
  await link.heartbeat(task.taskId, task.claimId, "build");
});

test("mergeLock grants the holder again; merged is answered already on a resend and readies the next Task", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const { task } = await link.claim();
  assert.deepEqual(await link.mergeLock(task.taskId, task.claimId), { granted: true, holder: null });
  assert.deepEqual(await link.mergeLock(task.taskId, task.claimId), { granted: true, holder: null });
  const report = mergeReport(task);
  const first = await link.merged(report);
  assert.equal(first.already, false);
  assert.equal(first.ready.length, 1, "be-2 waited on be-1 and is ready now");
  assert.deepEqual(await link.merged(report), { already: true, ready: [] });
  const next = await link.claim();
  assert.equal(next.task.title, "be-2");
  assert.equal(next.task.number, first.ready[0]);
  assert.deepEqual(next.task.upstream.map((u) => u.number), [task.number]);
});

test("mergeUnlock gives the lock back and resolves with nothing, also for a lock that is not held", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const { task } = await link.claim();
  assert.equal(await link.mergeUnlock(task.taskId, task.claimId), undefined);
  await link.mergeLock(task.taskId, task.claimId);
  assert.equal(await link.mergeUnlock(task.taskId, task.claimId), undefined);
  assert.deepEqual(await link.mergeLock(task.taskId, task.claimId), { granted: true, holder: null });
});

test("after failed, rerun gives the same Task under a new claim with the last failure and the memo; the old claim is not-yours", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const { task } = await link.claim();
  assert.equal(await link.failed(task.taskId, task.claimId, "verify failed: npm test"), undefined);
  assert.equal(await link.failed(task.taskId, task.claimId, "verify failed: npm test"), undefined, "a resend after a lost reply is fine");
  const again = await link.rerun(task.taskId, "fix the types first");
  assert.equal(again.taskId, task.taskId);
  assert.notEqual(again.claimId, task.claimId);
  assert.deepEqual(again.lastFailure, { reason: "verify failed: npm test", memo: "fix the types first" });
  const stale = await link.heartbeat(task.taskId, task.claimId, "build").then(() => null, (e) => e);
  assert.equal(classifyLinkError(stale), "not-yours");
  await link.heartbeat(again.taskId, again.claimId, "build");
});

test("the report calls fail as lock, invalid, state or not-found when the Hub refuses them", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const kind = (promise) => promise.then(() => null, classifyLinkError);
  const { task } = await link.claim();
  assert.equal(await kind(link.merged(mergeReport(task))), "lock", "merged needs the lock first");
  await link.mergeLock(task.taskId, task.claimId);
  assert.equal(await kind(link.merged(mergeReport(task, { mergeCommit: "not a commit" }))), "invalid");
  assert.equal(await kind(link.rerun(task.taskId, "memo")), "state", "only a failed Task can be rerun");
  assert.equal(await kind(link.mergeLock("no-such-task", task.claimId)), "not-found");
  assert.equal(await kind(link.rerun("no-such-task", "memo")), "not-found");
});

test("a real hub rejecting the token or being unreachable is classified relink or retry", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const revoked = await storyLink({ ...cfgOf("be"), token: "x".repeat(43) }).inbox().then(() => null, (e) => e);
  assert.equal(revoked.status, 401);
  assert.equal(classifyLinkError(revoked), "relink");
  const down = await storyLink({ ...cfgOf("be"), hub: "https://127.0.0.1:1" }).inbox().then(() => null, (e) => e);
  assert.equal(down.code, "ECONNREFUSED");
  assert.equal(classifyLinkError(down), "retry");
});

test("classifyLinkError maps the hub's answers to what the Office should do", () => {
  assert.equal(classifyLinkError(hubError(409, "NOT_YOURS")), "not-yours");
  assert.equal(classifyLinkError(hubError(409, "STATE")), "state");
  assert.equal(classifyLinkError(hubError(409, "CONFLICT")), "retry");
  assert.equal(classifyLinkError(hubError(401, "UNAUTHORIZED")), "relink");
  assert.equal(classifyLinkError(hubError(401, "HUB_401")), "relink");
  assert.equal(classifyLinkError(Object.assign(new Error("tls"), { code: "HUB_TLS_UNTRUSTED" })), "relink");
  assert.equal(classifyLinkError(hubError(426, "PROTOCOL_MISMATCH", "2")), "hub-too-old");
  assert.equal(classifyLinkError(hubError(426, "PROTOCOL_MISMATCH", "1")), "hub-too-old");
  assert.equal(classifyLinkError(hubError(426, "PROTOCOL_MISMATCH", "3")), "retry");
  assert.equal(classifyLinkError(hubError(426, "PROTOCOL_MISMATCH", undefined)), "retry");
  assert.equal(classifyLinkError(hubError(400, "INVALID")), "invalid");
  assert.equal(classifyLinkError(hubError(409, "LOCK_REQUIRED")), "lock");
  assert.equal(classifyLinkError(hubError(404, "NOT_FOUND")), "not-found");
  // The status and the code both have to match.
  assert.equal(classifyLinkError(hubError(400, "NOT_FOUND")), "retry");
  assert.equal(classifyLinkError(hubError(404, "INVALID")), "retry");
  assert.equal(classifyLinkError(hubError(409, "INVALID")), "retry");
  assert.equal(classifyLinkError(hubError(409, "BUSY")), "retry");
  assert.equal(classifyLinkError(hubError(500, "HUB_500")), "retry");
  assert.equal(classifyLinkError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })), "retry");
  assert.equal(classifyLinkError(new Error("HUB_TIMEOUT")), "retry");
  for (const value of [null, undefined, "NOT_YOURS", 409, {}, { status: "409", code: "NOT_YOURS" }]) assert.equal(classifyLinkError(value), "retry");
});

test("a fake call throwing 426 or 401 is classified hub-too-old or relink through the client", async (t) => {
  const old = fakeCall(hubError(426, "PROTOCOL_MISMATCH", "2"));
  const err426 = await storyLink(cfg, old.call).claim().then(() => null, (e) => e);
  assert.equal(classifyLinkError(err426), "hub-too-old");
  const unauthorized = fakeCall(hubError(401, "UNAUTHORIZED"));
  const err401 = await storyLink(cfg, unauthorized.call).heartbeat("t", "c", "build").then(() => null, (e) => e);
  assert.equal(classifyLinkError(err401), "relink");
});

test("each call goes to the story route with protocol 3 and the exact request shape", async () => {
  const task = { taskId: "t1", claimId: "c1" };
  const fake = fakeCall((_cfg, _method, path) => {
    if (path.endsWith("/claim")) return { task };
    if (path.includes("/task?")) return { task };
    if (path.endsWith("/inbox")) return { mine: null, alerts: [], verifyReady: [] };
    if (path.endsWith("/merge-lock")) return { granted: false, holder: 5 };
    if (path.endsWith("/merged")) return { ok: true, already: false, ready: [6, 7] };
    if (path.endsWith("/rerun")) return { task };
    return { ok: true };
  });
  const link = storyLink(cfg, fake.call);
  assert.deepEqual(await link.claim(), { task, open: null });
  assert.deepEqual(await link.inbox(), { mine: null, alerts: [], verifyReady: [] });
  assert.deepEqual(await link.task("t 1&x", "c/1=?"), task);
  assert.equal(await link.heartbeat("t1", "c1", "review"), undefined);
  assert.deepEqual(await link.mergeLock("t1", "c1"), { granted: false, holder: 5 });
  assert.equal(await link.mergeUnlock("t1", "c1"), undefined);
  const report = mergeReport(task);
  // Only the documented fields are sent, even if the caller's object carries more.
  assert.deepEqual(await link.merged({ ...report, extra: "x" }), { already: false, ready: [6, 7] });
  assert.equal(await link.failed("t1", "c1", "gave up"), undefined);
  assert.deepEqual(await link.rerun("t1", "again"), task);
  assert.deepEqual(fake.calls, [
    [cfg, "POST", "/api/link/story/claim", {}, "3"],
    [cfg, "GET", "/api/link/story/inbox", undefined, "3"],
    [cfg, "GET", "/api/link/story/task?id=t%201%26x&claimId=c%2F1%3D%3F", undefined, "3"],
    [cfg, "POST", "/api/link/story/heartbeat", { taskId: "t1", claimId: "c1", stage: "review" }, "3"],
    [cfg, "POST", "/api/link/story/merge-lock", { taskId: "t1", claimId: "c1" }, "3"],
    [cfg, "POST", "/api/link/story/merge-unlock", { taskId: "t1", claimId: "c1" }, "3"],
    [cfg, "POST", "/api/link/story/merged", report, "3"],
    [cfg, "POST", "/api/link/story/failed", { taskId: "t1", claimId: "c1", reason: "gave up" }, "3"],
    [cfg, "POST", "/api/link/story/rerun", { taskId: "t1", memo: "again" }, "3"],
  ]);
});

test("claim() sends an empty JSON object, never no body", async () => {
  const fake = fakeCall({ task: null, open: null });
  assert.deepEqual(await storyLink(cfg, fake.call).claim(), { task: null, open: null });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0][3], {});
});

test("claim() passes the open Task on, and a Hub that sends no open field counts as none", async () => {
  const open = { storyNumber: 4, taskNumber: 9, repoName: "be", state: "failed" };
  assert.deepEqual(await storyLink(cfg, fakeCall({ task: null, open }).call).claim(), { task: null, open });
  const verify = { ...open, repoName: null, state: "claimed" };
  assert.deepEqual(await storyLink(cfg, fakeCall({ task: null, open: verify }).call).claim(), { task: null, open: verify });
  assert.deepEqual(await storyLink(cfg, fakeCall({ task: null }).call).claim(), { task: null, open: null });
});

test("a reply without the expected field is a bad response, never a claim", async () => {
  for (const reply of [null, {}, "x", { task: "x" }]) {
    await assert.rejects(storyLink(cfg, fakeCall(reply).call).claim(), (e) => e.code === "HUB_BAD_RESPONSE" && classifyLinkError(e) === "retry");
  }
  await assert.rejects(storyLink(cfg, fakeCall({ task: null }).call).task("t", "c"), /HUB_BAD_RESPONSE/);
  for (const reply of [null, {}, { mine: "x" }, { mine: null }])
    await assert.rejects(storyLink(cfg, fakeCall(reply).call).inbox(), /HUB_BAD_RESPONSE/);
});

test("an open Task that is not the documented shape is a bad response", async () => {
  const open = { storyNumber: 4, taskNumber: 9, repoName: "be", state: "claimed" };
  for (const bad of ["x", {}, { ...open, state: "ready" }, { ...open, storyNumber: "4" }, { ...open, taskNumber: undefined }, { ...open, repoName: 7 }])
    await assert.rejects(storyLink(cfg, fakeCall({ task: null, open: bad }).call).claim(), /HUB_BAD_RESPONSE/);
});

test("rerun and the report replies are checked for their shape too", async () => {
  await assert.rejects(storyLink(cfg, fakeCall({ task: null }).call).rerun("t", "m"), /HUB_BAD_RESPONSE/);
  await assert.rejects(storyLink(cfg, fakeCall({}).call).rerun("t", "m"), /HUB_BAD_RESPONSE/);
  for (const reply of [null, {}, { granted: "yes", holder: null }, { granted: true }, { granted: true, holder: "5" }])
    await assert.rejects(storyLink(cfg, fakeCall(reply).call).mergeLock("t", "c"), /HUB_BAD_RESPONSE/);
  const bad = [null, {}, { ok: true, already: false }, { ok: true, ready: [] }, { ok: true, already: "no", ready: [] }, { ok: true, already: false, ready: ["6"] }, { ok: true, already: false, ready: 6 }];
  for (const reply of bad)
    await assert.rejects(storyLink(cfg, fakeCall(reply).call).merged(mergeReport({ taskId: "t", claimId: "c" })), /HUB_BAD_RESPONSE/);
});
