import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";

const KEY = "11111111-1111-4111-8111-111111111111";
const snap = (decisions) => ({ status: decisions.length ? "waiting" : "running", title: "t", message: "m", decisions, conversation: [], diff: null, runners: [], summary: "[변경사항]\n1. 작업: x\n2. 변경 파일: y\n3. 확인: z" });
const story = { id: "d1", kind: "story", summary: "범위", options: [{ number: 1, label: "내용 확인 후 승인" }] };
function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const fe = store.addRepo(admin, "checkout-frontend", "https://g.example.com/t/fe");
  const be = store.addRepo(b, "checkout-backend", "https://g.example.com/t/be");
  const feLink = store.link(store.pair(store.createLinkCode(admin, fe), "https://g.example.com/t/fe").token);
  const beLink = store.link(store.pair(store.createLinkCode(b, be), "https://g.example.com/t/be").token);
  return { store, admin, b, fe, be, feLink, beLink, tick: (ms) => (now += ms) };
}
const send = (store, link, over = {}) =>
  store.createFromLink(link, { repoId: over.repoId, body: "API 필드 추가", risk: "normal", key: KEY, source: "checkout-frontend Office 채팅", parentAssignmentId: null, ...over });

test("a link lists repositories without their git addresses", () => {
  const { store, feLink } = setup();
  const repos = store.linkRepos(feLink);
  assert.deepEqual(repos.map((r) => r.name).sort(), ["checkout-backend", "checkout-frontend"]);
  assert.ok(repos.every((r) => !("remote" in r)));
  assert.deepEqual(repos.find((r) => r.name === "checkout-backend").owners, ["B"]);
});

test("an Office creates a request once per window key, recording where it came from", () => {
  const { store, admin, be, feLink } = setup();
  const first = send(store, feLink, { repoId: be });
  assert.equal(first.created, true);
  assert.equal(first.repoName, "checkout-backend");
  assert.deepEqual(send(store, feLink, { repoId: be }), { ...first, created: false }, "same key, same request");
  const view = store.requestView(first.requestId, admin.id);
  assert.equal(view.requester.name, "관리자");
  assert.equal(view.source, "checkout-frontend Office 채팅");
  assert.equal(view.parentId, null);
  assert.throws(() => send(store, feLink, { repoId: be, key: "not-a-uuid" }), { code: "INVALID" });
  assert.throws(() => send(store, feLink, { repoId: be, key: "22222222-2222-4222-8222-222222222222", source: "x".repeat(201) }), { code: "INVALID" });
  assert.throws(() => send(store, feLink, { repoId: be, key: "33333333-3333-4333-8333-333333333333", body: "가".repeat(5462) }), { code: "INVALID" }, "16384-byte limit counts UTF-8 bytes");
});

