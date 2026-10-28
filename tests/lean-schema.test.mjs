import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLeanDb } from "../src/lean/schema.ts";
import { createNativeOffice } from "../src/runtime/native-office.ts";
import { hubSnapshot } from "../src/runtime/hub-snapshot.ts";

const ROOT_TASK = "11111111-1111-4111-8111-111111111111";
const CHILD_TASK = "22222222-2222-4222-8222-222222222222";

function workspace(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lean-schema-"))),
    project = join(root, "project");
  mkdirSync(project);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, project, file: join(root, "lean", "office.sqlite") };
}
const columns = (db, table) =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name)
    .sort();
const insertAgent = (db, id, name) =>
  db
    .prepare(
      "INSERT INTO agents(id,name,work_runner,work_model,review_runner,review_model) VALUES (?,?,'codex','gpt-5.5','codex','gpt-5.5')",
    )
    .run(id, name);

test("a new database is private, enforces foreign keys and never touches the claw directory", (t) => {
  const w = workspace(t);
  const db = openLeanDb(w.root, w.project);
  t.after(() => db.close());
  assert.equal(statSync(w.file).mode & 0o777, 0o600);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(db.prepare("PRAGMA busy_timeout").get().timeout, 5000);
  assert.deepEqual(readdirSync(w.root).sort(), ["lean", "project"]);
  assert.equal(existsSync(join(w.root, "claw")), false);
  assert.deepEqual(readdirSync(join(w.root, "lean")), ["office.sqlite"]);
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO tasks(id,title,agent_id) VALUES ('t','x','missing-agent')")
        .run(),
    /FOREIGN KEY/,
    "tasks.agent_id references agents",
  );
});

test("reopening keeps the data and the same project owns the file", (t) => {
  const w = workspace(t);
  const first = openLeanDb(w.root, w.project);
  insertAgent(first, "a1", "Alice");
  first.close();
  const second = openLeanDb(w.root, w.project);
  t.after(() => second.close());
  assert.deepEqual(
    second.prepare("SELECT id,name FROM agents").all().map((r) => ({ ...r })),
    [{ id: "a1", name: "Alice" }],
  );
  assert.equal(second.prepare("SELECT COUNT(*) n FROM lean_instance").get().n, 1);
  assert.equal(second.prepare("SELECT project FROM lean_instance").get().project, w.project);
});

test("a file that belongs to another project or is not a lean database is refused", (t) => {
  const w = workspace(t);
  openLeanDb(w.root, w.project).close();
  const other = join(w.root, "other-project");
  mkdirSync(other);
  assert.throws(() => openLeanDb(w.root, other), { code: "DATA_MISMATCH" });
  // The refusal does not damage the file: the owner still opens it.
  openLeanDb(w.root, w.project).close();

  const foreign = workspace(t);
  mkdirSync(join(foreign.root, "lean"));
  const stranger = new DatabaseSync(foreign.file);
  stranger.exec("CREATE TABLE notes (body TEXT)");
  stranger.close();
  assert.throws(() => openLeanDb(foreign.root, foreign.project), { code: "DATA_MISMATCH" });
});

test("an empty file left by an interrupted first start is initialised", (t) => {
  const w = workspace(t);
  mkdirSync(join(w.root, "lean"));
  writeFileSync(w.file, "", { mode: 0o600 });
  const db = openLeanDb(w.root, w.project);
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT project FROM lean_instance").get().project, w.project);
});

test("a symlinked database path is refused", (t) => {
  const w = workspace(t);
  mkdirSync(join(w.root, "lean"));
  const real = join(w.root, "elsewhere.sqlite");
  new DatabaseSync(real).close();
  symlinkSync(real, w.file);
  assert.throws(() => openLeanDb(w.root, w.project), { code: "UNSAFE_PATH" });
});

