import test from "node:test";
import assert from "node:assert/strict";
import { tone } from "../src/hub/pages.ts";
import { startTestHub } from "./hub-fixture.mjs";

const PR = "https://github.example.com/team/app-be/pull/7";
const SHA = "c0ffee".padEnd(40, "0");
const EVIL = "<img src=x onerror=alert(1)>";
const SAFE = "&#60;img src=x onerror=alert(1)&#62;";
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const H = "a".repeat(32);
const DEV = '<details class="dev"><summary>개발 정보</summary>';
/** The page without the folded developer details. */
const outside = (html) => html.replace(/<details class="dev">[\s\S]*?<\/details>/g, "");

async function team(t) {
  const h = await startTestHub(t);
  const { store, board, call, enter } = h;
  const signIn = async (raw) => {
    const w = await enter(raw);
    return { ...w, member: store.session(w.cookie.split("=")[1]).member };
  };
  const admin = await signIn(store.bootstrapAdmin());
  const pl = await signIn(store.createInvite(admin.member, "PL"));
  const c = await signIn(store.createInvite(admin.member, "C"));
  const be = store.addRepo(admin.member, "app-be", "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin.member, "app-fe", "git@github.example.com:team/app-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [c, be]]) store.addOwner(admin.member, r, m.member.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe" };
  const linkOf = (who, r) => store.link(store.pair(store.createLinkCode(who.member, r), remote[r]).token);
  const get = (path, who) => call("GET", path, { cookie: who.cookie });
  return { ...h, admin, pl, c, be, fe, linkOf, get };
}
function story(h, { assumptions = ["ASSUMED: 쿠폰 코드는 대문자"] } = {}) {
  const plBe = h.linkOf(h.pl, h.be);
  const { projectId } = h.board.createProject(plBe, "쿠폰 개편", [{ repoId: h.be, baseBranch: "main" }]);
  const node = (id, files) => ({ id, repoId: h.be, title: `${id} 작업`, spec: `${id} 설명`, files, verify: [check] });
  const pub = h.board.publishStory(plBe, {
    projectId, title: "쿠폰 발급", body: "# Story\n본문", risk: "normal", key: "k1",
    graph: { nodes: [node("api", ["src/api.ts"]), node("copy", ["README.md"])], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(plBe, pub.storyId);
  return { storyId: pub.storyId, api: pub.tasks.find((x) => x.nodeId === "api").taskId, copy: pub.tasks.find((x) => x.nodeId === "copy").taskId, plBe, assumptions };
}

test("tone maps each kind's states to need, run, stop or done", () => {
  for (const [state, want] of [["failed", "stop"], ["held", "stop"], ["claimed", "run"], ["waiting", "run"], ["ready", "run"], ["merged", "done"], ["passed", "done"], ["cancelled", "done"]]) assert.equal(tone("task", state), want, `task ${state}`);
  for (const [state, want] of [["draft", "run"], ["open", "run"], ["verifying", "run"], ["awaiting_g4", "need"], ["done", "done"], ["cancelled", "done"]]) assert.equal(tone("story", state), want, `story ${state}`);
  for (const [state, want] of [["questions", "need"], ["draft", "need"], ["awaiting_g3", "need"], ["queued", "run"], ["design", "run"], ["splitting", "run"], ["failed", "stop"], ["open", "done"], ["cancelled", "done"]]) assert.equal(tone("plan", state), want, `plan ${state}`);
});

test("story page folds developer details and colors the Task pills", async (t) => {
  const h = await team(t);
  const s = story(h);
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  h.board.reportMerged(cBe, api.taskId, api.claimId, { prUrl: PR, mergeCommit: SHA, summary: "s", assumptions: [] });
  const page = (await h.get(`/stories/${s.storyId}`, h.pl)).text;
  assert.ok(page.includes(`${DEV}<h3>Story base</h3>`), "the folded details");
  const first = outside(page);
  assert.ok(!first.includes("feature/story-") && !first.includes(PR), "no branch or PR outside the fold");
  assert.ok(page.includes(PR) && page.includes("feature/story-"), "both inside it");
  assert.match(page, /<span class="pill done">완료<\/span>/);
  assert.match(page, /<span class="pill run">할 일<\/span>/);
});

test("task page folds PR, merge commit, files and checks; the summary stays outside", async (t) => {
  const h = await team(t);
  const s = story(h);
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  h.board.reportMerged(cBe, api.taskId, api.claimId, { prUrl: PR, mergeCommit: SHA, summary: "요약 본문", assumptions: [] });
  const page = (await h.get(`/tasks/${s.api}`, h.pl)).text;
  const first = outside(page);
  assert.ok(first.includes("<h3>요약</h3><pre>요약 본문</pre>"));
  for (const hidden of [PR, SHA.slice(0, 12), "src/api.ts", "머지 커밋"]) assert.ok(!first.includes(hidden), `${hidden} is folded`);
  assert.ok(page.includes(`${DEV}<p>PR <a href="${PR}"`));
  assert.ok(page.includes(`${DEV}<h3>만질 파일</h3><ul><li><code>src/api.ts</code></li></ul></details>`));
  assert.ok(page.includes(`<code>${SHA.slice(0, 12)}</code>`) && !page.includes(SHA));
});

test("assumed lines read as decided by AI", async (t) => {
  const h = await team(t);
  const s = story(h);
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  h.board.reportMerged(cBe, api.taskId, api.claimId, { prUrl: PR, mergeCommit: SHA, summary: "s", assumptions: [`ASSUMED: ${EVIL}`, "기존 형식 유지"] });
  const page = (await h.get(`/tasks/${s.api}`, h.pl)).text;
  assert.ok(page.includes(`<li>AI가 정한 것: ${SAFE}</li><li>기존 형식 유지</li>`));
  assert.ok(!page.includes("ASSUMED") && !page.includes("판단 기록"));
});

test("approval records use plain names and plan pills carry tone", async (t) => {
  const h = await team(t);
  const plBe = h.linkOf(h.pl, h.be);
  const { projectId } = h.board.createProject({ member: h.pl.member }, "쿠폰 개편", [{ repoId: h.be, baseBranch: "main" }]);
  const id = h.plans.createPlan(h.pl.member, { projectId, title: "쿠폰", intent: "발급", risk: "high" }).planId;
  const lease = () => h.plans.next(plBe, H);
  const post = (r) => { const l = lease(); return h.plans.result(plBe, H, id, l.leaseId, l.revision, r); };
  const view = () => h.plans.plan({ member: h.pl.member }, id);
  const page = async () => (await h.get(`/plans/${id}`, h.pl)).text;
  assert.match(await page(), /<span class="pill run">기획 대기<\/span>/);
  post({ kind: "draft", text: "# Story\n", story: { title: "쿠폰" } });
  assert.match(await page(), /<span class="pill need">초안<\/span>/);
  h.plans.approve(h.pl.member, id, "G1", view().revision, view().draft.hash);
  post({ kind: "design", text: "# 설계", split: { tasks: [] } });
  assert.match(await page(), /<span class="pill need">설계 승인 대기<\/span>/);
  h.plans.approve(h.pl.member, id, "G3", view().revision, view().design.hash);
  const text = await page();
  assert.ok(text.includes("초안 승인(G1): PL") && text.includes("설계 승인(G3): PL"));
  assert.ok(!text.includes("G1 승인"));
});

test("pills on the board and /me carry tone classes", async (t) => {
  const h = await team(t);
  const s = story(h);
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  assert.ok(h.board.claimNext(s.plBe), "the PL takes the other Task");
  const board = (await h.get("/", h.pl)).text;
  assert.match(board, /<span class="pill stop">멈춤\(실패\)<\/span>/);
  assert.match(board, /<span class="pill run">진행 중<\/span>/);
  assert.match((await h.get("/me", h.c)).text, /<span class="pill (stop|run)">/);
  assert.ok(s.storyId);
});
