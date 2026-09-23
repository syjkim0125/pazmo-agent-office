import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { fail, noSymlinks } from "../cli/project.ts";
import { ApprovalLedger, transaction } from "./approvals.ts";
import type { ApprovalAnswer, Gate } from "./approvals.ts";
import {
  contractMatches,
  contractDocuments,
  readContract,
} from "./contracts.ts";
import type { Contract, ContractInput } from "./contracts.ts";
import { digest, readStable, validPath } from "./candidates.ts";

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
      CREATE TABLE IF NOT EXISTS pazmo_kit_assignments (
        task_id TEXT NOT NULL, revision INTEGER NOT NULL, assignment_id TEXT NOT NULL,
        role TEXT NOT NULL, run_file TEXT NOT NULL, target_revision TEXT NOT NULL,
        PRIMARY KEY(task_id,revision,assignment_id),
        FOREIGN KEY(task_id,revision) REFERENCES pazmo_contract_revisions(task_id,revision)
      );
      CREATE TABLE IF NOT EXISTS pazmo_kit_receipts (
        task_id TEXT NOT NULL, revision INTEGER NOT NULL, candidate_digest TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        PRIMARY KEY(task_id,revision,candidate_digest),
        FOREIGN KEY(task_id,revision) REFERENCES pazmo_contract_revisions(task_id,revision)
      );
    `);
  }
  authorize(token: string): void {
    this.#ledger.authorize(token);
  }
  /** Materialize a read-only input view, never a second approval decision.
   * The canonical bytes and SQLite approval stay authoritative at every dispatch.
   */
  kitSource(taskId: string): string {
    const { item, documents } = this.roleContext(taskId);
    if (item.status === "cancelled")
      fail("CONTRACT_NOT_READY", "Task was cancelled.");
    const approval = this.#db
      .prepare(
        "SELECT challenge_id,answer_json,accepted_at FROM pazmo_approvals WHERE gate='G1' AND subject=?",
      )
      .get(this.#subject(this.#row(taskId), item.contract, "G1")) as
      | { challenge_id: string; answer_json: string; accepted_at: number }
      | undefined;
    if (!approval)
      fail("G1_REQUIRED", "Kit requires the actual Office approval event.");
    const directory = `.pazmo-office/approved-contracts/${digest(`${taskId}:${item.revision}:${item.contract.digest}`)}`;
    noSymlinks(join(this.#project, directory));
    mkdirSync(join(this.#project, directory), { recursive: true, mode: 0o700 });
    const evidence = `${directory}/g1.json`,
      source = `${directory}/story.md`;
    const original = documents.find(
      (d) => d.path === item.contract.input.story,
    )!.content;
    const gate = `Understanding gate (G1): ${evidence} · ${new Date(approval.accepted_at).toISOString().slice(0, 10)} · Check-in: accepted`;
    const view = original
      .replace(/^Understanding gate \(G1\):.*\n?/gm, "")
      .replace(
        /^Status:.*$/m,
        `Status: Approved\n${gate}\nCanonical source: ${item.contract.input.story}\nOffice contract digest: ${item.contract.digest}\nApproval view: derived from the Office event; requirements remain owned by the canonical source.`,
      );
    for (const [path, content] of [
      [
        evidence,
        JSON.stringify({
          taskId,
          revision: item.revision,
          contractDigest: item.contract.digest,
          challengeId: approval.challenge_id,
          answer: JSON.parse(approval.answer_json),
          acceptedAt: approval.accepted_at,
        }),
      ],
      [source, view],
    ]) {
      noSymlinks(join(this.#project, path));
      try {
        writeFileSync(join(this.#project, path), content, {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (
          readStable(join(this.#project, path), 1024 * 1024).toString() !==
          content
        )
          fail(
            "KIT_SOURCE_CHANGED",
            "The immutable approval view changed; preserve and inspect it.",
          );
      }
    }
    return source;
  }
  bindKitRole(
    taskId: string,
    assignmentId: string,
    role: string,
    runFile: string,
    targetRevision: string,
  ) {
    const item = this.get(taskId);
    if (!item.ready || item.status === "cancelled")
      fail(
        "CONTRACT_NOT_READY",
        "Kit assignment requires the current approved contract.",
      );
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO pazmo_kit_assignments VALUES (?,?,?,?,?,?)",
      )
      .run(taskId, item.revision, assignmentId, role, runFile, targetRevision);
    const prior = this.#db
      .prepare(
        "SELECT * FROM pazmo_kit_assignments WHERE task_id=? AND revision=? AND assignment_id=?",
      )
      .get(taskId, item.revision, assignmentId);
    if (
      prior?.role !== role ||
      prior?.run_file !== runFile ||
      prior?.target_revision !== targetRevision
    )
      fail("ASSIGNMENT_CHANGED", "Office assignment cannot be rebound.");
  }
  kitAssignments(taskId: string) {
    const item = this.get(taskId);
    return this.#db
      .prepare(
        "SELECT assignment_id,role,run_file,target_revision FROM pazmo_kit_assignments WHERE task_id=? AND revision=? ORDER BY rowid",
      )
      .all(taskId, item.revision) as {
      assignment_id: string;
      role: string;
      run_file: string;
      target_revision: string;
    }[];
  }
  recordKitReceipt(
    taskId: string,
    candidateDigest: string,
    files: { path: string; digest: string }[],
  ) {
    const item = this.get(taskId);
    if (
      !item.ready ||
      item.status === "cancelled" ||
      !this.kitAssignments(taskId).length
    )
      fail(
        "KIT_EVIDENCE_REQUIRED",
        "Current Office kit assignment is required.",
      );
    const proof = JSON.stringify(files);
    this.#db
      .prepare("INSERT OR IGNORE INTO pazmo_kit_receipts VALUES (?,?,?,?)")
      .run(taskId, item.revision, candidateDigest, proof);
    if (this.kitReceipt(taskId, candidateDigest) !== digest(proof))
      fail(
        "KIT_EVIDENCE_CHANGED",
        "Kit completion evidence cannot be replaced.",
      );
  }
  kitReceipt(taskId: string, candidateDigest: string): string | null {
    const item = this.get(taskId);
    if (!this.kitAssignments(taskId).length) return null; // Preserve legacy deliveries.
    const row = this.#db
      .prepare(
        "SELECT proof_json FROM pazmo_kit_receipts WHERE task_id=? AND revision=? AND candidate_digest=?",
      )
      .get(taskId, item.revision, candidateDigest) as
      | { proof_json: string }
      | undefined;
    if (!row)
      fail(
        "KIT_EVIDENCE_REQUIRED",
        "Kit roles have not supplied completion evidence for this candidate.",
      );
    const files = JSON.parse(row.proof_json) as {
      path: string;
      digest: string;
    }[];
    try {
      for (const file of files) {
        validPath(file.path, true);
        noSymlinks(join(this.#project, file.path));
        if (
          digest(
            readStable(join(this.#project, file.path), 4 * 1024 * 1024),
          ) !== file.digest
        )
          throw Error("Changed role evidence");
      }
    } catch {
      fail(
        "KIT_EVIDENCE_CHANGED",
        "Kit role or evidence changed; obtain fresh verified role outcomes before G4.",
      );
    }
    return digest(row.proof_json);
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
    return transaction(this.#db, () => this.#register(contract, taskId));
  }
  /** Controller-internal batch. The synchronous receipt shares the registration transaction. */
  async registerBatch(
    token: string,
    inputs: ContractInput[],
    record: (items: ReturnType<OfficeStore["get"]>[]) => undefined,
  ) {
    this.authorize(token);
    if (!inputs.length || inputs.length > 8)
      fail("INVALID_CONTRACT", "Register between one and eight tasks.");
    const contracts: Contract[] = [];
    // Validation awaits the packaged checker; never keep a SQLite transaction open across it.
    for (const input of inputs)
      contracts.push(await readContract(this.#project, input));
    if (this.#db.isTransaction)
      fail(
        "TRANSACTION_ACTIVE",
        "Batch registration must own its commit boundary.",
      );
    return transaction(this.#db, () => {
      const items = contracts.map((contract) => this.#register(contract));
      record(items);
      return items;
    });
  }
  #register(contract: Contract, taskId?: string) {
    if (!contractMatches(this.#project, contract))
      fail("CONTRACT_CHANGED", "Contract changed before registration.");
    const existing = taskId ? this.#row(taskId) : undefined;
    if (existing && !["inbox", "planned", "pending"].includes(existing.status))
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
