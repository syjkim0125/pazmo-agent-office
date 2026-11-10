import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestHub } from "./hub-fixture.mjs";
import { startHub } from "../src/hub/run.ts";
import { planLink, planFailure } from "../src/team/plan-link.ts";
import { planStoryKey } from "../src/hub/plan-protocol.ts";

const REMOTE = (name) => `https://github.example.com/team/${name}`;
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const DRAFT = "# Story: 쿠폰 발급\n\n## Decisions\n- ASSUMED: 쿠폰은 한 번만 쓴다\n";
const q1 = { id: "Q1", text: "쿠폰은 몇 번 쓰나요?", reason: "한 번이면 막아야 합니다.", blocking: true };
const ROUTES = ["plan-next", "plan-heartbeat", "plan-result"];
const hubError = (status, code, expected) => Object.assign(new Error(code), { status, code, expected });
/** Two Office instances of the PL: the lease holder ids they send. */
const H = "a".repeat(32), H2 = "0123456789abcdef".repeat(2);
const SHA1 = "1".repeat(40), SHA2 = "2".repeat(40);
const badResponse = (e) => e.code === "HUB_BAD_RESPONSE";

/**
 * A real TLS Hub with a PL who owns app-be and app-fe (one project over both) and B who owns app-fe only.
 * `cfgOf(member, name)` is that member's Office link config for the repo; `tick(ms)` ages leases.
 */
async function world(t, { plans = true } = {}) {
  let now = Date.now();
  const hub = await startTestHub(t, { now: () => now, plans });
  const { store, board, tls } = hub;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  const pl = join("PL"), b = join("B");
  const repos = {};
  for (const name of ["app-be", "app-fe"]) repos[name] = store.addRepo(admin, name, `git@github.example.com:team/${name}.git`);
  for (const [m, name] of [[pl, "app-be"], [pl, "app-fe"], [b, "app-fe"]]) store.addOwner(admin, repos[name], m.id);
  // A new pair for the same (member, repo) revokes the previous token, so each pair is made once and kept.
  const tokens = new Map();
  const tokenOf = (m, name) => {
    const key = `${m.id}:${name}`;
    if (!tokens.has(key)) tokens.set(key, store.pair(store.createLinkCode(m, repos[name]), REMOTE(name)).token);
    return tokens.get(key);
  };
  const cfgOf = (m, name) => ({
    hub: hub.hub.url, caPem: tls.caPem, fingerprint: tls.fingerprint, token: tokenOf(m, name),
    memberId: m.id, memberName: m.name, repoId: repos[name], repoName: name,
  });
  const plBe = store.link(tokenOf(pl, "app-be"));
  const { projectId } = board.createProject(plBe, "쿠폰 개편", [
    { repoId: repos["app-be"], baseBranch: "main" }, { repoId: repos["app-fe"], baseBranch: "develop" },
  ]);
  const create = () => hub.plans.createPlan(pl, { projectId, title: "쿠폰 발급", intent: "쿠폰을 한 번에 발급하고 싶어요.", risk: "normal" }).planId;
  const view = (id) => hub.plans.plan({ member: pl }, id);
  const post = (m, name, route, body, protocol = "3") => hub.api("POST", `/api/link/story/${route}`, { token: tokenOf(m, name), protocol, body });
  return { ...hub, pl, b, repos, projectId, tokenOf, cfgOf, create, view, post, tick: (ms) => (now += ms) };
}
/** A fake `hubCall` that records its arguments and answers with `reply`. */
function fakeCall(reply) {
  const calls = [];
  const call = async (...args) => {
    calls.push(args);
    return typeof reply === "function" ? reply(...args) : reply;
  };
  return { call, calls };
}
const fakeCfg = { hub: "https://hub.example.com", caPem: null, fingerprint: null, token: "t", memberId: "m", memberName: "PL", repoId: "r" };

