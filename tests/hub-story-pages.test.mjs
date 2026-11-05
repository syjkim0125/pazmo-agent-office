import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { HubStore, MAC_OFFLINE_MS } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { HELD_AFTER_MS } from "../src/hub/story-protocol.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";
import { DEFAULT_OFFICE_REF, DEFAULT_OFFICE_REPO } from "../src/hub/installer.ts";
import { inTime, plainFailure, storyStateLabel, taskStateLabel, waitText } from "../src/hub/story-pages.ts";
import { startTestHub } from "./hub-fixture.mjs";

const PUBLIC = "https://pazmo-hub.apps.example.com";
const SHA = "c0ffee".padEnd(40, "0");
const PR = "https://github.example.com/team/app-be/pull/7";
const OFF_PILL = '<a class="pill" href="/">자동으로 일하기 꺼짐</a>';
const NOT_LINKED = "이 레포는 아직 내 Mac에 연결되지 않았습니다";
const NUDGE = "이 Mac 연결 — 처음 한 번, 명령 한 줄";
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const pill = (word) => `<span class="pill">${word}</span>`;
const merged = (over = {}) => ({ prUrl: PR, mergeCommit: SHA, summary: "s", assumptions: [], ...over });

/**
 * A LAN hub with a Story board and hub-story-fixture's team, every member signed in: PL owns app-be and app-fe, B owns
 * app-fe, C owns app-be. No member has a link until a test makes one with `linkOf`. `story()` publishes and opens
 * api(be) → ui(fe), copy(be); `names`/`text` let the escaping test put untrusted text everywhere.
 */
async function team(t, { now, storeNow, names = {}, text = (s) => s } = {}) {
  const h = await startTestHub(t, { now, storeNow });
  const { store, board, call, enter } = h;
  const signIn = async (raw) => {
    const w = await enter(raw);
    return { ...w, member: store.session(w.cookie.split("=")[1]).member };
  };
  const admin = await signIn(store.bootstrapAdmin());
  const join = (name) => signIn(store.createInvite(admin.member, name));
  const pl = await join(names.pl ?? "PL"), b = await join("B"), c = await join(names.c ?? "C");
  const be = store.addRepo(admin.member, text("app-be"), "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin.member, "app-fe", "git@github.example.com:team/app-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [b, fe], [c, be]]) store.addOwner(admin.member, r, m.member.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe" };
  // A new pair for the same (member, repo) revokes the previous token, so tests keep the Link they got.
  const linkOf = (who, r) => store.link(store.pair(store.createLinkCode(who.member, r), remote[r]).token);
  const node = (id, repoId, files) => ({ id, repoId, title: text(`${id} 작업`), spec: text(`${id} 설명`), files, verify: [check] });
  function story() {
    const plBe = linkOf(pl, be);
    const { projectId } = board.createProject(plBe, text("쿠폰 개편"), [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]);
    const pub = board.publishStory(plBe, {
      projectId, title: text("쿠폰 발급"), body: text("# Story\n본문"), risk: "normal", key: "k1",
      graph: { nodes: [node("api", be, [text("src/api.ts")]), node("ui", fe, ["src/ui.ts"]), node("copy", be, ["README.md"])], edges: [{ from: "api", to: "ui" }] },
      storyVerify: [{ repoId: be, checks: [check] }],
    });
    board.openStory(plBe, pub.storyId);
    const id = (n) => pub.tasks.find((x) => x.nodeId === n);
    return { plBe, projectId, storyId: pub.storyId, number: pub.number, api: id("api").taskId, ui: id("ui").taskId, copy: id("copy").taskId, verify: pub.tasks.at(-1).taskId, apiNo: id("api").number };
  }
  const get = (path, who) => call("GET", path, { cookie: who.cookie });
  const claimOf = (l) => board.inbox(l).mine.claimId;
  return { ...h, admin, pl, b, c, be, fe, linkOf, story, get, claimOf };
}

