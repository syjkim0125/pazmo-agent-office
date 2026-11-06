import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { locate } from "../src/cli/project.ts";
import { branchOps } from "../src/team/executor.ts";
import { createTeamOffice } from "../src/team/office.ts";
import { planLink } from "../src/team/plan-link.ts";
import { addTeamRepo, teamDir } from "../src/team/registry.ts";
import { createClaimScheduler } from "../src/team/scheduler.ts";
import { storyLink } from "../src/team/story-link.ts";
import { openTeamStore } from "../src/team/store.ts";
import { gitOrigins } from "./git-fixture.mjs";
import { startTestHub } from "./hub-fixture.mjs";
import { scriptedTurns } from "./plan-fixture.mjs";

// The integration proof of bundle 3: a real TLS Hub (its web, its link API and its PlanBoard), the PL's real team Office
// (planner and scheduler over real git: branchOps and planGitOps on bare origins), and teammate A's claim scheduler on
// real Story links. Only the model is fake: each PM/Lead turn answers the next scripted report. Every PL action is a
// real web POST with the session cookie and the page's CSRF token, read from the form the page drew.

const NAMES = ["app-be", "app-fe"];
const TOKEN = "a".repeat(64);
const TITLE = "주문 내역 화면";
const INTENT = "주문 내역 화면을 만들고 싶습니다.\n고객은 지난 주문을 봅니다.";
const ANSWER = "주문 목록부터.\n상세는 다음에.";

const STORY = {
  title: TITLE,
  goal: "고객이 지난 주문을 본다.",
  domain: "주문은 바뀌지 않는다.",
  must: ["주문 목록을 보여 준다.", "API가 주문을 돌려준다."],
  should: [],
  out: ["결제."],
  assumptions: ["최근 30일만."],
  verify: [
    { must: [1], scenario: "화면에 주문이 보인다." },
    { must: [2], scenario: "API가 200을 돌려준다." },
  ],
};
const QUESTIONS = { status: "questions", questions: [{ id: "Q1", text: "어느 화면부터 만들까요?", reason: "범위가 바뀝니다." }] };
const READY = { status: "ready", story: { ...STORY, openBlocking: [] } };
const check = (id, file) => ({ id, argv: ["node", "--test", file], timeoutMs: 30000 });
/** The Lead's split: the API in app-be, then the page in app-fe after it, with a Story check per repo. */
const LEAD = {
  plan: "API를 먼저 만들고 화면은 그 뒤에 붙인다.",
  tasks: [
    {
      title: "주문 API",
      outcome: "API가 주문을 돌려준다.",
      scope: "주문 라우트.",
      constraints: "응답 모양을 지킨다.",
      must: [2],
      verify: [2],
      checks: [check("V2", "tests/orders.test.mjs")],
      repo: "app-be",
      files: ["src/orders.ts"],
      after: [],
    },
    {
      title: "주문 화면",
      outcome: "화면에 주문이 보인다.",
      scope: "주문 화면.",
      constraints: "디자인 체계를 따른다.",
      must: [1],
      verify: [1],
      checks: [check("V1", "tests/orders-page.test.mjs")],
      repo: "app-fe",
      files: ["src/orders-page.tsx"],
      after: [1],
    },
  ],
  storyVerify: [
    { repo: "app-be", checks: [check("V2", "tests/orders.test.mjs")] },
    { repo: "app-fe", checks: [check("V1", "tests/orders-page.test.mjs")] },
  ],
};

const readyCatalog = () => ({
  installs: {
    codex: { runner: "codex", status: "ready", version: "0.160.0", sha256: "a".repeat(64), path: "/c", loggedIn: true, hint: "준비됨" },
    claude: { runner: "claude", status: "ready", version: "2.1.280", sha256: "b".repeat(64), path: "/k", loggedIn: true, hint: "준비됨" },
  },
  models: {
    codex: [{ slug: "gpt-5.5", reasoningLevels: [{ effort: "high" }] }],
    claude: [{ slug: "default" }],
  },
});