test("thirty sends per hour per Office link, then a clear refusal", () => {
  const { store, be, feLink, tick } = setup();
  for (let i = 0; i < 30; i++) send(store, feLink, { repoId: be, key: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` });
  assert.throws(() => send(store, feLink, { repoId: be, key: "44444444-4444-4444-8444-444444444444" }), { code: "RATE_LIMITED", status: 429 });
  tick(3600_001);
  assert.equal(send(store, feLink, { repoId: be, key: "44444444-4444-4444-8444-444444444444" }).created, true);
});

test("sending from accepted hub work links the parent; an ended parent is simply omitted", () => {
  const { store, admin, b, fe, be, feLink } = setup();
  const original = store.createRequest(b, fe, "프론트 일", "normal");
  store.accept(admin, original);
  const [a] = store.work(feLink).assignments;
  const linked = send(store, feLink, { repoId: be, parentAssignmentId: a.assignmentId });
  assert.equal(store.requestView(linked.requestId, admin.id).parentId, original);
  store.release(admin, original);
  const orphan = send(store, feLink, { repoId: be, key: "55555555-5555-4555-8555-555555555555", parentAssignmentId: a.assignmentId });
  assert.equal(store.requestView(orphan.requestId, admin.id).parentId, null);
});

test("an Office sees only requests sent from its own repository, and answers only requester gates", () => {
  const { store, admin, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.createRequest(admin, be, "브라우저에서 보낸 요청", "normal");
  assert.deepEqual(store.outgoing(feLink).map((x) => x.requestId), [requestId]);
  assert.deepEqual(store.outgoing(beLink), [], "B never sent anything");
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([story, { id: "g4", kind: "G4", summary: "최종", options: [] }]));
  const [item] = store.outgoing(feLink);
  assert.equal(item.assignee, "B");
  assert.equal(item.status, "waiting");
  assert.deepEqual(item.decisions.map((d) => d.kind), ["story"], "G4 never reaches the requester");
  assert.throws(() => store.answerOutgoing(feLink, requestId, "g4", 1, "ok"), { code: "STALE_QUESTION" });
  assert.throws(() => store.answerOutgoing(beLink, requestId, "d1", 1, "ok"), { code: "NOT_FOUND" });
  assert.deepEqual(store.answerOutgoing(feLink, requestId, "d1", 1, "승인"), { ok: true, already: false });
  assert.deepEqual(store.answerOutgoing(feLink, requestId, "d1", 1, "승인"), { ok: true, already: true }, "a web answer already pending counts as delivered");
  assert.deepEqual(store.outgoing(feLink)[0].decisions, [], "a pending answer hides the question");
});

test("an existing hub database gains the new columns without losing requests", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE hub_requests(id TEXT PRIMARY KEY,repo_id TEXT NOT NULL,body TEXT NOT NULL,risk TEXT NOT NULL,requester_id TEXT NOT NULL,parent_request_id TEXT,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
  db.exec("INSERT INTO hub_requests VALUES ('r1','p','b','normal','m',NULL,'open',1,1)");
  new HubStore(db);
  const cols = db.prepare("PRAGMA table_info(hub_requests)").all().map((c) => c.name);
  assert.ok(["source_note", "create_key", "origin_repo_id"].every((c) => cols.includes(c)));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hub_requests").get().n, 1);
});

test("a released request is open again: the ended assignment's assignee and status are not reported", () => {
  const { store, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([]));
  assert.equal(store.outgoing(feLink)[0].status, "running");
  store.release(b, requestId);
  const [item] = store.outgoing(feLink);
  assert.equal(item.state, "open");
  assert.equal(item.assignee, null);
  assert.equal(item.status, null);
  assert.equal(item.summary, null);
  assert.deepEqual(item.decisions, []);
});

test("the source note refuses NUL and control characters", () => {
  const { store, be, feLink } = setup();
  const keys = ["77777777-7777-4777-8777-777777777771", "77777777-7777-4777-8777-777777777772", "77777777-7777-4777-8777-777777777773"];
  for (const [i, source] of ["a\0b", "a\nb", "a\u007fb"].entries())
    assert.throws(() => send(store, feLink, { repoId: be, key: keys[i], source }), { code: "INVALID" });
});

test("one member linked to two repositories sees and answers only requests sent from each link's own repository", () => {
  const { store, admin, b, fe, be, feLink, beLink } = setup();
  const other = store.addRepo(admin, "checkout-admin", "https://g.example.com/t/admin");
  const otherLink = store.link(store.pair(store.createLinkCode(admin, other), "https://g.example.com/t/admin").token);
  const { requestId } = send(store, feLink, { repoId: be });
  assert.deepEqual(store.outgoing(otherLink), []);
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([story]));
  assert.equal(store.outgoing(feLink)[0].decisions.length, 1);
  assert.throws(() => store.answerOutgoing(otherLink, requestId, "d1", 1, "ok"), { code: "NOT_FOUND" });
  assert.deepEqual(store.answerOutgoing(feLink, requestId, "d1", 1, "ok"), { ok: true, already: false });
});

test("a rejected relay is reported on the still-open question until a later answer", () => {
  const { store, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([story]));
  assert.equal(store.outgoing(feLink)[0].decisions[0].rejected, null);
  store.answerOutgoing(feLink, requestId, "d1", 1, "승인");
  const [answer] = store.work(beLink).answers;
  store.answerResult(beLink, answer.answerId, false, "답변 형식이 맞지 않습니다");
  const [decision] = store.outgoing(feLink)[0].decisions;
  assert.deepEqual({ ...decision, rejected: decision.rejected }, { ...story, rejected: "답변 형식이 맞지 않습니다" });
});

test("each outgoing question summary is capped at 4000 characters while the snapshot keeps 20000", () => {
  const { store, admin, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([{ ...story, summary: "가".repeat(20000) }]));
  assert.equal(store.outgoing(feLink)[0].decisions[0].summary.length, 4000);
  assert.equal(store.requestView(requestId, admin.id).snapshot.decisions[0].summary.length, 20000);
});

test("an Office link only answers; rejecting or cancelling stays on the hub page", () => {
  const { store, admin, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([story]));
  for (const option of [2, 0, 3])
    assert.throws(() => store.answerOutgoing(feLink, requestId, "d1", option, ""), { code: "INVALID", status: 400, message: "요청 취소나 거절은 팀 허브 요청 화면에서 해주세요." });
  assert.deepEqual(store.work(beLink).answers, [], "nothing was queued for the other Office");
  store.answer(admin, requestId, "d1", 2, ""); // the hub page's own requester form still rejects
  assert.equal(store.work(beLink).answers[0].option, 2);
});
