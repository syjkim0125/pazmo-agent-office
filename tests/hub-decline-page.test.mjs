import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";

/** The admin owns the repo; "요청자" is a plain member who asks for work in it. */
async function setup(t) {
  const hub = await startTestHub(t);
  const { store, enter } = hub;
  const owner = await enter(store.bootstrapAdmin());
  const ownerMember = store.session(owner.cookie.split("=")[1]).member;
  const repo = store.addRepo(ownerMember, "checkout-backend", "https://g.example.com/t/be");
  const asker = await enter(store.createInvite(ownerMember, "요청자"));
  const askerMember = store.session(asker.cookie.split("=")[1]).member;
  const post = (who, path, fields) =>
    hub.call("POST", path, {
      cookie: who.cookie,
      body: new URLSearchParams({ csrf: who.csrf, ...fields }).toString(),
      headers: { origin: hub.hub.url },
    });
  const open = (body = "필드 추가") => store.createRequest(askerMember, repo, body, "normal");
  return { ...hub, owner, asker, ownerMember, askerMember, repo, post, open };
}

test("the owner declines on the detail page with a reason; it shows as 거절됨 with who and why", async (t) => {
  const { call, owner, post, open, ownerMember } = await setup(t);
  const id = open();
  const before = await call("GET", `/requests/${id}`, { cookie: owner.cookie });
  assert.match(before.text, new RegExp(`action="/requests/${id}/decline"`));
  assert.match(before.text, /<textarea name="reason"[^>]*maxlength="500"/);
  assert.match(before.text, />거절<\/button>/);
  assert.match(before.text, /내가 맡기/);
  const res = await post(owner, `/requests/${id}/decline`, { reason: "중복" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/requests/${id}`);
  const after = (await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text;
  assert.match(after, /거절됨/);
  assert.match(after, /거절 사유: 중복/);
  assert.match(after, new RegExp(`거절한 사람: ${ownerMember.name}`));
  assert.doesNotMatch(after, /내가 맡기/);
  assert.doesNotMatch(after, /\/decline"/, "a closed request has no decline form");
  const board = (await call("GET", "/", { cookie: owner.cookie })).text;
  assert.match(board, /<span class="pill">거절됨<\/span>/);
});

test("a decline without a reason is fine and shows no reason line", async (t) => {
  const { call, owner, post, open } = await setup(t);
  const id = open();
  assert.equal((await post(owner, `/requests/${id}/decline`, { reason: "  " })).status, 303);
  const after = (await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text;
  assert.match(after, /거절됨/);
  assert.doesNotMatch(after, /거절 사유/);
});

test("a requester who cancels is shown as 취소됨, not 거절됨", async (t) => {
  const { call, asker, post, open } = await setup(t);
  const id = open();
  assert.equal((await post(asker, `/requests/${id}/cancel`, {})).status, 303);
  const after = (await call("GET", `/requests/${id}`, { cookie: asker.cookie })).text;
  assert.match(after, /취소됨/);
  assert.doesNotMatch(after, /거절됨/);
});

test("only an owner sees the decline form; a non-owner POST is 403; CSRF is required", async (t) => {
  const { call, hub, owner, asker, post, open, store } = await setup(t);
  const id = open();
  const view = await call("GET", `/requests/${id}`, { cookie: asker.cookie });
  assert.doesNotMatch(view.text, /\/decline"/);
  const denied = await post(asker, `/requests/${id}/decline`, { reason: "x" });
  assert.equal(denied.status, 403);
  const noCsrf = await call("POST", `/requests/${id}/decline`, {
    cookie: owner.cookie, body: "reason=x", headers: { origin: hub.url },
  });
  assert.equal(noCsrf.status, 403);
  const wrong = await call("POST", `/requests/${id}/decline`, {
    cookie: owner.cookie, body: "csrf=wrong&reason=x", headers: { origin: hub.url },
  });
  assert.equal(wrong.status, 403);
  assert.match((await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text, /맡을 사람 대기/);
});

test("a reason with markup is escaped on the page", async (t) => {
  const { call, owner, post, open } = await setup(t);
  const id = open();
  await post(owner, `/requests/${id}/decline`, { reason: "<b>x</b>" });
  const after = (await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text;
  assert.ok(after.includes("&#60;b&#62;x&#60;/b&#62;"));
  assert.ok(!after.includes("<b>x</b>"));
});

test("a long reason or an already-closed request is refused", async (t) => {
  const { owner, post, open, call } = await setup(t);
  const id = open();
  assert.equal((await post(owner, `/requests/${id}/decline`, { reason: "가".repeat(501) })).status, 400);
  assert.equal((await post(owner, `/requests/${id}/decline`, { reason: "ok" })).status, 303);
  assert.equal((await post(owner, `/requests/${id}/decline`, { reason: "again" })).status, 409);
  assert.match((await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text, /거절 사유: ok/);
});

test("the copy script still selects the value and relabels the button when the clipboard fails", async (t) => {
  const { call } = await setup(t);
  const script = (await call("GET", "/copy.js")).text;
  // clipboard missing or rejected -> failed(): select the target text, then change the label
  assert.match(script, /function failed\(\) \{\s*select\(target\);\s*button\.textContent = MANUAL;\s*\}/);
  assert.match(script, /if \(!navigator\.clipboard \|\| !navigator\.clipboard\.writeText\) return failed\(\);/);
  assert.match(script, /navigator\.clipboard\.writeText\(text\)\.then\(function \(\) \{[\s\S]*?\}, failed\);/);
  assert.match(script, /range\.selectNodeContents\(target\)/);
  assert.match(script, /MANUAL = "선택됨 — Cmd\+C로 복사"/);
});

test("store.decline checks existence (404) before the reason length (400), then owner (403)", async (t) => {
  const { store, ownerMember, askerMember, open } = await setup(t);
  const missing = "00000000-0000-4000-8000-000000000000";
  assert.throws(() => store.decline(ownerMember, missing, "가".repeat(501)), { code: "NOT_FOUND", status: 404 });
  const id = open();
  assert.throws(() => store.decline(ownerMember, id, "가".repeat(501)), { code: "INVALID", status: 400 });
  assert.throws(() => store.decline(askerMember, id, "x"), { code: "FORBIDDEN", status: 403 });
  assert.equal(store.requestView(id, ownerMember.id).state, "open");
});

test("once an owner has accepted, the detail page has no decline form but the assignee can still return it", async (t) => {
  const { call, store, owner, ownerMember, open } = await setup(t);
  const id = open();
  store.accept(ownerMember, id);
  const page = (await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text;
  assert.doesNotMatch(page, /\/decline"/);
  assert.doesNotMatch(page, />거절<\/button>/);
  assert.doesNotMatch(page, /거절됨/);
  assert.match(page, /반납하기/);
});

test("a request cancelled by the assignee's snapshot is 취소됨, not 거절됨, on the list and the detail page", async (t) => {
  const { call, store, owner, ownerMember, repo, open } = await setup(t);
  const id = open();
  store.accept(ownerMember, id);
  const link = store.link(store.pair(store.createLinkCode(ownerMember, repo), "https://g.example.com/t/be").token);
  const [a] = store.work(link).assignments;
  const result = store.snapshot(link, a.assignmentId, 1, {
    status: "cancelled", title: "t", message: "m", decisions: [], conversation: [], diff: null, runners: [], summary: null,
  });
  assert.equal(result.applied, true);
  assert.equal(store.requestView(id, ownerMember.id).state, "cancelled");
  const detail = (await call("GET", `/requests/${id}`, { cookie: owner.cookie })).text;
  assert.match(detail, /<span class="pill">취소됨<\/span>/);
  assert.doesNotMatch(detail, /거절됨/);
  assert.doesNotMatch(detail, /거절 사유|거절한 사람/);
  const board = (await call("GET", "/", { cookie: owner.cookie })).text;
  assert.match(board, /취소됨/);
  assert.doesNotMatch(board, /거절됨/);
});