/** Waits, a few ms at a time (up to 20 s, for a loaded machine), until `ready()` holds; a timeout shows the PL Office's log. */
async function until(w, ready, what) {
  for (let i = 0; i < 4000; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting: ${what}\n${w.logs.join("\n")}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Adds a commit to `branch` of origin `name` (from `from` when the branch is new) and returns its sha. */
function commit(o, name, branch, files, from = "main") {
  const seed = join(o.root, "seeds", name);
  const bare = o.bare(name);
  const known = o.git(seed, "ls-remote", "--heads", bare, `refs/heads/${branch}`).trim() !== "";
  o.git(seed, "fetch", "-q", bare, "+refs/heads/*:refs/remotes/origin/*");
  o.git(seed, "checkout", "-q", "-B", branch, `origin/${known ? branch : from}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  o.git(seed, "add", "-A");
  o.git(seed, "commit", "-q", "-m", `update ${branch}`);
  o.git(seed, "push", "-q", bare, branch);
  return o.git(seed, "rev-parse", "HEAD").trim();
}

/** The hidden fields of the page's form posting to `action`, without the CSRF token (the session's is sent). */
function formOf(html, action) {
  const m = new RegExp(`<form method="post" action="${action}">([\\s\\S]*?)</form>`).exec(html);
  assert.ok(m, `a form posting to ${action}`);
  const hidden = [...m[1].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((x) => [x[1], x[2]]);
  return Object.fromEntries(hidden.filter(([name]) => name !== "csrf"));
}

/** Live runtimes of the PL's repo engines: a planning turn answers the next scripted report (`turns.answers`), on the
 * engine's run slot while it lasts; no Task run ever starts on the PL's Office here. */
function runtimes(turns) {
  return async (_live, project) => {
    const state = { active: [], verifying: false };
    const take = scriptedTurns(state, turns.answers, turns.seen);
    const never = (what) => () => assert.fail(`the PL's Office started a ${what} run`);
    return {
      project,
      state,
      status: () => ({ execution: "ready", active: state.active, verifying: state.verifying, lastError: null }),
      planTurn: take,
      startPlanning: never("planning"),
      startImplementation: never("implementation"),
      startUnderstanding() {},
      cancelImplementation() {},
      abort() {},
      assertIdle() {},
      async close() {},
    };
  };
}

/**
 * The world of one test:
 * - origins app-be and app-fe (bare repos), app-fe with its project base branch `develop` (F14), a commit of its own;
 * - a real TLS Hub with the admin, the PL (signed in on the web) and teammate A, both owners of both repos;
 * - the PL's team Office, live with fake runtimes, over clones of the origins registered in the team registry: real
 *   branchOps/planGitOps with the origins' HOME, claim tick 50 ms, beat 1000 ms, the PL's real Story and plan links,
 *   gh always OK. The PL's team store is paused: Task claims wait there (a pause does not hold plan work, R4), so the
 *   Story's Tasks are left for A;
 * - teammate A's claim scheduler on A's real Story links of both repos, ticked by the test.
 */
async function world(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-hub-plan-office-")));
  const cleanups = [];
  // Registered before the Hub and the origins: node runs a test's after hooks in order, so the Office closes first.
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const o = gitOrigins(t, NAMES);
  const env = { home: o.home, pathEnv: process.env.PATH ?? "" };
  const tips = {
    "app-be": o.git(root, `--git-dir=${o.bare("app-be")}`, "rev-parse", "--verify", "main").trim(),
    "app-fe": commit(o, "app-fe", "develop", { "web/index.html": "<p>develop</p>\n" }),
  };
  const feMain = o.git(root, `--git-dir=${o.bare("app-fe")}`, "rev-parse", "--verify", "main").trim();
  assert.notEqual(tips["app-fe"], feMain, "develop has a commit main has not");

  const h = await startTestHub(t);
  const { store } = h;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const web = await h.enter(store.createInvite(admin, "PL"));
  const pl = store.session(web.cookie.split("=")[1]).member;
  const a = store.acceptInvite(store.createInvite(admin, "A"), "A").member;
  const repos = {};
  for (const name of NAMES) {
    repos[name] = store.addRepo(admin, name, `git@github.example.com:team/${name}.git`);
    store.addOwner(admin, repos[name], pl.id);
    store.addOwner(admin, repos[name], a.id);
  }
  // Pairing the same (member, repo) again revokes the earlier token, so each pair is made once.
  const cfgOf = (member, name) => ({
    hub: h.hub.url,
    caPem: h.tls.caPem,
    fingerprint: h.tls.fingerprint,
    token: store.pair(store.createLinkCode(member, repos[name]), `https://${o.remote(name)}`).token,
    memberId: member.id,
    memberName: member.name,
    repoId: repos[name],
    repoName: name,
  });

  // The PL's Mac: one clone per origin, registered in the team Office, each with the PL's link.
  const data = join(root, "pl-data");
  const configs = new Map();
  for (const name of NAMES) {
    const dir = join(root, "pl", name);
    mkdirSync(dirname(dir), { recursive: true });
    o.git(dirname(dir), "clone", "-q", `https://${o.remote(name)}.git`, dir);
    const { project, remote } = await addTeamRepo(data, dir);
    assert.equal(remote, o.remote(name));
    configs.set(locate(project, data).dataDir, cfgOf(pl, name));
  }
  const paused = openTeamStore(teamDir(data));
  paused.setPaused(true);
  paused.close();
  const turns = { answers: [], seen: [] };
  const logs = [];
  const w = {
    root, o, h, pl, a, repos, tips, data, turns, logs,
    office: null,
    /** The plan as the Hub board keeps it, seen by the PL. */
    plan: (id) => h.plans.plan({ member: pl }, id),
    story: (id) => h.board.story({ member: pl }, id),
    stories: (projectId) => h.board.stories({ member: pl }, projectId),
    /** The sha `ref` names on origin `name`, or null. */
    remote: (name, ref) => o.git(root, "ls-remote", o.bare(name), `refs/heads/${ref}`).trim().split("\t")[0] || null,
    /** Every Story base ref on origin `name`. */
    storyBases: (name) => o.git(root, "ls-remote", o.bare(name), "refs/heads/feature/*").trim(),
    planDir: (id) => join(data, "team", "plans", id),
    get: (path) => h.call("GET", path, { cookie: web.cookie }),
    /** A web POST as the PL's browser sends it: the session cookie, the Hub's own Origin and the page's CSRF token. */
    post: (path, fields) =>
      h.call("POST", path, {
        cookie: web.cookie,
        headers: { origin: h.hub.url },
        body: new URLSearchParams([["csrf", web.csrf], ...(Array.isArray(fields) ? fields : Object.entries(fields))]).toString(),
      }),
  };
  w.office = await createTeamOffice({
    root: data,
    token: TOKEN,
    host: env,
    live: {
      controller: join(root, "no-controller"),
      binary: join(root, "no-binary"),
      authHome: join(root, "no-auth"),
      socket: join(root, "no-docker.sock"),
      userHome: root,
      searchPath: "",
    },
    createRuntime: runtimes(turns),
    runnerCatalog: async () => readyCatalog(),
    linkOf: (dataDir) => (configs.has(dataDir) ? storyLink(configs.get(dataDir)) : null),
    planLinkOf: (dataDir) => (configs.has(dataDir) ? planLink(configs.get(dataDir)) : null),
    ghOf: async () => ({ ok: true }),
    claimMs: 50,
    beatMs: 1000,
    log: (line) => logs.push(line),
  });
  cleanups.push(() => w.office.close());

  // Teammate A: a claim scheduler over A's own Story links, as A's Office builds it (the test is its timer).
  const aStore = openTeamStore(join(root, "a-data", "team"));
  cleanups.push(() => aStore.close());
  const aLogs = [];
  w.aLogs = aLogs;
  w.aScheduler = createClaimScheduler({
    lanes: NAMES.map((name) => ({ project: name, remote: o.remote(name), link: storyLink(cfgOf(a, name)), gh: { ok: true }, state: "ready" })),
    store: aStore,
    busy: () => false,
    canExecute: () => true,
    stageOf: () => "build",
    onDropped: () => {},
    log: (line) => aLogs.push(line),
  });
  /** What A's Office does with the Task it claimed first: its own checkout of the repo put on the Task branch at the
   * Story base it fetched from the origin (the step that fails when a Story opens before its base). */
  w.aStarts = async (claimed) => {
    const name = NAMES.find((n) => repos[n] === claimed.task.repoId);
    const clone = join(root, "a", name);
    mkdirSync(dirname(clone), { recursive: true });
    o.git(dirname(clone), "clone", "-q", `https://${o.remote(name)}.git`, clone);
    const checkout = join(root, "a-data", name, "story-checkout");
    const git = branchOps(env);
    await git.ensureCheckout(clone, checkout);
    const { storyBase } = claimed.task.story.branches.find((b) => b.repoId === claimed.task.repoId);
    return { name, storyBase, ...(await git.startTaskBranch(checkout, { branch: claimed.task.branch, storyBase, repo: clone })) };
  };
  return w;
}

/** The PL makes the project over both repos on the web (app-fe from develop) and starts a Story through [새 Story]. */
async function newStory(w, risk = "normal") {
  const made = await w.post("/projects", [
    ["name", "주문"],
    ["repo", w.repos["app-be"]],
    ["base-" + w.repos["app-be"], "main"],
    ["repo", w.repos["app-fe"]],
    ["base-" + w.repos["app-fe"], "develop"],
  ]);
  assert.deepEqual([made.status, made.headers.location], [303, "/board"], made.text);
  const board = (await w.get("/board")).text;
  const projectId = /href="\/projects\/([^"]+)\/new-story"/.exec(board)?.[1];
  assert.ok(projectId, "the board offers [새 Story] to the PL");
  assert.equal((await w.get(`/projects/${projectId}/new-story`)).status, 200);
  const started = await w.post(`/projects/${projectId}/plans`, { title: TITLE, intent: INTENT, risk });
  assert.equal(started.status, 303, started.text);
  const planId = /^\/plans\/([0-9a-f-]{36})$/.exec(started.headers.location)?.[1];
  assert.ok(planId, `redirected to the plan page, got ${started.headers.location}`);
  const v = w.plan(planId);
  assert.deepEqual([v.state, v.risk, v.project.id], ["queued", risk, projectId]);
  return { planId, projectId };
}

