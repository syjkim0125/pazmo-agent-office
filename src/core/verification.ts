import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { transaction } from "./approvals.ts";
import { digest, verifyCandidate } from "./candidates.ts";
import type { Candidate } from "./candidates.ts";
import type { VerificationCheck } from "./contracts.ts";
import type { OfficeStore } from "./store.ts";
import { deliverySchema, storedDelivery, validDelivery } from "./delivery.ts";

type State =
  | "checking"
  | "fix_required"
  | "awaiting_g4"
  | "human_required"
  | "cancelled";
type Verdict = "pass" | "fail" | "unknown";
type Definition =
  | { id: string; kind: "test"; check: VerificationCheck }
  | { id: string; kind: "review" };
type ProcessObservation = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  error: string | null;
  output: string;
};
export type Observation = ProcessObservation &
  (
    | { kind: "test" }
    | {
        kind: "review";
        report: {
          verdict: Verdict;
          findings: string[];
          summary: string;
        } | null;
      }
  );
type Result = { verdict: Verdict; observation: Observation; digest: string };
type RoundRow = {
  id: string;
  task_id: string;
  revision: number;
  number: number;
  contract_digest: string;
  candidate_json: string;
  state: State;
  reason: string | null;
  deadline: number;
};
type NodeRow = { definition_json: string; result_json: string | null };
type IntegrationFeedback = {
  source: string;
  findings: string[];
  recordedAt: number;
};
const queueStatus: Record<State, string> = {
  checking: "review",
  awaiting_g4: "review",
  fix_required: "in_progress",
  human_required: "pending",
  cancelled: "cancelled",
};

function classify(kind: Definition["kind"], value: Observation): Verdict {
  if (
    !value ||
    value.kind !== kind ||
    typeof value.output !== "string" ||
    Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024 ||
    typeof value.timedOut !== "boolean" ||
    (value.signal !== null && typeof value.signal !== "string") ||
    (value.error !== null && typeof value.error !== "string") ||
    (value.exitCode !== null &&
      (!Number.isInteger(value.exitCode) ||
        value.exitCode < 0 ||
        value.exitCode > 255))
  )
    return fail(
      "INVALID_EVIDENCE",
      "Expected a bounded controller process observation.",
    );
  // Exit zero never overrides incomplete/ambiguous process termination.
  if (
    value.timedOut ||
    value.signal !== null ||
    value.error !== null ||
    value.exitCode === null
  )
    return "unknown";
  if (value.exitCode !== 0) return "fail";
  if (value.kind === "test") return "pass";
  const report = value.report;
  if (
    !report ||
    !["pass", "fail", "unknown"].includes(report.verdict) ||
    typeof report.summary !== "string" ||
    !report.summary.trim() ||
    !Array.isArray(report.findings) ||
    report.findings.some((x) => typeof x !== "string" || !x.trim())
  )
    return "unknown";
  if (report.verdict === "unknown") return "unknown";
  return report.verdict === "fail" || report.findings.length ? "fail" : "pass";
}

/** Controller-internal join/router, not a worker-facing result submission API.
 * The trusted runner must supply observations it captures itself. This module
 * neither proves isolation nor launches processes; the live runtime stays locked.
 * Install its additive schema within the runtime's backed-up migration before use.
 */
