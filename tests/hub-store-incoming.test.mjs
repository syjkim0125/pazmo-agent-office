import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";

const KEY = "11111111-1111-4111-8111-111111111111";
/** admin owns fe; B owns be; C is a second owner of be, each with a link. */
function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const c = store.acceptInvite(store.createInvite(admin, "C"), "c").member;
  const fe = store.addRepo(admin, "checkout-frontend", "https://g.example.com/t/fe");
  const be = store.addRepo(b, "checkout-backend", "https://g.example.com/t/be");
  store.addOwner(b, be, c.id);
  const feLink = store.link(store.pair(store.createLinkCode(admin, fe), "https://g.example.com/t/fe").token);
  const beLink = store.link(store.pair(store.createLinkCode(b, be), "https://g.example.com/t/be").token);
  const beLinkC = store.link(store.pair(store.createLinkCode(c, be), "https://g.example.com/t/be").token);
  return { store, admin, b, c, fe, be, feLink, beLink, beLinkC, tick: (ms) => (now += ms) };
}
const send = (store, link, repoId, over = {}) =>
  store.createFromLink(link, { repoId, body: "API 필드 추가", risk: "normal", key: KEY, source: "checkout-frontend Office 채팅", parentAssignmentId: null, ...over }).requestId;

test("incoming lists only open requests of the link's repo, oldest first", () => {
  const { store, admin, b, fe, be, feLink, beLink, tick } = setup();
  const first = send(store, feLink, be);
  tick(10);
  const second = store.createRequest(admin, be, "브라우저에서 보낸 요청", "high");
  tick(10);
  store.createRequest(b, fe, "다른 레포 요청", "normal");
  const accepted = store.createRequest(admin, be, "수락된 요청", "normal");
  store.accept(b, accepted);
  const cancelled = store.createRequest(admin, be, "취소된 요청", "normal");
  store.cancel(admin, cancelled);
  const items = store.incoming(beLink);
  assert.deepEqual(items.map((i) => i.requestId), [first, second]);
  assert.deepEqual(items[0], {
    requestId: first, requester: "관리자", originRepoName: "checkout-frontend",
    source: "checkout-frontend Office 채팅", body: "API 필드 추가", risk: "normal", createdAt: 1_000_000,
  });
  assert.deepEqual(items[1], {
    requestId: second, requester: "관리자", originRepoName: null, source: null,
    body: "브라우저에서 보낸 요청", risk: "high", createdAt: 1_000_010,
  });
  assert.deepEqual(store.incoming(feLink).map((i) => i.body), ["다른 레포 요청"]);
});

test("two owners: accepting via the link wins once", () => {
  const { store, admin, be, feLink, beLink, beLinkC } = setup();
  const id = send(store, feLink, be);
  assert.deepEqual(store.acceptIncoming(beLink, id), { ok: true, requestId: id });
  assert.equal(store.requestView(id, admin.id).state, "accepted");
  assert.throws(() => store.acceptIncoming(beLinkC, id), { code: "ALREADY_ACCEPTED", status: 409 });
  assert.throws(() => store.declineIncoming(beLinkC, id, "늦음"), { code: "STATE", status: 409, message: "이미 처리된 요청입니다." });
  assert.deepEqual(store.incoming(beLinkC), []);
});

test("declining closes the request for every owner and the requester sees why", () => {
  const { store, b, c, be, feLink, beLink, beLinkC } = setup();
  const id = send(store, feLink, be);
  assert.deepEqual(store.declineIncoming(beLink, id, "  범위가 다릅니다 "), { ok: true, requestId: id });
  assert.deepEqual(store.incoming(beLink), []);
  assert.deepEqual(store.incoming(beLinkC), []);
  assert.throws(() => store.accept(c, id), { code: "ALREADY_ACCEPTED", status: 409 });
  assert.throws(() => store.acceptIncoming(beLinkC, id), { code: "STATE", status: 409, message: "이미 처리된 요청입니다." }, "a declined request is handled, not taken by someone");
  const [item] = store.outgoing(feLink);
  assert.equal(item.requestId, id);
  assert.equal(item.state, "cancelled");
  assert.equal(item.declined, true);
  assert.equal(item.declineNote, "범위가 다릅니다");
  assert.equal(item.declinedBy, b.name);
});

