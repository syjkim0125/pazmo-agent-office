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
const OFF_PILL = 'aria-pressed="false">자동으로 일하기 꺼짐</button>';
const NOT_LINKED = "내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제).";
const NOT_LINKED_ERROR = "내 Mac이 지금 이 레포의 일을 가져갈 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요.";
const RERUN_NOT_LINKED = "내 Mac이 지금 이 레포의 일을 가져갈 수 없어 다시 시도할 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요.";
const NUDGE = "이 Mac 연결 — 처음 한 번, 명령 한 줄";
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
/** State pills carry their tone class (tone() in pages.ts); a word with no entry is a plain pill. */
const TONES = { "진행 중": "run", "완료": "done", "시작 중": "run", "할 일": "run", "멈춤(Mac 소식 없음)": "stop", "멈춤(실패)": "stop", "취소됨": "done", "진행 중(구현)": "run", "머지 중": "run", "앞 Task 기다림": "run" };
const pill = (word) => `<span class="pill${TONES[word] ? ` ${TONES[word]}` : ""}">${word}</span>`;
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
  return { store, board, get, admin: admin.member, cookie, port: hub.port };
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

  const home = await h.get("/me", h.pl);
  assert.equal(home.status, 200);
  assert.match(home.text, /<h1>내 할 일<\/h1>/);
  for (const title of ["지금 맡은 일", "받을 수 있는 일", "내 Story에서 멈춘 일", "끝낸 일"]) assert.match(home.text, new RegExp(`<h2>${title}</h2>`), title);
  assert.ok(home.text.includes(`href="/tasks/${s.api}"`), "the PL's failed Task is under 내 Story에서 멈춘 일");
  assert.ok(home.text.includes(`href="/tasks/${s.copy}"`), "copy is ready in the PL's repo");
  assert.match(home.text, /<nav><a href="\/">보드<\/a><a href="\/team">팀<\/a><\/nav>/);
  assert.match((await h.get("/team", h.admin)).text, /<a href="\/repos">레포<\/a> · <a href="\/requests">요청 게시판<\/a> · <a href="\/start">내 Office 연결<\/a> · <a href="\/members">팀원·초대<\/a>/);

  const mine = (await h.get("/me", h.c)).text;
  assert.doesNotMatch(mine, /내 Story에서 멈춘 일/, "only shown to a PL with a stuck Task");
  assert.ok(mine.includes(`href="/tasks/${s.api}"`), "C's open Task");
  const empty = (await h.get("/me", h.b)).text;
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
  const first = (await os.get("/me")).text;
  assert.ok(first.includes(NUDGE), "OpenShift with the installer and no Mac");
  assert.ok(first.indexOf(NUDGE) < first.indexOf("<h1>내 할 일</h1>"), "at the top");
  assert.ok(first.includes('<a href="/mac">이 Mac 연결</a>'));
  pairMac(os.store, os.admin);
  assert.ok(!(await os.get("/me")).text.includes(NUDGE), "a Mac is connected");
  const plain = await proxied(t, {});
  assert.ok(!(await plain.get("/me")).text.includes(NUDGE), "no installer behind the router");
  const lan = await team(t);
  assert.ok(!(await lan.get("/me", lan.c)).text.includes(NUDGE), "the self-CA hub has no one-line install");
});

