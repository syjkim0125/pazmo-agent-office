import type { CommandResult } from "./command.ts";

export type RemoteJob = {
  binary: string;
  timeoutMs: number;
  supervise: (
    handle: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<{ closed: boolean; result: CommandResult }>;
};

/** Cancellation is sticky; a late successful controller cannot revive an aborted job. */
export async function superviseRemote(
  job: RemoteJob,
  handle: string,
  timeoutMs: number,
  parent?: AbortSignal,
) {
  const failure = (message: string): CommandResult => ({
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: message === "TIMEOUT",
    error: message,
  });
  if (parent?.aborted) return { closed: true, result: failure("CANCELLED") };
  const abort = new AbortController();
  let reason = "CANCELLED",
    wake: () => void = () => {};
  const cancel = () => {
    abort.abort();
    wake();
  };
  const timer = setTimeout(() => {
    if (abort.signal.aborted) return;
    reason = "TIMEOUT";
    cancel();
  }, timeoutMs);
  const aborted = new Promise<null>((resolve) => {
    wake = () => resolve(null);
  });
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  const running = Promise.resolve()
    .then(() => job.supervise(handle, timeoutMs, abort.signal))
    .catch((error) => ({
      closed: false,
      result: failure(
        error instanceof Error ? error.message : "CONTROLLER_FAILED",
      ),
    }));
  let grace: NodeJS.Timeout | undefined;
  try {
    const first = await Promise.race([running, aborted]);
    if (first && !abort.signal.aborted) return first;
    // The trusted supervisor has time to reap its local process group after abort.
    const terminal = await Promise.race([
      running,
      new Promise<null>((resolve) => {
        grace = setTimeout(() => resolve(null), 5500);
      }),
    ]);
    return { closed: terminal?.closed === true, result: failure(reason) };
  } finally {
    clearTimeout(timer);
    clearTimeout(grace);
    parent?.removeEventListener("abort", cancel);
  }
}
