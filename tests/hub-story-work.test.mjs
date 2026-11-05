import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setup, opened } from "./hub-story-fixture.mjs";
import { MAC_OFFLINE_MS } from "../src/hub/store.ts";

const STATUS = { NOT_FOUND: 404, FORBIDDEN: 403, STATE: 409, NOT_LINKED: 409, BUSY: 409, INVALID: 400, NOT_YOURS: 409 };
const MSG = {
  notFound: "Task를 찾을 수 없습니다.",
  pickState: "지금 받을 수 있는 Task가 아닙니다. 화면을 새로 고쳐 상태를 확인하세요.",
  pickForbidden: "이 레포의 담당자만 받을 수 있습니다.",
  notLinked: "내 Mac이 지금 이 레포의 일을 가져갈 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요.",
  busy: "이미 맡은 Task가 있습니다. 그 Task가 끝나거나 PL이 풀어 준 뒤 고르세요.",
  rerunForbidden: "내가 맡은 Task만 다시 시도할 수 있습니다.",
  rerunVerify: "Story 검증은 PL의 Office가 다시 합니다.",
  rerunState: "실패한 Task만 다시 시도할 수 있습니다. 화면을 새로 고쳐 확인하세요.",
  linkRerunState: "실패한 Task만 다시 실행할 수 있습니다.",
  autoInvalid: "켜기 또는 끄기를 골라주세요.",
};
/** Matches a HubError by code (with its status) and, when given, its exact message. */
const is = (code, message) => (e) => e.code === code && e.status === STATUS[code] && (message === undefined || e.message === message);
const SHA = (n) => String(n).padStart(40, "0");
const merged = (n) => ({ prUrl: "https://github.example.com/team/app-be/pull/7", mergeCommit: SHA(n), summary: "s", assumptions: [] });
const idOf = (pub, nodeId) => pub.tasks.find((t) => t.nodeId === nodeId).taskId;
const verifyOf = (pub) => pub.tasks.at(-1).taskId;
const row = (db, id) => ({ ...db.prepare("SELECT state,claimed_by,claim_id FROM hub_story_tasks WHERE id=?").get(id) });
const rows = (db) => db.prepare("SELECT id,state,claimed_by,claim_id,heartbeat_at,memo FROM hub_story_tasks ORDER BY number").all().map((r) => ({ ...r }));
const events = (db, taskId, kind) =>
  db.prepare("SELECT member_id,detail FROM hub_task_events WHERE task_id=? AND kind=? ORDER BY id").all(taskId, kind).map((r) => ({ ...r }));
/** Claims the link's next Task and merges it under its own commit. */
const finish = (board, l) => {
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  board.reportMerged(l, t.taskId, t.claimId, merged(t.number));
  return t;
};
/** Publishes and opens a Story of `n` independent work Tasks in `repo`. */
const bulk = (ctx, key, n, repo = ctx.be) => {
  const { board, plBe, projectId, node, check } = ctx;
  const nodes = Array.from({ length: n }, (_, i) => node(`${key}-${i}`, repo, [`${key}/${i}.ts`]));
  const pub = board.publishStory(plBe, { projectId, title: key, body: "", risk: "normal", key, graph: { nodes, edges: [] }, storyVerify: [{ repoId: repo, checks: [ctx.check] }] });
  board.openStory(plBe, pub.storyId);
  return pub;
};
/** The three work Tasks merged (api and copy by c, ui by b), so the Story verification Task is ready. */
const allMerged = (ctx) => {
  const { board, b, c, be, fe, linkOf } = ctx;
  finish(board, linkOf(c, be));
  finish(board, linkOf(c, be));
  finish(board, linkOf(b, fe));
};

