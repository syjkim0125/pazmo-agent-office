import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLeanDb } from "../src/lean/schema.ts";
import { LeanAgents } from "../src/lean/agents.ts";

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
const loggedOut = (name) => {
  const c = readyCatalog();
  c.installs[name] = { ...c.installs[name], loggedIn: false, hint: `${name} 로그인이 필요합니다.` };
  return c;
};

function fixture(t, initial = readyCatalog) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lean-agents-")));
  mkdirSync(join(root, "project"));
  const db = openLeanDb(root, join(root, "project"));
  const state = { catalog: initial(), loads: 0, failure: null };
  const load = async () => {
    state.loads++;
    if (state.failure) throw state.failure;
    return state.catalog;
  };
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { db, agents: new LeanAgents(db, load), state };
}
const codex = (model = "gpt-5.5", effort = null) => ({ runner: "codex", model, effort });
const claude = (model = "default", effort = null) => ({ runner: "claude", model, effort });
const input = (name, work = codex(), review = codex()) => ({ name, work, review });
const task = (db, id, status, agent, source = null) =>
  db
    .prepare("INSERT INTO tasks(id,title,status,agent_id,source_task_id) VALUES (?,?,?,?,?)")
    .run(id, `task ${id}`, status, agent, source);

test("ensureDefault creates one default agent from the usual default runner, and only once", async (t) => {
  const { agents } = fixture(t);
  assert.deepEqual(agents.list(), []);
  const first = await agents.ensureDefault();
  assert.equal(first.name, "기본 agent");
  assert.deepEqual(first.work, { runner: "codex", model: "gpt-5.5", reasoning: null });
  assert.deepEqual(first.review, first.work, "work and review start identical");
  assert.equal(first.busy, false);
  assert.equal(typeof first.createdAt, "number");
  const second = await agents.ensureDefault();
  assert.equal(second.id, first.id);
  assert.equal(agents.list().length, 1);
});

test("ensureDefault concurrent calls still create a single agent", async (t) => {
  const { agents } = fixture(t);
  const [a, b] = await Promise.all([agents.ensureDefault(), agents.ensureDefault()]);
  assert.equal(a.id, b.id);
  assert.equal(agents.list().length, 1);
});

test("ensureDefault uses claude when codex is not usable", async (t) => {
  const { agents } = fixture(t, () => loggedOut("codex"));
  const made = await agents.ensureDefault();
  assert.deepEqual(made.work, { runner: "claude", model: "default", reasoning: null });
});

test("ensureDefault still creates the agent with no ready CLI or an empty model list", async (t) => {
  const none = readyCatalog();
  none.installs.codex = { runner: "codex", status: "missing", loggedIn: false, hint: "install codex" };
  none.installs.claude = { runner: "claude", status: "missing", loggedIn: false, hint: "install claude" };
  const a = fixture(t, () => none);
  const unready = await a.agents.ensureDefault();
  assert.equal(unready.name, "기본 agent");
  assert.deepEqual(unready.work, { runner: "codex", model: "gpt-5.5", reasoning: null });
  assert.equal(await a.agents.runnersReady(unready.id), false, "task creation catches it later");

  const empty = readyCatalog();
  empty.models = { codex: [], claude: [] };
  const b = fixture(t, () => empty);
  const made = await b.agents.ensureDefault();
  assert.equal(typeof made.work.model, "string");
  assert.equal(made.work.runner, "codex");
  assert.equal(await b.agents.runnersReady(made.id), false, "an empty model list is not ready");
});

test("ensureDefault does not depend on discovery succeeding", async (t) => {
  const { agents, state } = fixture(t);
  state.failure = new Error("discovery crashed");
  const made = await agents.ensureDefault();
  assert.deepEqual(made.work, { runner: "codex", model: "gpt-5.5", reasoning: null });
});

test("create stores both runners and resolves a missing model to the CLI's preferred string", async (t) => {
  const { agents, db } = fixture(t);
  const made = await agents.create({
    name: "  Alice  ",
    work: { runner: "codex", model: "gpt-5.5", effort: "high" },
    review: { runner: "claude", model: null, effort: null },
  });
  assert.equal(made.name, "Alice", "the name is trimmed");
  assert.deepEqual(made.work, { runner: "codex", model: "gpt-5.5", reasoning: "high" });
  assert.deepEqual(made.review, { runner: "claude", model: "default", reasoning: null });
  const row = db.prepare("SELECT * FROM agents WHERE id=?").get(made.id);
  assert.deepEqual(
    [row.work_runner, row.work_model, row.work_effort, row.review_runner, row.review_model, row.review_effort],
    ["codex", "gpt-5.5", "high", "claude", "default", null],
  );
  assert.equal(row.department_id, null);
  assert.equal(row.role, null);
  const omitted = await agents.create({
    name: "Bob",
    work: { runner: "codex" },
    review: { runner: "codex", model: undefined, effort: undefined },
  });
  assert.deepEqual(omitted.work, { runner: "codex", model: "gpt-5.5", reasoning: null });
  assert.deepEqual(agents.list().map((a) => a.name), ["Alice", "Bob"], "listed in creation order");
});

