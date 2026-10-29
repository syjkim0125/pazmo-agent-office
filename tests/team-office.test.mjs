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
import { createTeamOffice, sharedGate } from "../src/team/office.ts";
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
const codex = { runner: "codex", model: "gpt-5.5", effort: "high" };
const claude = { runner: "claude", model: "default", effort: null };
/** Lets every pending promise chain of the fakes run (none of them waits on I/O). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A Task as the Hub hands it out (only the fields the Office reads). */
const claimed = (taskId, number = 1, storyNumber = 7) => ({
  taskId,
  claimId: `claim-${taskId}`,
  kind: "work",
  number,
  title: `Task ${taskId}`,
  spec: "",
  files: [],
  verify: [],
  storyVerify: [],
  repoId: "r",
  branch: "story/7",
  story: { id: "s", number: storyNumber, title: "Story", body: "", risk: "normal", branches: [] },
  upstream: [],
  lastFailure: null,
});

/** A Story link that records its calls; `claimReply` / `claimError` shape the next claim. */
function fakeLink(name, calls) {
  const link = {
    claimReply: null,
    claimError: null,
    onClaim: null,
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
      return link.claimReply;
    },
    async task(taskId, claimId) {
      calls.push([name, "task", taskId, claimId]);
      return claimed(taskId);
    },
    async heartbeat(taskId, claimId, stage) {
      calls.push([name, "heartbeat", taskId, claimId, stage]);
    },
  };
  return link;
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
  const f = {
    root,
    data: join(root, "data"),
    defer: (cleanup) => cleanups.push(cleanup),
    logs: [],
    calls: [],
    links: new Map(),
    gh: {},
    ghCalls: [],
    /** A git repo on `host`, registered; returns its real path. */
    async repo(name, host = "github.example.com") {
      const dir = join(root, name);
      mkdirSync(dir);
      execFileSync("git", ["init", "-q", dir]);
      execFileSync("git", ["-C", dir, "remote", "add", "origin", `https://${host}/team/${name}.git`]);
      return (await addTeamRepo(f.data, dir)).project;
    },
    dataDirOf: (dir) => locate(dir, f.data).dataDir,
    /** Gives the repo a Story link (linkOf answers it for the repo's data directory). */
    link(dir, name) {
      const link = fakeLink(name, f.calls);
      f.links.set(f.dataDirOf(dir), link);
      return link;
    },
    async open(extra = {}) {
      const office = await createTeamOffice({
        root: f.data,
        token: TOKEN,
        linkOf: (dataDir) => f.links.get(dataDir) ?? null,
        ghOf: async (host) => {
          f.ghCalls.push(host);
          return f.gh[host] ?? OK;
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

/** Live runtimes as the native engine sees them, one per repo engine: starting a
 * planning run makes it active and records how many runs the whole world had. */
function runtimes() {
  const world = {
    list: [],
    starts: [],
    running() {
      return this.list.reduce((n, rt) => n + rt.state.active.length, 0);
    },
  };
  world.create = async (_live, project) => {
    const rt = {
      project,
      closed: false,
      state: { active: [] },
      status: () => ({ execution: "ready", active: rt.state.active, lastError: null }),
      startPlanning(taskId) {
        world.starts.push({ project, runningBefore: world.running() });
        rt.state.active = [...rt.state.active, { taskId, kind: "planning" }];
      },
      startImplementation() {},
      startUnderstanding() {},
      cancelImplementation() {},
      abort() {},
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

/** A task left waiting in the repo's own lean data, as a previous Office could
 * leave it: its run was never started (another engine was running). */
async function waitingTask(f, dir, title) {
  const p = locate(dir, f.data);
  const db = openLeanDb(p.dataDir, p.project);
  const idle = { status: () => ({ execution: "ready", active: [], lastError: null }), assertIdle() {}, close: async () => {} };
  const office = await createLeanOffice({
    db,
    project: p.project,
    dataDir: join(p.dataDir, "lean"),
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
  const office = await f.open();
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
  const office = await f.open();
  t.mock.timers.tick(29999);
  await flush();
  assert.deepEqual(f.calls, [], "no tick before 30000 ms");
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(f.calls, [["a", "inbox"], ["a", "claim"]]);
  const status = office.status();
  assert.deepEqual(status.claim, { storyNumber: 7, taskNumber: 3, title: "Task t1", project: a });
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
  const office = await f.open();
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

test("stage 2 opens every repo engine locked, even when given a live config: leftover lean work waits untouched and the Office still claims", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  f.link(a, "a").claimReply = claimed("t1");
  await waitingTask(f, a, "Waiting in alpha");
  // beta's lean data exists but has no agent: a live engine would make the default one.
  openLeanDb(f.dataDirOf(b), b).close();
  const before = { a: leanRows(f, a), b: leanRows(f, b) };
  assert.equal(before.b.agents, 0);
  // What `start --team --live` / `up --team` hand the service. No path exists, so a live
  // runtime built from it would fail the start: the engines must never be given it.
  const live = {
    controller: join(f.root, "no-controller"),
    binary: join(f.root, "no-binary"),
    authHome: join(f.root, "no-auth"),
    socket: join(f.root, "no-docker.sock"),
    userHome: f.root,
    searchPath: "",
  };
  const office = await f.open({ live, runnerCatalog: async () => readyCatalog() });
  await flush();
  assert.equal(office.status().busy, false, "no engine has a run");
  assert.doesNotThrow(() => office.assertIdle());
  assert.deepEqual(leanRows(f, a), before.a, "alpha's waiting task did not start");
  assert.equal(leanRows(f, b).agents, 0, "no default agent is made");

  // The claim scheduler, gh checks and heartbeats still run.
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(office.status().claim.project, a);
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(f.calls.at(-1), ["a", "heartbeat", "t1", "claim-t1", "build"]);
  assert.deepEqual(leanRows(f, a), before.a, "a claimed Task does not start the waiting lean task either");
});

test("while a repo engine has a run the Office is busy and does not claim; once the run settles it claims", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(t);
  const a = await f.repo("alpha");
  const b = await f.repo("beta");
  f.link(a, "a");
  const lb = f.link(b, "b");
  lb.claimReply = claimed("t1");
  await waitingTask(f, a, "Waiting in alpha");
  const world = runtimes();
  // Only the test-only runtime seam can give an engine a run (production opens every engine locked).
  const office = await f.open({ createRuntime: world.create, runnerCatalog: async () => readyCatalog() });
  await flush();
  assert.deepEqual(world.starts, [{ project: a, runningBefore: 0 }], "with the injected runtime, alpha's waiting task runs");
  assert.equal(office.status().busy, true);
  assert.throws(() => office.assertIdle(), { code: "TASK_ACTIVE" });

  t.mock.timers.tick(30000);
  await flush();
  assert.equal(f.calls.filter(([, what]) => what === "claim").length, 0, "nothing is claimed while busy");
  assert.equal(office.status().claim, null);

  await world.of(a).settle();
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
  await waitingTask(f, a, "Waiting in alpha");
  await waitingTask(f, b, "Waiting in beta");
  const world = runtimes();
  const office = await f.open({ createRuntime: world.create, runnerCatalog: async () => readyCatalog() });
  await flush();
  assert.deepEqual(world.starts, [{ project: a, runningBefore: 0 }], "beta waits while alpha runs");
  await world.of(a).settle();
  await flush();
  assert.deepEqual(world.starts, [
    { project: a, runningBefore: 0 },
    { project: b, runningBefore: 0 },
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
  const world = runtimes();
  const office = await f.open({ createRuntime: world.create, runnerCatalog: async () => readyCatalog() });
  office.beginStop();
  t.mock.timers.tick(300000);
  await flush();
  assert.deepEqual(f.calls, [], "no claim, heartbeat or recheck after the stop began");
  await office.close();
  await office.close();
  assert.deepEqual(
    world.list.map((rt) => [rt.project, rt.closed]),
    [[a, true], [b, true]],
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
  // beta's lean database belongs to another project.
  const other = join(f.root, "other");
  mkdirSync(other);
  openLeanDb(f.dataDirOf(b), other).close();
  const world = runtimes();
  await assert.rejects(f.open({ createRuntime: world.create, runnerCatalog: async () => readyCatalog() }), {
    code: "DATA_MISMATCH",
  });
  assert.deepEqual(world.list.map((rt) => [rt.project, rt.closed]), [[a, true]]);
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
