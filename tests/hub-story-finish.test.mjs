import test from "node:test";
import assert from "node:assert/strict";
import { opened } from "./hub-story-fixture.mjs";

const SHA = (c) => c.repeat(40);
const merged = (n) => ({ prUrl: "https://github.example.com/team/app-be/pull/7", mergeCommit: String(n).padStart(40, "0"), summary: "s", assumptions: [] });
const code = (c) => (e) => e.code === c;

/** Pairs a Mac for `member` the way `mac connect` does, and gives the Mac's own link to `repo`. */
function macLinkOf(store, member, repo, name = "PL의 MacBook") {
  const { deviceCode, userCode } = store.startMac(name);
  store.approveMac(member, userCode);
  const poll = store.pollMac(deviceCode);
  return store.link(store.macLink(store.mac(poll.macToken), repo).token);
}

/**
 * An open Story whose work Tasks are all merged and whose check passed with the commits of both repos (be has the Story
 * checks, fe only work). `mac` is the PL's current Mac link; `commits` what the check reported.
 */
function passed(o = {}) {
  const ctx = opened();
  const { board, store, pl, b, c, be, fe, linkOf, plBe, pub } = ctx;
  let n = 0;
  const finish = (l) => {
    const t = board.claimNext(l);
    board.mergeLock(l, t.taskId, t.claimId);
    board.reportMerged(l, t.taskId, t.claimId, merged(++n));
  };
  finish(linkOf(c, be));
  finish(linkOf(c, be));
  finish(linkOf(b, fe));
  const commits = { [be]: SHA("a"), [fe]: SHA("b") };
  const v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "Story 검사 통과", ...(o.noCommits ? {} : { commits }) });
  const mac = macLinkOf(store, pl, fe);
  const view = () => board.finishView(plBe, pub.number);
  const approve = (over = {}) =>
    board.approveStory(mac, store.currentMac(pl.id), pub.storyId, { fingerprint: view().fingerprint, commits, recordHash: SHA("c").slice(0, 64).padEnd(64, "0"), ...over });
  return { ...ctx, v, commits, mac, view, approve };
}

test("a passed Story check keeps every Story repo's checked commit; a failed one keeps none (D48)", () => {
  const h = passed();
  assert.deepEqual(h.view().verified, h.commits);
  assert.equal(h.view().state, "awaiting_g4");
  assert.deepEqual(h.view().branches.map((x) => x.repoName), ["app-be", "app-fe"]);
  assert.equal(h.view().summary, "Story 검사 통과");
  // A Story check without commits (an Office before D48) keeps none, so nothing can be approved against it.
  const old = passed({ noCommits: true });
  assert.equal(old.view().verified, null);
  assert.throws(() => old.approve(), code("STATE"));
});

test("the commits must be exactly the Story's repos, each a full commit", () => {
  const { board, store, pl, b, c, be, fe, linkOf, plBe, pub } = opened();
  for (const [l, r] of [[linkOf(c, be), be], [linkOf(c, be), be], [linkOf(b, fe), fe]]) {
    const t = board.claimNext(l);
    board.mergeLock(l, t.taskId, t.claimId);
    board.reportMerged(l, t.taskId, t.claimId, merged(t.number));
    void r;
  }
  const v = board.claimVerify(plBe, pub.storyId);
  for (const commits of [{ [be]: SHA("a") }, { [be]: SHA("a"), [fe]: "abc" }, { [be]: SHA("a"), [fe]: SHA("b"), x: SHA("c") }, "nope"])
    assert.throws(() => board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "s", commits }), code("INVALID"));
  void store;
  void pl;
});

