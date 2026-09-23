import type { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { fail, OfficeError } from "../cli/project.ts";
import { ApprovalLedger, transaction } from "./approvals.ts";
import type { ApprovalAnswer } from "./approvals.ts";
import { digest } from "./candidates.ts";
import type { HandoffLedger } from "./handoffs.ts";
import { captureCandidateDiff } from "../runners/candidate-diff.ts";
import type { CandidateDiff } from "../runners/candidate-diff.ts";
import type { OfficeStore } from "./store.ts";
import type { VerificationLedger } from "./verification.ts";
import { isUnderstandingLease } from "./budgets.ts";
import type { ExecutionLedger } from "./budgets.ts";
import { createDelivery, storedDelivery, validDelivery } from "./delivery.ts";
import type { DeliveryRecord } from "./delivery.ts";

const aspects = ["behavior", "invariant", "evidence"] as const;
export type UnderstandingEvaluation = Record<
  (typeof aspects)[number],
  { correct: boolean; rationale: string }
>;
type Bundle = {
  subject: string;
  task_id: string;
  round_id: string;
  verification_subject: string;
  evidence_json: string;
};
type Request = {
  id: string;
  subject: string;
  status: string;
  answer_json: string | null;
  answer_digest: string | null;
  evaluation_json: string | null;
};
const text = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= 16000;
const questions = [
  "이 변경 뒤에 사용자가 겪는 일이 어떻게 달라질까요?",
  "꼭 지켜야 할 규칙과 실패했을 때의 동작은 무엇인가요?",
  "어떤 테스트가 그걸 확인했고, 아직 확인하지 못한 것은 무엇인가요?",
];
const evidenceSubject = (
  verification: string,
  diff: CandidateDiff,
  handoff: string,
  kit: string | null = null,
): string =>
  digest(
    JSON.stringify({
      verification,
      handoff,
      diff: digest(JSON.stringify(diff)),
      ...(kit ? { kit } : {}),
    }),
  );

/** G4 controller state, not a worker-facing approval/evaluation API.
 * prepare captures its own diff; evaluate accepts only a trusted assessment.
 * Nonempty human text is a submission, never proof of understanding by itself.
 */
export class CompletionLedger {
  #db: DatabaseSync;
  #store: OfficeStore;
  #verification: VerificationLedger;
  #execution: ExecutionLedger;
  #approvals: ApprovalLedger;
  #authorityHash: string;
  #handoffs: HandoffLedger;
  #deliveryRoot: string | undefined;
  constructor(
    db: DatabaseSync,
    store: OfficeStore,
    verification: VerificationLedger,
    execution: ExecutionLedger,
    token: string,
    handoffs: HandoffLedger,
    deliveryRoot?: string,
  ) {
    this.#db = db;
    this.#store = store;
    this.#verification = verification;
    this.#execution = execution;
    this.#approvals = new ApprovalLedger(db, token);
    this.#authorityHash = digest(token);
    this.#handoffs = handoffs;
    this.#deliveryRoot = deliveryRoot;
    db.exec(`
      CREATE TABLE IF NOT EXISTS pazmo_g4_evidence (
        subject TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        round_id TEXT NOT NULL UNIQUE REFERENCES pazmo_verification_rounds(id),
        verification_subject TEXT NOT NULL, evidence_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pazmo_g4_requests (
        id TEXT PRIMARY KEY REFERENCES pazmo_approval_challenges(id),
        subject TEXT NOT NULL REFERENCES pazmo_g4_evidence(subject),
        status TEXT NOT NULL CHECK(status IN ('awaiting_answer','awaiting_evaluation','needs_restatement','approved','rejected')),
        answer_json TEXT, answer_digest TEXT, evaluation_json TEXT
      );
    `);
  }
  #eligible(taskId: string, viewingAssessment = false) {
    const leases = this.#execution.list(taskId);
    const round = this.#verification.latest(taskId);
    if (
      !round ||
      round.state !== "awaiting_g4" ||
      !round.g4Subject ||
      leases.some(
        (l) =>
          l.state !== "released" &&
          !(
            viewingAssessment &&
            isUnderstandingLease(l) &&
            l.round_id === round.id &&
            ["reserved", "running"].includes(l.state)
          ),
      ) ||
      round.nodes.some(
        (n) =>
          !leases.some(
            (l) =>
              l.round_id === round.id &&
              l.node_id === n.id &&
              l.state === "released" &&
              l.reason === null,
          ),
      )
    )
      return fail(
        "EVIDENCE_REQUIRED",
        "G4 requires all joined results and confirmed execution closure for the same candidate.",
      );
    try {
      this.#handoffs.forRound(round.id);
    } catch (error) {
      if (
        error instanceof OfficeError &&
        ["HANDOFF_REQUIRED", "CANDIDATE_CHANGED"].includes(error.code)
      )
        fail(
          "EVIDENCE_REQUIRED",
          "A valid Engineer baseline and completion receipt are required.",
        );
      throw error;
    }
    return {
      ...round,
      g4Subject: round.g4Subject,
      kitReceipt: this.#store.kitReceipt(taskId, round.candidate.digest),
    };
  }
  #bundle(taskId: string, viewingAssessment = false): Bundle {
    const round = this.#eligible(taskId, viewingAssessment);
    const bundle = this.#db
      .prepare("SELECT * FROM pazmo_g4_evidence WHERE round_id=?")
      .get(round.id) as Bundle | undefined;
    const evidence = bundle ? JSON.parse(bundle.evidence_json) : null;
    const diff: CandidateDiff | undefined = evidence?.diff;
    const handoff = this.#handoffs.forRound(round.id);
    if (
      !bundle ||
      bundle.verification_subject !== round.g4Subject ||
      diff?.version !== 1 ||
      diff.roundTripVerified !== true ||
      diff.candidateDigest !== round.candidate.digest ||
      diff.baselineDigest !== handoff.baseline.digest ||
      evidence.handoff !== handoff.leaseId ||
      bundle.subject !==
        evidenceSubject(
          round.g4Subject,
          diff,
          handoff.leaseId,
          round.kitReceipt,
        )
    )
      return fail(
        "EVIDENCE_REQUIRED",
        "The verified candidate needs a mechanically captured and replay-verified diff before G4.",
      );
    return bundle;
  }
  #request(id: string): Request {
    return (
      (this.#db
        .prepare("SELECT * FROM pazmo_g4_requests WHERE id=?")
        .get(id) as Request | undefined) ??
      fail("NOT_FOUND", "G4 request not found.")
    );
  }
  #currentRequest(id: string, viewingAssessment = false) {
    const request = this.#request(id);
    const stored = this.#db
      .prepare("SELECT * FROM pazmo_g4_evidence WHERE subject=?")
      .get(request.subject) as Bundle;
    const current = this.#bundle(stored.task_id, viewingAssessment);
    if (current.subject !== request.subject)
      fail(
        "STALE_APPROVAL",
        "G4 request belongs to another candidate or evidence set.",
      );
    return { request, bundle: current };
  }
  owns(id: string): boolean {
    return Boolean(
      this.#db.prepare("SELECT 1 FROM pazmo_g4_requests WHERE id=?").get(id),
    );
  }
  /** Read the same validated bundle used by G4, without issuing a challenge. */
  evidence(token: string, taskId: string) {
    this.#approvals.authorize(token);
    const bundle = this.#bundle(taskId, true);
    return {
      subject: bundle.subject,
      roundId: bundle.round_id,
      questions,
      evidence: JSON.parse(bundle.evidence_json),
      completion: this.get(taskId),
    };
  }
  /** Only the operator can request local delivery. G4 remains a separate fact. */
  deliver(token: string, taskId: string) {
    this.#approvals.authorize(token);
    if (this.#db.isTransaction)
      fail("TRANSACTION_ACTIVE", "Delivery must own its commit boundary.");
    const existing = this.delivery(taskId);
    if (existing.status === "delivered") return existing;
    if (existing.status === "invalid")
      fail(
        "DELIVERY_INVALID",
        "The previous delivery requires explicit recovery.",
      );
    const bundle = this.#bundle(taskId),
      round = this.#eligible(taskId),
      g4 = this.get(taskId);
    if (!g4.approved || !g4.id)
      fail(
        "G4_REQUIRED",
        "The current evidence needs evaluated human G4 approval.",
      );
    if (!this.#deliveryRoot)
      fail("DELIVERY_DISABLED", "Local delivery storage is not configured.");
    const created = createDelivery(this.#deliveryRoot, round.candidate, {
      version: 1,
      taskId,
      roundId: round.id,
      candidateDigest: round.candidate.digest,
      contractDigest: round.contractDigest,
      g4,
      evidence: JSON.parse(bundle.evidence_json),
    });
    const record: DeliveryRecord = {
      task_id: taskId,
      round_id: round.id,
      candidate_digest: round.candidate.digest,
      contract_digest: round.contractDigest,
      verification_subject: round.g4Subject,
      g4_subject: bundle.subject,
      request_id: g4.id,
      directory: created.directory,
      receipt_digest: created.receiptDigest,
      state: "delivered",
      created_at: Date.now(),
    };
    try {
      // Persist any observed invalidation before the transaction can roll back.
      this.#bundle(taskId);
      transaction(this.#db, () => {
        if (
          this.#bundle(taskId).subject !== bundle.subject ||
          !this.get(taskId).approved ||
          !validDelivery(record)
        )
          fail(
            "STALE_EVIDENCE",
            "Approval, verification or output changed during delivery.",
          );
        this.#db
          .prepare(
            "INSERT INTO pazmo_deliveries VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            record.task_id,
            record.round_id,
            record.candidate_digest,
            record.contract_digest,
            record.verification_subject,
            record.g4_subject,
            record.request_id,
            record.directory,
            record.receipt_digest,
            record.state,
            record.created_at,
          );
        const updated = this.#db
          .prepare(
            "UPDATE tasks SET status='done',updated_at=? WHERE id=? AND status='review'",
          )
          .run(record.created_at, taskId);
        if (updated.changes !== 1)
          fail("STALE_EVIDENCE", "Task is no longer awaiting delivery.");
      });
    } catch (error) {
      rmSync(created.directory, { recursive: true, force: true });
      throw error;
    }
    return this.delivery(taskId);
  }
  delivery(taskId: string) {
    this.#store.get(taskId);
    const record = storedDelivery(this.#db, taskId);
    if (!record) return { status: "not_delivered" as const };
    let current = false;
    if (record.state === "delivered") {
      try {
        const bundle = this.#bundle(taskId),
          g4 = this.get(taskId, record.request_id);
        current =
          this.#store.get(taskId).status === "done" &&
          bundle.subject === record.g4_subject &&
          bundle.verification_subject === record.verification_subject &&
          g4.approved &&
          validDelivery(record);
      } catch (error) {
        if (!(error instanceof OfficeError)) throw error;
      }
      if (!current)
        transaction(this.#db, () => {
          this.#db
            .prepare(
              "UPDATE pazmo_deliveries SET state='invalid' WHERE task_id=?",
            )
            .run(taskId);
          this.#verification.invalidate(record.round_id, "DELIVERY_INVALID");
        });
    }
    return {
      status: current ? ("delivered" as const) : ("invalid" as const),
      directory: record.directory,
      receiptDigest: record.receipt_digest,
      candidateDigest: record.candidate_digest,
      roundId: record.round_id,
      createdAt: record.created_at,
    };
  }
  reconcileDeliveries(): void {
    for (const row of this.#db
      .prepare("SELECT task_id FROM pazmo_deliveries WHERE state='delivered'")
      .all() as { task_id: string }[])
      this.delivery(row.task_id);
  }
  async prepare(taskId: string) {
    const initial = this.#eligible(taskId);
    const handoff = this.#handoffs.forRound(initial.id);
    const diff = await captureCandidateDiff(
      handoff.baseline,
      initial.candidate,
    );
    // Capture yields to subprocesses. Persist cancellation/invalidation outside
    // the write transaction, and never attach its result to a different round.
    const current = this.#eligible(taskId);
    if (current.g4Subject !== initial.g4Subject)
      fail("STALE_EVIDENCE", "Verification changed during diff capture.");
    return transaction(this.#db, () => {
      const round = this.#eligible(taskId);
      const subject = evidenceSubject(
        round.g4Subject,
        diff,
        handoff.leaseId,
        round.kitReceipt,
      );
      const existing = this.#db
        .prepare("SELECT subject FROM pazmo_g4_evidence WHERE round_id=?")
        .get(round.id) as { subject: string } | undefined;
      if (existing && existing.subject !== subject)
        fail(
          "EVIDENCE_CONFLICT",
          "A prepared G4 evidence bundle cannot be replaced.",
        );
      if (!existing)
        this.#db
          .prepare("INSERT INTO pazmo_g4_evidence VALUES (?,?,?,?,?)")
          .run(
            subject,
            taskId,
            round.id,
            round.g4Subject,
            JSON.stringify({
              diff,
              handoff: handoff.leaseId,
              ...(round.kitReceipt ? { kitReceipt: round.kitReceipt } : {}),
              contract: this.#store.get(taskId).contract,
              results: round.nodes.map((n) => ({
                id: n.id,
                kind: n.kind,
                result: n.result,
              })),
            }),
          );
      return { subject, roundId: round.id };
    });
  }
  request(token: string, taskId: string) {
    this.#approvals.authorize(token);
    this.#bundle(taskId);
    return transaction(this.#db, () => {
      const bundle = this.#bundle(taskId);
      if (this.#approvals.has("G4", bundle.subject))
        fail("ALREADY_APPROVED", "This G4 evidence already has approval.");
      const challenge = this.#approvals.issue(token, "G4", bundle.subject);
      this.#db
        .prepare(
          "INSERT INTO pazmo_g4_requests VALUES (?,?,'awaiting_answer',NULL,NULL,NULL)",
        )
        .run(challenge.id, bundle.subject);
      return {
        ...challenge,
        taskId,
        status: "awaiting_answer",
        questions,
        evidence: JSON.parse(bundle.evidence_json),
        evaluation: null,
      };
    });
  }
  submit(token: string, id: string, answer: ApprovalAnswer) {
    this.#approvals.authorize(token);
    this.#currentRequest(id);
    return transaction(this.#db, () => {
      const { request, bundle } = this.#currentRequest(id);
      this.#approvals.pending(token, id);
      if (request.status !== "awaiting_answer")
        fail("STALE_APPROVAL", "This request already has an answer.");
      if (
        !answer ||
        !["approve", "reject"].includes(answer.decision) ||
        !text(answer.note)
      )
        fail("INVALID_APPROVAL", "A human decision and note are required.");
      if (
        answer.decision === "approve" &&
        (!answer.understanding ||
          aspects.some((a) => !text(answer.understanding![a])))
      )
        fail(
          "UNDERSTANDING_REQUIRED",
          "Restate behavior, an invariant/failure path and the evidence boundary.",
        );
      const clean: ApprovalAnswer = {
        decision: answer.decision,
        note: answer.note,
        ...(answer.decision === "approve"
          ? {
              understanding: {
                behavior: answer.understanding!.behavior,
                invariant: answer.understanding!.invariant,
                evidence: answer.understanding!.evidence,
              },
            }
          : {}),
      };
      const serialized = JSON.stringify(clean),
        status =
          clean.decision === "reject" ? "rejected" : "awaiting_evaluation";
      if (clean.decision === "reject") this.#approvals.decide(token, id, clean);
      this.#db
        .prepare(
          "UPDATE pazmo_g4_requests SET status=?,answer_json=?,answer_digest=? WHERE id=?",
        )
        .run(status, serialized, digest(serialized), id);
      return this.get(bundle.task_id, id);
    });
  }
  /** Exact persisted human input, readable during its own readonly assessment.
   * No operator capability is returned to the worker.
   */
  assessmentInput(
    token: string,
    taskId: string,
    id: string,
    answerDigest: string,
  ) {
    this.#approvals.authorize(token);
    const { request, bundle } = this.#currentRequest(id, true);
    this.#approvals.pending(token, id);
    if (
      bundle.task_id !== taskId ||
      request.status !== "awaiting_evaluation" ||
      request.answer_digest !== answerDigest
    )
      fail("STALE_APPROVAL", "Assess the exact stored, pending human answer.");
    const round = this.#eligible(taskId, true);
    return {
      taskId,
      requestId: id,
      subject: bundle.subject,
      answerDigest,
      roundId: bundle.round_id,
      candidate: round.candidate,
      answer: JSON.parse(request.answer_json!) as ApprovalAnswer,
      questions,
      evidence: JSON.parse(bundle.evidence_json),
      contract: this.#store.inspectContract(taskId),
    };
  }
  /** Called after the trusted controller compares the exact answer to raw evidence.
   * There is deliberately no HTTP/CLI endpoint accepting this assessment.
   */
  evaluate(
    token: string,
    id: string,
    answerDigest: string,
    evaluation: UnderstandingEvaluation,
  ) {
    this.#approvals.authorize(token);
    this.#currentRequest(id);
    if (
      !evaluation ||
      aspects.some(
        (a) =>
          typeof evaluation[a]?.correct !== "boolean" ||
          !text(evaluation[a]?.rationale),
      )
    )
      fail(
        "INVALID_EVALUATION",
        "Assess all three understanding dimensions against the evidence.",
      );
    return transaction(this.#db, () => {
      const { request, bundle } = this.#currentRequest(id);
      this.#approvals.pending(token, id);
      if (
        request.status !== "awaiting_evaluation" ||
        request.answer_digest !== answerDigest
      )
        fail(
          "STALE_APPROVAL",
          "Evaluation must refer to this request's exact unevaluated answer.",
        );
      const accepted = aspects.every((a) => evaluation[a].correct);
      if (accepted)
        this.#approvals.decide(
          token,
          id,
          JSON.parse(request.answer_json!) as ApprovalAnswer,
        );
      this.#db
        .prepare(
          "UPDATE pazmo_g4_requests SET status=?,evaluation_json=? WHERE id=?",
        )
        .run(
          accepted ? "approved" : "needs_restatement",
          JSON.stringify(evaluation),
          id,
        );
      return this.get(bundle.task_id, id);
    });
  }
  get(taskId: string, requestId?: string) {
    this.#store.get(taskId);
    let currentSubject: string | null = null;
    try {
      currentSubject = this.#bundle(taskId, true).subject;
    } catch (error) {
      if (!(error instanceof OfficeError) || error.code !== "EVIDENCE_REQUIRED")
        throw error;
    }
    const row = this.#db
      .prepare(
        `SELECT r.*,c.expires_at,c.authority_hash FROM pazmo_g4_requests r
        JOIN pazmo_g4_evidence e ON e.subject=r.subject
        JOIN pazmo_approval_challenges c ON c.id=r.id
        WHERE e.task_id=? AND (? IS NULL OR r.id=?)
        ORDER BY (e.subject=?) DESC,(r.status='approved') DESC,r.rowid DESC LIMIT 1`,
      )
      .get(taskId, requestId ?? null, requestId ?? null, currentSubject) as
      | (Request & { expires_at: number; authority_hash: string })
      | undefined;
    if (!row)
      return { status: "not_requested", approved: false, answerDigest: null };
    const current = currentSubject === row.subject;
    const expired =
      ["awaiting_answer", "awaiting_evaluation"].includes(row.status) &&
      (row.expires_at <= Date.now() ||
        row.authority_hash !== this.#authorityHash);
    return {
      id: row.id,
      subject: row.subject,
      status: !current ? "stale" : expired ? "expired" : row.status,
      approved:
        current &&
        row.status === "approved" &&
        this.#execution.list(taskId).every((l) => l.state === "released") &&
        this.#approvals.has("G4", row.subject),
      answerDigest: row.answer_digest,
      answer: row.answer_json ? JSON.parse(row.answer_json) : null,
      evaluation: row.evaluation_json ? JSON.parse(row.evaluation_json) : null,
    };
  }
}
