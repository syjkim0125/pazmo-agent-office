import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fail, noSymlinks } from "../cli/project.ts";
import { transaction } from "./approvals.ts";
import { verifyCandidate } from "./candidates.ts";
import type { Candidate } from "./candidates.ts";
import { freezeWorkspace, materializeWorkspace } from "./workspace.ts";
import type { WorkspaceScope } from "./workspace.ts";
import type { OfficeStore } from "./store.ts";
import type { VerificationLedger } from "./verification.ts";
import type { ExecutionLedger } from "./budgets.ts";

type Receipt = {
  closed: boolean;
  observation: {
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    error: string | null;
    output: string;
  };
};
type Row = {
  lease_id: string;
  task_id: string;
  baseline_json: string;
  origin_json: string;
  scope_json: string;
  workspace: string;
  candidate_json: string | null;
  round_id: string | null;
  state: "prepared" | "running" | "candidate_frozen" | "human_required";
  receipt_json: string | null;
  reason: string | null;
};
function validReceipt(receipt: Receipt): void {
  const r = receipt?.observation;
  if (
    typeof receipt?.closed !== "boolean" ||
    !r ||
    typeof r.output !== "string" ||
    Buffer.byteLength(JSON.stringify(receipt)) > 1024 * 1024 ||
    typeof r.timedOut !== "boolean" ||
    (r.exitCode !== null &&
      (!Number.isInteger(r.exitCode) || r.exitCode < 0 || r.exitCode > 255)) ||
    (r.signal !== null && typeof r.signal !== "string") ||
    (r.error !== null && typeof r.error !== "string")
  )
    fail(
      "INVALID_EVIDENCE",
      "Expected a bounded Engineer supervisor observation.",
    );
}
function passed(receipt: Receipt): boolean {
  const r = receipt.observation;
  return (
    receipt.closed &&
    r.exitCode === 0 &&
    r.signal === null &&
    r.error === null &&
    !r.timedOut
  );
}

/** Internal controller handoff. Its staging directory is for trusted transport;
 * it does not authorize host execution or claim an authenticated model ran.
 */
