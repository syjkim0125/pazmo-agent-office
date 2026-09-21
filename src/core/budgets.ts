import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { transaction } from "./approvals.ts";
import type { OfficeStore } from "./store.ts";
import type { Observation, VerificationLedger } from "./verification.ts";
import type { IntakeLedger } from "./intake.ts";

type Role = "engineer" | "reviewer" | "verifier";
type Lease = {
  id: string;
  task_id: string;
  revision: number;
  contract_digest: string;
  role: Role;
  purpose: string;
  round_id: string | null;
  node_id: string | null;
  state: "reserved" | "running" | "unknown" | "released";
  handle: string | null;
  timeout_ms: number;
  deadline: number;
  reason: string | null;
};
type Options = { timeoutMs?: number; resources?: string[] };
type PlanningLease = {
  id: string;
  task_id: string;
  revision: number;
  input_digest: string;
  context_digest: string;
  role: "pm" | "lead";
  state: Lease["state"];
  handle: string | null;
  timeout_ms: number;
  deadline: number;
  reason: string | null;
};
const active = "state IN ('reserved','running','unknown')";
const taskBudgetMs = 60 * 60 * 1000;

/** Controller-only reservation ledger. A lease is NOT permission to bypass the
 * isolation gate, and closed=true must come from the trusted process supervisor.
 * Unknown leases retain their slots/resources until explicit recovery is built.
 */