/** A hub behind the OpenShift router, with or without a Story board and the installer; `admin` is signed in. */
async function proxied(t, { withBoard = true, installer = false } = {}) {
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const board = new StoryBoard(db);
  const hub = await startHubServer(
    {
      store,
      ...(withBoard ? { board } : {}),
      listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 },
      ...(installer ? { installer: { officeRepo: DEFAULT_OFFICE_REPO, officeRef: DEFAULT_OFFICE_REF } } : {}),
    },
    linkApi(store, board),
  );
  t.after(() => hub.close());
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac");
  const cookie = `pazmo_hub=${admin.session}`;
  const get = (path) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: hub.port, method: "GET", path, headers: { host: "pazmo-hub.apps.example.com", cookie } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end();
    });
  return { store, board, get, admin: admin.member };
}
/** Starts a Mac, lets `member` allow it and takes its token: the Mac is then live for that member. */
function pairMac(store, member, name = "내 Mac") {
  const started = store.startMac(name);
  store.approveMac(member, started.userCode);
  return store.mac(store.pollMac(started.deviceCode).macToken);
}

test("/ is the member's work page with the four sections, and the request board moved to /requests with its view tabs", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");

  const home = await h.get("/", h.pl);
  assert.equal(home.status, 200);
  assert.match(home.text, /<h1>내 할 일<\/h1>/);
  for (const title of ["지금 맡은 일", "받을 수 있는 일", "내 Story에서 멈춘 일", "끝낸 일"]) assert.match(home.text, new RegExp(`<h2>${title}</h2>`), title);
  assert.ok(home.text.includes(`href="/tasks/${s.api}"`), "the PL's failed Task is under 내 Story에서 멈춘 일");
  assert.ok(home.text.includes(`href="/tasks/${s.copy}"`), "copy is ready in the PL's repo");
  assert.match(home.text, /<nav><a href="\/">내 할 일<\/a><a href="\/board">보드<\/a><a href="\/repos">레포<\/a><a href="\/requests">요청 게시판<\/a><a href="\/start">내 Office 연결<\/a>/);
  assert.match((await h.get("/", h.admin)).text, /<a href="\/repos">레포<\/a><a href="\/members">팀원·초대<\/a><a href="\/requests">요청 게시판<\/a>/);

  const mine = (await h.get("/", h.c)).text;
  assert.doesNotMatch(mine, /내 Story에서 멈춘 일/, "only shown to a PL with a stuck Task");
  assert.ok(mine.includes(`href="/tasks/${s.api}"`), "C's open Task");
  const empty = (await h.get("/", h.b)).text;
  for (const line of ["지금 맡은 일이 없습니다.", "지금 받을 수 있는 일이 없습니다.", "아직 끝낸 일이 없습니다."]) assert.ok(empty.includes(line), line);

  const board = await h.get("/requests", h.pl);
  assert.equal(board.status, 200);
  assert.match(board.text, /<h2>요청 게시판<\/h2>/);
  assert.match(board.text, /<b>전체<\/b> · <a href="\/requests\?view=mine">내 요청·맡은 일<\/a> · <a href="\/requests\?view=repos">내 레포<\/a>/);
  assert.match((await h.get("/requests?view=mine", h.pl)).text, /<b>내 요청·맡은 일<\/b>/);
  assert.match((await h.get("/requests?view=repos", h.pl)).text, /<b>내 레포<\/b>/);
});

test("a hub without a board keeps the request board at / and answers 404 for /board, /stories/<id> and /tasks/<id>", async (t) => {
  const h = await proxied(t, { withBoard: false });
  const home = await h.get("/");
  assert.equal(home.status, 200);
  assert.match(home.text, /<h2>요청 게시판<\/h2>/);
  assert.doesNotMatch(home.text, /내 할 일|href="\/board"|자동으로 일하기/, "no work pages in the menu");
  assert.match(home.text, /<a href="\/requests">요청 게시판<\/a>/);
  assert.match((await h.get("/requests?view=mine")).text, /<b>내 요청·맡은 일<\/b>/);
  for (const path of ["/board", `/stories/${randomUUID()}`, `/tasks/${randomUUID()}`]) {
    const res = await h.get(path);
    assert.equal(res.status, 404, path);
    assert.match(res.text, /페이지를 찾을 수 없습니다\./, path);
  }
});

test("home shows the Mac nudge only when the hub installs Macs and the member has none", async (t) => {
  const os = await proxied(t, { installer: true });
  const first = (await os.get("/")).text;
  assert.ok(first.includes(NUDGE), "OpenShift with the installer and no Mac");
  assert.ok(first.indexOf(NUDGE) < first.indexOf("<h1>내 할 일</h1>"), "at the top");
  assert.ok(first.includes('<a href="/mac">이 Mac 연결</a>'));
  pairMac(os.store, os.admin);
  assert.ok(!(await os.get("/")).text.includes(NUDGE), "a Mac is connected");
  const plain = await proxied(t, {});
  assert.ok(!(await plain.get("/")).text.includes(NUDGE), "no installer behind the router");
  const lan = await team(t);
  assert.ok(!(await lan.get("/", lan.c)).text.includes(NUDGE), "the self-CA hub has no one-line install");
});