test("plan-next, plan-heartbeat and plan-result work over protocol 3 through the PL's link of either project repo; protocol 2 is 426 PROTOCOL_MISMATCH", async (t) => {
  const w = await world(t);
  const { pl, b, post } = w;
  assert.deepEqual((await post(pl, "app-be", "plan-next", { holder: H })).json, { lease: null });
  const id = w.create();
  const first = await post(pl, "app-be", "plan-next", { holder: H });
  assert.equal(first.status, 200);
  assert.equal(first.json.lease.plan.id, id);
  assert.equal(first.json.lease.revision, 1);
  // The same person through the other repo's link: the live lease comes back as it is.
  const again = (await post(pl, "app-fe", "plan-next", { holder: H })).json.lease;
  assert.equal(again.leaseId, first.json.lease.leaseId);
  const { leaseId, revision } = again;
  assert.deepEqual((await post(pl, "app-fe", "plan-heartbeat", { planId: id, leaseId, holder: H })).json, { ok: true });
  const done = await post(pl, "app-be", "plan-result", { planId: id, leaseId, revision, holder: H, result: { kind: "questions", questions: [q1] } });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json, { ok: true, revision: 2 });
  assert.equal(w.view(id).state, "questions");
  // Waiting for the PL's answers: no Office work.
  assert.deepEqual((await post(pl, "app-fe", "plan-next", { holder: H })).json, { lease: null });
  // Another member's link sees none of the PL's work.
  assert.deepEqual((await post(b, "app-fe", "plan-next", { holder: H })).json, { lease: null });

  for (const route of ROUTES) {
    const old = await post(pl, "app-be", route, {}, "2");
    assert.equal(old.status, 426, route);
    assert.equal(old.json.error, "PROTOCOL_MISMATCH");
    assert.equal(old.json.expected, "3");
    assert.equal((await w.api("GET", `/api/link/story/${route}`, { token: w.tokenOf(pl, "app-be"), protocol: "3" })).status, 405, route);
    assert.equal((await w.api("POST", `/api/link/story/${route}`, { protocol: "3", body: {} })).status, 401, route);
  }
  // Wrong types are refused before the board; the board judges the result's content.
  assert.equal((await post(pl, "app-be", "plan-heartbeat", { planId: id, leaseId: 1, holder: H })).json.error, "INVALID");
  assert.equal((await post(pl, "app-be", "plan-result", { planId: id, leaseId, revision: "2", holder: H, result: { kind: "failed", reason: "x" } })).json.error, "INVALID");
});

test("the three plan routes need holder, 32 lowercase hex: missing or malformed is 400 INVALID; while a lease is live another holder of the same PL gets lease null, and NOT_YOURS on heartbeat and result", async (t) => {
  const w = await world(t);
  const { pl, post } = w;
  const id = w.create();
  const bodies = (holder) => ({
    "plan-next": { ...holder },
    "plan-heartbeat": { planId: id, leaseId: "l", ...holder },
    "plan-result": { planId: id, leaseId: "l", revision: 1, result: { kind: "failed", reason: "x" }, ...holder },
  });
  for (const holder of [{}, { holder: 42 }, { holder: "" }, { holder: "A".repeat(32) }, { holder: "a".repeat(31) }])
    for (const [route, body] of Object.entries(bodies(holder))) {
      const r = await post(pl, "app-be", route, body);
      assert.deepEqual([r.status, r.json.error], [400, "INVALID"], `${route} ${JSON.stringify(holder)}`);
    }
  assert.equal(w.view(id).leased, false);
  const { leaseId, revision } = (await post(pl, "app-be", "plan-next", { holder: H })).json.lease;
  assert.deepEqual((await post(pl, "app-fe", "plan-next", { holder: H2 })).json, { lease: null });
  const beat = await post(pl, "app-fe", "plan-heartbeat", { planId: id, leaseId, holder: H2 });
  assert.deepEqual([beat.status, beat.json.error], [409, "NOT_YOURS"]);
  const result = await post(pl, "app-fe", "plan-result", { planId: id, leaseId, revision, holder: H2, result: { kind: "failed", reason: "레포가 없습니다." } });
  assert.deepEqual([result.status, result.json.error], [409, "NOT_YOURS"]);
  assert.equal(w.view(id).state, "queued");
});

