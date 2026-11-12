import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";
import { AWAITING_G4, HELD_SHORT, plainFailure } from "../src/hub/story-pages.ts";
import { safePath } from "../src/hub/paths.ts";
import { planStoryKey } from "../src/hub/plan-protocol.ts";
import { kitStoryHash } from "../src/core/kit-role-runs.ts";

const SHA = "c0ffee".padEnd(40, "0");
const PR = "https://github.example.com/team/app-be/pull/7";
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const merged = () => ({ prUrl: PR, mergeCommit: SHA, summary: "s", assumptions: [] });
const EVIL = "<img src=x onerror=alert(1)>";
const COLUMNS = ["백로그", "할 일", "진행 중", "리뷰", "완료"];

/**
 * A LAN hub with a Story board and plans, PL owning app-be and app-fe, B owning app-fe, C owning app-be, every member signed in.
 * `skew`/`macSkew` move the board's and the member store's clocks, so a test can age a card or a Mac beat without waiting.
 */
async function team(t, { names = {}, text = (s) => s, plans = true } = {}) {
  const clock = { board: 0, store: 0 };
  const h = await startTestHub(t, { now: () => Date.now() + clock.board, storeNow: () => Date.now() + clock.store, plans });
  const { store, board, call, enter } = h;
  const signIn = async (raw) => {
    const w = await enter(raw);
    return { ...w, member: store.session(w.cookie.split("=")[1]).member };
  };
  const admin = await signIn(store.bootstrapAdmin());
  const join = (name) => signIn(store.createInvite(admin.member, name));
  const pl = await join(names.pl ?? "PL"), b = await join(names.b ?? "B"), c = await join(names.c ?? "C");
  const be = store.addRepo(admin.member, "app-be", "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin.member, "app-fe", "git@github.example.com:team/app-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [b, fe], [c, be]]) store.addOwner(admin.member, r, m.member.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe" };
  const linkOf = (who, r) => store.link(store.pair(store.createLinkCode(who.member, r), remote[r]).token);
  const plBe = linkOf(pl, be);
  const { projectId } = board.createProject(plBe, text("쿠폰 개편"), [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]);
  let n = 0;
  /** Publishes and opens a Story whose Tasks are `ids` (one file each, all in app-be, no edges). */
  const publish = (title, ids) => {
    const key = `k${++n}`;
    const pub = board.publishStory(plBe, {
      projectId, title: text(title), body: "# Story", risk: "normal", key,
      graph: { nodes: ids.map((id) => ({ id, repoId: be, title: text(`${id} 작업`), spec: `${id} 설명`, files: [`src/${key}-${id}.ts`], verify: [check] })), edges: [] },
      storyVerify: [{ repoId: be, checks: [check] }],
    });
    const tasks = Object.fromEntries(ids.map((id) => [id, pub.tasks.find((x) => x.nodeId === id).taskId]));
    return { ...pub, tasks, verify: pub.tasks.at(-1).taskId };
  };
  const open = (s) => (board.openStory(plBe, s.storyId), s);
  const pair = (who, name = "내 Mac") => {
    const started = store.startMac(name);
    store.approveMac(who.member, started.userCode);
    return store.mac(store.pollMac(started.deviceCode).macToken);
  };
  const get = (path, who) => call("GET", path, { cookie: who.cookie });
  const post = (path, who, body, headers = {}) =>
    call("POST", path, { cookie: who.cookie, body: `csrf=${who.csrf}${body ? `&${body}` : ""}`, headers: { origin: h.hub.url, ...headers } });
  return { ...h, clock, admin, pl, b, c, be, fe, plBe, projectId, linkOf, publish, open, pair, get, post, cBe: () => linkOf(c, be) };
}
/** Drives a one-Task Story as the PL to `to`: "verifying", "awaiting_g4" or "done". */
const advance = (h, s, to) => {
  const tk = h.board.claimNext(h.plBe);
  h.board.mergeLock(h.plBe, tk.taskId, tk.claimId);
  h.board.reportMerged(h.plBe, tk.taskId, tk.claimId, merged());
  const v = h.board.claimVerify(h.plBe, s.storyId);
  if (to === "verifying") return;
  h.board.reportVerify(h.plBe, v.taskId, v.claimId, { passed: true, summary: "ok" });
  if (to === "done") h.board.completeStory(h.plBe, s.storyId);
};
const laneOf = (html, number) => {
  const start = html.indexOf(`data-story="${number}"`);
  assert.ok(start >= 0, `lane for Story #${number}`);
  const end = html.indexOf('data-story="', start + 10);
  return html.slice(start, end < 0 ? undefined : end);
};
const colOf = (lane, name) => {
  const m = new RegExp(`<div class="col" data-col="${name}">([\\s\\S]*?)</ul></div>`).exec(lane);
  assert.ok(m, `column ${name}`);
  return m[1];
};

// D43: the Task board (D42's board) moved from / to /tasks; / is the Story board (tests near the end).
test("/tasks is the Task board with five columns per Story", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a", "b", "c", "d"]));
  const c = h.cBe();
  const done = h.board.claimNext(c);
  h.board.mergeLock(c, done.taskId, done.claimId);
  h.board.reportMerged(c, done.taskId, done.claimId, merged());
  const doing = h.board.claimNext(c);
  h.board.heartbeat(c, doing.taskId, doing.claimId, "build");
  const page = await h.get("/tasks", h.c);
  assert.equal(page.status, 200);
  for (const name of COLUMNS) assert.ok(page.text.includes(`>${name}<`), name);
  const lane = laneOf(page.text, s.number);
  assert.ok(colOf(lane, "done").includes(`/tasks/${done.taskId}`), "merged card in 완료");
  assert.ok(colOf(lane, "doing").includes(`/tasks/${doing.taskId}`), "claimed card in 진행 중");
  const rest = Object.values(s.tasks).filter((id) => ![done.taskId, doing.taskId].includes(id));
  for (const id of rest) assert.ok(colOf(lane, "todo").includes(`/tasks/${id}`), "ready cards in 할 일");
  h.board.heartbeat(c, doing.taskId, doing.claimId, "review");
  const again = laneOf((await h.get("/tasks", h.c)).text, s.number);
  assert.ok(colOf(again, "review").includes(`/tasks/${doing.taskId}`), "review stage moves the card");
  assert.ok(!colOf(again, "doing").includes(doing.taskId));
});

test("backlog holds a Task that waits for another", async (t) => {
  const h = await team(t);
  const pub = h.board.publishStory(h.plBe, {
    projectId: h.projectId, title: "순서", body: "# Story", risk: "normal", key: "dep",
    graph: {
      nodes: ["x", "y"].map((id) => ({ id, repoId: h.be, title: `${id} 작업`, spec: id, files: [`src/${id}.ts`], verify: [check] })),
      edges: [{ from: "x", to: "y" }],
    },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  const lane = laneOf((await h.get("/tasks", h.c)).text, pub.number);
  assert.ok(colOf(lane, "backlog").includes(pub.tasks.find((x) => x.nodeId === "y").taskId));
  assert.ok(colOf(lane, "todo").includes(pub.tasks.find((x) => x.nodeId === "x").taskId));
});

test("card shows assignee, Mac state and time in column", async (t) => {
  const h = await team(t, { names: { c: "에이" } });
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const mac = h.pair(h.c);
  h.clock.board = -360_000;
  const claim = h.board.claimNext(h.cBe());
  h.board.heartbeat(h.cBe(), claim.taskId, claim.claimId, "build");
  h.clock.board = 0;
  h.store.macHeartbeat(mac, "working", null);
  let card = colOf(laneOf((await h.get("/tasks", h.pl)).text, s.number), "doing");
  assert.match(card, /에이/);
  assert.match(card, /일하는 중/);
  assert.match(card, /6분째/);
  h.clock.store = -240_000;
  h.store.macHeartbeat(mac, "working", null);
  h.clock.store = 0;
  card = colOf(laneOf((await h.get("/tasks", h.pl)).text, s.number), "doing");
  assert.match(card, /꺼짐\(4분 전\)/);
});

test("story card shows state, PL and who works now; planners get 새 Story", async (t) => {
  const h = await team(t, { names: { pl: "리더", c: "에이" } });
  const done = h.open(h.publish("끝난 Story", ["a"]));
  advance(h, done, "done");
  const g4 = h.open(h.publish("승인 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  const ver = h.open(h.publish("검증 Story", ["a"]));
  advance(h, ver, "verifying");
  h.board.reportVerify(h.plBe, h.board.inbox(h.plBe).mine.taskId, h.board.inbox(h.plBe).mine.claimId, { passed: false, summary: "x" });
  h.board.releaseTask({ member: h.pl.member }, ver.verify);
  h.board.claimVerify(h.plBe, ver.storyId);
  const open = h.open(h.publish("열린 Story", ["a", "b"]));
  const c = h.cBe();
  h.board.claimNext(c);
  const text = (await h.get("/", h.c)).text;
  const words = [[done, "완료"], [g4, "승인 대기"], [ver, "검증 중"], [open, "진행 중"]];
  for (const [s, word] of words) {
    const lane = laneOf(text, s.number);
    assert.ok(lane.includes(word), `#${s.number} says ${word}`);
    assert.ok(lane.includes("리더"), "PL name");
    assert.ok(lane.includes(`/stories/${s.storyId}`), "story link");
  }
  assert.ok(laneOf(text, open.number).includes("에이"), "C works on a Task of the open Story");
  assert.equal((laneOf(text, open.number).match(/에이/g) ?? []).length >= 1, true);
  // U41: the whole state word is "검증 중" (not "Story 검증 중") on the card, the /tasks lane and the Story page.
  const word = '<span class="pill run">검증 중</span>';
  assert.ok(laneOf(text, ver.number).includes(`<p>${word}`), "the card");
  assert.ok(laneOf((await h.get("/tasks", h.c)).text, ver.number).includes(`</a>${word}`), "the /tasks lane");
  assert.ok((await h.get(`/stories/${ver.storyId}`, h.c)).text.includes(`<p>${word}</p>`), "the Story page");
  assert.ok((await h.get("/", h.pl)).text.includes(`/projects/${h.projectId}/new-story`), "PL owns every repo");
  assert.ok(!(await h.get("/", h.c)).text.includes(`/projects/${h.projectId}/new-story`), "C does not own app-fe");
  assert.ok(text.includes('href="/projects/new"'), "새 프로젝트");
});

test("stopped card stays in its column with a plain reason", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.heartbeat(c, claim.taskId, claim.claimId, "review");
  h.board.reportFailed(c, claim.taskId, claim.claimId, "RUNNER_LIMIT claude: usage limit");
  const review = colOf(laneOf((await h.get("/tasks", h.pl)).text, s.number), "review");
  assert.ok(review.includes(`/tasks/${claim.taskId}`));
  assert.ok(review.includes("멈춤"));
  assert.ok(review.includes(plainFailure("RUNNER_LIMIT claude: usage limit", "work")));
});

test("planning lanes", async (t) => {
  const h = await team(t);
  const plan = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "새 기획", intent: "쿠폰을 더 쉽게 쓰게 하고 싶다", risk: "normal" });
  const draft = h.publish("올리기 전 Story", ["a"]);
  const text = (await h.get("/", h.pl)).text;
  assert.match(text, /기획 중/);
  assert.ok(text.includes(`href="/plans/${plan.planId}"`));
  assert.ok(text.includes(`href="/stories/${draft.storyId}"`));
  assert.ok(text.includes("새 기획"));
  // U41: a Story not opened yet says the same on its draft card and its page: its Tasks are ready, no bar.
  assert.ok(text.includes(`<p class="sprog">Task 2개 준비됨</p>`), "the draft card");
  const page = (await h.get(`/stories/${draft.storyId}`, h.pl)).text;
  assert.ok(page.includes(`<p class="sprog">Task 2개 준비됨</p>`), "the Story page");
  assert.ok(!page.includes("<progress"), "no bar before it opens");
});

test("a web-planned Story and an uploaded Story share one board", async (t) => {
  const h = await team(t);
  const task = (id, file) => ({ id, repoId: h.be, title: `${id} 작업`, spec: `${id} 설명`, files: [file], verify: [check] });
  // Web plan: the PL plans on the web, the PL's Office drafts, the PL approves G1 on the web, and the Office publishes
  // the plan's Story under the plan key, opens it and reports it open.
  const HOLDER = "a".repeat(32);
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "웹 기획 Story", intent: "쿠폰을 웹에서 기획한다", risk: "normal" }).planId;
  const lease = () => {
    const l = h.plans.next(h.plBe, HOLDER);
    assert.equal(l?.plan.id, planId, "the PL's plan");
    return l;
  };
  let l = lease();
  h.plans.result(h.plBe, HOLDER, planId, l.leaseId, l.revision, { kind: "draft", text: "# Story: 웹 기획 Story\n", story: { title: "웹 기획 Story" } });
  const v = h.plans.plan({ member: h.pl.member }, planId);
  h.plans.approve(h.pl.member, planId, "G1", v.revision, v.draft.hash);
  l = lease();
  const web = h.board.publishStory(h.plBe, {
    projectId: h.projectId, title: "웹 기획 Story", body: "# Story: 웹 기획 Story\n", risk: "normal", key: planStoryKey(planId),
    graph: { nodes: [task("web", "src/web.ts")], edges: [] }, storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, web.storyId);
  h.plans.result(h.plBe, HOLDER, planId, l.leaseId, l.revision, { kind: "open", storyId: web.storyId });
  // Local upload: the PL's current Mac sends a locally approved Story through the upload route (its app-fe link: the
  // PL's app-be is held by the connection string the web plan's Office used).
  const token = h.store.macLink(h.pair(h.pl, "PL Mac"), h.fe).token;
  const body = "# Story: 올린 Story\n\n## MUST\n- M1. 올린다.\n";
  const sent = await h.api("POST", "/api/link/story/upload", {
    token, protocol: "3",
    body: { projectId: h.projectId, title: "올린 Story", body, risk: "normal", storyHash: kitStoryHash(body), graph: { nodes: [task("up", "src/up.ts")], edges: [] }, storyVerify: [{ repoId: h.be, checks: [check] }] },
  });
  assert.equal(sent.status, 200, sent.text);
  const up = sent.json;
  const cardOf = (s, nodeId) => h.board.story({ member: h.pl.member }, s.storyId).tasks.find((x) => x.nodeId === nodeId).id;
  // Before it opens, the uploaded Story waits in 기획 중 beside the opened web-planned lane.
  let text = (await h.get("/tasks", h.pl)).text;
  const planning = /<article class="lane"><h3>기획 중<\/h3>([\s\S]*?)<\/article>/.exec(text)?.[1] ?? "";
  assert.ok(planning.includes(`href="/stories/${up.storyId}"`), "the uploaded draft is in 기획 중");
  assert.ok(colOf(laneOf(text, web.number), "todo").includes(`/tasks/${cardOf(web, "web")}`));
  // Opened, both are lanes of the same project with their cards, for the PL and for a teammate.
  assert.equal((await h.api("POST", "/api/link/story/open", { token, protocol: "3", body: { storyId: up.storyId } })).status, 200);
  for (const who of [h.pl, h.c]) {
    text = (await h.get("/tasks", who)).text;
    const project = /<section class="project">[\s\S]*?<\/section>/.exec(text)[0];
    for (const [s, nodeId] of [[web, "web"], [up, "up"]]) {
      const lane = laneOf(project, s.number);
      assert.ok(lane.includes(`href="/stories/${s.storyId}"`), `#${s.number} lane`);
      assert.ok(colOf(lane, "todo").includes(`/tasks/${cardOf(s, nodeId)}`), `#${s.number} card`);
    }
  }
  assert.ok((await h.get(`/stories/${up.storyId}`, h.c)).text.includes("로컬 승인 · PL Mac"), "the uploaded one carries its local approval");
});

