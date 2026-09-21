import { fail } from "../cli/project.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { ContainerReviewer } from "./container-verifier.ts";
import type { RemoteJob } from "./remote-job.ts";

/** Controller-only review entry. A review never edits or replaces its candidate. */
export async function runRegisteredReview(
  execution: ExecutionLedger,
  verification: VerificationLedger,
  reviewer: ContainerReviewer,
  roundId: string,
  nodeId: string,
  job: RemoteJob,
  signal?: AbortSignal,
) {
  const round = verification.get(roundId),
    node = round.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== "review")
    return fail(
      "INVALID_EXECUTION",
      "This runner only executes the required review node.",
    );
  const lease = execution.reserveNode(roundId, nodeId, [], job.timeoutMs);
  let report;
  try {
    report = await reviewer.run(
      round.candidate,
      round.contractDigest,
      job,
      (handle) => {
        execution.start(lease.id, handle);
        return lease.deadline - Date.now();
      },
      signal,
    );
  } catch (error) {
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
