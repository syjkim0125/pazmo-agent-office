import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";
import { plainFailure } from "../src/hub/story-pages.ts";
import { safePath } from "../src/hub/paths.ts";

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
async function team(t, { names = {}, text = (s) => s } = {}) {
  const clock = { board: 0, store: 0 };
  const h = await startTestHub(t, { now: () => Date.now() + clock.board, storeNow: () => Date.now() + clock.store });
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

test("slash is the board with five columns per Story", async (t) => {
  const h = await team(t);
  const s = h.open(h.publish("쿠폰 발급", ["a", "b", "c", "d"]));
  const c = h.cBe();
  const done = h.board.claimNext(c);
  h.board.mergeLock(c, done.taskId, done.claimId);
  h.board.reportMerged(c, done.taskId, done.claimId, merged());
  const doing = h.board.claimNext(c);
  h.board.heartbeat(c, doing.taskId, doing.claimId, "build");
  const page = await h.get("/", h.c);
  assert.equal(page.status, 200);
  for (const name of COLUMNS) assert.ok(page.text.includes(`>${name}<`), name);
  const lane = laneOf(page.text, s.number);
  assert.ok(colOf(lane, "done").includes(`/tasks/${done.taskId}`), "merged card in 완료");
  assert.ok(colOf(lane, "doing").includes(`/tasks/${doing.taskId}`), "claimed card in 진행 중");
  const rest = Object.values(s.tasks).filter((id) => ![done.taskId, doing.taskId].includes(id));
  for (const id of rest) assert.ok(colOf(lane, "todo").includes(`/tasks/${id}`), "ready cards in 할 일");
  h.board.heartbeat(c, doing.taskId, doing.claimId, "review");
  const again = laneOf((await h.get("/", h.c)).text, s.number);
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
  const lane = laneOf((await h.get("/", h.c)).text, pub.number);
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
  let card = colOf(laneOf((await h.get("/", h.pl)).text, s.number), "doing");
  assert.match(card, /에이/);
  assert.match(card, /일하는 중/);
  assert.match(card, /6분째/);
  h.clock.store = -240_000;
  h.store.macHeartbeat(mac, "working", null);
  h.clock.store = 0;
  card = colOf(laneOf((await h.get("/", h.pl)).text, s.number), "doing");
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
  const review = colOf(laneOf((await h.get("/", h.pl)).text, s.number), "review");
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
  const plain = laneOf((await h.get("/", h.c)).text, s.number);
  assert.ok(!plain.includes(`/tasks/${s.tasks.b}`), "hidden by default");
  assert.equal(strip(plain), null, "no strip without the toggle");
  assert.ok(colOf(plain, "todo").includes(`/tasks/${s.tasks.a}`));
  // On: it shows in the lane's muted 취소됨 strip under the five columns, linking to its Task page, and in no column.
  const shown = laneOf((await h.get("/?cancelled=1", h.c)).text, s.number);
  const cancelled = strip(shown);
  assert.ok(cancelled, "a 취소됨 strip");
  assert.match(cancelled, /취소됨/);
  assert.ok(cancelled.includes(`href="/tasks/${s.tasks.b}"`));
  assert.ok(!cancelled.includes(s.tasks.a), "a live card stays in its column");
  assert.ok(shown.indexOf('class="cancelled"') > shown.lastIndexOf('class="col"'), "under the five columns");
  for (const name of ["backlog", "todo", "doing", "review", "done"]) assert.ok(!colOf(shown, name).includes(s.tasks.b), name);
  // A cancelled Story's lane comes back with every card it cancelled.
  h.board.cancelStory({ member: h.pl.member }, s.storyId);
  assert.ok(!(await h.get("/", h.c)).text.includes(`/tasks/${s.tasks.a}`));
  const story = strip(laneOf((await h.get("/?cancelled=1", h.c)).text, s.number));
  for (const id of [s.tasks.a, s.tasks.b]) assert.ok(story.includes(`href="/tasks/${id}"`), id);
});

test("board escapes card text", async (t) => {
  const long = "가".repeat(120);
  const h = await team(t, { names: { pl: EVIL, c: EVIL }, text: (s) => `${EVIL}${s}` });
  h.open(h.publish(`${EVIL}${long}`, ["a"]));
  h.pair(h.c, EVIL);
  h.board.claimNext(h.cBe());
  const text = (await h.get("/", h.pl)).text;
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
  assert.match(page.text, /<td>PL<\/td>[\s\S]*?<span class="pill">꺼짐<\/span>/);
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
});

test("safePath keeps only known pages", () => {
  const id = "0123456789abcdef0123456789abcdef0123";
  for (const ok of ["/", "/board", "/me", "/team", "/mac", `/stories/${id}`, `/tasks/${id.replace(/./, "a")}`, `/plans/${id}`]) assert.equal(safePath(ok), ok, ok);
  for (const bad of [null, undefined, "", "x", "//evil", "/\\evil", "/board?x=1", "/stories/abc", "/%2Fevil", "/%2fevil", "/me\n", "/me\u0000", "https://evil.example/", `/${"a".repeat(300)}`, "/requests"])
    assert.equal(safePath(bad), null, String(bad));
});