test("mine and cancelled toggles are links", async (t) => {
  const h = await team(t);
  const one = h.open(h.publish("PL의 Story", ["a"]));
  const claim = h.board.claimNext(h.cBe());
  assert.ok(claim);
  const all = (await h.get("/", h.b)).text;
  assert.ok(all.includes('href="/?mine=1"'));
  assert.ok(all.includes('href="/?cancelled=1"'));
  assert.ok(all.includes(`data-story="${one.number}"`));
  const mine = await h.get("/?mine=1", h.b);
  assert.ok(!mine.text.includes(`data-story="${one.number}"`), "B leads nothing and holds nothing");
  assert.doesNotMatch(mine.text, /<h2>쿠폰 개편/, "a project with no lanes is hidden");
  assert.match(mine.text, /aria-current="true"[^>]*>[^<]*내 Story만/);
  const cs = await h.get("/?mine=1", h.c);
  assert.ok(cs.text.includes(`data-story="${one.number}"`), "C holds a Task of it");
  h.board.cancelStory({ member: h.pl.member }, one.storyId);
  assert.ok(!(await h.get("/", h.c)).text.includes(`data-story="${one.number}"`));
  const shown = await h.get("/?cancelled=1", h.c);
  assert.ok(shown.text.includes(`data-story="${one.number}"`));
  assert.match(shown.text, /aria-current="true"[^>]*>[^<]*취소/);
  assert.equal((await h.get("/board", h.c)).status, 200);
});

test("cancelled cards show in a strip only with the toggle", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a", "b"]));
  h.board.cancelTask({ member: h.pl.member }, s.tasks.b);
  const strip = (lane) => /<div class="cancelled">([\s\S]*?)<\/ul><\/div>/.exec(lane)?.[1] ?? null;
  // Off: the cancelled Task is nowhere on the board.
  const plain = laneOf((await h.get("/tasks", h.c)).text, s.number);
  assert.ok(!plain.includes(`/tasks/${s.tasks.b}`), "hidden by default");
  assert.equal(strip(plain), null, "no strip without the toggle");
  assert.ok(colOf(plain, "todo").includes(`/tasks/${s.tasks.a}`));
  // On: it shows in the lane's muted 취소됨 strip under the five columns, linking to its Task page, and in no column.
  const shown = laneOf((await h.get("/tasks?cancelled=1", h.c)).text, s.number);
  const cancelled = strip(shown);
  assert.ok(cancelled, "a 취소됨 strip");
  assert.match(cancelled, /취소됨/);
  assert.ok(cancelled.includes(`href="/tasks/${s.tasks.b}"`));
  assert.ok(!cancelled.includes(s.tasks.a), "a live card stays in its column");
  assert.ok(shown.indexOf('class="cancelled"') > shown.lastIndexOf('class="col"'), "under the five columns");
  for (const name of ["backlog", "todo", "doing", "review", "done"]) assert.ok(!colOf(shown, name).includes(s.tasks.b), name);
  // A cancelled Story's lane comes back with every card it cancelled.
  h.board.cancelStory({ member: h.pl.member }, s.storyId);
  assert.ok(!(await h.get("/tasks", h.c)).text.includes(`/tasks/${s.tasks.a}`));
  const story = strip(laneOf((await h.get("/tasks?cancelled=1", h.c)).text, s.number));
  for (const id of [s.tasks.a, s.tasks.b]) assert.ok(story.includes(`href="/tasks/${id}"`), id);
});

test("board escapes card text", async (t) => {
  const long = "가".repeat(120);
  const h = await team(t, { names: { pl: EVIL, c: EVIL }, text: (s) => `${EVIL}${s}` });
  h.open(h.publish(`${EVIL}${long}`, ["a"]));
  h.pair(h.c, EVIL);
  h.board.claimNext(h.cBe());
  const text = (await h.get("/tasks", h.pl)).text;
  assert.ok(text.includes("&#60;img"));
  assert.ok(!text.includes("<img"));
  assert.match(text, /overflow-wrap:anywhere/);
});

test("menu is board and team", async (t) => {
  const h = await team(t);
  const text = (await h.get("/", h.c)).text;
  const nav = /<nav>(.*?)<\/nav>/.exec(text)[1];
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["/", "/team"]);
  assert.ok(!text.includes('href="/requests"') || !nav.includes("/requests"));
  assert.ok(!nav.includes("내 Office 연결") && !nav.includes("요청 게시판"));
  assert.match(text, /action="\/me\/auto-work"/);
  assert.match(text, /내 Mac: /);
});

test("auto-work switch returns to the page it was pressed on", async (t) => {
  const h = await team(t);
  const team1 = await h.get("/team", h.c);
  assert.match(team1.text, /name="back" value="\/team"/);
  let res = await h.post("/me/auto-work", h.c, "on=0&back=%2Fteam");
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/team");
  res = await h.post("/me/auto-work", h.c, `on=1&back=${encodeURIComponent("https://evil.example/")}`);
  assert.equal(res.headers.location, "/");
  res = await h.post("/me/auto-work", h.c, "on=1");
  assert.equal(res.headers.location, "/");
});

test("old home lives at /me", async (t) => {
  const h = await team(t);
  h.open(h.publish("쿠폰 발급", ["a"]));
  const me = await h.get("/me", h.pl);
  assert.equal(me.status, 200);
  for (const w of ["지금 맡은 일", "받을 수 있는 일"]) assert.ok(me.text.includes(w), w);
  h.board.setAutoWork(h.c.member, false);
  h.cBe();
  assert.ok((await h.get("/me", h.c)).text.includes("작업하기"), "a ready Task C may pick");
});

test("team page for everyone", async (t) => {
  const h = await team(t, { names: { c: "에이" } });
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const mac = h.pair(h.c);
  h.store.macHeartbeat(mac, "working", null);
  const claim = h.board.claimNext(h.cBe());
  h.board.setAutoWork(h.pl.member, false);
  const page = await h.get("/team", h.b);
  assert.equal(page.status, 200);
  assert.match(page.text, /에이/);
  assert.match(page.text, /일하는 중/);
  assert.ok(page.text.includes(`href="/tasks/${claim.taskId}"`));
  assert.ok(page.text.includes(`Story #${s.number}`));
  // U40: each member is a name tag and their switch is a word with its own color, not a bare pill.
  assert.match(page.text, /<td><span class="person"><span class="av av[0-7]" aria-hidden="true">PL<\/span>PL<\/span><\/td>[\s\S]*?<span class="onoff off">꺼짐<\/span>/);
  assert.match(page.text, /<span class="mac on"><span class="dot" aria-hidden="true"><\/span>일하는 중<\/span>/, "C's Mac with its dot and word");
  assert.ok(!page.text.includes('href="/members"'), "not an admin");
  assert.ok((await h.get("/team", h.admin)).text.includes('href="/members"'));
  h.store.revokeMember(h.admin.member, h.b.member.id);
  assert.ok(!(await h.get("/team", h.admin)).text.includes(">B<"), "a revoked member is not listed");
});

test("old addresses still answer", async (t) => {
  const h = await team(t);
  for (const path of ["/requests", "/start", "/repos", "/board", "/me", "/team", "/mac"]) assert.equal((await h.get(path, h.c)).status, 200, path);
});

