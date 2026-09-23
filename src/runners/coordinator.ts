import { OfficeError } from "../cli/project.ts";
import type { OfficeStore } from "../core/store.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { HandoffLedger } from "../core/handoffs.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type {
  ContainerWorkspace,
  ContainerReviewer,
  ContainerVerifier,
} from "./container-verifier.ts";
import type { RemoteJob } from "./remote-job.ts";
import { runEngineerJob } from "./engineer.ts";
import { runRegisteredReview } from "./reviewer.ts";
import { runRegisteredChecks } from "./dispatch.ts";
import { captureCandidateDiff } from "./candidate-diff.ts";
import { rolePacket } from "./role-context.ts";
import type { RolePacket } from "./role-context.ts";
import type { KitDelivery } from "./kit-delivery.ts";

type Dependencies = {
  store: OfficeStore;
  execution: ExecutionLedger;
  handoffs: HandoffLedger;
  verification: VerificationLedger;
  workspace: ContainerWorkspace;
  reviewer: ContainerReviewer;
  verifier: ContainerVerifier;
  // Trusted construction only; execution starts in the reserved runner, not here.
  jobFor: (packet: RolePacket) => RemoteJob;
  roles?: KitDelivery;
};
const capacity = new Set([
  "SLOT_LIMIT",
  "ENGINEER_LIMIT",
  "TASK_ACTIVE",
  "RESOURCE_BUSY",
  "DUPLICATE_EXECUTION",
  "STALE_EXECUTION",
]);

