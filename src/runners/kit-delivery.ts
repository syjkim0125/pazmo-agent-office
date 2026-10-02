import { fail } from "../cli/project.ts";
import type { OfficeStore } from "../core/store.ts";
import type { HandoffLedger } from "../core/handoffs.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { Candidate } from "../core/candidates.ts";
import { KitRoleRun } from "../core/kit-role-runs.ts";
import type { KitNode, RoleAssignment } from "../core/kit-role-runs.ts";
import type { RolePacket } from "./role-context.ts";

type Stage = { run: KitRoleRun; node: KitNode };
type Round = NonNullable<ReturnType<VerificationLedger["latest"]>>;

/** Maps native role results to Office handoffs; does not implement kit transitions. */
export class KitDelivery {
  #project: string;
  #store: OfficeStore;
  #handoffs: HandoffLedger;
  #verification: VerificationLedger;
  constructor(
    project: string,
    store: OfficeStore,
    handoffs: HandoffLedger,
    verification: VerificationLedger,
  ) {
    this.#project = project;
    this.#store = store;
    this.#handoffs = handoffs;
    this.#verification = verification;
  }
  async #open(
    taskId: string,
    role: RoleAssignment["role"],
    candidate: Candidate,
    suffix = "",
  ) {
    const { item, documents } = this.#store.roleContext(taskId);
    const task =
      documents.find((d) => d.path === item.contract.input.task)?.content ?? "";
    const covers =
      task.split(/^## Covers[^\n]*\n/m)[1]?.split(/^## /m)[0] ?? "";
    const scope = [...new Set(covers.match(/\b[MV]-?\d+\b/g) ?? [])];
    const assignmentId = `${taskId}:${item.revision}:${role}:${suffix}`;
    const run = await KitRoleRun.open({
      project: this.#project,
      assignmentId,
      assignment: {
        version: 1,
        taskId,
        role,
        source: this.#store.kitSource(taskId),
        scope,
        targetRevision: candidate.digest,
      },
      candidate,
      guard: () => {
        const current = this.#store.get(taskId);
        if (
          !current.ready ||
          current.status === "cancelled" ||
          current.revision !== item.revision ||
          current.contract.digest !== item.contract.digest
        )
          fail(
            "CONTRACT_NOT_READY",
            "Role work no longer belongs to the current approved Office task.",
          );
      },
    });
    this.#store.bindKitRole(
      taskId,
      assignmentId,
      role,
      run.runFile,
      candidate.digest,
    );
    return run;
  }
  developer(taskId: string, origin: Candidate) {
    return this.#open(taskId, "developer", origin);
  }
  async #start(run: KitRoleRun, expected: string): Promise<Stage> {
    const status = await run.status();
    if (
      ["self-check", "review"].includes(expected) &&
      status.running.includes(expected)
    )
      return { run, node: await run.continuation(expected) };
    const ready = status.ready.find((n) => n.id === expected);
    if (!ready)
      fail(
        "KIT_ROLE_WAIT",
        `Role cannot dispatch ${expected}: ${status.action}. Reconcile the existing run; do not replace it.`,
      );
    const result = await run.start(ready.id, ready.token);
    if (!result.started)
      fail("KIT_PROTOCOL", "CLI did not return its started task.");
    return { run, node: result.started };
  }
  packet(packet: RolePacket, stage: Stage): RolePacket {
    return {
      ...packet,
      kit: {
        version: "4.1.0",
        assignment: stage.run.assignment,
        node: stage.node,
      },
    };
  }
  async beginEngineer(
    taskId: string,
    attempt: ReturnType<HandoffLedger["prepare"]>,
  ) {
    const run = await this.developer(taskId, attempt.origin);
    const previous = this.#verification.latest(taskId);
    if (previous?.state === "fix_required") {
      const state = await run.status();
      // A prior successful feedback call already exposes implement as ready.
      if (!state.ready.some((n) => n.id === "implement"))
        await run.feedback(
          state.revisionToken,
          "implement",
          "Office review/verification requires changes on the submitted revision.",
          JSON.stringify({
            round: previous.id,
            candidate: previous.candidate.digest,
            results: previous.nodes,
            integrationFeedback: previous.integrationFeedback,
          }),
        );
    }
    return this.#start(run, "implement");
  }
  async finishEngineer(stage: Stage, round: Round) {
    await stage.run.record(
      stage.node,
      {
        summary: "Office received and froze the stopped Developer workspace.",
        producedRevision: round.candidate.digest,
      },
      { passed: true },
      JSON.stringify({
        round: round.id,
        candidate: round.candidate.digest,
        handoff: this.#handoffs.forRound(round.id).leaseId,
      }),
    );
  }
  async beginSelfCheck(round: Round) {
    const run = await this.developer(
      round.taskId,
      this.#handoffs.forRound(round.id).baseline,
    );
    const status = await run.status();
    if (
      status.action === "role-complete" ||
      status.failed.some((n) => n.id === "self-check")
    )
      return null;
    return this.#start(run, "self-check");
  }
  async finishSelfCheck(stage: Stage, round: Round) {
    const checks = round.nodes.filter((n) => n.kind === "test");
    if (!checks.length || checks.some((n) => !n.result))
      fail("KIT_ROLE_WAIT", "Self-check awaits actual verifier results.");
    const passed = checks.every((n) => n.result?.verdict === "pass");
    await stage.run.record(
      stage.node,
      {
        summary: "Registered checks executed on the produced snapshot.",
        producedRevision: round.candidate.digest,
      },
      passed
        ? { passed: true }
        : {
            passed: false,
            action: checks.some((n) => n.result?.verdict === "unknown")
              ? "human"
              : "fix",
            feedback:
              "Registered checks did not pass; see captured observations.",
          },
      JSON.stringify(checks),
      round.candidate,
    );
  }
  async beginReview(round: Round) {
    const run = await this.#open(
      round.taskId,
      "reviewer",
      round.candidate,
      round.id,
    );
    return this.#start(run, "review");
  }
  async finishReview(stage: Stage, round: Round) {
    const result = round.nodes.find((n) => n.kind === "review")?.result;
    if (!result) fail("KIT_ROLE_WAIT", "Review has no captured result.");
    const performed = result.verdict !== "unknown";
    await stage.run.record(
      stage.node,
      {
        summary: "Independent readonly review of the submitted snapshot.",
        reviewedRevision: round.candidate.digest,
        verdict: result.verdict === "pass" ? "pass" : "needs_changes",
        observation: result.observation,
      },
      performed
        ? { passed: true }
        : {
            passed: false,
            action: "human",
            feedback: "Reviewer did not produce a valid closed observation.",
          },
      JSON.stringify(result),
      round.candidate,
    );
  }
  async verifyCompletion(round: Round) {
    const developer = await this.developer(
      round.taskId,
      this.#handoffs.forRound(round.id).baseline,
    );
    const reviewer = await this.#open(
      round.taskId,
      "reviewer",
      round.candidate,
      round.id,
    );
    const d = await developer.completionProof(),
      r = await reviewer.completionProof();
    if (
      d.status.submission?.output.producedRevision !== round.candidate.digest ||
      r.status.submission?.output.reviewedRevision !== round.candidate.digest ||
      r.status.submission?.output.verdict !== "pass"
    )
      fail(
        "KIT_EVIDENCE_REQUIRED",
        "Developer and independent Reviewer must complete on the same candidate with a passing product verdict.",
      );
    this.#store.recordKitReceipt(round.taskId, round.candidate.digest, [
      ...d.files,
      ...r.files,
    ]);
  }
}
