import { fail } from "../cli/project.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { ContainerVerifier } from "./container-verifier.ts";

/** Internal controller path. The public Office execution gate stays locked. */
export async function runRegisteredCheck(
  execution: ExecutionLedger,
  verification: VerificationLedger,
  verifier: ContainerVerifier,
  roundId: string,
  nodeId: string,
  signal?: AbortSignal,
) {
  const round = verification.get(roundId),
    node = round.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== "test")
    return fail(
      "INVALID_EXECUTION",
      "This runner only executes registered deterministic tests.",
    );
  const lease = execution.reserveNode(roundId, nodeId);
  let report;
  try {
    report = await verifier.run(
      round.candidate,
      node.check,
      (handle) => {
        execution.start(lease.id, handle);
        return lease.deadline - Date.now();
      },
      signal,
    );
  } catch (error) {
    // A rejected supervisor promise is not evidence that its process stopped.
    execution.markUnknown(lease.id);
    throw error;
  }
  let recordingError: string | null = null;
  try {
    if (report.handle && execution.get(lease.id).state === "running")
      execution.finish(lease.id, report.handle, {
        closed: report.closed,
        observation: report.observation,
      });
    else execution.markUnknown(lease.id);
  } catch (error) {
    recordingError = error instanceof Error ? error.message : String(error);
    execution.markUnknown(lease.id);
  }
  return {
    report,
    recordingError,
    lease: execution.get(lease.id),
    round: verification.get(roundId),
  };
}