test("plan-heartbeat's 409 STATE carries the plan's state as JSON {error, message, state}: cancelled or failed", async (t) => {
  const w = await world(t);
  const { pl, post } = w;
  const cancelled = w.create();
  const a = (await post(pl, "app-be", "plan-next", { holder: H })).json.lease;
  w.plans.cancel({ member: pl }, cancelled, 1);
  const r1 = await post(pl, "app-be", "plan-heartbeat", { planId: cancelled, leaseId: a.leaseId, holder: H });
  assert.equal(r1.status, 409);
  assert.deepEqual(r1.json, { error: "STATE", message: "이 기획은 지금 Office가 할 일이 없습니다.", state: "cancelled" });
  const failed = w.create();
  const b = (await post(pl, "app-be", "plan-next", { holder: H })).json.lease;
  await post(pl, "app-be", "plan-result", { planId: failed, leaseId: b.leaseId, revision: b.revision, holder: H, result: { kind: "failed", reason: "멈춤" } });
  const r2 = await post(pl, "app-be", "plan-heartbeat", { planId: failed, leaseId: b.leaseId, holder: H });
  assert.deepEqual([r2.status, r2.json.error, r2.json.state], [409, "STATE", "failed"]);
  // planLink hands the state on, so the Office can tell a cancel from the rest.
  const e = await planLink(w.cfgOf(pl, "app-be"), undefined, H).heartbeat(failed, b.leaseId).then(() => assert.fail("expected a refusal"), (x) => x);
  assert.deepEqual([e.status, e.code, e.state], [409, "STATE", "failed"]);
});

test("plan-heartbeat carries bases {repoId: commit}: the Hub keeps each repo's first commit and plan-next shows them; another commit is 409 BASES_CHANGED and changes nothing", async (t) => {
  const w = await world(t);
  const { pl, post } = w;
  const be = w.repos["app-be"], fe = w.repos["app-fe"];
  const id = w.create();
  const first = (await post(pl, "app-be", "plan-next", { holder: H })).json.lease;
  await post(pl, "app-be", "plan-result", { planId: id, leaseId: first.leaseId, revision: first.revision, holder: H, result: { kind: "draft", text: DRAFT, story: { title: "쿠폰 발급" } } });
  const v = w.view(id);
  w.plans.approve(pl, id, "G1", v.revision, v.draft.hash);
  const lease = (await post(pl, "app-be", "plan-next", { holder: H })).json.lease;
  assert.deepEqual(lease.plan.bases, {});
  const beat = (bases) => post(pl, "app-be", "plan-heartbeat", { planId: id, leaseId: lease.leaseId, holder: H, bases });
  assert.deepEqual((await beat({ [be]: SHA1 })).json, { ok: true });
  assert.deepEqual((await beat({ [be]: SHA1, [fe]: SHA2 })).json, { ok: true });
  const changed = await beat({ [fe]: SHA1 });
  assert.equal(changed.status, 409);
  assert.deepEqual(changed.json, { error: "BASES_CHANGED", message: "레포 app-fe의 Story base 커밋은 이미 다른 커밋으로 적혀 있어 바꿀 수 없습니다." });
  assert.deepEqual([(await beat({ [be]: "x" })).status, (await beat(["x"])).json.error], [400, "INVALID"]);
  assert.deepEqual((await post(pl, "app-fe", "plan-next", { holder: H })).json.lease.plan.bases, { [be]: SHA1, [fe]: SHA2 });
  assert.equal(w.view(id).revision, lease.revision, "the lease's result still fits");
});

