import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { OfficeError, locate } from "../src/cli/project.ts";
import { createLeanOffice } from "../src/lean/office.ts";
import { openLeanDb } from "../src/lean/schema.ts";
import { startLifecycleServer } from "../src/lean/server.ts";
import { branchOps } from "../src/team/executor.ts";
import { createTeamOffice, lifecycleView, sharedGate } from "../src/team/office.ts";
import { addTeamRepo, teamDir } from "../src/team/registry.ts";
import { openTeamStore } from "../src/team/store.ts";

const TOKEN = "a".repeat(64);
const INSTANCE = "b".repeat(32);
const OK = { ok: true };
const LOGGED_OUT = (host) => ({ ok: false, reason: "logged-out", hint: `gh auth login --hostname ${host}` });
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
/** Both CLIs installed but logged out: no agent's runners are ready. */
const loggedOutCatalog = () => {
  const catalog = readyCatalog();
  for (const install of Object.values(catalog.installs)) Object.assign(install, { loggedIn: false, hint: "로그인 필요" });
  return catalog;
};
const codex = { runner: "codex", model: "gpt-5.5", effort: "high" };
const claude = { runner: "claude", model: "default", effort: null };
const CHECK = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const MERGE_COMMIT = "f".repeat(40);
/** Lets every pending promise chain of the fakes run (none of them waits on I/O). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
/** Waits, a few ms at a time (up to 10 s, for a loaded machine), until `ready()` holds: for chains that wait
 * on real git or SQLite. */
async function until(ready, what) {
  for (let i = 0; i < 2000; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting: ${what}`);
}
const notYours = () => Object.assign(new Error("not yours"), { status: 409, code: "NOT_YOURS" });

/** A Task as the Hub hands it out (only the fields the Office reads). */
const claimed = (taskId, number = 1, storyNumber = 7, extra = {}) => ({
  taskId,
  claimId: `claim-${taskId}`,
  kind: "work",
  number,
  title: `Task ${taskId}`,
  spec: "Add the endpoint.",
  files: [],
  verify: [CHECK],
  storyVerify: [],
  repoId: "r",
  branch: `feature/story-${storyNumber}/task-${number}`,
  story: {
    id: "s",
    number: storyNumber,
    title: "Story",
    body: "",
    risk: "normal",
    branches: [{ repoId: "r", baseBranch: "main", storyBase: `feature/story-${storyNumber}/base` }],
  },
  upstream: [],
  lastFailure: null,
  ...extra,
});

/** A Story link that records its calls; `claimReply` / `claimOpen` / `claimError` shape the next claim, and
 * `on.<call>` replaces the answer of any other call. */
function fakeLink(name, calls) {
  const link = {
    claimReply: null,
    claimOpen: null,
    claimError: null,
    onClaim: null,
    on: {},
    async inbox() {
      calls.push([name, "inbox"]);
      return { mine: null, alerts: [], verifyReady: [] };
    },
    async claim() {
      calls.push([name, "claim"]);
      link.onClaim?.();
      const error = link.claimError;
      link.claimError = null;
      if (error) throw error;
      return { task: link.claimReply, open: link.claimOpen };
    },
    async task(taskId, claimId) {
      calls.push([name, "task", taskId, claimId]);
      return claimed(taskId);
    },
    async heartbeat(taskId, claimId, stage) {
      calls.push([name, "heartbeat", taskId, claimId, stage]);
      await link.on.heartbeat?.();
    },
    async mergeLock(taskId, claimId) {
      calls.push([name, "mergeLock", taskId, claimId]);
      return link.on.mergeLock ? link.on.mergeLock() : { granted: true, holder: null };
    },
    async mergeUnlock(taskId, claimId) {
      calls.push([name, "mergeUnlock", taskId, claimId]);
    },
    async merged(report) {
      calls.push([name, "merged", report]);
      return { already: false, ready: [] };
    },
    async failed(taskId, claimId, reason) {
      calls.push([name, "failed", taskId, claimId, reason]);
    },
    async rerun(taskId, memo) {
      calls.push([name, "rerun", taskId, memo]);
      return link.on.rerun();
    },
  };
  return link;
}

/** Host git for the executor: the real `ensureCheckout` (a linked worktree of the repo) and a record of the
 * steps that would reach the origin, which never run here. The Task branch's head is what was pushed last. */
function hostGit(host) {
  const real = branchOps(host);
  const g = {
    calls: [],
    remoteTip: null,
    async ensureCheckout(repo, checkout) {
      g.calls.push(["ensureCheckout", repo, checkout]);
      return real.ensureCheckout(repo, checkout);
    },
    async startTaskBranch(checkout, task) {
      g.calls.push(["startTaskBranch", checkout, task.branch, task.storyBase]);
      return { head: g.remoteTip ?? "b".repeat(40) };
    },
    async applyCandidate() {
      g.calls.push(["applyCandidate"]);
    },
    async commitAll() {
      g.calls.push(["commitAll"]);
      return { sha: "c".repeat(40), changed: true };
    },
    async pushTaskBranch(checkout, branch, sha) {
      g.calls.push(["push", branch, sha]);
      g.remoteTip = sha;
    },
    async mergeStoryBase() {
      g.calls.push(["mergeStoryBase"]);
      return { kind: "up-to-date" };
    },
    inMerge: () => false,
  };
  return g;
}

/** GitHub without gh: `found` is the PR `findPr` answers. */
function fakePr() {
  const p = {
    calls: [],
    found: null,
    async ensurePr(remote, request) {
      p.calls.push(["ensurePr", remote, request.head, request.base]);
      return p.found ?? { number: 9, url: "https://github.example.com/team/alpha/pull/9", state: "OPEN", mergeCommit: null };
    },
    async findPr(remote, request) {
      p.calls.push(["findPr", remote, request.head, request.base]);
      return p.found;
    },
    async mergePr(remote, pr) {
      p.calls.push(["mergePr", remote, pr.number, pr.headSha]);
      return { mergeCommit: MERGE_COMMIT };
    },
  };
  return p;
}

/** Live runtimes as the native engine sees them, one per repo engine: starting a
 * run makes it active and records how many runs the whole world had. */
function runtimes() {
  const world = {
    list: [],
    starts: [],
    implementations: [],
    /** Runs the engine asked a runtime to stop. */
    stops: [],
    running() {
      return this.list.reduce((n, rt) => n + rt.state.active.length, 0);
    },
  };
  world.create = async (_live, project, dataDir) => {
    const rt = {
      project,
      dataDir,
      closed: false,
      state: { active: [] },
      status: () => ({ execution: "ready", active: rt.state.active, lastError: null }),
      startPlanning(taskId) {
        world.starts.push({ project, runningBefore: world.running() });
        rt.state.active = [...rt.state.active, { taskId, kind: "planning" }];
      },
      startImplementation(taskId) {
        world.implementations.push({ project, taskId });
        rt.state.active = [...rt.state.active, { taskId, kind: "implementation" }];
      },
      startUnderstanding() {},
      cancelImplementation(taskId) {
        world.stops.push({ project, taskId });
      },
      abort(taskId) {
        world.stops.push({ project, taskId });
      },
      assertIdle() {
        if (rt.state.active.length) throw new OfficeError("TASK_ACTIVE", "Cancel active tasks first.");
      },
      async close() {
        rt.closed = true;
      },
      /** The run ends: the runtime clears it and tells the engine. */
      async settle() {
        rt.state.active = [];
        await rt.onSettled();
      },
    };
    world.list.push(rt);
    return rt;
  };
  world.of = (project) => world.list.find((rt) => rt.project === project);
  return world;
}

/** A temp data root with git repos registered in the team Office. Offices
 * opened by a test close (newest first) before the directory is removed. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-office-")));
  const cleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  // The person's git: a HOME with an identity, so a repo gets its first commit (a checkout needs one).
  const home = join(root, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Test Person\n\temail = person@example.com\n");
  const host = { home, pathEnv: process.env.PATH ?? "" };
  const f = {
    root,
    data: join(root, "data"),
    host,
    defer: (cleanup) => cleanups.push(cleanup),
    logs: [],
    calls: [],
    links: new Map(),
    gh: {},
    ghCalls: [],
    world: runtimes(),
    git: hostGit(host),
    pr: fakePr(),
    /** Real git as the person runs it, in `cwd`. */
    run: (cwd, ...args) =>
      execFileSync("git", ["-C", cwd, ...args], { env: { ...process.env, HOME: home }, encoding: "utf8" }).trim(),
    /** A git repo on `host` with one commit (none with `commit: false`), registered; returns its real path. */
    async repo(name, gitHost = "github.example.com", { commit = true } = {}) {
      const dir = join(root, name);
      mkdirSync(dir);
      execFileSync("git", ["init", "-q", dir]);
      f.run(dir, "remote", "add", "origin", `https://${gitHost}/team/${name}.git`);
      if (commit) f.run(dir, "commit", "-q", "--allow-empty", "-m", "initial");
      return (await addTeamRepo(f.data, dir)).project;
    },
    dataDirOf: (dir) => locate(dir, f.data).dataDir,
    checkoutOf: (dir) => join(f.dataDirOf(dir), "story-checkout"),
    /** Gives the repo a Story link (linkOf answers it for the repo's data directory). */
    link(dir, name) {
      const link = fakeLink(name, f.calls);
      f.links.set(f.dataDirOf(dir), link);
      return link;
    },
    /** What `start --team --live` gives the Office, with a fake VM runtime, ready runners, and fakes for the
     * git steps that reach the origin and for gh. */
    live: (extra = {}) => ({
      live: {
        controller: join(root, "no-controller"),
        binary: join(root, "no-binary"),
        authHome: join(root, "no-auth"),
        socket: join(root, "no-docker.sock"),
        userHome: root,
        searchPath: "",
      },
      createRuntime: f.world.create,
      runnerCatalog: async () => readyCatalog(),
      git: f.git,
      pr: f.pr,
      ...extra,
    }),
    async open(extra = {}) {
      const office = await createTeamOffice({
        root: f.data,
        token: TOKEN,
        host,
        linkOf: (dataDir) => f.links.get(dataDir) ?? null,
        ghOf: async (gitHost) => {
          f.ghCalls.push(gitHost);
          return f.gh[gitHost] ?? OK;
        },
        log: (line) => f.logs.push(line),
        ...extra,
      });
      cleanups.push(() => office.close());
      return office;
    },
  };
  return f;
}