/** Posts the form the plan page drew for `action` (its revision, gate and hash), with `extra` fields. */
async function press(w, planId, action, extra = {}) {
  const page = (await w.get(`/plans/${planId}`)).text;
  const res = await w.post(`/plans/${planId}/${action}`, { ...formOf(page, `/plans/${planId}/${action}`), ...extra });
  assert.deepEqual([res.status, res.headers.location], [303, `/plans/${planId}`], res.text);
}
/** Waits for the plan to reach `state`; one that stops in failed instead fails at once with its reason. */
const settled = (w, planId, state) =>
  until(
    w,
    () => {
      const v = w.plan(planId);
      if (v.state === "failed" && state !== "failed") assert.fail(`the plan failed instead of reaching ${state}: ${v.failure?.reason}\n${w.logs.join("\n")}`);
      return v.state === state;
    },
    `the plan in ${state}`,
  );
const count = (lines, part) => lines.filter((line) => line.includes(part)).length;

test("from 새 Story to a claimable Task: the web makes the project and the plan; the PL's Office asks one question; the web answer brings a draft; G1 on the web splits, publishes, makes feature/story-<N>/base on both origins at main's and develop's commits and opens; teammate A's lane claims a Task whose Story base is on its origin; g1.json cites hub-approval:<approvalId>", async (t) => {
  const w = await world(t);
  w.turns.answers.push(QUESTIONS, READY, LEAD);
  const { planId, projectId } = await newStory(w);

  // The PL's Office takes the plan at its claim tick and asks one question.
  await settled(w, planId, "questions");
  let v = w.plan(planId);
  assert.deepEqual(v.rounds, [
    { questions: [{ id: "Q1", text: "어느 화면부터 만들까요?", reason: "범위가 바뀝니다.", blocking: false }], answers: null },
  ]);
  assert.match((await w.get(`/plans/${planId}`)).text, /어느 화면부터 만들까요\?/);
  const pm = w.turns.seen[0];
  assert.equal(pm.packet.role, "pm");
  assert.equal(pm.packet.request, INTENT);
  assert.deepEqual(pm.packet.team.repos, [
    { folder: "app-be", baseBranch: "main" },
    { folder: "app-fe", baseBranch: "develop" },
  ]);
  // The planning tree holds each repo at its base branch tip: app-fe's develop file is there.
  assert.equal(readFileSync(join(pm.candidate.directory, "tree", "app-fe", "web", "index.html"), "utf8"), "<p>develop</p>\n");
  assert.equal(readFileSync(join(pm.candidate.directory, "tree", "app-be", "README.md"), "utf8"), "# app-be\n");

  // The answer on the web brings a draft.
  await press(w, planId, "answer", { "answer-Q1": ANSWER });
  await settled(w, planId, "draft");
  assert.equal(w.turns.seen[1].packet.role, "pm");
  assert.deepEqual(
    w.turns.seen[1].packet.dialogue.map((d) => d.answers),
    [[{ id: "Q1", answer: "주문 목록부터. 상세는 다음에." }]],
    "folded to one line for the model",
  );
  v = w.plan(planId);
  assert.equal(v.rounds[0].answers[0].answer, ANSWER, "the Hub keeps the answer as typed");
  assert.match(v.draft.text, /PL 답: 어느 화면부터 만들까요\? → 주문 목록부터\. 상세는 다음에\./);
  assert.deepEqual(w.stories(projectId), [], "nothing is published before G1");

  // G1 on the web: the Office splits, publishes, makes both Story bases and opens.
  await press(w, planId, "approve");
  await settled(w, planId, "open");
  v = w.plan(planId);
  assert.equal(w.turns.seen.length, 3);
  assert.equal(w.turns.seen[2].packet.role, "lead");
  const story = w.story(v.story.id);
  const base = `feature/story-${story.number}/base`;
  assert.deepEqual(
    [story.state, story.risk, story.title, story.projectId],
    ["open", "normal", TITLE, projectId],
  );
  assert.deepEqual(
    story.branches.map((b) => [b.repoName, b.baseBranch, b.storyBase]),
    [
      ["app-be", "main", base],
      ["app-fe", "develop", base],
    ],
  );
  assert.deepEqual(story.tasks.filter((x) => x.kind === "work").map((x) => [x.title, x.state]), [
    ["주문 API", "ready"],
    ["주문 화면", "waiting"],
  ]);
  assert.equal(w.remote("app-be", base), w.tips["app-be"], "app-be's base at main's commit");
  assert.equal(w.remote("app-fe", base), w.tips["app-fe"], "app-fe's base at develop's commit");
  assert.equal(count(w.logs, `published as story-${story.number}`), 1);
  const g1 = JSON.parse(readFileSync(join(w.planDir(planId), "g1.json"), "utf8"));
  assert.equal(g1.responseRef, `hub-approval:${v.g1.approvalId}`);
  assert.match((await w.get(`/plans/${planId}`)).text, new RegExp(`href="/stories/${story.id}"`));

  // Teammate A's lane claims the ready Task, and its first step finds the Story base on the origin.
  const { claimed } = await w.aScheduler.tick();
  assert.ok(claimed, `A claimed a Task: ${w.aLogs.join("\n")}`);
  assert.deepEqual([claimed.project, claimed.task.title, claimed.task.story.number], ["app-be", "주문 API", story.number]);
  const started = await w.aStarts(claimed);
  assert.deepEqual([started.name, started.storyBase, started.head], ["app-be", base, w.tips["app-be"]]);
  assert.equal(w.office.status().claim, null, "the PL's paused Office claimed nothing");
});