test("only the PL, from the PL's current Mac, approves a Story at 승인 대기 with its fingerprint and checked commits", () => {
  const h = passed();
  const { board, store, pl, c, be, linkOf, plBe, pub } = h;
  assert.throws(() => board.approveStory(plBe, store.currentMac(pl.id), pub.storyId, { fingerprint: h.view().fingerprint, commits: h.commits, recordHash: SHA("d").slice(0, 64) }), code("NOT_YOUR_MAC"), "a connection-string link has no Mac");
  assert.throws(() => board.approveStory(linkOf(c, be), store.currentMac(c.id), pub.storyId, { fingerprint: h.view().fingerprint, commits: h.commits, recordHash: SHA("d") }), code("FORBIDDEN"));
  assert.throws(() => h.approve({ fingerprint: "f".repeat(64) }), code("STALE"));
  assert.throws(() => h.approve({ commits: { ...h.commits, [be]: SHA("e") } }), code("STALE"));
  assert.throws(() => h.approve({ recordHash: "short" }), code("INVALID"));
  assert.deepEqual(board.inbox(plBe).finishReady, []);
  assert.deepEqual(h.approve(), { already: false });
  assert.deepEqual(h.approve(), { already: true }, "the same record again");
  assert.throws(() => h.approve({ recordHash: "9".repeat(64) }), code("STATE"), "another record over an approval");
  assert.deepEqual(board.inbox(plBe).finishReady, [pub.storyId]);
  const approval = h.view().approval;
  assert.equal(approval.macName, "PL의 MacBook");
  assert.equal(typeof approval.at, "number");
});

test("the PL Office reports each repo's merge; done needs every repo merged, and a merged repo stays merged", () => {
  const h = passed();
  const { board, be, fe, plBe, pub } = h;
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "done" }), code("STATE"), "not approved yet");
  h.approve();
  const pr = (n) => `https://github.example.com/team/app/pull/${n}`;
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "opened", prNumber: 3, prUrl: pr(3), mergeCommit: null, reason: null });
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "merged", prNumber: 3, prUrl: pr(3), mergeCommit: SHA("1"), reason: null });
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "merged", prNumber: 3, prUrl: pr(3), mergeCommit: SHA("1"), reason: null });
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "opened", prNumber: 4, prUrl: pr(4), mergeCommit: null, reason: null }), code("STATE"));
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "merged", prNumber: 5, prUrl: pr(5), mergeCommit: null, reason: null }), code("INVALID"), "a merge needs its commit");
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "opened", prNumber: 5, prUrl: "http://x", mergeCommit: null, reason: null }), code("INVALID"));
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "done" }), code("STATE"), "fe is not merged");
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "handed", prNumber: 5, prUrl: pr(5), mergeCommit: null, reason: "보호 규칙: 리뷰 1개 필요" });
  assert.equal(h.view().repos[fe].state, "handed");
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "merged", prNumber: 5, prUrl: pr(5), mergeCommit: SHA("2"), reason: null });
  board.finishReport(plBe, pub.storyId, { kind: "done" });
  assert.equal(h.view().state, "done");
  assert.deepEqual(board.inbox(plBe).finishReady, []);
});

test("a handed PR closed without merging ends the approval: the Story waits for the PL again and merged repos stay", () => {
  const h = passed();
  const { board, be, fe, plBe, pub } = h;
  h.approve();
  const pr = (n) => `https://github.example.com/team/app/pull/${n}`;
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "merged", prNumber: 3, prUrl: pr(3), mergeCommit: SHA("1"), reason: null });
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "handed", prNumber: 5, prUrl: pr(5), mergeCommit: null, reason: "충돌" });
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "closed", repoId: fe, prNumber: 6 }), code("STATE"), "not the handed PR");
  board.finishReport(plBe, pub.storyId, { kind: "closed", repoId: fe, prNumber: 5 });
  const view = h.view();
  assert.equal(view.state, "awaiting_g4");
  assert.equal(view.approval, null);
  assert.deepEqual(Object.keys(view.repos), [be]);
  assert.deepEqual(board.inbox(plBe).finishReady, []);
  assert.deepEqual(h.approve({ recordHash: "8".repeat(64) }), { already: false }, "the PL approves again");
});