/** The record a team Office left in its store, written the way a previous run would have. */
function storeOf(f) {
  const store = openTeamStore(teamDir(f.data));
  f.defer(() => store.close());
  return store;
}
/** A claim row as stored, read straight from the file. */
function claimRow(f, taskId) {
  const db = new DatabaseSync(join(teamDir(f.data), "team.sqlite"), { readOnly: true });
  try {
    return { ...db.prepare("SELECT state, reason, phase, claim_id FROM team_claims WHERE task_id = ? ORDER BY id DESC").get(taskId) };
  } finally {
    db.close();
  }
}

/** A task left waiting in one of the repo's engines, as a previous Office could leave it: its run was never
 * started (another engine was running). `where` is "lean" (the single lean Office's own data, on the repo) or
 * "story" (the team Office's Story engine, on the Office's checkout of the repo). */
async function waitingTask(f, dir, title, where = "lean") {
  const p = locate(dir, f.data);
  let db, project, dataDir;
  if (where === "lean") {
    ({ project } = p);
    db = openLeanDb(p.dataDir, project);
    dataDir = join(p.dataDir, "lean");
  } else {
    project = f.checkoutOf(dir);
    await branchOps(f.host).ensureCheckout(dir, project);
    dataDir = join(p.dataDir, "story");
    db = openLeanDb(dataDir, project);
  }
  const idle = { status: () => ({ execution: "ready", active: [], lastError: null }), assertIdle() {}, close: async () => {} };
  const office = await createLeanOffice({
    db,
    project,
    dataDir,
    token: TOKEN,
    runnerCatalog: async () => readyCatalog(),
    createRuntime: async () => idle,
    othersActive: () => true,
  });
  try {
    const agent = await office.agents.create({ name: "Alice", work: codex, review: claude });
    return await office.createTask({ title, body: "", agentId: agent.id, risk: "normal" });
  } finally {
    await office.close();
    db.close();
  }
}

