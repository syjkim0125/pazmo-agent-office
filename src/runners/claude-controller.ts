import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyControllerBinary } from "./codex-profile.ts";
import {
  checkClaudeInit,
  claudeProfile,
  isHookEvent,
  normalizeClaudeStream,
} from "./claude-profile.ts";
import { openExecRelay } from "./exec-relay.ts";
import type { CommandResult } from "./command.ts";
import type { RemoteJob } from "./remote-job.ts";

export type ClaudeSelection = {
  binary: string;
  sha256: string;
  model: string;
  effort?: string;
};
const bridge = fileURLToPath(new URL("./claude-tool-bridge.mjs", import.meta.url));
const rawLimit = 4 * 1024 * 1024;

const failed = (error: string, extra: Partial<CommandResult> = {}): CommandResult => ({
  exitCode: null,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  error,
  ...extra,
});

/** Runs one claude turn; the first init event is checked before anything else. */
function runClaude(
  binary: string,
  args: string[],
  o: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    prompt: string;
    timeoutMs: number;
    signal: AbortSignal;
    mode: "live" | "fixture";
  },
): Promise<{ exited: boolean; result: CommandResult }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: o.cwd,
      env: o.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let raw = "",
      stderr = "",
      pending = "",
      error: string | null = null,
      sawInit = false,
      timedOut = false;
    const stop = (reason: string) => {
      error ??= reason;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop("TIMEOUT");
    }, o.timeoutMs);
    const abort = () => stop("CANCELLED");
    o.signal.addEventListener("abort", abort, { once: true });
    // Decode across chunk boundaries; a split multi-byte character must not corrupt reports.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      raw += chunk;
      pending += chunk;
      if (raw.length > rawLimit) return stop("OUTPUT_LIMIT");
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (isHookEvent(event)) return stop("CLAUDE_HOOK_UNEXPECTED");
        if (!sawInit && event?.type === "system" && event.subtype === "init") {
          sawInit = true;
          const problem = checkClaudeInit(event, o.mode);
          if (problem) return stop(problem);
        } else if (!sawInit && event?.type !== "system")
          return stop("CLAUDE_INIT_MISSING");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("error", () => stop("CLAUDE_SPAWN_FAILED"));
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      o.signal.removeEventListener("abort", abort);
      const stdout = error ? normalizeClaudeStream("") : normalizeClaudeStream(raw);
      if (!error && exitCode === 0 && !stdout.includes('"turn.completed"'))
        error = "MISSING_TURN_COMPLETION";
      resolve({
        exited: true,
        result: { exitCode, signal, stdout, stderr, timedOut, error },
      });
    });
    child.stdin.end(o.prompt);
  });
}

/** Internal, opt-in claude role caller with the same lease/VM ownership as
 * codexJob. Tools exist only as the Office bridge to this job's executor. */
export function claudeJob(
  options: {
    selection: ClaudeSelection;
    binary: string;
    home: string;
    timeoutMs: number;
    openExecutor: (handle: string) => ChildProcessWithoutNullStreams;
    mode?: "live" | "fixture";
    /** Fixture-only additions (fake API endpoint); refused for live runs. */
    env?: NodeJS.ProcessEnv;
  },
  prompt: string,
): RemoteJob {
  const mode = options.mode ?? "live";
  if (
    !prompt.trim() ||
    Buffer.byteLength(prompt) > 128 * 1024 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    (mode === "live" && options.env)
  )
    throw new Error("INVALID_CLAUDE_JOB");
  return {
    binary: options.binary,
    timeoutMs: options.timeoutMs,
    async supervise(handle, timeoutMs, signal) {
      if (signal.aborted) return { closed: true, result: failed("CANCELLED") };
      const { selection } = options;
      verifyControllerBinary(selection.binary, selection.sha256);
      const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-claude-controller-")));
      const failure = new AbortController();
      let relay: Awaited<ReturnType<typeof openExecRelay>> | undefined;
      let run: Awaited<ReturnType<typeof runClaude>> | undefined;
      let closed = false;
      try {
        relay = await openExecRelay(
          () => options.openExecutor(handle),
          () => failure.abort(),
        );
        const mcpConfig = join(root, "mcp.json");
        writeFileSync(
          mcpConfig,
          JSON.stringify({
            mcpServers: { office: { command: process.execPath, args: [bridge, relay.url] } },
          }),
          { mode: 0o600, flag: "wx" },
        );
        const profile = claudeProfile({
          home: options.home,
          mcpConfig,
          model: selection.model,
          ...(selection.effort ? { effort: selection.effort } : {}),
        });
        run = await runClaude(selection.binary, profile.args, {
          cwd: root,
          env: { ...profile.env, ...(mode === "fixture" ? options.env : {}) },
          prompt,
          timeoutMs,
          signal: AbortSignal.any([signal, failure.signal]),
          mode,
        });
      } finally {
        closed = (await relay?.close()) ?? true;
        closed = closed && run?.exited !== false;
        if (closed) rmSync(root, { recursive: true, force: true });
      }
      if (!run) throw new Error("CONTROLLER_RESULT_MISSING");
      let result = run.result;
      // A transport failure is the cause of any abort it triggered.
      const transport = relay?.failure();
      if (transport)
        result = { ...result, error: transport, stdout: normalizeClaudeStream("") };
      return { closed, result };
    },
  };
}
