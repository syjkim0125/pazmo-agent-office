import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { OfficeError, fail, noSymlinks } from "../cli/project.ts";
import { transaction } from "./approvals.ts";
import type { OfficeStore } from "./store.ts";
import { digest } from "./candidates.ts";
import {
  beginPlanning,
  acceptPlanning,
  answerPlanning,
} from "../runners/planning.ts";
import type { PlanningPacket } from "../runners/planning.ts";
type Result = ReturnType<typeof acceptPlanning>;
type Publication = {
  directory: string;
  sourceRevision: number;
  inputDigest: string;
  taskIds: string[];
  documents: { path: string; digest: string }[];
  createdAt: number;
};
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

/** Conversations share the Office queue; publication registers drafts without approval. */
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
    );
    CREATE TABLE IF NOT EXISTS pazmo_intake_publications (
      task_id TEXT PRIMARY KEY REFERENCES pazmo_intakes(task_id), receipt_json TEXT NOT NULL
    );`);
  }
  #publication(id: string): Publication | null {
    const row = this.#db
      .prepare(
        "SELECT receipt_json FROM pazmo_intake_publications WHERE task_id=?",
      )
      .get(id) as { receipt_json: string } | undefined;
    return row ? (JSON.parse(row.receipt_json) as Publication) : null;
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
    if (row.task_status !== "inbox" || this.#publication(id))
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
    const publication = this.#publication(id);
    return {
      taskId: id,
      revision: row.revision,
      state: publication ? ("registered" as const) : row.state,
      inputDigest: packet.inputDigest,
      request: packet.request,
      risk: packet.risk,
      reason: row.reason,
      questions: result?.kind === "questions" ? result.questions : null,
      proposal: result?.kind === "proposal" ? result : null,
      publication,
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
  async publish(
    token: string,
    id: string,
    revision: number,
    inputDigest: string,
  ) {
    this.#store.authorize(token);
    if (this.#db.isTransaction)
      fail("TRANSACTION_ACTIVE", "Publication must own its commit boundary.");
    this.#row(id);
    const prior = this.#publication(id);
    if (
      prior &&
      prior.sourceRevision === revision &&
      prior.inputDigest === inputDigest
    )
      return this.get(id);
    const { row } = this.#match(id, revision, inputDigest);
    const result = row.result_json
      ? (JSON.parse(row.result_json) as Result)
      : null;
    if (row.state !== "proposal" || result?.kind !== "proposal")
      fail("INTAKE_STATE", "Only a saved Lead proposal can be published.");

    // A fresh exclusive directory is never adopted or overwritten on retry.
    noSymlinks(this.#project);
    const directory = basename(
      mkdtempSync(join(this.#project, "office-plan-")),
    );
    const documents: Publication["documents"] = [];
    try {
      for (const [name, content] of Object.entries(result.files)) {
        if (
          !/^(story|plan|decision|task-[1-8])\.md$|^verify-[1-8]\.json$/.test(
            name,
          )
        )
          fail("PLANNING_INVALID", "Unexpected proposal document name.");
        const text = /^task-[1-8]\.md$/.test(name)
          ? content
              .replace(/^Story: story\.md$/m, `Story: ${directory}/story.md`)
              .replace(
                /^Plan source: plan\.md$/m,
                `Plan source: ${directory}/plan.md`,
              )
          : content;
        const path = join(this.#project, directory, name);
        noSymlinks(path);
        writeFileSync(path, text, { flag: "wx", mode: 0o600 });
        documents.push({ path: `${directory}/${name}`, digest: digest(text) });
      }
      const inputs = result.contracts.map((input) => ({
        ...input,
        story: `${directory}/${input.story}`,
        task: `${directory}/${input.task}`,
        verification: `${directory}/${input.verification}`,
        plan: `${directory}/${input.plan}`,
        decision: input.decision ? `${directory}/${input.decision}` : null,
      }));
      await this.#store.registerBatch(token, inputs, (items) => {
        const current = this.#match(id, revision, inputDigest);
        if (
          items.some((item) =>
            item.contract.files.some(
              (file) =>
                !documents.some(
                  (document) =>
                    document.path === file.path &&
                    document.digest === file.digest,
                ),
            ),
          )
        )
          fail(
            "CONTRACT_CHANGED",
            "Published documents differ from the saved proposal.",
          );
        const receipt: Publication = {
          directory,
          sourceRevision: revision,
          inputDigest,
          taskIds: items.map((item) => item.id),
          documents,
          createdAt: Date.now(),
        };
        this.#db
          .prepare("INSERT INTO pazmo_intake_publications VALUES (?,?)")
          .run(id, JSON.stringify(receipt));
        this.#advance(
          current.row,
          current.packet,
          "proposal",
          result,
          "human",
          { published: receipt },
        );
        this.#db
          .prepare("UPDATE tasks SET status='planned',updated_at=? WHERE id=?")
          .run(Date.now(), id);
        return undefined;
      });
    } catch (error) {
      // Files and SQLite are separate resources. Preserve failed attempts, including user edits.
      throw new OfficeError(
        error instanceof OfficeError ? error.code : "PUBLICATION_FAILED",
        `${error instanceof Error ? error.message : String(error)} Unregistered documents are preserved at ${directory}; do not treat them as approved work.`,
      );
    }
    return this.get(id);
  }
}
