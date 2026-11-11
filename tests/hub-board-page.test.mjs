import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";
import { plainFailure } from "../src/hub/story-pages.ts";
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
  const words = [[done, "완료"], [g4, "승인 대기"], [ver, "Story 검증"], [open, "진행 중"]];
  for (const [s, word] of words) {
    const lane = laneOf(text, s.number);
    assert.ok(lane.includes(word), `#${s.number} says ${word}`);
    assert.ok(lane.includes("리더"), "PL name");
    assert.ok(lane.includes(`/stories/${s.storyId}`), "story link");
  }
  assert.ok(laneOf(text, open.number).includes("에이"), "C works on a Task of the open Story");
  assert.equal((laneOf(text, open.number).match(/에이/g) ?? []).length >= 1, true);
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
  assert.ok(pl.includes(`<a href="/stories/${g4.storyId}"><span class="pill need">승인 대기</span>`), "the Story waiting for its result approval");
  assert.ok(pl.includes(`<a href="/tasks/${claim.taskId}"><span class="pill stop">멈춤(실패)</span>`), "a stopped Task of the PL's Story");
  assert.ok(pl.includes(plainFailure("RUNNER_LIMIT claude: usage limit", "work")));
  assert.ok(pl.includes(`<a href="/plans/${planId}"><span class="pill need">초안</span>`), "the PL's draft to read");

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
  assert.match(header, /^<header><a class="brand" href="\/"><span class="logo" aria-hidden="true"><\/span>Pazmo 팀 허브<\/a>/);
  assert.match(header, /<a class="person" href="\/me"><span class="av av[0-7]" aria-hidden="true">C<\/span>C<\/a>/);
  assert.ok(header.includes('<button class="switch" aria-pressed="true"><span class="track" aria-hidden="true"></span>자동으로 일하기 켜짐</button>'));
  assert.ok(header.endsWith('<a class="macchip off" href="/mac"><span class="dot" aria-hidden="true"></span>내 Mac: 연결된 Mac 없음</a></div></header>'));
  const mac = h.pair(h.c);
  for (const [state, tone] of [["working", "on"], ["idle", "on"], ["limited", "rest"], ["locked", "rest"]]) {
    h.store.macHeartbeat(mac, state, null);
    assert.match((await h.get("/", h.c)).text, new RegExp(`<a class="macchip ${tone}" href="/mac">`), state);
  }
});

test("an empty project says what comes next", async (t) => {
  const h = await team(t);
  h.board.createProject(h.plBe, "빈 프로젝트", [{ repoId: h.be, baseBranch: "main" }]);
  const empty = (text) => /<h2>빈 프로젝트<\/h2>[\s\S]*?<p class="empty">([^<]*)<\/p>/.exec(text)?.[1];
  assert.equal(empty((await h.get("/", h.pl)).text), "아직 Story가 없습니다. [새 Story]로 하고 싶은 일을 적으면 AI가 묻고 정리해 Task로 나눕니다.");
  assert.equal(empty((await h.get("/", h.b)).text), "아직 Story가 없습니다. 이 프로젝트의 레포를 모두 맡은 사람이 Story를 올리면 여기에 보입니다.");
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
  assert.ok(stageOf(text, "planning").body.includes(`<li class="scard draft"><p class="kind">웹 기획</p><a class="stitle" href="/plans/${planId}">웹 기획</a><p><span class="pill run">기획 대기</span></p><p class="sprog">아직 Task 없음</p>`), "a web plan looks like a draft");
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
  assert.ok(box.includes(`<a href="/tasks/${k.taskId}"><span class="pill stop">멈춤(Mac 소식 없음)</span><span><b>a 작업</b> <span class="muted">Story #${s.number}</span> 맡은 사람의 Mac에서 10분 넘게 소식이 없습니다.</span></a>`));
  assert.ok(box.includes(`<a href="/plans/${planId}"><span class="pill stop">멈춤</span><span><b>멈춘 기획</b> 기획이 멈췄습니다. 기획 화면에서 이유를 보고 다시 시도하세요.</span></a>`));
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
  assert.match(style, /\.stages\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(/, "stage columns wrap before they are too narrow");
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