test("hub without a board is unchanged", async (t) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { HubStore } = await import("../src/hub/store.ts");
  const { startHubServer } = await import("../src/hub/server.ts");
  const { request } = await import("node:http");
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const hub = await startHubServer({ store, listen: { kind: "proxy", publicUrl: "https://pazmo-hub.apps.example.com", host: "127.0.0.1", port: 0 } });
  t.after(() => hub.close());
  const a = store.acceptInvite(store.bootstrapAdmin(), "x");
  const res = await new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: hub.port, path: "/", headers: { host: "pazmo-hub.apps.example.com", cookie: `pazmo_hub=${a.session}` } }, (r) => {
      let text = "";
      r.setEncoding("utf8");
      r.on("data", (c) => (text += c));
      r.on("end", () => resolve({ status: r.statusCode, text }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(res.status, 200);
  assert.match(res.text, /<h2>요청 게시판<\/h2>/);
  assert.match(res.text, /<a href="\/requests">요청 게시판<\/a>/);
  assert.doesNotMatch(res.text, /href="\/team"|자동으로 일하기/);
  const tasks = await new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: hub.port, path: "/tasks", headers: { host: "pazmo-hub.apps.example.com", cookie: `pazmo_hub=${a.session}` } }, (r) => {
      r.resume();
      r.on("end", () => resolve(r.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(tasks, 404, "no Task board without a board");
});

test("safePath keeps only known pages", () => {
  const id = "0123456789abcdef0123456789abcdef0123";
  for (const ok of ["/", "/board", "/tasks", "/me", "/team", "/mac", `/stories/${id}`, `/tasks/${id.replace(/./, "a")}`, `/plans/${id}`]) assert.equal(safePath(ok), ok, ok);
  for (const bad of [null, undefined, "", "x", "//evil", "/\\evil", "/board?x=1", "/stories/abc", "/%2Fevil", "/%2fevil", "/me\n", "/me\u0000", "https://evil.example/", `/${"a".repeat(300)}`, "/requests"])
    assert.equal(safePath(bad), null, String(bad));
});

// U40 (화면 다듬기): the board's look — a card's tone and name tag, the box of what waits on the viewer, a lane's
// progress, the current menu item, the header's switch and Mac chip, empty projects and the stylesheet's floor.
const needsOf = (text) => /<section class="needs" aria-labelledby="needs">([\s\S]*?)<\/section>/.exec(text)?.[1] ?? null;

test("a card wears its state: tone, name tag, Mac dot, time and number", async (t) => {
  const h = await team(t, { names: { c: "에이" } });
  const s = h.open(h.publish("쿠폰 발급", ["a", "b", "c"]));
  const c = h.cBe();
  const mac = h.pair(h.c);
  h.store.macHeartbeat(mac, "working", null);
  const first = h.board.claimNext(c);
  h.board.mergeLock(c, first.taskId, first.claimId);
  h.board.reportMerged(c, first.taskId, first.claimId, merged());
  const doing = h.board.claimNext(c);
  h.board.heartbeat(c, doing.taskId, doing.claimId, "build");
  let lane = laneOf((await h.get("/tasks", h.pl)).text, s.number);
  assert.match(colOf(lane, "doing"), new RegExp(`<li class="card run"><a class="title" href="/tasks/${doing.taskId}">b 작업</a><p><span class="pill run">진행 중\\(구현\\)</span></p>`));
  assert.match(
    colOf(lane, "doing"),
    /<p class="who"><span class="av av[0-7]" aria-hidden="true">에이<\/span><span>에이<\/span><span class="mac on"><span class="dot" aria-hidden="true"><\/span>일하는 중<\/span><span class="time">방금<\/span><\/p><p class="meta"><span class="num">#\d+<\/span> app-be<\/p><\/li>/,
  );
  assert.match(colOf(lane, "done"), new RegExp(`<li class="card done"><a class="title" href="/tasks/${first.taskId}">a 작업</a><p class="meta">`), "a merged card is quiet");
  assert.match(colOf(lane, "todo"), /<li class="card"><a class="title" href="\/tasks\/[^"]+">c 작업<\/a><p class="meta">/, "a card nobody holds has no tone");
  h.board.reportFailed(c, doing.taskId, doing.claimId, "RUNNER_LIMIT claude: usage limit");
  lane = laneOf((await h.get("/tasks", h.pl)).text, s.number);
  assert.match(colOf(lane, "doing"), new RegExp(`<li class="card stop"><a class="title" href="/tasks/${doing.taskId}">`));
  assert.ok(colOf(lane, "doing").includes(`<p class="why">${plainFailure("RUNNER_LIMIT claude: usage limit", "work")}</p>`));
});

test("나를 기다리는 일 lists what waits on the viewer, and is gone when nothing does", async (t) => {
  const h = await team(t);
  const g4 = h.open(h.publish("승인 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  assert.equal(claim.taskId, s.tasks.a);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "RUNNER_LIMIT claude: usage limit");
  const HOLDER = "b".repeat(32);
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "초안 기획", intent: "쿠폰 만료를 알리고 싶다", risk: "normal" }).planId;
  const l = h.plans.next(h.plBe, HOLDER);
  h.plans.result(h.plBe, HOLDER, planId, l.leaseId, l.revision, { kind: "draft", text: "# Story: 초안 기획\n", story: { title: "초안 기획" } });

  const pl = needsOf((await h.get("/", h.pl)).text);
  assert.ok(pl, "the PL has a box");
  assert.match(pl, /^<h2 id="needs">나를 기다리는 일 <span class="count">3<\/span><\/h2>/);
  // D44: each kind is one row (word, count, shared reason) with its titles as links.
  assert.ok(pl.includes(`<p class="ghead"><span class="pill need">승인 대기</span><span class="count">1</span><span class="gwhy">${AWAITING_G4}</span></p><p class="glinks"><a href="/stories/${g4.storyId}"><b>승인 Story</b></a></p>`), "the Story waiting for its result approval");
  assert.ok(pl.includes(`<p class="ghead"><span class="pill stop">멈춤(실패)</span><span class="count">1</span><span class="gwhy">${plainFailure("RUNNER_LIMIT claude: usage limit", "work")}</span></p><p class="glinks"><a href="/tasks/${claim.taskId}"><b>a 작업</b> <span class="muted">Story #${s.number}</span></a></p>`), "a stopped Task of the PL's Story");
  assert.ok(pl.includes(`<p class="ghead"><span class="pill need">초안</span><span class="count">1</span>`) && pl.includes(`<a href="/plans/${planId}"><b>초안 기획</b></a>`), "the PL's draft to read");

  const mine = needsOf((await h.get("/", h.c)).text);
  assert.ok(mine.includes(`href="/tasks/${claim.taskId}"`), "C holds the stopped Task");
  assert.ok(!mine.includes(g4.storyId) && !mine.includes(planId), "not C's Story or plan");
  assert.equal(needsOf((await h.get("/", h.b)).text), null, "nothing waits on B: no box");
  assert.ok(needsOf((await h.get("/?mine=1", h.pl)).text), "the box stays under 내 Story만");
});

test("a lane says how many of its Tasks are done", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a", "b", "c"]));
  let lane = laneOf((await h.get("/tasks", h.c)).text, s.number);
  assert.ok(lane.includes('<span class="progress"><progress value="0" max="4" aria-hidden="true"></progress>Task 4개 중 0개 끝</span>'), "three Tasks and the Story check");
  const c = h.cBe();
  const one = h.board.claimNext(c);
  h.board.mergeLock(c, one.taskId, one.claimId);
  h.board.reportMerged(c, one.taskId, one.claimId, merged());
  lane = laneOf((await h.get("/tasks", h.c)).text, s.number);
  assert.ok(lane.includes('<progress value="1" max="4" aria-hidden="true"></progress>Task 4개 중 1개 끝'));
  assert.match(lane, new RegExp(`<a class="story-title" href="/stories/${s.storyId}"><span class="num">#${s.number}</span> 쿠폰 발급</a>`));
  assert.match(lane, /<span class="lead"><span class="av av[0-7]" aria-hidden="true">PL<\/span>PL PL<\/span>/);
});

test("the menu marks the page you are on", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const nav = async (path) => /<nav>.*?<\/nav>/.exec((await h.get(path, h.c)).text)[0];
  const BOARD = '<nav><a href="/" aria-current="page">보드</a><a href="/team">팀</a></nav>';
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "기획", intent: "쿠폰", risk: "normal" }).planId;
  for (const path of ["/", "/board", "/tasks", `/stories/${s.storyId}`, `/tasks/${s.tasks.a}`, `/plans/${planId}`]) assert.equal(await nav(path), BOARD, path);
  assert.equal(await nav("/team"), '<nav><a href="/">보드</a><a href="/team" aria-current="page">팀</a></nav>');
  for (const path of ["/me", "/mac", "/repos"]) assert.equal(await nav(path), '<nav><a href="/">보드</a><a href="/team">팀</a></nav>', path);
});

test("the header shows me, the switch and my Mac with words beside their shapes", async (t) => {
  const h = await team(t);
  const header = /<header>.*<\/header>/.exec((await h.get("/", h.c)).text)[0];
  assert.match(header, /^<header><a class="brand" href="\/"><span class="logo" aria-hidden="true"><\/span><span class="word">Pazmo 팀 허브<\/span><\/a>/);
  assert.match(header, /<a class="person" href="\/me"><span class="av av[0-7]" aria-hidden="true">C<\/span><span class="name">C<\/span><\/a>/);
  assert.ok(header.includes('<button class="switch" aria-pressed="true"><span class="track" aria-hidden="true"></span><span class="short" aria-hidden="true">자동 켜짐</span><span class="full">자동으로 일하기 켜짐</span></button>'));
  assert.ok(header.endsWith('<a class="macchip off" href="/mac"><span class="dot" aria-hidden="true"></span><span class="long">내 Mac: 연결된 Mac 없음</span></a></div></header>'));
  const mac = h.pair(h.c);
  for (const [state, tone] of [["working", "on"], ["idle", "on"], ["limited", "rest"], ["locked", "rest"]]) {
    h.store.macHeartbeat(mac, state, null);
    assert.match((await h.get("/", h.c)).text, new RegExp(`<a class="macchip ${tone}" href="/mac">`), state);
  }
});

test("an empty project says what comes next", async (t) => {
  const h = await team(t);
  const { projectId } = h.board.createProject(h.plBe, "빈 프로젝트", [{ repoId: h.be, baseBranch: "main" }]);
  const empty = (text) => /<h2>빈 프로젝트<\/h2>[\s\S]*?<p class="empty">([^<]*)<\/p>/.exec(text)?.[1];
  // D44: with two projects an empty one folds into one line on 전체; its own chip view says what comes next.
  assert.equal(empty((await h.get(`/?project=${projectId}`, h.pl)).text), "아직 Story가 없습니다. [새 Story]로 하고 싶은 일을 적으면 AI가 묻고 정리해 Task로 나눕니다.");
  assert.equal(empty((await h.get(`/?project=${projectId}`, h.b)).text), "아직 Story가 없습니다. 이 프로젝트의 레포를 모두 맡은 사람이 Story를 올리면 여기에 보입니다.");
});

