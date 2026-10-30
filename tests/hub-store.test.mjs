import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { normalizeRemote } from "../src/hub/remote.ts";

function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  return { store, admin, join, tick: (ms) => (now += ms) };
}
const snap = (decisions = [], status = decisions.length ? "waiting" : "running") => ({
  status, title: "t", message: "m", decisions, conversation: [], diff: null, runners: [], summary: null,
});
const story = { id: "d1", kind: "story", summary: "범위", options: [{ number: 1, label: "내용 확인 후 승인" }] };
const g4 = { id: "g4", kind: "G4", summary: "최종", options: [{ number: 1, label: "승인" }] };
function accepted() {
  const ctx = setup();
  const { store, admin, join } = ctx;
  const b = join("B"), c = join("C");
  const repo = store.addRepo(admin, "app-be", "git@github.example.com:team/app-be.git");
  store.addOwner(admin, repo, c.id);
  const req = store.createRequest(b, repo, "README 목차", "normal");
  store.accept(c, req);
  const token = store.pair(store.createLinkCode(c, repo), "https://github.example.com/team/app-be").token;
  const link = store.link(token);
  const [a] = store.work(link).assignments;
  return { ...ctx, b, c, repo, req, token, link, a };
}

test("remotes normalize across scheme, credentials, case and .git", () => {
  assert.equal(normalizeRemote("https://u:p@GitHub.example.com/Team/Repo.git"), "github.example.com/team/repo");
  assert.equal(normalizeRemote("git@github.example.com:team/repo.git"), "github.example.com/team/repo");
  assert.equal(normalizeRemote("ssh://git@github.example.com/team/repo"), "github.example.com/team/repo");
  assert.throws(() => normalizeRemote("/local/path"), /INVALID_REMOTE/);
  assert.throws(() => normalizeRemote("https://h/../x"), /INVALID_REMOTE/);
});

test("an invite works once and expires after 72 hours; the admin link is only for an empty hub", () => {
  const { store, admin, tick } = setup();
  const raw = store.createInvite(admin, "B");
  assert.deepEqual(store.invite(raw), { name: "B" });
  store.acceptInvite(raw, "x");
  assert.equal(store.invite(raw), null);
  assert.throws(() => store.acceptInvite(raw, "x"), { code: "INVITE_INVALID" });
  const late = store.createInvite(admin, "C");
  tick(72 * 3600_000 + 1);
  assert.throws(() => store.acceptInvite(late, "x"), { code: "INVITE_INVALID" });
  assert.equal(store.bootstrapAdmin(), null);
});

test("only an admin invites, and revoking a member or a device ends the session at once", () => {
  const { store, admin } = setup();
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b");
  assert.throws(() => store.createInvite(b.member, "D"), { code: "FORBIDDEN" });
  assert.equal(store.session(b.session).member.id, b.member.id);
  store.revokeMember(admin, b.member.id);
  assert.equal(store.session(b.session), null);
  const c = store.acceptInvite(store.createInvite(admin, "C"), "c");
  store.revokeDevice(admin, store.session(c.session).deviceId);
  assert.equal(store.session(c.session), null);
  const again = store.acceptInvite(store.createDeviceInvite(admin, c.member.id), "c2");
  assert.equal(again.member.id, c.member.id, "a device invite adds a browser to the same member");
});

test("sessions slide with use and expire after 30 idle days", () => {
  const { store, admin, tick } = setup();
  const { session } = store.acceptInvite(store.createInvite(admin, "B"), "b");
  tick(29 * 86400_000);
  assert.ok(store.session(session));
  tick(29 * 86400_000);
  assert.ok(store.session(session), "use extended the session");
  tick(30 * 86400_000 + 1);
  assert.equal(store.session(session), null);
});