test("a high-risk plan stops at 설계 승인, opens only after G3, keeps risk high on the Hub, and A's lane claims its Task", async (t) => {
  const w = await world(t);
  w.turns.answers.push(READY, LEAD);
  const { planId, projectId } = await newStory(w, "high");
  await settled(w, planId, "draft");

  // G1: the Office splits once and shows the design; nothing is published, recorded or pushed.
  await press(w, planId, "approve");
  await settled(w, planId, "awaiting_g3");
  let v = w.plan(planId);
  assert.deepEqual(w.turns.seen.map((s) => s.packet.role), ["pm", "lead"]);
  assert.match(v.design.text, /API를 먼저 만들고 화면은 그 뒤에 붙인다\./);
  assert.match(v.design.text, /주문 API/);
  const page = (await w.get(`/plans/${planId}`)).text;
  assert.equal(formOf(page, `/plans/${planId}/approve`).gate, "G3");
  assert.match(page, /설계 승인/);
  // A few claim ticks later it still waits for the PL.
  await sleep(300);
  assert.equal(w.plan(planId).state, "awaiting_g3");
  assert.deepEqual(w.stories(projectId), []);
  assert.deepEqual(NAMES.map((name) => w.storyBases(name)), ["", ""]);
  assert.equal(existsSync(join(w.planDir(planId), "g1.json")), false);
  assert.deepEqual(await w.aScheduler.tick(), { claimed: null, open: null });

  // G3 on the web: the stored split is published as approved (no second Lead turn), the bases made, the Story opened.
  await press(w, planId, "approve");
  await settled(w, planId, "open");
  v = w.plan(planId);
  assert.equal(w.turns.seen.length, 2, "no Lead turn after G3");
  const story = w.story(v.story.id);
  const base = `feature/story-${story.number}/base`;
  assert.deepEqual([story.state, story.risk], ["open", "high"]);
  assert.deepEqual(story.tasks.filter((x) => x.kind === "work").map((x) => x.title), ["주문 API", "주문 화면"]);
  assert.equal(w.remote("app-be", base), w.tips["app-be"]);
  assert.equal(w.remote("app-fe", base), w.tips["app-fe"]);
  const dir = w.planDir(planId);
  assert.equal(JSON.parse(readFileSync(join(dir, "g1.json"), "utf8")).responseRef, `hub-approval:${v.g1.approvalId}`);
  assert.equal(readFileSync(join(dir, "design.md"), "utf8"), v.design.text);
  assert.ok(existsSync(join(dir, "g3.json")));

  const { claimed } = await w.aScheduler.tick();
  assert.ok(claimed, `A claimed a Task: ${w.aLogs.join("\n")}`);
  assert.deepEqual([claimed.task.title, claimed.task.story.number, claimed.task.story.risk], ["주문 API", story.number, "high"]);
  const started = await w.aStarts(claimed);
  assert.deepEqual([started.storyBase, started.head], [base, w.tips["app-be"]]);
});