test("a whitespace-only reason is stored as no reason; 501 characters is refused and nothing changes", () => {
  const { store, be, feLink, beLink } = setup();
  const id = send(store, feLink, be);
  assert.throws(() => store.declineIncoming(beLink, id, "가".repeat(501)), { code: "INVALID", status: 400, message: "거절 사유는 500자까지입니다." });
  assert.equal(store.incoming(beLink).length, 1);
  assert.equal(store.outgoing(feLink)[0].state, "open");
  assert.equal(store.outgoing(feLink)[0].declined, false);
  store.declineIncoming(beLink, id, "   ");
  const [item] = store.outgoing(feLink);
  assert.equal(item.declined, true);
  assert.equal(item.declineNote, null);
  const id2 = send(store, feLink, be, { key: "22222222-2222-4222-8222-222222222222" });
  store.declineIncoming(beLink, id2, "가".repeat(500));
  assert.equal(store.outgoing(feLink).find((x) => x.requestId === id2).declineNote.length, 500);
  const id3 = send(store, feLink, be, { key: "33333333-3333-4333-8333-333333333333" });
  store.declineIncoming(beLink, id3);
  assert.equal(store.outgoing(feLink).find((x) => x.requestId === id3).declineNote, null);
});

test("a request of another repo is 404 for accept and decline", () => {
  const { store, admin, fe, beLink } = setup();
  const other = store.createRequest(admin, fe, "프론트 일", "normal");
  assert.throws(() => store.acceptIncoming(beLink, other), { code: "NOT_FOUND", status: 404 });
  assert.throws(() => store.declineIncoming(beLink, other, "x"), { code: "NOT_FOUND", status: 404 });
  assert.throws(() => store.acceptIncoming(beLink, "00000000-0000-4000-8000-000000000000"), { code: "NOT_FOUND", status: 404 });
  assert.equal(store.requestView(other, admin.id).state, "open");
});

test("requester cancel is not shown as declined", () => {
  const { store, admin, be, feLink } = setup();
  const id = send(store, feLink, be);
  store.cancel(admin, id);
  const [item] = store.outgoing(feLink);
  assert.equal(item.state, "cancelled");
  assert.equal(item.declined, false);
  assert.equal(item.declineNote, null);
  assert.equal(item.declinedBy, null);
});

test("accepting a request that was cancelled is STATE, not ALREADY_ACCEPTED", () => {
  const { store, admin, be, feLink, beLink } = setup();
  const id = send(store, feLink, be);
  store.cancel(admin, id);
  assert.throws(() => store.acceptIncoming(beLink, id), { code: "STATE", status: 409, message: "이미 처리된 요청입니다." });
});

test("accepting a request an owner already took stays ALREADY_ACCEPTED", () => {
  const { store, be, feLink, beLink, beLinkC } = setup();
  const id = send(store, feLink, be);
  store.acceptIncoming(beLink, id);
  assert.throws(() => store.acceptIncoming(beLinkC, id), { code: "ALREADY_ACCEPTED", status: 409 });
});

test("the same owner accepting twice is ok both times; another owner is still ALREADY_ACCEPTED", () => {
  const { store, be, feLink, beLink, beLinkC } = setup();
  const id = send(store, feLink, be);
  assert.deepEqual(store.acceptIncoming(beLink, id), { ok: true, requestId: id });
  assert.deepEqual(store.acceptIncoming(beLink, id), { ok: true, requestId: id }, "a double click is not an error");
  assert.throws(() => store.acceptIncoming(beLinkC, id), { code: "ALREADY_ACCEPTED", status: 409 });
});
