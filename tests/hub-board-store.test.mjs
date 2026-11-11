import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { opened, setup } from "./hub-story-fixture.mjs";
import { taskColumn } from "../src/hub/board.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { HubStore } from "../src/hub/store.ts";

const SHA = (n) => String(n).padStart(40, "0");
const merged = (n) => ({ prUrl: "https://github.example.com/team/app-be/pull/7", mergeCommit: SHA(n), summary: "s", assumptions: [] });
const finish = (board, l) => {
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  board.reportMerged(l, t.taskId, t.claimId, merged(t.number));
  return t;
};
const cardsOf = (board, a, o = { mine: false, cancelled: false }) => board.board(a, o).flatMap((p) => p.stories).flatMap((s) => s.cards);

test("taskColumn maps every state and stage", () => {
  assert.equal(taskColumn("waiting", null), "backlog");
  assert.equal(taskColumn("ready", null), "todo");
  for (const state of ["claimed", "held", "failed"]) {
    for (const stage of [null, "build"]) assert.equal(taskColumn(state, stage), "doing", `${state}/${stage}`);
    for (const stage of ["review", "verify", "merge"]) assert.equal(taskColumn(state, stage), "review", `${state}/${stage}`);
  }
  assert.equal(taskColumn("merged", null), "done");
  assert.equal(taskColumn("passed", null), "done");
  assert.equal(taskColumn("cancelled", null), "hidden");
});

test("column_at changes only when the column changes", () => {
  const { board, c, be, linkOf, plBe, pub, tick } = opened();
  const l = linkOf(c, be);
  const at = (id) => cardsOf(board, plBe).find((x) => x.taskId === id).columnAt;
  const t0 = board.claimNext(l); // claim at 1_000_000
  const claimedAt = at(t0.taskId);
  tick(1000);
  board.heartbeat(l, t0.taskId, t0.claimId, "build");
  assert.equal(at(t0.taskId), claimedAt);
  tick(1000);
  board.heartbeat(l, t0.taskId, t0.claimId, "review");
  const reviewAt = at(t0.taskId);
  assert.equal(reviewAt, claimedAt + 2000);
  tick(1000);
  board.heartbeat(l, t0.taskId, t0.claimId, "review");
  assert.equal(at(t0.taskId), reviewAt);
  tick(1000);
  board.mergeLock(l, t0.taskId, t0.claimId);
  board.reportMerged(l, t0.taskId, t0.claimId, merged(t0.number));
  assert.equal(at(t0.taskId), reviewAt + 2000);
  assert.ok(pub.storyId);
});

test("held keeps the column its stage gives", () => {
  const { board, c, be, linkOf, plBe, tick } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.heartbeat(l, t.taskId, t.claimId, "review");
  tick(700_000);
  const card = cardsOf(board, plBe).find((x) => x.taskId === t.taskId);
  assert.deepEqual([card.state, card.column], ["held", "review"]);
});

test("migrated rows fall back to claimed or created time", () => {
  const ctx = opened();
  const { db, board, c, be, linkOf, tick } = ctx;
  const l = linkOf(c, be);
  tick(5000);
  const t = board.claimNext(l);
  const claimedAt = db.prepare("SELECT claimed_at FROM hub_story_tasks WHERE id=?").get(t.taskId).claimed_at;
  db.exec("ALTER TABLE hub_story_tasks DROP COLUMN column_at; ALTER TABLE hub_story_tasks DROP COLUMN column_key;");
  const reopened = new StoryBoard(db, () => 9_999_999);
  const cols = db.prepare("PRAGMA table_info(hub_story_tasks)").all().map((x) => x.name);
  assert.ok(cols.includes("column_at") && cols.includes("column_key"));
  const rows = db.prepare("SELECT id,claimed_at,created_at,column_at FROM hub_story_tasks").all();
  for (const r of rows) assert.equal(r.column_at, r.claimed_at ?? r.created_at);
  assert.equal(rows.find((r) => r.id === t.taskId).column_at, claimedAt);
  const card = cardsOf(reopened, ctx.plBe).find((x) => x.taskId === t.taskId);
  assert.equal(card.columnAt, claimedAt);
});

test("board caps done at five and counts the rest", () => {
  const ctx = opened();
  const { board, pl, be, fe, plBe, linkOf, node, tick } = ctx;
  const extra = [];
  for (let i = 0; i < 4; i++) extra.push(node(`x${i}`, be, [`x${i}.ts`]));
  board.addTasks(plBe, ctx.pub.storyId, "more", { nodes: extra, edges: [] });
  const mergedIds = [];
  const lb = linkOf(ctx.c, be), lf = linkOf(ctx.b, fe);
  for (let i = 0; i < 7; i++) {
    tick(1000);
    const t = i === 1 ? finish(board, lf) : finish(board, lb); // ui needs api first
    mergedIds.push(t.taskId);
    if (i === 0) {
      // api merged: ui ready for fe
    }
  }
  const story = board.board(plBe, { mine: false, cancelled: false })[0].stories[0];
  const done = story.cards.filter((x) => x.column === "done");
  assert.equal(done.length, 5);
  assert.equal(story.doneMore, 2);
  assert.deepEqual(done.map((x) => x.taskId), mergedIds.slice(2).reverse());
  assert.ok(pl);
});