test("a symlinked lean directory is refused and nothing is created through it", (t) => {
  const w = workspace(t);
  const elsewhere = join(w.root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(w.root, "lean"));
  assert.throws(() => openLeanDb(w.root, w.project), { code: "UNSAFE_PATH" });
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("tables carry exactly the columns the engine reads or writes plus the lean ones", (t) => {
  const w = workspace(t);
  const db = openLeanDb(w.root, w.project);
  t.after(() => db.close());
  assert.deepEqual(columns(db, "tasks"), [
    "agent_id", "assigned_agent_id", "created_at", "description", "id", "project_id",
    "project_path", "risk", "source_task_id", "status", "title", "updated_at",
  ]);
  assert.deepEqual(columns(db, "agents"), [
    "created_at", "current_task_id", "department_id", "id", "name", "name_ko", "review_effort",
    "review_model", "review_runner", "role", "status", "work_effort", "work_model", "work_runner",
  ]);
  assert.deepEqual(columns(db, "messages"), [
    "content", "created_at", "id", "message_type", "receiver_id", "receiver_type", "sender_id",
    "sender_type", "task_id",
  ]);
  assert.deepEqual(columns(db, "task_logs"), ["created_at", "id", "kind", "message", "task_id"]);
  assert.deepEqual(columns(db, "projects"), ["id", "project_path"]);
});

test("a database made before reruns gains their links when it opens; a task reruns once and its link goes with it", (t) => {
  const w = workspace(t);
  const before = openLeanDb(w.root, w.project);
  // The phase 1 file had no links table.
  before.exec("DROP TABLE IF EXISTS task_reruns");
  before.prepare("INSERT INTO tasks(id,title) VALUES ('old','Old'),('new','New'),('newer','Newer')").run();
  before.close();
  const db = openLeanDb(w.root, w.project);
  try {
    assert.deepEqual(columns(db, "task_reruns"), ["previous_id", "task_id"]);
    const link = db.prepare("INSERT INTO task_reruns(task_id,previous_id) VALUES (?,?)");
    link.run("new", "old");
    assert.throws(() => link.run("newer", "old"), /UNIQUE/, "a task is rerun once");
    assert.throws(() => link.run("newer", "missing"), /FOREIGN KEY/);
    db.prepare("DELETE FROM tasks WHERE id='new'").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM task_reruns").get().n, 0, "removing the new task removes its link");
    link.run("newer", "old");
  } finally {
    db.close();
  }
  // Opening again keeps what is there.
  const again = openLeanDb(w.root, w.project);
  t.after(() => again.close());
  assert.equal(again.prepare("SELECT previous_id FROM task_reruns WHERE task_id='newer'").get().previous_id, "old");
});

test("task status accepts only the values the engine writes, and risk only normal or high", (t) => {
  const w = workspace(t);
  const db = openLeanDb(w.root, w.project);
  t.after(() => db.close());
  const insert = db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,?)");
  for (const status of ["inbox", "planned", "collaborating", "in_progress", "review", "done", "cancelled", "pending"])
    insert.run(`task-${status}`, "x", status);
  assert.throws(() => insert.run("task-bogus", "x", "archived"), /CHECK/);
  assert.equal(db.prepare("SELECT status,risk FROM tasks WHERE id='task-inbox'").get().risk, "normal");
  assert.throws(() => db.prepare("INSERT INTO tasks(id,title,risk) VALUES ('r','x','extreme')").run(), /CHECK/);
});

test("an agent's finished tasks survive its removal and keep no owner", (t) => {
  const w = workspace(t);
  const db = openLeanDb(w.root, w.project);
  t.after(() => db.close());
  insertAgent(db, "a1", "Alice");
  db.prepare("INSERT INTO tasks(id,title,status,agent_id,assigned_agent_id) VALUES ('t1','x','done','a1','a1')").run();
  db.prepare("DELETE FROM agents WHERE id='a1'").run();
  const row = db.prepare("SELECT agent_id,assigned_agent_id FROM tasks WHERE id='t1'").get();
  assert.equal(row.agent_id, null);
  assert.equal(row.assigned_agent_id, null);
});

async function engine(t, extra = {}) {
  const w = workspace(t);
  const db = openLeanDb(w.root, w.project);
  const calls = [];
  const live = {
    status: () => ({ execution: "ready", active: [] }),
    startPlanning: (...args) => calls.push(args),
    assertIdle() {},
    close: async () => {},
    abort() {},
  };
  const office = await createNativeOffice({
    db,
    project: w.project,
    dataDir: w.root,
    token: "a".repeat(64),
    createRuntime: async () => live,
    ...extra,
  });
  t.after(async () => {
    await office.close();
    db.close();
  });
  return { ...w, db, office, calls };
}

test("the native engine runs on the lean schema: assign starts planning and decisions list", async (t) => {
  const f = await engine(t);
  insertAgent(f.db, "a1", "Alice");
  f.db
    .prepare("INSERT INTO tasks(id,title,status,agent_id) VALUES (?,?,'inbox','a1')")
    .run(ROOT_TASK, "Improve README");
  await f.office.assign(ROOT_TASK);
  assert.equal(f.calls.length, 1, "planning started once");
  const decisions = await f.office.currentDecisions();
  assert.ok(Array.isArray(decisions));
  assert.equal(decisions.length, 0);
  assert.equal(f.db.prepare("SELECT task_id FROM pazmo_intakes").get().task_id, ROOT_TASK);
  assert.equal(
    f.db.prepare("SELECT agent_id FROM tasks WHERE id=?").get(ROOT_TASK).agent_id,
    "a1",
    "the engine leaves the lean owner alone",
  );
  assert.deepEqual(
    f.db.prepare("PRAGMA foreign_key_check").all(),
    [],
    "every pazmo_* table's task reference resolves on the lean tasks table",
  );
  const references = (table) =>
    f.db.prepare(`PRAGMA foreign_key_list(${table})`).all().map((r) => `${r.table}.${r.to}`);
  for (const table of ["pazmo_intakes", "pazmo_native_dispatches", "pazmo_native_decisions", "pazmo_task_contracts"])
    assert.ok(references(table).includes("tasks.id"), `${table} references tasks(id)`);
});

test("lean agents have no department or role, so the engine maps no kit role to them", async (t) => {
  const f = await engine(t);
  insertAgent(f.db, "a1", "Alice");
  assert.deepEqual(f.office.officeRoles(), {
    roles: { pm: null, lead: null, engineer: null, reviewer: null },
  });
});

test("the Story gate round-trips on the lean schema: messages, logs and decisions persist", async (t) => {
  const f = await engine(t);
  f.db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,'inbox')").run(ROOT_TASK, "Update README");
  await f.office.assign(ROOT_TASK);
  const { continuePlanning } = await import("../src/runners/planning.ts");
  const i = f.office.ledgers.intake.get(ROOT_TASK),
    packet = f.office.ledgers.intake.packet(ROOT_TASK, i.revision, i.inputDigest);
  const story = {
    title: "README",
    goal: "Clarify execution",
    domain: "Documentation",
    must: ["Show actual command"],
    should: [],
    out: ["Runtime changes"],
    assumptions: [],
    verify: [{ must: [1], scenario: "Command matches CLI" }],
  };
  f.office.ledgers.intake.acceptKit(
    ROOT_TASK,
    i.revision,
    i.inputDigest,
    { kind: "lead", packet: continuePlanning(packet, story, "lead") },
    { runId: "test", runFile: "test", nodeId: "requirements", action: "role-complete", revisionToken: "test" },
  );
  await f.office.refresh();
  const [decision] = await f.office.currentDecisions();
  assert.ok(decision);
  assert.equal(decision.decision_kind, "story");
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=?").get(ROOT_TASK).n >= 2);
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM task_logs WHERE task_id=?").get(ROOT_TASK).n >= 2);
  await f.office.reply(decision.id, 1, "README 실행 안내만 수정하는 범위를 승인합니다.");
  assert.equal(f.calls.length, 2, "approval starts the next planning step");
  assert.equal((await f.office.currentDecisions()).length, 0);
});

