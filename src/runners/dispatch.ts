import { OfficeError } from "../cli/project.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { ContainerVerifier } from "./container-verifier.ts";
import { runRegisteredCheck } from "./verification.ts";

/** Controller-internal deterministic fan-out. Review stays a required separate node.
 * The ledger owns global capacity and deduplication across dispatcher invocations.
 * No externally occupied slot is retried in a busy loop; the caller may dispatch
 * again when capacity changes. Every locally started supervisor is awaited.
 */
export async function runRegisteredChecks(
  execution: ExecutionLedger,
  verification: VerificationLedger,
  verifier: ContainerVerifier,
  roundId: string,
  signal?: AbortSignal,
) {
  const initial = verification.get(roundId);
  const pending = initial.nodes.filter((n) => n.kind === "test" && !n.result);
  const controller = new AbortController();
  const errors: { nodeId: string; message: string }[] = [];
  let deferredReason: string | null = null;
  let monitorError: unknown;
  const monitor = () => {
    try {
      const round = verification.get(roundId);
      if (signal?.aborted && round.state === "checking") {
        verification.cancel(roundId);
        controller.abort();
      } else if (round.state !== "checking") controller.abort();
    } catch (error) {
      monitorError = error;
      controller.abort();
    }
  };
  // Persist cancellation before signalling workers, so their late observations
  // cannot replace an explicit operator cancellation with an unknown verdict.
  const cancel = () => monitor();
  signal?.addEventListener("abort", cancel, { once: true });
  monitor();
  // Observe external cancellation/invalidation even while every check is waiting.
  const timer = setInterval(monitor, 1000);
  async function worker() {
    while (pending.length) {
      monitor();
      if (controller.signal.aborted) return;
      const node = pending.shift()!;
      try {
        if (
          execution
            .list(initial.taskId)
            .some((l) => l.round_id === roundId && l.node_id === node.id)
        )
          continue;
        await runRegisteredCheck(
          execution,
          verification,
          verifier,
          roundId,
          node.id,
          controller.signal,
        );
      } catch (error) {
        const code = error instanceof OfficeError ? error.code : null;
        if (
          code === "SLOT_LIMIT" ||
          code === "TASK_ACTIVE" ||
          code === "RESOURCE_BUSY"
        ) {
          pending.unshift(node);
          deferredReason = code;
          return;
        }
        if (code === "DUPLICATE_EXECUTION" || code === "STALE_EXECUTION")
          continue;
        if (code === "ROUND_CLOSED") {
          controller.abort();
          return;
        }
        errors.push({
          nodeId: node.id,
          message: error instanceof Error ? error.message : String(error),
        });
        controller.abort();
        verification.requireHuman(
          roundId,
          code === "TIME_BUDGET"
            ? "EXECUTION_BUDGET_EXHAUSTED"
            : "DISPATCH_FAILED",
        );
        return;
      }
    }
  }
  try {
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(3, pending.length) }, () => worker()),
    );
    monitor();
    if (monitorError) throw monitorError;
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  } finally {
    controller.abort();
    clearInterval(timer);
    signal?.removeEventListener("abort", cancel);
  }
  const round = verification.get(roundId);
  const remaining = round.nodes
    .filter((n) => n.kind === "test" && !n.result)
    .map((n) => n.id);
  return {
    round,
    executions: execution.list(initial.taskId),
    pending: remaining,
    deferredReason: remaining.length ? deferredReason : null,
    errors,
  };
}