test("only owners accept, the second accept loses, and only the requester answers story and questions", () => {
  const { store, admin, b, c, req, link, a } = accepted();
  assert.throws(() => store.accept(admin, req), { code: "ALREADY_ACCEPTED" });
  const other = store.createRequest(b, store.repos(b.id)[0].id, "다른 일", "high");
  assert.throws(() => store.accept(b, other), { code: "FORBIDDEN" });
  store.snapshot(link, a.assignmentId, 1, snap([story, g4]));
  assert.throws(() => store.answer(c, req, "d1", 1, "ok"), { code: "FORBIDDEN" });
  assert.throws(() => store.answer(b, req, "g4", 1, "ok"), { code: "STALE_QUESTION" });
  assert.throws(() => store.answer(b, req, "d1", 1, " "), { code: "INVALID" });
  store.answer(b, req, "d1", 1, "승인합니다");
  assert.throws(() => store.answer(b, req, "d1", 1, "again"), { code: "CONFLICT" });
  const [x] = store.work(link).answers;
  assert.deepEqual([x.note, x.option, x.member.name], ["승인합니다", 1, "B"]);
  store.answerResult(link, x.answerId, false, "STALE_APPROVAL: 질문이 바뀌었습니다.");
  assert.equal(store.requestView(req, b.id).answers[0].state, "rejected");
});

test("a link sees only its member's accepted work on its own repository", () => {
  const { store, b, c, repo, req, link } = accepted();
  const repo2 = store.addRepo(c, "web", "https://github.example.com/team/web");
  assert.throws(() => store.pair(store.createLinkCode(c, repo2), "https://github.example.com/team/app-be"), { code: "REMOTE_MISMATCH" });
  const code = store.createLinkCode(c, repo2);
  store.pair(code, "https://github.example.com/team/web.git");
  assert.throws(() => store.pair(code, "https://github.example.com/team/web.git"), { code: "LINK_CODE_INVALID" });
  assert.throws(() => store.createLinkCode(b, repo), { code: "FORBIDDEN" });
  const theirs = store.createRequest(b, repo2, "웹 일", "normal");
  store.accept(c, theirs);
  assert.deepEqual(store.work(link).assignments.map((x) => x.requestId), [req]);
  const other = store.work(store.link(store.pair(store.createLinkCode(c, repo2), "https://github.example.com/team/web").token)).assignments[0];
  assert.throws(() => store.snapshot(link, other.assignmentId, 1, snap()), { code: "NOT_FOUND" });
  assert.equal(store.link("x".repeat(43)), null);
});

test("removing an owner revokes that owner's link to the repository", () => {
  const { store, admin, b, c, repo, token } = accepted();
  assert.ok(store.link(token));
  store.addOwner(admin, repo, b.id);
  store.removeOwner(admin, repo, c.id);
  assert.equal(store.link(token), null, "C no longer owns the repository");
  store.removeOwner(admin, repo, admin.id); // addRepo made the creator an owner too
  assert.throws(() => store.removeOwner(admin, repo, b.id), { code: "LAST_OWNER" });
  assert.ok(store.link(store.pair(store.createLinkCode(b, repo), "git@github.example.com:team/app-be").token));
});

test("snapshots apply once and in order, and a final status finishes the request", () => {
  const { store, b, req, link, a } = accepted();
  assert.deepEqual(store.snapshot(link, a.assignmentId, 5, snap()), { applied: true, seq: 5 });
  assert.deepEqual(store.snapshot(link, a.assignmentId, 5, snap()), { applied: false, seq: 5 });
  assert.deepEqual(store.snapshot(link, a.assignmentId, 4, snap()), { applied: false, seq: 5 });
  assert.throws(() => store.snapshot(link, a.assignmentId, 6, { status: "weird" }), { code: "INVALID" });
  store.snapshot(link, a.assignmentId, 6, snap([], "done"));
  assert.equal(store.requestView(req, b.id).state, "done");
  assert.deepEqual(store.work(link), { assignments: [], answers: [], ended: [] });
});