test("a Story base that moved after its check sends the Story back to its check; a failed re-check reopens it as failed", () => {
  const h = passed();
  const { board, plBe, pub } = h;
  h.approve();
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "reverify" }), code("INVALID"), "a reason is needed");
  board.finishReport(plBe, pub.storyId, { kind: "reverify", reason: "app-be의 Story base가 검증 뒤에 바뀌었습니다." });
  let view = h.view();
  assert.equal(view.state, "open");
  assert.equal(view.verified, null);
  assert.equal(view.approval, null);
  assert.deepEqual(board.inbox(plBe).verifyReady, [pub.storyId], "the check is ready again");

  const again = passed();
  again.approve();
  again.board.finishReport(again.plBe, again.pub.storyId, { kind: "failed", reason: "기준 브랜치를 합친 뒤 V1이 실패했습니다." });
  view = again.view();
  assert.equal(view.state, "open");
  const check = again.board.story(again.plBe, again.pub.storyId).tasks.find((t) => t.kind === "verify");
  assert.equal(check.state, "failed");
  assert.equal(check.failure, "기준 브랜치를 합친 뒤 V1이 실패했습니다.");
});

test("finishView is the PL's only and finds a Story by its number", () => {
  const h = passed();
  const { board, c, be, linkOf, pub } = h;
  assert.equal(h.view().number, pub.number);
  assert.throws(() => board.finishView(linkOf(c, be), pub.number), code("FORBIDDEN"));
  assert.throws(() => board.finishView(h.plBe, 999), code("NOT_FOUND"));
  assert.throws(() => board.finishView(h.plBe, 1.5), code("INVALID"));
  assert.equal(board.finishView(h.plBe, pub.storyId).number, pub.number, "or by its id");
});

test("Tasks added after an approval end it, and a repo that gets new work is merged again; others keep their merge (D48, review 1 C2)", () => {
  const h = passed();
  const { board, be, fe, plBe, pub, node } = h;
  h.approve();
  const pr = (n) => `https://github.example.com/team/app/pull/${n}`;
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "merged", prNumber: 3, prUrl: pr(3), mergeCommit: SHA("1"), reason: null });
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "merged", prNumber: 4, prUrl: pr(4), mergeCommit: SHA("2"), reason: null });
  // The PL adds a fix in be: the approval ends, be must merge again, fe keeps its merge.
  board.addTasks(plBe, pub.storyId, "fix-1", { nodes: [node("fix", be, ["src/fix.ts"])], edges: [] });
  let view = h.view();
  assert.equal(view.state, "open");
  assert.equal(view.approval, null);
  assert.equal(view.verified, null);
  assert.deepEqual(Object.keys(view.repos), [fe]);
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "done" }), code("STATE"), "no done without an approval");
  // The fix is merged and checked again: the passed check keeps fe's merge, and a new approval is needed.
  const cBe = h.linkOf(h.c, be);
  const t = board.claimNext(cBe);
  board.mergeLock(cBe, t.taskId, t.claimId);
  board.reportMerged(cBe, t.taskId, t.claimId, merged(9));
  const v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "다시 통과", commits: { [be]: SHA("5"), [fe]: SHA("b") } });
  view = h.view();
  assert.equal(view.state, "awaiting_g4");
  assert.deepEqual(Object.keys(view.repos), [fe], "fe keeps its merge; be waits for a new merge");
  assert.equal(view.approval, null, "a new approval is needed");
});

test("a passed check keeps the merged repos; a stuck merge's problem is kept once and cleared by progress", () => {
  const h = passed();
  const { board, be, fe, plBe, pub } = h;
  h.approve();
  const pr = (n) => `https://github.example.com/team/app/pull/${n}`;
  board.finishReport(plBe, pub.storyId, { kind: "problem", reason: "머지를 하지 못하고 다시 시도합니다: GH_FAILED: gh auth" });
  assert.equal(h.view().problem.reason, "머지를 하지 못하고 다시 시도합니다: GH_FAILED: gh auth");
  assert.equal(board.storyFinish(pub.storyId).problem.reason, "머지를 하지 못하고 다시 시도합니다: GH_FAILED: gh auth");
  assert.throws(() => board.finishReport(plBe, pub.storyId, { kind: "problem" }), code("INVALID"));
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "merged", prNumber: 3, prUrl: pr(3), mergeCommit: SHA("1"), reason: null });
  assert.equal(h.view().problem, null, "progress clears it");
  void fe;
});

