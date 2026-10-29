import test from "node:test";
import assert from "node:assert/strict";
import { fixture as contractFixture } from "./contract-fixture.mjs";
import { openLeanDb } from "../src/lean/schema.ts";
import { createLeanOffice } from "../src/lean/office.ts";

const TOKEN = "a".repeat(64);
const readyCatalog = () => ({
  installs: {
    codex: { runner: "codex", status: "ready", version: "0.160.0", sha256: "a".repeat(64), path: "/c", loggedIn: true, hint: "준비됨" },
    claude: { runner: "claude", status: "ready", version: "2.1.280", sha256: "b".repeat(64), path: "/k", loggedIn: true, hint: "준비됨" },
  },
  models: {
    codex: [{ slug: "gpt-6-sol" }, { slug: "gpt-5.5", reasoningLevels: [{ effort: "low" }, { effort: "high" }] }],
    claude: [{ slug: "default" }, { slug: "sonnet", reasoningLevels: [{ effort: "low" }] }, { slug: "haiku" }],
  },
});
const codex = { runner: "codex", model: "gpt-5.5", effort: "high" };
const claude = { runner: "claude", model: "default", effort: null };

/** One lean engine on its own project and database, with a fake live runtime as
 * in the lean-office tests, except that starting a run also makes it active
 * (what the real runtime reports) and records how many runs were active in the
 * whole `world` at that moment. `gate` is the shared-gate config a host passes. */
async function engine(t, world, name, gate = {}) {
  const c = contractFixture(t);
  const db = openLeanDb(c.root, c.project);
  // statusFailure: thrown once by the next live.status() call (it makes the
  // engine's own continuation reject, as a failing completion step would).
  const state = { active: [], statusFailure: null };
  const calls = { planning: [] };
  const live = {
    status: () => {
      const failure = state.statusFailure;
      state.statusFailure = null;
      if (failure) throw failure;
      return { execution: "ready", active: state.active, lastError: null };
    },
    startPlanning: (taskId, ...rest) => {
      world.starts.push({ engine: name, runningBefore: world.running() });
      calls.planning.push([taskId, ...rest]);
      state.active = [...state.active, { taskId, kind: "planning" }];
    },
    startImplementation() {},
    startUnderstanding() {},
    cancelImplementation() {},
    abort() {},
    assertIdle() {},
    close: async () => {},
  };
  const office = await createLeanOffice({
    db,
    project: c.project,
    dataDir: c.root,
    token: TOKEN,
    runnerCatalog: async () => readyCatalog(),
    createRuntime: async () => live,
    ...gate,
  });
  c.defer(async () => {
    await office.close();
    db.close();
  });
  const agent = await office.agents.create({ name: "Alice", work: codex, review: claude });
  const e = {
    name,
    office,
    live,
    calls,
    agent,
    /** The engine's run ends: the runtime clears it and reports it settled. */
    async settle() {
      state.active = [];
      await live.onSettled();
    },
    /** The run ends but the engine's own continuation fails (its first status read throws). */
    async settleFailing(error) {
      state.active = [];
      state.statusFailure = error;
      await live.onSettled();
    },
    task: (title) => office.createTask({ title, body: "", agentId: agent.id, risk: "normal" }),
    column(id) {
      const board = office.board();
      for (const [column, cards] of Object.entries(board.columns)) if (cards.some((card) => card.id === id)) return column;
      return null;
    },
  };
  world.engines.push(e);
  return e;
}
const newWorld = () => ({
  engines: [],
  starts: [],
  running: function () {
    return this.engines.reduce((n, e) => n + e.office.status().active.length, 0);
  },
});

/** Two engines tied as the team Office ties them: each waits while the other
 * runs, and a settled run lets both continue. The continuations are kept so a
 * test can wait for them. */
async function pair(t) {
  const world = newWorld();
  const pending = [];
  const peers = {};
  const gate = (other) => ({
    othersActive: () => peers[other].office.busy(),
    onSettled: () => {
      pending.push(peers.a.office.refresh(), peers.b.office.refresh());
    },
  });
  peers.a = await engine(t, world, "a", gate("b"));
  peers.b = await engine(t, world, "b", gate("a"));
  return { world, a: peers.a, b: peers.b, settled: () => Promise.all(pending.splice(0)) };
}

test("busy() is true exactly while the engine has a run", async (t) => {
  const world = newWorld();
  const a = await engine(t, world, "a");
  assert.equal(a.office.busy(), false);
  await a.task("One");
  assert.equal(a.calls.planning.length, 1);
  assert.equal(a.office.busy(), true);
  await a.settle();
  assert.equal(a.office.busy(), false);
});