test("each repo gets a lane: no link is no-link, a failed gh login is gh, otherwise ready; gh runs once per host", async (t) => {
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta", "ghe.example.com");
  const c = await f.repo("gamma");
  const d = await f.repo("delta");
  for (const [dir, name] of [[a, "a"], [b, "b"], [c, "c"]]) f.link(dir, name);
  f.gh["ghe.example.com"] = LOGGED_OUT("ghe.example.com");
  const office = await f.open();
  const status = office.status();
  assert.deepEqual(status.repos, [
    { project: a, remote: "github.example.com/team/alpha", state: "ready", gh: OK },
    { project: b, remote: "ghe.example.com/team/beta", state: "gh", gh: LOGGED_OUT("ghe.example.com") },
    { project: c, remote: "github.example.com/team/gamma", state: "ready", gh: OK },
    { project: d, remote: "github.example.com/team/delta", state: "no-link", gh: OK },
  ]);
  assert.deepEqual(f.ghCalls.toSorted(), ["ghe.example.com", "github.example.com"], "one gh check per host");
  assert.deepEqual(
    { paused: status.paused, dailyCap: status.dailyCap, today: status.today, claim: status.claim, busy: status.busy },
    { paused: false, dailyCap: 5, today: 0, claim: null, busy: false },
  );
  assert.ok(f.logs.some((line) => line.includes(b) && line.includes("gh auth login --hostname ghe.example.com")), f.logs.join("\n"));
  assert.ok(f.logs.some((line) => line.includes(d) && line.includes("hub-link")), f.logs.join("\n"));
});

test("with no linkOf, the repo's own hub-link.json is read: none is no-link, a private one links, an unreadable one is no-link and logged", async (t) => {
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  const c = await f.repo("gamma");
  const config = {
    hub: "https://127.0.0.1:1",
    caPem: null,
    fingerprint: null,
    token: "t".repeat(40),
    memberId: "m",
    memberName: "A",
    repoId: "r",
  };
  for (const [dir, mode] of [[b, 0o600], [c, 0o644]]) {
    const dataDir = f.dataDirOf(dir);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dataDir, "hub-link.json"), JSON.stringify(config), { mode });
    chmodSync(join(dataDir, "hub-link.json"), mode);
  }
  const office = await f.open({ linkOf: undefined });
  assert.deepEqual(
    office.status().repos.map((r) => [r.project, r.state]),
    [[a, "no-link"], [b, "ready"], [c, "no-link"]],
  );
  assert.ok(f.logs.some((line) => line.includes(c) && line.includes("HUB_LINK_PERMISSIONS")), f.logs.join("\n"));
});

test("every 300000 ms the lanes that are not ready are checked again, in place, and ready lanes are left alone", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta", "ghe.example.com");
  const d = await f.repo("delta");
  const la = f.link(a, "a");
  f.link(b, "b");
  f.gh["ghe.example.com"] = LOGGED_OUT("ghe.example.com");
  // Live, so the claim tick asks the Hub; no drive timer in this test.
  const office = await f.open(f.live({ driveMs: 1e9 }));
  const states = () => office.status().repos.map((r) => r.state);
  assert.deepEqual(states(), ["ready", "gh", "no-link"]);

  // The Hub refuses alpha's token on the first claim tick: the scheduler takes the lane out of use.
  la.claimError = Object.assign(new Error("unauthorized"), { status: 401, code: "UNAUTHORIZED" });
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(states(), ["relink", "gh", "no-link"]);

  // The member fixes all three: logs in to the other host, links delta, links alpha again.
  f.gh["ghe.example.com"] = OK;
  f.link(d, "d");
  const before = f.ghCalls.length;
  t.mock.timers.tick(269999);
  await flush();
  assert.deepEqual(states(), ["relink", "gh", "no-link"], "nothing is checked again before 300000 ms");
  assert.equal(f.ghCalls.length, before);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(states(), ["ready", "ready", "ready"]);
  // Only the host that failed is asked again; alpha's and delta's gh was fine.
  assert.deepEqual(f.ghCalls.slice(before), ["ghe.example.com"]);
  assert.deepEqual(office.status().repos[1].gh, OK);

  // A lane that is ready is not checked again: its host is not asked on the next round.
  f.gh["github.example.com"] = LOGGED_OUT("github.example.com");
  t.mock.timers.tick(300000);
  await flush();
  assert.deepEqual(f.ghCalls.slice(before), ["ghe.example.com"]);
  assert.deepEqual(states(), ["ready", "ready", "ready"]);
});

test("the claim tick runs every 30000 ms and the heartbeat every 60000 ms; status shows the claim", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const la = f.link(a, "a");
  la.claimReply = claimed("t1", 3, 7);
  const office = await f.open(f.live({ driveMs: 1e9 }));
  t.mock.timers.tick(29999);
  await flush();
  assert.deepEqual(f.calls, [], "no tick before 30000 ms");
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(f.calls, [["a", "inbox"], ["a", "claim"]]);
  const status = office.status();
  assert.deepEqual(status.claim, { storyNumber: 7, taskNumber: 3, title: "Task t1", project: a, phase: "claimed", attempts: 0, waiting: null });
  assert.equal(status.today, 1);

  f.calls.length = 0;
  t.mock.timers.tick(30000);
  await flush();
  // 60000 ms: the claim tick sees the open record and does nothing; the heartbeat goes out.
  assert.deepEqual(f.calls, [["a", "heartbeat", "t1", "claim-t1", "build"]]);
});