test("published subtasks link to their request through source_task_id", async (t) => {
  const f = await engine(t);
  f.db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,'inbox')").run(ROOT_TASK, "Update README");
  await f.office.assign(ROOT_TASK);
  // The engine publishes children through its own INSERT (no lean columns), then links them.
  f.db
    .prepare("INSERT INTO tasks (id,title,project_path,status) VALUES (?,?,?,'inbox')")
    .run(CHILD_TASK, "Child", f.project);
  f.db
    .prepare("UPDATE tasks SET project_id=?,source_task_id=? WHERE id=?")
    .run(null, ROOT_TASK, CHILD_TASK);
  assert.equal(f.db.prepare("SELECT agent_id,risk FROM tasks WHERE id=?").get(CHILD_TASK).agent_id, null);
  f.db
    .prepare(
      "INSERT INTO pazmo_runner_runs (task_id,role,runner,version,sha256,model,reasoning,at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(CHILD_TASK, "engineer", "codex", "1.0.0", "b".repeat(64), "gpt-5.5", null, 1);
  assert.deepEqual(
    f.office.runnerRuns(ROOT_TASK).runs.map((r) => r.taskId),
    [CHILD_TASK],
  );
});

test("a hub snapshot reads agent names from the lean agents table", async (t) => {
  const f = await engine(t);
  insertAgent(f.db, "a1", "Alice");
  f.db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,'in_progress')").run(ROOT_TASK, "README");
  f.db
    .prepare(
      "INSERT INTO messages(id,sender_type,sender_id,receiver_type,content,task_id,created_at) VALUES ('m1','agent','a1','all','정리했습니다',?,1)",
    )
    .run(ROOT_TASK);
  const office = {
    progress: () => ({ message: "진행 중", childTaskIds: [] }),
    decisions: () => [],
    diff: () => null,
    runnerRuns: () => ({ runs: [] }),
  };
  const snapshot = hubSnapshot(f.db, office, ROOT_TASK);
  assert.deepEqual(
    snapshot.conversation.map((m) => [m.who, m.text]),
    [["Alice", "정리했습니다"]],
  );
});
