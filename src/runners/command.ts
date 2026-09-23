import { spawn } from "node:child_process";

export type CommandResult = {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
  stdoutBytes?: Buffer;
};
type Options = {
  timeoutMs: number;
  maxBytes: number;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  cwd?: string;
  captureBytes?: boolean;
};

/** Only launches trusted controller tools. Killing a CLI does not prove that its
 * remote container stopped; the container supervisor must establish that separately.
 */
export async function runCommand(
  executable: string,
  argv: string[],
  options: Options,
): Promise<CommandResult> {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    !Number.isInteger(options.maxBytes) ||
    options.maxBytes < 1
  )
    throw new Error("A positive timeout and output bound are required.");
  const base: CommandResult = {
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    error: null,
  };
  if (options.signal?.aborted) return { ...base, error: "CANCELLED" };
  return new Promise((resolve) => {
    const child = spawn(executable, argv, {
      env: options.env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: false,
    });
    const out: Buffer[] = [],
      err: Buffer[] = [];
    let size = 0,
      done = false,
      grace: NodeJS.Timeout | undefined;
    const finish = (code: number | null, signal: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(grace);
      options.signal?.removeEventListener("abort", cancel);
      const stdout = Buffer.concat(out);
      resolve({
        ...base,
        exitCode: code !== null && code >= 0 ? code : null,
        signal,
        stdout: stdout.toString("utf8"),
        ...(options.captureBytes ? { stdoutBytes: stdout } : {}),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    };
    const stop = (reason: string) => {
      if (base.error) return;
      base.error = reason;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            base.error += ":KILL_FAILED";
        }
      }
      grace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        base.error += ":CLI_CLOSE_UNCONFIRMED";
        finish(null, null);
      }, 5000);
    };
    const cancel = () => stop("CANCELLED");
    const timer = setTimeout(() => {
      base.timedOut = true;
      stop("TIMEOUT");
    }, options.timeoutMs);
    const capture = (chunks: Buffer[], chunk: Buffer) => {
      const remaining = Math.max(0, options.maxBytes - size);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      size += chunk.length;
      if (size > options.maxBytes) stop("OUTPUT_LIMIT");
    };
    child.stdout.on("data", (chunk: Buffer) => capture(out, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(err, chunk));
    child.once("error", (error) => {
      base.error = (error as NodeJS.ErrnoException).code ?? error.message;
    });
    child.once("close", finish);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
  });
}
