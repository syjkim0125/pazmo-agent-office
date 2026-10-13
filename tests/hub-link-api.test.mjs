import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { startTestHub } from "./hub-fixture.mjs";

async function seeded(t) {
  const ctx = await startTestHub(t);
  const { store } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const repo = store.addRepo(admin, "eevee-be", "https://github.example.com/team/eevee-be.git");
  const req = store.createRequest(b, repo, "README 목차", "normal");
  store.accept(admin, req);
  return { ...ctx, admin, b, repo, req };
}

test("the link API refuses another protocol version and calls without a link token", async (t) => {
  const { api, store, admin, repo } = await seeded(t);
  const code = store.createLinkCode(admin, repo);
  const old = await api("POST", "/api/link/pair", { body: { code, remote: "x" }, protocol: "0" });
  assert.equal(old.status, 426);
  assert.equal(old.json.expected, "1");
  assert.equal((await api("GET", "/api/link/work")).status, 401);
  assert.equal((await api("GET", "/api/link/work", { token: "x".repeat(43) })).status, 401);
});

test("pairing with the right origin returns a token that sees exactly the accepted work", async (t) => {
  const { api, store, admin, repo, req } = await seeded(t);
  const wrong = await api("POST", "/api/link/pair", { body: { code: store.createLinkCode(admin, repo), remote: "https://github.example.com/team/other" } });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.json.error, "REMOTE_MISMATCH");
  const paired = await api("POST", "/api/link/pair", { body: { code: store.createLinkCode(admin, repo), remote: "git@github.example.com:team/eevee-be.git" } });
  assert.equal(paired.status, 200);
  const work = (await api("GET", "/api/link/work", { token: paired.json.token })).json;
  assert.deepEqual(work.assignments.map((a) => a.requestId), [req]);
  const { assignmentId } = work.assignments[0];
  const bind = await api("POST", "/api/link/bind", { token: paired.json.token, body: { assignmentId, officeTaskId: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(bind.status, 200);
  const snapshot = { status: "running", title: "t", message: "PM 실행 중", decisions: [], conversation: [], diff: null, runners: [], summary: null };
  const sent = await api("POST", "/api/link/snapshot", { token: paired.json.token, body: { assignmentId, seq: 1, snapshot } });
  assert.deepEqual(sent.json, { applied: true, seq: 1 });
  assert.equal(store.requestView(req, admin.id).snapshot.message, "PM 실행 중");
});

const REMOTE = "https://github.example.com/team/eevee-be";
const TASK = "11111111-1111-4111-8111-111111111111";
const snap = (extra = {}) => ({ status: "running", title: "t", message: "m", decisions: [], conversation: [], diff: null, runners: [], summary: null, ...extra });

/** admin (assignee, linked) + b (requester); a second owner `c` with its own link. */
async function linked(t) {
  const ctx = await seeded(t);
  const { store, admin, repo } = ctx;
  const c = store.acceptInvite(store.createInvite(admin, "C"), "c").member;
  store.addOwner(admin, repo, c.id);
  const token = store.pair(store.createLinkCode(admin, repo), REMOTE).token;
  const other = store.pair(store.createLinkCode(c, repo), REMOTE).token;
  const { assignments } = (await ctx.api("GET", "/api/link/work", { token })).json;
  return { ...ctx, c, token, other, assignmentId: assignments[0].assignmentId };
}

test("another owner's token cannot touch an assignment it does not own", async (t) => {
  const { api, store, admin, b, req, token, other, assignmentId } = await linked(t);
  await api("POST", "/api/link/snapshot", { token, body: { assignmentId, seq: 1, snapshot: snap({ decisions: [{ id: "d1", kind: "questions", summary: "s", options: [{ number: 1, label: "a" }] }] }) } });
  store.answer(b, req, "d1", 1, "답");
  const { answers } = (await api("GET", "/api/link/work", { token })).json;
  const answerId = answers[0].answerId;
  const attempts = [
    ["bind", { assignmentId, officeTaskId: TASK }],
    ["snapshot", { assignmentId, seq: 5, snapshot: snap() }],
    ["answer-result", { answerId, ok: true, result: "x" }],
    ["ended", { assignmentId }],
  ];
  for (const [route, body] of attempts) {
    const res = await api("POST", `/api/link/${route}`, { token: other, body });
    assert.equal(res.status, 404, route);
    assert.equal(res.json.error, "NOT_FOUND", route);
  }
  assert.equal(store.requestView(req, admin.id).snapshot.message, "m"); // untouched
  assert.equal(store.requestView(req, b.id).answers[0].state, "pending");
  assert.deepEqual((await api("GET", "/api/link/work", { token: other })).json.assignments, []);
});

test("a token paired to one repo gets 404 on another repo's assignment", async (t) => {
  const { api, store, admin, token, assignmentId } = await linked(t);
  const repoY = store.addRepo(admin, "other-repo", "https://github.example.com/team/other-repo.git");
  const tokenY = store.pair(store.createLinkCode(admin, repoY), "https://github.example.com/team/other-repo").token;
  const res = await api("POST", "/api/link/bind", { token: tokenY, body: { assignmentId, officeTaskId: TASK } });
  assert.equal(res.status, 404);
  assert.deepEqual((await api("GET", "/api/link/work", { token: tokenY })).json.assignments, []);
  assert.equal((await api("GET", "/api/link/work", { token })).json.assignments.length, 1);
});

test("a revoked link, revoked member or removed owner gets 401", async (t) => {
  const { api, store, admin, repo, c, token, other } = await linked(t);
  const work = (tok) => api("GET", "/api/link/work", { token: tok });
  assert.equal((await work(token)).status, 200);
  const linkId = store.repos(admin.id).find((r) => r.id === repo).links.find((l) => l.memberId === admin.id).id;
  store.revokeLink(admin, linkId);
  assert.equal((await work(token)).status, 401);

  assert.equal((await work(other)).status, 200);
  store.removeOwner(admin, repo, c.id);
  assert.equal((await work(other)).status, 401);

  const d = store.acceptInvite(store.createInvite(admin, "D"), "d").member;
  store.addOwner(admin, repo, d.id);
  const tokenD = store.pair(store.createLinkCode(d, repo), REMOTE).token;
  assert.equal((await work(tokenD)).status, 200);
  store.revokeMember(admin, d.id);
  assert.equal((await work(tokenD)).status, 401);
});

test("a pairing code works once", async (t) => {
  const { api, store, admin, repo } = await seeded(t);
  const code = store.createLinkCode(admin, repo);
  assert.equal((await api("POST", "/api/link/pair", { body: { code, remote: REMOTE } })).status, 200);
  const again = await api("POST", "/api/link/pair", { body: { code, remote: REMOTE } });
  assert.equal(again.status, 410);
  assert.equal(again.json.error, "LINK_CODE_INVALID");
});

test("the protocol header is required on authenticated routes too", async (t) => {
  const { api, token } = await linked(t);
  const res = await api("GET", "/api/link/work", { token, protocol: "0" });
  assert.equal(res.status, 426);
  assert.equal(res.json.error, "PROTOCOL_MISMATCH");
  assert.equal((await api("GET", "/api/link/work", { token, protocol: "" })).status, 426);
});

test("answer-result settles an answer and ended acks a cancelled assignment", async (t) => {
  const { api, store, admin, b, req, token, assignmentId } = await linked(t);
  const decisions = [{ id: "d1", kind: "questions", summary: "s", options: [{ number: 1, label: "a" }] }, { id: "d2", kind: "story", summary: "s", options: [{ number: 1, label: "a" }] }];
  await api("POST", "/api/link/bind", { token, body: { assignmentId, officeTaskId: TASK } });
  await api("POST", "/api/link/snapshot", { token, body: { assignmentId, seq: 1, snapshot: snap({ decisions }) } });
  store.answer(b, req, "d1", 1, "하나");
  store.answer(b, req, "d2", 1, "둘");
  const { answers } = (await api("GET", "/api/link/work", { token })).json;
  assert.equal(answers.length, 2);
  const ok = await api("POST", "/api/link/answer-result", { token, body: { answerId: answers[0].answerId, ok: true, result: "적용" } });
  assert.deepEqual(ok.json, { ok: true });
  const no = await api("POST", "/api/link/answer-result", { token, body: { answerId: answers[1].answerId, ok: false, result: "거절" } });
  assert.equal(no.status, 200);
  const states = store.requestView(req, b.id).answers.map((a) => [a.decisionId, a.state, a.result]);
  assert.deepEqual(states.sort(), [["d1", "applied", "적용"], ["d2", "rejected", "거절"]]);
  assert.equal((await api("GET", "/api/link/work", { token })).json.answers.length, 0);
  // A settled answer is not pending any more.
  assert.equal((await api("POST", "/api/link/answer-result", { token, body: { answerId: answers[0].answerId, ok: true, result: "x" } })).status, 404);

  assert.equal((await api("POST", "/api/link/ended", { token, body: { assignmentId } })).status, 409); // still running
  store.cancel(b, req);
  assert.deepEqual((await api("GET", "/api/link/work", { token })).json.ended, [{ assignmentId, officeTaskId: TASK }]);
  assert.deepEqual((await api("POST", "/api/link/ended", { token, body: { assignmentId } })).json, { ok: true });
  assert.deepEqual((await api("GET", "/api/link/work", { token })).json.ended, []);
  assert.equal(store.requestView(req, admin.id).state, "cancelled");
});

test("malformed JSON and non-object bodies are refused with 400 INVALID", async (t) => {
  const { call, token, api } = await linked(t);
  const headers = { "content-type": "application/json", "x-pazmo-hub-protocol": "1", authorization: `Bearer ${token}` };
  for (const body of ["{not json", "[1,2]", "null", '"str"', ""]) {
    const res = await call("POST", "/api/link/bind", { body, headers });
    assert.equal(res.status, 400, body);
    assert.equal(JSON.parse(res.text).error, "INVALID", body);
  }
  const pair = await call("POST", "/api/link/pair", { body: "[]", headers: { ...headers, authorization: "" } });
  assert.equal(pair.status, 400);
  assert.equal((await api("GET", "/api/link/work", { token })).status, 200);
});

test("wrong field types are refused, not coerced", async (t) => {
  const { api, token, assignmentId } = await linked(t);
  const post = (route, body) => api("POST", `/api/link/${route}`, { token, body });
  const cases = [
    ["bind", { assignmentId: 5, officeTaskId: TASK }],
    ["bind", { assignmentId, officeTaskId: null }],
    ["snapshot", { assignmentId, seq: "1", snapshot: snap() }],
    ["snapshot", { assignmentId: ["x"], seq: 1, snapshot: snap() }],
    ["snapshot", { assignmentId }],
    ["answer-result", { answerId: "x", ok: "true", result: "r" }],
    ["answer-result", { answerId: "x", ok: true, result: 7 }],
    ["ended", { assignmentId: {} }],
  ];
  for (const [route, body] of cases) {
    const res = await post(route, body);
    assert.equal(res.status, 400, JSON.stringify([route, body]));
    assert.equal(res.json.error, "INVALID");
  }
  assert.equal((await api("POST", "/api/link/pair", { body: { code: 1, remote: "x" } })).status, 400);
  assert.equal((await api("POST", "/api/link/pair", { body: { code: "x" } })).status, 400);
});

test("each route accepts only its own method and unknown paths are 404", async (t) => {
  const { api, token } = await linked(t);
  for (const [method, path] of [["POST", "/api/link/work"], ["GET", "/api/link/pair"], ["GET", "/api/link/bind"], ["GET", "/api/link/snapshot"], ["PUT", "/api/link/ended"], ["DELETE", "/api/link/work"]])
    assert.equal((await api(method, path, { token })).status, 405, `${method} ${path}`);
  for (const method of ["GET", "POST", "PUT"]) {
    assert.equal((await api(method, "/api/link/nope", { token, body: method === "GET" ? undefined : {} })).status, 404, method);
    assert.equal((await api(method, "/api/link/toString", { token })).status, 404, method);
  }
});

/** Like `api`, but waits until the upload is over: a refused body may still be in flight when the 413 arrives. */
function refused({ hub, tls }, path, token, body) {
  return new Promise((resolve, reject) => {
    let status = 0;
    const req = request(new URL(path, hub.url), {
      method: "POST",
      ca: [tls.caPem],
      checkServerIdentity: (_host, cert) => checkServerIdentity("127.0.0.1", cert),
      headers: { "content-type": "application/json", "x-pazmo-hub-protocol": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      status = res.statusCode;
      res.resume();
    });
    // The server may close the socket while the sender is still writing; the status is what counts.
    req.on("error", (error) => (status ? undefined : reject(error)));
    req.on("close", () => (status ? resolve(status) : reject(new Error("no response"))));
    req.end(JSON.stringify(body));
  });
}

test("body limits are per route: pair 64 KiB, link calls 1 MiB", async (t) => {
  const ctx = await linked(t);
  const { api, token, assignmentId } = ctx;
  assert.equal(await refused(ctx, "/api/link/pair", null, { code: "x", remote: "y".repeat(100 * 1024) }), 413);
  // ~200 KiB is over the browser cap but fine for a link call; the diff carries the padding.
  const mid = await api("POST", "/api/link/snapshot", { token, body: { assignmentId, seq: 1, snapshot: snap({ diff: { text: "d".repeat(200 * 1024), truncated: false } }) } });
  assert.equal(mid.status, 200);
  assert.deepEqual(mid.json, { applied: true, seq: 1 });
  const over = { assignmentId, seq: 2, snapshot: snap({ diff: { text: "d".repeat(1100 * 1024), truncated: false } }) };
  assert.equal(await refused(ctx, "/api/link/snapshot", token, over), 413);
});
