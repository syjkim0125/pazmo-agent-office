import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { OfficeError, fail } from "../cli/project.ts";
import { transaction } from "../core/approvals.ts";
import { defaultRunnerChoice, validateRunnerChoice } from "../runtime/runner-settings.ts";
import type { RunnerCatalog, RunnerChoice } from "../runtime/runner-settings.ts";

export type LeanAgent = {
  id: string;
  name: string;
  work: RunnerChoice;
  review: RunnerChoice;
  /** A root task of this agent is neither done nor cancelled. */
  busy: boolean;
  createdAt: number;
};
/** What a request carries for a runner; a missing model means the CLI's preferred one. */
export type RunnerInput = { runner: string; model?: string | null; effort?: string | null };

type Row = {
  id: string;
  name: string;
  work_runner: RunnerChoice["runner"];
  work_model: string;
  work_effort: string | null;
  review_runner: RunnerChoice["runner"];
  review_model: string;
  review_effort: string | null;
  busy: number;
  created_at: number;
};

const NAME_LIMIT = 40;
const DEFAULT_NAME = "기본 agent";
const SELECT = `SELECT a.*, EXISTS(
    SELECT 1 FROM tasks t
    WHERE t.agent_id=a.id AND t.source_task_id IS NULL AND t.status NOT IN ('done','cancelled')
  ) AS busy FROM agents a`;

function leanAgent(row: Row): LeanAgent {
  return {
    id: row.id,
    name: row.name,
    work: { runner: row.work_runner, model: row.work_model, reasoning: row.work_effort },
    review: { runner: row.review_runner, model: row.review_model, reasoning: row.review_effort },
    busy: row.busy === 1,
    createdAt: row.created_at,
  };
}
function nameOf(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || Array.from(name).length > NAME_LIMIT)
    fail("AGENT_NAME_INVALID", `이름은 공백을 뺀 1–${NAME_LIMIT}자여야 합니다.`);
  return name;
}
function shape(value: unknown, field: string): RunnerInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_REQUEST", `${field} 실행기를 {runner, model, effort} 형태로 보내주세요.`);
  return value as RunnerInput;
}