test("a base push the app-fe origin refuses (its pre-receive hook) leaves the plan failed and the Story draft with no claimable Task; after the hook is gone 다시 시도 opens the same Story number", async (t) => {
  const w = await world(t);
  w.turns.answers.push(READY, LEAD);
  const hook = join(w.o.bare("app-fe"), "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\ncat >/dev/null\necho 'new branches are blocked on app-fe' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const { planId, projectId } = await newStory(w);
  await settled(w, planId, "draft");

  await press(w, planId, "approve");
  await settled(w, planId, "failed");
  let v = w.plan(planId);
  const [draft] = w.stories(projectId);
  assert.equal(w.stories(projectId).length, 1);
  const base = `feature/story-${draft.number}/base`;
  const [first, ...detail] = v.failure.reason.split("\n");
  assert.equal(v.failure.from, "splitting");
  assert.match(first, /레포 app-fe에 Story 시작 브랜치 feature\/story-\d+\/base를 만들지 못했습니다/);
  assert.doesNotMatch(first, /app-be/);
  assert.match(detail.join("\n"), /pre-receive hook declined|new branches are blocked on app-fe/);
  assert.equal(draft.state, "draft", "the Hub Story stays a draft");
  assert.equal(w.remote("app-be", base), w.tips["app-be"], "app-be's base was made first");
  assert.equal(w.remote("app-fe", base), null);
  assert.deepEqual(await w.aScheduler.tick(), { claimed: null, open: null }, "a draft Story gives no Task");
  const page = (await w.get(`/plans/${planId}`)).text;
  assert.match(page, /레포 app-fe에 Story 시작 브랜치/);
  assert.ok(formOf(page, `/plans/${planId}/retry`).revision);

  // The hook is gone; 다시 시도 on the web: no second publish and no Lead turn, the recorded commits, then open.
  rmSync(hook);
  await press(w, planId, "retry");
  await settled(w, planId, "open");
  v = w.plan(planId);
  assert.deepEqual([v.story.id, v.story.number], [draft.id, draft.number], "the same Story");
  assert.deepEqual(w.stories(projectId).map((s) => [s.id, s.state]), [[draft.id, "open"]]);
  assert.equal(w.turns.seen.length, 2, "the retry ran no model turn");
  assert.equal(count(w.logs, "published as story-"), 1, "published once");
  assert.equal(count(w.logs, `story-${draft.number} base in app-be: exists`), 1);
  assert.equal(count(w.logs, `story-${draft.number} base in app-fe: created`), 1);
  assert.equal(w.remote("app-be", base), w.tips["app-be"]);
  assert.equal(w.remote("app-fe", base), w.tips["app-fe"]);
  assert.deepEqual(JSON.parse(readFileSync(join(w.planDir(planId), "bases.json"), "utf8")), {
    [w.repos["app-be"]]: w.tips["app-be"],
    [w.repos["app-fe"]]: w.tips["app-fe"],
  });

  const { claimed } = await w.aScheduler.tick();
  assert.ok(claimed, `A claimed a Task: ${w.aLogs.join("\n")}`);
  assert.deepEqual([claimed.task.title, claimed.task.story.number], ["주문 API", draft.number]);
});