test("names must be 1 to 40 characters after trimming and unique ignoring case", async (t) => {
  const { agents } = fixture(t);
  for (const bad of ["", "   ", "\n\t", "x".repeat(41), 7, null, undefined])
    await assert.rejects(agents.create(input(bad)), { code: "AGENT_NAME_INVALID" }, JSON.stringify(bad));
  const forty = "가".repeat(40);
  assert.equal((await agents.create(input(forty))).name, forty, "40 characters are allowed");
  await agents.create(input("Alice"));
  for (const dup of ["alice", "ALICE", "  aLiCe "])
    await assert.rejects(agents.create(input(dup)), { code: "AGENT_NAME_TAKEN" }, dup);
  assert.equal(agents.list().length, 2);
});

test("a rename follows the same name rules and may change only the case of its own name", async (t) => {
  const { agents } = fixture(t);
  const alice = await agents.create(input("Alice"));
  await agents.create(input("Bob"));
  await assert.rejects(agents.update(alice.id, { name: "bob" }), { code: "AGENT_NAME_TAKEN" });
  await assert.rejects(agents.update(alice.id, { name: " " }), { code: "AGENT_NAME_INVALID" });
  await assert.rejects(agents.update(alice.id, { name: "x".repeat(41) }), { code: "AGENT_NAME_INVALID" });
  assert.equal((await agents.update(alice.id, { name: "ALICE" })).name, "ALICE");
  assert.equal((await agents.update(alice.id, { name: " Carol " })).name, "Carol");
});

test("a runner that is not ready, unknown or unsupported is rejected with the agent-save codes", async (t) => {
  const { agents, state } = fixture(t, () => loggedOut("claude"));
  await assert.rejects(agents.create(input("A", claude(), codex())), { code: "RUNNER_NOT_READY" });
  await assert.rejects(agents.create(input("A", codex(), claude())), { code: "RUNNER_NOT_READY" }, "review is checked too");
  await assert.rejects(agents.create(input("A", { runner: "gemini", model: "x", effort: null })), { code: "RUNNER_UNSUPPORTED" });
  await assert.rejects(agents.create(input("A", codex("gpt-unknown"))), { code: "RUNNER_MODEL_UNKNOWN" });
  await assert.rejects(agents.create(input("A", codex("gpt-5.5", "ultra"))), { code: "RUNNER_REASONING_UNKNOWN" });
  await assert.rejects(agents.create({ name: "A", work: codex() }), { code: "INVALID_REQUEST" }, "review is required");
  await assert.rejects(agents.create({ name: "A", work: "codex", review: codex() }), { code: "INVALID_REQUEST" });
  assert.equal(agents.list().length, 0, "nothing is created by a rejected request");
  const ok = await agents.create(input("A"));
  state.catalog = loggedOut("codex");
  await assert.rejects(agents.update(ok.id, { work: codex() }), { code: "RUNNER_NOT_READY" });
});

test("changing the work runner leaves the review runner as it was", async (t) => {
  const { agents } = fixture(t);
  const made = await agents.create(input("Alice", codex("gpt-5.5", "low"), claude("haiku")));
  const worked = await agents.update(made.id, { work: claude("sonnet", "low") });
  assert.deepEqual(worked.work, { runner: "claude", model: "sonnet", reasoning: "low" });
  assert.deepEqual(worked.review, { runner: "claude", model: "haiku", reasoning: null });
  const reviewed = await agents.update(made.id, { review: codex("gpt-6-sol") });
  assert.deepEqual(reviewed.work, { runner: "claude", model: "sonnet", reasoning: "low" });
  assert.deepEqual(reviewed.review, { runner: "codex", model: "gpt-6-sol", reasoning: null });
  assert.equal(reviewed.name, "Alice");
  assert.deepEqual(agents.list()[0], reviewed, "what update returns is what list shows");
});

