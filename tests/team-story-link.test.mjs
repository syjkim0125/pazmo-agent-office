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
const cfg = { hub: "https://hub.example.com", caPem: null, fingerprint: null, token: "t", memberId: "m", memberName: "A", repoId: "r" };

test("claim gives the first Task of the repo on a story branch, and a second claim by the same person is null", async (t) => {
  const { cfgOf, story } = await hubWithStory(t);
  const task = await storyLink(cfgOf("be")).claim();
  assert.equal(task.title, "be-1");
  assert.equal(task.kind, "work");
  assert.equal(task.repoId, cfgOf("be").repoId);
  assert.match(task.branch, /^feature\/story-\d+\/task-\d+$/);
  assert.equal(task.branch, `feature/story-${story.number}/task-${story.number + 1}`);
  assert.equal(await storyLink(cfgOf("fe")).claim(), null);
});

test("the inbox shows the claim the Office was given, and task() returns the same Task for it", async (t) => {
  const { cfgOf } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  assert.equal((await link.inbox()).mine, null);
  const task = await link.claim();
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
  const task = await link.claim();
  assert.equal(await link.heartbeat(task.taskId, task.claimId, "build"), undefined);
});

test("after the PL releases a held Task the old claim is rejected as not-yours", async (t) => {
  const { cfgOf, tick, release } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const task = await link.claim();
  tick(600001);
  release(task.taskId);
  const beat = await link.heartbeat(task.taskId, task.claimId, "build").then(() => null, (e) => e);
  assert.ok(beat, "the late heartbeat must fail");
  assert.equal(classifyLinkError(beat), "not-yours");
  const fetched = await link.task(task.taskId, task.claimId).then(() => null, (e) => e);
  assert.equal(classifyLinkError(fetched), "not-yours");
  // The released Task is free again and the member can take it fresh, under a new claim.
  const again = await link.claim();
  assert.equal(again.taskId, task.taskId);
  assert.notEqual(again.claimId, task.claimId);
});

test("a Task that is not yet held cannot be released (state), so its claim stays valid", async (t) => {
  const { cfgOf, tick, release } = await hubWithStory(t);
  const link = storyLink(cfgOf("be"));
  const task = await link.claim();
  tick(600000); // exactly the limit is not held yet
  assert.throws(() => release(task.taskId), (e) => classifyLinkError(e) === "state");
  await link.heartbeat(task.taskId, task.claimId, "build");
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
  assert.equal(classifyLinkError(hubError(404, "NOT_FOUND")), "retry");
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
    return { ok: true };
  });
  const link = storyLink(cfg, fake.call);
  assert.deepEqual(await link.claim(), task);
  assert.deepEqual(await link.inbox(), { mine: null, alerts: [], verifyReady: [] });
  assert.deepEqual(await link.task("t 1&x", "c/1=?"), task);
  assert.equal(await link.heartbeat("t1", "c1", "review"), undefined);
  assert.deepEqual(fake.calls, [
    [cfg, "POST", "/api/link/story/claim", {}, "3"],
    [cfg, "GET", "/api/link/story/inbox", undefined, "3"],
    [cfg, "GET", "/api/link/story/task?id=t%201%26x&claimId=c%2F1%3D%3F", undefined, "3"],
    [cfg, "POST", "/api/link/story/heartbeat", { taskId: "t1", claimId: "c1", stage: "review" }, "3"],
  ]);
});

test("claim() sends an empty JSON object, never no body", async () => {
  const fake = fakeCall({ task: null });
  assert.equal(await storyLink(cfg, fake.call).claim(), null);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0][3], {});
});

test("a reply without the expected field is a bad response, never a claim", async () => {
  for (const reply of [null, {}, "x", { task: "x" }]) {
    await assert.rejects(storyLink(cfg, fakeCall(reply).call).claim(), (e) => e.code === "HUB_BAD_RESPONSE" && classifyLinkError(e) === "retry");
  }
  await assert.rejects(storyLink(cfg, fakeCall({ task: null }).call).task("t", "c"), /HUB_BAD_RESPONSE/);
  for (const reply of [null, {}, { mine: "x" }, { mine: null }])
    await assert.rejects(storyLink(cfg, fakeCall(reply).call).inbox(), /HUB_BAD_RESPONSE/);
});
