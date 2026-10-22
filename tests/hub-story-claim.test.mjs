import test from "node:test";
import assert from "node:assert/strict";
import { setup, opened } from "./hub-story-fixture.mjs";
const st = (board, l, storyId, nodeId) => board.story(l, storyId).tasks.find((t) => t.nodeId === nodeId).state;

test("claim takes the oldest ready task of the link's repo and returns what the agent needs", () => {
  const { board, c, be, linkOf } = opened();
  const t = board.claimNext(linkOf(c, be));
  assert.equal(t.number, 2); // api
  assert.equal(t.branch, "feature/story-1/task-2");
  assert.deepEqual(t.story.branches.find((x) => x.repoId === be), { repoId: be, baseBranch: "main", storyBase: "feature/story-1/base" });
  assert.deepEqual(t.verify[0].argv, ["npm", "test"]);
  assert.equal(board.claimNext(linkOf(c, be)), null); // 한 사람 하나
});
test("claim race: two owners, one ready task, one wins and the other gets null", () => {
  const ctx = setup();
  const { store, admin, b, be } = ctx;
  store.addOwner(admin, be, b.id);
  const { board, linkOf, plBe, pub } = opened(ctx);
  board.cancelTask(plBe, pub.tasks.find((t) => t.nodeId === "copy").taskId);
  const first = board.claimNext(linkOf(b, be));
  const second = board.claimNext(linkOf(ctx.c, be));
  assert.equal(first.number, 2);
  assert.equal(second, null);
});
test("a fe link gets nothing while its only fe task still waits on be work", () => {
  const { board, b, fe, linkOf } = opened();
  assert.equal(board.claimNext(linkOf(b, fe)), null); // ui는 아직 waiting
});
test("held boundary: exactly 600000ms is still claimed, 600001ms is held, a heartbeat clears it", () => {
  const { board, c, be, linkOf, plBe, pub, tick } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  tick(600_000);
  assert.equal(st(board, plBe, pub.storyId, "api"), "claimed");
  tick(1);
  assert.equal(st(board, plBe, pub.storyId, "api"), "held");
  assert.deepEqual(board.inbox(plBe).alerts.map((a) => a.state), ["held"]);
  board.heartbeat(l, t.taskId, t.claimId, "build");
  assert.equal(st(board, plBe, pub.storyId, "api"), "claimed");
});
test("owner removed: link refused, task held, PL releases, another owner claims, old claim is NOT_YOURS", () => {
  const ctx = setup();
  const { store, admin, b, c, be } = ctx;
  store.addOwner(admin, be, b.id);
  const { board, tokenOf, linkOf, plBe, tick } = opened(ctx);
  const cTok = tokenOf(c, be);
  const cl = store.link(cTok);
  const t = board.claimNext(cl);
  store.removeOwner(admin, be, c.id);
  assert.equal(store.link(cTok), null); // 담당이 빠지면 연결 거부(기존 규칙)
  assert.throws(() => board.releaseTask(plBe, t.taskId), (e) => e.code === "STATE"); // 아직 보류 아님
  tick(600_001);
  board.releaseTask(plBe, t.taskId);
  const again = board.claimNext(linkOf(b, be));
  assert.equal(again.taskId, t.taskId);
  assert.notEqual(again.claimId, t.claimId);
  assert.throws(() => board.heartbeat(cl, t.taskId, t.claimId, "build"), (e) => e.code === "NOT_YOURS" && e.status === 409);
});
test("rerun: only the owner of a failed task, with memo and last failure", () => {
  const { db, board, c, be, linkOf, plBe } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  db.prepare("UPDATE hub_story_tasks SET state='failed',failure='검증 실패: npm test' WHERE id=?").run(t.taskId); // Task 4의 reportFailed 대신
  assert.throws(() => board.rerun(plBe, t.taskId, "메모"), (e) => e.code === "NOT_YOURS");
  const r = board.rerun(l, t.taskId, "타입 오류부터 고쳐");
  assert.deepEqual(r.lastFailure, { reason: "검증 실패: npm test", memo: "타입 오류부터 고쳐" });
  assert.notEqual(r.claimId, t.claimId);
});
test("inbox tells a returning Office its own task and claim", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  assert.deepEqual(board.inbox(l).mine, { taskId: t.taskId, claimId: t.claimId, storyId: t.story.id, state: "claimed" });
});
test("taskForClaim returns the claimed task again, with its last failure once failed; another claim is NOT_YOURS", () => {
  const { board, b, c, be, fe, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  assert.deepEqual(board.taskForClaim(l, t.taskId, t.claimId), t);
  board.reportFailed(l, t.taskId, t.claimId, "재검증 실패");
  assert.deepEqual(board.taskForClaim(l, t.taskId, t.claimId), { ...t, lastFailure: { reason: "재검증 실패", memo: null } });
  assert.throws(() => board.taskForClaim(l, t.taskId, "another-claim"), (e) => e.code === "NOT_YOURS" && e.status === 409);
  assert.throws(() => board.taskForClaim(linkOf(b, fe), t.taskId, t.claimId), (e) => e.code === "NOT_FOUND" && e.status === 404);
});
test("the claimant's own finished task answers STATE, not NOT_YOURS; a different claim stays NOT_YOURS", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.reportFailed(l, t.taskId, t.claimId, "재시도 한도 초과");
  assert.throws(() => board.heartbeat(l, t.taskId, t.claimId, "build"), (e) => e.code === "STATE" && e.status === 409);
  assert.throws(() => board.mergeLock(l, t.taskId, t.claimId), (e) => e.code === "STATE");
  assert.throws(() => board.heartbeat(l, t.taskId, "another-claim", "build"), (e) => e.code === "NOT_YOURS");
});
test("cancelling the story ends a member's claim: heartbeat is NOT_YOURS and the inbox is empty", () => {
  const { board, c, be, linkOf, plBe, pub } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.cancelStory(plBe, pub.storyId);
  assert.throws(() => board.heartbeat(l, t.taskId, t.claimId, "build"), (e) => e.code === "NOT_YOURS" && e.status === 409);
  assert.equal(board.inbox(l).mine, null);
});