test("a ready Task shows 작업하기 only with auto work off, a live link and no open Task; not-linked says so and links /mac", async (t) => {
  const h = await team(t);
  const s = h.story();
  const pickForm = (id) => `<form class="inline" method="post" action="/tasks/${id}/pick"><input type="hidden" name="csrf" value="${h.c.csrf}"><button class="">작업하기</button></form>`;
  const notLinked = `<a href="/mac">${NOT_LINKED}</a>`;

  let home = (await h.get("/", h.c)).text;
  assert.ok(home.includes(notLinked), "C owns app-be but has no link to it");
  assert.ok(!home.includes(`/tasks/${s.api}/pick`));
  let task = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(task.includes(notLinked), "the Task page says it too");
  assert.ok(!task.includes(`/tasks/${s.api}/pick`));

  h.linkOf(h.c, h.be);
  home = (await h.get("/", h.c)).text;
  assert.ok(!home.includes(NOT_LINKED));
  assert.ok(!home.includes("/pick"), "auto work is on: the Mac takes it anyway");
  task = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(task.includes("자동으로 일하기가 켜져 있어 내 Mac이 차례대로 가져갑니다."));
  assert.ok(!task.includes("/pick"));

  h.board.setAutoWork(h.c.member, false);
  home = (await h.get("/", h.c)).text;
  assert.ok(home.includes(pickForm(s.api)) && home.includes(pickForm(s.copy)), "both ready be Tasks");
  task = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(task.includes(pickForm(s.api)));
  assert.ok(!task.includes("자동으로 일하기가 켜져 있어"));
  assert.ok(!(await h.get(`/tasks/${s.ui}`, h.c)).text.includes("/pick"), "ui is waiting in someone else's repo");

  h.board.pickTask(h.c.member, s.copy, h.store.liveLinkRepos(h.c.member.id));
  home = (await h.get("/", h.c)).text;
  assert.ok(!home.includes("/pick"), "C holds copy now");
  assert.ok(home.includes(`href="/tasks/${s.api}"`), "api is still listed as ready");
  assert.ok(!(await h.get(`/tasks/${s.api}`, h.c)).text.includes("/pick"));
});

test("the header carries 자동으로 일하기 꺼짐 on every page only while auto work is off", async (t) => {
  const h = await team(t);
  const s = h.story();
  const paths = ["/", "/board", "/requests", "/repos", "/start", "/mac", `/stories/${s.storyId}`, `/tasks/${s.api}`];
  for (const path of paths) assert.ok(!(await h.get(path, h.c)).text.includes(OFF_PILL), `on: ${path}`);
  let home = (await h.get("/", h.c)).text;
  assert.ok(home.includes("켜져 있어 내 Mac이 받을 수 있는 일을 차례대로 가져갑니다."));
  assert.ok(home.includes(`<form class="inline" method="post" action="/me/auto-work"><input type="hidden" name="csrf" value="${h.c.csrf}"><input type="hidden" name="on" value="0"><button class="secondary">끄기</button></form>`));

  h.board.setAutoWork(h.c.member, false);
  for (const path of paths) {
    const nav = /<nav>.*<\/nav>/.exec((await h.get(path, h.c)).text)[0];
    assert.ok(nav.includes(OFF_PILL), `off: ${path}`);
  }
  home = (await h.get("/", h.c)).text;
  assert.ok(home.includes("꺼져 있어 새 일을 받지 않습니다. 아래에서 직접 고를 수 있습니다."));
  assert.ok(home.includes(`<input type="hidden" name="on" value="1"><button>켜기</button>`));
  assert.ok(!(await h.get("/", h.b)).text.includes(OFF_PILL), "the switch is each member's own");
});

