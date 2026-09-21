import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { OfficeError, fail } from "../cli/project.ts";
import { transaction } from "./approvals.ts";
import type { OfficeStore } from "./store.ts";
import {
  beginPlanning,
  acceptPlanning,
  answerPlanning,
} from "../runners/planning.ts";
import type { PlanningPacket } from "../runners/planning.ts";
type Result = ReturnType<typeof acceptPlanning>;
type State =
  | "waiting_pm"
  | "waiting_lead"
  | "awaiting_answer"
  | "proposal"
  | "human_required"
  | "cancelled";
type Row = {
  task_id: string;
  revision: number;
  state: State;
  packet_json: string;
  result_json: string | null;
  reason: string | null;
  task_status: string;
};

/** Draft conversations share the Office queue, but cannot grant a contract or approval. */
export class IntakeLedger {
  #db: DatabaseSync;
  #store: OfficeStore;
  #project: string;
  constructor(db: DatabaseSync, store: OfficeStore, project: string) {
    this.#db = db;
    this.#store = store;
    this.#project = project;
    db.exec(`CREATE TABLE IF NOT EXISTS pazmo_intakes (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id), revision INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('waiting_pm','waiting_lead','awaiting_answer','proposal','human_required','cancelled')),
      packet_json TEXT NOT NULL,result_json TEXT,reason TEXT
    );
    CREATE TABLE IF NOT EXISTS pazmo_intake_events (
      task_id TEXT NOT NULL REFERENCES pazmo_intakes(task_id), revision INTEGER NOT NULL,
      actor TEXT NOT NULL CHECK(actor IN ('human','pm','lead','controller')),
      payload_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(task_id,revision)
    );`);
  }
  #row(id: string): Row {
    const row = this.#db
      .prepare(
        `SELECT i.*,t.status AS task_status FROM pazmo_intakes i JOIN tasks t ON t.id=i.task_id WHERE i.task_id=? AND t.project_path=?`,
      )
      .get(id, this.#project) as Row | undefined;
    if (!row) fail("NOT_FOUND", "Office intake not found.");
    return row;
  }
  #match(id: string, revision: number, inputDigest: string) {
    const row = this.#row(id),
      packet = JSON.parse(row.packet_json) as PlanningPacket;
    if (row.revision !== revision || packet.inputDigest !== inputDigest)
      fail(
        "STALE_INTAKE",
        "Read the latest conversation before submitting this response.",
      );
    if (row.task_status !== "inbox")
      fail("INTAKE_STATE", "This task no longer accepts planning updates.");
    return { row, packet };
  }
  #event(id: string, revision: number, actor: string, payload: unknown) {
    this.#db
      .prepare("INSERT INTO pazmo_intake_events VALUES (?,?,?,?,?)")
      .run(id, revision, actor, JSON.stringify(payload), Date.now());
  }
  #advance(
    row: Row,
    packet: PlanningPacket,
    state: State,
    result: Result | null,
    actor: string,
    payload: unknown,
    reason: string | null = null,
  ) {
    const changed = this.#db
      .prepare(
        "UPDATE pazmo_intakes SET revision=revision+1,state=?,packet_json=?,result_json=?,reason=? WHERE task_id=? AND revision=?",
      )
      .run(
        state,
        JSON.stringify(packet),
        result ? JSON.stringify(result) : null,
        reason,
        row.task_id,
        row.revision,
      );
    if (changed.changes !== 1)
      fail("STALE_INTAKE", "The conversation has advanced.");
    this.#db
      .prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?")
      .run(
        state === "cancelled" ? "cancelled" : "inbox",
        Date.now(),
        row.task_id,
      );
    this.#event(row.task_id, row.revision + 1, actor, payload);
    return this.get(row.task_id);
  }
  get(id: string) {
    const row = this.#row(id),
      packet = JSON.parse(row.packet_json) as PlanningPacket;
    const result = row.result_json
      ? (JSON.parse(row.result_json) as Result)
      : null;
    return {
      taskId: id,
      revision: row.revision,
      state: row.state,
      inputDigest: packet.inputDigest,
      request: packet.request,
      risk: packet.risk,
      reason: row.reason,
      questions: result?.kind === "questions" ? result.questions : null,
      proposal: result?.kind === "proposal" ? result : null,
      events: (
        this.#db
          .prepare(
            "SELECT revision,actor,payload_json,created_at FROM pazmo_intake_events WHERE task_id=? ORDER BY revision",
          )
          .all(id) as {
          revision: number;
          actor: string;
          payload_json: string;
          created_at: number;
        }[]
      ).map(({ payload_json, ...event }) => ({
        ...event,
        payload: JSON.parse(payload_json),
      })),
      execution: "locked" as const,
    };
  }
  create(token: string, request: string, risk: "normal" | "high") {
    this.#store.authorize(token);
    const id = randomUUID(),
      packet = beginPlanning(id, request, risk);
    return transaction(this.#db, () => {
      this.#db
        .prepare(
          "INSERT INTO tasks (id,title,project_path,status) VALUES (?,?,?,'inbox')",
        )
        .run(
          id,
          request.trim().replace(/\s+/g, " ").slice(0, 120),
          this.#project,
        );
      this.#db
        .prepare(
          "INSERT INTO pazmo_intakes VALUES (?,1,'waiting_pm',?,NULL,NULL)",
        )
        .run(id, JSON.stringify(packet));
      this.#event(id, 1, "human", { request, risk });
      return this.get(id);
    });
  }
  /** Only the controller receives executable packets; no public result-submission API. */
  packet(id: string, revision: number, inputDigest: string) {
    const { row, packet } = this.#match(id, revision, inputDigest);
    if (!["waiting_pm", "waiting_lead"].includes(row.state))
      fail("INTAKE_STATE", "No planning role is pending.");
    return packet;
  }
  accept(
    id: string,
    revision: number,
    inputDigest: string,
    observation: Parameters<typeof acceptPlanning>[1],
  ) {
    return transaction(this.#db, () => {
      const { row, packet } = this.#match(id, revision, inputDigest);
      if (!["waiting_pm", "waiting_lead"].includes(row.state))
        fail("INTAKE_STATE", "No planning role is pending.");
      let result: Result;
      try {
        result = acceptPlanning(packet, observation);
      } catch (error) {
        if (
          !(error instanceof OfficeError) ||
          error.code !== "PLANNING_INVALID"
        )
          throw error;
        return this.#advance(
          row,
          packet,
          "human_required",
          null,
          "controller",
          { error: error.code },
          error.code,
        );
      }
      if (result.kind === "lead")
        return this.#advance(row, result.packet, "waiting_lead", null, "pm", {
          kind: "requirements",
          story: result.packet.story,
        });
      return this.#advance(
        row,
        packet,
        result.kind === "questions" ? "awaiting_answer" : "proposal",
        result,
        packet.role,
        result,
      );
    });
  }
  answer(
    token: string,
    id: string,
    revision: number,
    inputDigest: string,
    answers: unknown,
  ) {
    this.#store.authorize(token);
    return transaction(this.#db, () => {
      const { row, packet } = this.#match(id, revision, inputDigest);
      const result = row.result_json
        ? (JSON.parse(row.result_json) as Result)
        : null;
      if (row.state !== "awaiting_answer" || result?.kind !== "questions")
        fail("INTAKE_STATE", "This conversation is not awaiting answers.");
      const next = answerPlanning(packet, result, answers);
      return this.#advance(row, next, "waiting_pm", null, "human", {
        answers: next.dialogue.at(-1)!.answers,
      });
    });
  }
  cancel(token: string, id: string, revision: number, inputDigest: string) {
    this.#store.authorize(token);
    return transaction(this.#db, () => {
      const { row, packet } = this.#match(id, revision, inputDigest);
      return this.#advance(row, packet, "cancelled", null, "human", {
        cancelled: true,
      });
    });
  }
}