test("a claim tick that rejects is logged, and the timers keep running", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const la = f.link(a, "a");
  la.claimReply = claimed("t1");
  // Another writer records a Task while the claim is under way: recording this one is OPEN_CLAIM.
  la.onClaim = () => {
    const store = openTeamStore(teamDir(f.data));
    try {
      store.recordClaim(a, claimed("other"), "claim");
    } finally {
      store.close();
    }
  };
  const office = await f.open(f.live({ driveMs: 1e9 }));
  t.mock.timers.tick(30000);
  await flush();
  assert.ok(f.logs.some((line) => line.includes("claim") && line.includes("OPEN_CLAIM")), f.logs.join("\n"));
  assert.equal(office.status().claim.title, "Task other");
  f.calls.length = 0;
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(f.calls, [["a", "heartbeat", "other", "claim-other", "build"]], "the heartbeat still runs");
});

/** A repo's lean data as stored: its tasks' statuses and how many agents it has. */
function leanRows(f, dir) {
  const db = new DatabaseSync(join(f.dataDirOf(dir), "lean", "office.sqlite"), { readOnly: true });
  try {
    return {
      tasks: db.prepare("SELECT id, status FROM tasks ORDER BY id").all().map((row) => ({ ...row })),
      agents: db.prepare("SELECT COUNT(*) AS n FROM agents").get().n,
    };
  } finally {
    db.close();
  }
}
/** A repo's Story engine data as stored: whose project it is, its agents, and its tasks with their agent. */
function storyRows(f, dir) {
  const db = new DatabaseSync(join(f.dataDirOf(dir), "story", "lean", "office.sqlite"), { readOnly: true });
  try {
    return {
      project: db.prepare("SELECT project FROM lean_instance").get().project,
      agents: db.prepare("SELECT id FROM agents ORDER BY created_at, rowid").all().map((row) => row.id),
      tasks: db.prepare("SELECT id, status, agent_id FROM tasks ORDER BY id").all().map((row) => ({ ...row })),
    };
  } finally {
    db.close();
  }
}
const claims = (f) => f.calls.filter(([, what]) => what === "claim").length;

test("start --team without --live claims nothing and status says execution locked", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  f.link(a, "a").claimReply = claimed("t1");
  // The same recording git and gh a live Office gets: a locked one must call neither.
  const office = await f.open({ git: f.git, pr: f.pr });
  assert.equal(office.status().execution, "locked");
  assert.equal(lifecycleView(office.status()).execution, "locked");
  t.mock.timers.tick(90000);
  await flush();
  assert.equal(claims(f), 0, "nothing is claimed while execution is locked");
  const status = office.status();
  assert.equal(status.claim, null);
  assert.equal(status.blockedBy, null);
  assert.equal(status.execution, "locked");
  // A locked Office runs no git on the repo: its Story checkout is made by a live start.
  assert.equal(existsSync(f.checkoutOf(a)), false);
  assert.deepEqual(f.git.calls, []);
  assert.deepEqual(f.pr.calls, []);
});

test("a team Office opens one story engine per repo on its checkout and never opens <repo dataDir>/lean", async (t) => {
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  // Work left in alpha's single lean Office, and the person's folder with a change they have not committed.
  await waitingTask(f, a, "Waiting in alpha");
  const before = leanRows(f, a);
  writeFileSync(join(a, "notes.txt"), "not committed\n");
  const folder = (dir) => ({
    head: f.run(dir, "rev-parse", "HEAD"),
    branch: f.run(dir, "symbolic-ref", "--short", "HEAD"),
    changes: f.run(dir, "status", "--porcelain"),
  });
  const folders = new Map([a, b].map((dir) => [dir, folder(dir)]));
  let discoveries = 0;
  // A slow start: every reading of the clock is 2 s later, so the repo engines open far more than 5 s apart.
  let clock = 1_700_000_000_000;
  const office = await f.open(
    f.live({
      runnerCatalog: async () => {
        discoveries++;
        return readyCatalog();
      },
      now: () => (clock += 2000),
    }),
  );
  await flush();
  assert.equal(discoveries, 1, "the whole start, every repo engine included, runs one runner discovery");
  for (const dir of [a, b]) {
    const checkout = f.checkoutOf(dir);
    // The Office's own checkout: a detached linked worktree of the repo.
    assert.match(f.run(dir, "worktree", "list", "--porcelain"), new RegExp(`worktree ${checkout}\\nHEAD [0-9a-f]{40}\\ndetached`));
    // Its Story engine: the checkout is the project and <repo dataDir>/story the data, with the default agent.
    const rows = storyRows(f, dir);
    assert.equal(rows.project, checkout);
    assert.equal(rows.agents.length, 1, "the default agent was made");
    assert.deepEqual(rows.tasks, []);
    assert.equal(f.world.of(checkout).dataDir, join(f.dataDirOf(dir), "story"));
    // The checkout is no installed Office project: no manifest is made there.
    assert.equal(existsSync(join(checkout, ".pazmo-office", "manifest.json")), false);
    assert.deepEqual(folder(dir), folders.get(dir), "the person's HEAD, branch and changes are as they were");
  }
  assert.deepEqual(f.world.list.map((rt) => rt.project), [f.checkoutOf(a), f.checkoutOf(b)]);
  assert.equal(existsSync(join(f.dataDirOf(b), "lean")), false, "beta's lean data is never made");
  assert.deepEqual(leanRows(f, a), before, "alpha's waiting lean task is untouched");
  assert.deepEqual(f.world.starts, [], "and it does not start");
  assert.equal(office.status().busy, false);
  assert.equal(office.status().execution, "live");
  // `status --team` says it in the lifecycle's words, as `up --team` and `start --team --live` compare them.
  assert.equal(lifecycleView(office.status()).execution, "ready");
});