test("the board lists projects with Story progress; the Story page lists every Task with its state word and stage", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  h.board.reportMerged(cBe, api.taskId, api.claimId, merged());
  const copy = h.board.claimNext(cBe);
  h.board.heartbeat(cBe, copy.taskId, copy.claimId, "build");

  const board = (await h.get("/board", h.b)).text;
  assert.match(board, /<h2>쿠폰 개편<\/h2>/);
  assert.match(board, /app-be \(main\), app-fe \(develop\)/);
  assert.ok(board.includes(`<tr><td>#${s.number}</td><td><a href="/stories/${s.storyId}">쿠폰 발급</a></td><td>${pill("진행 중")}</td><td>1/3</td><td>0</td><td>PL</td></tr>`));
  assert.ok(board.includes('<a href="/board">새로 고침</a>'));

  const page = (await h.get(`/stories/${s.storyId}`, h.b)).text;
  assert.match(page, /<h1>쿠폰 발급<\/h1>/);
  assert.ok(page.includes(pill("진행 중")));
  assert.ok(page.includes("<pre># Story\n본문</pre>"));
  assert.ok(page.includes("PL: PL"));
  assert.ok(page.includes(`<tr><td>app-be</td><td>main</td><td>feature/story-${s.number}/base</td></tr>`));
  assert.ok(page.includes(`<tr><td>app-fe</td><td>develop</td><td>feature/story-${s.number}/base</td></tr>`));
  const row = (id) => new RegExp(`<tr><td>#\\d+</td><td>[^<]*</td><td><a href="/tasks/${id}">[^<]+</a></td><td><span class="pill">([^<]+)</span></td><td>([^<]*)</td><td>(.*?)</td><td>(.*?)</td></tr>`).exec(page);
  const [, apiWord, apiWho, , apiPr] = row(s.api);
  assert.deepEqual([apiWord, apiWho], ["완료", "C"]);
  assert.ok(apiPr.includes(`<a href="${PR}" rel="noreferrer">`), "PR link");
  const [, uiWord, , uiDeps] = row(s.ui);
  assert.equal(uiWord, "할 일");
  assert.ok(uiDeps.includes(`<a href="/tasks/${s.api}">#${s.apiNo}</a>`), "the Task before it");
  assert.deepEqual(row(s.copy).slice(1, 3), ["진행 중(구현)", "C"]);
  assert.equal(row(s.verify)[1], "앞 Task 기다림");
  assert.ok(page.includes(`<a href="/stories/${s.storyId}">새로 고침</a>`));
});

test("state words: ready 할 일, claimed with stage build 진행 중(구현), merge 머지 중, held 멈춤(Mac 소식 없음), failed 멈춤(실패), merged 완료", async (t) => {
  let now = Date.now();
  const h = await team(t, { now: () => now });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const word = async (id = s.api) => {
    const text = (await h.get(`/tasks/${id}`, h.pl)).text;
    return /<p class="state"><span class="pill">([^<]+)<\/span>/.exec(text)[1];
  };
  assert.equal(await word(), "할 일");
  const api = h.board.claimNext(cBe);
  assert.equal(await word(), "시작 중");
  for (const [stage, label] of [["build", "진행 중(구현)"], ["review", "진행 중(리뷰)"], ["verify", "진행 중(검증)"], ["merge", "머지 중"]]) {
    h.board.heartbeat(cBe, api.taskId, api.claimId, stage);
    assert.equal(await word(), label, stage);
  }
  now += HELD_AFTER_MS + 1;
  assert.equal(await word(), "멈춤(Mac 소식 없음)");
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  assert.equal(await word(), "멈춤(실패)");
  h.board.releaseTask(s.plBe, s.api);
  const again = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, again.taskId, again.claimId);
  h.board.reportMerged(cBe, again.taskId, again.claimId, merged());
  assert.equal(await word(), "완료");
  h.board.cancelTask(s.plBe, s.copy);
  assert.equal(await word(s.copy), "취소됨");
  assert.equal(await word(s.verify), "앞 Task 기다림");

  const words = [
    [["waiting", null], "앞 Task 기다림"], [["ready", null], "할 일"], [["claimed", null], "시작 중"],
    [["claimed", "build"], "진행 중(구현)"], [["claimed", "review"], "진행 중(리뷰)"], [["claimed", "verify"], "진행 중(검증)"],
    [["claimed", "merge"], "머지 중"], [["held", "merge"], "멈춤(Mac 소식 없음)"], [["failed", null], "멈춤(실패)"],
    [["merged", null], "완료"], [["passed", null], "검증 통과"], [["cancelled", null], "취소됨"],
  ];
  for (const [[state, stage], label] of words) assert.equal(taskStateLabel(state, stage), label, `${state}/${stage}`);
  const stories = { draft: "준비 중", open: "진행 중", verifying: "Story 검증 중", awaiting_g4: "승인 대기", done: "완료", cancelled: "취소됨" };
  for (const [state, label] of Object.entries(stories)) assert.equal(storyStateLabel(state), label, state);
});

