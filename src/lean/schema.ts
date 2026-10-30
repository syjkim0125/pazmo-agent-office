import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fail, noSymlinks } from "../cli/project.ts";

/**
 * The lean Office's own database. It gives the native engine (`createNativeOffice`)
 * the Claw-shaped tables it reads and writes, and nothing else of Claw's: each
 * column below is one the engine's SQL touches (src/runtime/native-office.ts,
 * src/core/*, src/runtime/hub-*.ts, src/runtime/runner-*.ts), plus the lean
 * columns `tasks.agent_id`, `tasks.risk` and the agents' runner choices. The
 * engine creates its own `pazmo_*` tables on first use; their `REFERENCES
 * tasks(id)` resolve on `tasks` below.
 */
const SCHEMA = `
CREATE TABLE lean_instance (project TEXT NOT NULL);

-- department_id and role stay NULL for lean agents: the engine looks agents up by
-- them (agent(role)), so a lean agent is never mistaken for a kit role.
-- name_ko is only read by hub-snapshot.ts (COALESCE(NULLIF(a.name_ko,''),a.name)).
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ko TEXT NOT NULL DEFAULT '',
  department_id TEXT,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','working','break','offline')),
  current_task_id TEXT,
  work_runner TEXT NOT NULL CHECK(work_runner IN ('codex','claude')),
  work_model TEXT NOT NULL,
  work_effort TEXT,
  review_runner TEXT NOT NULL CHECK(review_runner IN ('codex','claude')),
  review_model TEXT NOT NULL,
  review_effort TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE UNIQUE INDEX agents_name_unique ON agents(lower(name));

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL
);

-- A finished task outlives its agent: both agent references clear on removal.
-- The engine's own inserts (subtasks) set neither lean column; both have defaults
-- or allow NULL.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id),
  source_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox','planned','collaborating','in_progress','review','done','cancelled','pending')),
  project_path TEXT,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000),
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  risk TEXT NOT NULL DEFAULT 'normal' CHECK(risk IN ('normal','high'))
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('ceo','agent','system')),
  sender_id TEXT,
  receiver_type TEXT NOT NULL CHECK(receiver_type IN ('agent','department','all')),
  receiver_id TEXT,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'chat' CHECK(message_type IN ('chat','task_assign','announcement','directive','report','status_update')),
  task_id TEXT REFERENCES tasks(id),
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()*1000)
);
`;

/** Added after phase 1, so a file made before it gains it on open. `task_id`
 * reruns the stopped `previous_id`; a task is rerun once, and a new task that
 * is refused (and removed) takes its link with it. A rerun task itself is
 * never removed (it is cancelled), so `previous_id` needs no ON DELETE. */
const RERUNS = `
CREATE TABLE IF NOT EXISTS task_reruns (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  previous_id TEXT NOT NULL UNIQUE REFERENCES tasks(id)
);
`;

const SIDECARS = ["-wal", "-shm", "-journal"];

/** Creates the lean tables, owned by `project`, in an empty database: a new
 * file below, or an in-memory database in the engine tests. */
export function applyLeanSchema(db: DatabaseSync, project: string): void {
  db.exec(SCHEMA);
  db.prepare("INSERT INTO lean_instance (project) VALUES (?)").run(project);
  db.exec(RERUNS);
}

/** Creates or opens `<dataDir>/lean/office.sqlite` for one project. The file is
 * private (0600), never a symlink, and refuses to serve another project. */
export function openLeanDb(dataDir: string, project: string): DatabaseSync {
  const directory = join(dataDir, "lean"),
    file = join(directory, "office.sqlite");
  // Before creating anything: a symlinked directory must not be followed.
  noSymlinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  noSymlinks(file);
  for (const suffix of SIDECARS) noSymlinks(file + suffix);
  if (!existsSync(file)) {
    closeSync(openSync(file, "wx", 0o600));
    chmodSync(file, 0o600);
  }
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((row) => row.name);
    if (tables.includes("lean_instance")) {
      const owners = db.prepare("SELECT project FROM lean_instance").all() as { project: string }[];
      if (owners.length !== 1 || owners[0].project !== project)
        fail("DATA_MISMATCH", "Database does not belong to this Office project.");
      // A file made before reruns gains their table (applyLeanSchema adds it to new ones).
      db.exec(RERUNS);
    } else if (tables.length) {
      fail("DATA_MISMATCH", "File is not a lean Office database.");
    } else {
      db.exec("BEGIN IMMEDIATE");
      try {
        applyLeanSchema(db, project);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