test("status --team shows phase, attempts and blockedBy", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const la = f.link(a, "a");
  // The Hub has nothing to give: this member's failed Task is in the way.
  la.claimOpen = { storyNumber: 7, taskNumber: 2, repoName: "app-be", state: "failed" };
  const office = await f.open(f.live({ driveMs: 1e9 }));
  assert.equal(office.status().blockedBy, null);
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(office.status().blockedBy, { storyNumber: 7, taskNumber: 2, repoName: "app-be", state: "failed" });
  assert.equal(office.status().claim, null);

  // Once the Hub gives a Task, nothing is in the way and the claim shows where it is.
  la.claimOpen = null;
  la.claimReply = claimed("t1", 3, 7);
  t.mock.timers.tick(30000);
  await flush();
  const status = office.status();
  assert.equal(status.blockedBy, null);
  assert.deepEqual(status.claim, { storyNumber: 7, taskNumber: 3, title: "Task t1", project: a, phase: "claimed", attempts: 0, waiting: null });
  const store = storeOf(f);
  // A runner account problem the attempt waits out (D37): which runner, why, its words, since when and until when.
  const message = "You've hit your org's monthly spend limit · your weekly limit resets 4am (Asia/Seoul)";
  const since = Date.UTC(2026, 10, 2, 9, 0);
  store.setPhase("t1", "claimed", { runnerWait: { runner: "claude", kind: "limit", message, since, retryAt: since + 1800000, runs: 1 } });
  assert.deepEqual(office.status().claim.waiting, {
    runner: "claude",
    kind: "limit",
    message,
    since: "2026-11-02T09:00:00.000Z",
    retryAt: "2026-11-02T09:30:00.000Z",
  });
  // Running it again is no longer waiting.
  store.setPhase("t1", "building");
  assert.equal(office.status().claim.waiting, null);
  store.setPhase("t1", "failed", { attempts: 3, runnerWait: null });
  assert.deepEqual(
    { phase: office.status().claim.phase, attempts: office.status().claim.attempts },
    { phase: "failed", attempts: 3 },
  );
});

test("with --live, a Task is claimed only while every repo engine's runners are ready", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  await f.repo("beta");
  f.link(a, "a").claimReply = claimed("t1");
  let catalog = loggedOutCatalog();
  // The engines keep a runner discovery for 5 s of this clock.
  let clock = 1_700_000_000_000;
  const office = await f.open(f.live({ runnerCatalog: async () => catalog, now: () => clock, driveMs: 1e9 }));
  const tick = async (ms) => {
    clock += ms;
    t.mock.timers.tick(ms);
    await flush();
  };
  await tick(30000);
  assert.equal(claims(f), 0, "no claim while the runners are logged out");
  // The line names the runners of the engine's agent (made with nothing logged in: codex for both jobs).
  assert.ok(
    f.logs.some((line) => line.includes(a) && line.includes("work codex") && line.includes("review codex")),
    f.logs.join("\n"),
  );

  catalog = readyCatalog();
  await tick(30000);
  assert.equal(claims(f), 1);
  assert.equal(office.status().claim.project, a);
  assert.ok(f.logs.some((line) => line.includes("runners are ready")), f.logs.join("\n"));
  // An open record holds every later claim, ready runners or not.
  await tick(60000);
  assert.equal(claims(f), 1);
});

test("with --live, the heartbeat does not wait for the first drive; until that drive settles a NOT_YOURS keeps a verified or merging record, so a merged PR whose claim the PL released is still reported", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const la = f.link(a, "a");
  // What a stop left: the PR was merged and no report written yet. Meanwhile the PL released the claim.
  const store = storeOf(f);
  store.recordClaim(a, claimed("t1"), "claim");
  store.setPhase("t1", "merging");
  // The Hub takes a while to answer the first drive's merge lock ask; a heartbeat falls due meanwhile.
  let refuse;
  la.on.mergeLock = () => new Promise((resolve, reject) => {
    refuse = () => reject(notYours());
  });
  la.on.heartbeat = () => {
    throw notYours();
  };
  f.pr.found = { number: 9, url: "https://github.example.com/team/alpha/pull/9", state: "MERGED", mergeCommit: MERGE_COMMIT };
  const heartbeats = () => f.calls.filter(([, what]) => what === "heartbeat").length;
  // No drive timer: only the start's first drive moves the record.
  await f.open(f.live({ beatMs: 1000, driveMs: 1e9 }));
  await until(() => refuse !== undefined, "the first drive asks for the merge lock");
  t.mock.timers.tick(1000);
  await until(() => heartbeats() === 1, "a heartbeat goes out while the first drive runs");
  await flush();
  assert.deepEqual([claimRow(f, "t1").state, claimRow(f, "t1").phase], ["open", "merging"], "kept, not dropped as NOT_YOURS");
  assert.ok(f.logs.some((line) => /NOT_YOURS.*kept until the start's first drive settles/.test(line)), f.logs.join("\n"));

  refuse();
  await until(() => claimRow(f, "t1").phase === "reporting", "the late path writes the merged report");
  t.mock.timers.tick(1000);
  await until(() => claimRow(f, "t1").state !== "open", "the record closes");
  assert.equal(claimRow(f, "t1").state, "done", "reported, not dropped as NOT_YOURS");
  const merged = f.calls.filter(([, what]) => what === "merged").map(([, , report]) => report);
  assert.ok(merged.length >= 1);
  assert.deepEqual(
    { taskId: merged[0].taskId, claimId: merged[0].claimId, prUrl: merged[0].prUrl, mergeCommit: merged[0].mergeCommit },
    { taskId: "t1", claimId: "claim-t1", prUrl: "https://github.example.com/team/alpha/pull/9", mergeCommit: MERGE_COMMIT },
  );
  assert.deepEqual(f.pr.calls[0], ["findPr", "github.example.com/team/alpha", "feature/story-7/task-1", "feature/story-7/base"]);
});

test("with --live, once the first drive has settled, a heartbeat NOT_YOURS drops a merging record as before", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const la = f.link(a, "a");
  const store = storeOf(f);
  store.recordClaim(a, claimed("t1"), "claim");
  store.setPhase("t1", "merging");
  // The first drive cannot reach the Hub for the merge lock: it settles without moving the record.
  la.on.mergeLock = () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  };
  la.on.heartbeat = () => {
    throw notYours();
  };
  await f.open(f.live({ beatMs: 1000, driveMs: 1e9 }));
  await until(() => f.logs.some((line) => /asking for the merge lock failed/.test(line)), "the first drive settles");
  await flush();
  t.mock.timers.tick(1000);
  await until(() => claimRow(f, "t1").state !== "open", "the record closes");
  assert.deepEqual([claimRow(f, "t1").state, claimRow(f, "t1").reason], ["dropped", "NOT_YOURS"]);
});