test("a failed Task shows the plain reason for RUNNER_LIMIT, a closed PR, a conflict and the default, with the raw reason under 자세한 이유", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  let claimId = h.board.claimNext(cBe).claimId;
  const cases = [
    ["RUNNER_LIMIT claude: usage limit reached", "AI 사용 한도가 6시간 안에 풀리지 않았습니다. 한도가 풀린 뒤 다시 시도하세요."],
    ["PR #7 was closed on GitHub; reopen it, then run team rerun", "GitHub에서 이 Task의 PR이 닫혔습니다. PR을 다시 연 뒤 다시 시도하세요."],
    [`Merging feature/story-${s.number}/base into the Task branch left a conflict.`, "Story base와 합치다 충돌이 났습니다. 다시 시도하면 AI가 충돌을 풀며 처음부터 합니다."],
    ["V1 failed three times", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
  ];
  for (const [reason, plain] of cases) {
    h.board.reportFailed(cBe, s.api, claimId, reason);
    const page = (await h.get(`/tasks/${s.api}`, h.pl)).text;
    assert.ok(page.includes(plain), reason);
    assert.ok(page.includes(`<details><summary>자세한 이유</summary><pre>${reason}</pre></details>`), reason);
    const home = (await h.get("/", h.c)).text;
    assert.ok(home.includes(plain), `home: ${reason}`);
    assert.ok(home.includes(`<a href="/tasks/${s.api}">자세히·다시 시도</a>`));
    assert.ok((await h.get("/", h.pl)).text.includes(plain), "the PL's stuck list says it too");
    h.board.rerunTask(h.c.member, s.api, "");
    claimId = h.claimOf(cBe);
  }
});

test("a Task that failed, was released and is claimed again shows no failure text", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  const plain = "AI 사용 한도가 6시간 안에 풀리지 않았습니다.";
  h.board.reportFailed(cBe, api.taskId, api.claimId, "RUNNER_LIMIT claude: usage limit reached");
  assert.ok((await h.get(`/tasks/${s.api}`, h.c)).text.includes(plain));
  h.board.releaseTask(s.plBe, s.api);
  for (const [path, who] of [[`/tasks/${s.api}`, h.c], ["/", h.c], ["/", h.pl], [`/stories/${s.storyId}`, h.pl]]) {
    const text = (await h.get(path, who)).text;
    assert.ok(!text.includes(plain) && !text.includes("자세한 이유") && !text.includes("자세히·다시 시도"), `ready: ${path}`);
  }
  assert.equal(h.board.claimNext(cBe).taskId, s.api);
  for (const [path, who] of [[`/tasks/${s.api}`, h.c], [`/tasks/${s.api}`, h.pl], ["/", h.c], ["/", h.pl]]) {
    const text = (await h.get(path, who)).text;
    assert.ok(!text.includes(plain) && !text.includes("자세한 이유") && !text.includes("자세히·다시 시도"), `claimed: ${path}`);
  }
});

test("a limited assignee Mac shows '사용 한도라 쉬는 중' with '약 25분 뒤' from until; an off Mac shows no wait text", async (t) => {
  let skew = 0;
  const h = await team(t, { storeNow: () => Date.now() + skew });
  const s = h.story();
  h.board.claimNext(h.linkOf(h.c, h.be));
  const mac = pairMac(h.store, h.c.member, "C의 Mac");
  h.store.macHeartbeat(mac, "limited", "claude: limit", Date.now() + 25 * 60_000 + 20_000);
  const wait = "AI 사용 한도라 쉬는 중입니다. 약 25분 뒤 다시 시도합니다.";
  assert.ok((await h.get(`/tasks/${s.api}`, h.pl)).text.includes(wait), "the Task page names the assignee's wait");
  assert.ok((await h.get("/", h.c)).text.includes(wait), "and so does the assignee's own open Task");
  assert.ok(!(await h.get(`/tasks/${s.copy}`, h.pl)).text.includes("쉬는 중입니다"), "a Task nobody holds");
  skew = MAC_OFFLINE_MS + 1000;
  for (const [path, who] of [[`/tasks/${s.api}`, h.pl], ["/", h.c]]) assert.ok(!(await h.get(path, who)).text.includes("쉬는 중입니다"), path);
});

