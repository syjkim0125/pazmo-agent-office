import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { MAC_OFFLINE_MS } from "../src/hub/store.ts";
import { planStoryKey, planTextHash } from "../src/hub/plan-protocol.ts";
import { startTestHub } from "./hub-fixture.mjs";
/** U49: a page with its one-sentence-per-line marks taken off, for tests that compare words (the U49 tests pin the marks). */
const unline = (html) => html.replace(/<(?:span|b) class="ln">([^<]*)<\/(?:span|b)>/g, "$1");

const EVIL = "<img src=x onerror=alert(1)>";
const SAFE = "&#60;img src=x onerror=alert(1)&#62;";
const DRAFT = "# Story: 쿠폰 발급\n\n## Decisions\n- ASSUMED: 쿠폰은 한 번만 쓴다\n";
const BLOCKED = "# Story: 쿠폰 발급\n\n## Decisions\n- OPEN BLOCKING: 결제 수단을 정해야 한다\n";
const DESIGN = "# 설계\n\n1. api: 쿠폰 발급 API\n2. ui: 쿠폰 버튼\n";
const CHANGED = "그사이 기획이 바뀌어 새 화면을 보여 드립니다. 확인한 뒤 다시 누르세요.";
const WAITING = "PL의 Mac이 가져가기를 기다립니다(보통 1분 안).";
const NEW_STORY_FORBIDDEN = "프로젝트의 모든 레포 담당자만 새 Story를 만들 수 있습니다.";
const INTENT_BYTES = "하고 싶은 일은 64KB(한글 약 2만 자)까지 적을 수 있습니다.";
const EMPTY_BOARD = "아직 프로젝트가 없습니다. [새 프로젝트]로 레포를 묶은 뒤 [새 Story]로 시작하세요.";
const G3_NOTE = "승인하면 이 설계와 아래 [올라갈 Task 전부 보기]의 모든 내용(Task마다 설명, 바꿀 파일, 확인 명령과 Story 전체 확인)을 그대로 올리고 엽니다.";
const OLD_EMPTY_BOARD = "아직 프로젝트가 없습니다. PL이 Office에서 Story를 올리면 여기에 보입니다.";
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
/** State pills carry their tone class (tone() in pages.ts); a word with no entry is a plain pill. */
const TONES = { "기획 대기": "run", "기획 중": "run", "질문": "need", "초안": "need", "설계 대기": "run", "설계 중": "run", "설계 승인 대기": "need", "나누기 대기": "run", "나누는 중": "run", "열림": "done", "멈춤": "stop", "취소됨": "done" };
const pill = (word) => `<span class="pill${TONES[word] ? ` ${TONES[word]}` : ""}">${word}</span>`;
/** The PL's Office instance: the lease holder id the plan helpers send. */
const H = "a".repeat(32);
const OPENED = (n) => `Story #${n}이 이미 열려 기획은 끝났습니다. Story 화면에서 진행을 보세요.`;
const UNLINKED = (names) => `<p>PL의 Office에 연결되지 않은 레포: ${names} — PL Mac의 Office에 이 레포를 연결해야 기획이 시작됩니다.</p>`;
/** A high-risk split as the PL's Office stores it with the design: t1 (app-be) before t2 (app-fe), one Story check. */
const splitOf = (be, fe, text = (s) => s) => ({
  plan: text("API 먼저, 화면은 뒤에"),
  graph: {
    nodes: [
      { id: "t1", repoId: be, title: text("쿠폰 API"), spec: text("Outcome: 쿠폰을 발급한다\nScope: api"), files: [text("src/api.ts"), "src/coupon.ts"], verify: [{ id: "V1", argv: ["npm", "test", "--", text("coupon api")], timeoutMs: 60000 }] },
      { id: "t2", repoId: fe, title: "쿠폰 버튼", spec: "Outcome: 버튼", files: ["src/ui.tsx"], verify: [{ id: "V1", argv: ["npm", "run", "test:ui"], timeoutMs: 120000 }] },
    ],
    edges: [{ from: "t1", to: "t2" }],
  },
  storyVerify: [{ repoId: fe, checks: [{ id: "S1", argv: ["npm", "run", text("e2e")], timeoutMs: 600000 }] }],
});
const q = (n, blocking = false, text = (s) => s) => ({ id: `Q${n}`, text: text(`질문 ${n}`), reason: text(`이유 ${n}`), blocking });

/**
 * A LAN hub with a Story board and (unless `plans: false`) a plan board, every member signed in: PL owns app-be and
 * app-fe, B owns app-fe, C owns app-be, the admin owns none. `project` makes "쿠폰 개편" over both repos. The plan
 * helpers drive the PL's Office side straight through the PlanBoard: `result` leases the PL's next plan (it must be
 * `id`) and posts `r` under that lease.
 */
async function team(t, { now, storeNow, plans, project = true, names = {}, text = (s) => s } = {}) {
  const h = await startTestHub(t, { now, storeNow, plans });
  const { store, board, enter } = h;
  const call = async (...a) => { const r = await h.call(...a); return { ...r, text: unline(r.text) }; };
  const signIn = async (raw) => {
    const w = await enter(raw);
    return { ...w, member: store.session(w.cookie.split("=")[1]).member };
  };
  const admin = await signIn(store.bootstrapAdmin());
  const join = (name) => signIn(store.createInvite(admin.member, name));
  const pl = await join(names.pl ?? "PL"), b = await join("B"), c = await join("C");
  const be = store.addRepo(admin.member, text("app-be"), "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin.member, "app-fe", "git@github.example.com:team/app-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [b, fe], [c, be]]) store.addOwner(admin.member, r, m.member.id);
  // Registering made the admin the first owner of both; the admin's rights here are the admin's own, not an owner's.
  for (const r of [be, fe]) store.removeOwner(admin.member, r, admin.member.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe" };
  const linkOf = (who, r) => store.link(store.pair(store.createLinkCode(who.member, r), remote[r]).token);
  const plBe = linkOf(pl, be);
  const projectId = project
    ? board.createProject({ member: pl.member }, text("쿠폰 개편"), [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]).projectId
    : null;
  const get = (path, who) => call("GET", path, { cookie: who.cookie });
  /** `fields` is an object or a list of pairs (a repeated key); `origin: null` / `csrf: null` leave them out. */
  const post = (who, path, fields = {}, { origin = h.hub.url, csrf = who.csrf } = {}) => {
    const pairs = Array.isArray(fields) ? fields : Object.entries(fields);
    const body = new URLSearchParams([...(csrf === null ? [] : [["csrf", csrf]]), ...pairs]).toString();
    return call("POST", path, { cookie: who.cookie, headers: origin === null ? {} : { origin }, body });
  };
  const create = (o = {}) =>
    h.plans.createPlan(pl.member, { projectId, title: text("쿠폰 발급"), intent: text("쿠폰을 한 번에 발급하고 싶어요."), risk: "normal", ...o }).planId;
  const lease = (id) => {
    const l = h.plans.next(plBe, H);
    assert.equal(l?.plan.id, id, "the PL's next plan");
    return l;
  };
  const result = (id, r) => {
    const l = lease(id);
    return h.plans.result(plBe, H, id, l.leaseId, l.revision, r);
  };
  const view = (id, who = pl) => h.plans.plan({ member: who.member }, id);
  const questions = (id, qs) => result(id, { kind: "questions", questions: qs });
  const draft = (id, body = DRAFT) => result(id, { kind: "draft", text: body, story: { title: "쿠폰 발급" } });
  const design = (id, body = DESIGN, split = { tasks: [] }) => result(id, { kind: "design", text: body, split });
  const failed = (id, reason) => result(id, { kind: "failed", reason });
  const approve = (id, gate = "G1") => {
    const v = view(id);
    return h.plans.approve(pl.member, id, gate, v.revision, (gate === "G1" ? v.draft : v.design).hash);
  };
  const answerAll = (id, answer = "네") => {
    const v = view(id);
    const last = v.rounds.at(-1);
    return h.plans.answer(pl.member, id, v.revision, Object.fromEntries(last.questions.map((x) => [x.id, answer])));
  };
  /** Publishes the plan's Story under its key and opens it, as the PL's Office does before posting `open`. */
  const publishOpen = (id) => {
    const pub = board.publishStory(plBe, {
      projectId, title: "쿠폰 발급", body: DRAFT, risk: "normal", key: planStoryKey(id),
      graph: { nodes: [{ id: "api", repoId: be, title: "api", spec: "api 설명", files: ["src/api.ts"], verify: [check] }], edges: [] },
      storyVerify: [{ repoId: be, checks: [check] }],
    });
    board.openStory(plBe, pub.storyId);
    return pub;
  };
  // Without the header: its automatic-work switch is a form of every page, and these tests count the plan's own forms.
  const page = async (id, who = pl) => (await get(`/plans/${id}`, who)).text.replace(/<header>[\s\S]*?<\/header>/, "");
  return {
    ...h, admin, pl, b, c, be, fe, plBe, linkOf, projectId, get, post,
    create, lease, result, view, questions, draft, design, failed, approve, answerAll, publishOpen, page,
  };
}