test("a locked start leaves a verified or merging record for a live start: no heartbeat, never dropped; the live start reports the merged PR", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const la = f.link(a, "a");
  const store = storeOf(f);
  store.recordClaim(a, claimed("t1"), "claim");
  const heartbeats = () => f.calls.filter(([, what]) => what === "heartbeat").length;
  // Any other phase keeps its heartbeat in a locked Office.
  const claimedOnly = await f.open({ git: f.git, pr: f.pr });
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(heartbeats(), 1, "a claimed record is still heartbeated");
  await claimedOnly.close();

  // The PR was merged and the Office stopped before writing the report; meanwhile the PL released the claim.
  la.on.mergeLock = () => {
    throw notYours();
  };
  la.on.heartbeat = () => {
    throw notYours();
  };
  f.pr.found = { number: 9, url: "https://github.example.com/team/alpha/pull/9", state: "MERGED", mergeCommit: MERGE_COMMIT };
  for (const phase of ["verified", "merging"]) {
    store.setPhase("t1", phase);
    const locked = await f.open({ git: f.git, pr: f.pr });
    t.mock.timers.tick(180000);
    await flush();
    assert.equal(heartbeats(), 1, `no heartbeat for a ${phase} record`);
    assert.deepEqual([claimRow(f, "t1").state, claimRow(f, "t1").phase], ["open", phase], "kept as it was");
    assert.ok(f.logs.some((line) => line.includes(phase) && line.includes("--live")), f.logs.join("\n"));
    await locked.close();
  }
  assert.deepEqual(f.git.calls, [], "nothing was driven while locked");

  // A live start drives it at once: the late path reports the merged PR. A heartbeat answered NOT_YOURS before
  // that drive settles leaves the record in place.
  await f.open(f.live({ beatMs: 1000, driveMs: 1e9 }));
  t.mock.timers.tick(1000);
  await until(() => claimRow(f, "t1").phase === "reporting" || claimRow(f, "t1").state !== "open", "the merged report is written");
  t.mock.timers.tick(1000);
  await until(() => claimRow(f, "t1").state !== "open", "the record closes");
  assert.equal(claimRow(f, "t1").state, "done");
  const merged = f.calls.filter(([, what]) => what === "merged").map(([, , report]) => report);
  assert.deepEqual([merged[0].prUrl, merged[0].mergeCommit], ["https://github.example.com/team/alpha/pull/9", MERGE_COMMIT]);
});

test("with --live, the runners are checked once for the start, again every 300000 ms while ready, at each claim tick while not, and never when no claim could follow", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  await f.repo("beta");
  // A linked repo with nothing to give: every claim tick asks the Hub.
  f.link(a, "a");
  let catalog = readyCatalog();
  let discoveries = 0;
  let clock = 1_700_000_000_000;
  await f.open(
    f.live({
      runnerCatalog: async () => {
        discoveries++;
        return catalog;
      },
      now: () => clock,
      driveMs: 1e9,
    }),
  );
  const tick = async (ms) => {
    clock += ms;
    t.mock.timers.tick(ms);
    await flush();
  };
  assert.equal(discoveries, 1, "one discovery for the start");
  for (let i = 0; i < 9; i++) await tick(30000);
  assert.equal(claims(f), 9, "the idle Office still asks the Hub at every tick");
  assert.equal(discoveries, 1, "and runs no discovery while the runners were ready less than 300000 ms ago");
  await tick(30000);
  assert.equal(discoveries, 2, "300000 ms after the last check");

  catalog = loggedOutCatalog();
  for (let i = 0; i < 10; i++) await tick(30000);
  assert.equal(discoveries, 3, "the next due check finds them logged out");
  assert.equal(claims(f), 19, "and that tick claims nothing");
  await tick(30000);
  await tick(30000);
  assert.equal(discoveries, 5, "while not ready, every claim tick checks again");

  // No claim could follow: the daily cap is reached, then the Office is paused. (A store on the Office's
  // clock, so today's claim counts on the Office's day.)
  const store = openTeamStore(teamDir(f.data), () => clock);
  f.defer(() => store.close());
  store.setDailyCap(1);
  store.recordClaim(a, claimed("t0"), "claim");
  store.finishClaim("t0");
  await tick(30000);
  await tick(30000);
  assert.equal(discoveries, 5, "none while the daily cap is reached");
  store.setDailyCap(null);
  store.setPaused(true);
  await tick(30000);
  assert.equal(discoveries, 5, "none while paused");
  store.setPaused(false);
  catalog = readyCatalog();
  await tick(30000);
  assert.equal(discoveries, 6);
  assert.equal(claims(f), 20, "ready again: the tick asks the Hub");
});

test("a live start that cannot make a repo's checkout fails with GIT_FAILED naming that repo, and closes what it opened", async (t) => {
  const f = fixture(t);
  const a = await f.repo("alpha");
  // No commit yet: git cannot make a worktree of it.
  const b = await f.repo("beta", "github.example.com", { commit: false });
  await assert.rejects(f.open(f.live()), (error) => {
    assert.equal(error.code, "GIT_FAILED");
    assert.ok(error.message.includes(b), error.message);
    return true;
  });
  assert.deepEqual(f.world.list.map((rt) => [rt.project, rt.closed]), [[f.checkoutOf(a), true]]);
});