test("a held Task says the Mac is silent and, when the assignee's Mac is off, when it was last seen", async (t) => {
  let now = Date.now();
  const h = await team(t, { now: () => now });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  h.board.claimNext(cBe);
  now += HELD_AFTER_MS + 1;
  const held = "맡은 사람의 Mac에서 10분 넘게 소식이 없습니다. Mac이 켜지면 이어서 합니다. 오래 멈춰 있으면 PL이 풀 수 있습니다.";
  let page = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(page.includes(held));
  assert.ok(!page.includes("꺼짐"), "C has no Mac at all");
  pairMac(h.store, h.c.member);
  page = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(page.includes(`${held} (내 Mac: 꺼짐, 마지막 확인 아직 없음)`), "the assignee's own Mac");
  assert.ok((await h.get(`/tasks/${s.api}`, h.pl)).text.includes(`${held} (맡은 사람의 Mac: 꺼짐, 마지막 확인 아직 없음)`), "seen by the PL");
});

test("a merged Task shows the summary, the decision lines with ASSUMED in bold and the PR link", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  const summary = "[변경사항]\n1. 작업: api\n2. 변경 파일: src/api.ts\n3. 확인: V1 통과";
  h.board.reportMerged(cBe, api.taskId, api.claimId, merged({ summary, assumptions: ["ASSUMED: 쿠폰 코드는 대문자", "기존 응답 형식을 유지"] }));
  const page = (await h.get(`/tasks/${s.api}`, h.b)).text;
  assert.ok(page.includes(`<pre>${summary}</pre>`));
  assert.ok(page.includes("<li><b>ASSUMED: 쿠폰 코드는 대문자</b></li><li>기존 응답 형식을 유지</li>"));
  assert.ok(page.includes(`<a href="${PR}" rel="noreferrer">${PR}</a>`));
  assert.ok(page.includes(`<code>${SHA.slice(0, 12)}</code>`) && !page.includes(SHA), "the merge commit's first 12 characters");
  assert.ok(page.includes("<pre>api 설명</pre>") && page.includes("<li><code>src/api.ts</code></li>"), "what the Task was");
  const ui = (await h.get(`/tasks/${s.ui}`, h.b)).text;
  assert.ok(ui.includes(`<li><a href="/tasks/${s.api}">#${s.apiNo} api 작업</a> ${pill("완료")}</li>`), "the Task before it, with its state");
  const done = (await h.get("/", h.c)).text;
  assert.ok(/<h2>끝낸 일<\/h2>[\s\S]*href="\/tasks\//.test(done) && done.includes(`<a href="${PR}" rel="noreferrer">`), "under 끝낸 일 with the PR");
});