test("auto work is on with no row; off makes claimNext give nothing and openTaskOf stays null; on again gives the oldest ready Task", () => {
  const { db, board, b, c, be, fe, linkOf, pub } = opened();
  finish(board, linkOf(c, be)); // api merged: ui (fe) is ready for b
  const bFe = linkOf(b, fe);
  assert.equal(board.autoWork(b.id), true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hub_work_settings").get().n, 0);
  assert.deepEqual(board.setAutoWork(b, false), { autoWork: false });
  assert.equal(board.autoWork(b.id), false);
  assert.equal(board.autoWork(c.id), true); // the switch is each member's own
  assert.equal(board.claimNext(bFe), null);
  assert.equal(board.openTaskOf(bFe), null);
  assert.equal(row(db, idOf(pub, "ui")).state, "ready");
  for (const bad of ["off", 0, null, undefined])
    assert.throws(() => board.setAutoWork(b, bad), is("INVALID", MSG.autoInvalid));
  assert.equal(board.autoWork(b.id), false);
  assert.deepEqual(board.setAutoWork(b, true), { autoWork: true });
  assert.equal(board.autoWork(b.id), true);
  assert.equal(board.claimNext(bFe).taskId, idOf(pub, "ui"));
});

test("turning auto work off keeps the open Task: its heartbeat and merged report still work", () => {
  const { board, c, be, linkOf, pub } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.setAutoWork(c, false);
  assert.deepEqual(board.heartbeat(l, t.taskId, t.claimId, "build"), { ok: true });
  assert.deepEqual(board.inbox(l).mine, { taskId: t.taskId, claimId: t.claimId, storyId: pub.storyId, state: "claimed" });
  assert.equal(board.mergeLock(l, t.taskId, t.claimId).granted, true);
  assert.equal(board.reportMerged(l, t.taskId, t.claimId, merged(t.number)).already, false);
  assert.equal(board.claimNext(l), null); // copy is ready, but nothing new comes while it is off
  assert.equal(board.openTaskOf(l), null);
  board.setAutoWork(c, true);
  assert.equal(board.claimNext(l).taskId, idOf(pub, "copy"));
});

test("auto work off does not stop the PL's claimVerify", () => {
  const ctx = opened();
  const { board, pl, plBe, pub } = ctx;
  allMerged(ctx);
  board.setAutoWork(pl, false);
  const v = board.claimVerify(plBe, pub.storyId);
  assert.equal(v.taskId, verifyOf(pub));
  assert.equal(v.kind, "verify");
});

test("pickTask claims the ready Task for the member with a new claim id and a picked event; inbox(link).mine names it", () => {
  const { db, board, c, be, linkOf, pub, tick } = opened();
  const copy = idOf(pub, "copy"); // not the oldest ready Task: picking chooses
  const now = tick(5);
  assert.deepEqual(board.pickTask(c, copy, new Set([be])), { ok: true });
  const l = linkOf(c, be);
  const mine = board.inbox(l).mine;
  assert.equal(typeof mine.claimId, "string");
  assert.deepEqual(mine, { taskId: copy, claimId: mine.claimId, storyId: pub.storyId, state: "claimed" });
  const t = board.taskForClaim(l, copy, mine.claimId);
  assert.equal(t.title, "copy");
  assert.equal(t.lastFailure, null);
  assert.deepEqual(events(db, copy, "picked"), [{ member_id: c.id, detail: null }]);
  assert.deepEqual(events(db, copy, "claimed"), []);
  const view = board.story({ member: c }, pub.storyId).tasks.find((x) => x.id === copy);
  assert.equal(view.state, "claimed");
  assert.equal(view.assignee.id, c.id);
  assert.equal(view.heartbeatAt, now);
  assert.equal(view.stage, null);
  assert.equal(board.claimNext(l), null); // the picked Task is the member's one open Task
});

test("pickTask refuses in order: unknown NOT_FOUND, waiting or verify or draft-Story STATE, not an owner FORBIDDEN, an open Task BUSY, no live link NOT_LINKED; nothing changes", () => {
  const ctx = opened();
  const { db, board, b, c, be, fe, linkOf, plBe, projectId, node, check, pub } = ctx;
  const all = new Set([be, fe]), none = new Set();
  // A Task forced ready in a draft Story, and the verification Task forced ready: the kind and the Story are checked too.
  const draft = board.publishStory(plBe, {
    projectId, title: "초안", body: "", risk: "normal", key: "k2",
    graph: { nodes: [node("draft", be, ["d.ts"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }],
  });
  const draftTask = draft.tasks[0].taskId;
  db.prepare("UPDATE hub_story_tasks SET state='ready' WHERE id IN (?,?)").run(draftTask, verifyOf(pub));
  const api = idOf(pub, "api"), copy = idOf(pub, "copy"), ui = idOf(pub, "ui");
  let before = rows(db);
  assert.throws(() => board.pickTask(c, randomUUID(), all), is("NOT_FOUND", MSG.notFound));
  assert.throws(() => board.pickTask(c, 42, all), is("NOT_FOUND", MSG.notFound));
  // ui waits on api; c does not own fe and has no fe link, but the state is judged first.
  assert.throws(() => board.pickTask(c, ui, none), is("STATE", MSG.pickState));
  assert.throws(() => board.pickTask(ctx.pl, verifyOf(pub), all), is("STATE", MSG.pickState));
  assert.throws(() => board.pickTask(c, draftTask, all), is("STATE", MSG.pickState));
  // b owns only fe: refused as a non-owner even with a be link claimed.
  assert.throws(() => board.pickTask(b, api, all), is("FORBIDDEN", MSG.pickForbidden));
  assert.throws(() => board.pickTask(b, api, none), is("FORBIDDEN", MSG.pickForbidden));
  assert.throws(() => board.pickTask(c, api, none), is("NOT_LINKED", MSG.notLinked));
  assert.throws(() => board.pickTask(c, api, new Set([fe])), is("NOT_LINKED", MSG.notLinked));
  assert.deepEqual(rows(db), before);
  board.claimNext(linkOf(c, be)); // c now holds api
  before = rows(db);
  assert.throws(() => board.pickTask(c, copy, none), is("BUSY", MSG.busy)); // BUSY is judged before the link
  assert.throws(() => board.pickTask(c, copy, new Set([be])), is("BUSY", MSG.busy));
  assert.throws(() => board.pickTask(c, api, new Set([be])), is("STATE", MSG.pickState)); // already c's own
  assert.deepEqual(rows(db), before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hub_task_events WHERE kind='picked'").get().n, 0);
});

test("pickTask ignores the switch: a member with auto work on can pick", () => {
  for (const on of [true, false]) {
    const { board, c, be, linkOf, pub } = opened();
    if (!on) board.setAutoWork(c, false);
    assert.equal(board.autoWork(c.id), on);
    assert.deepEqual(board.pickTask(c, idOf(pub, "copy"), new Set([be])), { ok: true });
    assert.equal(board.inbox(linkOf(c, be)).mine.taskId, idOf(pub, "copy"));
  }
});

test("two members pick the same Task: the second gets STATE and the first keeps it; one member picking a second Task gets BUSY", () => {
  const ctx = setup();
  ctx.store.addOwner(ctx.admin, ctx.be, ctx.b.id);
  const { db, board, b, c, be, pub } = opened(ctx);
  const api = idOf(pub, "api"), copy = idOf(pub, "copy"), linked = new Set([be]);
  board.pickTask(c, api, linked);
  const first = row(db, api);
  assert.equal(first.claimed_by, c.id);
  assert.throws(() => board.pickTask(b, api, linked), is("STATE", MSG.pickState));
  assert.throws(() => board.pickTask(c, api, linked), is("STATE", MSG.pickState)); // a double click
  assert.deepEqual(row(db, api), first);
  assert.throws(() => board.pickTask(c, copy, linked), is("BUSY", MSG.busy));
  assert.deepEqual(row(db, copy), { state: "ready", claimed_by: null, claim_id: null });
  assert.deepEqual(board.pickTask(b, copy, linked), { ok: true });
  assert.equal(row(db, copy).claimed_by, b.id);
  assert.deepEqual(events(db, api, "picked"), [{ member_id: c.id, detail: null }]);
});

test("a claim and a pick of the same Task: whichever is first holds it and the other gets null or STATE", () => {
  for (const claimFirst of [true, false]) {
    const ctx = setup();
    ctx.store.addOwner(ctx.admin, ctx.be, ctx.b.id);
    const { db, board, b, c, be, linkOf, plBe, pub } = opened(ctx);
    board.cancelTask(plBe, idOf(pub, "copy")); // api is the only ready be Task
    const api = idOf(pub, "api"), linked = new Set([be]);
    if (claimFirst) {
      assert.equal(board.claimNext(linkOf(c, be)).taskId, api);
      assert.throws(() => board.pickTask(b, api, linked), is("STATE", MSG.pickState));
      assert.equal(row(db, api).claimed_by, c.id);
    } else {
      board.pickTask(b, api, linked);
      assert.equal(board.claimNext(linkOf(c, be)), null);
      assert.equal(board.openTaskOf(linkOf(c, be)), null);
      assert.equal(row(db, api).claimed_by, b.id);
    }
  }
});

test("rerunTask by the assignee turns the failed work Task claimed under a new claim id, stores the trimmed memo (empty → null) and a rerun event; taskForClaim with the new claim id carries lastFailure {reason, memo}", () => {
  const { db, board, c, be, linkOf, pub, tick } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.reportFailed(l, t.taskId, t.claimId, "검증 실패: npm test");
  const now = tick(700_000); // a failed Task is not held, whatever its old heartbeat
  assert.deepEqual(board.rerunTask(c, t.taskId, "  타입 오류부터 고쳐 \n", new Set([be])), { ok: true });
  const mine = board.inbox(l).mine;
  assert.deepEqual(mine, { taskId: t.taskId, claimId: mine.claimId, storyId: pub.storyId, state: "claimed" });
  assert.notEqual(mine.claimId, t.claimId);
  assert.deepEqual(board.taskForClaim(l, t.taskId, mine.claimId).lastFailure, { reason: "검증 실패: npm test", memo: "타입 오류부터 고쳐" });
  // The Office's failed record under the old claim is told to drop it.
  assert.throws(() => board.taskForClaim(l, t.taskId, t.claimId), is("NOT_YOURS"));
  const view = board.story({ member: c }, pub.storyId).tasks.find((x) => x.id === t.taskId);
  assert.equal(view.state, "claimed");
  assert.equal(view.heartbeatAt, now);
  assert.equal(view.memo, "타입 오류부터 고쳐");
  assert.deepEqual(events(db, t.taskId, "rerun"), [{ member_id: c.id, detail: "타입 오류부터 고쳐" }]);
  // An empty memo is stored as none.
  board.reportFailed(l, t.taskId, mine.claimId, "또 실패");
  board.rerunTask(c, t.taskId, "   ", new Set([be]));
  const again = board.inbox(l).mine;
  assert.deepEqual(board.taskForClaim(l, t.taskId, again.claimId).lastFailure, { reason: "또 실패", memo: null });
  assert.deepEqual(events(db, t.taskId, "rerun").at(-1), { member_id: c.id, detail: null });
});

test("rerunTask: a Task that is not failed or has no assignee STATE, another member's failed Task FORBIDDEN, a 2001-character memo INVALID, the Story verification Task STATE; a second rerun is STATE", () => {
  {
    const { db, board, pl, b, c, be, linkOf, pub } = opened();
    const l = linkOf(c, be);
    const t = board.claimNext(l);
    assert.throws(() => board.rerunTask(c, t.taskId, "", new Set([be])), is("STATE", MSG.rerunState)); // claimed, not failed
    assert.throws(() => board.rerunTask(b, t.taskId, "", new Set([be])), is("STATE", MSG.rerunState)); // someone else's, not failed
    assert.throws(() => board.rerunTask(c, idOf(pub, "copy"), "", new Set([be])), is("STATE", MSG.rerunState)); // ready, nobody's
    board.reportFailed(l, t.taskId, t.claimId, "실패");
    const before = rows(db);
    assert.throws(() => board.rerunTask(c, randomUUID(), "", new Set([be])), is("NOT_FOUND", MSG.notFound));
    for (const m of [b, pl]) assert.throws(() => board.rerunTask(m, t.taskId, "", new Set([be])), is("FORBIDDEN", MSG.rerunForbidden)); // the PL too
    assert.throws(() => board.rerunTask(c, t.taskId, "x".repeat(2001), new Set([be])), is("INVALID"));
    assert.throws(() => board.rerunTask(c, t.taskId, 42, new Set([be])), is("INVALID"));
    assert.deepEqual(rows(db), before);
    assert.deepEqual(events(db, t.taskId, "rerun"), []);
    board.rerunTask(c, t.taskId, "x".repeat(2000), new Set([be]));
    const after = rows(db);
    assert.throws(() => board.rerunTask(c, t.taskId, "다시", new Set([be])), is("STATE", MSG.rerunState)); // a double click
    assert.deepEqual(rows(db), after);
    assert.equal(events(db, t.taskId, "rerun").length, 1);
    // Failed again, then the PL released it before the assignee pressed 다시 시도: STATE, not FORBIDDEN.
    board.reportFailed(l, t.taskId, board.inbox(l).mine.claimId, "또 실패");
    board.releaseTask({ member: pl }, t.taskId);
    const released = rows(db);
    assert.throws(() => board.rerunTask(c, t.taskId, "", new Set([be])), is("STATE", MSG.rerunState));
    assert.deepEqual(rows(db), released);
  }
  {
    // A failed Story verification has no assignee; the PL's Office reruns it, not the web.
    const ctx = opened();
    const { db, board, pl, b, plBe, pub } = ctx;
    allMerged(ctx);
    const v = board.claimVerify(plBe, pub.storyId);
    board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" });
    const before = rows(db);
    for (const m of [pl, b]) assert.throws(() => board.rerunTask(m, v.taskId, "", new Set()), is("STATE", MSG.rerunVerify));
    assert.deepEqual(rows(db), before);
  }
});

test("a 2000-character rerun memo whose line breaks arrive as CRLF is accepted on the web and the link, and stored with LF", () => {
  const { db, board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  const lines = Array.from({ length: 20 }, (_, i) => String(i % 10).repeat(99)); // 20 × 99 + 19 breaks = 1999
  const memo = (sep) => `${lines.join(sep)}끝`; // 2000 characters with \n, 2019 with \r\n
  assert.equal(memo("\n").length, 2000);
  assert.equal(memo("\r\n").length, 2019);
  board.reportFailed(l, t.taskId, t.claimId, "실패");
  assert.deepEqual(board.rerunTask(c, t.taskId, memo("\r\n"), new Set([be])), { ok: true });
  const memoOf = () => db.prepare("SELECT memo FROM hub_story_tasks WHERE id=?").get(t.taskId).memo;
  assert.equal(memoOf(), memo("\n"));
  assert.equal(events(db, t.taskId, "rerun").at(-1).detail, memo("\n"));
  board.reportFailed(l, t.taskId, board.inbox(l).mine.claimId, "또 실패");
  assert.deepEqual(board.rerun(l, t.taskId, ` ${memo("\r\n")}\r\n`).lastFailure, { reason: "또 실패", memo: memo("\n") });
  // One character more is still too long.
  board.reportFailed(l, t.taskId, board.inbox(l).mine.claimId, "세 번째 실패");
  assert.throws(() => board.rerunTask(c, t.taskId, `${memo("\r\n")}x`, new Set([be])), is("INVALID"));
});

test("the link rerun still works and a web rerun after it is STATE", () => {
  const { db, board, c, be, linkOf, plBe } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.reportFailed(l, t.taskId, t.claimId, "실패");
  const r = board.rerun(l, t.taskId, " 로컬 메모 ");
  assert.notEqual(r.claimId, t.claimId);
  assert.deepEqual(r.lastFailure, { reason: "실패", memo: "로컬 메모" });
  assert.throws(() => board.rerunTask(c, t.taskId, "웹", new Set([be])), is("STATE", MSG.rerunState));
  // And the other way round: the local rerun after a web rerun is STATE.
  board.reportFailed(l, t.taskId, r.claimId, "실패 2");
  board.rerunTask(c, t.taskId, "웹 메모", new Set([be]));
  assert.throws(() => board.rerun(l, t.taskId, "로컬"), is("STATE", MSG.linkRerunState), "the link keeps its own words");
  // The link keeps its own codes: another member is NOT_YOURS, a long memo INVALID.
  const mine = board.inbox(l).mine;
  board.reportFailed(l, t.taskId, mine.claimId, "실패 3");
  assert.throws(() => board.rerun(plBe, t.taskId, ""), is("NOT_YOURS"));
  assert.throws(() => board.rerun(l, t.taskId, "x".repeat(2001)), is("INVALID"));
  assert.equal(row(db, t.taskId).state, "failed");
  assert.deepEqual(events(db, t.taskId, "rerun").map((e) => e.detail), ["로컬 메모", "웹 메모"]);
});

test("pickTask is NOT_LINKED for a stale link; rerunTask is NOT_LINKED for a repo outside linked and changes nothing; taskActions.rerun says not-linked", () => {
  const { db, store, board, b, c, be, fe, tokenOf, pub, tick } = opened();
  const copy = idOf(pub, "copy");
  board.setAutoWork(c, false);
  const token = tokenOf(c, be);
  const l = store.link(token); // C's Office reads its be inbox
  assert.deepEqual([...store.reachableRepos(c.id)], [be]);
  tick(MAC_OFFLINE_MS + 1); // and then goes quiet
  assert.deepEqual([...store.liveLinkRepos(c.id)], [be], "the link itself is still live");
  let before = rows(db);
  assert.throws(() => board.pickTask(c, copy, store.reachableRepos(c.id)), is("NOT_LINKED", MSG.notLinked));
  assert.deepEqual(rows(db), before);
  assert.deepEqual(board.memberWork(c.id, store.reachableRepos(c.id)).ready.map((x) => x.pick), ["not-linked", "not-linked"]);
  assert.equal(board.taskActions(c, copy, store.reachableRepos(c.id)).pick, "not-linked");
  store.link(token); // heard from again
  assert.deepEqual(board.pickTask(c, copy, store.reachableRepos(c.id)), { ok: true });

  const mine = board.inbox(l).mine;
  board.reportFailed(l, copy, mine.claimId, "실패");
  before = rows(db);
  assert.throws(() => board.rerunTask(c, copy, "메모", new Set()), is("NOT_LINKED", MSG.notLinked));
  assert.throws(() => board.rerunTask(c, copy, "메모", new Set([fe])), is("NOT_LINKED", MSG.notLinked));
  assert.throws(() => board.rerunTask(c, copy, "x".repeat(2001), new Set()), is("NOT_LINKED"), "judged before the memo");
  assert.deepEqual(rows(db), before);
  assert.deepEqual(events(db, copy, "rerun"), []);
  assert.equal(board.taskActions(c, copy, new Set()).rerun, "not-linked");
  assert.equal(board.taskActions(c, copy, new Set([be])).rerun, "yes");
  assert.equal(board.taskActions(b, copy, new Set([be, fe])).rerun, "no", "not the assignee");
  // The link rerun takes no such set: the Office that calls it holds the link.
  tick(MAC_OFFLINE_MS + 1);
  assert.deepEqual([...store.reachableRepos(c.id)], []);
  assert.notEqual(board.rerun(l, copy, "로컬").claimId, mine.claimId);
});

test("memberWork: open is the member's claimed or failed Task; ready lists ready work Tasks of open Stories in the member's repos in claim order (at most 50); led lists held and failed Tasks of the member's Stories; done lists the member's merged Tasks newest first (at most 20)", () => {
  {
    const ctx = opened();
    const { board, pl, b, c, be, fe, linkOf, pub, tick } = ctx;
    const api = idOf(pub, "api"), copy = idOf(pub, "copy"), ui = idOf(pub, "ui");
    const story = { id: pub.storyId, number: 1, title: "쿠폰 발급" };
    const ids = (cards) => cards.map((x) => x.taskId);
    let w = board.memberWork(c.id, new Set([be]));
    assert.deepEqual(w, {
      autoWork: true,
      open: null,
      ready: w.ready, // checked card by card below
      led: [],
      done: [],
    });
    assert.deepEqual(w.ready[0], {
      taskId: api, number: 2, kind: "work", title: "api", repo: { id: be, name: "app-be" }, story,
      state: "ready", stage: null, assignee: null, prUrl: null, failure: null, heartbeatAt: null,
      updatedAt: w.ready[0].updatedAt, pick: "auto-on",
    });
    assert.equal(typeof w.ready[0].updatedAt, "number");
    assert.deepEqual(ids(w.ready), [api, copy]); // ui waits; it is fe anyway
    assert.deepEqual(ids(board.memberWork(b.id, new Set([fe])).ready), []);
    assert.deepEqual(ids(board.memberWork(pl.id, new Set()).ready), [api, copy]);

    // c merges api: it is c's done, ui becomes b's ready.
    const now = tick(10);
    finish(board, linkOf(c, be));
    w = board.memberWork(c.id, new Set([be]));
    assert.equal(w.open, null);
    assert.deepEqual(ids(w.ready), [copy]);
    assert.deepEqual(w.done, [{
      taskId: api, number: 2, kind: "work", title: "api", repo: { id: be, name: "app-be" }, story,
      state: "merged", stage: null, assignee: { id: c.id, name: "C" }, prUrl: "https://github.example.com/team/app-be/pull/7",
      failure: null, heartbeatAt: now, updatedAt: now, pick: "no",
    }]);
    assert.deepEqual(ids(board.memberWork(b.id, new Set([fe])).ready), [ui]);

    // b holds ui past the heartbeat limit; c fails copy.
    const bFe = linkOf(b, fe), cBe = linkOf(c, be);
    board.claimNext(bFe);
    const t = board.claimNext(cBe);
    board.heartbeat(cBe, t.taskId, t.claimId, "verify");
    w = board.memberWork(c.id, new Set([be]));
    assert.equal(w.open.taskId, copy);
    assert.equal(w.open.state, "claimed");
    assert.equal(w.open.stage, "verify");
    assert.equal(w.open.pick, "no");
    assert.deepEqual(w.ready, []);
    board.reportFailed(cBe, t.taskId, t.claimId, "검증 실패: npm test");
    tick(600_001);
    w = board.memberWork(c.id, new Set([be]));
    assert.deepEqual(
      { taskId: w.open.taskId, state: w.open.state, failure: w.open.failure, assignee: w.open.assignee },
      { taskId: copy, state: "failed", failure: "검증 실패: npm test", assignee: { id: c.id, name: "C" } },
    );
    const bWork = board.memberWork(b.id, new Set([fe]));
    assert.equal(bWork.open.taskId, ui);
    assert.equal(bWork.open.state, "held");
    const led = board.memberWork(pl.id, new Set([be, fe])).led;
    assert.deepEqual(led.map((x) => [x.taskId, x.state]), [[ui, "held"], [copy, "failed"]]);
    assert.deepEqual(board.memberWork(c.id, new Set([be])).led, []); // c leads no Story
    assert.deepEqual(ids(bWork.done), []); // api was c's merge, not b's
  }
  {
    // At most 50 ready, in claim order: Story by Story in the order they were made, then Task number.
    const ctx = opened();
    const { board, c, be, plBe, pub, node, tick } = ctx;
    tick(1);
    const second = bulk(ctx, "s2", 30);
    // A Task added to Story 1 later has a higher number than Story 2's Tasks, yet comes before them.
    const late = board.addTasks(plBe, pub.storyId, "late", { nodes: [node("late", be, ["late.ts"])], edges: [] }).tasks[0].taskId;
    tick(1);
    const third = bulk(ctx, "s3", 30);
    const work = (p) => p.tasks.filter((t) => t.nodeId !== "story-verify").map((t) => t.taskId);
    const expected = [idOf(pub, "api"), idOf(pub, "copy"), late, ...work(second), ...work(third)].slice(0, 50);
    assert.deepEqual(board.memberWork(c.id, new Set([be])).ready.map((x) => x.taskId), expected);
    assert.equal(board.claimNext(ctx.linkOf(c, be)).taskId, expected[0]); // the same order claimNext takes
  }
  {
    // At most 20 done, newest first.
    const ctx = opened();
    const { board, c, be, linkOf, tick } = ctx;
    bulk(ctx, "many", 20);
    const order = [];
    for (let i = 0; i < 22; i++) {
      tick(10);
      order.push(finish(board, linkOf(c, be)).taskId);
    }
    const done = board.memberWork(c.id, new Set([be])).done;
    assert.deepEqual(done.map((x) => x.taskId), order.slice(2).reverse());
    assert.ok(done.every((x) => x.state === "merged" && x.pick === "no"));
  }
});

test("memberWork pick: yes only with auto off, a linked repo and no open Task; auto-on, not-linked and busy otherwise", () => {
  const { board, c, be, fe, pub } = opened();
  const picks = (linked) => board.memberWork(c.id, linked).ready.map((x) => x.pick);
  assert.deepEqual(picks(new Set([be])), ["auto-on", "auto-on"]);
  board.setAutoWork(c, false);
  assert.equal(board.memberWork(c.id, new Set([be])).autoWork, false);
  assert.deepEqual(picks(new Set([be])), ["yes", "yes"]);
  // Owner of be without a live be link (clone failed, link revoked, not on this Mac yet).
  assert.deepEqual(picks(new Set()), ["not-linked", "not-linked"]);
  assert.deepEqual(picks(new Set([fe])), ["not-linked", "not-linked"]);
  board.pickTask(c, idOf(pub, "api"), new Set([be]));
  const w = board.memberWork(c.id, new Set([be]));
  assert.equal(w.open.taskId, idOf(pub, "api"));
  assert.equal(w.open.pick, "no");
  assert.deepEqual(picks(new Set([be])), ["busy"]);
  assert.deepEqual(picks(new Set()), ["busy"]); // BUSY is judged before the link, as pickTask does
  board.setAutoWork(c, true);
  assert.deepEqual(picks(new Set([be])), ["busy"]); // BUSY is judged before the switch
  // The button and the card come from one rule.
  assert.equal(board.taskActions(c, idOf(pub, "copy"), new Set([be])).pick, "busy");
  assert.equal(board.taskActions(c, idOf(pub, "copy"), new Set()).pick, "busy");
});

test("a member holding a Task in one repo sees busy, not not-linked, for a ready Task of another repo whose link is stale, and pickTask is BUSY", () => {
  const { db, store, board, pl, be, fe, tokenOf, projectId, node, check, tick } = opened();
  const tBe = tokenOf(pl, be), tFe = tokenOf(pl, fe);
  const plBe = store.link(tBe);
  store.link(tFe); // an Office with no record reads every ready lane's inbox
  const fePub = board.publishStory(plBe, {
    projectId, title: "fe만", body: "", risk: "normal", key: "k-fe",
    graph: { nodes: [node("f1", fe, ["src/f1.ts"])], edges: [] }, storyVerify: [{ repoId: fe, checks: [check] }],
  });
  board.openStory(plBe, fePub.storyId);
  const f1 = idOf(fePub, "f1");
  const pickOf = () => board.memberWork(pl.id, store.reachableRepos(pl.id)).ready.find((x) => x.taskId === f1).pick;
  assert.equal(pickOf(), "auto-on");
  // The Office claims a be Task and holds it: only the be heartbeat uses a link from now on.
  const t = board.claimNext(store.link(tBe));
  for (let i = 0; i < 4; i++) {
    tick(60_000);
    board.heartbeat(store.link(tBe), t.taskId, t.claimId, "build");
  }
  assert.deepEqual([...store.reachableRepos(pl.id)], [be], "the fe link went stale while be was worked");
  assert.equal(pickOf(), "busy", "auto work on: no line at all, not the Mac-fault sentence");
  board.setAutoWork(pl, false);
  assert.equal(pickOf(), "busy");
  assert.equal(board.taskActions(pl, f1, store.reachableRepos(pl.id)).pick, "busy");
  const before = rows(db);
  assert.throws(() => board.pickTask(pl, f1, store.reachableRepos(pl.id)), is("BUSY", MSG.busy));
  assert.deepEqual(rows(db), before);
  // Done with be and still not reading fe: then it is the link that is missing.
  board.mergeLock(store.link(tBe), t.taskId, t.claimId);
  board.reportMerged(store.link(tBe), t.taskId, t.claimId, merged(t.number));
  assert.equal(pickOf(), "not-linked");
  assert.throws(() => board.pickTask(pl, f1, store.reachableRepos(pl.id)), is("NOT_LINKED", MSG.notLinked));
});

test("taskActions: rerun for the assignee of a failed work Task; release for the PL and an admin on held or failed; cancel for the PL and an admin on unfinished work Tasks; none for others", () => {
  const ctx = opened();
  const { board, admin, pl, b, c, be, fe, linkOf, plBe, pub, tick } = ctx;
  const api = idOf(pub, "api"), copy = idOf(pub, "copy"), ui = idOf(pub, "ui"), verify = verifyOf(pub);
  const none = { pick: "no", rerun: "no", release: false, cancel: "no" };
  const acts = (m, id, linked = new Set()) => board.taskActions(m, id, linked);
  // Ready: the owner may pick; the PL and an admin may cancel (both also own be, without a be link here).
  assert.deepEqual(acts(c, api, new Set([be])), { ...none, pick: "auto-on" });
  assert.deepEqual(acts(pl, api), { ...none, pick: "not-linked", cancel: "yes" });
  assert.deepEqual(acts(admin, api), { ...none, pick: "not-linked", cancel: "yes" });
  assert.deepEqual(acts(b, api, new Set([be, fe])), none);
  assert.deepEqual(acts(pl, ui), { ...none, cancel: "yes" }); // waiting
  assert.deepEqual(acts(pl, verify, new Set([be, fe])), none); // the verification Task is never cancelled here
  assert.throws(() => acts(c, randomUUID()), is("NOT_FOUND", MSG.notFound));

  const l = linkOf(c, be);
  const t = board.claimNext(l); // api
  assert.deepEqual(acts(pl, api), { ...none, cancel: "yes" }); // claimed, alive
  tick(600_001);
  assert.deepEqual(acts(pl, api), { ...none, release: true, cancel: "yes" }); // held
  // Holding the merge lock, the web offers no cancel: the change may already be merged.
  board.mergeLock(l, t.taskId, t.claimId);
  assert.deepEqual(acts(pl, api), { ...none, release: true, cancel: "locked" });
  assert.deepEqual(acts(admin, api), { ...none, release: true, cancel: "locked" });
  assert.deepEqual(acts(b, api), none);
  assert.deepEqual(acts(c, api, new Set([be])), none); // held is not failed: no rerun
  board.reportFailed(l, t.taskId, t.claimId, "실패"); // gives the lock up
  assert.deepEqual(acts(c, api, new Set([be])), { ...none, rerun: "yes" });
  assert.deepEqual(acts(pl, api), { ...none, release: true, cancel: "yes" });
  assert.deepEqual(acts(admin, api), { ...none, release: true, cancel: "yes" });
  assert.deepEqual(acts(b, api), none);
  assert.deepEqual(acts(c, copy, new Set([be])), { ...none, pick: "busy" });

  board.cancelTask({ member: pl }, api); // frees c, readies ui
  assert.deepEqual(acts(pl, api), none);
  finish(board, linkOf(c, be)); // copy
  assert.deepEqual(acts(pl, copy), none); // merged
  assert.deepEqual(acts(c, copy, new Set([be])), none);
  finish(board, linkOf(b, fe)); // ui
  const v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" });
  assert.deepEqual(acts(pl, verify, new Set([be, fe])), { ...none, release: true }); // no web rerun, no cancel
  assert.deepEqual(acts(admin, verify), { ...none, release: true });
  assert.deepEqual(acts(b, verify), none);
});

test("the link cancel of a merge-locked Task still works; with refuseLocked it is STATE and nothing changes", () => {
  const { db, board, pl, b, c, be, linkOf, plBe, pub } = opened();
  const lockedText = "머지 잠금을 쥔 Task는 취소할 수 없습니다. 머지됐을 수 있으니 먼저 풀기를 하세요.";
  const lockOf = (id) => ({ ...db.prepare("SELECT merge_lock,lock_member,lock_claim FROM hub_story_tasks WHERE id=?").get(id) });
  const l = linkOf(c, be);
  const t = board.claimNext(l); // api
  board.mergeLock(l, t.taskId, t.claimId);
  const before = rows(db);
  const lock = lockOf(t.taskId);
  assert.equal(lock.merge_lock, 1);
  assert.throws(() => board.cancelTask({ member: pl }, t.taskId, { refuseLocked: true }), is("STATE", lockedText));
  assert.throws(() => board.cancelTask({ member: b }, t.taskId, { refuseLocked: true }), is("FORBIDDEN"), "the PL-or-admin rule comes first");
  assert.deepEqual(rows(db), before);
  assert.deepEqual(lockOf(t.taskId), lock);
  assert.deepEqual(events(db, t.taskId, "cancelled"), []);
  // A Task without the lock cancels with the option as before.
  assert.deepEqual(board.cancelTask({ member: pl }, idOf(pub, "copy"), { refuseLocked: true }), { ok: true, ready: [] });
  // The link API's cancel is unchanged: it cancels the locked Task.
  assert.equal(board.cancelTask(plBe, t.taskId).ok, true);
  assert.equal(row(db, t.taskId).state, "cancelled");
  assert.equal(lockOf(t.taskId).merge_lock, 0);
  assert.throws(() => board.cancelTask({ member: pl }, t.taskId, { refuseLocked: true }), is("STATE", "이미 끝난 Task는 취소할 수 없습니다."));
});

test("releaseTask and cancelTask take {member} from the web like a link, with the same PL-or-admin rule", () => {
  const { db, board, admin, pl, b, c, be, linkOf, projectId, pub } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.reportFailed(l, t.taskId, t.claimId, "실패");
  const forbidden = is("FORBIDDEN", "Story를 올린 PL이나 허브 관리자만 할 수 있습니다.");
  assert.throws(() => board.releaseTask({ member: b }, t.taskId), forbidden);
  assert.throws(() => board.releaseTask({ member: c }, t.taskId), forbidden); // the assignee is not the PL
  assert.deepEqual(board.releaseTask({ member: pl }, t.taskId), { ok: true });
  assert.deepEqual(row(db, t.taskId), { state: "ready", claimed_by: null, claim_id: null });
  assert.deepEqual(events(db, t.taskId, "released"), [{ member_id: pl.id, detail: "failed" }]);
  assert.throws(() => board.releaseTask({ member: pl }, randomUUID()), is("NOT_FOUND", MSG.notFound));
  const copy = idOf(pub, "copy");
  assert.throws(() => board.cancelTask({ member: b }, copy), forbidden);
  assert.deepEqual(board.cancelTask({ member: admin }, copy), { ok: true, ready: [] });
  assert.deepEqual(events(db, copy, "cancelled"), [{ member_id: admin.id, detail: null }]);
  assert.throws(() => board.cancelTask({ member: pl }, copy), is("STATE"));
  // Reading the board takes {member} as well.
  assert.deepEqual(board.projects({ member: b }).map((p) => p.id), [projectId]);
  assert.deepEqual(board.stories({ member: b }, projectId).map((s) => s.id), [pub.storyId]);
  assert.equal(board.story({ member: pl }, pub.storyId).isPl, true);
  assert.equal(board.story({ member: b }, pub.storyId).isPl, false);
});

test("taskDetail returns the Story view and the Task; an unknown id is NOT_FOUND", () => {
  const { board, b, pl, pub } = opened();
  const ui = idOf(pub, "ui");
  const d = board.taskDetail({ member: b }, ui);
  assert.deepEqual(d.story, board.story({ member: b }, pub.storyId));
  assert.deepEqual(d.task, d.story.tasks.find((x) => x.id === ui));
  assert.deepEqual(d.task.deps, [2]);
  assert.equal(board.taskDetail({ member: pl }, ui).story.isPl, true);
  assert.equal(board.taskDetail({ member: b }, verifyOf(pub)).task.kind, "verify");
  for (const bad of [randomUUID(), 42, undefined])
    assert.throws(() => board.taskDetail({ member: b }, bad), is("NOT_FOUND", MSG.notFound));
});