test("a rename alone neither checks the runners nor changes them", async (t) => {
  const { agents, state } = fixture(t);
  const made = await agents.create(input("Alice"));
  state.catalog = loggedOut("codex");
  const loads = state.loads;
  const renamed = await agents.update(made.id, { name: "Alicia" });
  assert.equal(state.loads, loads, "no discovery for a rename");
  assert.deepEqual(renamed.work, made.work);
  assert.deepEqual(await agents.update(made.id, {}), renamed, "an empty patch changes nothing");
  await assert.rejects(agents.update("no-such-agent", { name: "X" }), { code: "NOT_FOUND" });
  for (const bad of [null, undefined, "name", []])
    await assert.rejects(agents.update(made.id, bad), { code: "INVALID_REQUEST" }, JSON.stringify(bad));
});

test("an agent is busy while one of its root tasks is not done or cancelled", async (t) => {
  const { agents, db } = fixture(t);
  const made = await agents.create(input("Alice"));
  assert.equal(agents.list()[0].busy, false);
  for (const status of ["done", "cancelled"]) {
    task(db, `t-${status}`, status, made.id);
    assert.equal(agents.list()[0].busy, false, status);
  }
  task(db, "child", "in_progress", made.id, "t-done");
  assert.equal(agents.list()[0].busy, false, "a subtask never counts, only the root task");
  for (const status of ["inbox", "planned", "collaborating", "in_progress", "review", "pending"]) {
    db.prepare("DELETE FROM tasks WHERE id='live'").run();
    task(db, "live", status, made.id);
    assert.equal(agents.list()[0].busy, true, status);
  }
  const other = await agents.create(input("Bob"));
  assert.deepEqual(agents.list().map((a) => [a.name, a.busy]), [["Alice", true], ["Bob", false]]);
  assert.equal(other.busy, false);
});

test("remove refuses an agent with unfinished work, then the last agent, and deletes the rest", async (t) => {
  const { agents, db } = fixture(t);
  const alice = await agents.create(input("Alice"));
  const bob = await agents.create(input("Bob"));
  task(db, "running", "in_progress", alice.id);
  assert.throws(() => agents.remove(alice.id), { code: "AGENT_BUSY", message: "진행 중인 작업이 있습니다." });
  assert.equal(agents.list().length, 2);
  db.prepare("UPDATE tasks SET status='done' WHERE id='running'").run();
  agents.remove(alice.id);
  assert.deepEqual(agents.list().map((a) => a.name), ["Bob"]);
  assert.equal(db.prepare("SELECT agent_id FROM tasks WHERE id='running'").get().agent_id, null, "history stays, ownerless");
  assert.throws(() => agents.remove(bob.id), { code: "LAST_AGENT", message: "마지막 agent는 삭제할 수 없습니다." });
  assert.throws(() => agents.remove("no-such-agent"), { code: "NOT_FOUND" });
  assert.equal(agents.list().length, 1);
});

test("a busy agent reports AGENT_BUSY even when it is the last one", async (t) => {
  const { agents, db } = fixture(t);
  const only = await agents.ensureDefault();
  task(db, "t", "inbox", only.id);
  assert.throws(() => agents.remove(only.id), { code: "AGENT_BUSY" });
});

test("runnersReady checks both stored runners against a fresh discovery", async (t) => {
  const { agents, state } = fixture(t);
  const made = await agents.create(input("Alice", codex("gpt-5.5", "high"), claude("haiku")));
  assert.equal(await agents.runnersReady(made.id), true);
  const loads = state.loads;
  state.catalog = loggedOut("claude");
  assert.equal(await agents.runnersReady(made.id), false, "review runner logged out");
  assert.ok(state.loads > loads, "each call discovers again");
  state.catalog = loggedOut("codex");
  assert.equal(await agents.runnersReady(made.id), false, "work runner logged out");
  const gone = readyCatalog();
  gone.models.claude = [{ slug: "default" }];
  state.catalog = gone;
  assert.equal(await agents.runnersReady(made.id), false, "a stored model that left the list");
  const noLevels = readyCatalog();
  noLevels.models.codex = [{ slug: "gpt-5.5" }];
  state.catalog = noLevels;
  assert.equal(await agents.runnersReady(made.id), false, "a stored effort the model no longer lists");
  state.catalog = readyCatalog();
  assert.equal(await agents.runnersReady(made.id), true, "recovers when the CLI does");
  state.failure = new Error("discovery crashed");
  assert.equal(await agents.runnersReady(made.id), false, "no answer from discovery is not ready");
  await assert.rejects(agents.runnersReady("no-such-agent"), { code: "NOT_FOUND" });
});