export class VerificationLedger {
  #db: DatabaseSync;
  #store: OfficeStore;
  #now: () => number;
  constructor(
    db: DatabaseSync,
    store: OfficeStore,
    now: () => number = Date.now,
  ) {
    this.#db = db;
    this.#store = store;
    this.#now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS pazmo_verification_rounds (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, revision INTEGER NOT NULL,
        number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 3), contract_digest TEXT NOT NULL,
        candidate_json TEXT NOT NULL, state TEXT NOT NULL
          CHECK(state IN ('checking','fix_required','awaiting_g4','human_required','cancelled')),
        reason TEXT, deadline INTEGER NOT NULL,
        UNIQUE(task_id,number),
        FOREIGN KEY(task_id,revision) REFERENCES pazmo_contract_revisions(task_id,revision)
      );
      CREATE TABLE IF NOT EXISTS pazmo_verification_nodes (
        round_id TEXT NOT NULL REFERENCES pazmo_verification_rounds(id),
        node_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        definition_json TEXT NOT NULL, result_json TEXT,
        PRIMARY KEY(round_id,node_id), UNIQUE(round_id,ordinal)
      );
      CREATE TABLE IF NOT EXISTS pazmo_integration_feedback (
        round_id TEXT PRIMARY KEY REFERENCES pazmo_verification_rounds(id),
        feedback_json TEXT NOT NULL
      );
    `);
    deliverySchema(db);
  }
  #row(id: string): RoundRow {
    const row = this.#db
      .prepare("SELECT * FROM pazmo_verification_rounds WHERE id=?")
      .get(id) as RoundRow | undefined;
    return row ?? fail("NOT_FOUND", "Verification round not found.");
  }
  #nodes(id: string) {
    return (
      this.#db
        .prepare(
          "SELECT definition_json,result_json FROM pazmo_verification_nodes WHERE round_id=? ORDER BY ordinal",
        )
        .all(id) as NodeRow[]
    ).map((row) => ({
      ...(JSON.parse(row.definition_json) as Definition),
      result:
        row.result_json === null
          ? null
          : (JSON.parse(row.result_json) as Result),
    }));
  }
  #latest(taskId: string): RoundRow | undefined {
    return this.#db
      .prepare(
        "SELECT * FROM pazmo_verification_rounds WHERE task_id=? ORDER BY number DESC LIMIT 1",
      )
      .get(taskId) as RoundRow | undefined;
  }
  #subject(row: RoundRow, nodes = this.#nodes(row.id)): string | null {
    if (
      row.state !== "awaiting_g4" ||
      nodes.some((n) => n.result?.verdict !== "pass")
    )
      return null;
    return digest(
      JSON.stringify({
        task: row.task_id,
        revision: row.revision,
        round: row.id,
        contract: row.contract_digest,
        candidate: (JSON.parse(row.candidate_json) as Candidate).digest,
        evidence: nodes.map((n) => ({ id: n.id, digest: n.result!.digest })),
      }),
    );
  }
  #state(row: RoundRow, state: State, reason: string | null): void {
    this.#db
      .prepare(
        "UPDATE pazmo_verification_rounds SET state=?,reason=? WHERE id=?",
      )
      .run(state, reason, row.id);
    // A historical round can change its own record, never the current queue item.
    this.#db
      .prepare(
        `UPDATE tasks SET status=?,updated_at=? WHERE id=? AND NOT EXISTS (
      SELECT 1 FROM pazmo_verification_rounds WHERE task_id=? AND number>?
    )`,
      )
      .run(
        queueStatus[state],
        this.#now(),
        row.task_id,
        row.task_id,
        row.number,
      );
    row.state = state;
    row.reason = reason;
  }
  #refresh(row: RoundRow): RoundRow {
    if (["human_required", "cancelled"].includes(row.state)) return row;
    const item = this.#store.get(row.task_id);
    const latest = this.#latest(row.task_id);
    if (latest?.id === row.id && item.status === "cancelled") {
      this.#state(row, "cancelled", "TASK_CANCELLED");
      return row;
    }
    const delivered =
      item.status === "done"
        ? storedDelivery(this.#db, row.task_id)
        : undefined;
    const deliveredHere =
      delivered?.state === "delivered" &&
      delivered.round_id === row.id &&
      row.state === "awaiting_g4" &&
      delivered.contract_digest === row.contract_digest &&
      delivered.candidate_digest ===
        (JSON.parse(row.candidate_json) as Candidate).digest &&
      delivered.verification_subject === this.#subject(row) &&
      Boolean(
        this.#db
          .prepare(
            `SELECT 1 FROM pazmo_g4_requests r
        JOIN pazmo_approvals a ON a.challenge_id=r.id AND a.gate='G4' AND a.subject=r.subject
        JOIN pazmo_g4_evidence e ON e.subject=r.subject
        WHERE r.id=? AND r.subject=? AND r.status='approved' AND e.round_id=? AND e.verification_subject=?`,
          )
          .get(
            delivered.request_id,
            delivered.g4_subject,
            row.id,
            delivered.verification_subject,
          ),
      ) &&
      validDelivery(delivered);
    if (
      latest?.id === row.id &&
      item.status !== queueStatus[row.state] &&
      !deliveredHere
    ) {
      this.#state(row, "human_required", "QUEUE_STATE_CHANGED");
      return row;
    }
    let reason: string | null = null;
    if (
      !item.ready ||
      item.revision !== row.revision ||
      item.contract.digest !== row.contract_digest
    )
      reason = "CONTRACT_CHANGED";
    else if (!verifyCandidate(JSON.parse(row.candidate_json) as Candidate))
      reason = "CANDIDATE_CHANGED";
    else if (row.state === "checking" && this.#now() >= row.deadline)
      reason = "DEADLINE_EXCEEDED";
    if (reason) this.#state(row, "human_required", reason);
    return row;
  }
  latest(taskId: string) {
    this.#store.get(taskId);
    const row = this.#latest(taskId);
    return row ? this.get(row.id) : null;
  }
  get(id: string) {
    return transaction(this.#db, () => {
      const row = this.#refresh(this.#row(id)),
        nodes = this.#nodes(id);
      const candidate = JSON.parse(row.candidate_json) as Candidate;
      const g4Subject = this.#subject(row, nodes);
      return {
        id: row.id,
        taskId: row.task_id,
        revision: row.revision,
        number: row.number,
        contractDigest: row.contract_digest,
        candidate,
        state: row.state,
        reason: row.reason,
        deadline: row.deadline,
        integrationFeedback: (() => {
          const saved = this.#db
            .prepare(
              "SELECT feedback_json FROM pazmo_integration_feedback WHERE round_id=?",
            )
            .get(row.id) as { feedback_json: string } | undefined;
          return saved
            ? (JSON.parse(saved.feedback_json) as IntegrationFeedback)
            : null;
        })(),
        nodes,
        g4Subject,
      };
    });
  }
  begin(taskId: string, candidate: Candidate) {
    // Persist invalidation before reporting a refusal to begin another round.
    const previousRound = this.#latest(taskId);
    if (previousRound) this.get(previousRound.id);
    return transaction(this.#db, () => {
      const item = this.#store.get(taskId);
      const previous = this.#latest(taskId);
      if (previous && ["human_required", "cancelled"].includes(previous.state))
        fail(
          "HUMAN_REQUIRED",
          "Explicit recovery is required; no automatic retry.",
        );
      if (previous && previous.state !== "fix_required")
        fail("ROUND_ACTIVE", "Resolve the current round first.");
      if (!item.ready)
        fail(
          "CONTRACT_NOT_READY",
          "Approve the current contract before verification.",
        );
      if (
        previous &&
        (item.revision !== previous.revision ||
          item.contract.digest !== previous.contract_digest)
      )
        fail(
          "CONTRACT_NOT_READY",
          "Recovery is required for a changed contract.",
        );
      if (!previous && !["planned", "in_progress"].includes(item.status))
        fail("TASK_ACTIVE", "Task is not ready for verification.");
      if (!candidate || !verifyCandidate(candidate))
        fail("CANDIDATE_CHANGED", "A valid frozen candidate is required.");
      const number = (previous?.number ?? 0) + 1;
      if (number > 3)
        fail("HUMAN_REQUIRED", "The two automatic fixes have been exhausted.");
      const id = randomUUID();
      this.#db
        .prepare(
          "INSERT INTO pazmo_verification_rounds VALUES (?,?,?,?,?,?,'checking',NULL,?)",
        )
        .run(
          id,
          taskId,
          item.revision,
          number,
          item.contract.digest,
          JSON.stringify(candidate),
          this.#now() + 30 * 60 * 1000,
        );
      const definitions: Definition[] = item.contract.checks.map((check) => ({
        id: randomUUID(),
        kind: "test",
        check,
      }));
      definitions.push({ id: randomUUID(), kind: "review" });
      const insert = this.#db.prepare(
        "INSERT INTO pazmo_verification_nodes VALUES (?,?,?,?,NULL)",
      );
      definitions.forEach((node, ordinal) =>
        insert.run(id, node.id, ordinal, JSON.stringify(node)),
      );
      this.#state(this.#row(id), "checking", null);
      return this.get(id);
    });
  }
  record(receipt: {
    roundId: string;
    nodeId: string;
    candidateDigest: string;
    contractDigest: string;
    observation: Observation;
  }) {
    const current = this.get(receipt.roundId);
    if (current.state !== "checking")
      fail("ROUND_CLOSED", "Closed rounds reject late observations.");
    return transaction(this.#db, () => {
      const row = this.#refresh(this.#row(receipt.roundId));
      if (row.state !== "checking")
        fail("ROUND_CLOSED", "Round is no longer accepting observations.");
      const node = this.#nodes(row.id).find((n) => n.id === receipt.nodeId);
      if (
        !node ||
        receipt.contractDigest !== row.contract_digest ||
        receipt.candidateDigest !==
          (JSON.parse(row.candidate_json) as Candidate).digest
      )
        fail(
          "STALE_EVIDENCE",
          "Observation does not match this round, node, contract and candidate.",
        );
      if (node.result)
        fail("DUPLICATE_EVIDENCE", "A node result is immutable once accepted.");
      const verdict = classify(node.kind, receipt.observation);
      const result: Result = {
        verdict,
        observation: receipt.observation,
        digest: digest(JSON.stringify(receipt.observation)),
      };
      this.#db
        .prepare(
          "UPDATE pazmo_verification_nodes SET result_json=? WHERE round_id=? AND node_id=?",
        )
        .run(JSON.stringify(result), row.id, node.id);
      const nodes = this.#nodes(row.id);
      if (nodes.some((n) => n.result?.verdict === "unknown"))
        this.#state(row, "human_required", "UNKNOWN_RESULT");
      else if (nodes.every((n) => n.result !== null)) {
        if (nodes.some((n) => n.result!.verdict === "fail"))
          this.#state(
            row,
            row.number < 3 ? "fix_required" : "human_required",
            row.number < 3 ? "CHECK_FAILED" : "FIX_BUDGET_EXHAUSTED",
          );
        else this.#state(row, "awaiting_g4", null);
      }
      return this.get(row.id);
    });
  }
  requireHuman(
    id: string,
    reason: "EXECUTION_BUDGET_EXHAUSTED" | "DISPATCH_FAILED",
  ): void {
    transaction(this.#db, () => {
      const row = this.#refresh(this.#row(id));
      if (["checking", "fix_required"].includes(row.state))
        this.#state(row, "human_required", reason);
    });
  }
  /** Trusted integration review before delivery. Preserve the original model
   * observations and invalidate their acceptance with a separate factual finding.
   */
  requestChanges(input: {
    roundId: string;
    candidateDigest: string;
    contractDigest: string;
    source: string;
    findings: string[];
  }) {
    this.get(input.roundId); // Persist cancellation or stale-contract invalidation first.
    return transaction(this.#db, () => {
      const row = this.#refresh(this.#row(input.roundId));
      if (
        row.state !== "awaiting_g4" ||
        this.#latest(row.task_id)?.id !== row.id ||
        this.#store.get(row.task_id).status === "done"
      )
        fail(
          "ROUND_CLOSED",
          "Only the current undelivered verified candidate can receive integration feedback.",
        );
      if (
        input.candidateDigest !==
          (JSON.parse(row.candidate_json) as Candidate).digest ||
        input.contractDigest !== row.contract_digest
      )
        fail(
          "STALE_EVIDENCE",
          "Feedback must identify the exact reviewed candidate and contract.",
        );
      if (
        typeof input.source !== "string" ||
        !input.source.trim() ||
        input.source.length > 1000 ||
        !Array.isArray(input.findings) ||
        !input.findings.length ||
        input.findings.length > 20 ||
        input.findings.some(
          (f) => typeof f !== "string" || !f.trim() || f.length > 8000,
        )
      )
        fail(
          "INVALID_EVIDENCE",
          "Integration feedback requires bounded source and factual findings.",
        );
      this.#db
        .prepare("INSERT INTO pazmo_integration_feedback VALUES (?,?)")
        .run(
          row.id,
          JSON.stringify({
            source: input.source,
            findings: input.findings,
            recordedAt: this.#now(),
          }),
        );
      this.#state(
        row,
        row.number < 3 ? "fix_required" : "human_required",
        row.number < 3 ? "INTEGRATION_FEEDBACK" : "FIX_BUDGET_EXHAUSTED",
      );
      return this.get(row.id);
    });
  }
  invalidate(
    id: string,
    reason: "BASELINE_CHANGED" | "DELIVERY_INVALID",
  ): void {
    transaction(this.#db, () => {
      const row = this.#row(id);
      if (!["human_required", "cancelled"].includes(row.state))
        this.#state(row, "human_required", reason);
    });
  }
  cancel(id: string): void {
    transaction(this.#db, () => {
      const row = this.#refresh(this.#row(id));
      // A delayed cancellation belongs to execution, not an already committed delivery.
      if (
        row.state === "awaiting_g4" &&
        this.#store.get(row.task_id).status === "done"
      )
        return;
      this.#state(row, "cancelled", "CANCELLED");
    });
  }
  /** Call only after acquiring controller ownership, before accepting callbacks.
   * Unknown process liveness is never interpreted as a free execution slot.
   */
  recoverInterrupted(): void {
    transaction(this.#db, () => {
      for (const row of this.#db
        .prepare(
          "SELECT * FROM pazmo_verification_rounds WHERE state='checking'",
        )
        .all() as RoundRow[])
        this.#state(row, "human_required", "CONTROLLER_RESTARTED");
    });
  }
}