test("buttons follow taskActions: the assignee sees 다시 시도 on a failed Task, the PL and an admin see 풀기 and 취소, another member sees none", async (t) => {
  let now = Date.now();
  const h = await team(t, { now: () => now });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  h.board.rerunTask(h.c.member, s.api, "범위를 줄여 주세요");
  h.board.reportFailed(cBe, s.api, h.claimOf(cBe), "tests failed again");
  const rerun = `<form method="post" action="/tasks/${s.api}/rerun"><input type="hidden" name="csrf" value="${h.c.csrf}"><label>메모 <span class="muted">(선택, 2000자까지)</span><textarea name="memo" rows="3" maxlength="2000"></textarea></label><div class="row"><button>다시 시도</button></div></form>`;
  const releaseLine = "풀면 이 Task는 다시 '할 일'이 되고 누구든 처음부터 다시 받습니다.".replaceAll("'", "&#39;");
  const cancel = (who, id) => `<form method="post" action="/tasks/${id}/cancel"><input type="hidden" name="csrf" value="${who.csrf}"><p>취소하면 이 Task는 하지 않고, 뒤 Task는 이것 없이 진행합니다.</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div></form>`;

  const mine = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(mine.includes(rerun), "the assignee's rerun form");
  assert.ok(mine.includes("<h2>마지막 메모</h2><pre>범위를 줄여 주세요</pre>"));
  assert.ok(!mine.includes("/release") && !mine.includes("/cancel"));
  for (const who of [h.pl, h.admin]) {
    const page = (await h.get(`/tasks/${s.api}`, who)).text;
    assert.ok(page.includes(`<form method="post" action="/tasks/${s.api}/release"><input type="hidden" name="csrf" value="${who.csrf}"><p>${releaseLine}</p><div class="row"><button class="secondary">풀기</button></div></form>`), "release");
    assert.ok(page.includes(cancel(who, s.api)), "cancel");
    assert.ok(!page.includes("/rerun"), "only the assignee reruns");
  }
  const other = (await h.get(`/tasks/${s.api}`, h.b)).text;
  assert.doesNotMatch(other, /action="\/tasks\//, "B has no button");

  // A held Task that holds its merge lock: releasing may cut a merge short, so the PL is told.
  const copy = h.board.claimNext(s.plBe);
  h.board.mergeLock(s.plBe, copy.taskId, copy.claimId);
  now += HELD_AFTER_MS + 1;
  const page = (await h.get(`/tasks/${s.copy}`, h.admin)).text;
  assert.ok(page.includes(`<p>${releaseLine} 머지 중이었을 수 있습니다.</p>`));
  assert.ok(!(await h.get(`/tasks/${s.api}`, h.admin)).text.includes("머지 중이었을 수 있습니다."), "api holds no lock");
  // An ended Task has nothing to cancel, and the Story verification is never cancelled from here.
  assert.ok(!(await h.get(`/tasks/${s.verify}`, h.pl)).text.includes("/cancel"));
});

test("untrusted text is escaped on the work, board, Story and Task pages", async (t) => {
  const EVIL = "<img src=x onerror=alert(1)>";
  const SAFE = "&#60;img src=x onerror=alert(1)&#62;";
  const h = await team(t, { names: { pl: `PL ${EVIL}`, c: `C ${EVIL}` }, text: (s) => `${s} ${EVIL}` });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  h.board.reportMerged(cBe, api.taskId, api.claimId, merged({ summary: `요약 ${EVIL}`, assumptions: [`ASSUMED: ${EVIL}`, `판단 ${EVIL}`] }));
  const copy = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, copy.taskId, copy.claimId, `RUNNER_LIMIT ${EVIL}`);
  h.board.rerunTask(h.c.member, s.copy, `메모 ${EVIL}`);
  h.board.reportFailed(cBe, s.copy, h.claimOf(cBe), `conflict ${EVIL}`);
  const pages = [["/", h.c], ["/", h.pl], ["/board", h.b], [`/stories/${s.storyId}`, h.b], [`/tasks/${s.api}`, h.b], [`/tasks/${s.copy}`, h.c], [`/tasks/${s.ui}`, h.pl]];
  for (const [path, who] of pages) {
    const text = (await h.get(path, who)).text;
    assert.ok(!text.includes("<img"), `${path} has no raw markup`);
    assert.ok(text.includes(SAFE), `${path} shows the escaped text`);
  }
  const failed = (await h.get(`/tasks/${s.copy}`, h.c)).text;
  for (const part of [`conflict ${SAFE}`, `메모 ${SAFE}`, `C ${SAFE}`]) assert.ok(failed.includes(part), part);
  const done = (await h.get(`/tasks/${s.api}`, h.b)).text;
  for (const part of [`요약 ${SAFE}`, `<b>ASSUMED: ${SAFE}</b>`, `판단 ${SAFE}`, `api 작업 ${SAFE}`, `api 설명 ${SAFE}`, `src/api.ts ${SAFE}`, `app-be ${SAFE}`]) assert.ok(done.includes(part), part);
  const story = (await h.get(`/stories/${s.storyId}`, h.b)).text;
  for (const part of [`쿠폰 발급 ${SAFE}`, `본문 ${SAFE}`, `PL ${SAFE}`]) assert.ok(story.includes(part), part);
  assert.ok((await h.get("/board", h.b)).text.includes(`쿠폰 개편 ${SAFE}`));
});