test("planLink.next is null without work and a lease with the plan's repos otherwise; a reply without leaseId, revision or plan is HUB_BAD_RESPONSE", async (t) => {
  const w = await world(t);
  const link = planLink(w.cfgOf(w.pl, "app-fe"));
  assert.equal(link.repoId, w.repos["app-fe"]);
  assert.equal(await link.next(), null);
  const id = w.create();
  const lease = await link.next();
  assert.equal(lease.plan.id, id);
  assert.equal(lease.revision, 1);
  assert.equal(typeof lease.leaseId, "string");
  assert.deepEqual(lease.plan.repos.map((r) => [r.name, r.baseBranch]), [["app-be", "main"], ["app-fe", "develop"]]);
  assert.equal(await link.heartbeat(id, lease.leaseId), undefined);
  assert.equal(await link.result(id, lease.leaseId, lease.revision, { kind: "questions", questions: [q1] }), undefined);
  assert.equal(w.view(id).state, "questions");

  const ok = { leaseId: "l", revision: 1, plan: { id: "p", repos: [] } };
  const { call, calls } = fakeCall({ lease: ok });
  assert.deepEqual(await planLink(fakeCfg, call, H).next(), ok);
  assert.deepEqual(calls[0], [fakeCfg, "POST", "/api/link/story/plan-next", { holder: H }, "3"]);
  for (const reply of [
    null, {}, { lease: undefined }, { lease: "x" },
    { lease: { revision: 1, plan: ok.plan } }, { lease: { leaseId: "l", plan: ok.plan } }, { lease: { leaseId: "l", revision: 1 } },
    { lease: { ...ok, revision: "1" } }, { lease: { ...ok, plan: { repos: [] } } }, { lease: { ...ok, plan: { id: "p" } } },
  ])
    await assert.rejects(planLink(fakeCfg, fakeCall(reply).call).next(), badResponse, JSON.stringify(reply));
});

test("a stale result is planFailure stale; a replaced lease's heartbeat is not-yours; a cancelled plan's heartbeat is state", async (t) => {
  const w = await world(t);
  const link = planLink(w.cfgOf(w.pl, "app-be"));
  const id = w.create();
  const lease = await link.next();
  const fail = (promise) => promise.then(() => assert.fail("expected a refusal"), (e) => e);

  const stale = await fail(link.result(id, lease.leaseId, lease.revision + 1, { kind: "failed", reason: "x" }));
  assert.equal(planFailure(stale), "stale");
  assert.equal(w.view(id).revision, 1);

  // 600000 ms without a heartbeat: the old lease has ended, and asking again leases the plan anew.
  w.tick(600_001);
  assert.equal(planFailure(await fail(link.heartbeat(id, lease.leaseId))), "gone");
  const second = await link.next();
  assert.notEqual(second.leaseId, lease.leaseId);
  assert.equal(planFailure(await fail(link.heartbeat(id, lease.leaseId))), "not-yours");
  // Another member's link on the PL's plan is not theirs either.
  assert.equal(planFailure(await fail(planLink(w.cfgOf(w.b, "app-fe")).heartbeat(id, second.leaseId))), "not-yours");
  assert.equal(planFailure(await fail(link.heartbeat("00000000-0000-4000-8000-000000000000", second.leaseId))), "gone");

  w.plans.cancel({ member: w.pl }, id, w.view(id).revision);
  assert.equal(planFailure(await fail(link.heartbeat(id, second.leaseId))), "state");
  assert.equal(planFailure(await fail(link.result(id, second.leaseId, second.revision, { kind: "failed", reason: "x" }))), "stale");
});

