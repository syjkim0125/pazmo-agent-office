import type { ExecutionLedger } from "../core/budgets.ts";
import type { HandoffLedger } from "../core/handoffs.ts";
import type { ContainerWorkspace } from "./container-verifier.ts";
import type { RemoteJob } from "./remote-job.ts";

/** Controller-internal job path. The supplied job is a trusted supervisor command,
 * not proof that Codex ran, and it is never executed on the controller host.
 */
export async function runEngineerJob(
  execution: ExecutionLedger,
  handoffs: HandoffLedger,
  runner: ContainerWorkspace,
  taskId: string,
  job: { argv: string[]; timeoutMs: number } | RemoteJob,
  signal?: AbortSignal,
  prepared?: ReturnType<HandoffLedger["prepare"]>,
) {
  const attempt = prepared ?? handoffs.prepare(taskId, job.timeoutMs);
  let report;
  try {
    const beforeStart = (handle: string) => {
      handoffs.start(attempt.leaseId, handle);
      return execution.get(attempt.leaseId).deadline - Date.now();
    };
    report =
      "supervise" in job
        ? await runner.runRemote(
            attempt.baseline,
            attempt.scope,
            attempt.workspace,
            job,
            beforeStart,
            signal,
          )
        : await runner.run(
            attempt.baseline,
            attempt.scope,
            attempt.workspace,
            job,
            beforeStart,
            signal,
          );
  } catch (error) {
    execution.markUnknown(attempt.leaseId);
    throw error;
  }
  let recordingError: string | null = null;
  try {
    if (report.handle && execution.get(attempt.leaseId).state === "running")
      handoffs.finish(attempt.leaseId, report.handle, report);
    else execution.markUnknown(attempt.leaseId);
  } catch (error) {
    recordingError = error instanceof Error ? error.message : String(error);
    if (execution.get(attempt.leaseId).state !== "released")
      execution.markUnknown(attempt.leaseId);
  }
  return {
    report,
    recordingError,
    lease: execution.get(attempt.leaseId),
    handoff: handoffs.get(attempt.leaseId),
  };
}
