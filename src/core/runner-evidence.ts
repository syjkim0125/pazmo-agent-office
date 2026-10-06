import type { DatabaseSync } from "node:sqlite";

export type RunnerRun = {
  taskId: string;
  role: string;
  runner: string;
  version: string;
  sha256: string;
  model: string;
  reasoning: string | null;
};

/** Append-only identity of the CLI that served each role run. */
export class RunnerEvidence {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.#db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS pazmo_runner_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, role TEXT NOT NULL,
      runner TEXT NOT NULL, version TEXT NOT NULL, sha256 TEXT NOT NULL,
      model TEXT NOT NULL, reasoning TEXT, at INTEGER NOT NULL)`);
  }
  record(r: RunnerRun) {
    this.#db
      .prepare(
        "INSERT INTO pazmo_runner_runs (task_id,role,runner,version,sha256,model,reasoning,at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(r.taskId, r.role, r.runner, r.version, r.sha256, r.model, r.reasoning, Date.now());
  }
  /** Runs for a report: the request itself and the subtasks published from it. */
  forRequest(rootId: string) {
    // Subtask links come from a later claw migration; older schemas have none.
    const linked = (this.#db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).some(
      (c) => c.name === "source_task_id",
    );
    if (!linked) return this.list(rootId);
    return this.#db
      .prepare(
        `SELECT task_id AS taskId, role, runner, version, sha256, model, reasoning, at FROM pazmo_runner_runs
         WHERE task_id=? OR task_id IN (SELECT id FROM tasks WHERE source_task_id=?) ORDER BY id`,
      )
      .all(rootId, rootId) as (RunnerRun & { at: number })[];
  }
  list(taskId: string) {
    return this.#db
      .prepare(
        "SELECT task_id AS taskId, role, runner, version, sha256, model, reasoning, at FROM pazmo_runner_runs WHERE task_id=? ORDER BY id",
      )
      .all(taskId) as (RunnerRun & { at: number })[];
  }
}