test("with --live, the open record is driven every 10000 ms: a claimed Task goes to its repo's Story engine on the checkout", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  await f.repo("beta");
  const la = f.link(a, "a");
  la.claimReply = claimed("t1");
  const office = await f.open(f.live());
  const checkout = f.checkoutOf(a);
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(office.status().claim.phase, "claimed");
  assert.deepEqual(f.git.calls.filter(([what]) => what !== "ensureCheckout"), [], "not driven before the next 10000 ms");

  t.mock.timers.tick(10000);
  await until(() => office.status().claim?.phase === "building", "the Task is building");
  assert.deepEqual(f.git.calls.filter(([what]) => what === "startTaskBranch"), [
    ["startTaskBranch", checkout, "feature/story-7/task-1", "feature/story-7/base"],
  ]);
  assert.equal(existsSync(join(checkout, ".pazmo-office", "plans", "story-7-task-1-a1", "story.md")), true);
  assert.equal(existsSync(join(checkout, ".pazmo-office", "manifest.json")), false);
  // The repo's Story engine took it, under its default agent, and its runtime runs it.
  const rows = storyRows(f, a);
  const engineTask = storeOf(f).openClaim().engineTask;
  assert.deepEqual(rows.tasks.find((task) => task.id === engineTask)?.agent_id, rows.agents[0]);
  assert.deepEqual(f.world.implementations, [{ project: checkout, taskId: engineTask }]);
  assert.equal(office.status().busy, true);
  assert.throws(() => office.assertIdle(), { code: "TASK_ACTIVE" });

  // The heartbeat names the engine's stage.
  t.mock.timers.tick(20000);
  await until(() => f.calls.some(([, what]) => what === "heartbeat"), "the heartbeat");
  assert.deepEqual(f.calls.find(([, what]) => what === "heartbeat"), ["a", "heartbeat", "t1", "claim-t1", "build"]);

  // The PL releases it: the record is dropped and the engine stops its run.
  la.on.heartbeat = () => {
    throw notYours();
  };
  t.mock.timers.tick(60000);
  await until(() => claimRow(f, "t1").state === "dropped", "the record is dropped");
  await until(() => f.world.stops.length > 0, "the engine task is stopped");
  assert.deepEqual(f.world.stops, [{ project: checkout, taskId: engineTask }]);
});

test("with --live, a repo engine that settles drives the open record at once", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  // A run left in alpha's Story engine keeps it busy until it settles.
  await waitingTask(f, a, "Left running", "story");
  const la = f.link(a, "a");
  la.on.rerun = async () => ({ ...claimed("t1"), claimId: "claim-t1-b" });
  // A failed Task the member asked to run again while the Office was stopped.
  const store = storeOf(f);
  store.recordClaim(a, claimed("t1"), "claim");
  store.setPhase("t1", "failed");
  store.requestRerun("use the v2 endpoint");
  // No drive timer: only the start and an engine settle drive the record.
  const office = await f.open(f.live({ driveMs: 1e9 }));
  await until(() => office.status().claim?.phase === "claimed", "the start drive reran the Task");
  assert.deepEqual(f.calls.find(([, what]) => what === "rerun"), ["a", "rerun", "t1", "use the v2 endpoint"]);
  assert.equal(office.status().busy, true);
  await flush();
  assert.deepEqual(f.world.implementations, [], "nothing more without a drive");

  await f.world.of(f.checkoutOf(a)).settle();
  await until(() => office.status().claim?.phase === "building", "the settle drove the new claim into the engine");
  assert.equal(f.world.implementations.length, 1);
  assert.equal(claimRow(f, "t1").claim_id, "claim-t1-b");
});

test("while a repo engine has a run the Office is busy and does not claim; once the run settles it claims", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  f.link(a, "a");
  const lb = f.link(b, "b");
  lb.claimReply = claimed("t1");
  await waitingTask(f, a, "Waiting in alpha", "story");
  const office = await f.open(f.live({ driveMs: 1e9 }));
  await flush();
  assert.deepEqual(f.world.starts, [{ project: f.checkoutOf(a), runningBefore: 0 }], "alpha's waiting task runs");
  assert.equal(office.status().busy, true);
  assert.throws(() => office.assertIdle(), { code: "TASK_ACTIVE" });

  t.mock.timers.tick(30000);
  await flush();
  assert.equal(claims(f), 0, "nothing is claimed while busy");
  assert.equal(office.status().claim, null);

  await f.world.of(f.checkoutOf(a)).settle();
  await flush();
  assert.equal(office.status().busy, false);
  assert.doesNotThrow(() => office.assertIdle());
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(f.calls.filter(([, what]) => what === "claim"), [["a", "claim"], ["b", "claim"]]);
  assert.equal(office.status().claim.project, b);
});

test("repo engines run one at a time: B's waiting task starts once A's run settles", async (t) => {
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  await waitingTask(f, a, "Waiting in alpha", "story");
  await waitingTask(f, b, "Waiting in beta", "story");
  const office = await f.open({ createRuntime: f.world.create, runnerCatalog: async () => readyCatalog() });
  await flush();
  assert.deepEqual(f.world.starts, [{ project: f.checkoutOf(a), runningBefore: 0 }], "beta waits while alpha runs");
  await f.world.of(f.checkoutOf(a)).settle();
  await flush();
  assert.deepEqual(f.world.starts, [
    { project: f.checkoutOf(a), runningBefore: 0 },
    { project: f.checkoutOf(b), runningBefore: 0 },
  ]);
  assert.equal(office.status().busy, true);
});

test("sharedGate: othersActive skips the engine itself and closed peers, and a throwing peer counts as busy", () => {
  const logs = [];
  const gate = sharedGate((line) => logs.push(line));
  const peer = (busy) => ({ busy, refresh: async () => {} });
  const a = gate.join("a"),
    b = gate.join("b"),
    c = gate.join("c");
  // Not attached yet: an engine still being created has no run.
  assert.equal(a.othersActive(), false);
  a.attach(peer(() => true));
  b.attach(peer(() => false));
  c.attach(peer(() => false));
  assert.equal(a.othersActive(), false, "its own run does not count");
  assert.equal(b.othersActive(), true);
  assert.equal(gate.busy(), true);
  c.leave();
  a.leave();
  assert.equal(b.othersActive(), false, "closed peers are skipped");
  assert.equal(gate.busy(), false);
  const d = gate.join("d");
  d.attach(
    peer(() => {
      throw new Error("status failed");
    }),
  );
  assert.equal(b.othersActive(), true, "a peer that cannot answer is treated as running");
  assert.doesNotThrow(() => d.othersActive());
  assert.equal(gate.busy(), true);
  assert.ok(logs.some((line) => line.includes("d") && line.includes("status failed")), logs.join("\n"));
});