test("returning or cancelling a bound assignment tells that Office to stop it", () => {
  const { store, b, c, req, link, a } = accepted();
  store.bind(link, a.assignmentId, "11111111-1111-4111-8111-111111111111");
  store.release(c, req);
  assert.equal(store.requestView(req, b.id).state, "open");
  assert.deepEqual(store.work(link).ended, [{ assignmentId: a.assignmentId, officeTaskId: "11111111-1111-4111-8111-111111111111" }]);
  store.ended(link, a.assignmentId);
  assert.deepEqual(store.work(link).ended, []);
  store.accept(c, req);
  const [next] = store.work(link).assignments;
  assert.notEqual(next.assignmentId, a.assignmentId);
  assert.throws(() => store.cancel(store.acceptInvite(store.createInvite(store.members()[0], "D"), "d").member, req), { code: "FORBIDDEN" });
  store.cancel(b, req);
  assert.equal(store.requestView(req, b.id).state, "cancelled");
  assert.deepEqual(store.work(link).ended, [], "never bound, nothing to stop");
});

test("a bind that arrives after the assignment ended still gets that Office told to stop", () => {
  const { store, c, req, link, a } = accepted();
  const task = "22222222-2222-4222-8222-222222222222";
  store.release(c, req);
  assert.deepEqual(store.work(link).ended, [], "unbound at release, nothing to stop yet");
  store.bind(link, a.assignmentId, task);
  assert.deepEqual(store.work(link).ended, [{ assignmentId: a.assignmentId, officeTaskId: task }]);
  store.ended(link, a.assignmentId);
  assert.deepEqual(store.work(link).ended, []);
  assert.throws(() => store.bind(link, a.assignmentId, "-".repeat(36)), { code: "INVALID" });
});

test("answers longer than 16000 characters are refused for either option", () => {
  const { store, b, req, link, a } = accepted();
  store.snapshot(link, a.assignmentId, 1, snap([story]));
  assert.throws(() => store.answer(b, req, "d1", 2, "x".repeat(16001)), { code: "INVALID" });
  assert.throws(() => store.answer(b, req, "d1", 1, "x".repeat(16001)), { code: "INVALID" });
});

test("a request the Office could not plan (over 16384 UTF-8 bytes, or NUL) is refused on the hub", () => {
  const { store, admin, join } = setup();
  const b = join("B");
  const repo = store.addRepo(admin, "app-be", "git@github.example.com:team/app-be.git");
  const korean = "가".repeat(6000); // 6000 characters, 18000 bytes
  assert.throws(() => store.createRequest(b, repo, korean, "normal"), (e) => e.code === "INVALID" && /16384바이트/.test(e.message));
  assert.throws(() => store.createRequest(b, repo, "앞\0뒤", "normal"), { code: "INVALID" });
  assert.ok(store.createRequest(b, repo, "가".repeat(5461), "normal"), "16383 bytes still fits");
});

test("answers the Office would refuse (NUL) are refused on the hub before relay", () => {
  const { store, b, req, link, a } = accepted();
  store.snapshot(link, a.assignmentId, 1, snap([story]));
  assert.throws(() => store.answer(b, req, "d1", 1, "승인\0합니다"), { code: "INVALID" });
  assert.throws(() => store.answer(b, req, "d1", 2, "\0"), { code: "INVALID" });
  store.answer(b, req, "d1", 1, "가".repeat(16000));
});

test("the final snapshot keeps the change view and the summary the requester came to see", () => {
  const { store, b, req, link, a } = accepted();
  const diff = { text: "diff --git a/README.md b/README.md\n+목차", truncated: false };
  const summary = "[변경사항]\n1. a\n2. b\n3. c";
  store.snapshot(link, a.assignmentId, 1, { ...snap(), diff, summary });
  store.snapshot(link, a.assignmentId, 2, snap());
  assert.equal(store.requestView(req, b.id).snapshot.summary, summary, "a missing summary keeps the previous one");
  assert.equal(store.requestView(req, b.id).snapshot.diff, null, "a running snapshot may clear the diff");
  store.snapshot(link, a.assignmentId, 3, { ...snap(), diff, summary });
  store.snapshot(link, a.assignmentId, 4, snap([], "done"));
  const view = store.requestView(req, b.id);
  assert.equal(view.state, "done");
  assert.deepEqual(view.snapshot.diff, diff, "delivery's empty diff keeps the last change view");
  assert.equal(view.snapshot.summary, summary);
});
