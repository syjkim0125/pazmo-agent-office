import { OfficeError } from "../cli/project.ts";
import { legacyPlanning, legacyPlanningReason, noteLegacyTask } from "../core/legacy-tasks.ts";
import type { IntakeLedger } from "../core/intake.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { Candidate } from "../core/candidates.ts";
import type { ContainerPlanner } from "./container-verifier.ts";
import type { RemoteJob } from "./remote-job.ts";
import { planningPrompt } from "./planning.ts";
import { saveRejectedOutput } from "./planning-output.ts";
import type { PlanningPacket } from "./planning.ts";

type Dependencies = {
  /** Project-private data directory for rejected model output. */
  dataDir?: string;
  intake: IntakeLedger;
  execution: ExecutionLedger;
  planner: ContainerPlanner;
  jobFor: (
    packet: PlanningPacket,
    context: Candidate,
    prompt: string,
  ) => RemoteJob;
};
const pending = (state: string) =>
  ["waiting_pm", "waiting_lead"].includes(state);

/** Controller-only PM→Lead flow on Office's intake and lease ledgers: one model turn per conversation revision (a
 * revision keeps its one lease, `reservePlanning`). No public launch, publication, or approval authority. */
export class PlanningCoordinator {
  #d: Dependencies;
  #active = new Set<string>();
  constructor(dependencies: Dependencies) {
    this.#d = dependencies;
  }
  async run(taskId: string, context: Candidate, parent?: AbortSignal) {
    const { intake, execution, planner, jobFor } = this.#d;
    const view = (deferred = false) => {
      const item = intake.get(taskId);
      return {
        state: deferred ? ("deferred" as const) : item.state,
        intake: item,
      };
    };
    if (this.#active.has(taskId)) return view(true);
    this.#active.add(taskId);
    try {
      for (;;) {
        const leases = execution.listPlanning(taskId);
        const item = intake.get(taskId);
        if (!pending(item.state)) return view();
        if (parent?.aborted) {
          intake.interrupt(
            taskId,
            item.revision,
            item.inputDigest,
            "CONTROLLER_CANCELLED",
          );
          return view();
        }
        if (leases.some((l) => l.state !== "released")) return view(true);
        let lease;
        try {
          const packet = intake.packet(taskId, item.revision, item.inputDigest);
          if (legacyPlanning(packet)) {
            noteLegacyTask(taskId);
            intake.interrupt(taskId, item.revision, item.inputDigest, legacyPlanningReason(packet));
            return view();
          }
          const prompt = planningPrompt(packet, context);
          const job = jobFor(packet, context, prompt);
          lease = execution.reservePlanning(
            taskId,
            item.revision,
            item.inputDigest,
            context.digest,
            job.timeoutMs,
          );
          const abort = new AbortController();
          let monitorError: unknown;
          const inspect = () => {
            try {
              if (parent?.aborted)
                intake.interrupt(
                  taskId,
                  item.revision,
                  item.inputDigest,
                  "CONTROLLER_CANCELLED",
                );
              execution.expire();
              const current = intake.get(taskId);
              if (
                current.revision !== item.revision ||
                !pending(current.state) ||
                execution.getPlanning(lease!.id).state === "unknown"
              )
                abort.abort();
            } catch (error) {
              monitorError = error;
              abort.abort();
            }
          };
          const timer = setInterval(inspect, 1000);
          parent?.addEventListener("abort", inspect);
          try {
            inspect();
            const report = await planner.run(
              context,
              job,
              (handle) => {
                inspect();
                const started = execution.startPlanning(lease!.id, handle);
                return started.deadline - Date.now();
              },
              abort.signal,
            );
            inspect();
            if (monitorError) throw monitorError;
            if (
              report.handle &&
              execution.getPlanning(lease.id).state === "running"
            ) {
              const archive = () =>
                saveRejectedOutput(
                  this.#d.dataDir,
                  taskId,
                  item.revision,
                  report.result.stdout,
                );
              const accept = () =>
                intake.accept(
                  taskId,
                  item.revision,
                  item.inputDigest,
                  { closed: report.closed, result: report.result },
                  archive,
                );
              execution.finishPlanning(
                lease.id,
                report.handle,
                {
                  closed: report.closed,
                  result: report.result,
                },
                accept,
              );
            } else if (!report.handle && report.closed && report.cleanupErrors.length === 0) {
              execution.failPlanningPreparation(lease.id, report.result.error ?? "VM_PREPARATION_FAILED");
            } else execution.markPlanningUnknown(lease.id);
          } finally {
            clearInterval(timer);
            parent?.removeEventListener("abort", inspect);
          }
        } catch (error) {
          if (lease && execution.getPlanning(lease.id).state !== "released")
            execution.markPlanningUnknown(lease.id);
          else if (
            error instanceof OfficeError &&
            ["SLOT_LIMIT", "TASK_ACTIVE", "DUPLICATE_EXECUTION"].includes(
              error.code,
            )
          )
            return view(true);
          intake.interrupt(
            taskId,
            item.revision,
            item.inputDigest,
            error instanceof OfficeError
              ? error.code
              : "PLANNING_EXECUTION_FAILED",
          );
          return view();
        }
      }
    } finally {
      this.#active.delete(taskId);
    }
  }
}