export class HandoffLedger {
  #db: DatabaseSync;
  #store: OfficeStore;
  #verification: VerificationLedger;
  #execution: ExecutionLedger;
  #project: string;
  #storage: string;
  #snapshots: string;
  constructor(
    db: DatabaseSync,
    store: OfficeStore,
    verification: VerificationLedger,
    execution: ExecutionLedger,
    project: string,
    storage: string,
  ) {
    this.#db = db;
    this.#store = store;
    this.#verification = verification;
    this.#execution = execution;
    this.#project = project;
    this.#storage = storage;
    noSymlinks(project);
    noSymlinks(storage);
    this.#snapshots = join(storage, "snapshots");
    db.exec(`CREATE TABLE IF NOT EXISTS pazmo_handoffs (
      lease_id TEXT PRIMARY KEY REFERENCES pazmo_execution_leases(id), task_id TEXT NOT NULL REFERENCES tasks(id),
      baseline_json TEXT NOT NULL, origin_json TEXT NOT NULL, scope_json TEXT NOT NULL, workspace TEXT NOT NULL UNIQUE,
      candidate_json TEXT, round_id TEXT UNIQUE REFERENCES pazmo_verification_rounds(id),
      state TEXT NOT NULL CHECK(state IN ('prepared','running','candidate_frozen','human_required')),
      receipt_json TEXT, reason TEXT
    )`);
  }
  #row(id: string): Row {
    return (
      (this.#db
        .prepare("SELECT * FROM pazmo_handoffs WHERE lease_id=?")
        .get(id) as Row) ?? fail("NOT_FOUND", "Engineer handoff not found.")
    );
  }
  get(id: string) {
    const row = this.#row(id),
      lease = this.#execution.get(id);
    return {
      leaseId: id,
      taskId: row.task_id,
      state: lease.state === "unknown" ? "human_required" : row.state,
      reason: lease.state === "unknown" ? lease.reason : row.reason,
      receipt: row.receipt_json
        ? (JSON.parse(row.receipt_json) as Receipt)
        : null,
      baseline: JSON.parse(row.baseline_json) as Candidate,
      origin: JSON.parse(row.origin_json) as Candidate,
      scope: JSON.parse(row.scope_json) as WorkspaceScope,
      workspace: row.workspace,
      candidate: row.candidate_json
        ? (JSON.parse(row.candidate_json) as Candidate)
        : null,
      round: row.round_id ? this.#verification.get(row.round_id) : null,
    };
  }
  list(taskId: string) {
    this.#execution.list(taskId);
    return (
      this.#db
        .prepare(
          "SELECT lease_id FROM pazmo_handoffs WHERE task_id=? ORDER BY rowid",
        )
        .all(taskId) as { lease_id: string }[]
    ).map((r) => this.get(r.lease_id));
  }
  #current(row: Row): void {
    const item = this.#store.get(row.task_id),
      lease = this.#execution.get(row.lease_id);
    if (
      !item.ready ||
      item.revision !== lease.revision ||
      item.contract.digest !== lease.contract_digest ||
      item.status !== "in_progress"
    )
      fail(
        "CONTRACT_NOT_READY",
        "Engineer handoff no longer matches the approved task.",
      );
    if (
      !verifyCandidate(JSON.parse(row.baseline_json)) ||
      !verifyCandidate(JSON.parse(row.origin_json))
    )
      fail("CANDIDATE_CHANGED", "Engineer baseline changed.");
  }
  prepare(taskId: string, timeoutMs?: number) {
    const previousRound = this.#verification.latest(taskId);
    this.#execution.expire();
    if (previousRound) this.forRound(previousRound.id);
    const owned: string[] = [];
    try {
      return transaction(this.#db, () => {
        const item = this.#store.get(taskId),
          scope = item.contract.workspace;
        if (!scope)
          fail(
            "WORKSPACE_REQUIRED",
            "Approve an explicit workspace selection before Engineer execution.",
          );
        const owner = this.#db
          .prepare("SELECT project_path FROM tasks WHERE id=?")
          .get(taskId) as { project_path: string };
        if (owner.project_path !== this.#project)
          fail(
            "UNSAFE_PATH",
            "Engineer baseline source must be the registered task project.",
          );
        const previous = this.#verification.latest(taskId);
        const parent = previous ? this.forRound(previous.id) : null;
        const lease = this.#execution.reserveEngineer(taskId, { timeoutMs });
        mkdirSync(this.#snapshots, { recursive: true, mode: 0o700 });
        const baseline =
          parent?.candidate ??
          freezeWorkspace(this.#project, scope, this.#snapshots);
        if (!parent) owned.push(baseline.directory);
        const origin = parent?.baseline ?? baseline;
        const workspace = join(this.#storage, "work-" + lease.id);
        owned.push(workspace);
        materializeWorkspace(baseline, workspace);
        // Both snapshots are frozen before any supervisor handle can be started.
        this.#db
          .prepare(
            "INSERT INTO pazmo_handoffs VALUES (?,?,?,?,?,?,NULL,NULL,'prepared',NULL,NULL)",
          )
          .run(
            lease.id,
            taskId,
            JSON.stringify(baseline),
            JSON.stringify(origin),
            JSON.stringify(scope),
            workspace,
          );
        this.#current(this.#row(lease.id));
        return this.get(lease.id);
      });
    } catch (error) {
      for (const path of owned.reverse())
        rmSync(path, { recursive: true, force: true });
      throw error;
    }
  }
  start(id: string, handle: string) {
    this.#execution.expire();
    return transaction(this.#db, () => {
      const row = this.#row(id);
      if (row.state !== "prepared")
        fail("STALE_EXECUTION", "Engineer handoff is not prepared.");
      this.#current(row);
      const staged = freezeWorkspace(
        row.workspace,
        JSON.parse(row.scope_json),
        this.#snapshots,
        true,
      );
      try {
        if (
          staged.digest !== (JSON.parse(row.baseline_json) as Candidate).digest
        )
          fail(
            "CANDIDATE_CHANGED",
            "Engineer input changed before supervisor start.",
          );
      } finally {
        rmSync(staged.directory, { recursive: true, force: true });
      }
      this.#execution.start(id, handle);
      this.#db
        .prepare("UPDATE pazmo_handoffs SET state='running' WHERE lease_id=?")
        .run(id);
      return this.get(id);
    });
  }
  #reject(row: Row, reason: string) {
    this.#db
      .prepare(
        "UPDATE pazmo_handoffs SET state='human_required',reason=? WHERE lease_id=?",
      )
      .run(reason, row.lease_id);
    // Preserve operator cancellation and never change another attempt's queue.
    this.#db
      .prepare(
        "UPDATE tasks SET status='pending',updated_at=? WHERE id=? AND status='in_progress'",
      )
      .run(Date.now(), row.task_id);
    return this.get(row.lease_id);
  }
  finish(id: string, handle: string, receipt: Receipt) {
    validReceipt(receipt);
    this.#execution.expire();
    const row = this.#row(id),
      lease = this.#execution.get(id);
    if (
      row.state !== "running" ||
      lease.state !== "running" ||
      lease.handle !== handle
    )
      fail(
        "STALE_EXECUTION",
        "Only the current started Engineer can complete this handoff.",
      );
    let candidate: Candidate | undefined;
    try {
      return transaction(this.#db, () => {
        this.#execution.finish(id, handle, { closed: receipt.closed });
        this.#db
          .prepare("UPDATE pazmo_handoffs SET receipt_json=? WHERE lease_id=?")
          .run(JSON.stringify(receipt), id);
        if (!passed(receipt))
          return this.#reject(
            row,
            receipt.closed ? "ENGINEER_FAILED" : "PROCESS_LIVENESS_UNKNOWN",
          );
        try {
          this.#current(row);
          candidate = freezeWorkspace(
            row.workspace,
            JSON.parse(row.scope_json),
            this.#snapshots,
            true,
          );
        } catch (error) {
          return this.#reject(
            row,
            error instanceof Error ? error.message : "CANDIDATE_CAPTURE_FAILED",
          );
        }
        const round = this.#verification.begin(row.task_id, candidate);
        this.#db
          .prepare(
            "UPDATE pazmo_handoffs SET state='candidate_frozen',candidate_json=?,round_id=? WHERE lease_id=?",
          )
          .run(JSON.stringify(candidate), round.id, id);
        return this.get(id);
      });
    } catch (error) {
      if (candidate)
        rmSync(candidate.directory, { recursive: true, force: true });
      // Persistence failed after a supervisor callback. Do not retry execution or
      // admit the candidate; preserve the reserved capacity for explicit recovery.
      this.#execution.markUnknown(id);
      transaction(this.#db, () =>
        this.#reject(row, "HANDOFF_RECORDING_FAILED"),
      );
      throw error;
    }
  }
  forRound(roundId: string) {
    const round = this.#verification.get(roundId);
    const row = this.#db
      .prepare("SELECT * FROM pazmo_handoffs WHERE round_id=?")
      .get(roundId) as Row | undefined;
    const lease = row ? this.#execution.get(row.lease_id) : null;
    if (
      !row ||
      row.state !== "candidate_frozen" ||
      row.task_id !== round.taskId ||
      !lease ||
      lease.state !== "released" ||
      lease.reason !== null ||
      lease.contract_digest !== round.contractDigest ||
      !row.receipt_json ||
      !passed(JSON.parse(row.receipt_json)) ||
      !row.candidate_json ||
      (JSON.parse(row.candidate_json) as Candidate).digest !==
        round.candidate.digest ||
      ["human_required", "cancelled"].includes(round.state)
    )
      return fail(
        "HANDOFF_REQUIRED",
        "Verification needs a successful bound Engineer handoff.",
      );
    const baseline = JSON.parse(row.origin_json) as Candidate;
    if (!verifyCandidate(baseline)) {
      this.#verification.invalidate(round.id, "BASELINE_CHANGED");
      fail("CANDIDATE_CHANGED", "Original Engineer baseline changed.");
    }
    return { leaseId: row.lease_id, baseline, candidate: round.candidate };
  }
}