/** The hidden fields of the page's form posting to `action`, without the CSRF token. */
function formOf(html, action) {
  const m = new RegExp(`<form method="post" action="${action}">([\\s\\S]*?)</form>`).exec(html);
  assert.ok(m, `a form posting to ${action}`);
  const hidden = [...m[1].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((x) => [x[1], x[2]]);
  return Object.fromEntries(hidden.filter(([name]) => name !== "csrf"));
}
const count = (text, part) => text.split(part).length - 1;

/** Korean lines joined by LF, exactly `bytes` UTF-8 bytes, ending in a letter. */
function korean(bytes) {
  const line = "가나다라마바사아자차".repeat(10);
  let text = line;
  while (Buffer.byteLength(text, "utf8") + 301 < bytes) text += `\n${line}`;
  text += "a".repeat(bytes - Buffer.byteLength(text, "utf8"));
  assert.equal(Buffer.byteLength(text, "utf8"), bytes);
  return text;
}
/** A browser's form: line breaks go out as CRLF. */
const crlf = (s) => s.replaceAll("\n", "\r\n");

/** POSTs a body the hub refuses before reading it all; waits for the upload to end (the 413 may come first). */
function refused(h, who, path, body) {
  return new Promise((resolve, reject) => {
    let status = 0, text = "";
    const req = request(new URL(path, h.hub.url), {
      method: "POST",
      ca: [h.tls.caPem],
      checkServerIdentity: (_host, cert) => checkServerIdentity("127.0.0.1", cert),
      headers: { cookie: who.cookie, origin: h.hub.url, "content-type": "application/x-www-form-urlencoded" },
    }, (res) => {
      status = res.statusCode;
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
    });
    req.on("error", (error) => (status ? undefined : reject(error)));
    req.on("close", () => (status ? resolve({ status, text }) : reject(new Error("no response"))));
    req.end(body);
  });
}

test("planStateLabel and planStateText say each state in plain words", async () => {
  const { planStateLabel, planStateText } = await import("../src/hub/plan-pages.ts");
  const labels = [
    ["queued", false, "기획 대기"], ["queued", true, "기획 중"], ["questions", false, "질문"], ["draft", false, "초안"],
    ["design", false, "설계 대기"], ["design", true, "설계 중"], ["awaiting_g3", false, "설계 승인 대기"],
    ["splitting", false, "나누기 대기"], ["splitting", true, "나누는 중"], ["open", false, "열림"], ["failed", false, "멈춤"], ["cancelled", false, "취소됨"],
  ];
  for (const [state, leased, label] of labels) assert.equal(planStateLabel(state, leased), label, `${state} ${leased}`);
  const v = (state, o = {}) => planStateText({ state, leased: false, isPl: true, story: null, ...o });
  for (const state of ["queued", "design", "splitting"]) assert.equal(v(state), WAITING, state);
  assert.equal(v("queued", { leased: true }), "AI가 기획하고 있습니다.");
  assert.equal(v("design", { leased: true }), "AI가 Task를 나누고 설계를 쓰고 있습니다.");
  assert.equal(v("splitting", { leased: true }), "AI가 Task로 나누고 올리는 중입니다.");
  assert.equal(v("questions"), "AI가 묻습니다. 답하면 이어서 씁니다.");
  assert.equal(v("questions", { isPl: false }), "PL의 답을 기다립니다.");
  assert.equal(v("draft"), "Story 초안이 나왔습니다. 읽고 승인하거나, 고칠 점을 적어 다시 쓰게 하세요.");
  assert.equal(v("draft", { isPl: false }), "PL의 승인을 기다립니다.");
  assert.equal(v("awaiting_g3"), "설계를 읽고 승인하면 Task를 올리고 엽니다.");
  assert.equal(v("awaiting_g3", { isPl: false }), "PL의 설계 승인을 기다립니다.");
  assert.equal(v("open", { story: { id: randomUUID(), number: 7 } }), "Story #7이 열렸습니다.");
  assert.equal(v("failed"), "멈췄습니다.");
  assert.equal(v("cancelled"), "취소됐습니다.");
});

test("the board shows 새 프로젝트, each project's plans in progress, and 새 Story only to a member who owns every project repo", async (t) => {
  const h = await team(t);
  const id = h.create();
  // U40: 새 Story and 새 프로젝트 are drawn as buttons, and a plan in progress is a card with its PL's name tag.
  const newStory = `<a class="btn ghost" href="/projects/${h.projectId}/new-story">새 Story</a>`;
  for (const who of [h.pl, h.b, h.c, h.admin]) {
    const board = (await h.get("/board", who)).text;
    assert.ok(board.includes('<a class="btn ghost" href="/projects/new">새 프로젝트</a>'), `${who.member.name}: 새 프로젝트`);
    // D43: /board is the Story board; a plan in progress is a draft card in its 기획 중 column.
    assert.match(board, /<div class="stage" data-stage="planning"><h3><span>기획 중<\/span><span>1<\/span><\/h3>/, who.member.name);
    assert.ok(board.includes(`<li class="scard draft"><p class="kind">웹 기획</p><a class="stitle" href="/plans/${id}">쿠폰 발급</a><p>${pill("기획 대기")}</p><p class="speople"><span class="lead"><span class="av av`), who.member.name);
    assert.equal(board.includes(newStory), who === h.pl, `${who.member.name}: 새 Story only for the owner of app-be and app-fe`);
  }
  // A plan that is no longer in progress leaves the list, and so does the heading.
  h.plans.cancel({ member: h.pl.member }, id, h.view(id).revision);
  const board = (await h.get("/board", h.pl)).text;
  assert.ok(!board.includes(`/plans/${id}`));
  assert.ok(board.includes('<p class="empty">아직 Story가 없습니다.'), "with nothing left the project says what comes next");
  assert.ok(board.includes(newStory));

  const empty = await team(t, { project: false });
  const text = (await empty.get("/board", empty.pl)).text;
  assert.ok(text.includes(EMPTY_BOARD));
  assert.ok(text.includes('<a class="btn ghost" href="/projects/new">새 프로젝트</a>'));
});

test("/projects/new lists only my repos (an admin sees all) with base branch main; POST /projects makes the project and opens its own view on /board; a repo I do not own is a FORBIDDEN page", async (t) => {
  const h = await team(t);
  const box = (r) => `<input type="checkbox" name="repo" value="${r}">`;
  const base = (r) => `name="base-${r}" value="main"`;
  const seen = async (who) => (await h.get("/projects/new", who)).text;
  const b = await seen(h.b);
  assert.ok(b.includes('<form method="post" action="/projects">'));
  assert.ok(b.includes(box(h.fe)) && b.includes(base(h.fe)), "B owns app-fe");
  assert.ok(!b.includes(h.be), "B does not own app-be");
  const c = await seen(h.c);
  assert.ok(c.includes(box(h.be)) && !c.includes(h.fe));
  const admin = await seen(h.admin);
  for (const r of [h.be, h.fe]) assert.ok(admin.includes(box(r)) && admin.includes(base(r)), "an admin may take any repo");

  let res = await h.post(h.b, "/projects", [["name", "화면 개편"], ["repo", h.fe], [`base-${h.fe}`, "develop"]]);
  assert.equal(res.status, 303);
  const made = h.board.projects({ member: h.b.member }).find((p) => p.name === "화면 개편");
  // D44: on 전체 a project with no Story is only a name on one line, so a new project opens its own chip view.
  assert.equal(res.headers.location, `/board?project=${made.id}`);
  assert.deepEqual(made.repos.map((r) => [r.id, r.baseBranch]), [[h.fe, "develop"]]);
  assert.equal(made.createdBy.id, h.b.member.id);
  const board = (await h.get(res.headers.location, h.b)).text;
  assert.ok(board.includes("<h2>화면 개편</h2>"));
  assert.ok(board.includes(`<a class="btn ghost" href="/projects/${made.id}/new-story">새 Story</a>`), "B owns every repo of B's project");

  const before = h.board.projects({ member: h.b.member }).length;
  res = await h.post(h.b, "/projects", [["name", "몰래"], ["repo", h.fe], [`base-${h.fe}`, "main"], ["repo", h.be], [`base-${h.be}`, "main"]]);
  assert.equal(res.status, 403);
  assert.ok(res.text.includes("내가 담당자인 레포만 넣을 수 있습니다."));
  assert.equal(h.board.projects({ member: h.b.member }).length, before, "nothing made");

  // A mistake comes back as the form with the reason.
  res = await h.post(h.b, "/projects", [["name", "빈 프로젝트"]]);
  assert.equal(res.status, 400);
  assert.ok(res.text.includes("프로젝트에는 repo가 하나 이상 필요합니다."));
  assert.ok(res.text.includes(box(h.fe)), "the form again");
  res = await h.post(h.b, "/projects", [["name", "나쁜 브랜치"], ["repo", h.fe], [`base-${h.fe}`, "feature/story-1/base"]]);
  assert.equal(res.status, 400);
  assert.ok(res.text.includes("base 브랜치 이름을 확인해주세요"));
  assert.equal(h.board.projects({ member: h.b.member }).length, before);

  res = await h.post(h.admin, "/projects", [["name", "관리자 프로젝트"], ["repo", h.be], [`base-${h.be}`, "main"], ["repo", h.fe], [`base-${h.fe}`, "main"]]);
  assert.equal(res.status, 303, "an admin owns none and may still");

  const d = await h.enter(h.store.createInvite(h.admin.member, "D"));
  const nobody = await h.get("/projects/new", d);
  assert.ok(nobody.text.includes("내가 담당인 레포가 없습니다."), "a member with no repo is told why");
  assert.ok(!nobody.text.includes('action="/projects"'));
});

test("/projects/<id>/new-story is a 403 page for a member missing a project repo, and so is POST /projects/<id>/plans", async (t) => {
  const h = await team(t);
  const path = `/projects/${h.projectId}/new-story`;
  for (const who of [h.b, h.c, h.admin]) {
    const res = await h.get(path, who);
    assert.equal(res.status, 403, who.member.name);
    assert.ok(res.text.includes(NEW_STORY_FORBIDDEN), who.member.name);
    const sent = await h.post(who, `/projects/${h.projectId}/plans`, { title: "몰래", intent: "하고 싶은 일", risk: "normal" });
    assert.equal(sent.status, 403, who.member.name);
    assert.ok(sent.text.includes(NEW_STORY_FORBIDDEN));
  }
  assert.deepEqual(h.plans.projectPlans(h.projectId), [], "nothing made");

  const form = await h.get(path, h.pl);
  assert.equal(form.status, 200);
  for (const part of [
    `<form method="post" action="/projects/${h.projectId}/plans">`, 'name="title"', '<textarea id="intent" name="intent"',
    '<input type="radio" name="risk" value="normal" checked>', '<input type="radio" name="risk" value="high">',
    "초안 다음에 설계와 Task 목록을 한 번 더 확인합니다.", "기획 문서를 붙여 넣어도 됩니다", "64KB", "쿠폰 개편",
  ]) assert.ok(form.text.includes(part), part);
  assert.equal((await h.get(`/projects/${randomUUID()}/new-story`, h.pl)).status, 404);
});

test("POST /projects/<id>/plans makes a queued plan and goes to /plans/<id>; home lists it under 내가 쓰는 Story", async (t) => {
  let now = 1_000_000_000;
  const h = await team(t, { now: () => now });
  const res = await h.post(h.pl, `/projects/${h.projectId}/plans`, { title: "  쿠폰 발급  ", intent: "쿠폰을\r\n한 번에", risk: "high" });
  assert.equal(res.status, 303);
  const id = /^\/plans\/([0-9a-f-]{36})$/.exec(res.headers.location)?.[1];
  assert.ok(id, res.headers.location);
  const v = h.view(id);
  assert.deepEqual([v.state, v.title, v.intent, v.risk, v.pl.id], ["queued", "쿠폰 발급", "쿠폰을\n한 번에", "high", h.pl.member.id]);
  assert.ok((await h.page(id)).includes("<h1>쿠폰 발급</h1>"));

  now += 1000;
  const later = h.create({ title: "두 번째" });
  now += 1000;
  h.questions(id, [q(1)]); // the first plan changed last
  const home = (await h.get("/me", h.pl)).text;
  assert.ok(home.includes("<h2>내가 쓰는 Story</h2>"));
  const first = `<a href="/plans/${id}">쿠폰 발급</a> ${pill("질문")}`, second = `<a href="/plans/${later}">두 번째</a> ${pill("기획 대기")}`;
  assert.ok(home.includes(first) && home.includes(second));
  assert.ok(home.indexOf(first) < home.indexOf(second), "most recently changed first");
  assert.ok(home.includes('<p class="muted">쿠폰 개편</p>'), "the project");
  assert.ok(!(await h.get("/me", h.b)).text.includes("내가 쓰는 Story"), "B writes none");
});

test("a 65536-byte Korean intent with line breaks (about 196 KB urlencoded) is accepted and kept exactly; 65537 bytes comes back as the form with the typed title and intent and the plain message; a body over 1 MiB is 413", async (t) => {
  const h = await team(t);
  const path = `/projects/${h.projectId}/plans`;
  const intent = korean(65536);
  const body = new URLSearchParams({ csrf: h.pl.csrf, title: "긴 기획", intent: crlf(intent), risk: "normal" }).toString();
  assert.ok(body.length > 190_000 && body.length < 1024 * 1024, `${body.length} bytes: over FORM_LIMIT, under 1 MiB`);
  const res = await h.post(h.pl, path, { title: "긴 기획", intent: crlf(intent), risk: "normal" });
  assert.equal(res.status, 303);
  const id = res.headers.location.split("/").pop();
  assert.equal(h.view(id).intent, intent, "stored LF, exactly");
  assert.ok((await h.page(id)).includes(`<pre>${intent}</pre>`));

  const over = crlf(korean(65537));
  const back = await h.post(h.pl, path, { title: "긴 \"기획\"", intent: over, risk: "high" });
  assert.equal(back.status, 400);
  assert.ok(back.text.includes(INTENT_BYTES));
  assert.ok(back.text.includes('value="긴 &#34;기획&#34;"'), "the typed title");
  assert.ok(back.text.includes(`>\n${over}</textarea>`), "the typed intent");
  assert.ok(back.text.includes('<input type="radio" name="risk" value="high" checked>'), "the chosen risk");
  assert.equal(h.plans.projectPlans(h.projectId).length, 1, "nothing more made");

  const big = await refused(h, h.pl, path, `csrf=${h.pl.csrf}&title=x&risk=normal&intent=${"a".repeat(1024 * 1024)}`);
  assert.equal(big.status, 413);
  assert.ok(big.text.includes("입력이 너무 큽니다."));
});

test("the plan page states each state in plain words (waiting for the PL's Mac, planning while leased, questions, draft, design, awaiting G3, splitting, open with the Story link, failed with its reason, cancelled)", async (t) => {
  const h = await team(t);
  const id = h.create({ risk: "high" });
  // U50: the PL's turn (질문, 초안, 설계 승인 대기) is orange only for the PL; anyone else only watches it (blue).
  const shows = async (label, sentence, who = h.pl) => {
    const text = await h.page(id, who);
    const mark = who === h.pl || TONES[label] !== "need" ? pill(label) : `<span class="pill run">${label}</span>`;
    assert.ok(text.includes(`${mark} ${sentence}`), `${label}: ${sentence}`);
    return text;
  };
  // U50: where the PL has a 지금 할 일 card, the head keeps the state's word and the card says what to do.
  const carded = async (label, doing) => {
    const text = await h.page(id);
    assert.ok(text.includes(`${pill(label)}</p>`), `${label}: the word alone`);
    assert.ok(text.includes(`<p class="do">${doing}</p>`), `${label}: ${doing}`);
    return text;
  };
  let text = await shows("기획 대기", WAITING);
  for (const part of ["<h1>쿠폰 발급</h1>", "쿠폰 개편", "PL PL · 위험도 높음", `<a class="refresh" href="/plans/${id}">새로 고침</a>`, "<details><summary>처음에 적은 하고 싶은 일</summary><pre>쿠폰을 한 번에 발급하고 싶어요.</pre></details>"])
    assert.ok(text.includes(part), part);
  h.lease(id);
  await shows("기획 중", "AI가 기획하고 있습니다.");
  h.questions(id, [q(1)]);
  await carded("질문", "AI의 질문 1개에 답해 주세요");
  await shows("질문", "PL의 답을 기다립니다.", h.b);
  h.answerAll(id);
  h.draft(id);
  await carded("초안", "Story 초안을 확인해 주세요");
  await shows("초안", "PL의 승인을 기다립니다.", h.b);
  h.approve(id);
  await shows("설계 대기", WAITING);
  h.lease(id);
  await shows("설계 중", "AI가 Task를 나누고 설계를 쓰고 있습니다.");
  h.design(id);
  await carded("설계 승인 대기", "설계와 Task를 확인해 주세요");
  await shows("설계 승인 대기", "PL의 설계 승인을 기다립니다.", h.b);
  h.approve(id, "G3");
  await shows("나누기 대기", WAITING);
  h.lease(id);
  await shows("나누는 중", "AI가 Task로 나누고 올리는 중입니다.");
  h.failed(id, `app-fe의 Story base를 올리지 못했습니다.\ngit push: rejected\n권한 없음`);
  text = await carded("멈춤", "기획이 멈췄습니다");
  assert.ok(text.includes("<p><b>app-fe의 Story base를 올리지 못했습니다.</b></p>"));
  assert.ok(text.includes("<details><summary>자세한 이유</summary><pre>git push: rejected\n권한 없음</pre></details>"));
  h.plans.retry(h.pl.member, id, h.view(id).revision);
  const pub = h.publishOpen(id);
  h.result(id, { kind: "open", storyId: pub.storyId });
  text = await shows("열림", `Story #${pub.number}이 열렸습니다.`);
  assert.ok(text.includes(`<a href="/stories/${pub.storyId}">Story #${pub.number} 보기</a>`));
  assert.ok(text.includes("초안 승인(G1): PL · ") && text.includes("설계 승인(G3): PL · "), "the approvals");
  assert.ok(!text.includes("/cancel"), "an opened plan is not cancelled here");
  assert.ok(!(await h.get("/board", h.pl)).text.includes(`/plans/${id}`), "no longer in progress");
  assert.ok(!(await h.get("/me", h.pl)).text.includes(`/plans/${id}`));

  const gone = h.create();
  h.plans.cancel({ member: h.pl.member }, gone, h.view(gone).revision);
  assert.ok((await h.page(gone)).includes(`${pill("취소됨")} 취소됐습니다.`));
  assert.equal((await h.get(`/plans/${randomUUID()}`, h.pl)).status, 404);
});

test("a waiting plan says the PL's Mac is off with its last beat, or names the Task the PL's Office holds", async (t) => {
  let skew = 0;
  const h = await team(t, { storeNow: () => Date.now() + skew });
  const id = h.create();
  assert.ok((await h.page(id, h.b)).includes("<p>PL의 Mac: 연결된 Mac 없음</p>"));
  // The Mac's last beat was five minutes ago.
  skew = -5 * 60_000;
  const started = h.store.startMac("PL의 Mac");
  h.store.approveMac(h.pl.member, started.userCode);
  const mac = h.store.mac(h.store.pollMac(started.deviceCode).macToken);
  h.store.macHeartbeat(mac, "idle", null);
  assert.ok(5 * 60_000 > MAC_OFFLINE_MS);
  skew = 0;
  const off = "<p>PL의 Mac이 꺼져 있습니다(마지막 확인 5분 전). 켜지면 이어서 합니다.</p>";
  assert.ok((await h.page(id, h.b)).includes(off));
  h.store.macHeartbeat(mac, "idle", null);
  assert.ok((await h.page(id, h.b)).includes("<p>PL의 Mac: 대기 중</p>"));
  skew = 5 * 60_000;

  // The PL's Office holds a Task: planning waits for it, whatever the Mac says.
  const pub = h.board.publishStory(h.plBe, {
    projectId: h.projectId, title: "다른 Story", body: "# Story", risk: "normal", key: "k1",
    graph: { nodes: [{ id: "api", repoId: h.be, title: "api", spec: "api 설명", files: ["src/api.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  assert.ok(h.board.claimNext(h.plBe));
  const held = h.board.openTaskOfMember(h.pl.member.id);
  assert.equal(held.repoName, "app-be");
  const task = `${pill("기획 대기")} PL의 Office가 Story #${pub.number} Task #${held.taskNumber}(app-be)을 맡고 있어, 그 Task가 끝나면 이어서 기획합니다.</p>`;
  let text = await h.page(id, h.b);
  assert.ok(text.includes(task));
  assert.ok(!text.includes("꺼져 있습니다"));

  // While the Office is at it the Mac is said only when it went off meanwhile (H10), never the Task.
  h.lease(id);
  text = await h.page(id, h.b);
  assert.ok(text.includes(`${pill("기획 중")} AI가 기획하고 있습니다.`));
  // (The page's "ago" reads the real clock; only the store's runs five minutes ahead here.)
  assert.match(text, /<p>PL의 Mac이 꺼져 있습니다\(마지막 확인 [^)]+\)\. 켜지면 이어서 합니다\.<\/p>/, "the Mac went off mid-step");
  assert.ok(!text.includes("PL의 Office가"));
  h.store.macHeartbeat(mac, "working", null);
  text = await h.page(id, h.b);
  assert.ok(!text.includes("PL의 Office가") && !text.includes("PL의 Mac"));
  h.questions(id, [q(1)]);
  text = await h.page(id, h.b);
  assert.ok(!text.includes("PL의 Office가") && !text.includes("PL의 Mac"));
});

test("questions show one form per round with a 4000-character box per question and 막는 결정 on blocking ones; three 4000-character Korean answers (about 108 KB urlencoded) are accepted", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.questions(id, [q(1, true), q(2), q(3)]);
  let text = await h.page(id);
  const action = `/plans/${id}/answer`;
  assert.equal(count(text, "<form "), 2, "the answer form and the cancel form");
  assert.equal(count(text, `<form method="post" action="${action}">`), 1);
  assert.deepEqual(formOf(text, action), { revision: String(h.view(id).revision) });
  for (const n of [1, 2, 3]) {
    assert.ok(text.includes(`<textarea name="answer-Q${n}" rows="4" maxlength="4000" required></textarea>`), `Q${n}`);
    assert.ok(text.includes(`질문 ${n}`) && text.includes(`왜 묻나요: 이유 ${n}`), `Q${n} text and reason`);
  }
  const must = '<span class="pill need">꼭 정해야 함</span>';
  assert.equal(count(text, must), 1, "Q1 only");
  assert.ok(text.indexOf(must) < text.indexOf("질문 2"));

  // Each answer is 4000 characters once the browser's CRLF is LF.
  const answer = (n) => `${"가".repeat(1999)}\n${"나".repeat(1999)}${n}`;
  const fields = Object.fromEntries([1, 2, 3].map((n) => [`answer-Q${n}`, crlf(answer(n))]));
  const body = new URLSearchParams({ csrf: h.pl.csrf, revision: String(h.view(id).revision), ...fields }).toString();
  assert.ok(body.length > 100_000, `${body.length} bytes: over FORM_LIMIT`);
  const res = await h.post(h.pl, action, { revision: String(h.view(id).revision), ...fields });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/plans/${id}`);
  const v = h.view(id);
  assert.equal(v.state, "queued");
  assert.deepEqual(v.rounds[0].answers, [1, 2, 3].map((n) => ({ id: `Q${n}`, answer: answer(n) })));

  // The next round: the last one is read only, the new one has the only form.
  h.questions(id, [q(1)]);
  text = await h.page(id);
  assert.equal(count(text, `<form method="post" action="${action}">`), 1);
  assert.ok(text.includes('<textarea name="answer-Q1"') && !text.includes('name="answer-Q2"'));
  assert.ok(text.includes(`<pre>${answer(1)}</pre>`) && text.includes(`<pre>${answer(3)}</pre>`), "round 1's answers");
});

test("the draft shows its text with 승인 (hidden revision and hash) and 고쳐 써 주세요; a draft with OPEN BLOCKING shows why there is no 승인", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id);
  let text = await h.page(id);
  assert.ok(text.includes(`<pre># Story: 쿠폰 발급\n\n## Decisions\n- ASSUMED: 쿠폰은 한 번만 쓴다\n</pre>`));
  assert.deepEqual(formOf(text, `/plans/${id}/approve`), { revision: String(h.view(id).revision), gate: "G1", hash: planTextHash(DRAFT) });
  assert.ok(text.includes("승인하면 AI가 Task로 나눠 바로 올리고 엽니다."));
  assert.ok(text.includes("<button>초안 승인</button>"));
  assert.deepEqual(formOf(text, `/plans/${id}/rewrite`), { revision: String(h.view(id).revision) });
  assert.ok(text.includes('<textarea name="note" rows="4" maxlength="4000" required></textarea>'));
  assert.ok(text.includes('<button class="secondary">고쳐 써 주세요</button>'));

  // 고쳐 써 주세요 sends it back with the note, counted after CRLF.
  const res = await h.post(h.pl, `/plans/${id}/rewrite`, { revision: String(h.view(id).revision), note: "버튼 문구를\r\n바꿔 주세요" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/plans/${id}`);
  assert.deepEqual([h.view(id).state, h.view(id).rewrite], ["queued", { note: "버튼 문구를\n바꿔 주세요" }]);
  assert.ok((await h.page(id)).includes("<pre>버튼 문구를\n바꿔 주세요</pre>"), "the note stays on the page");

  const high = h.create({ risk: "high" });
  h.draft(id);
  h.draft(high);
  assert.ok((await h.page(high)).includes("승인하면 AI가 Task를 나누고 설계를 보여 드립니다."));

  const blocked = h.create();
  h.draft(blocked, BLOCKED);
  text = await h.page(blocked);
  assert.ok(!text.includes(`/plans/${blocked}/approve`));
  assert.ok(text.includes("막는 결정이 남은 초안은 승인할 수 없습니다. 고칠 점을 적어 다시 쓰게 하세요."));
  assert.ok(text.includes(`/plans/${blocked}/rewrite`), "the way out");

  // A PL who no longer owns every repo is told who can fix it.
  h.store.removeOwner(h.admin.member, h.fe, h.pl.member.id);
  text = await h.page(id);
  assert.ok(!text.includes(`/plans/${id}/approve`));
  assert.ok(text.includes("프로젝트의 모든 레포 담당자여야 승인할 수 있습니다. 관리자에게 담당자 등록을 요청하세요."));
});

test("승인 moves the plan on; a second click or an older tab redirects to /plans/<id>?changed=1 with the notice and changes nothing", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id);
  const tab = formOf(await h.page(id), `/plans/${id}/approve`);
  let res = await h.post(h.pl, `/plans/${id}/approve`, tab);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/plans/${id}`);
  const after = h.view(id);
  assert.equal(after.state, "splitting");
  assert.equal(after.g1.textHash, planTextHash(DRAFT));

  res = await h.post(h.pl, `/plans/${id}/approve`, tab);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/plans/${id}?changed=1`);
  assert.deepEqual(h.view(id), after, "the second click changes nothing");
  assert.ok((await h.get(`/plans/${id}?changed=1`, h.pl)).text.includes(CHANGED));
  assert.ok(!(await h.page(id)).includes(CHANGED));
  // Out of the Office's way, so the next plans are the ones it leases.
  h.plans.cancel({ member: h.pl.member }, id, h.view(id).revision);

  // An older tab: the draft was rewritten and replaced since it was drawn.
  const other = h.create();
  h.draft(other);
  const old = await h.page(other);
  h.plans.rewrite(h.pl.member, other, h.view(other).revision, "더 짧게");
  h.draft(other, `${DRAFT}\n더 짧게 고침\n`);
  const now = h.view(other);
  for (const [action, fields] of [
    ["approve", formOf(old, `/plans/${other}/approve`)],
    ["rewrite", { ...formOf(old, `/plans/${other}/rewrite`), note: "다시" }],
    ["cancel", { revision: formOf(old, `/plans/${other}/approve`).revision, confirm: "yes" }],
    // The page's revision with a text it did not show is a stale page too.
    ["approve", { ...formOf(await h.page(other), `/plans/${other}/approve`), hash: planTextHash(DRAFT) }],
  ]) {
    res = await h.post(h.pl, `/plans/${other}/${action}`, fields);
    assert.equal(res.headers.location, `/plans/${other}?changed=1`, action);
  }
  assert.deepEqual(h.view(other), now, "the older tab changed nothing");

  // A double 다시 시도 and an answer from an older tab.
  const third = h.create();
  h.failed(third, "모델이 멈췄습니다.");
  const retry = formOf(await h.page(third), `/plans/${third}/retry`);
  assert.equal((await h.post(h.pl, `/plans/${third}/retry`, retry)).headers.location, `/plans/${third}`);
  assert.equal(h.view(third).state, "queued");
  assert.equal((await h.post(h.pl, `/plans/${third}/retry`, retry)).headers.location, `/plans/${third}?changed=1`);
  h.questions(third, [q(1)]);
  const asked = formOf(await h.page(third), `/plans/${third}/answer`);
  h.answerAll(third);
  assert.equal((await h.post(h.pl, `/plans/${third}/answer`, { ...asked, "answer-Q1": "늦은 답" })).headers.location, `/plans/${third}?changed=1`);
  assert.equal(h.view(third).rounds[0].answers[0].answer, "네");

  // A revision that is not a whole number is a plain INVALID page.
  for (const revision of ["", "abc", "1.5", "-1"]) {
    res = await h.post(h.pl, `/plans/${third}/cancel`, { revision, confirm: "yes" });
    assert.equal(res.status, 400, revision);
    assert.ok(res.text.includes("화면을 새로 고친 뒤 다시 누르세요."));
  }
});

test("고쳐 써 주세요 keeps FORM_LIMIT: a 70 KB body is 413", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id);
  const res = await refused(h, h.pl, `/plans/${id}/rewrite`, `csrf=${h.pl.csrf}&revision=${h.view(id).revision}&note=${"a".repeat(70 * 1024)}`);
  assert.equal(res.status, 413);
  assert.equal(h.view(id).state, "draft");
});

test("설계 승인, 다시 시도 and 취소 work for the PL; 취소 without 정말 취소합니다 is an INVALID page and the plan stays", async (t) => {
  const h = await team(t);
  const id = h.create({ risk: "high" });
  h.draft(id);
  h.approve(id);
  h.design(id);
  let text = await h.page(id);
  assert.ok(text.includes(`<pre># 설계\n\n1. api: 쿠폰 발급 API\n2. ui: 쿠폰 버튼\n</pre>`));
  const g3 = formOf(text, `/plans/${id}/approve`);
  assert.deepEqual(g3, { revision: String(h.view(id).revision), gate: "G3", hash: planTextHash(DESIGN) });
  assert.ok(text.includes(G3_NOTE));
  assert.ok(text.includes("<button>설계 승인하고 시작</button>"));
  assert.ok(!text.includes(`/plans/${id}/rewrite`), "a design is not rewritten");
  let res = await h.post(h.pl, `/plans/${id}/approve`, g3);
  assert.equal(res.headers.location, `/plans/${id}`);
  assert.equal(h.view(id).state, "splitting");
  assert.equal(h.view(id).g3.textHash, planTextHash(DESIGN));

  h.failed(id, "app-be의 Story base를 올리지 못했습니다.");
  text = await h.page(id);
  assert.ok(text.includes("<p><b>app-be의 Story base를 올리지 못했습니다.</b></p>"));
  assert.ok(!text.includes("자세한 이유"), "one line has no details");
  assert.ok(text.includes("<button>다시 시도</button>"));
  res = await h.post(h.pl, `/plans/${id}/retry`, formOf(text, `/plans/${id}/retry`));
  assert.equal(res.headers.location, `/plans/${id}`);
  assert.equal(h.view(id).state, "splitting");

  text = await h.page(id);
  for (const part of [
    "취소하면 이 기획을 멈춥니다. 이미 올라간 Story가 아직 열리지 않았으면 함께 취소됩니다.",
    '<label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label>',
    '<button class="danger">취소</button>',
  ]) assert.ok(text.includes(part), part);
  const cancel = formOf(text, `/plans/${id}/cancel`);
  res = await h.post(h.pl, `/plans/${id}/cancel`, cancel);
  assert.equal(res.status, 400);
  assert.ok(res.text.includes("취소하려면 &#39;정말 취소합니다&#39;를 체크하세요."));
  assert.equal(h.view(id).state, "splitting", "the plan stays");
  res = await h.post(h.pl, `/plans/${id}/cancel`, { ...cancel, confirm: "yes" });
  assert.equal(res.headers.location, `/plans/${id}`);
  assert.equal(h.view(id).state, "cancelled");
  assert.ok(!(await h.page(id)).includes("<form "), "nothing left to do");

  // A hub admin may cancel (to recover), and that is all an admin may do.
  const other = h.create();
  h.draft(other);
  text = await h.page(other, h.admin);
  assert.equal(count(text, "<form "), 1);
  res = await h.post(h.admin, `/plans/${other}/cancel`, { ...formOf(text, `/plans/${other}/cancel`), confirm: "yes" });
  assert.equal(res.headers.location, `/plans/${other}`);
  assert.equal(h.view(other).state, "cancelled");
});

test("a member who is not the PL sees no form, and every plan POST from them is a FORBIDDEN page", async (t) => {
  const h = await team(t);
  const id = h.create({ risk: "high" });
  const none = async () => {
    for (const who of [h.b, h.c]) assert.ok(!(await h.page(id, who)).includes("<form "), `${who.member.name}: ${h.view(id).state}`);
  };
  const refusedAll = async () => {
    const before = h.view(id);
    const revision = String(before.revision);
    for (const [action, fields, message] of [
      ["answer", { revision, "answer-Q1": "답" }, "이 Story를 쓰는 PL만 할 수 있습니다."],
      ["rewrite", { revision, note: "고쳐" }, "이 Story를 쓰는 PL만 할 수 있습니다."],
      ["approve", { revision, gate: "G1", hash: before.draft?.hash ?? "x" }, "이 Story를 쓰는 PL만 할 수 있습니다."],
      ["retry", { revision }, "이 Story를 쓰는 PL만 할 수 있습니다."],
      ["cancel", { revision, confirm: "yes" }, "이 Story를 쓰는 PL이나 허브 관리자만 취소할 수 있습니다."],
    ]) {
      const res = await h.post(h.b, `/plans/${id}/${action}`, fields);
      assert.equal(res.status, 403, action);
      assert.ok(res.text.includes(message), action);
    }
    assert.deepEqual(h.view(id), before, "nothing changed");
  };
  await none();
  h.questions(id, [q(1)]);
  await none();
  await refusedAll();
  h.answerAll(id);
  h.draft(id);
  await none();
  await refusedAll();
  h.approve(id);
  h.design(id);
  await none();
  h.approve(id, "G3");
  h.failed(id, "멈춤");
  await none();
  await refusedAll();
});

test("every new POST is 403 from another origin or without the CSRF token; project name, plan title, intent, questions, answers, draft, design and failure reason are escaped on the board, home and plan pages; the new pages load no script", async (t) => {
  const text = (s) => `${s} ${EVIL}`;
  const h = await team(t, { names: { pl: `PL ${EVIL}` }, text });
  const id = h.create({ risk: "high" });
  h.questions(id, [q(1, true, text)]);
  h.answerAll(id, text("답"));
  h.draft(id, text(DRAFT));
  h.approve(id);
  h.design(id, text(DESIGN), splitOf(h.be, h.fe, text));
  const stuck = h.create();
  h.failed(stuck, `${text("첫 줄")}\n${text("자세히")}`);

  const posts = [
    ["/projects", [["name", "x"], ["repo", h.be], [`base-${h.be}`, "main"]]],
    [`/projects/${h.projectId}/plans`, { title: "x", intent: "y", risk: "normal" }],
    ...["answer", "rewrite", "approve", "retry", "cancel"].map((a) => [`/plans/${id}/${a}`, { revision: String(h.view(id).revision), confirm: "yes" }]),
  ];
  const before = [h.view(id), h.view(stuck), h.board.projects({ member: h.pl.member }).length];
  for (const [path, fields] of posts) {
    const foreign = await h.post(h.pl, path, fields, { origin: "https://evil.example.com" });
    assert.equal(foreign.status, 403, `origin ${path}`);
    assert.ok(foreign.text.includes("다른 사이트에서 보낸 요청은 받지 않습니다."));
    assert.equal((await h.post(h.pl, path, fields, { origin: null })).status, 403, `no origin ${path}`);
    const token = await h.post(h.pl, path, fields, { csrf: null });
    assert.equal(token.status, 403, `csrf ${path}`);
    assert.ok(token.text.includes("화면을 새로 고친 뒤 다시 시도해주세요."));
    assert.equal((await h.post(h.pl, path, fields, { csrf: "x".repeat(h.pl.csrf.length) })).status, 403, `wrong csrf ${path}`);
  }
  assert.deepEqual([h.view(id), h.view(stuck), h.board.projects({ member: h.pl.member }).length], before, "nothing changed");

  const back = await h.post(h.pl, `/projects/${h.projectId}/plans`, { title: text("제목"), intent: "", risk: "normal" });
  assert.equal(back.status, 400);
  const pages = [
    ["/board", h.b], ["/me", h.pl], [`/plans/${id}`, h.pl], [`/plans/${id}`, h.b], [`/plans/${stuck}`, h.pl],
    ["/projects/new", h.pl], [`/projects/${h.projectId}/new-story`, h.pl],
  ];
  for (const [path, who] of pages) {
    const res = await h.get(path, who);
    assert.equal(res.status, 200, path);
    assert.ok(!res.text.includes("<img"), `${path} has no raw markup`);
    assert.ok(res.text.includes(SAFE), `${path} shows the escaped text`);
    assert.doesNotMatch(res.text, /<script(?! src="\/live\.js" defer><\/script>)/i, `${path} loads no script but /live.js`);
  }
  assert.ok(!back.text.includes("<img") && back.text.includes(`value="제목 ${SAFE}"`), "the form sent back");
  const plan = (await h.get(`/plans/${id}`, h.b)).text;
  for (const part of [`쿠폰 발급 ${SAFE}`, `쿠폰을 한 번에 발급하고 싶어요. ${SAFE}`, `질문 1 ${SAFE}`, `이유 1 ${SAFE}`, `답 ${SAFE}`, `${DRAFT} ${SAFE}`, `${DESIGN} ${SAFE}`, `쿠폰 개편 ${SAFE}`, `PL ${SAFE}`,
    `쿠폰 API ${SAFE}`, `Outcome: 쿠폰을 발급한다\nScope: api ${SAFE}`, `<code>src/api.ts ${SAFE}</code>`, `<code>coupon api ${SAFE}</code>`, `<code>e2e ${SAFE}</code>`, `app-be ${SAFE}`])
    assert.ok(plan.includes(part), part);
  const failedPage = (await h.get(`/plans/${stuck}`, h.pl)).text;
  assert.ok(failedPage.includes(`<b>첫 줄 ${SAFE}</b>`) && failedPage.includes(`<pre>자세히 ${SAFE}</pre>`));
  const board = (await h.get("/board", h.b)).text;
  assert.ok(board.includes(`쿠폰 개편 ${SAFE}`) && board.includes(`쿠폰 발급 ${SAFE}`) && board.includes(`PL ${SAFE}`));
  assert.ok((await h.get("/projects/new", h.pl)).text.includes(`app-be ${SAFE}`));
});

test("a hub without plans answers 404 for the new pages and draws the board and home as before", async (t) => {
  const h = await team(t, { plans: false });
  const id = randomUUID();
  for (const path of ["/projects/new", `/projects/${h.projectId}/new-story`, `/plans/${id}`])
    assert.equal((await h.get(path, h.pl)).status, 404, path);
  for (const [path, fields] of [
    ["/projects", [["name", "x"], ["repo", h.be], [`base-${h.be}`, "main"]]],
    [`/projects/${h.projectId}/plans`, { title: "x", intent: "y", risk: "normal" }],
    ...["answer", "rewrite", "approve", "retry", "cancel"].map((a) => [`/plans/${id}/${a}`, { revision: "1" }]),
  ]) assert.equal((await h.post(h.pl, path, fields)).status, 404, path);
  // The plan forms keep FORM_LIMIT on a hub without them.
  assert.equal((await refused(h, h.pl, `/projects/${h.projectId}/plans`, `csrf=${h.pl.csrf}&intent=${"a".repeat(70 * 1024)}`)).status, 413);
  const board = (await h.get("/board", h.pl)).text;
  assert.ok(board.includes("<h2>쿠폰 개편</h2>"));
  for (const part of ["새 프로젝트", "새 Story", "기획 중", "/projects/"]) assert.ok(!board.includes(part), part);
  assert.ok(!(await h.get("/me", h.pl)).text.includes("내가 쓰는 Story"));
  const empty = await team(t, { plans: false, project: false });
  const text = (await empty.get("/board", empty.pl)).text;
  assert.ok(text.includes(OLD_EMPTY_BOARD));
  assert.ok(!text.includes("새 프로젝트"));
});

// ---- Final-review fixes: the whole split at G3 (H4), cancel of an opened plan (H2), the PL's Mac and Task lines (H10),
// the plan's repos the PL's Office has not reached (H11), a plan whose repos changed (H3).

test("the design shows the stored split in full under 올라갈 Task 전부 보기 (each Task's repo, title, what it waits for, spec, files, checks with their commands; the Story checks) before 설계 승인, whose note says it covers all of it", async (t) => {
  const h = await team(t);
  const id = h.create({ risk: "high" });
  h.draft(id);
  h.approve(id);
  h.design(id, DESIGN, splitOf(h.be, h.fe));
  let text = await h.page(id, h.b);
  const block = /<details><summary>올라갈 Task 전부 보기<\/summary>([\s\S]*?)<\/details>/.exec(text);
  assert.ok(block, "the details block, for every member");
  for (const part of [
    "<b>t1 · app-be · 쿠폰 API</b>", "<b>t2 · app-fe · 쿠폰 버튼</b>", "먼저 끝나야 할 Task: 없음", "먼저 끝나야 할 Task: t1",
    "<pre>Outcome: 쿠폰을 발급한다\nScope: api</pre>", "<pre>Outcome: 버튼</pre>",
    "<li><code>src/api.ts</code></li>", "<li><code>src/coupon.ts</code></li>", "<li><code>src/ui.tsx</code></li>",
    "<li>V1: <code>npm</code> <code>test</code> <code>--</code> <code>coupon api</code> (60초 안)</li>",
    "<li>V1: <code>npm</code> <code>run</code> <code>test:ui</code> (120초 안)</li>",
    "Story 전체 확인", "<li>app-fe — S1: <code>npm</code> <code>run</code> <code>e2e</code> (600초 안)</li>",
  ]) assert.ok(block[1].includes(part), part);
  assert.ok(!block[1].includes("<details"), "the outer fold is the only fold: files and checks are shown directly");
  text = await h.page(id);
  assert.ok(text.includes(G3_NOTE));
  assert.ok(text.indexOf("<summary>올라갈 Task 전부 보기</summary>") < text.indexOf(`/plans/${id}/approve`), "read before the button");
  h.approve(id, "G3");
  assert.ok((await h.page(id)).includes("<summary>올라갈 Task 전부 보기</summary>"), "kept for the record after G3");
  h.plans.cancel({ member: h.pl.member }, id, h.view(id).revision);
  // A split of another shape is shown as it was stored, so nothing in it is hidden.
  const odd = h.create({ risk: "high" });
  h.draft(odd);
  h.approve(odd);
  h.design(odd, DESIGN, { tasks: [{ id: "api", note: EVIL }] });
  text = await h.page(odd);
  assert.ok(/<details><summary>올라갈 Task 전부 보기<\/summary><pre class="mono">[^<]*&#34;tasks&#34;/.test(text));
  assert.ok(text.includes(SAFE) && !text.includes("<img"));
  // A normal-risk plan has no stored split.
  const normal = h.create();
  h.draft(normal);
  assert.ok(!(await h.page(normal)).includes("올라갈 Task 전부 보기"));
});

test("취소 on a plan whose Story already opened ends the plan open and the page says so once, with the Story link", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id);
  h.approve(id);
  h.lease(id);
  const pub = h.publishOpen(id); // open reached the Hub, the open result did not
  const cancel = formOf(await h.page(id), `/plans/${id}/cancel`);
  const res = await h.post(h.pl, `/plans/${id}/cancel`, { ...cancel, confirm: "yes" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/plans/${id}?opened=1`);
  const text = (await h.get(res.headers.location, h.pl)).text.replace(/<header>[\s\S]*?<\/header>/, "");
  assert.ok(text.includes(`<section role="status"><p>${OPENED(pub.number)}</p></section>`), "the first line in bold, the next on its own (U49)");
  assert.ok(text.includes(`${pill("열림")} Story #${pub.number}이 열렸습니다.`));
  assert.ok(text.includes(`<a href="/stories/${pub.storyId}">Story #${pub.number} 보기</a>`));
  assert.ok(!text.includes("<form "), "nothing left to do");
  assert.deepEqual([h.view(id).state, h.view(id).story.id], ["open", pub.storyId]);
  assert.equal(h.board.story({ member: h.pl.member }, pub.storyId).state, "open");
  assert.ok(!(await h.page(id)).includes(OPENED(pub.number)), "only right after the click");
  // A plain cancel goes back without it, and the notice needs an open plan.
  const other = h.create();
  const plain = await h.post(h.pl, `/plans/${other}/cancel`, { revision: String(h.view(other).revision), confirm: "yes" });
  assert.equal(plain.headers.location, `/plans/${other}`);
  assert.ok(!(await h.get(`/plans/${other}?opened=1`, h.pl)).text.includes("이미 열려"));
});

test("a waiting plan whose PL holds a failed Task says that Task must be retried or released, naming Story #S Task #T", async (t) => {
  const h = await team(t);
  const id = h.create();
  const pub = h.board.publishStory(h.plBe, {
    projectId: h.projectId, title: "다른 Story", body: "# Story", risk: "normal", key: "k1",
    graph: { nodes: [{ id: "api", repoId: h.be, title: "api", spec: "api 설명", files: ["src/api.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  const claimed = h.board.claimNext(h.plBe);
  h.board.reportFailed(h.plBe, claimed.taskId, claimed.claimId, "검사가 실패했습니다.");
  const text = await h.page(id, h.b);
  assert.ok(text.includes(`${pill("기획 대기")} PL의 Office가 Story #${pub.number} Task #${claimed.number}(app-be)을 맡고 있는데 그 Task가 멈췄습니다. 그 Task를 다시 시도하거나 풀어야 기획이 이어집니다.</p>`));
  assert.ok(!text.includes("끝나면 이어서"));
  assert.ok(!text.includes("PL의 Office에 연결되지 않은"), "a busy Office reads only its Task's repo, so the others are not named");
});

test("a plan with Office work and no live lease names the plan's repos the PL's Office has not reached lately; not while leased, while the PL's Mac is off, or when the plan waits for the PL", async (t) => {
  let skew = 0;
  const h = await team(t, { storeNow: () => Date.now() + skew });
  const id = h.create();
  let text = await h.page(id, h.b);
  assert.ok(text.includes(UNLINKED("app-fe")), "app-be's link was used at setup; app-fe has none");
  assert.ok(text.includes("<p>PL의 Mac: 연결된 Mac 없음</p>"));
  skew = MAC_OFFLINE_MS + 1000;
  assert.ok((await h.page(id)).includes(UNLINKED("app-be, app-fe")), "nothing reached lately");
  h.linkOf(h.pl, h.be);
  h.linkOf(h.pl, h.fe);
  assert.ok(!(await h.page(id)).includes("PL의 Office에 연결되지 않은"), "both reached now");
  skew += MAC_OFFLINE_MS + 1000;
  h.lease(id);
  assert.ok(!(await h.page(id)).includes("PL의 Office에 연결되지 않은"), "the Office is at it");
  h.draft(id);
  assert.ok(!(await h.page(id)).includes("PL의 Office에 연결되지 않은"), "waiting for the PL");
  // The PL's Mac is off: the Mac line says why, and every repo looks unreached for that reason alone.
  const started = h.store.startMac("PL의 Mac");
  h.store.approveMac(h.pl.member, started.userCode);
  h.store.macHeartbeat(h.store.mac(h.store.pollMac(started.deviceCode).macToken), "idle", null);
  skew += 5 * 60_000;
  const other = h.create();
  text = await h.page(other);
  assert.ok(text.includes("PL의 Mac이 꺼져 있습니다"));
  assert.ok(!text.includes("PL의 Office에 연결되지 않은"));
});

test("a plan whose project changed one of its repos since it started shows why it cannot be approved instead of 승인", async () => {
  const { planPage } = await import("../src/hub/plan-pages.ts");
  const v = {
    id: randomUUID(), project: { id: randomUUID(), name: "쿠폰 개편" }, pl: { id: "m", name: "PL" }, title: "쿠폰 발급", intent: "쿠폰", risk: "normal",
    state: "draft", revision: 3, repos: [], rounds: [], draft: { text: DRAFT, hash: planTextHash(DRAFT) }, rewrite: null, design: null, split: null,
    g1: null, g3: null, failure: null, story: null, leased: false, heartbeatAt: null, createdAt: 0, updatedAt: 0, isPl: true,
    actions: { answer: false, rewrite: true, approve: "repos-changed", retry: false, cancel: true },
  };
  const html = planPage({ id: "m", name: "PL", admin: false }, "c", v, { plMac: { state: "none", lastSeen: null }, plOpenTask: null, changed: false, unlinked: [], opened: false }, {});
  assert.ok(unline(html).includes("<p>기획을 시작한 뒤 프로젝트의 레포나 기준 브랜치가 바뀌어 승인할 수 없습니다. 프로젝트를 처음대로 되돌리거나, 취소하고 새 Story로 시작하세요.</p>"));
  assert.ok(!html.includes(`/plans/${v.id}/approve`));
  assert.ok(html.includes(`/plans/${v.id}/rewrite`));
});

// U50 (나 결정 카드 PR 4, the Story creation flow): steps on the plan, one 지금 할 일 card per state, the draft read in
// Korean heads with its raw text bound to the approval, the tasks a design publishes, the way out folded, tone by viewer.
const FULL = "# Story: 쿠폰 발급\nStatus: Draft\nOwner: Human\nUnderstanding gate (G1): pending\n\n## Goal\n회원에게 쿠폰을 한 번에 발급한다.\n\n## MUST\n- M1. 발급 버튼을 누르면 쿠폰이 생긴다.\n\n## OUT\n- 문자 발송\n\n## Decisions\n- D1. ASSUMED: 쿠폰은 한 번만 쓴다.\n- D2. PL 답: 몇 장? → 한 장\n\n## Verify\n- V1 [M1]. npm test로 발급을 확인한다.\n";
const stepsOf = (text) => {
  const ol = /<ol class="steps plansteps" aria-label="기획 단계">([\s\S]*?)<\/ol>/.exec(text)?.[1] ?? "";
  return [...ol.matchAll(/<li( class="past"| class="now" aria-current="step")?><span class="sn">([^<]+)<\/span><\/li>/g)].map((m) => `${m[1] ? (m[1].includes("now") ? "▶" : "✓") : "·"}${m[2]}`);
};
const cardOf = (text) => /<section class="decide" aria-labelledby="decide">([\s\S]*?)<\/section>/.exec(text)?.[1] ?? null;

test("U50: the plan shows its steps, with the one it is on marked, and on a phone 'N/M단계 · name'", async (t) => {
  const h = await team(t);
  const id = h.create();
  assert.deepEqual(stepsOf(await h.page(id)), ["✓하고 싶은 일", "▶AI 질문", "·초안 확인", "·Task로 나누기", "·보드에서 시작"]);
  h.draft(id);
  let text = await h.page(id);
  assert.deepEqual(stepsOf(text), ["✓하고 싶은 일", "✓AI 질문", "▶초안 확인", "·Task로 나누기", "·보드에서 시작"]);
  assert.ok(text.includes('<p class="stepnow" aria-hidden="true">3/5단계 · 초안 확인</p>'));
  const high = h.create({ risk: "high" });
  h.draft(high);
  h.approve(high);
  h.design(high, DESIGN, splitOf(h.be, h.fe));
  text = await h.page(high);
  assert.deepEqual(stepsOf(text), ["✓하고 싶은 일", "✓AI 질문", "✓초안 확인", "▶설계 확인", "·Task로 나누기", "·보드에서 시작"]);
  assert.ok(text.includes("4/6단계 · 설계 확인"));
  const np = (await h.get(`/projects/${h.projectId}/new-story`, h.pl)).text;
  assert.deepEqual(stepsOf(np), ["▶하고 싶은 일", "·AI 질문", "·초안 확인", "·Task로 나누기", "·보드에서 시작"]);
});

test("U50: AI questions are the PL's 지금 할 일: how many, what happens next, 꼭 정해야 함 and 왜 묻나요", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.questions(id, [q(1, true), q(2)]);
  const text = await h.page(id);
  const card = cardOf(text) ?? "";
  assert.ok(card.includes('<p class="do">AI의 질문 2개에 답해 주세요</p>'));
  assert.ok(card.includes("답을 보내면 내 Mac의 AI가 이어서 Story 초안을 씁니다."));
  assert.ok(card.includes(`<form method="post" action="/plans/${id}/answer">`), "the answer form is in the card");
  assert.ok(card.includes('<span class="pill need">꼭 정해야 함</span>') && card.includes("왜 묻나요: 이유 1"));
  assert.doesNotMatch(text, /막는 결정|번째 질문|이유: /);
  assert.equal(cardOf(await h.page(id, h.b)), null, "nothing for another member to do");
  h.answerAll(id);
  h.questions(id, [q(1)]);
  assert.match(await h.page(id), /<h3>질문\(1차\)<\/h3>/, "the answered round, by its round");
});

test("U50: the draft card: what approval does, what the AI assumed, 초안 승인, and 고쳐 달라고 하기 folded", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id, FULL);
  const text = await h.page(id);
  const card = cardOf(text) ?? "";
  assert.ok(card.includes('<p class="do">Story 초안을 확인해 주세요</p>'));
  assert.ok(card.includes("승인하면 AI가 Task로 나눠 바로 올리고 엽니다."));
  assert.ok(card.includes('<div class="assumed"><p><b>AI가 스스로 정한 것 1개 — 맞는지 보세요</b></p><ul><li>쿠폰은 한 번만 쓴다.</li></ul></div>'));
  assert.ok(card.includes("<button>초안 승인</button>"));
  assert.match(card, new RegExp(`<details class="other"><summary>고쳐 달라고 하기</summary><form method="post" action="/plans/${id}/rewrite">`));
  assert.ok(card.indexOf("초안 승인") < card.indexOf("고쳐 달라고 하기"));
});

test("U50: the draft reads in Korean heads, ids aside and ASSUMED in words; its raw text is the one the approval is bound to", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id, FULL);
  const text = await h.page(id);
  const doc = /<section><h2>초안 전체<\/h2><div class="doc">([\s\S]*?)<\/div>/.exec(text)?.[1] ?? "";
  for (const part of ["<h3>목표</h3><p>회원에게 쿠폰을 한 번에 발급한다.</p>", '<h3>꼭 할 것</h3><ul><li><span class="id">M1</span>발급 버튼을 누르면 쿠폰이 생긴다.</li></ul>',
    "<h3>이번에 하지 않을 것</h3><ul><li>문자 발송</li></ul>", '<li><span class="id">D1</span>AI가 정한 것: 쿠폰은 한 번만 쓴다.</li>', '<li><span class="id">D2</span>PL 답: 몇 장? → 한 장</li>',
    '<h3>확인 방법</h3><ul><li><span class="id">V1 [M1]</span>npm test로 발급을 확인한다.</li></ul>']) assert.ok(doc.includes(part), part);
  assert.doesNotMatch(doc, /Status:|Owner:|Understanding gate|# Story|ASSUMED|## /, "no kit header or English heads");
  const raw = /<details><summary>원문 그대로 보기<\/summary><pre>([\s\S]*?)<\/pre><\/details>/.exec(text)?.[1] ?? "";
  const unesc = raw.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  assert.equal(unesc, FULL, "the raw text shown is the draft itself");
  assert.equal(formOf(text, `/plans/${id}/approve`).hash, planTextHash(unesc), "and it is what 초안 승인 is bound to");
});

test("U50: a design waiting for G3 lists the Tasks it publishes in the card, by number, with what each waits for and checks", async (t) => {
  const h = await team(t);
  const id = h.create({ risk: "high" });
  h.draft(id);
  h.approve(id);
  h.design(id, DESIGN, splitOf(h.be, h.fe));
  const text = await h.page(id);
  const card = cardOf(text) ?? "";
  assert.ok(card.includes('<p class="do">설계와 Task 2개를 확인해 주세요</p>'));
  assert.match(card, /<ol class="tasks"><li><span class="num">1<\/span><div><p><b>[^<]+<\/b> · app-be<\/p><p class="muted">먼저 시작 · 바꿀 파일 \d+개 · 확인: [^<]+<\/p><\/div><\/li><li><span class="num">2<\/span><div><p><b>[^<]+<\/b> · app-fe<\/p><p class="muted">1번이 끝난 뒤 · /);
  assert.match(card, /모두 끝나면 Story 전체 확인: /);
  assert.ok(card.includes("<summary>올라갈 Task 전부 보기</summary>"), "every detail one click away, in the card");
  assert.ok(card.includes("<button>설계 승인하고 시작</button>"));
  assert.ok(card.includes("고칠 것이 있으면 이 기획을 그만두고 새로 시작하세요."));
  assert.match(text, /<details><summary>승인한 초안<\/summary>/, "the approved draft is a past step");
});

test("U50: while the AI works the PL may close the page; a held Task of the PL's Office is said instead of the Mac wait", async (t) => {
  const h = await team(t);
  const id = h.create();
  let text = await h.page(id);
  assert.equal(cardOf(text), null);
  assert.ok(text.includes("이 화면을 닫아도 됩니다. 답하거나 확인할 차례가 오면 보드의 나를 기다리는 일에 뜹니다."));
  assert.ok(!(await h.page(id, h.b)).includes("이 화면을 닫아도 됩니다"), "only the PL waits for a turn");
  const pub = h.board.publishStory(h.plBe, {
    projectId: h.projectId, title: "다른 Story", body: "# Story", risk: "normal", key: "k1",
    graph: { nodes: [{ id: "api", repoId: h.be, title: "api", spec: "api 설명", files: ["src/api.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  assert.ok(h.board.claimNext(h.plBe));
  text = await h.page(id);
  assert.ok(text.includes(`${pill("기획 대기")} PL의 Office가 Story #${pub.number} Task #`), "the state line names the Task the PL's Office holds");
  assert.ok(!text.includes(WAITING), "not also 'waiting for the Mac to take it'");
});

test("U50: the way out is folded at the bottom with the plan's PL, risk and start; the plan's tone is the PL's turn only for the PL", async (t) => {
  const h = await team(t);
  const id = h.create();
  h.draft(id);
  const text = await h.page(id);
  assert.match(text, new RegExp(`<section class="end"><details class="other"><summary>이 기획 그만두기</summary><form method="post" action="/plans/${id}/cancel">`));
  assert.match(text, /<p class="muted">PL PL · 위험도 보통 · \d+월 \d+일 시작<\/p><\/section>/, "the day as ago() writes one");
  assert.ok(text.indexOf("이 기획 그만두기") > text.indexOf("초안 전체"), "below the draft");
  assert.ok(text.includes(`${pill("초안")}</p>`), "the PL is asked (the card says what to do)");
  assert.ok((await h.page(id, h.b)).includes('<span class="pill run">초안</span> '), "another member only watches");
});

test("U50: a new Story picks its risk with two described choices and says what happens next; branch fields are not autocorrected", async (t) => {
  const h = await team(t);
  const text = (await h.get(`/projects/${h.projectId}/new-story`, h.pl)).text;
  assert.ok(text.includes('<fieldset class="choices"><legend>위험도</legend><label class="choice"><input type="radio" name="risk" value="normal" checked><span><b>보통</b><span class="muted">초안만 확인하면 바로 Task로 나뉩니다.</span></span></label><label class="choice"><input type="radio" name="risk" value="high"><span><b>높음</b><span class="muted">초안 다음에 설계와 Task 목록을 한 번 더 확인합니다.</span></span></label></fieldset>'));
  assert.ok(!text.includes("<select"), "no select");
  assert.match(text, /<b>다음에 일어나는 일<\/b> 내 Mac의 AI가 레포를 읽고, 필요하면 묻고, 초안을 씁니다\./);
  assert.ok(text.includes("그동안 이 화면을 닫아도 됩니다."));
  const style = (await h.get("/", h.pl)).text;
  assert.match(style, /label\.choice:has\(input:checked\)\{border:2px solid var\(--fg\)/);
  assert.match((await h.get("/projects/new", h.pl)).text, /<input name="base-[^"]+" value="main" aria-label="[^"]+ 기준 브랜치" autocapitalize="off" autocorrect="off" spellcheck="false">/);
});

// U50 review 1: six steps on one row, the draft and design as written outside the kit's header, the step of every state,
// a blocked G3 and what another member sees, the split fold once, the intent hint and the answer labels.
const ME = { id: "m", name: "PL", admin: false };
const AT = { approvalId: "a", gate: "G1", memberId: "m", at: 0, textHash: H };
const docOf = (text) => ({ text, hash: planTextHash(text) });
const viewOf = (over = {}) => ({
  id: "p1", project: { id: "pr", name: "쿠폰 개편" }, pl: { id: "m", name: "PL" }, title: "쿠폰 발급", intent: "쿠폰", risk: "normal",
  state: "draft", revision: 3, repos: [], rounds: [], draft: null, rewrite: null, design: null, split: null,
  g1: null, g3: null, failure: null, story: null, leased: false, heartbeatAt: null, createdAt: 0, updatedAt: 0, isPl: true,
  ...over,
  actions: { answer: false, rewrite: false, approve: "no", retry: false, cancel: true, ...over.actions },
});
const render = async (over) => {
  const { planPage } = await import("../src/hub/plan-pages.ts");
  return unline(planPage(ME, "c", viewOf(over), { plMac: { state: "none", lastSeen: null }, plOpenTask: null, changed: false, unlinked: [], opened: false }, {}));
};
const stepNow = (html) => /<li class="now" aria-current="step"><span class="sn">([^<]+)<\/span><\/li>/.exec(html)?.[1];

test("U50 review 1: a high-risk plan's six steps stay on one row; on a phone the step names stay for a screen reader", async () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(await render({}))[1];
  assert.match(style, /\.steps\.plansteps\{display:flex\}/, "more specific than the five-column .steps grid that comes later");
  assert.match(style, /@media \(max-width:860px\)\{[^@]*\.plansteps \.sn\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\)/);
  assert.doesNotMatch(style, /\.sn\{[^}]*display:none/, "never taken out of the accessibility tree");
});

test("U50 review 1: only the kit's header at the top is left out; a line starting with a number or # elsewhere shows as written", async () => {
  const text = "# Story: 생일 쿠폰\nStatus: Draft\nOwner: Human\nUnderstanding gate (G1): pending\n\n## Goal\n2026. 12. 1.부터 생일 쿠폰을 자동 발급한다.\n\n## Domain\n# 회원 혜택 영역\nStatus: 운영 중인 쿠폰과 같은 표\n\n## MUST\n- M1. 쿠폰을 만든다.\n  - 하루 한 번\n\n## SHOULD\n1. 하나뿐인 줄\n\n## Verify\n3. 발급을 본다.\n4. 사용을 본다.\n";
  const html = await render({ draft: docOf(text), actions: { approve: "yes", rewrite: true } });
  const body = /<h2>초안 전체<\/h2><div class="doc">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  for (const part of [
    "<h3>목표</h3><p>2026. 12. 1.부터 생일 쿠폰을 자동 발급한다.</p>",
    "<h3>영역</h3><p># 회원 혜택 영역</p><p>Status: 운영 중인 쿠폰과 같은 표</p>",
    '<h3>꼭 할 것</h3><ul><li><span class="id">M1</span>쿠폰을 만든다.</li><li class="sub">하루 한 번</li></ul>',
    "<h3>하면 좋은 것</h3><p>1. 하나뿐인 줄</p>",
    '<h3>확인 방법</h3><ol><li value="3">발급을 본다.</li><li value="4">사용을 본다.</li></ol>',
  ]) assert.ok(body.includes(part), part);
  assert.doesNotMatch(body, /Story: 생일 쿠폰|Status: Draft|Owner: Human|Understanding gate/, "the kit's header is left out");
  // OPEN BLOCKING is said in words only where the store counts it: a list line that starts with it.
  const blocked = await render({ draft: docOf("## Decisions\n- OPEN BLOCKING: 결제 수단\n- D1. OPEN BLOCKING: 이름표\n"), actions: { approve: "open-blocking", rewrite: true } });
  assert.ok(blocked.includes("<li>꼭 정해야 함: 결제 수단</li>"));
  assert.ok(blocked.includes('<li><span class="id">D1</span>OPEN BLOCKING: 이름표</li>'));
});

test("U50 review 1: a stopped or cancelled plan marks the step it stopped on; splitting and open mark theirs", async () => {
  const d = docOf(DRAFT), g = docOf(DESIGN);
  const stop = (from) => ({ reason: "멈춤", from });
  for (const [over, step] of [
    [{ state: "splitting", draft: d, g1: AT }, "Task로 나누기"],
    [{ state: "splitting", risk: "high", draft: d, g1: AT, g3: AT, design: g }, "Task로 나누기"],
    [{ state: "open", draft: d, g1: AT, story: { id: "s", number: 7 } }, "보드에서 시작"],
    [{ state: "failed", failure: stop("queued") }, "AI 질문"],
    [{ state: "failed", draft: d, failure: stop("queued") }, "초안 확인"],
    [{ state: "failed", risk: "high", draft: d, g1: AT, failure: stop("design") }, "설계 확인"],
    [{ state: "failed", draft: d, g1: AT, failure: stop("splitting") }, "Task로 나누기"],
    [{ state: "cancelled" }, "AI 질문"],
    [{ state: "cancelled", draft: d }, "초안 확인"],
    [{ state: "cancelled", draft: d, g1: AT }, "Task로 나누기"],
    [{ state: "cancelled", risk: "high", draft: d, g1: AT }, "설계 확인"],
    [{ state: "cancelled", risk: "high", draft: d, g1: AT, g3: AT, design: g }, "Task로 나누기"],
  ]) assert.equal(stepNow(await render(over)), step, JSON.stringify(over));
});

test("U50 review 1: a blocked G3 says why without a card; another member sees the failure, the open questions and the design in sections; the split fold shows once", async () => {
  const split = { graph: { nodes: [{ id: "t1", repoId: "r", title: "쿠폰 API", spec: "s", files: ["a.ts"], verify: [check] }], edges: [] }, storyVerify: [] };
  const g3 = { state: "awaiting_g3", risk: "high", draft: docOf(DRAFT), g1: AT, design: docOf("# 설계\n\n## 순서\n- api 먼저\n"), split };
  let html = await render({ ...g3, actions: { approve: "not-owner" } });
  assert.ok(!html.includes('class="decide"') && !html.includes("/approve"), "no card and no approval");
  assert.ok(html.includes("<p>프로젝트의 모든 레포 담당자여야 승인할 수 있습니다. 관리자에게 담당자 등록을 요청하세요.</p>"));
  for (const over of [{ actions: { approve: "yes" } }, { isPl: false }, { state: "splitting", g3: AT }])
    assert.equal(count(await render({ ...g3, ...over }), "<summary>올라갈 Task 전부 보기</summary>"), 1, JSON.stringify(over));
  html = await render({ ...g3, isPl: false });
  assert.ok(html.includes('<section><h2>설계</h2><div class="doc"><h3>순서</h3><ul><li>api 먼저</li></ul></div>'), "the design in sections, not only raw");
  html = await render({ state: "failed", draft: docOf(DRAFT), failure: { reason: "push 실패\n권한 없음", from: "splitting" }, isPl: false });
  assert.ok(html.includes('<section><h2>멈춘 이유</h2><div class="callout"><p><b>push 실패</b></p><details><summary>자세한 이유</summary><pre>권한 없음</pre></details></div></section>'));
  html = await render({ state: "questions", rounds: [{ questions: [q(1, true)], answers: null }], isPl: false });
  assert.ok(html.includes('<section><h2>AI의 질문</h2><h3>질문(1차)</h3><ol class="qs"><li><p class="q">질문 1 <span class="pill need">꼭 정해야 함</span></p><p class="muted">왜 묻나요: 이유 1</p></li></ol></section>'));
  assert.ok(!html.includes("/answer"), "nothing to answer for another member");
});

test("U50 review 1: the intent box is described by the hint alone; each answer box names its question", async (t) => {
  const h = await team(t);
  const text = (await h.get(`/projects/${h.projectId}/new-story`, h.pl)).text;
  assert.ok(text.includes('<label for="intent">하고 싶은 일</label>'));
  assert.match(text, /<p class="muted hint"><span id="intent-hint">평소 말로 적으세요\.<\/span><button type="button" class="info"/);
  assert.match(text, /<textarea id="intent" name="intent" [^>]*aria-describedby="intent-hint"/);
  const html = await render({ state: "questions", rounds: [{ questions: [q(1), q(2)], answers: null }], actions: { answer: true } });
  assert.ok(html.includes('<label>1번 질문의 답 <span class="muted">(4000자까지)</span><textarea name="answer-Q1" '));
  assert.ok(html.includes('<label>2번 질문의 답 <span class="muted">(4000자까지)</span><textarea name="answer-Q2" '));
});

test("U50 review 2: the Office's real draft and design read without kit lines; a year before a numbered list stays a sentence", async () => {
  const { renderPlanningStory } = await import("../src/runners/planning.ts");
  const { renderTeamDesign } = await import("../src/runners/team-planning.ts");
  const story = { title: "생일 쿠폰", goal: "2026. 12. 1.부터 생일 쿠폰을 발급한다.", domain: "회원 혜택", must: ["쿠폰을 만든다."], should: [], out: [], assumptions: ["한 장"], verify: [{ must: [1], scenario: "발급을 본다." }] };
  const draft = renderPlanningStory(story);
  let html = await render({ draft: docOf(draft), actions: { approve: "yes", rewrite: true } });
  let body = /<h2>초안 전체<\/h2><div class="doc">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(body.includes("<h3>목표</h3><p>2026. 12. 1.부터 생일 쿠폰을 발급한다.</p>"), body);
  assert.doesNotMatch(body, /Understanding gate|Status:|Owner:|# Story/, "the kit's lines are left out");
  const split = { plan: "결제 취소를 받으면 쿠폰을 되돌린다.", graph: { nodes: [{ id: "t1", repoId: "r", title: "쿠폰 API", spec: "s", files: ["a.ts"], verify: [check] }], edges: [] }, storyVerify: [] };
  const design = renderTeamDesign(split, [{ folder: "app-be", repoId: "r", name: "app-be", baseBranch: "main" }]);
  assert.match(design, /\nUnderstanding gate \(G3\): pending\n/, "the Office writes the gate line after the Task list");
  html = await render({ state: "awaiting_g3", risk: "high", draft: docOf(draft), g1: AT, design: docOf(design), split, isPl: false });
  body = /<section><h2>설계<\/h2><div class="doc">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(body.includes("<p>결제 취소를 받으면 쿠폰을 되돌린다.</p><h3>Task 목록</h3><ul><li>t1 · app-be · 쿠폰 API</li></ul><p>나누기 지문: "), body);
  assert.doesNotMatch(body, /Understanding gate|Decision requiring/, "no kit line in the design");
  assert.ok(html.includes("Understanding gate (G3): pending"), "the raw text G3 binds keeps it");
  // A year line followed by a numbered list: the year stays a sentence, the list keeps its numbers.
  html = await render({ draft: docOf("## Goal\n2026. 12. 1.부터 시작한다.\n1. 쿠폰을 만든다.\n2. 알림을 보낸다.\n"), actions: { approve: "yes", rewrite: true } });
  assert.ok(html.includes('<h3>목표</h3><p>2026. 12. 1.부터 시작한다.</p><ol><li value="1">쿠폰을 만든다.</li><li value="2">알림을 보낸다.</li></ol>'));
});