test("board hides cancelled unless asked", () => {
  const { board, plBe, pub } = opened();
  const task = board.story(plBe, pub.storyId).tasks.find((t) => t.nodeId === "copy");
  board.cancelTask(plBe, task.id);
  assert.equal(cardsOf(board, plBe).some((x) => x.taskId === task.id), false);
  const shown = cardsOf(board, plBe, { mine: false, cancelled: true }).find((x) => x.taskId === task.id);
  assert.equal(shown.column, "hidden");
  board.cancelStory(plBe, pub.storyId);
  assert.equal(board.board(plBe, { mine: false, cancelled: false }).flatMap((p) => p.stories).length, 0);
  assert.equal(board.board(plBe, { mine: false, cancelled: true }).flatMap((p) => p.stories).length, 1);
});

test("mine keeps my Stories and Stories with my cards", () => {
  const ctx = opened();
  const { board, b, c, be, fe, pl, plBe, linkOf, node, check } = ctx;
  const other = board.createProject(linkOf(b, fe), "다른", [{ repoId: fe, baseBranch: "main" }]);
  const pub2 = board.publishStory(linkOf(b, fe), {
    projectId: other.projectId, title: "B의 Story", body: "x", risk: "normal", key: "k2",
    graph: { nodes: [node("z", fe, ["z.ts"])], edges: [] }, storyVerify: [{ repoId: fe, checks: [check] }],
  });
  board.openStory(linkOf(b, fe), pub2.storyId);
  const titles = (member) => board.board({ member }, { mine: true, cancelled: false }).flatMap((p) => p.stories).map((s) => s.title).sort();
  assert.deepEqual(titles(pl), ["쿠폰 발급"]);
  assert.deepEqual(titles(c), []);
  board.claimNext(linkOf(c, be)); // C takes a card of the PL's Story
  assert.deepEqual(titles(c), ["쿠폰 발급"]);
  assert.equal(board.board({ member: c }, { mine: true, cancelled: false }).flatMap((p) => p.stories)[0].cards.length, 4);
  assert.deepEqual(titles(b), ["B의 Story"]);
  assert.deepEqual(board.board(plBe, { mine: false, cancelled: false }).flatMap((p) => p.stories).map((s) => s.title).sort(), ["B의 Story", "쿠폰 발급"]);
});

test("board query count does not grow with projects", () => {
  const count = (projects) => {
    let n = 0;
    const raw = new DatabaseSync(":memory:");
    const db = new Proxy(raw, {
      get: (t, k) => (k === "prepare" ? (sql) => (n++, t.prepare(sql)) : typeof t[k] === "function" ? t[k].bind(t) : t[k]),
    });
    let now = 1_000_000;
    const store = new HubStore(db, () => now);
    const board = new StoryBoard(db, () => now);
    const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
    const pl = store.acceptInvite(store.createInvite(admin, "PL"), "PL").member;
    const repo = store.addRepo(admin, "app-be", "git@github.example.com:team/app-be.git");
    store.addOwner(admin, repo, pl.id);
    const l = store.link(store.pair(store.createLinkCode(pl, repo), "https://github.example.com/team/app-be").token);
    const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
    for (let p = 0; p < projects; p++) {
      const { projectId } = board.createProject(l, `P${p}`, [{ repoId: repo, baseBranch: "main" }]);
      for (let s = 0; s < 3; s++) {
        const nodes = [0, 1, 2, 3].map((i) => ({ id: `n${i}`, repoId: repo, title: `n${i}`, spec: "s", files: [`f${i}.ts`], verify: [check] }));
        const pub = board.publishStory(l, { projectId, title: `S${p}-${s}`, body: "b", risk: "normal", key: `k${p}-${s}`, graph: { nodes, edges: [] }, storyVerify: [{ repoId: repo, checks: [check] }] });
        board.openStory(l, pub.storyId);
      }
    }
    n = 0;
    const out = board.board({ member: pl }, { mine: false, cancelled: false });
    assert.equal(out.length, projects);
    return n;
  };
  assert.equal(count(5), count(1));
});

test("currentTasks maps a member to the Task they hold", () => {
  const { board, c, be, linkOf } = opened();
  assert.equal(board.currentTasks().size, 0);
  const t = board.claimNext(linkOf(c, be));
  const cur = board.currentTasks().get(c.id);
  assert.deepEqual([cur.taskId, cur.number, cur.title, typeof cur.storyNumber], [t.taskId, t.number, t.title, "number"]);
});

test("macBadges returns the newest Mac per member", () => {
  const { db, store, pl, b, c, tick } = setup();
  const add = (member, id, createdAt, lastSeen, state) =>
    db.prepare("INSERT INTO hub_macs(id,member_id,name,token_hash,created_at,state,last_seen) VALUES (?,?,?,?,?,?,?)").run(id, member.id, id, id, createdAt, state, lastSeen);
  const now = 1_000_000;
  add(pl, "m-old", now - 5000, now - 10, "idle");
  add(pl, "m-new", now - 1000, now - 10, "working");
  add(b, "m-b", now - 1000, now - 180_001, "idle");
  tick(0);
  const badges = store.macBadges();
  assert.deepEqual(badges.get(pl.id), { state: "working", lastSeen: now - 10 });
  assert.deepEqual(badges.get(b.id), { state: "off", lastSeen: now - 180_001 });
  assert.equal(badges.has(c.id), false);
});