test("a ready Task shows 작업하기 only with auto work off, a live link and no open Task; not-linked says so and links /mac", async (t) => {
  const h = await team(t);
  const s = h.story();
  const pickForm = (id) => `<form class="inline" method="post" action="/tasks/${id}/pick"><input type="hidden" name="csrf" value="${h.c.csrf}"><button class="">작업하기</button></form>`;
  const notLinked = `<a href="/mac">${NOT_LINKED}</a>`;

  let home = (await h.get("/me", h.c)).text;
  assert.ok(home.includes(notLinked), "C owns app-be but has no link to it");
  assert.ok(!home.includes(`/tasks/${s.api}/pick`));
  let task = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(task.includes(notLinked), "the Task page says it too");
  assert.ok(!task.includes(`/tasks/${s.api}/pick`));

  h.linkOf(h.c, h.be);
  home = (await h.get("/me", h.c)).text;
  assert.ok(!home.includes(NOT_LINKED));
  assert.ok(!home.includes("/pick"), "auto work is on: the Mac takes it anyway");
  task = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(task.includes("자동으로 일하기가 켜져 있으면 내 Mac이 차례대로 가져갑니다."));
  assert.ok(!task.includes("/pick"));

  h.board.setAutoWork(h.c.member, false);
  home = (await h.get("/me", h.c)).text;
  assert.ok(home.includes(pickForm(s.api)) && home.includes(pickForm(s.copy)), "both ready be Tasks");
  task = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(task.includes(pickForm(s.api)));
  assert.ok(!task.includes("자동으로 일하기가 켜져 있으면"));
  assert.ok(!(await h.get(`/tasks/${s.ui}`, h.c)).text.includes("/pick"), "ui is waiting in someone else's repo");

  h.board.pickTask(h.c.member, s.copy, h.store.reachableRepos(h.c.member.id));
  home = (await h.get("/me", h.c)).text;
  assert.ok(!home.includes("/pick"), "C holds copy now");
  assert.ok(home.includes(`href="/tasks/${s.api}"`), "api is still listed as ready");
  assert.ok(!(await h.get(`/tasks/${s.api}`, h.c)).text.includes("/pick"));
});

test("the header carries 자동으로 일하기 꺼짐 on every page only while auto work is off", async (t) => {
  const h = await team(t);
  const s = h.story();
  const paths = ["/", "/board", "/requests", "/repos", "/start", "/mac", `/stories/${s.storyId}`, `/tasks/${s.api}`];
  for (const path of paths) assert.ok(!(await h.get(path, h.c)).text.includes(OFF_PILL), `on: ${path}`);
  let home = (await h.get("/me", h.c)).text;
  assert.ok(home.includes("켜져 있어 내 Mac이 받을 수 있는 일을 차례대로 가져갑니다."));
  assert.ok(home.includes(`<form class="inline" method="post" action="/me/auto-work"><input type="hidden" name="csrf" value="${h.c.csrf}"><input type="hidden" name="back" value="/me"><input type="hidden" name="on" value="0"><button class="secondary">끄기</button></form>`));

  h.board.setAutoWork(h.c.member, false);
  for (const path of paths) {
    const nav = /<header>.*<\/header>/.exec((await h.get(path, h.c)).text)[0];
    assert.ok(nav.includes(OFF_PILL), `off: ${path}`);
  }
  home = (await h.get("/me", h.c)).text;
  assert.ok(home.includes("꺼져 있어 새 일을 받지 않습니다. 아래에서 직접 고를 수 있습니다."));
  assert.ok(home.includes(`<input type="hidden" name="on" value="1"><button>켜기</button>`));
  assert.ok(!(await h.get("/me", h.b)).text.includes(OFF_PILL), "the switch is each member's own");
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
  assert.ok(board.includes(`<a href="/stories/${s.storyId}"><b>#${s.number} 쿠폰 발급</b></a>${pill("진행 중")}<span class="muted">PL PL`));

  const page = (await h.get(`/stories/${s.storyId}`, h.b)).text;
  assert.match(page, /<h1>쿠폰 발급<\/h1>/);
  assert.ok(page.includes(pill("진행 중")));
  assert.ok(page.includes("<pre># Story\n본문</pre>"));
  assert.ok(page.includes("PL: PL"));
  assert.ok(page.includes(`<details class="dev"><summary>개발 정보</summary><h3>Story base</h3>`) && page.includes(`<tr><td>app-be</td><td>main</td><td>feature/story-${s.number}/base</td></tr>`), "Story base, folded");
  assert.ok(page.includes(`<tr><td>app-fe</td><td>develop</td><td>feature/story-${s.number}/base</td></tr>`));
  const row = (id) => new RegExp(`<tr><td>#\\d+</td><td>[^<]*</td><td><a href="/tasks/${id}">[^<]+</a></td><td><span class="pill \\w+">([^<]+)</span></td><td>([^<]*)</td><td>(.*?)</td></tr>`).exec(page);
  const [, apiWord, apiWho] = row(s.api);
  assert.deepEqual([apiWord, apiWho], ["완료", "C"]);
  assert.ok(page.includes(`<details class="dev"><summary>개발 정보</summary>`) && page.includes(`<a href="${PR}" rel="noreferrer">`), "PR link, folded");
  const [, uiWord, , uiDeps] = row(s.ui);
  assert.equal(uiWord, "할 일");
  assert.ok(uiDeps.includes(`<a href="/tasks/${s.api}">#${s.apiNo}</a>`), "the Task before it");
  assert.deepEqual(row(s.copy).slice(1, 3), ["진행 중(구현)", "C"]);
  assert.equal(row(s.verify)[1], "앞 Task 기다림");
  assert.ok(page.includes(`<a class="refresh" href="/stories/${s.storyId}">새로 고침</a>`));
});

