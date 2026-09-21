import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { ApprovalLedger, transaction } from "./approvals.ts";
import type { ApprovalAnswer, Gate } from "./approvals.ts";
import {
  contractMatches,
  contractDocuments,
  readContract,
} from "./contracts.ts";
import type { Contract, ContractInput } from "./contracts.ts";
import { digest } from "./candidates.ts";

type Row = {
  id: string;
  revision: number;
  contract_json: string;
  status: string;
};
export class OfficeStore {
  #db: DatabaseSync;
  #project: string;
  #ledger: ApprovalLedger;
  constructor(db: DatabaseSync, project: string, token: string) {
    this.#db = db;
    this.#project = project;
    this.#ledger = new ApprovalLedger(db, token);
    db.exec(`
      CREATE TABLE IF NOT EXISTS pazmo_task_contracts (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id), revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pazmo_contract_revisions (
        task_id TEXT NOT NULL REFERENCES tasks(id), revision INTEGER NOT NULL,
        contract_json TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(task_id,revision)
      );
      CREATE TABLE IF NOT EXISTS pazmo_gate_requests (
        challenge_id TEXT PRIMARY KEY REFERENCES pazmo_approval_challenges(id),
        task_id TEXT NOT NULL, revision INTEGER NOT NULL, gate TEXT NOT NULL,
        FOREIGN KEY(task_id,revision) REFERENCES pazmo_contract_revisions(task_id,revision)
      );
    `);
  }
  authorize(token: string): void {
    this.#ledger.authorize(token);
  }
  #row(id: string): Row {
    const row = this.#db
      .prepare(
        `SELECT t.id,t.status,c.revision,r.contract_json FROM tasks t
      JOIN pazmo_task_contracts c ON c.task_id=t.id
      JOIN pazmo_contract_revisions r ON r.task_id=t.id AND r.revision=c.revision WHERE t.id=?`,
      )
      .get(id) as Row | undefined;
    if (!row) return fail("NOT_FOUND", "Office contract not found.");
    return row;
  }
  #subject(row: Row, contract: Contract, gate: Gate): string {
    return digest(
      JSON.stringify({
        project: this.#project,
        task: row.id,
        revision: row.revision,
        gate,
        contract: contract.digest,
      }),
    );
  }
  get(id: string) {
    const row = this.#row(id),
      contract = JSON.parse(row.contract_json) as Contract;
    const current = contractMatches(this.#project, contract);
    const approved = {
      G1: this.#ledger.has("G1", this.#subject(row, contract, "G1")),
      G3: this.#ledger.has("G3", this.#subject(row, contract, "G3")),
    };
    const blocker = !current
      ? "CONTRACT_CHANGED"
      : !approved.G1
        ? "G1_REQUIRED"
        : contract.input.risk === "high" && !approved.G3
          ? "G3_REQUIRED"
          : null;
    return {
      id,
      revision: row.revision,
      status: row.status,
      contract,
      approved,
      ready: blocker === null,
      blocker,
      execution: "locked",
      export: "disabled",
    };
  }
  list() {
    return (
      this.#db
        .prepare("SELECT task_id FROM pazmo_task_contracts ORDER BY task_id")
        .all() as { task_id: string }[]
    ).map((row) => this.get(row.task_id));
  }
  /** Controller-internal role input. No operator token or host path is returned. */
  roleContext(id: string) {
    const item = this.get(id);
    if (!item.ready)
      fail(
        "CONTRACT_NOT_READY",
        "Approve the current contract before dispatch.",
      );
    return { item, documents: contractDocuments(this.#project, item.contract) };
  }
  /** Controller-owned cancellation, not an unauthenticated HTTP endpoint. */
  cancelExecution(id: string) {
    this.get(id);
    this.#db
      .prepare(
        "UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND status!='done'",
      )
      .run(Date.now(), id);
  }
  async register(token: string, input: ContractInput, taskId?: string) {
    this.authorize(token);
    const contract = await readContract(this.#project, input);
    return transaction(this.#db, () => {
      if (!contractMatches(this.#project, contract))
        fail("CONTRACT_CHANGED", "Contract changed before registration.");
      const existing = taskId ? this.#row(taskId) : undefined;
      if (
        existing &&
        !["inbox", "planned", "pending"].includes(existing.status)
      )
        fail(
          "TASK_ACTIVE",
          "An active or completed task contract cannot be replaced.",
        );
      if (
        existing &&
        (JSON.parse(existing.contract_json) as Contract).digest ===
          contract.digest
      )
        return this.get(existing.id);
      const id = existing?.id ?? randomUUID(),
        revision = (existing?.revision ?? 0) + 1;
      if (!existing)
        this.#db
          .prepare(
            "INSERT INTO tasks (id,title,project_path,status) VALUES (?,?,?,'inbox')",
          )
          .run(id, contract.title, this.#project);
      else
        this.#db
          .prepare(
            "UPDATE tasks SET title=?,status='inbox',updated_at=? WHERE id=?",
          )
          .run(contract.title, Date.now(), id);
      this.#db
        .prepare("INSERT INTO pazmo_contract_revisions VALUES (?,?,?,?)")
        .run(id, revision, JSON.stringify(contract), Date.now());
      this.#db
        .prepare(
          `INSERT INTO pazmo_task_contracts VALUES (?,?) ON CONFLICT(task_id) DO UPDATE SET revision=excluded.revision`,
        )
        .run(id, revision);
      return this.get(id);
    });
  }
  requestApproval(token: string, id: string, gate: Gate) {
    this.authorize(token);
    if (gate === "G4")
      fail(
        "EVIDENCE_REQUIRED",
        "G4 requires a verified candidate; execution is currently locked.",
      );
    return transaction(this.#db, () => {
      const row = this.#row(id),
        contract = JSON.parse(row.contract_json) as Contract;
      if (!contractMatches(this.#project, contract))
        fail(
          "CONTRACT_CHANGED",
          "Refresh the changed contract before approval.",
        );
      const challenge = this.#ledger.issue(
        token,
        gate,
        this.#subject(row, contract, gate),
      );
      this.#db
        .prepare("INSERT INTO pazmo_gate_requests VALUES (?,?,?,?)")
        .run(challenge.id, id, row.revision, gate);
      return { ...challenge, taskId: id, revision: row.revision, contract };
    });
  }
  decide(token: string, challengeId: string, answer: ApprovalAnswer) {
    this.authorize(token);
    return transaction(this.#db, () => {
      const request = this.#db
        .prepare(
          "SELECT task_id,revision FROM pazmo_gate_requests WHERE challenge_id=?",
        )
        .get(challengeId) as { task_id: string; revision: number } | undefined;
      if (!request) return fail("NOT_FOUND", "Approval request not found.");
      const item = this.get(request.task_id);
      if (item.revision !== request.revision)
        fail("STALE_APPROVAL", "The task has a newer contract revision.");
      if (item.blocker === "CONTRACT_CHANGED")
        fail(
          "CONTRACT_CHANGED",
          "Contract changed after the approval request.",
        );
      if (!["inbox", "planned", "pending"].includes(item.status))
        fail("TASK_ACTIVE", "Task is no longer awaiting contract approval.");
      this.#ledger.decide(token, challengeId, answer);
      const updated = this.get(item.id);
      this.#db
        .prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?")
        .run(updated.ready ? "planned" : "inbox", Date.now(), item.id);
      return this.get(item.id);
    });
  }
}