test("a Hub started without plans answers 404 for the three routes and planFailure says hub-too-old", async (t) => {
  const w = await world(t, { plans: false });
  assert.equal(w.plans, undefined);
  for (const route of ROUTES) {
    // Like a Hub from before the plan routes: no such route, whatever the protocol or token.
    for (const protocol of ["3", "2"]) {
      const r = await w.post(w.pl, "app-be", route, {}, protocol);
      assert.equal(r.status, 404, `${route} ${protocol}`);
      assert.deepEqual(r.json, { error: "NOT_FOUND" });
    }
    assert.equal((await w.api("POST", `/api/link/story/${route}`, { protocol: "3", body: {} })).status, 404);
  }
  const link = planLink(w.cfgOf(w.pl, "app-be"));
  const e = await link.next().then(() => assert.fail("expected a refusal"), (error) => error);
  assert.equal(planFailure(e), "hub-too-old");
  // The Story routes the plan steps also use are still there.
  assert.equal((await w.api("GET", "/api/link/story/projects", { token: w.tokenOf(w.pl, "app-be"), protocol: "3" })).status, 200);
});

test("the Hub that startHub runs has the plan routes: without a token they are 401, not 404", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "hub-plan-run-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const hub = await startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: 0, dataDir: data });
  t.after(() => hub.stop());
  const port = Number(hub.address().split(":").pop());
  const post = (path) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method: "POST", path, headers: { host: "h.example", "content-type": "application/json", "x-pazmo-hub-protocol": "3" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end("{}");
    });
  for (const route of ROUTES) assert.equal(await post(`/api/link/story/${route}`), 401, route);
  assert.equal(await post("/api/link/story/plan-none"), 404);
});

test("planFailure: PLAN_GONE is gone, a 404 without it hub-too-old, GRAPH_* from publish retry-split, 401 and an untrusted certificate relink, the rest retry", () => {
  assert.equal(planFailure(hubError(409, "STALE")), "stale");
  assert.equal(planFailure(hubError(409, "NOT_YOURS")), "not-yours");
  assert.equal(planFailure(hubError(409, "STATE")), "state");
  assert.equal(planFailure(hubError(404, "PLAN_GONE")), "gone");
  assert.equal(planFailure(hubError(404, "NOT_FOUND")), "hub-too-old");
  assert.equal(planFailure(hubError(404, "HUB_404")), "hub-too-old");
  // A Hub with no story routes at all answers protocol 3 with 426 and the protocol it does speak.
  assert.equal(planFailure(hubError(426, "PROTOCOL_MISMATCH", "2")), "hub-too-old");
  assert.equal(planFailure(hubError(426, "PROTOCOL_MISMATCH", "1")), "hub-too-old");
  for (const code of ["GRAPH_INVALID", "GRAPH_REPO", "GRAPH_FILES", "GRAPH_CYCLE", "GRAPH_LIMIT", "GRAPH_OVERLAP"])
    assert.equal(planFailure(hubError(400, code)), "retry-split", code);
  assert.equal(planFailure(hubError(401, "UNAUTHORIZED")), "relink");
  assert.equal(planFailure(Object.assign(new Error("x"), { code: "HUB_TLS_UNTRUSTED" })), "relink");
  for (const e of [hubError(400, "INVALID"), hubError(409, "OPEN_BLOCKING"), hubError(500, "FAILED"), hubError(426, "PROTOCOL_MISMATCH", "3"),
    new Error("HUB_TIMEOUT"), Object.assign(new Error("x"), { code: "ECONNREFUSED" }), Object.assign(new Error("x"), { code: "HUB_BAD_RESPONSE" }), "text", null, undefined])
    assert.equal(planFailure(e), "retry", String(e?.code ?? e));
});