test("a Story at 승인 대기 whose check kept no commits (before D48) is checked again on the PL's request", () => {
  const old = passed({ noCommits: true });
  const { board, c, be, linkOf, plBe, pub } = old;
  assert.throws(() => board.recheckStory(linkOf(c, be), pub.storyId), code("FORBIDDEN"));
  board.recheckStory(plBe, pub.storyId);
  assert.equal(old.view().state, "open");
  assert.deepEqual(board.inbox(plBe).verifyReady, [pub.storyId], "the PL Office checks it again");
  assert.throws(() => board.recheckStory(plBe, pub.storyId), code("STATE"), "only at 승인 대기");
  const fresh = passed();
  assert.throws(() => fresh.board.recheckStory(fresh.plBe, fresh.pub.storyId), code("STATE"), "a Story with commits is approved, not checked again");
});

test("an approval that ends with open Story PRs withdraws them, so the PL Office closes them; any state takes the closed report (review 2 I1)", () => {
  const h = passed();
  const { board, be, fe, plBe, pub, node } = h;
  h.approve();
  const pr = (n) => `https://github.example.com/team/app/pull/${n}`;
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "merged", prNumber: 3, prUrl: pr(3), mergeCommit: SHA("1"), reason: null });
  board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "handed", prNumber: 5, prUrl: pr(5), mergeCommit: null, reason: "충돌" });
  // The PL adds a Task in be: fe's handed PR #5 follows the Story base from now on, so it is withdrawn.
  board.addTasks(plBe, pub.storyId, "fix-1", { nodes: [node("fix", be, ["src/fix.ts"])], edges: [] });
  let view = h.view();
  assert.deepEqual(view.withdrawn, [{ repoId: fe, prNumber: 5, prUrl: pr(5) }]);
  assert.equal(view.state, "open");
  assert.deepEqual(board.inbox(plBe).finishReady, [pub.storyId], "the PL Office comes for it though the Story is open");
  board.finishReport(plBe, pub.storyId, { kind: "withdrawn", repoId: fe, prNumber: 5 });
  board.finishReport(plBe, pub.storyId, { kind: "withdrawn", repoId: fe, prNumber: 5 });
  assert.deepEqual(h.view().withdrawn, [], "forgotten once closed; a resend is nothing");
  assert.deepEqual(board.inbox(plBe).finishReady, []);
});

test("a re-check, a failed re-check and a cancelled Story withdraw the open PRs too; a closed one is not withdrawn", () => {
  const pr = (n) => `https://github.example.com/team/app/pull/${n}`;
  for (const end of ["reverify", "failed", "cancel", "closed"]) {
    const h = passed();
    const { board, be, fe, plBe, pub } = h;
    h.approve();
    board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: be, state: "opened", prNumber: 3, prUrl: pr(3), mergeCommit: null, reason: null });
    board.finishReport(plBe, pub.storyId, { kind: "repo", repoId: fe, state: "handed", prNumber: 5, prUrl: pr(5), mergeCommit: null, reason: "리뷰 필요" });
    if (end === "cancel") board.cancelStory(plBe, pub.storyId);
    else if (end === "closed") board.finishReport(plBe, pub.storyId, { kind: "closed", repoId: fe, prNumber: 5 });
    else board.finishReport(plBe, pub.storyId, { kind: end, reason: "이유" });
    const view = h.view();
    assert.deepEqual(
      view.withdrawn.map((w) => w.prNumber),
      end === "closed" ? [3] : [3, 5],
      end,
    );
    assert.equal(view.approval, null, end);
    if (end === "closed") assert.deepEqual(view.verified, h.commits, "a closed PR keeps the checked commits for a new approval");
  }
});