test("sharedGate: onSettled refreshes the others in turn from the one after it; failures are logged; closed peers and a stopped gate are skipped", async () => {
  const logs = [];
  const order = [];
  const gate = sharedGate((line) => logs.push(line));
  const members = ["a", "b", "c", "d"].map((name) => gate.join(name));
  const refresh = (name, fail) => async () => {
    order.push(name);
    if (fail === "reject") throw new Error(`${name} refresh failed`);
  };
  members[0].attach({ busy: () => false, refresh: refresh("a") });
  members[1].attach({ busy: () => false, refresh: refresh("b") });
  members[2].attach({ busy: () => false, refresh: refresh("c", "reject") });
  members[3].attach({
    busy: () => false,
    refresh: () => {
      order.push("d");
      throw new Error("d threw");
    },
  });
  await members[1].onSettled();
  assert.deepEqual(order, ["c", "d", "a"], "starts after b, wraps round, skips b");
  assert.ok(logs.some((line) => line.includes("c refresh failed")), logs.join("\n"));
  assert.ok(logs.some((line) => line.includes("d threw")), logs.join("\n"));

  order.length = 0;
  members[0].leave();
  await members[3].onSettled();
  assert.deepEqual(order, ["b", "c"], "a closed peer is not refreshed");

  order.length = 0;
  gate.stop();
  await members[1].onSettled();
  assert.deepEqual(order, [], "nothing is refreshed once the Office stops");
});

test("beginStop stops the timers; close closes every engine and is idempotent", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  f.link(a, "a").claimReply = claimed("t1");
  const office = await f.open(f.live());
  office.beginStop();
  t.mock.timers.tick(300000);
  await flush();
  assert.deepEqual(f.calls, [], "no claim, heartbeat, drive or recheck after the stop began");
  await office.close();
  await office.close();
  assert.deepEqual(
    f.world.list.map((rt) => [rt.project, rt.closed]),
    [[f.checkoutOf(a), true], [f.checkoutOf(b), true]],
  );
});

test("no registered repo is NO_REPOS", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.open(), { code: "NO_REPOS" });
});

test("a registered repo whose folder is gone fails the start with REPO_MISSING, naming the path and team remove, before anything opens", async (t) => {
  const f = fixture(t);
  await f.repo("alpha");
  const b = await f.repo("beta");
  rmSync(b, { recursive: true });
  await assert.rejects(f.open(), (error) => {
    assert.equal(error.code, "REPO_MISSING");
    assert.ok(error.message.includes(b), error.message);
    assert.ok(error.message.includes(`pazmo-office team remove --project ${b}`), error.message);
    return true;
  });
  assert.equal(existsSync(join(teamDir(f.data), "team.sqlite")), false, "the team store was not opened");
});

test("a repo engine that cannot open fails the start and closes the engines opened before it", async (t) => {
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  // beta's Story database belongs to another project.
  const other = join(f.root, "other");
  mkdirSync(other);
  openLeanDb(join(f.dataDirOf(b), "story"), other).close();
  await assert.rejects(f.open({ createRuntime: f.world.create, runnerCatalog: async () => readyCatalog() }), {
    code: "DATA_MISMATCH",
  });
  assert.deepEqual(f.world.list.map((rt) => [rt.project, rt.closed]), [[f.checkoutOf(a), true]]);
});

test("the team server answers only the lifecycle routes, with the Bearer token, on 127.0.0.1", async (t) => {
  const calls = [];
  const s = await startLifecycleServer({
    token: TOKEN,
    instance: INSTANCE,
    project: "/data/team",
    engine: "team",
    port: 0,
    status: () => ({ execution: "locked", repos: [], busy: false }),
    assertIdle: () => calls.push("assertIdle"),
    beginStop: () => calls.push("beginStop"),
    onStop: () => calls.push("onStop"),
  });
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.port}`;
  const bearer = { Authorization: `Bearer ${TOKEN}` };
  assert.equal((await fetch(`${base}/__pazmo/status`)).status, 401);
  const status = await fetch(`${base}/__pazmo/status`, { headers: bearer });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    execution: "locked",
    repos: [],
    busy: false,
    instance: INSTANCE,
    project: "/data/team",
    status: "running",
    engine: "team",
  });
  for (const path of ["/", "/api/board", "/api/session", "/app.js"])
    assert.equal((await fetch(`${base}${path}`, { headers: bearer })).status, 404, path);
  const stop = await fetch(`${base}/__pazmo/stop`, { method: "POST", headers: bearer });
  assert.equal(stop.status, 200);
  assert.deepEqual(await stop.json(), { instance: INSTANCE, project: "/data/team", status: "stopping" });
  await flush();
  assert.deepEqual(calls, ["assertIdle", "beginStop", "onStop"]);
});

test("the team server refuses a stop while a repo engine runs, and a wrong Host", async (t) => {
  const s = await startLifecycleServer({
    token: TOKEN,
    instance: INSTANCE,
    project: "/data/team",
    engine: "team",
    port: 0,
    status: () => ({}),
    assertIdle: () => {
      throw new OfficeError("TASK_ACTIVE", "busy");
    },
    beginStop: () => assert.fail("a refused stop does not begin stopping"),
  });
  t.after(() => s.close());
  const stop = await fetch(`http://127.0.0.1:${s.port}/__pazmo/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(stop.status, 409);
  assert.equal((await stop.json()).error, "TASK_ACTIVE");
  const { request } = await import("node:http");
  const misdirected = await new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port: s.port, path: "/__pazmo/status", headers: { Host: "evil.example", Authorization: `Bearer ${TOKEN}` } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(misdirected, 421);
});