test("planLink.publish with key plan:<planId>, open and story reach the existing story routes: a second publish answers already true with the same Story", async (t) => {
  const w = await world(t);
  const link = planLink(w.cfgOf(w.pl, "app-fe"));
  const id = w.create();
  // Draft, then G1 on the web: the plan is the Office's to split.
  const draft = await link.next();
  await link.result(id, draft.leaseId, draft.revision, { kind: "draft", text: DRAFT, story: { title: "쿠폰 발급" } });
  const v = w.view(id);
  w.plans.approve(w.pl, id, "G1", v.revision, v.draft.hash);
  const split = await link.next();
  assert.equal(split.plan.state, "splitting");

  const be = w.repos["app-be"], fe = w.repos["app-fe"];
  const input = {
    projectId: w.projectId, title: "쿠폰 발급", body: DRAFT, risk: "normal", key: planStoryKey(id),
    graph: { nodes: [{ id: "api", repoId: be, title: "api", spec: "쿠폰 API", files: ["src/api.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: fe, checks: [check] }],
  };
  const pub = await link.publish(input);
  assert.equal(pub.already, false);
  assert.equal(typeof pub.storyId, "string");
  assert.equal(typeof pub.number, "number");
  assert.deepEqual(Object.keys(pub).sort(), ["already", "number", "storyId"]);
  assert.deepEqual(await link.publish(input), { storyId: pub.storyId, number: pub.number, already: true });
  // The Hub's own record of the plan finds the same Story by the key.
  const replay = await link.next();
  assert.deepEqual(replay.plan.published, { storyId: pub.storyId, number: pub.number, state: "draft" });

  const story = await link.story(pub.storyId);
  assert.equal(story.id, pub.storyId);
  assert.equal(story.state, "draft");
  assert.deepEqual(story.branches.map((x) => [x.repoName, x.storyBase]).sort(),
    [["app-be", `feature/story-${pub.number}/base`], ["app-fe", `feature/story-${pub.number}/base`]]);
  assert.equal(await link.open(pub.storyId), undefined);
  assert.equal((await link.story(pub.storyId)).state, "open");
  await link.result(id, replay.leaseId, replay.revision, { kind: "open", storyId: pub.storyId });
  assert.equal(w.view(id).state, "open");

  // Replies that are not the documented shape are not trusted.
  for (const reply of [null, { storyId: "s", number: 1 }, { storyId: 1, number: 1, already: false }, { storyId: "s", number: "1", already: false }])
    await assert.rejects(planLink(fakeCfg, fakeCall(reply).call).publish(input), badResponse, JSON.stringify(reply));
  for (const reply of [null, { id: "s", number: 1, state: "open" }, { id: "s", number: 1, branches: [] }, { number: 1, state: "open", branches: [] }])
    await assert.rejects(planLink(fakeCfg, fakeCall(reply).call).story("s"), badResponse, JSON.stringify(reply));
  const { call, calls } = fakeCall({ id: "s/1", number: 1, state: "open", branches: [] });
  await planLink(fakeCfg, call).story("s/1");
  assert.deepEqual(calls[0], [fakeCfg, "GET", "/api/link/story/story?id=s%2F1", undefined, "3"]);
});

test("planLink.cancel reaches the existing Story cancel route: the PL's draft Story is cancelled and cannot be opened", async (t) => {
  const w = await world(t);
  const link = planLink(w.cfgOf(w.pl, "app-be"));
  const id = w.create();
  const be = w.repos["app-be"];
  const pub = await link.publish({
    projectId: w.projectId, title: "쿠폰 발급", body: DRAFT, risk: "normal", key: planStoryKey(id),
    graph: { nodes: [{ id: "api", repoId: be, title: "api", spec: "쿠폰 API", files: ["src/api.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: be, checks: [check] }],
  });
  assert.equal(await link.cancel(pub.storyId), undefined);
  assert.equal((await link.story(pub.storyId)).state, "cancelled");
  const refused = await link.open(pub.storyId).then(() => assert.fail("expected a refusal"), (e) => e);
  assert.equal(refused.status, 409);
  assert.equal(refused.code, "STATE");
  const { call, calls } = fakeCall({ ok: true });
  await planLink(fakeCfg, call).cancel("s-1");
  assert.deepEqual(calls[0], [fakeCfg, "POST", "/api/link/story/cancel", { storyId: "s-1" }, "3"]);
});