test("an unknown Task or Story id is a 404 page; the new pages load no script", async (t) => {
  const h = await team(t);
  const s = h.story();
  for (const [path, message] of [[`/tasks/${randomUUID()}`, "Task를 찾을 수 없습니다."], [`/stories/${randomUUID()}`, "Story를 찾을 수 없습니다."], ["/tasks/not-a-task", "페이지를 찾을 수 없습니다."], [`/stories/${s.storyId}/x`, "페이지를 찾을 수 없습니다."]]) {
    const res = await h.get(path, h.c);
    assert.equal(res.status, 404, path);
    assert.ok(res.text.includes(message), path);
  }
  for (const path of ["/", "/board", "/requests", `/stories/${s.storyId}`, `/tasks/${s.api}`]) {
    const res = await h.get(path, h.c);
    assert.equal(res.status, 200, path);
    assert.doesNotMatch(res.text, /<script/i, path);
  }
});

test("inTime says 곧, 약 25분 뒤, 약 2시간 뒤, 약 1시간 5분 뒤 and 잠시 뒤 for null", () => {
  const now = 1_000_000_000;
  const cases = [[now - 5000, "곧"], [now, "곧"], [now + 59_000, "곧"], [now + 25 * 60_000, "약 25분 뒤"], [now + 59 * 60_000, "약 59분 뒤"], [now + 120 * 60_000, "약 2시간 뒤"], [now + 65 * 60_000, "약 1시간 5분 뒤"], [null, "잠시 뒤"]];
  for (const [until, text] of cases) assert.equal(inTime(until, now), text, String(until));
  const w = (kind, runners, until, detail) => waitText({ kind, runners, until, detail }, now);
  assert.equal(w("limit", ["claude"], now + 25 * 60_000, "claude: limit"), "AI 사용 한도라 쉬는 중입니다. 약 25분 뒤 다시 시도합니다.");
  assert.equal(w("billing", ["claude"], null, "claude: billing"), "AI 결제·크레딧 문제로 쉬는 중입니다. 결제를 확인하면 잠시 뒤 다시 시도합니다.");
  assert.equal(w("login", ["claude"], null, "claude: login"), "Mac의 claude 로그인이 풀려 쉬는 중입니다. Mac 터미널에서 claude를 실행해 로그인하면 잠시 뒤 다시 시도합니다.");
  assert.equal(w("not_ready", ["claude", "codex"], null, "claude, codex: not_ready"), "Mac의 AI 실행기(claude, codex)가 준비되지 않아 쉬는 중입니다.");
  assert.equal(w("not_ready", [], null, "not_ready"), "Mac의 AI 실행기가 준비되지 않아 쉬는 중입니다.");
  assert.equal(w("other", [], null, "disk full"), "쉬는 중입니다(disk full)");
  assert.equal(w("other", [], null, null), "쉬는 중입니다.");
});

test("plainFailure picks by prefix and falls back to the default", () => {
  const cases = [
    ["RUNNER_LIMIT claude: limit", "AI 사용 한도가 6시간 안에 풀리지 않았습니다. 한도가 풀린 뒤 다시 시도하세요."],
    ["RUNNER_BILLING claude: credit", "AI 결제·크레딧 문제입니다. 결제를 확인한 뒤 다시 시도하세요."],
    ["RUNNER_LOGIN claude: expired", "Mac의 AI 로그인이 풀렸습니다. Mac 터미널에서 claude를 실행해 로그인한 뒤 다시 시도하세요."],
    ["RUNNER_NOT_READY codex: missing", "Mac의 AI 실행기가 준비되지 않았습니다. Mac에서 claude 설치와 로그인을 확인한 뒤 다시 시도하세요."],
    ["PR #12 was closed on GitHub; reopen it, then run team rerun", "GitHub에서 이 Task의 PR이 닫혔습니다. PR을 다시 연 뒤 다시 시도하세요."],
    ["BUILD_TIMEOUT: engine task x ran for more than 90 minutes.", "구현이 90분 안에 끝나지 않았습니다. 메모로 범위를 좁혀 다시 시도하세요."],
    ["The verified change still holds CONFLICT markers in 2 file(s).", "Story base와 합치다 충돌이 났습니다. 다시 시도하면 AI가 충돌을 풀며 처음부터 합니다."],
    ["PR #12 was merged elsewhere", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
    ["V1 failed: RUNNER_LIMIT later in the text", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
    ["", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
  ];
  for (const [reason, text] of cases) assert.equal(plainFailure(reason, "work"), text, reason);
  assert.equal(plainFailure("RUNNER_LIMIT claude: limit", "verify"), "Story 검증이 실패했습니다. PL이 고칠 Task를 더한 뒤 다시 검증합니다.");
});