test("state words: ready 할 일, claimed with stage build 진행 중(구현), merge 머지 중, held 멈춤(Mac 소식 없음), failed 멈춤(실패), merged 완료", async (t) => {
  let now = Date.now();
  const h = await team(t, { now: () => now });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const word = async (id = s.api) => {
    const text = (await h.get(`/tasks/${id}`, h.pl)).text;
    return /<p class="state"><span class="pill \w+">([^<]+)<\/span>/.exec(text)[1];
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
    const home = (await h.get("/me", h.c)).text;
    assert.ok(home.includes(plain), `home: ${reason}`);
    assert.ok(home.includes(`<a href="/tasks/${s.api}">자세히·다시 시도</a>`));
    assert.ok((await h.get("/me", h.pl)).text.includes(plain), "the PL's stuck list says it too");
    h.board.rerunTask(h.c.member, s.api, "", h.store.reachableRepos(h.c.member.id));
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
  assert.ok((await h.get("/me", h.c)).text.includes(wait), "and so does the assignee's own open Task");
  assert.ok(!(await h.get(`/tasks/${s.copy}`, h.pl)).text.includes("쉬는 중입니다"), "a Task nobody holds");
  skew = MAC_OFFLINE_MS + 1000;
  for (const [path, who] of [[`/tasks/${s.api}`, h.pl], ["/", h.c]]) assert.ok(!(await h.get(path, who)).text.includes("쉬는 중입니다"), path);
});

test("a member with no open Task whose newest Mac rests with claude: not_ready sees what to do on /", async (t) => {
  const h = await team(t);
  const s = h.story();
  const mac = pairMac(h.store, h.c.member, "C의 Mac");
  h.store.macHeartbeat(mac, "limited", "claude: not_ready", null);
  const line = "Mac의 AI 실행기(claude)가 준비되지 않아 쉬는 중입니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요.";
  const count = (text) => text.split(line).length - 1;
  let home = (await h.get("/me", h.c)).text;
  assert.ok(home.includes("지금 맡은 일이 없습니다."));
  assert.ok(home.includes(`<p>${line}</p>`));
  assert.ok(home.indexOf(line) > home.indexOf("<h1>내 할 일</h1>") && home.indexOf(line) < home.indexOf("<h2>지금 맡은 일</h2>"), "right under the switch");
  assert.ok(!(await h.get("/me", h.b)).text.includes(line), "only the resting member's page");
  // With a Task open and working, its card says it, once.
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  home = (await h.get("/me", h.c)).text;
  assert.equal(count(home), 1);
  assert.ok(home.indexOf(line) > home.indexOf("<h2>지금 맡은 일</h2>"), "in the open card");
  // Failed, the card is not working any more: the sentence moves back under the switch.
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  home = (await h.get("/me", h.c)).text;
  assert.equal(count(home), 1);
  assert.ok(home.indexOf(line) < home.indexOf("<h2>지금 맡은 일</h2>"));
  assert.ok(home.includes(`href="/tasks/${s.api}"`));
  // The Mac is ready again: nothing to say.
  h.store.macHeartbeat(mac, "idle", null);
  assert.equal(count((await h.get("/me", h.c)).text), 0);
});

test("a held Task says the Mac is silent and, when the assignee's Mac is off, when it was last seen; when it is on, that the PL can release it", async (t) => {
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
  const mac = pairMac(h.store, h.c.member);
  page = (await h.get(`/tasks/${s.api}`, h.c)).text;
  assert.ok(page.includes(`${held} (내 Mac: 꺼짐, 마지막 확인 아직 없음)`), "the assignee's own Mac");
  assert.ok((await h.get(`/tasks/${s.api}`, h.pl)).text.includes(`${held} (맡은 사람의 Mac: 꺼짐, 마지막 확인 아직 없음)`), "seen by the PL");
  // The Mac is on, yet nothing about this Task: it will not go on by itself (the Office let the claim go, or cannot take it).
  h.store.macHeartbeat(mac, "idle", null);
  const on = "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다.";
  for (const who of [h.c, h.pl]) {
    const text = (await h.get(`/tasks/${s.api}`, who)).text;
    assert.ok(text.includes(`<p><b>${on}</b></p>`), "the Mac reports");
    assert.ok(!text.includes(held) && !text.includes("꺼짐"));
  }
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
  assert.ok(page.includes("<li>AI가 정한 것: 쿠폰 코드는 대문자</li><li>기존 응답 형식을 유지</li>"));
  assert.ok(page.includes(`<a href="${PR}" rel="noreferrer">${PR}</a>`));
  assert.ok(page.includes(`<code>${SHA.slice(0, 12)}</code>`) && !page.includes(SHA), "the merge commit's first 12 characters");
  assert.ok(page.includes("<pre>api 설명</pre>") && page.includes("<li><code>src/api.ts</code></li>"), "what the Task was");
  const ui = (await h.get(`/tasks/${s.ui}`, h.b)).text;
  assert.ok(ui.includes(`<li><a href="/tasks/${s.api}">#${s.apiNo} api 작업</a> ${pill("완료")}</li>`), "the Task before it, with its state");
  const done = (await h.get("/me", h.c)).text;
  assert.ok(/<h2>끝낸 일<\/h2>[\s\S]*href="\/tasks\//.test(done) && done.includes(`<a href="${PR}" rel="noreferrer">`), "under 끝낸 일 with the PR");
});

test("buttons follow taskActions: the assignee sees 다시 시도 on a failed Task, the PL and an admin see 풀기 and 취소, another member sees none", async (t) => {
  let now = Date.now();
  const h = await team(t, { now: () => now });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  h.board.rerunTask(h.c.member, s.api, "범위를 줄여 주세요", h.store.reachableRepos(h.c.member.id));
  h.board.reportFailed(cBe, s.api, h.claimOf(cBe), "tests failed again");
  const rerun = `<form method="post" action="/tasks/${s.api}/rerun"><input type="hidden" name="csrf" value="${h.c.csrf}"><label>메모 <span class="muted">(선택, 2000자까지)</span><textarea name="memo" rows="3" maxlength="2000"></textarea></label><div class="row"><button>다시 시도</button></div></form>`;
  const releaseLine = "풀면 이 Task는 다시 '할 일'이 되고, 그 레포 담당자 누구든 처음부터 다시 받습니다.".replaceAll("'", "&#39;");
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
  assert.ok(page.includes(`<p>${releaseLine} 합치는 중이었을 수 있습니다.</p>`));
  // And it cannot be cancelled from here: the change may be merged already, so 풀기 comes first.
  assert.ok(page.includes("<p>합치는 중이라 지금은 취소할 수 없습니다. 이미 합쳐졌을 수 있으니 먼저 풀기를 하세요.</p>"));
  assert.ok(!page.includes(`/tasks/${s.copy}/cancel`), "no cancel form");
  assert.ok((await h.get(`/tasks/${s.api}`, h.admin)).text.includes(cancel(h.admin, s.api)), "api holds no lock: the form");
  assert.ok(!(await h.get(`/tasks/${s.api}`, h.admin)).text.includes("합치는 중이었을 수 있습니다."), "api holds no lock");
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
  h.board.rerunTask(h.c.member, s.copy, `메모 ${EVIL}`, h.store.reachableRepos(h.c.member.id));
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
  for (const part of [`요약 ${SAFE}`, `AI가 정한 것: ${SAFE}`, `판단 ${SAFE}`, `api 작업 ${SAFE}`, `api 설명 ${SAFE}`, `src/api.ts ${SAFE}`, `app-be ${SAFE}`]) assert.ok(done.includes(part), part);
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
    assert.doesNotMatch(res.text, /<script(?! src="\/live\.js" defer><\/script>)/i, path);
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
  assert.equal(w("not_ready", ["claude", "codex"], null, "claude, codex: not_ready"), "Mac의 AI 실행기(claude, codex)가 준비되지 않아 쉬는 중입니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요.");
  assert.equal(w("not_ready", ["codex"], null, "codex: not_ready"), "Mac의 AI 실행기(codex)가 준비되지 않아 쉬는 중입니다. Mac 터미널에서 codex를 실행해 설치와 로그인을 확인하세요.");
  assert.equal(w("not_ready", [], null, "not_ready"), "Mac의 AI 실행기가 준비되지 않아 쉬는 중입니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요.");
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
    ["git push failed 3 times in a row: rejected (non-fast-forward)", "Mac에서 git·GitHub 단계가 세 번 잇달아 실패했습니다. 아래 이유를 확인한 뒤 다시 시도하세요."],
    ["attempt checkout failed 3 times in a row: CONFLICT: the attempt folder already exists", "Mac에서 git·GitHub 단계가 세 번 잇달아 실패했습니다. 아래 이유를 확인한 뒤 다시 시도하세요."],
    ["PR #12 was merged elsewhere", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
    ["V1 failed: RUNNER_LIMIT later in the text", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
    ["", "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요."],
  ];
  for (const [reason, text] of cases) assert.equal(plainFailure(reason, "work"), text, reason);
  assert.equal(plainFailure("RUNNER_LIMIT claude: limit", "verify"), "Story 검증이 실패했습니다. PL이 고칠 Task를 더한 뒤 다시 검증합니다.");
});

// ---- Task 5: the buttons' POST routes ----
const post = (h, who, path, fields = {}, over = {}) =>
  h.call("POST", path, {
    cookie: who.cookie,
    headers: { origin: h.hub.url },
    body: new URLSearchParams({ csrf: who.csrf, ...fields, ...over }).toString(),
  });
const taskPage = async (h, who, id) => (await h.get(`/tasks/${id}`, who)).text;

test("switching auto work off and on from the web changes what claimNext gives", async (t) => {
  const h = await team(t);
  h.story();
  const cBe = h.linkOf(h.c, h.be);
  let res = await post(h, h.c, "/me/auto-work", { on: "0" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/");
  assert.equal(h.board.claimNext(cBe), null, "off: nothing is given");
  assert.ok((await h.get("/me", h.c)).text.includes(OFF_PILL));
  res = await post(h, h.c, "/me/auto-work", { on: "1" });
  assert.equal(res.status, 303);
  assert.ok(h.board.claimNext(cBe), "on again: the ready Task comes");
  for (const bad of ["", "yes", "2"]) {
    res = await post(h, h.c, "/me/auto-work", { on: bad });
    assert.equal(res.status, 400);
    assert.ok(res.text.includes("켜기 또는 끄기를 골라주세요."));
  }
});

test("작업하기 from the web claims the Task for the member; the Task page then says 시작 중 and the member's inbox names it", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  await post(h, h.c, "/me/auto-work", { on: "0" });
  const res = await post(h, h.c, `/tasks/${s.api}/pick`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/tasks/${s.api}`);
  assert.ok((await taskPage(h, h.c, s.api)).includes("시작 중"));
  assert.equal(h.board.inbox(cBe).mine.taskId, s.api);
  // A double click: the pick already went through, so the second lands on the Task page too.
  const twice = await post(h, h.c, `/tasks/${s.api}/pick`);
  assert.equal(twice.status, 303);
  assert.equal(twice.headers.location, `/tasks/${s.api}`);
  assert.equal(h.board.inbox(cBe).mine.taskId, s.api);
  const again = await post(h, h.c, `/tasks/${s.copy}/pick`);
  assert.equal(again.status, 409, "one open Task per member");
  // The same Task picked by someone else: still the STATE page.
  await post(h, h.pl, "/me/auto-work", { on: "0" });
  const taken = await post(h, h.pl, `/tasks/${s.api}/pick`);
  assert.equal(taken.status, 409);
  assert.ok(taken.text.includes("지금 받을 수 있는 Task가 아닙니다. 화면을 새로 고쳐 상태를 확인하세요."));
});

test("a claim the Mac has not taken yet says it waits for the Mac instead of the Hub's own claim time", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe); // no heartbeat yet, so no stage
  const mine = "내 Mac이 가져가기를 기다립니다(보통 1분 안).";
  const theirs = "맡은 사람의 Mac이 가져가기를 기다립니다(보통 1분 안).";
  const page = await taskPage(h, h.c, s.api);
  assert.ok(page.includes(`${pill("시작 중")} 맡은 사람: C · ${mine} · <a class="refresh" href="/tasks/${s.api}">새로 고침</a>`));
  assert.ok(!page.includes("마지막 소식"));
  assert.ok((await taskPage(h, h.pl, s.api)).includes(`맡은 사람: C · ${theirs} · `), "seen by another member");
  const home = (await h.get("/me", h.c)).text;
  assert.ok(home.includes(`<p class="muted">${mine}</p>`), "the home open card");
  assert.ok(!home.includes("마지막 소식"));
  h.board.heartbeat(cBe, api.taskId, api.claimId, "build");
  assert.ok((await taskPage(h, h.c, s.api)).includes("맡은 사람: C · 마지막 소식 방금 · "), "the Mac took it");
  assert.ok((await h.get("/me", h.c)).text.includes(`<p class="muted">마지막 소식 방금</p>`));
});

test("작업하기 without a live link is a NOT_LINKED page and changes nothing", async (t) => {
  const h = await team(t);
  const s = h.story();
  await post(h, h.c, "/me/auto-work", { on: "0" });
  const res = await post(h, h.c, `/tasks/${s.api}/pick`);
  assert.equal(res.status, 409);
  assert.ok(res.text.includes(NOT_LINKED_ERROR));
  assert.ok((await taskPage(h, h.pl, s.api)).includes("할 일"));
  assert.equal(h.board.claimNext(s.plBe).taskId, s.api, "still ready for anyone else");
});

test("다시 시도 from the web reruns the failed Task with the memo; a second click lands on the Task page; after the PL released it, a STATE page that says 다시 시도", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  const res = await post(h, h.c, `/tasks/${s.api}/rerun`, { memo: "  범위를 줄여 주세요  " });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/tasks/${s.api}`);
  const page = await taskPage(h, h.c, s.api);
  assert.ok(page.includes("<h2>마지막 메모</h2><pre>범위를 줄여 주세요</pre>"));
  assert.ok(page.includes("시작 중"));
  const second = await post(h, h.c, `/tasks/${s.api}/rerun`, { memo: "again" });
  assert.equal(second.status, 303, "a double click: the rerun already went through");
  assert.equal(second.headers.location, `/tasks/${s.api}`);
  assert.ok((await taskPage(h, h.c, s.api)).includes("<pre>범위를 줄여 주세요</pre>"), "the memo is unchanged");
  // Failed again, and the PL releases it while C still has the old page open.
  h.board.reportFailed(cBe, s.api, h.claimOf(cBe), "tests failed again");
  h.board.releaseTask(s.plBe, s.api);
  const late = await post(h, h.c, `/tasks/${s.api}/rerun`, { memo: "" });
  assert.equal(late.status, 409);
  assert.ok(late.text.includes("실패한 Task만 다시 시도할 수 있습니다. 화면을 새로 고쳐 확인하세요."));
  assert.ok((await taskPage(h, h.pl, s.api)).includes(pill("할 일")), "nothing changed");
});

test("a failed Task whose repo the assignee's Mac is not taking now shows why instead of the 다시 시도 form, and the POST is a NOT_LINKED page", async (t) => {
  let skew = 0;
  const h = await team(t, { storeNow: () => Date.now() + skew });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  assert.ok((await taskPage(h, h.c, s.api)).includes(`<form method="post" action="/tasks/${s.api}/rerun">`), "the Office used the link lately");
  skew = MAC_OFFLINE_MS + 1000; // and has not since
  const page = await taskPage(h, h.c, s.api);
  assert.ok(page.includes(`<p><a href="/mac">${RERUN_NOT_LINKED}</a></p>`));
  assert.ok(!page.includes("/rerun"), "no form");
  const res = await post(h, h.c, `/tasks/${s.api}/rerun`, { memo: "다시" });
  assert.equal(res.status, 409);
  assert.ok(res.text.includes(NOT_LINKED_ERROR));
  assert.ok((await taskPage(h, h.pl, s.api)).includes("멈춤(실패)"), "nothing changed");
});

test("풀기 and 취소 work for the PL and an admin and are FORBIDDEN pages for others; 취소 without the confirm box is an INVALID page and the Task stays", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.reportFailed(cBe, api.taskId, api.claimId, "tests failed");
  const stays = async () => assert.ok((await taskPage(h, h.pl, s.api)).includes("멈춤(실패)"));

  assert.equal((await post(h, h.b, `/tasks/${s.api}/release`)).status, 403);
  assert.equal((await post(h, h.b, `/tasks/${s.api}/cancel`, { confirm: "yes" })).status, 403);
  assert.equal((await post(h, h.c, `/tasks/${s.api}/release`)).status, 403, "the assignee is not the PL");
  await stays();

  const noBox = await post(h, h.pl, `/tasks/${s.api}/cancel`);
  assert.equal(noBox.status, 400);
  assert.ok(noBox.text.includes("취소하려면 &#39;정말 취소합니다&#39;를 체크하세요."));
  await stays();

  const rel = await post(h, h.pl, `/tasks/${s.api}/release`);
  assert.equal(rel.status, 303);
  assert.equal(rel.headers.location, `/tasks/${s.api}`);
  assert.ok((await taskPage(h, h.pl, s.api)).includes("할 일"));

  const can = await post(h, h.admin, `/tasks/${s.api}/cancel`, { confirm: "yes" });
  assert.equal(can.status, 303);
  assert.equal(can.headers.location, `/tasks/${s.api}`);
  assert.ok((await taskPage(h, h.pl, s.api)).includes("취소됨"));
});

test("취소 of a Task that holds the merge lock is a STATE page and the Task stays as it was; after 풀기 it can be cancelled", async (t) => {
  let now = Date.now();
  const h = await team(t, { now: () => now });
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be);
  const api = h.board.claimNext(cBe);
  h.board.mergeLock(cBe, api.taskId, api.claimId);
  now += HELD_AFTER_MS + 1;
  const res = await post(h, h.pl, `/tasks/${s.api}/cancel`, { confirm: "yes" });
  assert.equal(res.status, 409);
  assert.ok(res.text.includes("머지 잠금을 쥔 Task는 취소할 수 없습니다. 머지됐을 수 있으니 먼저 풀기를 하세요."));
  const page = await taskPage(h, h.pl, s.api);
  assert.ok(page.includes(pill("멈춤(Mac 소식 없음)")) && page.includes("맡은 사람: C"), "unchanged");
  assert.equal(h.board.inbox(cBe).mine.claimId, api.claimId, "still C's claim");
  assert.equal((await post(h, h.pl, `/tasks/${s.api}/release`)).status, 303);
  assert.equal((await post(h, h.pl, `/tasks/${s.api}/cancel`, { confirm: "yes" })).status, 303);
  assert.ok((await taskPage(h, h.pl, s.api)).includes(pill("취소됨")));
});

test("풀기 on a failed Story verification Task says the Story verification is prepared again for the PL's Office", async (t) => {
  const h = await team(t);
  const s = h.story();
  const cBe = h.linkOf(h.c, h.be), bFe = h.linkOf(h.b, h.fe);
  let n = 0;
  const done = (l) => {
    const x = h.board.claimNext(l);
    h.board.mergeLock(l, x.taskId, x.claimId);
    h.board.reportMerged(l, x.taskId, x.claimId, merged({ mergeCommit: String(++n).padStart(40, "0") }));
  };
  done(cBe);
  done(cBe);
  done(bFe);
  const v = h.board.claimVerify(s.plBe, s.storyId);
  h.board.reportVerify(s.plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" });
  const page = await taskPage(h, h.pl, s.verify);
  assert.ok(page.includes(`<form method="post" action="/tasks/${s.verify}/release"><input type="hidden" name="csrf" value="${h.pl.csrf}"><p>풀면 Story 검증이 다시 준비되고, PL의 Office가 다시 검증합니다.</p><div class="row"><button class="secondary">풀기</button></div></form>`));
  assert.ok(!page.includes("그 레포 담당자"), "a verification Task has no repo");
});

test("every new POST is 403 from another origin or without the CSRF token", async (t) => {
  const h = await team(t);
  const s = h.story();
  h.linkOf(h.c, h.be);
  await post(h, h.c, "/me/auto-work", { on: "0" });
  const paths = [["/me/auto-work", { on: "1" }], ...["pick", "rerun", "release", "cancel"].map((a) => [`/tasks/${s.api}/${a}`, { confirm: "yes" }])];
  for (const [path, fields] of paths) {
    const body = (csrf) => new URLSearchParams({ ...(csrf ? { csrf } : {}), ...fields }).toString();
    const foreign = await h.call("POST", path, { cookie: h.c.cookie, headers: { origin: "https://evil.example.com" }, body: body(h.c.csrf) });
    assert.equal(foreign.status, 403, `${path} other origin`);
    const none = await h.call("POST", path, { cookie: h.c.cookie, headers: { origin: h.hub.url }, body: body(null) });
    assert.equal(none.status, 403, `${path} no token`);
    const wrong = await h.call("POST", path, { cookie: h.c.cookie, headers: { origin: h.hub.url }, body: body("nope") });
    assert.equal(wrong.status, 403, `${path} wrong token`);
  }
  assert.ok((await taskPage(h, h.pl, s.api)).includes("할 일"), "nothing changed");
  assert.ok((await h.get("/me", h.c)).text.includes(OFF_PILL), "the switch did not change");
});

test("an unknown Task id is a 404 page for every button", async (t) => {
  const h = await team(t);
  h.story();
  h.linkOf(h.c, h.be);
  const id = randomUUID();
  for (const a of ["pick", "rerun", "release", "cancel"]) {
    const res = await post(h, h.admin, `/tasks/${id}/${a}`, { confirm: "yes" });
    assert.equal(res.status, 404, a);
  }
});

test("a hub without a board answers 404 for the new POSTs", async (t) => {
  const h = await proxied(t, { withBoard: false });
  const host = new URL(PUBLIC).host;
  const raw = (method, path, body) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: h.port, method, path, headers: { host, cookie: h.cookie, ...(body ? { origin: PUBLIC, "content-type": "application/x-www-form-urlencoded" } : {}) } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  const csrf = /name="csrf" value="([^"]+)"/.exec((await h.get("/repos")).text)[1];
  for (const path of ["/me/auto-work", `/tasks/${randomUUID()}/pick`])
    assert.equal((await raw("POST", path, new URLSearchParams({ csrf, on: "1" }).toString())).status, 404, path);
});
