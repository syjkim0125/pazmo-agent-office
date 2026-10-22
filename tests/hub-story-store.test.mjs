import test from "node:test";
import assert from "node:assert/strict";
import { setup, opened } from "./hub-story-fixture.mjs";
const states = (board, l, storyId) => Object.fromEntries(board.story(l, storyId).tasks.map((t) => [t.nodeId, t.state]));

test("publish numbers story then tasks then verify, as a draft", () => {
  const { board, pl, be, fe, linkOf, node, check } = setup();
  const l = linkOf(pl, be);
  const { projectId } = board.createProject(l, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "main" }]);
  const pub = board.publishStory(l, { projectId, title: "쿠폰 발급", body: "# S", risk: "normal", key: "k", graph: { nodes: [node("api", be, ["a"]), node("ui", fe, ["b"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }] });
  assert.equal(pub.number, 1);
  assert.deepEqual(pub.tasks.map((t) => [t.nodeId, t.number]), [["api", 2], ["ui", 3], ["story-verify", 4]]);
  const v = board.story(l, pub.storyId);
  assert.equal(v.state, "draft");
  assert.deepEqual(v.branches.map((x) => x.storyBase), ["feature/story-1/base", "feature/story-1/base"]);
  assert.equal(v.tasks.find((t) => t.nodeId === "api").branch, "feature/story-1/task-2");
  assert.deepEqual(v.tasks.find((t) => t.kind === "verify").deps, [2, 3]);
  assert.equal(board.publishStory(l, { projectId, title: "x", body: "x", risk: "normal", key: "k", graph: { nodes: [node("z", be, ["z"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }] }).already, true);
});
test("the fingerprint covers the graph and the story verification, whatever order they come in", () => {
  const { db, board, pl, be, fe, linkOf, node, check } = setup();
  const l = linkOf(pl, be);
  const { projectId } = board.createProject(l, "p", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "main" }]);
  const lint = { id: "V2", argv: ["npm", "run", "lint"], timeoutMs: 60000 };
  const api = node("api", be, ["a"]), ui = node("ui", fe, ["b"]);
  const publish = (key, nodes, storyVerify) =>
    board.publishStory(l, { projectId, title: "t", body: "b", risk: "normal", key, graph: { nodes, edges: [] }, storyVerify }).storyId;
  const fp = (id) => db.prepare("SELECT fingerprint FROM hub_stories WHERE id=?").get(id).fingerprint;
  const sv = [{ repoId: be, checks: [check] }, { repoId: fe, checks: [lint] }];
  const one = publish("one", [api, ui], sv);
  assert.equal(fp(publish("reordered", [ui, api], [sv[1], sv[0]])), fp(one));
  assert.notEqual(fp(publish("other-verify", [api, ui], [{ repoId: be, checks: [check] }, { repoId: fe, checks: [check] }])), fp(one));
  // Tasks added later hash with the same story verification as a Story published whole.
  const later = publish("later", [api], sv);
  board.openStory(l, later);
  board.addTasks(l, later, "add-ui", { nodes: [ui], edges: [] });
  assert.equal(fp(later), fp(one));
});
test("open readies only tasks without dependencies; only the PL opens", () => {
  const ctx = setup();
  const { board, b, fe, linkOf } = ctx;
  const { plBe, pub } = opened(ctx);
  assert.deepEqual(states(board, plBe, pub.storyId), { api: "ready", ui: "waiting", copy: "ready", "story-verify": "waiting" });
  assert.throws(() => board.openStory(linkOf(b, fe), pub.storyId), (e) => e.code === "FORBIDDEN"); // 권한이 상태보다 먼저
});
test("project and graph refusals", () => {
  const { board, pl, be, linkOf, node, check } = setup();
  const l = linkOf(pl, be);
  assert.throws(() => board.createProject(l, " ", [{ repoId: be, baseBranch: "main" }]), (e) => e.code === "INVALID");
  assert.throws(() => board.createProject(l, "p", [{ repoId: be, baseBranch: "feature/story-1/base" }]), (e) => e.code === "INVALID");
  const { projectId } = board.createProject(l, "p", [{ repoId: be, baseBranch: "main" }]);
  assert.throws(() => board.publishStory(l, { projectId, title: "t", body: "b", risk: "normal", key: "k", graph: { nodes: [node("a", "nope", ["x"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }] }), (e) => e.code === "GRAPH_REPO" && e.status === 400);
});
test("append: reopens a done story and resets verify; overlap only against unfinished tasks", () => {
  const ctx = opened();
  const { db, board, plBe, pub, be, node } = ctx;
  // 테스트용으로 상태를 직접 만든다: 작업 Task 전부 merged, 검증 passed, Story done
  db.prepare("UPDATE hub_story_tasks SET state=CASE kind WHEN 'verify' THEN 'passed' ELSE 'merged' END WHERE story_id=?").run(pub.storyId);
  db.prepare("UPDATE hub_stories SET state='done' WHERE id=?").run(pub.storyId);
  const add = board.addTasks(plBe, pub.storyId, "fb1", { nodes: [node("fix", be, ["src/api.ts"])], edges: [{ from: "api", to: "fix" }] });
  assert.equal(add.tasks[0].number, 6); // story 1, api 2, ui 3, copy 4, verify 5
  const v = board.story(plBe, pub.storyId);
  assert.equal(v.state, "open");
  assert.equal(v.tasks.find((t) => t.kind === "verify").state, "waiting");
  assert.equal(v.tasks.find((t) => t.kind === "verify").number, 5);
  assert.deepEqual(v.tasks.find((t) => t.kind === "verify").deps, [2, 3, 4, 6]);
  assert.equal(board.addTasks(plBe, pub.storyId, "fb1", { nodes: [], edges: [] }).already, true);
});
test("append refuses overlap with an unmerged task and refuses while verifying", () => {
  const { db, board, plBe, pub, be, node } = opened();
  assert.throws(() => board.addTasks(plBe, pub.storyId, "a", { nodes: [node("x", be, ["src/api.ts"])], edges: [] }), (e) => e.code === "GRAPH_OVERLAP");
  db.prepare("UPDATE hub_stories SET state='verifying' WHERE id=?").run(pub.storyId);
  assert.throws(() => board.addTasks(plBe, pub.storyId, "b", { nodes: [node("y", be, ["other"])], edges: [] }), (e) => e.code === "STATE");
});
test("cancel story cancels unfinished tasks; any member can read", () => {
  const { board, plBe, pub, b, fe, linkOf } = opened();
  board.cancelStory(plBe, pub.storyId);
  const v = board.story(linkOf(b, fe), pub.storyId);
  assert.equal(v.state, "cancelled");
  assert.ok(v.tasks.every((t) => t.state === "cancelled"));
  assert.equal(v.isPl, false);
});
