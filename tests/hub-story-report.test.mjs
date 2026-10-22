import test from "node:test";
import assert from "node:assert/strict";
import { opened } from "./hub-story-fixture.mjs";
const SHA = "a".repeat(40), SHA2 = "b".repeat(40);
const merged = (over = {}) => ({ prUrl: "https://github.example.com/team/eevee-be/pull/7", mergeCommit: SHA, summary: "[변경사항]\n1. 작업: api\n2. 변경 파일: src/api.ts\n3. 확인: V1 통과", assumptions: ["ASSUMED: 쿠폰 코드는 대문자"], ...over });
const states = (board, l, id) => Object.fromEntries(board.story(l, id).tasks.map((t) => [t.nodeId, t.state]));
/** Claims the link's next task and merges it under its own commit. */
const finish = (board, l) => {
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  board.reportMerged(l, t.taskId, t.claimId, merged({ mergeCommit: String(t.number).padStart(40, "0") }));
};

test("merge needs the lock; merging api readies ui and records the report", () => {
  const { board, c, be, linkOf, plBe, pub } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged()), (e) => e.code === "LOCK_REQUIRED");
  // A work Task's worker is not the PL, so the Story verification report is not theirs to make.
  assert.throws(() => board.reportVerify(l, t.taskId, t.claimId, { passed: true, summary: "x" }), (e) => e.code === "FORBIDDEN");
  assert.deepEqual(board.mergeLock(l, t.taskId, t.claimId), { granted: true, holder: null });
  const r = board.reportMerged(l, t.taskId, t.claimId, merged());
  assert.deepEqual(r.ready, [3]);
  const v = board.story(plBe, pub.storyId).tasks.find((x) => x.nodeId === "api");
  assert.equal(v.mergeCommit, SHA);
  assert.deepEqual(v.assumptions, ["ASSUMED: 쿠폰 코드는 대문자"]);
  assert.equal(states(board, plBe, pub.storyId).ui, "ready");
});
test("same story and repo merge one at a time", () => {
  const ctx = opened();
  const { store, admin, board, b, c, be, linkOf } = ctx;
  store.addOwner(admin, be, b.id);
  const t1 = board.claimNext(linkOf(c, be)), t2 = board.claimNext(linkOf(b, be));
  assert.equal(board.mergeLock(linkOf(c, be), t1.taskId, t1.claimId).granted, true);
  assert.deepEqual(board.mergeLock(linkOf(b, be), t2.taskId, t2.claimId), { granted: false, holder: t1.number });
  board.reportFailed(linkOf(c, be), t1.taskId, t1.claimId, "재검증 실패");
  assert.equal(board.mergeLock(linkOf(b, be), t2.taskId, t2.claimId).granted, true);
  // The same claim sending its failed report again is answered ok and changes nothing.
  assert.deepEqual(board.reportFailed(linkOf(c, be), t1.taskId, t1.claimId, "재검증 실패"), { ok: true });
});
test("the lock holder drops its own lock to retry; a refused merged report keeps the lock", () => {
  const ctx = opened();
  const { store, admin, board, b, c, be, linkOf } = ctx;
  store.addOwner(admin, be, b.id);
  const lc = linkOf(c, be), lb = linkOf(b, be);
  const t1 = board.claimNext(lc), t2 = board.claimNext(lb);
  assert.equal(board.mergeLock(lc, t1.taskId, t1.claimId).granted, true);
  assert.throws(() => board.reportMerged(lc, t1.taskId, t1.claimId, merged({ prUrl: "http://x" })), (e) => e.code === "INVALID");
  assert.deepEqual(board.mergeLock(lb, t2.taskId, t2.claimId), { granted: false, holder: t1.number });
  assert.throws(() => board.mergeUnlock(lc, t1.taskId, "another-claim"), (e) => e.code === "NOT_YOURS");
  assert.deepEqual(board.mergeUnlock(lc, t1.taskId, t1.claimId), { ok: true });
  assert.deepEqual(board.mergeLock(lb, t2.taskId, t2.claimId), { granted: true, holder: null });
  // Not holding it any more is fine, and does not touch the other task's lock.
  assert.deepEqual(board.mergeUnlock(lc, t1.taskId, t1.claimId), { ok: true });
  assert.deepEqual(board.mergeLock(lc, t1.taskId, t1.claimId), { granted: false, holder: t2.number });
});
test("story verify reports are safe to resend; another verdict under the same claim is STATE", () => {
  const { board, b, c, be, fe, linkOf, plBe, pub } = opened();
  finish(board, linkOf(c, be));
  finish(board, linkOf(c, be));
  finish(board, linkOf(b, fe));
  let v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" });
  assert.deepEqual(board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" }), { ok: true });
  assert.throws(() => board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "x" }), (e) => e.code === "STATE" && e.status === 409);
  assert.equal(board.inbox(plBe).mine, null); // the failed verify still frees the PL's one open slot
  board.releaseTask(plBe, v.taskId);
  v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "전부 통과" });
  assert.deepEqual(board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "전부 통과" }), { ok: true });
  assert.throws(() => board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "x" }), (e) => e.code === "STATE");
  assert.equal(board.story(plBe, pub.storyId).state, "awaiting_g4");
});
test("the last lock holder's late merged report counts after the PL released the task", () => {
  const { board, c, be, linkOf, plBe, pub, tick } = opened();
  const l = linkOf(c, be);
  const api = () => board.story(plBe, pub.storyId).tasks.find((x) => x.nodeId === "api");
  const t = board.claimNext(l);
  assert.equal(api().mergeLock, false);
  board.mergeLock(l, t.taskId, t.claimId);
  board.heartbeat(l, t.taskId, t.claimId, "merge");
  assert.equal(api().mergeLock, true); // the PL sees the lock before releasing
  tick(600_001);
  board.releaseTask(plBe, t.taskId);
  assert.equal(api().mergeLock, false);
  assert.deepEqual(board.reportMerged(l, t.taskId, t.claimId, merged()), { ok: true, already: false, ready: [3] });
  assert.equal(api().state, "merged");
  assert.equal(api().assignee.id, c.id);
  assert.equal(states(board, plBe, pub.storyId).ui, "ready");
  assert.deepEqual(board.reportMerged(l, t.taskId, t.claimId, merged()), { ok: true, already: true, ready: [] });
});
test("a late merged report ends the newer claim; a stale claim that never locked stays NOT_YOURS", () => {
  const ctx = opened();
  const { store, admin, board, b, c, be, linkOf, plBe, pub, tick } = ctx;
  store.addOwner(admin, be, b.id);
  const lc = linkOf(c, be), lb = linkOf(b, be);
  const t = board.claimNext(lc);
  board.mergeLock(lc, t.taskId, t.claimId);
  tick(600_001);
  board.releaseTask(plBe, t.taskId);
  const again = board.claimNext(lb);
  assert.equal(again.taskId, t.taskId);
  board.reportMerged(lc, t.taskId, t.claimId, merged());
  assert.throws(() => board.heartbeat(lb, again.taskId, again.claimId, "build"), (e) => e.code === "NOT_YOURS" && e.status === 409);
  assert.equal(board.story(plBe, pub.storyId).tasks.find((x) => x.nodeId === "api").state, "merged");
  // b's slot is free again: it takes the next be task. Its old claim on that task never locked.
  const copy = board.claimNext(lb);
  assert.equal(copy.number, 4);
  tick(600_001);
  board.releaseTask(plBe, copy.taskId);
  assert.throws(() => board.reportMerged(lb, copy.taskId, copy.claimId, merged({ mergeCommit: SHA2 })), (e) => e.code === "NOT_YOURS");
});
test("merged resend is idempotent; a different commit is refused", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  board.reportMerged(l, t.taskId, t.claimId, merged());
  assert.deepEqual(board.reportMerged(l, t.taskId, t.claimId, merged()), { ok: true, already: true, ready: [] });
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ mergeCommit: SHA2 })), (e) => e.code === "STATE");
  // The claimant's own merged task is finished, not someone else's.
  assert.throws(() => board.heartbeat(l, t.taskId, t.claimId, "merge"), (e) => e.code === "STATE" && e.status === 409);
});
test("report fields are validated", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ prUrl: "http://x" })), (e) => e.code === "INVALID");
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ mergeCommit: "zz" })), (e) => e.code === "INVALID");
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ assumptions: Array(51).fill("x") })), (e) => e.code === "INVALID");
});
test("story verify: ready after all work merges, PL only, fail reopens, pass awaits G4, complete finishes", () => {
  const { board, pl, b, c, be, fe, linkOf, plBe, pub } = opened();
  finish(board, linkOf(c, be)); // api
  finish(board, linkOf(c, be)); // copy
  finish(board, linkOf(b, fe)); // ui
  assert.deepEqual(board.inbox(plBe).verifyReady, [pub.storyId]);
  assert.throws(() => board.claimVerify(linkOf(b, fe), pub.storyId), (e) => e.code === "FORBIDDEN");
  let v = board.claimVerify(plBe, pub.storyId);
  assert.equal(v.kind, "verify");
  // The verification Task has no repo: any of the PL's links fetches it again.
  assert.deepEqual(board.taskForClaim(linkOf(pl, fe), v.taskId, v.claimId), v);
  assert.equal(board.story(plBe, pub.storyId).state, "verifying");
  // The Story check has no repo to lock or merge, and its verdict must be a boolean.
  assert.throws(() => board.mergeLock(plBe, v.taskId, v.claimId), (e) => e.code === "STATE");
  assert.throws(() => board.reportVerify(plBe, v.taskId, v.claimId, { passed: "yes", summary: "x" }), (e) => e.code === "INVALID");
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" });
  assert.equal(board.story(plBe, pub.storyId).state, "open");
  assert.equal(board.inbox(plBe).mine, null);
  board.releaseTask(plBe, v.taskId); // failed → ready
  v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "전부 통과" });
  assert.equal(board.story(plBe, pub.storyId).state, "awaiting_g4");
  board.completeStory(plBe, pub.storyId);
  assert.equal(board.story(plBe, pub.storyId).state, "done");
});
test("cancelling a dependency readies its dependents", () => {
  const { board, plBe, pub } = opened();
  const r = board.cancelTask(plBe, pub.tasks.find((t) => t.nodeId === "api").taskId);
  assert.deepEqual(r.ready, [3]);
});
test("a merged task's summary and assumptions reach the next claimant as upstream", () => {
  const { board, b, c, be, fe, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  board.reportMerged(l, t.taskId, t.claimId, merged());
  const ui = board.claimNext(linkOf(b, fe));
  assert.equal(ui.number, 3);
  assert.deepEqual(ui.upstream, [{ number: 2, title: "api", summary: merged().summary, assumptions: ["ASSUMED: 쿠폰 코드는 대문자"] }]);
});