test("an engine does not start a run while another engine of its host runs", async (t) => {
  const { world, a, b } = await pair(t);
  const first = await a.task("First repo");
  const second = await b.task("Second repo");
  assert.equal(a.calls.planning.length, 1, "A started");
  assert.equal(b.calls.planning.length, 0, "B waits while A runs");
  assert.equal(a.column(first.id), "active");
  assert.equal(b.column(second.id), "waiting", "the task exists and is shown, only its run waits");
  assert.deepEqual(world.starts, [{ engine: "a", runningBefore: 0 }]);
});

test("when A's run ends, B's waiting task starts, and the other way round", async (t) => {
  const { world, a, b, settled } = await pair(t);
  const first = await a.task("First repo");
  const second = await b.task("Second repo");
  await a.settle();
  await settled();
  assert.equal(b.calls.planning.length, 1, "B started once A settled");
  assert.equal(b.column(second.id), "active");
  assert.equal(a.office.busy(), false);
  assert.equal(b.office.busy(), true);

  const third = await a.task("First repo again");
  assert.equal(a.calls.planning.length, 1, "A waits while B runs");
  assert.equal(a.column(third.id), "waiting");
  await b.settle();
  await settled();
  assert.equal(a.calls.planning.length, 2, "A started once B settled");
  assert.equal(a.column(third.id), "active");
  assert.notEqual(a.column(first.id), "waiting");

  assert.deepEqual(
    world.starts.map((s) => s.runningBefore),
    [0, 0, 0],
    "no run ever started while another engine's run was active",
  );
});

test("an engine that is not told about the others still runs beside them", async (t) => {
  const world = newWorld();
  const a = await engine(t, world, "a");
  const b = await engine(t, world, "b");
  await a.task("One");
  await b.task("Two");
  assert.equal(a.calls.planning.length, 1);
  assert.equal(b.calls.planning.length, 1, "no othersActive: only its own runtime is checked");
  assert.deepEqual(world.starts.map((s) => s.runningBefore), [0, 1]);
});

test("one engine still runs one run at a time with only othersActive set", async (t) => {
  const world = newWorld();
  const a = await engine(t, world, "a", { othersActive: () => false });
  await a.task("One");
  const second = await a.task("Two");
  assert.equal(a.calls.planning.length, 1, "its own runtime still gates it");
  assert.equal(a.column(second.id), "waiting");
  await a.settle();
  assert.equal(a.calls.planning.length, 2);
});

test("onSettled is called after the engine's own continuation has run", async (t) => {
  const world = newWorld();
  const seen = [];
  const a = await engine(t, world, "a", {
    onSettled: () => seen.push(a.calls.planning.length),
  });
  await a.task("One");
  const second = await a.task("Two");
  assert.equal(a.column(second.id), "waiting");
  await a.settle();
  assert.deepEqual(seen, [2], "the second run was already started when the host was told");
});

test("an onSettled that throws is logged and never reaches the runtime", async (t) => {
  const world = newWorld();
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  const a = await engine(t, world, "a", {
    onSettled: () => {
      throw new Error("host callback failed");
    },
  });
  await a.task("One");
  await assert.doesNotReject(a.settle());
  assert.ok(
    logged.some((line) => line.includes("Native Office continuation stopped") && line.includes("host callback failed")),
    logged.join("\n"),
  );
});

test("the host is told an engine settled even when its own continuation fails", async (t) => {
  const { a, b, settled } = await pair(t);
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  await a.task("First repo");
  const second = await b.task("Second repo");
  assert.equal(b.calls.planning.length, 0, "B waits while A runs");
  await assert.doesNotReject(a.settleFailing(new Error("completion failed")));
  await settled();
  assert.ok(
    logged.some((line) => line.includes("Native Office continuation stopped") && line.includes("completion failed")),
    "A's own failure is still logged:\n" + logged.join("\n"),
  );
  assert.equal(b.calls.planning.length, 1, "the host callback ran, so B's waiting task started");
  assert.equal(b.column(second.id), "active");
});

test("a failing continuation and a failing host callback are each logged and neither escapes", async (t) => {
  const world = newWorld();
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  const a = await engine(t, world, "a", {
    onSettled: () => {
      throw new Error("host callback failed");
    },
  });
  await a.task("One");
  await assert.doesNotReject(a.settleFailing(new Error("completion failed")));
  const stopped = logged.filter((line) => line.includes("Native Office continuation stopped"));
  assert.equal(stopped.length, 2, logged.join("\n"));
  assert.ok(stopped.some((line) => line.includes("completion failed")));
  assert.ok(stopped.some((line) => line.includes("host callback failed")));
});
