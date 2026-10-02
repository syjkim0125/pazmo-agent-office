import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { noSymlinks } from "../cli/project.ts";
import {
  CONTROLLER_MODEL,
  codexRemoteProfile,
  verifyControllerBinary,
} from "./codex-profile.ts";
import { openExecRelay } from "./exec-relay.ts";
import { runCommand } from "./command.ts";
import type { CommandResult } from "./command.ts";
import type { RemoteJob } from "./remote-job.ts";

/** Shared lifecycle for the pinned live caller and the credential-free probe.
 * Arguments and executor are controller-owned, never model-supplied. */
export async function runCodexOnRelay(
  controller: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal: AbortSignal;
  },
  relay: Awaited<ReturnType<typeof openExecRelay>>,
) {
  let result: CommandResult;
  let closed = false;
  try {
    result = await runCommand(controller, args, {
      ...options,
      maxBytes: 256 * 1024,
    });
  } finally {
    closed = await relay.close();
  }
  closed = closed && !result.error?.includes("CLI_CLOSE_UNCONFIRMED");
  if (relay.failure()) result = { ...result, error: relay.failure() };
  if (
    result.exitCode === 0 &&
    !result.stdout.split("\n").some((line) => {
      try {
        return JSON.parse(line).type === "turn.completed";
      } catch {
        return false;
      }
    })
  )
    result = { ...result, error: "MISSING_TURN_COMPLETION" };
  return { closed, result };
}

/** Internal, opt-in controller. The caller owns approved task scope, current
 * boundary qualification and the VM lease. No public launch or fallback. */
export function codexJob(
  options: {
    controller: string;
    binary: string;
    authHome: string;
    timeoutMs: number;
    openExecutor: (handle: string) => ChildProcessWithoutNullStreams;
  },
  prompt: string,
): RemoteJob {
  if (
    !prompt.trim() ||
    Buffer.byteLength(prompt) > 128 * 1024 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1
  )
    throw new Error("INVALID_CODEX_JOB");
  return {
    binary: options.binary,
    timeoutMs: options.timeoutMs,
    async supervise(handle, timeoutMs, signal) {
      if (signal.aborted)
        return {
          closed: true,
          result: {
            exitCode: null,
            signal: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            error: "CANCELLED",
          },
        };
      verifyControllerBinary(options.controller);
      noSymlinks(options.authHome);
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), "pazmo-codex-controller-")),
      );
      const failure = new AbortController();
      let relay: Awaited<ReturnType<typeof openExecRelay>> | undefined;
      let result: Awaited<ReturnType<typeof runCodexOnRelay>> | undefined;
      let closed = false;
      try {
        relay = await openExecRelay(
          () => options.openExecutor(handle),
          () => failure.abort(),
        );
        const profile = codexRemoteProfile({
          home: root,
          authHome: options.authHome,
          cwd: root,
          url: relay.url,
          model: CONTROLLER_MODEL,
        });
        result = await runCodexOnRelay(
          options.controller,
          [...profile.args, "--", prompt],
          {
            timeoutMs,
            cwd: root,
            env: profile.env,
            signal: AbortSignal.any([signal, failure.signal]),
          },
          relay,
        );
      } finally {
        closed = (await relay?.close()) ?? true;
        closed = closed && result?.closed !== false;
        // Preserve staging when the controller's lifetime is uncertain.
        if (closed) rmSync(root, { recursive: true, force: true });
      }
      if (!result) throw new Error("CONTROLLER_RESULT_MISSING");
      return { closed, result: result.result };
    },
  };
}
