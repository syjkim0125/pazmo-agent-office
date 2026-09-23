import { OfficeError, fail } from "../cli/project.ts";
import { KitPlanning } from "./kit-planning.ts";
import type { IntakeLedger } from "../core/intake.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { Candidate } from "../core/candidates.ts";
import type { ContainerPlanner } from "./container-verifier.ts";
import type { RemoteJob } from "./remote-job.ts";
import { planningPrompt } from "./planning.ts";
import type { PlanningPacket } from "./planning.ts";

type Dependencies = {
  project?: string;
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

/** Controller-only PM→Lead flow. No public launch, publication, or approval authority. */
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
          const kit = packet.workflow
            ? new KitPlanning(
                this.#d.project ??
                  fail(
                    "KIT_PROJECT_REQUIRED",
                    "Native planning needs its controller project root.",
                  ),
                intake,
              )
            : null;
          const stage = kit
            ? await kit.dispatch(
                taskId,
                item.revision,
                packet,
                context,
                leases.some((l) => l.revision === item.revision),
              )
            : null;
          const prompt = planningPrompt(
            packet,
            context,
            stage
              ? { runFile: stage.run.runFile, node: stage.node }
              : undefined,
          );
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
              let accept: (() => void) | undefined;
              if (stage && kit && report.closed && !abort.signal.aborted) {
                try {
                  accept = await kit.record(stage, {
                    closed: report.closed,
                    result: report.result,
                  });
                } catch (error) {
                  // Role evidence failure is not unknown process liveness. Keep
                  // the failure while still releasing a supervisor-confirmed exit.
                  intake.interrupt(
                    taskId,
                    item.revision,
                    item.inputDigest,
                    error instanceof OfficeError
                      ? error.code
                      : "KIT_PLANNING_FAILED",
                  );
                }
              }
              execution.finishPlanning(
                lease.id,
                report.handle,
                {
                  closed: report.closed,
                  result: report.result,
                },
                accept,
              );
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