/** The lean Office's agents: a name and the runner each of its two jobs uses. */
export class LeanAgents {
  #db: DatabaseSync;
  #load: () => Promise<RunnerCatalog>;
  constructor(db: DatabaseSync, load: () => Promise<RunnerCatalog>) {
    this.#db = db;
    this.#load = load;
  }
  list(): LeanAgent[] {
    return (this.#db.prepare(`${SELECT} ORDER BY a.created_at, a.rowid`).all() as Row[]).map(leanAgent);
  }
  #get(id: string): LeanAgent | undefined {
    const row = this.#db.prepare(`${SELECT} WHERE a.id=?`).get(id) as Row | undefined;
    return row && leanAgent(row);
  }
  #require(id: string): LeanAgent {
    return this.#get(id) ?? fail("NOT_FOUND", "Agent not found.");
  }
  /** The runner a request names, checked the way an agent save checks it. */
  #choice(catalog: RunnerCatalog, input: unknown, field: string): RunnerChoice {
    const { runner, model, effort } = shape(input, field);
    return validateRunnerChoice(catalog, { runner, model: model ?? null, effort: effort ?? null });
  }
  /** Same name ignoring case; `except` lets an agent keep its own name. */
  #assertFree(name: string, except?: string) {
    const lower = name.toLowerCase();
    for (const row of this.#db.prepare("SELECT id,name FROM agents").all() as { id: string; name: string }[])
      if (row.id !== except && row.name.toLowerCase() === lower)
        fail("AGENT_NAME_TAKEN", "같은 이름의 agent가 이미 있습니다.");
  }
  #insert(id: string, name: string, work: RunnerChoice, review: RunnerChoice) {
    this.#db
      .prepare(
        `INSERT INTO agents(id,name,work_runner,work_model,work_effort,review_runner,review_model,review_effort,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, name, work.runner, work.model, work.reasoning, review.runner, review.model, review.reasoning, Date.now());
  }

  /** The first start needs an agent before any task. It must not fail because
   * no CLI is ready or a model list is empty: the default is only the usual
   * runner, and task creation checks `runnersReady` later. */
  async ensureDefault(): Promise<LeanAgent> {
    const existing = this.list()[0];
    if (existing) return existing;
    let catalog: RunnerCatalog | undefined;
    try {
      catalog = await this.#load();
    } catch {
      // The usual default needs no catalog; task creation re-checks readiness.
    }
    // Another call may have created it while discovery ran.
    const raced = this.list()[0];
    if (raced) return raced;
    const choice = defaultRunnerChoice(catalog);
    const id = randomUUID();
    this.#insert(id, DEFAULT_NAME, choice, { ...choice });
    return this.#require(id);
  }

  async create(input: { name: string; work: RunnerInput; review: RunnerInput }): Promise<LeanAgent> {
    const name = nameOf(input?.name);
    const catalog = await this.#load();
    const work = this.#choice(catalog, input.work, "작업");
    const review = this.#choice(catalog, input.review, "리뷰");
    const id = randomUUID();
    transaction(this.#db, () => {
      this.#assertFree(name);
      this.#insert(id, name, work, review);
    });
    return this.#require(id);
  }

  /** Changes only what the patch names: a new `work` leaves `review` as it was. */
  async update(
    id: string,
    patch: { name?: string; work?: RunnerInput; review?: RunnerInput },
  ): Promise<LeanAgent> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      fail("INVALID_REQUEST", "변경할 내용을 객체로 보내주세요.");
    this.#require(id);
    const name = patch.name === undefined ? undefined : nameOf(patch.name);
    let work: RunnerChoice | undefined, review: RunnerChoice | undefined;
    if (patch.work !== undefined || patch.review !== undefined) {
      const catalog = await this.#load();
      if (patch.work !== undefined) work = this.#choice(catalog, patch.work, "작업");
      if (patch.review !== undefined) review = this.#choice(catalog, patch.review, "리뷰");
    }
    transaction(this.#db, () => {
      // Removed while discovery ran: say so rather than updating nothing.
      this.#require(id);
      if (name !== undefined) {
        this.#assertFree(name, id);
        this.#db.prepare("UPDATE agents SET name=? WHERE id=?").run(name, id);
      }
      if (work)
        this.#db
          .prepare("UPDATE agents SET work_runner=?,work_model=?,work_effort=? WHERE id=?")
          .run(work.runner, work.model, work.reasoning, id);
      if (review)
        this.#db
          .prepare("UPDATE agents SET review_runner=?,review_model=?,review_effort=? WHERE id=?")
          .run(review.runner, review.model, review.reasoning, id);
    });
    return this.#require(id);
  }

  /** Refuses an agent with unfinished work first, then the last agent. Its
   * finished tasks stay, with no owner. */
  remove(id: string): void {
    transaction(this.#db, () => {
      const agent = this.#require(id);
      if (agent.busy) fail("AGENT_BUSY", "진행 중인 작업이 있습니다.");
      const { count } = this.#db.prepare("SELECT COUNT(*) AS count FROM agents").get() as { count: number };
      if (count <= 1) fail("LAST_AGENT", "마지막 agent는 삭제할 수 없습니다.");
      this.#db.prepare("DELETE FROM agents WHERE id=?").run(id);
    });
  }

  /** Whether both stored runners pass today's discovery. A CLI that logged out
   * or a model that left the list makes this false; it never throws for that. */
  async runnersReady(id: string): Promise<boolean> {
    const agent = this.#require(id);
    let catalog: RunnerCatalog;
    try {
      catalog = await this.#load();
    } catch {
      return false;
    }
    try {
      for (const { runner, model, reasoning } of [agent.work, agent.review])
        validateRunnerChoice(catalog, { runner, model, effort: reasoning });
      return true;
    } catch (error) {
      if (error instanceof OfficeError) return false;
      throw error;
    }
  }
}