export class ExecutionLedger {
  #db: DatabaseSync;
  #store: OfficeStore;
  #verification: VerificationLedger;
  #now: () => number;
  #intake?: IntakeLedger;
  constructor(
    db: DatabaseSync,
    store: OfficeStore,
    verification: VerificationLedger,
    now = Date.now,
    intake?: IntakeLedger,
  ) {
    this.#db = db;
    this.#store = store;
    this.#verification = verification;
    this.#now = now;
    this.#intake = intake;
    db.exec(`
      CREATE TABLE IF NOT EXISTS pazmo_execution_leases (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, revision INTEGER NOT NULL,
        contract_digest TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('engineer','reviewer','verifier')),
        purpose TEXT NOT NULL, round_id TEXT, node_id TEXT,
        state TEXT NOT NULL CHECK(state IN ('reserved','running','unknown','released')),
        handle TEXT UNIQUE, timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 1 AND 600000),
        deadline INTEGER NOT NULL, reason TEXT,
        UNIQUE(task_id,purpose),
        FOREIGN KEY(task_id,revision) REFERENCES pazmo_contract_revisions(task_id,revision),
        FOREIGN KEY(round_id) REFERENCES pazmo_verification_rounds(id),
        FOREIGN KEY(round_id,node_id) REFERENCES pazmo_verification_nodes(round_id,node_id)
      );
      CREATE TABLE IF NOT EXISTS pazmo_execution_resources (
        lease_id TEXT NOT NULL REFERENCES pazmo_execution_leases(id), resource TEXT NOT NULL,
        PRIMARY KEY(lease_id,resource)
      );
      CREATE TABLE IF NOT EXISTS pazmo_planning_leases (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        revision INTEGER NOT NULL, input_digest TEXT NOT NULL, context_digest TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('pm','lead')),
        state TEXT NOT NULL CHECK(state IN ('reserved','running','unknown','released')),
        handle TEXT UNIQUE, timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 1 AND 600000),
        deadline INTEGER NOT NULL, reason TEXT,
        UNIQUE(task_id,revision)
      );
    `);
  }
  #planning() {
    return (
      this.#intake ??
      fail(
        "INVALID_EXECUTION",
        "Planning requires the controller intake ledger.",
      )
    );
  }
  getPlanning(id: string): PlanningLease {
    return (
      (this.#db
        .prepare("SELECT * FROM pazmo_planning_leases WHERE id=?")
        .get(id) as PlanningLease | undefined) ??
      fail("NOT_FOUND", "Planning reservation not found.")
    );
  }
  listPlanning(taskId: string): PlanningLease[] {
    this.#planning().get(taskId);
    this.expire();
    return this.#db
      .prepare(
        "SELECT * FROM pazmo_planning_leases WHERE task_id=? ORDER BY rowid",
      )
      .all(taskId) as PlanningLease[];
  }
  #capacity() {
    const count = this.#db
      .prepare(
        `
      SELECT COUNT(*) AS total, COALESCE(SUM(role='engineer'),0) AS engineers FROM (
        SELECT role,state FROM pazmo_execution_leases UNION ALL
        SELECT role,state FROM pazmo_planning_leases
      ) WHERE ${active}
    `,
      )
      .get() as { total: number; engineers: number };
    if (count.total >= 3)
      fail("SLOT_LIMIT", "All three execution slots are occupied.");
    return count;
  }
  #handle(handle: string) {
    if (
      typeof handle !== "string" ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(handle) ||
      this.#db
        .prepare(
          "SELECT 1 FROM pazmo_execution_leases WHERE handle=? UNION ALL SELECT 1 FROM pazmo_planning_leases WHERE handle=?",
        )
        .get(handle, handle)
    )
      fail("INVALID_EXECUTION", "Expected a distinct supervisor handle.");
  }
  reservePlanning(
    taskId: string,
    revision: number,
    inputDigest: string,
    contextDigest: string,
    timeoutMs = 600000,
  ): PlanningLease {
    return transaction(this.#db, () => {
      const packet = this.#planning().packet(taskId, revision, inputDigest);
      if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 600000 ||
        typeof contextDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(contextDigest)
      )
        fail(
          "INVALID_EXECUTION",
          "Expected bounded planning time and a context digest.",
        );
      if (
        this.#db
          .prepare(
            "SELECT 1 FROM pazmo_planning_leases WHERE task_id=? AND revision=?",
          )
          .get(taskId, revision)
      )
        fail(
          "DUPLICATE_EXECUTION",
          "This planning revision already reserved an execution.",
        );
      if (
        this.#db
          .prepare(
            `SELECT 1 FROM pazmo_planning_leases WHERE task_id=? AND ${active}`,
          )
          .get(taskId)
      )
        fail("TASK_ACTIVE", "Another planning execution still owns this task.");
      this.#capacity();
      const budget = this.#db
        .prepare(
          "SELECT COALESCE(SUM(timeout_ms),0) AS used FROM pazmo_planning_leases WHERE task_id=?",
        )
        .get(taskId) as { used: number };
      if (budget.used + timeoutMs > taskBudgetMs)
        fail("TIME_BUDGET", "Planning time budget is exhausted.");
      const id = randomUUID();
      this.#db
        .prepare(
          "INSERT INTO pazmo_planning_leases VALUES (?,?,?,?,?,?,'reserved',NULL,?,?,NULL)",
        )
        .run(
          id,
          taskId,
          revision,
          inputDigest,
          contextDigest,
          packet.role,
          timeoutMs,
          this.#now() + timeoutMs,
        );
      return this.getPlanning(id);
    });
  }
  startPlanning(id: string, handle: string): PlanningLease {
    this.expire();
    return transaction(this.#db, () => {
      const lease = this.getPlanning(id);
      if (lease.state !== "reserved")
        fail("STALE_EXECUTION", "Planning reservation is not available.");
      this.#handle(handle);
      this.#planning().packet(
        lease.task_id,
        lease.revision,
        lease.input_digest,
      );
      this.#db
        .prepare(
          "UPDATE pazmo_planning_leases SET state='running',handle=? WHERE id=?",
        )
        .run(handle, id);
      return this.getPlanning(id);
    });
  }
  finishPlanning(
    id: string,
    handle: string,
    completion: Parameters<IntakeLedger["accept"]>[3],
  ): PlanningLease {
    this.expire();
    return transaction(this.#db, () => {
      const lease = this.getPlanning(id);
      if (lease.state !== "running" || lease.handle !== handle)
        fail(
          "STALE_EXECUTION",
          "Only the owning planning supervisor may finish.",
        );
      if (!completion || typeof completion.closed !== "boolean")
        fail(
          "INVALID_EXECUTION",
          "Supervisor closure confirmation is required.",
        );
      if (!completion.closed)
        this.#quarantinePlanning(lease, "PROCESS_LIVENESS_UNKNOWN");
      else {
        const item = this.#planning().get(lease.task_id);
        // Confirmed closure releases ownership; obsolete evidence must not advance intake.
        const current =
          item.revision === lease.revision &&
          item.inputDigest === lease.input_digest &&
          ["waiting_pm", "waiting_lead"].includes(item.state) &&
          (
            this.#db
              .prepare("SELECT status FROM tasks WHERE id=?")
              .get(lease.task_id) as { status: string }
          ).status === "inbox";
        if (current)
          this.#planning().accept(
            lease.task_id,
            lease.revision,
            lease.input_digest,
            completion,
          );
        this.#db
          .prepare(
            "UPDATE pazmo_planning_leases SET state='released',reason=? WHERE id=?",
          )
          .run(current ? null : "INTAKE_CLOSED", id);
      }
      return this.getPlanning(id);
    });
  }
  markPlanningUnknown(id: string) {
    transaction(this.#db, () => {
      const lease = this.getPlanning(id);
      if (lease.state === "unknown") return;
      if (lease.state === "released")
        fail(
          "STALE_EXECUTION",
          "Released planning execution cannot be interrupted.",
        );
      this.#quarantinePlanning(lease, "SUPERVISOR_FAILED");
    });
  }
  #quarantinePlanning(lease: PlanningLease, reason: string) {
    this.#db
      .prepare(
        "UPDATE pazmo_planning_leases SET state='unknown',reason=? WHERE id=?",
      )
      .run(reason, lease.id);
    this.#planning().interrupt(
      lease.task_id,
      lease.revision,
      lease.input_digest,
      reason,
    );
  }
  get(id: string): Lease {
    return (
      (this.#db
        .prepare("SELECT * FROM pazmo_execution_leases WHERE id=?")
        .get(id) as Lease | undefined) ??
      fail("NOT_FOUND", "Execution reservation not found.")
    );
  }
  list(taskId: string): Lease[] {
    this.#store.get(taskId);
    this.expire();
    return this.#db
      .prepare(
        "SELECT * FROM pazmo_execution_leases WHERE task_id=? ORDER BY rowid",
      )
      .all(taskId) as Lease[];
  }
  #ready(taskId: string) {
    const item = this.#store.get(taskId);
    if (!item.ready)
      fail(
        "CONTRACT_NOT_READY",
        "The current contract requires valid approval.",
      );
    return item;
  }
  #reserve(
    taskId: string,
    role: Role,
    purpose: string,
    roundId: string | null,
    nodeId: string | null,
    options: Options,
  ): Lease {
    const item = this.#ready(taskId);
    const timeout = options.timeoutMs ?? 600000,
      resources = options.resources ?? [];
    if (
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > 600000 ||
      !Array.isArray(resources) ||
      resources.length > 32 ||
      resources.some(
        (r) => typeof r !== "string" || !/^[a-zA-Z0-9:_./-]{1,200}$/.test(r),
      ) ||
      new Set(resources).size !== resources.length
    )
      fail(
        "INVALID_EXECUTION",
        "Expected a bounded timeout and distinct resource identifiers.",
      );
    if (
      this.#db
        .prepare(
          "SELECT 1 FROM pazmo_execution_leases WHERE task_id=? AND purpose=?",
        )
        .get(taskId, purpose)
    )
      fail(
        "DUPLICATE_EXECUTION",
        "This task purpose has already reserved an execution.",
      );
    if (
      this.#db
        .prepare(
          `SELECT 1 FROM pazmo_execution_leases WHERE task_id=? AND ${active} AND (role='engineer' OR ?='engineer')`,
        )
        .get(taskId, role)
    )
      fail("TASK_ACTIVE", "A conflicting execution still owns this task.");
    const count = this.#capacity();
    if (role === "engineer" && count.engineers >= 2)
      fail("ENGINEER_LIMIT", "Both implementation slots are occupied.");
    for (const resource of resources)
      if (
        this.#db
          .prepare(
            `SELECT 1 FROM pazmo_execution_resources r JOIN pazmo_execution_leases l ON l.id=r.lease_id WHERE r.resource=? AND l.${active}`,
          )
          .get(resource)
      )
        fail("RESOURCE_BUSY", "Another execution holds a required resource.");
    const budget = this.#db
      .prepare(
        "SELECT COALESCE(SUM(timeout_ms),0) AS used, COALESCE(SUM(role='engineer'),0) AS implementations FROM pazmo_execution_leases WHERE task_id=?",
      )
      .get(taskId) as { used: number; implementations: number };
    if (budget.used + timeout > taskBudgetMs)
      fail(
        "TIME_BUDGET",
        "The task's reserved execution time budget is exhausted.",
      );
    if (role === "engineer" && budget.implementations >= 3)
      fail(
        "FIX_BUDGET",
        "One initial implementation and two fixes have been reserved.",
      );
    const id = randomUUID();
    this.#db
      .prepare(
        "INSERT INTO pazmo_execution_leases VALUES (?,?,?,?,?,?,?,?,'reserved',NULL,?,?,NULL)",
      )
      .run(
        id,
        taskId,
        item.revision,
        item.contract.digest,
        role,
        purpose,
        roundId,
        nodeId,
        timeout,
        this.#now() + timeout,
      );
    for (const resource of resources)
      this.#db
        .prepare("INSERT INTO pazmo_execution_resources VALUES (?,?)")
        .run(id, resource);
    return this.get(id);
  }
  reserveEngineer(taskId: string, options: Options = {}): Lease {
    // Persist safety invalidation independently of a refused reservation.
    this.#verification.latest(taskId);
    return transaction(this.#db, () => {
      const item = this.#ready(taskId),
        round = this.#verification.latest(taskId);
      if (round && round.state !== "fix_required")
        fail(
          "ROUND_CLOSED",
          "Implementation requires a failed verification round.",
        );
      if (!["planned", "in_progress"].includes(item.status))
        fail("TASK_ACTIVE", "Task cannot begin implementation.");
      const lease = this.#reserve(
        taskId,
        "engineer",
        round ? `fix:${round.id}` : "initial",
        round?.id ?? null,
        null,
        options,
      );
      this.#db
        .prepare(
          "UPDATE tasks SET status='in_progress',updated_at=? WHERE id=?",
        )
        .run(this.#now(), taskId);
      return lease;
    });
  }
  reserveNode(
    roundId: string,
    nodeId: string,
    resources: string[] = [],
    timeoutMs = 600000,
  ): Lease {
    this.#verification.get(roundId);
    return transaction(this.#db, () => {
      const round = this.#verification.get(roundId);
      if (round.state !== "checking")
        fail("ROUND_CLOSED", "Verification is not accepting executions.");
      const node = round.nodes.find((n) => n.id === nodeId);
      if (!node || node.result)
        fail(
          "STALE_EXECUTION",
          "Verification node is absent or already has a result.",
        );
      return this.#reserve(
        round.taskId,
        node.kind === "test" ? "verifier" : "reviewer",
        `verify:${roundId}:${nodeId}`,
        roundId,
        nodeId,
        {
          timeoutMs: node.kind === "test" ? node.check.timeoutMs : timeoutMs,
          resources,
        },
      );
    });
  }
  start(id: string, handle: string): Lease {
    this.expire();
    const prior = this.get(id);
    if (prior.round_id) this.#verification.get(prior.round_id);
    return transaction(this.#db, () => {
      const lease = this.get(id);
      if (lease.state !== "reserved")
        fail("STALE_EXECUTION", "Reservation is not available to start.");
      this.#handle(handle);
      const item = this.#ready(lease.task_id);
      if (
        item.revision !== lease.revision ||
        item.contract.digest !== lease.contract_digest
      )
        fail(
          "CONTRACT_NOT_READY",
          "Reservation belongs to a different contract revision.",
        );
      if (lease.role === "engineer") {
        if (item.status !== "in_progress")
          fail("TASK_ACTIVE", "Task no longer permits implementation.");
        const round = this.#verification.latest(lease.task_id);
        if (
          lease.round_id
            ? round?.id !== lease.round_id || round.state !== "fix_required"
            : round !== null
        )
          fail(
            "ROUND_CLOSED",
            "Implementation reservation no longer matches the workflow.",
          );
      } else {
        const round = this.#verification.get(lease.round_id!);
        if (
          round.state !== "checking" ||
          round.nodes.find((n) => n.id === lease.node_id)?.result !== null
        )
          fail(
            "ROUND_CLOSED",
            "Verification reservation no longer matches an empty node.",
          );
      }
      this.#db
        .prepare(
          "UPDATE pazmo_execution_leases SET state='running',handle=? WHERE id=?",
        )
        .run(handle, id);
      return this.get(id);
    });
  }
  finish(
    id: string,
    handle: string,
    completion: { closed: boolean; observation?: Observation },
  ): Lease {
    this.expire();
    const prior = this.get(id);
    if (prior.round_id) this.#verification.get(prior.round_id);
    return transaction(this.#db, () => {
      const lease = this.get(id);
      if (lease.state !== "running" || lease.handle !== handle)
        fail(
          "STALE_EXECUTION",
          "Only the current supervisor can complete a running lease.",
        );
      if (!completion || typeof completion.closed !== "boolean")
        fail(
          "INVALID_EXECUTION",
          "Supervisor closure confirmation is required.",
        );
      if (!completion.closed)
        this.#quarantine(lease, "PROCESS_LIVENESS_UNKNOWN");
      else {
        let reason: string | null = null;
        if (lease.node_id) {
          const round = this.#verification.get(lease.round_id!);
          if (round.state === "checking")
            this.#verification.record({
              roundId: round.id,
              nodeId: lease.node_id,
              contractDigest: lease.contract_digest,
              candidateDigest: round.candidate.digest,
              observation: completion.observation!,
            });
          else reason = "ROUND_CLOSED";
        }
        // Process closure can free a still-owned slot without admitting late evidence.
        this.#db
          .prepare(
            "UPDATE pazmo_execution_leases SET state='released',reason=? WHERE id=?",
          )
          .run(reason, id);
      }
      return this.get(id);
    });
  }
  markUnknown(id: string): void {
    transaction(this.#db, () => {
      const lease = this.get(id);
      if (lease.state === "unknown") return;
      if (lease.state === "released")
        fail("STALE_EXECUTION", "A released execution cannot be interrupted.");
      this.#quarantine(lease, "SUPERVISOR_FAILED");
    });
  }
  #quarantine(lease: Lease, reason: string) {
    this.#db
      .prepare(
        "UPDATE pazmo_execution_leases SET state='unknown',reason=? WHERE id=?",
      )
      .run(reason, lease.id);
    if (lease.node_id) {
      const round = this.#verification.get(lease.round_id!);
      const node = round.nodes.find((n) => n.id === lease.node_id);
      if (round.state === "checking" && node && !node.result)
        this.#verification.record({
          roundId: round.id,
          nodeId: node.id,
          contractDigest: lease.contract_digest,
          candidateDigest: round.candidate.digest,
          observation: {
            kind: node.kind,
            exitCode: null,
            signal: null,
            timedOut: false,
            error: reason,
            output: "",
            ...(node.kind === "review" ? { report: null } : {}),
          } as Observation,
        });
    }
  }
  expire(): void {
    transaction(this.#db, () => {
      for (const lease of this.#db
        .prepare(
          "SELECT * FROM pazmo_planning_leases WHERE state IN ('reserved','running') AND deadline<=?",
        )
        .all(this.#now()) as PlanningLease[])
        this.#quarantinePlanning(lease, "DEADLINE_EXCEEDED");
      for (const lease of this.#db
        .prepare(
          "SELECT * FROM pazmo_execution_leases WHERE state IN ('reserved','running') AND deadline<=?",
        )
        .all(this.#now()) as Lease[])
        this.#quarantine(lease, "DEADLINE_EXCEEDED");
    });
  }
  recoverInterrupted(): void {
    transaction(this.#db, () => {
      for (const lease of this.#db
        .prepare(
          "SELECT * FROM pazmo_planning_leases WHERE state IN ('reserved','running')",
        )
        .all() as PlanningLease[])
        this.#quarantinePlanning(lease, "CONTROLLER_RESTARTED");
      for (const lease of this.#db
        .prepare(
          "SELECT * FROM pazmo_execution_leases WHERE state IN ('reserved','running')",
        )
        .all() as Lease[])
        this.#quarantine(lease, "CONTROLLER_RESTARTED");
    });
  }
}
