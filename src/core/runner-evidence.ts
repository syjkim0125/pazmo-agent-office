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
  list(taskId: string) {
    return this.#db
      .prepare(
        "SELECT task_id AS taskId, role, runner, version, sha256, model, reasoning, at FROM pazmo_runner_runs WHERE task_id=? ORDER BY id",
      )
      .all(taskId) as (RunnerRun & { at: number })[];
  }
}