/** Internal orchestration of the existing queue. No public or authenticated launch. */
export class OfficeCoordinator {
  #d: Dependencies;
  #active = new Set<string>();
  constructor(dependencies: Dependencies) {
    this.#d = dependencies;
  }
  async run(taskId: string, signal?: AbortSignal) {
    const d = this.#d;
    const result = (state: string, reason: string | null = null) => ({
      state,
      reason,
      round: d.verification.latest(taskId),
      executions: d.execution.list(taskId),
    });
    if (!d.roles && d.store.kitAssignments(taskId).length)
      return result("human_required", "KIT_REQUIRED");
    if (d.store.get(taskId).status === "done") {
      const delivered = d.verification.latest(taskId);
      if (delivered) d.store.kitReceipt(taskId, delivered.candidate.digest);
      if (d.store.get(taskId).status === "done") return result("delivered");
    }
    if (this.#active.has(taskId))
      return result("deferred", "COORDINATOR_ACTIVE");
    this.#active.add(taskId);
    const abort = new AbortController();
    let monitorError: unknown;
    const cancel = () => {
      d.store.cancelExecution(taskId);
      const round = d.verification.latest(taskId);
      if (round) d.verification.cancel(round.id);
      abort.abort();
    };
    const monitor = () => {
      try {
        if (signal?.aborted) {
          cancel();
          return;
        }
        const item = d.store.get(taskId),
          round = d.verification.latest(taskId);
        if (
          !item.ready ||
          item.status === "cancelled" ||
          (round && ["cancelled", "human_required"].includes(round.state))
        )
          abort.abort();
      } catch (error) {
        monitorError = error;
        abort.abort();
      }
    };
    signal?.addEventListener("abort", monitor, { once: true });
    const timer = setInterval(monitor, 1000);
    try {
      for (;;) {
        monitor();
        if (monitorError) throw monitorError;
        const item = d.store.get(taskId);
        let round = d.verification.latest(taskId);
        if (item.status === "cancelled") return result("cancelled");
        if (!item.ready) return result("approval_required", item.blocker);
        if (d.roles && round?.state === "awaiting_g4")
          await d.roles.verifyCompletion(round);
        if (round && !["checking", "fix_required"].includes(round.state))
          return result(round.state, round.reason);
        if (abort.signal.aborted)
          return result("human_required", "COORDINATOR_ABORTED");
        const leases = d.execution.list(taskId);
        if (leases.some((l) => l.state === "unknown"))
          return result("human_required", "PROCESS_LIVENESS_UNKNOWN");
        if (leases.some((l) => l.state !== "released"))
          return result("deferred", "TASK_ACTIVE");
        const lastHandoff = d.handoffs.list(taskId).at(-1);
        if (lastHandoff?.state === "human_required")
          return result(
            "human_required",
            lastHandoff.reason ?? "ENGINEER_FAILED",
          );
        if (!round || round.state === "fix_required") {
          const prepared = d.roles
            ? d.handoffs.prepare(taskId, 240000)
            : undefined;
          let stage;
          let job;
          try {
            stage =
              d.roles && prepared
                ? await d.roles.beginEngineer(taskId, prepared)
                : undefined;
            const packet = rolePacket(d.store, taskId, "engineer", round);
            job = d.jobFor(stage ? d.roles!.packet(packet, stage) : packet);
          } catch (error) {
            if (prepared) d.execution.markUnknown(prepared.leaseId);
            throw error;
          }
          const ran = await runEngineerJob(
            d.execution,
            d.handoffs,
            d.workspace,
            taskId,
            job,
            abort.signal,
            prepared,
          );
          if (ran.handoff.state !== "candidate_frozen") {
            if (d.store.get(taskId).status === "cancelled")
              return result("cancelled");
            return result(
              "human_required",
              ran.recordingError ?? ran.handoff.reason ?? "ENGINEER_FAILED",
            );
          }
          if (stage && ran.handoff.round)
            await d.roles!.finishEngineer(stage, ran.handoff.round);
          continue;
        }
        if (d.roles) {
          const checkStage = await d.roles.beginSelfCheck(round);
          if (checkStage) {
            const checked = await runRegisteredChecks(
              d.execution,
              d.verification,
              d.verifier,
              round.id,
              abort.signal,
            );
            round = d.verification.get(round.id);
            if (round.state !== "checking")
              return result(round.state, round.reason);
            if (checked.pending.length)
              return result(
                "deferred",
                checked.deferredReason ?? "VERIFICATION_PENDING",
              );
            await d.roles.finishSelfCheck(checkStage, round);
          }
        }
        const initialResults = round.nodes.filter((n) => n.result).length;
        const review = round.nodes.find(
          (n) => n.kind === "review" && !n.result,
        );
        let job: RemoteJob | undefined;
        let reviewStage;
        if (review) {
          const origin = d.handoffs.forRound(round.id).baseline;
          const diff = await captureCandidateDiff(origin, round.candidate);
          monitor();
          round = d.verification.get(round.id);
          if (round.state !== "checking" || abort.signal.aborted) continue;
          reviewStage = d.roles ? await d.roles.beginReview(round) : undefined;
          const packet = rolePacket(d.store, taskId, "reviewer", round, diff);
          job = d.jobFor(
            reviewStage ? d.roles!.packet(packet, reviewStage) : packet,
          );
        }
        // Reserve the reviewer first; tests use remaining global capacity.
        const reviewing =
          review && job
            ? runRegisteredReview(
                d.execution,
                d.verification,
                d.reviewer,
                round.id,
                review.id,
                job,
                abort.signal,
              )
            : Promise.resolve(null);
        const outcomes = await Promise.allSettled([
          reviewing,
          runRegisteredChecks(
            d.execution,
            d.verification,
            d.verifier,
            round.id,
            abort.signal,
          ),
        ]);
        let deferred: string | null = null;
        for (const outcome of outcomes)
          if (outcome.status === "rejected") {
            const code =
              outcome.reason instanceof OfficeError
                ? outcome.reason.code
                : "SUPERVISOR_FAILED";
            if (capacity.has(code)) deferred = code;
            else if (code !== "ROUND_CLOSED")
              d.verification.requireHuman(round.id, "DISPATCH_FAILED");
          }
        monitor();
        const current = d.verification.get(round.id);
        if (
          reviewStage &&
          current.nodes.some((n) => n.kind === "review" && n.result)
        )
          await d.roles!.finishReview(reviewStage, current);
        if (
          current.state === "checking" &&
          current.nodes.filter((n) => n.result).length === initialResults
        )
          return result(
            "deferred",
            deferred ?? "CAPACITY_OR_EXECUTION_PENDING",
          );
      }
    } catch (error) {
      const code =
        error instanceof OfficeError ? error.code : "COORDINATOR_FAILED";
      const round = d.verification.latest(taskId);
      if (round && !capacity.has(code))
        d.verification.requireHuman(
          round.id,
          code === "TIME_BUDGET"
            ? "EXECUTION_BUDGET_EXHAUSTED"
            : "DISPATCH_FAILED",
        );
      return result(capacity.has(code) ? "deferred" : "human_required", code);
    } finally {
      abort.abort();
      clearInterval(timer);
      signal?.removeEventListener("abort", monitor);
      this.#active.delete(taskId);
    }
  }
}