test("the stylesheet keeps both themes, visible focus, large targets and no sideways scroll", async (t) => {
  const h = await team(t);
  const style = /<style>([\s\S]*?)<\/style>/.exec((await h.get("/", h.c)).text)[1];
  assert.match(style, /@media \(prefers-color-scheme:dark\)\{:root\{/);
  assert.match(style, /:focus-visible\{outline:3px solid var\(--accent\)/);
  assert.match(style, /button,\.btn\{[^}]*min-height:44px/);
  assert.match(style, /overflow-wrap:anywhere/);
  assert.match(style, /@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(style, /url\(/, "no image or font the CSP would block");
});

// D43 (U40): the first page is a Story board whose columns are the Story stages; each Story page carries that
// Story's Task board; /tasks is the all-Tasks board. Review fixes of U40 round 1 are pinned at the end.
const stageOf = (text, key) => {
  const m = new RegExp(`<div class="stage" data-stage="${key}"><h3><span>([^<]*)</span><span>(\\d+)</span></h3>([\\s\\S]*?)(?=<div class="stage"|</div><div class="cancelled"|</div></section>)`).exec(text);
  assert.ok(m, `stage ${key}`);
  return { label: m[1], count: Number(m[2]), body: m[3] };
};
const STAGES = [["planning", "기획 중"], ["open", "진행 중"], ["verifying", "Story 검증"], ["awaiting_g4", "승인 대기"], ["done", "완료"]];

test("/ and /board are the Story board: Story cards in the five Story-stage columns, no Task cards", async (t) => {
  const h = await team(t, { names: { pl: "리더", c: "에이" } });
  const done = h.open(h.publish("끝난 Story", ["a"]));
  advance(h, done, "done");
  const g4 = h.open(h.publish("승인 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  const ver = h.open(h.publish("검증 Story", ["a"]));
  advance(h, ver, "verifying");
  const open = h.open(h.publish("열린 Story", ["a", "b", "c"]));
  const c = h.cBe();
  const one = h.board.claimNext(c);
  h.board.mergeLock(c, one.taskId, one.claimId);
  h.board.reportMerged(c, one.taskId, one.claimId, merged());
  const two = h.board.claimNext(c);
  h.board.heartbeat(c, two.taskId, two.claimId, "build");
  h.board.reportFailed(c, two.taskId, two.claimId, "RUNNER_LIMIT claude: usage limit");
  const draft = h.publish("올리기 전 Story", ["a"]);
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "웹 기획", intent: "쿠폰", risk: "normal" }).planId;
  for (const path of ["/", "/board"]) {
    const text = (await h.get(path, h.b)).text;
    assert.match(text, /<title>Story 보드 · /, path);
    assert.ok(text.includes('<nav class="tabs" aria-label="보드 보기"><a href="/" aria-current="page">Story 보드</a><a href="/tasks">모든 Task</a></nav>'), path);
    assert.deepEqual([...text.matchAll(/<div class="stage" data-stage="([^"]+)"><h3><span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]), STAGES, `${path}: five stages in order`);
    assert.doesNotMatch(text, /<li class="card/, `${path}: no Task card`);
    const at = (s) => STAGES.find(([key]) => stageOf(text, key).body.includes(`href="/stories/${s.storyId}"`))?.[0];
    assert.deepEqual([at(done), at(g4), at(ver), at(open), at(draft)], ["done", "awaiting_g4", "verifying", "open", "planning"], path);
    assert.ok(stageOf(text, "planning").body.includes(`href="/plans/${planId}"`), "the web plan is planned too");
  }
  const text = (await h.get("/", h.b)).text;
  const card = new RegExp(`<li class="scard stop" data-story="${open.number}"><p class="kind">Story #${open.number}</p><a class="stitle" href="/stories/${open.storyId}">열린 Story</a><p><span class="pill run">진행 중</span><span class="pill stop">멈춘 Task 1</span></p><p class="sprog"><progress value="1" max="4" aria-hidden="true"></progress>Task 4개 중 1개 끝</p><p class="speople"><span class="lead"><span class="av av[0-7]" aria-hidden="true">리더</span>PL 리더</span><span class="now">지금 일하는 사람 <span class="person"><span class="av av[0-7]" aria-hidden="true">에이</span>에이</span></span></p></li>`);
  assert.match(stageOf(text, "open").body, card, "stage, PL, done/total, who works now, stopped Tasks");
  assert.match(stageOf(text, "awaiting_g4").body, new RegExp(`<li class="scard need" data-story="${g4.number}">`));
  assert.match(stageOf(text, "done").body, new RegExp(`<li class="scard done" data-story="${done.number}">`));
  assert.ok(stageOf(text, "planning").body.includes(`<li class="scard draft" data-story="${draft.number}"><p class="kind">Story #${draft.number} · 열리기 전</p><a class="stitle" href="/stories/${draft.storyId}">올리기 전 Story</a><p><span class="pill run">기획 중</span></p><p class="sprog">Task 2개 준비됨</p>`), "an unopened Story looks like a draft");
  assert.ok(stageOf(text, "planning").body.includes(`<li class="scard draft"><p class="kind">웹 기획</p><a class="stitle" href="/plans/${planId}">웹 기획</a><p><span class="pill run">기획 대기</span></p><p class="speople">`), "a web plan looks like a draft, without 아직 Task 없음");
});

test("the Story board keeps 내 Story만 and 취소한 것도 보기, and its tabs carry them", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("PL의 Story", ["a"]));
  h.board.claimNext(h.cBe());
  const mine = (await h.get("/?mine=1", h.c)).text;
  assert.ok(mine.includes('<a href="/?mine=1" aria-current="page">Story 보드</a><a href="/tasks?mine=1">모든 Task</a>'), "the tabs keep the filter");
  assert.ok(mine.includes(`data-story="${s.number}"`), "C holds a Task of it");
  assert.ok(!(await h.get("/?mine=1", h.b)).text.includes(`data-story="${s.number}"`));
  h.board.cancelStory({ member: h.pl.member }, s.storyId);
  assert.ok(!(await h.get("/", h.c)).text.includes(`data-story="${s.number}"`), "a cancelled Story is hidden");
  const shown = (await h.get("/?cancelled=1", h.c)).text;
  assert.match(shown, new RegExp(`<div class="cancelled"><h3><span>취소됨</span><span>1</span></h3><ul class="scards"><li class="scard gone" data-story="${s.number}">`));
  const tasks = (await h.get("/tasks?cancelled=1", h.c)).text;
  assert.ok(tasks.includes('<a href="/?cancelled=1">Story 보드</a><a href="/tasks?cancelled=1" aria-current="page">모든 Task</a>'));
  assert.match(tasks, /<title>모든 Task · /);
  assert.ok(tasks.includes('<a class="filter" href="/tasks?mine=1&cancelled=1">내 Story만</a>'), "the Task board's own filters stay on /tasks");
});

test("the 완료 column shows the five newest done Stories and folds the rest", async (t) => {
  const h = await team(t);
  const all = [];
  for (let i = 0; i < 7; i++) {
    const s = h.open(h.publish(`끝 ${i}`, ["a"]));
    advance(h, s, "done");
    all.push(s);
  }
  const done = stageOf((await h.get("/", h.c)).text, "done");
  assert.equal(done.count, 7);
  const [shown, folded] = done.body.split('<details class="more">');
  for (const s of all.slice(2)) assert.ok(shown.includes(`data-story="${s.number}"`), `newest: #${s.number}`);
  assert.ok(folded.startsWith("<summary>이전 완료 보기</summary>"), "a fixed summary, so live.js keeps an open fold open");
  for (const s of all.slice(0, 2)) assert.ok(folded.includes(`data-story="${s.number}"`), `folded: #${s.number}`);
});

test("a Story page carries its stage steps and its own Task board with every card", async (t) => {
  const h = await team(t);
  // First, while nothing else is ready, a Story waiting for its result approval.
  const g4 = h.open(h.publish("승인 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const s = h.open(h.publish("쿠폰 발급", ids));
  h.board.cancelTask({ member: h.pl.member }, s.tasks.h);
  const c = h.cBe();
  for (let i = 0; i < 6; i++) {
    const k = h.board.claimNext(c);
    h.board.mergeLock(c, k.taskId, k.claimId);
    h.board.reportMerged(c, k.taskId, k.claimId, merged());
  }
  const page = (await h.get(`/stories/${s.storyId}`, h.b)).text;
  assert.ok(page.includes('<ol class="steps" aria-label="Story 단계"><li class="past">기획 중</li><li class="now" aria-current="step">진행 중</li><li>Story 검증</li><li>승인 대기</li><li>완료</li></ol>'));
  assert.ok(page.includes('<p class="sprog"><progress value="6" max="8" aria-hidden="true"></progress>Task 8개 중 6개 끝</p>'), "seven work Tasks and the Story check, the cancelled one left out");
  const done = colOf(page, "done");
  assert.equal((done.match(/<li class="card done">/g) ?? []).length, 6, "every merged card, not five");
  assert.doesNotMatch(done, /개 더/);
  assert.ok(colOf(page, "todo").includes(`/tasks/${s.tasks.g}`));
  assert.match(page, new RegExp(`<div class="cancelled"><h3><span>취소됨</span><span>1</span></h3><ul class="cards"><li class="card"><a href="/tasks/${s.tasks.h}">`), "its cancelled card, without a toggle");
  assert.match(page, /<details><summary>표로 보기\(앞 Task 포함\)<\/summary><div class="scroll"><table>/);
  assert.ok(page.includes('<a href="/">Story 보드</a>'), "the way back");
  const waiting = (await h.get(`/stories/${g4.storyId}`, h.pl)).text;
  assert.ok(waiting.includes('<li class="now" aria-current="step">승인 대기</li>'));
  assert.ok(waiting.includes("<p>모든 Task가 끝났습니다. 결과 승인은 Hub가 아니라 PL의 Mac(claude 대화)에서 합니다.</p>"));
});

test("the store's board for one Story has every card of it", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("하나", ["a", "b"]));
  h.open(h.publish("다른 것", ["a"]));
  h.board.cancelTask({ member: h.pl.member }, s.tasks.b);
  const one = h.board.storyBoard({ member: h.c.member }, s.storyId);
  assert.equal(one.id, s.storyId);
  assert.deepEqual(one.cards.map((c) => c.taskId).sort(), [...Object.values(s.tasks), s.verify].sort(), "its cards only");
  assert.ok(one.cards.some((c) => c.taskId === s.tasks.b && c.column === "hidden"), "its cancelled card");
  assert.equal(h.board.storyBoard({ member: h.c.member }, "00000000-0000-0000-0000-000000000000"), null);
});

test("나를 기다리는 일 also lists a held Task, my stopped plan and which Story a Task is in", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const k = h.board.claimNext(c);
  h.board.heartbeat(c, k.taskId, k.claimId, "build");
  h.clock.board = 11 * 60_000;
  const HOLDER = "c".repeat(32);
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "멈춘 기획", intent: "쿠폰", risk: "normal" }).planId;
  const l = h.plans.next(h.plBe, HOLDER);
  h.plans.result(h.plBe, HOLDER, planId, l.leaseId, l.revision, { kind: "failed", reason: "모델이 멈췄습니다." });
  const box = needsOf((await h.get("/", h.pl)).text);
  // D44: one row per kind, the reason once, the titles as links.
  assert.ok(box.includes(`<li><p class="ghead"><span class="pill stop">멈춤(Mac 소식 없음)</span><span class="count">1</span><span class="gwhy">맡은 사람의 Mac에서 10분 넘게 소식이 없습니다.</span></p><p class="glinks"><a href="/tasks/${k.taskId}"><b>a 작업</b> <span class="muted">Story #${s.number}</span></a></p></li>`));
  assert.ok(box.includes(`<li><p class="ghead"><span class="pill stop">멈춤</span><span class="count">1</span><span class="gwhy">기획이 멈췄습니다. 기획 화면에서 이유를 보고 다시 시도하세요.</span></p><p class="glinks"><a href="/plans/${planId}"><b>멈춘 기획</b></a></p></li>`));
  assert.ok(needsOf((await h.get("/tasks", h.pl)).text), "the box is on the Task board too");
});

test("review fixes: tables keep their width, the count badge reads, focus keeps its shape, targets are 44px", async (t) => {
  const h = await team(t);
  const style = /<style>([\s\S]*?)<\/style>/.exec((await h.get("/", h.c)).text)[1];
  assert.match(style, /body\{[^}]*overflow-wrap:break-word/, "a table cell is not squeezed letter by letter");
  assert.match(style, /\.needs \.count\{background:var\(--need-bg\);color:var\(--need\)\}/);
  assert.doesNotMatch(style, /:focus-visible\{[^}]*border-radius/);
  for (const sel of ["nav a", "\\.filter", "button\\.switch", "\\.macchip"]) assert.match(style, new RegExp(`${sel}\\{[^}]*min-height:44px`), sel);
  assert.match(style, /\*,\*::before,\*::after\{transition:none!important\}/);
});

// U40 review 2 fixes.
test("a long unbroken word cannot widen a page, and Story cards keep to their column", async (t) => {
  const h = await team(t);
  const style = /<style>([\s\S]*?)<\/style>/.exec((await h.get("/", h.c)).text)[1];
  assert.match(style, /(^|[}\n])section\{[^}]*grid-template-columns:minmax\(0,1fr\)/, "a grid section never grows past the page");
  assert.match(style, /\.scard\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(style, /\.now \.person\{[^}]*white-space:nowrap/);
  // U46: stages are flex items of equal share that may shrink below their longest word (flex:1 1 0; min-width:0).
  assert.match(style, /\.stage\{flex:1 1 0;[^}]*min-width:0/, "a long word in a Story card cannot widen its stage column");
  assert.match(style, /\.steps li\.past::before\{content:"✓ "\}/, "a passed step is marked by more than its colour");
  assert.match(style, /\.tabs a\[aria-current=page\]\{[^}]*box-shadow:inset 0 -3px 0 var\(--accent\)/, "the selected tab is marked in both themes");
  assert.match(style, /\.callout pre\{[^}]*font-family:ui-monospace/, "the raw reason keeps its columns");
});

test("the 기획 중 column is drawn hub-wide: on a hub without web plans, on every project once any project has a draft", async (t) => {
  const h = await team(t, { plans: false });
  const other = h.board.createProject(h.plBe, "다른 프로젝트", [{ repoId: h.be, baseBranch: "main" }]).projectId;
  h.open(h.publish("열린 Story", ["a"]));
  let text = (await h.get("/", h.c)).text;
  assert.doesNotMatch(text, /data-stage="planning"/, "no web plans and no drafts: no 기획 중 column");
  h.publish("올리기 전", ["a"]);
  const pub = h.board.publishStory(h.plBe, {
    projectId: other, title: "다른 Story", body: "# Story", risk: "normal", key: "other",
    graph: { nodes: [{ id: "x", repoId: h.be, title: "x", spec: "x", files: ["src/x.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  text = (await h.get("/", h.c)).text;
  assert.equal((text.match(/data-stage="planning"/g) ?? []).length, 2, "both projects line up");
});

test("the 완료 column puts the Stories that finished last first, whatever their number", async (t) => {
  const h = await team(t);
  const late = h.open(h.publish("늦게 끝난 Story", ["a"]));
  advance(h, late, "awaiting_g4");
  const all = [];
  for (let i = 0; i < 6; i++) {
    h.clock.board += 1000;
    const s = h.open(h.publish(`끝 ${i}`, ["a"]));
    advance(h, s, "done");
    all.push(s);
  }
  h.clock.board += 1000;
  h.board.completeStory(h.plBe, late.storyId);
  const [shown, folded] = stageOf((await h.get("/", h.c)).text, "done").body.split('<details class="more">');
  assert.ok(shown.indexOf(`data-story="${late.number}"`) >= 0 && shown.indexOf(`data-story="${late.number}"`) < shown.indexOf(`data-story="${all[5].number}"`), "the one finished last comes first");
  assert.ok(folded.includes(`data-story="${all[0].number}"`) && folded.includes(`data-story="${all[1].number}"`), "the two finished first fold");
});

test("a cancelled Story in the strip is quiet and says what it had", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("그만둔 Story", ["a", "b"]));
  h.board.cancelStory({ member: h.pl.member }, s.storyId);
  const text = (await h.get("/?cancelled=1", h.c)).text;
  assert.ok(text.includes(`<li class="scard gone" data-story="${s.number}"><p class="kind">Story #${s.number}</p><a class="stitle" href="/stories/${s.storyId}">그만둔 Story</a><p><span class="pill">취소됨</span></p><p class="sprog">Task 3개 취소됨</p>`));
  const style = /<style>([\s\S]*?)<\/style>/.exec(text)[1];
  assert.match(style, /\.cancelled \.scards\{[^}]*grid-template-columns:repeat\(auto-fill,minmax\(/);
  assert.match(style, /\.scard\.gone \.stitle\{[^}]*color:var\(--muted\)/);
});

// U40 review 3 fixes.
test("a cancelled Story card counts only its cancelled Tasks and says how many had finished", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("반쯤 한 Story", ["a", "b"]));
  const c = h.cBe();
  const k = h.board.claimNext(c);
  h.board.mergeLock(c, k.taskId, k.claimId);
  h.board.reportMerged(c, k.taskId, k.claimId, merged());
  h.board.cancelStory({ member: h.pl.member }, s.storyId);
  const text = (await h.get("/?cancelled=1", h.c)).text;
  assert.ok(text.includes(`<a class="stitle" href="/stories/${s.storyId}">반쯤 한 Story</a><p><span class="pill">취소됨</span></p><p class="sprog">Task 2개 취소됨 · 1개 끝남</p>`));
  const g4 = h.open(h.publish("다 한 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  h.board.cancelStory({ member: h.pl.member }, g4.storyId);
  assert.ok((await h.get("/?cancelled=1", h.c)).text.includes(`<a class="stitle" href="/stories/${g4.storyId}">다 한 Story</a><p><span class="pill">취소됨</span></p><p class="sprog">Task 2개 끝남</p>`), "nothing cancelled, two finished");
});

test("a passed step shows its ✓ beside its name, and the stages stay one row on every window wider than a phone", async (t) => {
  const h = await team(t);
  const style = /<style>([\s\S]*?)<\/style>/.exec((await h.get("/", h.c)).text)[1];
  assert.match(style, /\.steps li\{display:flex;align-items:center;justify-content:center;/);
  // U41: one column per stage shown (four or five), so 완료 never wraps alone (it did at 861–887px with minmax(160px,1fr)).
  // U46: one flex row that never wraps (an empty stage shrinks to a rail instead of moving to a second row).
  assert.match(style, /\.stages\{display:flex;gap:16px;align-items:flex-start\}/);
  assert.doesNotMatch(style, /\.stages\{[^}]*(auto-fit|flex-wrap)/);
  // Narrow windows above a phone tighten the stage spacing so the longest state words stay on one line.
  // Range syntax leaves no gap at fractional widths between 860 and 861px; only stage cards (not the 취소됨 strip) tighten,
  // and the dashed 기획 중 column (its own 2px border) gets 2px less padding so its cards are as wide as the others.
  // U44: stages 12px apart over cards 6px apart (twice), paid for by 2px less stage padding: ~114.6px of card text at 861px
  // (115 measured; 114 before).
  assert.match(style, /@media \(width > 860px\) and \(width <= 960px\)\{\.stages\{gap:12px\}\.stage\{padding:6px\}\.stage\[data-stage=planning\]\{padding:4px\}\.stages \.scard\{padding:12px\}\.stages \.scards\{gap:6px\}\}/);
  // A phone stacks the stages again (U44: 16px apart, twice the 8px between cards).
  assert.match(style, /@media \(max-width:860px\)\{[\s\S]*\.stages\{flex-direction:column;align-items:stretch;gap:16px\}\.stage\{flex:none\}/);
});

// U41: a cancelled Story says the same thing on its card, its page and its /tasks lane.
test("a cancelled Story's page and Task-board lane say what it had, like its card", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("반쯤 한 Story", ["a", "b"]));
  const c = h.cBe();
  const k = h.board.claimNext(c);
  h.board.mergeLock(c, k.taskId, k.claimId);
  h.board.reportMerged(c, k.taskId, k.claimId, merged());
  h.board.cancelStory({ member: h.pl.member }, s.storyId);
  const said = "Task 2개 취소됨 · 1개 끝남";
  const page = (await h.get(`/stories/${s.storyId}`, h.c)).text;
  assert.ok(page.includes(`<p class="sprog">${said}</p>`), "the Story page");
  assert.ok(!page.includes("개 중 1개 끝"), "not the open Story's count");
  const lane = laneOf((await h.get("/tasks?cancelled=1", h.c)).text, s.number);
  assert.ok(lane.includes(`<span class="progress">${said}</span>`), "the /tasks lane");
  // An open Story keeps its bar and count on all three.
  const open = h.open(h.publish("열린 Story", ["a"]));
  const bar = `<progress value="0" max="2" aria-hidden="true"></progress>Task 2개 중 0개 끝`;
  assert.ok((await h.get(`/stories/${open.storyId}`, h.c)).text.includes(`<p class="sprog">${bar}</p>`));
  assert.ok(laneOf((await h.get("/tasks", h.c)).text, open.number).includes(`<span class="progress">${bar}</span>`));
  assert.ok((await h.get("/", h.c)).text.includes(`<p class="sprog">${bar}</p>`));
});

// D44 (U43): many items and projects. 나를 기다리는 일 groups same-kind rows and hides none; both boards get a project
// chip row (?project=<id>) that keeps the other filters and the tabs; empty projects fold into one line on 전체.
/** Another project of the PL's (app-be, main), with one opened Story of `title` (one Task) when a title is given. */
const another = (h, name, title) => {
  const { projectId } = h.board.createProject(h.plBe, name, [{ repoId: h.be, baseBranch: "main" }]);
  if (!title) return { projectId };
  const pub = h.board.publishStory(h.plBe, {
    projectId, title, body: "# Story", risk: "normal", key: `p-${projectId}`,
    graph: { nodes: [{ id: "x", repoId: h.be, title: `${title} 작업`, spec: "x", files: [`src/${projectId}.ts`], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  return { projectId, storyId: pub.storyId, number: pub.number };
};
const chipsOf = (text) => /<nav class="chips" aria-label="프로젝트">[\s\S]*?<\/nav>/.exec(text)?.[0] ?? null;
const groupsOf = (box) =>
  [...box.matchAll(/<li><p class="ghead">([\s\S]*?)<\/p><p class="glinks">([\s\S]*?)<\/p><\/li>/g)].map((m) => ({ head: m[1], links: m[2], word: /<span class="pill (\w+)">([^<]*)<\/span>/.exec(m[1]).slice(1).join(" ") }));

test("나를 기다리는 일 groups rows of the same word into one row, hides none and puts stopped ones first (D44)", async (t) => {
  const h = await team(t);
  const g4 = [];
  for (const title of ["승인 하나", "승인 둘"]) {
    const s = h.open(h.publish(title, ["a"]));
    advance(h, s, "awaiting_g4");
    g4.push(s);
  }
  const s = h.open(h.publish("쿠폰 발급", ["a", "b"]));
  const c = h.cBe();
  const one = h.board.claimNext(c);
  h.board.reportFailed(c, one.taskId, one.claimId, "RUNNER_LIMIT claude: usage limit");
  const two = h.board.claimNext(h.plBe);
  h.board.reportFailed(h.plBe, two.taskId, two.claimId, "RUNNER_BILLING claude: credit");
  const HOLDER = "d".repeat(32);
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "초안 기획", intent: "쿠폰 만료를 알리고 싶다", risk: "normal" }).planId;
  const l = h.plans.next(h.plBe, HOLDER);
  h.plans.result(h.plBe, HOLDER, planId, l.leaseId, l.revision, { kind: "draft", text: "# Story: 초안 기획\n", story: { title: "초안 기획" } });

  const box = needsOf((await h.get("/", h.pl)).text);
  assert.match(box, /^<h2 id="needs">나를 기다리는 일 <span class="count">5<\/span><\/h2><ul><li>/, "every item counts");
  const groups = groupsOf(box);
  assert.deepEqual(groups.map((g) => g.word), ["stop 멈춤(실패)", "need 초안", "need 승인 대기"], "stopped, then plans waiting for an answer, then approvals");
  const nameOf = (taskId) => `${Object.entries(s.tasks).find(([, id]) => id === taskId)[0]} 작업`;
  assert.equal(groups[0].head, '<span class="pill stop">멈춤(실패)</span><span class="count">2</span>', "two different reasons: none on the row, each on its Task page");
  for (const k of [one, two]) assert.ok(groups[0].links.includes(`<a href="/tasks/${k.taskId}"><b>${nameOf(k.taskId)}</b> <span class="muted">Story #${s.number}</span></a>`));
  assert.equal(groups[0].links.match(/<a /g).length, 2);
  assert.ok(groups[1].links === `<a href="/plans/${planId}"><b>초안 기획</b></a>`);
  assert.equal(groups[2].head, `<span class="pill need">승인 대기</span><span class="count">2</span><span class="gwhy">${AWAITING_G4}</span>`, "one shared reason, said once");
  assert.equal(groups[2].links, g4.map((x, i) => `<a href="/stories/${x.storyId}"><b>${["승인 하나", "승인 둘"][i]}</b></a>`).join(""), "no row hidden");
  assert.equal(box.split(AWAITING_G4).length, 2);
});

test("project chips show one project, keep the other filters and the tabs, and leave 나를 기다리는 일 whole (D44)", async (t) => {
  const h = await team(t);
  assert.equal(chipsOf((await h.get("/", h.pl)).text), null, "one project: no chip row");
  const g4 = h.open(h.publish("승인 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  const other = another(h, "회원 등급", "등급 Story");
  const c = h.cBe();
  const k = h.board.claimNext(c);
  h.board.reportFailed(c, k.taskId, k.claimId, "RUNNER_LIMIT claude: usage limit");

  const all = (await h.get("/", h.pl)).text;
  const chips = chipsOf(all);
  assert.ok(chips, "two projects: a chip row");
  assert.ok(chips.startsWith('<nav class="chips" aria-label="프로젝트"><a href="/" aria-current="true">전체 <span class="count">2</span></a>'), "전체 first, chosen, with every Story");
  const NEED = '<span class="flag need" role="img" aria-label="승인 대기 있음" title="승인 대기 있음"></span>';
  const STOP = '<span class="flag stop" role="img" aria-label="멈춘 Task 있음" title="멈춘 Task 있음"></span>';
  assert.ok(chips.includes(`<a href="/?project=${h.projectId}">${NEED}쿠폰 개편 <span class="count">1</span></a>`));
  assert.ok(chips.includes(`<a href="/?project=${other.projectId}">${STOP}회원 등급 <span class="count">1</span></a>`));
  assert.ok(!needsOf(all).includes('<p class="muted">'), "on 전체 the box needs no note");
  assert.ok(all.includes("<h2>쿠폰 개편</h2>") && all.includes("<h2>회원 등급</h2>"));

  const one = (await h.get(`/?project=${other.projectId}`, h.pl)).text;
  assert.ok(one.includes("<h2>회원 등급</h2>") && !one.includes("<h2>쿠폰 개편</h2>"), "only the chosen project");
  assert.ok(chipsOf(one).includes(`<a href="/?project=${other.projectId}" aria-current="true">`) && chipsOf(one).includes('<a href="/">전체'));
  const box = needsOf(one);
  assert.ok(box.includes(`/stories/${g4.storyId}`) && box.includes(`/tasks/${k.taskId}`), "the box keeps every project");
  assert.match(box, /^<h2 id="needs">나를 기다리는 일 <span class="count">2<\/span><\/h2><p class="muted">고른 프로젝트와 관계없이 모든 프로젝트의 일입니다.<\/p><ul>/, "and says so under a chosen chip");
  assert.ok(one.includes(`<a href="/?project=${other.projectId}" aria-current="page">Story 보드</a><a href="/tasks?project=${other.projectId}">모든 Task</a>`), "the tabs keep the project");
  assert.ok(one.includes(`<a class="filter" href="/?mine=1&project=${other.projectId}">내 Story만</a>`), "a filter keeps the project");

  const mine = (await h.get(`/?mine=1&project=${other.projectId}`, h.c)).text;
  assert.ok(chipsOf(mine).includes('<a href="/?mine=1">전체 <span class="count">1</span></a>'), "chips keep 내 Story만 and count what it shows");
  assert.ok(chipsOf(mine).includes(`<a href="/?mine=1&project=${h.projectId}">쿠폰 개편 <span class="count">0</span></a>`), "C has nothing in 쿠폰 개편: no Story, no dot");
  assert.ok(mine.includes(`<a href="/?mine=1&project=${other.projectId}" aria-current="page">Story 보드</a><a href="/tasks?mine=1&project=${other.projectId}">모든 Task</a>`));

  const tasks = (await h.get(`/tasks?project=${other.projectId}`, h.pl)).text;
  assert.ok(tasks.includes(`data-story="${other.number}"`) && !tasks.includes(`data-story="${g4.number}"`), "the Task board too");
  assert.ok(chipsOf(tasks).includes(`<a href="/tasks?project=${other.projectId}" aria-current="true">`));
  assert.ok(needsOf(tasks).includes(`/stories/${g4.storyId}`));

  const unknown = (await h.get("/?project=nope", h.pl)).text;
  assert.ok(unknown.includes("<h2>쿠폰 개편</h2>") && unknown.includes("<h2>회원 등급</h2>"), "an unknown id shows 전체");
  assert.ok(chipsOf(unknown).includes('<a href="/" aria-current="true">전체'));
  assert.ok(unknown.includes('<a href="/" aria-current="page">Story 보드</a><a href="/tasks">모든 Task</a>'), "and does not carry the id");

  // A stopped Task outranks an approval: 쿠폰 개편 gets the stop mark once one of its Tasks stops.
  const more = h.open(h.publish("또 하나", ["a"]));
  const p = h.board.claimNext(h.plBe);
  assert.equal(p.taskId, more.tasks.a);
  h.board.reportFailed(h.plBe, p.taskId, p.claimId, "RUNNER_LIMIT claude: usage limit");
  assert.ok(chipsOf((await h.get("/", h.pl)).text).includes(`<a href="/?project=${h.projectId}">${STOP}쿠폰 개편 <span class="count">2</span></a>`));
});

test("on 전체, projects with no Story fold into one line that leads to each one's chip view (D44)", async (t) => {
  const h = await team(t);
  h.open(h.publish("쿠폰 발급", ["a"]));
  const e1 = another(h, "빈 하나"), e2 = another(h, "빈 둘");
  const all = (await h.get("/", h.pl)).text;
  // "보이는": a project whose only Story is cancelled has Stories, just none shown without 취소한 것도 보기.
  const line = /<p class="quiet"><span>보이는 Story가 없는 프로젝트<\/span>([\s\S]*?)<\/p>/.exec(all)?.[1];
  assert.ok(line, "one line");
  for (const [e, name] of [[e1, "빈 하나"], [e2, "빈 둘"]]) assert.ok(line.includes(`<a href="/?project=${e.projectId}">${name}</a>`), name);
  assert.ok(!all.includes("<h2>빈 하나</h2>") && !all.includes('<p class="empty">'), "no empty five columns");
  assert.ok(all.includes("<h2>쿠폰 개편</h2>"));
  const one = (await h.get(`/?project=${e1.projectId}`, h.pl)).text;
  assert.ok(one.includes("<h2>빈 하나</h2>") && one.includes('<p class="empty">아직 Story가 없습니다.'), "its chip view says what comes next");
  assert.ok(one.includes(`<a class="btn ghost" href="/projects/${e1.projectId}/new-story">새 Story</a>`));
  const tasks = (await h.get("/tasks?cancelled=1", h.pl)).text;
  assert.ok(tasks.includes(`<a href="/tasks?cancelled=1&project=${e2.projectId}">빈 둘</a>`), "on the Task board the line keeps its board and filters");
  assert.ok(!(await h.get("/?mine=1", h.c)).text.includes('class="quiet"'), "내 Story만 leaves out projects with nothing of mine, as before");

  // Project names are escaped in the chips and on the line.
  const evil = another(h, EVIL);
  const text = (await h.get("/", h.pl)).text;
  assert.ok(!text.includes(EVIL), "no raw markup from a project name");
  const safe = "&#60;img src=x onerror=alert(1)&#62;";
  assert.ok(chipsOf(text).includes(`<a href="/?project=${evil.projectId}">${safe} <span class="count">0</span></a>`));
  assert.ok(text.includes(`<a href="/?project=${evil.projectId}">${safe}</a>`), "on the line");
});

test("chips wrap on a phone and every new target is 44px (D44)", async (t) => {
  const h = await team(t);
  const style = /<style>([\s\S]*?)<\/style>/.exec((await h.get("/", h.c)).text)[1];
  assert.match(style, /\.chips\{[^}]*flex-wrap:wrap/, "chips wrap instead of sliding sideways");
  for (const sel of ["\\.chips a", "\\.needs a", "\\.quiet a"]) assert.match(style, new RegExp(`${sel}\\{[^}]*min-height:44px`), sel);
  assert.match(style, /\.chips a\[aria-current=true\]\{/, "the chosen chip is marked");
  for (const sel of ["\\.chips a", "\\.quiet a", "\\.gwhy"]) assert.match(style, new RegExp(`${sel}(,[^{}]*)?\\{overflow-wrap:anywhere\\}`), `a long word breaks inside ${sel}`);
  assert.match(style, /\.needs li\{[^}]*grid-template-columns:minmax\(0,1fr\)/, "a waiting row never grows past the box");
  // Review 1: the two marks differ by shape, not colour alone, and a ring in the chip's text colour keeps 3:1 on either chip.
  // Review 2: the mark is a span in a nav, and `nav span` colours spans muted; inherit takes the chip's text colour back.
  assert.match(style, /\.flag\{color:inherit;[^}]*box-shadow:0 0 0 2px currentColor/);
  assert.match(style, /\.flag\.stop\{[^}]*border-radius:2px/, "stopped: a square");
  assert.match(style, /\.flag\.need\{[^}]*border-radius:50%/, "approval: a round dot");
});

// U44: the Hub design checklist (docs/solutions/conventions/hub-design-checklist.md). The stylesheet-wide invariants are
// in hub-design-invariants.test.mjs; these pin the rules the checklist added to particular parts.
const styleOf = async (h) => /<style>([\s\S]*?)<\/style>/.exec((await h.get("/", h.c)).text)[1];
/** The declarations of the rule whose selector is exactly `sel` (at the top level unless `inside` names its at-rule). */
const ruleOf = (style, sel, inside = null) => {
  const scope = inside === null ? style.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, "") : new RegExp(`${inside.replace(/[()]/g, "\\$&")}\\{((?:[^{}]*\\{[^}]*\\})*)[^{}]*\\}`).exec(style)?.[1] ?? "";
  const m = new RegExp(`(?:^|[}\\n])${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`).exec(scope);
  assert.ok(m, `rule ${sel}${inside ? ` in ${inside}` : ""}`);
  return m[1];
};
const px = (decls, prop) => Number(new RegExp(`(?:^|;)${prop}:(\\d+)px`).exec(decls)?.[1]);

test("U44: every control is at least 32px tall with a mouse and 44px square on touch", async (t) => {
  const style = await styleOf(await team(t));
  for (const sel of ["summary", "label:has(>input[type=checkbox])", ".refresh", ".cards>li:not(.card)>a"]) assert.equal(px(ruleOf(style, sel), "min-height"), 32, sel);
  assert.match(ruleOf(style, ".story-title"), /padding-block:2px/, "18px line + 4px");
  const coarse = ruleOf(style, ".brand,summary,label:has(>input[type=checkbox]),.refresh,.cards>li:not(.card)>a", "@media (pointer:coarse)");
  assert.equal(px(coarse, "min-height"), 44);
  assert.equal(px(ruleOf(style, "nav a,.tabs a,a.person", "@media (pointer:coarse)"), "min-width"), 44, "a one-letter menu item (팀) or name tag is 44px wide");
  assert.match(ruleOf(style, ".story-title", "@media (pointer:coarse)"), /padding-block:8px/);
  assert.match(ruleOf(style, "summary", "@media (pointer:coarse)"), /padding-block:10px/);
  assert.equal(ruleOf(style, ".cancelled .card>a::after"), 'content:"";position:absolute;inset:0', "a cancelled card's link covers its card like the others");
});

test("U44: the accent marks only the primary action, the current selection, focus, hover and links", async (t) => {
  const style = await styleOf(await team(t));
  assert.equal(ruleOf(style, "button.secondary,.btn.ghost"), "background:var(--panel);color:var(--fg);border-color:var(--line)", "secondary actions are neutral");
  const uses = [...style.replace(/@media[^{]*\{/g, "").matchAll(/(?<=^|[}\n])([^{}]+)\{([^}]*)\}/g)].filter((m) => /var\(--accent\)/.test(m[2])).map((m) => m[1].trim());
  const allowed = /^a$|:hover|:focus-visible|aria-current|^button,\.btn$|^input\[type=checkbox\]$/;
  for (const sel of uses) assert.match(sel, allowed, `${sel} uses the accent`);
  for (const sel of ["button.secondary:hover,.btn.ghost:hover", ".tabs a[aria-current=page]", ".filter[aria-current=true]::before"]) assert.ok(uses.includes(sel), `${sel} is read`);
  assert.equal(ruleOf(style, ".scard:hover"), "border-color:var(--accent)", "U46: no state bar to keep, the state is the card's word");
});

test("U44: text never pushes a box wider than its track", async (t) => {
  const style = await styleOf(await team(t));
  for (const sel of [".cards", ".scards", ".card", ".needs ul", ".project", ".projects", ".titlebar", ".cancelled", "form", "label", "fieldset", ".callout", "ul.work"])
    assert.match(ruleOf(style, sel), /grid-template-columns:minmax\(0,1fr\)/, sel);
  assert.match(ruleOf(style, ".cancelled .scards"), /repeat\(auto-fill,minmax\(min\(240px,100%\),1fr\)\)/);
  assert.match(ruleOf(style, ".lane:not([data-story]) .cards"), /repeat\(auto-fill,minmax\(min\(240px,100%\),1fr\)\)/);
  assert.match(ruleOf(style, ".cancelled .cards"), /repeat\(auto-fill,minmax\(min\(200px,100%\),1fr\)\)/);
  assert.match(style, /@media \(max-width:860px\)\{[^@]*\.cols\{grid-template-columns:minmax\(0,1fr\);/);
  const shrink = /:where\(([^)]*)\)>\*\{min-width:0\}/.exec(style);
  assert.ok(shrink, "flex items that hold text may shrink");
  for (const box of ["header", ".me", ".toggles", ".row", ".story", ".who", ".ghead", "p.state", ".person"]) assert.ok(shrink[1].split(",").includes(box), box);
  assert.match(style, /,\.person,\.me,\.who,\.lead,p\.state\{overflow-wrap:anywhere\}/, "a long name breaks instead of pushing the header out");
  assert.match(ruleOf(style, "textarea,input,select"), /max-width:100%/, "a long option cannot widen a form");
});

test("U44: the space between groups is at least twice the space inside them", async (t) => {
  const style = await styleOf(await team(t));
  const gap = (sel, inside) => px(ruleOf(style, sel, inside), "gap");
  const atLeastTwice = (outer, inner, what) => assert.ok(outer >= 2 * inner, `${what}: ${outer} vs ${inner}`);
  atLeastTwice(gap("main"), gap("section") + 4, "sections vs inside a section (a sub-heading's margin adds 4px)");
  atLeastTwice(gap(".cols"), gap(".cards"), "Task columns vs cards");
  atLeastTwice(gap(".stages"), gap(".scards"), "Story stages vs Story cards");
  atLeastTwice(gap(".project"), gap(".cards"), "Story lanes vs cards");
  atLeastTwice(gap(".projects"), gap(".project"), "projects vs inside a project");
  const band = "@media (width > 860px) and (width <= 960px)";
  atLeastTwice(gap(".stages", band), gap(".stages .scards", band), "Story stages vs cards in the narrow band");
  atLeastTwice(gap(".cols", "@media (max-width:860px)"), gap(".cards"), "stacked Task columns vs cards");
  assert.match(ruleOf(style, "section>ol,section>ul"), /margin-block:0/, "a list in a section keeps the section's gap");
});

test("U44: counts, times and table numbers line up", async (t) => {
  const style = await styleOf(await team(t));
  const tabular = [...style.matchAll(/(?<=^|[}\n])([^{}]+)\{[^}]*font-variant-numeric:tabular-nums/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
  for (const sel of ["table", ".pill", ".mac", ".macchip", ".meta", ".time", ".count", ".progress", "p.sprog", "ul.work"]) assert.ok(tabular.includes(sel), sel);
});

// U45 (나 결정 카드, PR 1): the shell and the admin lists. Explainer 7판: https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS
/** A colour token of the light block, or of the dark block when `dark`. */
const tokenOf = (style, name, dark = false) => {
  const block = dark ? /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}/.exec(style)?.[1] : /^:root\{([^}]*)\}/.exec(style)?.[1];
  const m = new RegExp(`(?:^|;)--${name}:#([0-9a-f]{6}|[0-9a-f]{3})(?=;)`).exec(block ?? "");
  assert.ok(m, `--${name}${dark ? " (dark)" : ""}`);
  return `#${m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]}`;
};
const contrast = (a, b) => {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("U45: the header keeps short words on a phone and one full name for screen readers", async (t) => {
  const h = await team(t);
  const header = /<header>.*<\/header>/.exec((await h.get("/", h.c)).text)[0];
  // The short words are hidden from screen readers; the full words are one span, so the switch's name is "자동으로 일하기 켜짐".
  assert.ok(header.includes('<span class="short" aria-hidden="true">자동 켜짐</span><span class="full">자동으로 일하기 켜짐</span>'));
  const style = await styleOf(h);
  const narrow = "@media (max-width:860px)";
  assert.equal(ruleOf(style, ".switch .short"), "display:none", "wide screens show the full words only");
  assert.equal(ruleOf(style, ".switch .short", narrow), "display:inline");
  // Clipped, not display:none, so a screen reader still reads the full words.
  assert.equal(ruleOf(style, ".brand .word,.person .name,.switch .full,.macchip .long", narrow), "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap");
  assert.match(ruleOf(style, ".me", narrow), /^margin-left:auto/, "the switch and my name stay on the menu's row");
  assert.match(ruleOf(style, ".person,.macchip", narrow), /min-width:44px/, "a name tag or a dot alone is still a 44px target");
  assert.match(ruleOf(style, "form>button"), /justify-self:start/, "a form's button keeps its own width instead of spanning the form");
});

test("U45: form fields are outlined at 3:1 or more against the panel and the page in both themes", async (t) => {
  const style = await styleOf(await team(t));
  assert.match(ruleOf(style, "textarea,input,select"), /border:1px solid var\(--field-line\)/);
  for (const dark of [false, true])
    for (const ground of ["panel", "bg"]) {
      const ratio = contrast(tokenOf(style, "field-line", dark), tokenOf(style, ground, dark));
      assert.ok(ratio >= 3, `--field-line on --${ground}${dark ? " (dark)" : ""}: ${ratio.toFixed(2)}:1`);
    }
});

test("U45: a Mac dot differs by shape: round when on, square when resting, a hollow ring when off", async (t) => {
  const style = await styleOf(await team(t));
  assert.match(ruleOf(style, ".rest .dot"), /border-radius:2px/);
  assert.doesNotMatch(ruleOf(style, ".on .dot"), /border-radius/, "on keeps the round .dot");
  assert.match(ruleOf(style, ".off .dot"), /background:transparent;border:2px solid/);
});

test("U45: the current menu item is underlined in the accent, like the current tab", async (t) => {
  const style = await styleOf(await team(t));
  assert.equal(ruleOf(style, "nav a[aria-current=page]"), "color:var(--fg);box-shadow:inset 0 -3px 0 var(--accent)");
});

test("U45: /members is one row per member; what changes a member sits in a 관리 fold", async (t) => {
  const h = await team(t);
  const page = (await h.get("/members", h.admin)).text;
  assert.doesNotMatch(page, /<table/, "a list, not a table");
  const rows = [...page.matchAll(/<li class="member">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 4, "admin, PL, B, C");
  for (const row of rows) {
    const fold = /<details class="manage"><summary>관리<\/summary>([\s\S]*)<\/details>/.exec(row);
    assert.ok(fold, "every member has a 관리 fold");
    assert.equal(row.replace(fold[0], "").includes("<form"), false, "no button outside the fold");
    assert.match(fold[1], /action="\/members\/[^"]+\/device-invite"/);
    assert.match(fold[1], /action="\/devices\/[^"]+\/revoke"><input type="hidden" name="csrf" value="[^"]+"><button class="secondary">기기 회수: test \(\d{4}\. \d{1,2}\. \d{1,2}\.까지\)<\/button>/, "the button names the browser and its day, so two browsers of one name differ");
    assert.match(row, /브라우저: test · \d{4}\. \d{1,2}\. \d{1,2}\.까지/, "the expiry is a day in the team's zone (teamDay)");
  }
  const revokes = rows.filter((r) => /action="\/members\/[^"]+\/revoke"><input type="hidden" name="csrf" value="[^"]+"><button class="danger">팀원 회수<\/button>/.test(r));
  assert.equal(revokes.length, 3, "every member but me can be revoked");
  const own = rows.find((r) => !/<button class="danger">팀원 회수/.test(r));
  assert.doesNotMatch(own, /팀원을 회수하면/, "my own row has no 팀원 회수, so its note does not speak of it");
  assert.ok(rows.filter((r) => r !== own).every((r) => /팀원을 회수하면/.test(r)));
  assert.match(page, /<h2>팀원 4명<\/h2>/);
});

test("U45: on /members a Mac button names the Mac, and a revoked member's row has no fold and no usable browser", async (t) => {
  const h = await team(t);
  h.pair(h.c, "C의 맥북");
  h.store.revokeMember(h.admin.member, h.b.member.id);
  const page = (await h.get("/members", h.admin)).text;
  assert.match(page, /<button class="secondary">Mac 해제: C의 맥북<\/button>/);
  const rowOf = (name) => [...page.matchAll(/<li class="member">([\s\S]*?)<\/li>/g)].map((m) => m[1]).find((r) => r.includes(`<span class="person">`) && new RegExp(`aria-hidden="true">[^<]*</span>${name}</span>`).test(r));
  const b = rowOf("B");
  assert.ok(b, "B's row");
  assert.doesNotMatch(b, /class="manage"/, "nothing to change on a revoked member");
  assert.match(b, /<span class="pill">회수됨<\/span>/);
  assert.match(b, /브라우저: test\(끊김\)/, "a revoked member's browser is no longer usable, whatever its own state");
  assert.doesNotMatch(b, /까지/);
  assert.match(page, /<h2>팀원 3명 · 회수됨 1명<\/h2>/);
});

test("U45: names with markup are escaped on /members and /repos", async (t) => {
  const h = await team(t);
  const evil = await h.enter(h.store.createInvite(h.admin.member, EVIL));
  const repo = h.store.addRepo(h.admin.member, EVIL, "https://github.example.com/team/evil");
  h.store.addOwner(h.admin.member, repo, h.store.session(evil.cookie.split("=")[1]).member.id);
  for (const path of ["/members", "/repos"]) {
    const page = (await h.get(path, h.admin)).text;
    assert.ok(!page.includes(EVIL), `${path} never prints the raw markup`);
    assert.ok(page.includes("&#60;img src=x onerror=alert(1)&#62;"), `${path} prints it escaped`);
  }
  assert.match((await h.get("/repos", h.admin)).text, /<button class="secondary">빼기: &#60;img src=x onerror=alert\(1\)&#62;<\/button>/);
});

test("U45: a repo with one owner offers no 빼기, and fold buttons wrap inside the column instead of running past it", async (t) => {
  const h = await team(t);
  const solo = h.store.addRepo(h.admin.member, "solo", "https://github.example.com/team/solo");
  const page = (await h.get("/repos", h.admin)).text;
  const row = new RegExp(`<li class="repo"><p><b>solo</b>([\\s\\S]*?)</li>`).exec(page)?.[1];
  assert.ok(row, "solo has a row");
  assert.doesNotMatch(row, /빼기/, "the only owner cannot be removed");
  assert.match(row, /연결된 Office: 없음/);
  void solo;
  const style = await styleOf(h);
  assert.equal(ruleOf(style, "details.manage form.inline"), "max-width:100%");
  assert.equal(ruleOf(style, "details.manage button"), "max-width:100%;min-width:0;overflow-wrap:anywhere;text-align:start;padding-block:6px", "a wrapped name keeps air above and below");
});

test("U45: /repos is one row per repo; owner and link changes sit in a 관리 fold that only owners and admins see", async (t) => {
  const h = await team(t);
  const asAdmin = (await h.get("/repos", h.admin)).text;
  assert.doesNotMatch(asAdmin, /<table/);
  const row = (text, name) => new RegExp(`<li class="repo"><p><b>${name}</b>([\\s\\S]*?)</li>`).exec(text)?.[1];
  const be = row(asAdmin, "app-be");
  assert.ok(be, "app-be has a row");
  assert.match(be, /<p>담당자: C, PL, 관리자<\/p>/, "owners by name");
  const fold = /<details class="manage"><summary>관리<\/summary>([\s\S]*)<\/details>/.exec(be);
  assert.ok(fold, "the admin manages every repo");
  assert.match(fold[1], /action="\/repos\/[^"]+\/owners"/, "add an owner");
  assert.match(fold[1], /<button class="secondary">빼기: PL<\/button>/, "the button names the owner");
  assert.equal(be.replace(fold[0], "").includes("<form"), false, "no button outside the fold");
  const asB = (await h.get("/repos", h.b)).text;
  assert.doesNotMatch(row(asB, "app-be"), /class="manage"/, "B owns app-fe only");
  assert.match(row(asB, "app-fe"), /class="manage"/);
});

// U46 (나 결정 카드, PR 2): both boards. Explainer: https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS
test("U46: 나를 기다리는 일 is one panel of rows split by lines, its titles plain links, two columns on a wide screen", async (t) => {
  const style = await styleOf(await team(t));
  assert.match(ruleOf(style, ".needs li"), /background:transparent/, "no tray inside the panel");
  assert.match(ruleOf(style, ".needs li"), /border-top:1px solid var\(--line\)/);
  assert.match(ruleOf(style, ".needs a"), /border:0/, "a title is a link, not a boxed button");
  assert.match(ruleOf(style, ".needs .ghead .count"), /background:var\(--tray\)/, "the count is a tray chip, not panel on panel");
  assert.match(ruleOf(style, ".needs a"), /min-height:44px/, "still a 44px target");
  assert.match(ruleOf(style, ".needs li", "@media (width > 860px)"), /grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)/, "what and why | the titles");
});

test("U46: on the board a failed Task's reason points to the Task page, not to a reason below", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "tests failed");
  const box = /<section class="needs"[\s\S]*?<\/section>/.exec((await h.get("/", h.pl)).text)[0];
  assert.doesNotMatch(box, /아래 이유를/, "nothing is below on the board");
  assert.match(box, /Task 화면에서 이유를 보고 메모와 함께 다시 시도하세요/);
  assert.match((await h.get(`/tasks/${s.tasks.a}`, h.c)).text, /아래 이유를 보고/, "the Task page keeps its own words for the one who retries");
  for (const path of ["/tasks", `/stories/${s.storyId}`]) {
    const text = (await h.get(path, h.pl)).text;
    assert.doesNotMatch(text, /아래 이유를/, `${path}: a failed card on a board has nothing below it`);
    assert.match(text, /<p class="why">AI가 세 번 시도했지만 끝내지 못했습니다\. Task 화면에서 이유를 보고/, path);
  }
});

test("U46: a Story card has no thick state bar; its state is its word", async (t) => {
  const style = await styleOf(await team(t));
  assert.doesNotMatch(ruleOf(style, ".scard"), /border-top/, "no 8px bar on a rounded card");
  for (const kind of ["need", "stop", "done"]) assert.ok(!new RegExp(`\\.scard\\.${kind}\\{[^}]*border-top`).test(style), kind);
  assert.doesNotMatch(style, /repeating-linear-gradient/, "a draft card has no ruled lines across its words");
});

test("U46: another member sees a web plan's question or draft as the PL's turn, not as theirs", async (t) => {
  const h = await team(t);
  const HOLDER = "c".repeat(32);
  const planId = h.plans.createPlan(h.pl.member, { projectId: h.projectId, title: "초안 기획", intent: "쿠폰", risk: "normal" }).planId;
  const l = h.plans.next(h.plBe, HOLDER);
  h.plans.result(h.plBe, HOLDER, planId, l.leaseId, l.revision, { kind: "draft", text: "# Story: 초안 기획\n", story: { title: "초안 기획" } });
  const cardOf = (text) => new RegExp(`<li class="scard draft"><p class="kind">웹 기획</p><a class="stitle" href="/plans/${planId}">초안 기획</a><p>(<span class="pill \\w+">[^<]*</span>)</p>`).exec(text)?.[1];
  assert.equal(cardOf((await h.get("/", h.pl)).text), '<span class="pill need">초안</span>', "the PL is asked");
  assert.equal(cardOf((await h.get("/", h.b)).text), '<span class="pill run">초안</span>', "B only watches it");
  const laneCard = (text) => new RegExp(`<li class="card (\\w+)"><a class="title" href="/plans/${planId}">초안 기획</a><p><span class="pill (\\w+)">초안</span>`).exec(text)?.slice(1).join(" ");
  assert.equal(laneCard((await h.get("/tasks", h.pl)).text), "need need", "/tasks: the PL is asked");
  assert.equal(laneCard((await h.get("/tasks", h.b)).text), "run run", "/tasks: B only watches it");
});

test("U46: on a wide screen an empty stage is a narrow rail, every stage still on one row", async (t) => {
  const style = await styleOf(await team(t));
  assert.match(ruleOf(style, ".stages"), /display:flex/);
  assert.match(ruleOf(style, ".stage"), /flex:1 1 0/);
  const wide = "@media (width > 860px)";
  assert.match(ruleOf(style, ".stage:has(>.scards:empty)", wide), /flex:0 0 56px/);
  assert.match(ruleOf(style, ".stage:has(>.scards:empty) h3", wide), /writing-mode:vertical-rl/);
  assert.match(ruleOf(style, ".stage>.scards:empty::before", wide), /content:none/, "a rail needs no 없음");
});

test("U46: the boards' heading is read, not shown twice above the tab of the same name", async (t) => {
  const h = await team(t);
  for (const [path, title] of [["/", "Story 보드"], ["/tasks", "모든 Task"]]) assert.ok((await h.get(path, h.pl)).text.includes(`<h1>${title}</h1>`), path);
  assert.equal(ruleOf(await styleOf(h), ".titlebar h1"), "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap");
});

// U47 (나 결정 카드, PR 3): the "지금 할 일" card on the Task, Story and /me pages. Explainer: https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS
const decideOf = (text) => /<section class="decide" aria-labelledby="decide">([\s\S]*?)<\/section>/.exec(text)?.[1] ?? null;
const otherOf = (text) => /<details class="other"><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/.exec(text);

test("U47: a failed Task's page opens with 지금 할 일: the reason and 다시 시도 first, 풀기 and 취소 folded under 다른 방법", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "tests failed");
  const page = (await h.get(`/tasks/${s.tasks.a}`, h.c)).text;
  const card = decideOf(page);
  assert.ok(card, "the assignee has something to do");
  assert.match(card, /<h2 id="decide">지금 할 일<\/h2>/);
  assert.match(card, /AI가 세 번 시도했지만 끝내지 못했습니다\. 아래 이유를 보고/, "the reason is below, inside the card");
  assert.match(card, /<details><summary>자세한 이유<\/summary><pre>tests failed<\/pre><\/details>/);
  assert.match(card, new RegExp(`<form method="post" action="/tasks/${s.tasks.a}/rerun">`), "다시 시도 is the card's action");
  const asPl = (await h.get(`/tasks/${s.tasks.a}`, h.pl)).text;
  const plCard = decideOf(asPl) ?? "";
  assert.match(plCard, new RegExp(`<form method="post" action="/tasks/${s.tasks.a}/release">`), "the PL's action: 풀기");
  const other = otherOf(plCard);
  assert.equal(other?.[1], "다른 방법");
  assert.match(other[2], new RegExp(`action="/tasks/${s.tasks.a}/cancel"`), "취소 folds");
  assert.equal(asPl.split(`/tasks/${s.tasks.a}/release"`).length, 2, "풀기 appears once");
});

test("U47: a Task whose Mac went silent gives its PL 풀기 as 지금 할 일; a running Task has no card and folds 취소 under 이 Task 바꾸기", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a", "b"]));
  const c = h.cBe();
  h.clock.board = -20 * 60_000;
  const held = h.board.claimNext(c);
  h.board.heartbeat(c, held.taskId, held.claimId, "build");
  h.clock.board = 0;
  const card = decideOf((await h.get(`/tasks/${held.taskId}`, h.pl)).text);
  assert.ok(card, "the PL can act on a silent Mac's Task");
  assert.match(card, new RegExp(`<form method="post" action="/tasks/${held.taskId}/release">`));
  assert.match(otherOf(card)?.[2] ?? "", new RegExp(`action="/tasks/${held.taskId}/cancel"`), "취소 is the other way");
  const b = h.linkOf(h.pl, h.be);
  const running = h.board.claimNext(b);
  h.board.heartbeat(b, running.taskId, running.claimId, "build");
  const page = (await h.get(`/tasks/${running.taskId}`, h.pl)).text;
  assert.equal(decideOf(page), null, "nothing waits on anyone while it runs");
  const fold = otherOf(page);
  assert.equal(fold?.[1], "이 Task 바꾸기");
  assert.match(fold[2], new RegExp(`action="/tasks/${running.taskId}/cancel"`));
});

test("U47: a ready Task the viewer may take shows 작업하기 as 지금 할 일", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  h.cBe();
  h.board.setAutoWork(h.c.member, false);
  const card = decideOf((await h.get(`/tasks/${s.tasks.a}`, h.c)).text);
  assert.ok(card, "C may pick it");
  assert.match(card, new RegExp(`action="/tasks/${s.tasks.a}/pick"`));
});

test("U47: a Story's page gives its PL 지금 할 일 for stopped Tasks and for the result approval, and nobody else", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "tests failed");
  const card = decideOf((await h.get(`/stories/${s.storyId}`, h.pl)).text);
  assert.ok(card, "the PL sees the stopped Task");
  assert.match(card, new RegExp(`<a href="/tasks/${s.tasks.a}">`));
  assert.match(card, /Task 화면에서 이유를 보고/, "the reason is on the Task page");
  assert.equal(decideOf((await h.get(`/stories/${s.storyId}`, h.b)).text), null, "B leads nothing here");
  const g4 = h.open(h.publish("승인 Story", ["a"]));
  advance(h, g4, "awaiting_g4");
  const approval = decideOf((await h.get(`/stories/${g4.storyId}`, h.pl)).text);
  assert.ok(approval?.includes(AWAITING_G4), "the result approval is the PL's to do, on their Mac");
});

test("U47: /me links each Task's Story, says where a failed Task's reason is, and puts a stopped Task of mine first as 지금 할 일", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "tests failed");
  const me = (await h.get("/me", h.c)).text;
  assert.match(me, new RegExp(`<a href="/stories/${s.storyId}">Story #${s.number} 쿠폰 발급</a>`));
  assert.doesNotMatch(me, /아래 이유를/, "only a link follows on /me");
  const card = decideOf(me);
  assert.ok(card?.includes("Task 화면에서 이유를 보고"), "my stopped Task is the card");
  assert.match(card, new RegExp(`<a href="/tasks/${s.tasks.a}">자세히·다시 시도</a>`));
});

test("U47: the card, the lists and the Story steps are drawn without trays", async (t) => {
  const style = await styleOf(await team(t));
  assert.match(ruleOf(style, "section.decide"), /border:2px solid var\(--need-bar\)/, "the waiting box's border: it waits on you");
  assert.match(ruleOf(style, ".decide form"), /background:none;padding:0/, "no form tray inside the card");
  assert.match(ruleOf(style, "ul.work>li"), /background:transparent/);
  assert.match(ruleOf(style, "ul.work>li"), /border-top:1px solid var\(--line\)/);
  assert.match(ruleOf(style, ".steps li"), /border-top:4px solid var\(--line\)/, "a step is a bar and its name, not a button");
  assert.doesNotMatch(ruleOf(style, ".steps li"), /background:var/);
  assert.match(ruleOf(style, ".steps li[aria-current=step]"), /border-top-color:var\(--fg\)/);
});

// U47 review 1: the card's invariants (I3), who it speaks to (I2), my silent Mac on /me (I1), the current step (m1).
const countOf = (text, part) => text.split(part).length - 1;
const silentClaim = (h, link) => {
  h.clock.board = -20 * 60_000;
  const claim = h.board.claimNext(link);
  h.board.heartbeat(link, claim.taskId, claim.claimId, "build");
  h.clock.board = 0;
  return claim;
};

test("U47: a stopped Task's reason shows once, in the card when there is one, otherwise in the head; one card per page", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "tests failed");
  for (const who of [h.c, h.pl, h.b]) {
    const page = (await h.get(`/tasks/${s.tasks.a}`, who)).text;
    assert.equal(countOf(page, "<summary>자세한 이유</summary>"), 1, `${who.member.name}: once`);
    assert.ok(countOf(page, 'id="decide"') <= 1, `${who.member.name}: one card at most`);
    const card = decideOf(page);
    if (card) assert.ok(card.includes("<summary>자세한 이유</summary>"), `${who.member.name}: in the card`);
  }
  assert.equal(decideOf((await h.get(`/tasks/${s.tasks.a}`, h.b)).text), null, "B can do nothing here");
});

test("U47: a lead who also holds the Task gets 다시 시도 as the card's action and 풀기 folded", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const claim = h.board.claimNext(h.plBe);
  h.board.reportFailed(h.plBe, claim.taskId, claim.claimId, "tests failed");
  const card = decideOf((await h.get(`/tasks/${s.tasks.a}`, h.pl)).text);
  assert.ok(card, "the PL holds it");
  const other = otherOf(card);
  assert.ok(card.indexOf(`/tasks/${s.tasks.a}/rerun"`) < card.indexOf("<details class=\"other\">"), "다시 시도 first");
  assert.match(other?.[2] ?? "", new RegExp(`/tasks/${s.tasks.a}/release"`), "풀기 folds");
});

test("U47: the card speaks to who reads it: the PL on someone else's failed Task, and a failed Story check", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const c = h.cBe();
  const claim = h.board.claimNext(c);
  h.board.reportFailed(c, claim.taskId, claim.claimId, "tests failed");
  const pl = decideOf((await h.get(`/tasks/${s.tasks.a}`, h.pl)).text);
  assert.match(pl, /AI가 세 번 시도했지만 끝내지 못했습니다\. 맡은 사람이 다시 시도할 수 있습니다\. 오래 멈춰 있으면 풀 수 있습니다\./);
  assert.doesNotMatch(pl, /메모와 함께 다시 시도하세요/, "the PL has no 다시 시도 here");
  assert.match(decideOf((await h.get(`/tasks/${s.tasks.a}`, h.c)).text), /아래 이유를 보고 메모와 함께 다시 시도하세요/, "the holder is told to retry");
  const v = h.open(h.publish("검증 Story", ["a"]));
  const tk = h.board.claimNext(h.plBe);
  h.board.mergeLock(h.plBe, tk.taskId, tk.claimId);
  h.board.reportMerged(h.plBe, tk.taskId, tk.claimId, merged());
  const check = h.board.claimVerify(h.plBe, v.storyId);
  h.board.reportVerify(h.plBe, check.taskId, check.claimId, { passed: false, summary: "e2e failed" });
  const verifyCard = decideOf((await h.get(`/tasks/${check.taskId}`, h.pl)).text) ?? "";
  assert.match(verifyCard, /고칠 Task는 내 Mac\(claude 대화\)에서 더하세요\. 풀기는 고치지 않고 다시 검증합니다\./);
  const storyCard = decideOf((await h.get(`/stories/${v.storyId}`, h.pl)).text) ?? "";
  assert.match(storyCard, /고칠 Task는 내 Mac\(claude 대화\)에서 더하세요\./);
  assert.doesNotMatch(storyCard, /PL이 고칠 Task를 더한 뒤/, "not in the third person to the PL");
});

test("U47: the Story card lists a Task whose Mac went silent, and the result approval reads once for everyone", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a"]));
  const held = silentClaim(h, h.cBe());
  const card = decideOf((await h.get(`/stories/${s.storyId}`, h.pl)).text) ?? "";
  assert.ok(card.includes(`<a href="/tasks/${held.taskId}">`) && card.includes(HELD_SHORT), "the silent Task and why");
  const g4 = h.open(h.publish("승인 Story", ["b"]));
  advance(h, g4, "awaiting_g4");
  for (const who of [h.pl, h.b, h.admin]) {
    const page = (await h.get(`/stories/${g4.storyId}`, who)).text;
    assert.equal(countOf(page, AWAITING_G4), 1, who.member.name);
    assert.equal(decideOf(page) !== null, who === h.pl, `${who.member.name}: the card is the PL's`);
  }
});

test("U47: on /me my Task whose Mac went silent says so and links its page", async (t) => {
  const h = await team(t);
  h.open(h.publish("쿠폰 발급", ["a"]));
  const held = silentClaim(h, h.cBe());
  const card = decideOf((await h.get("/me", h.c)).text) ?? "";
  assert.match(card, /내 Mac에서 10분 넘게 소식이 없습니다\. Mac을 켜면 이어서 합니다\./);
  assert.ok(card.includes(`<a href="/tasks/${held.taskId}">자세히</a>`));
});

test("U47: the step you are on is the bolder one", async (t) => {
  const style = await styleOf(await team(t));
  assert.match(ruleOf(style, ".steps li"), /font-weight:500/);
  assert.match(ruleOf(style, ".steps li[aria-current=step]"), /font-weight:700/);
  assert.match(ruleOf(style, ".steps li.past"), /border-top-color:var\(--done-bar\)/);
});
