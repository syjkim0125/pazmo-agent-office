import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { codexJob } from "../runners/codex-controller.ts";
import { verifyControllerBinary } from "../runners/codex-profile.ts";
import { claudeJob } from "../runners/claude-controller.ts";
import type { RunnerInstall, RunnerName } from "../runners/runner-discovery.ts";
import type { Qualification } from "../runners/runner-qualification.ts";
import type { RemoteJob } from "../runners/remote-job.ts";
import type { ExecutingRole } from "../runners/role-profiles.ts";
import type { RunnerRun } from "../core/runner-evidence.ts";
import type { RunnerChoice } from "./runner-settings.ts";

export type RoleJobDependencies = {
  choice: (role: ExecutingRole) => RunnerChoice;
  installs: () => Record<RunnerName, RunnerInstall>;
  /** Re-runs discovery, e.g. after the CLI updated itself. */
  rediscover?: () => Promise<Record<RunnerName, RunnerInstall>>;
  qualify: (
    install: RunnerInstall,
    model: string,
    signal?: AbortSignal,
  ) => Promise<Pick<Qualification, "passed" | "checks" | "catalog">>;
  evidence: { record: (r: RunnerRun) => void };
  executor: string;
  authHome: string;
  home: string;
  pinnedController: string;
  codexRuntime?: "installed" | "pinned";
  openExecutor: (handle: string) => ChildProcessWithoutNullStreams;
  timeoutMs: number;
  jobs?: { codex: typeof codexJob; claude: typeof claudeJob };
};

const refused = (error: string) => ({
  closed: true,
  result: { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, error },
});

/** Role → saved runner choice → qualified user CLI job. Refusals happen before
 * any process starts and never fall back to another runner or an API key. */
export function roleJobFactory(d: RoleJobDependencies) {
  const jobs = d.jobs ?? { codex: codexJob, claude: claudeJob };
  return (role: ExecutingRole, taskId: string, prompt: string): RemoteJob => {
    const choice = d.choice(role);
    const base = { binary: d.executor, timeoutMs: d.timeoutMs, openExecutor: d.openExecutor };
    if (choice.runner === "codex" && d.codexRuntime === "pinned")
      return jobs.codex({ ...base, controller: d.pinnedController, authHome: d.authHome }, prompt);
    return {
      binary: d.executor,
      timeoutMs: d.timeoutMs,
      async supervise(handle, timeoutMs, signal) {
        const ready = (i: RunnerInstall) =>
          i.status === "ready" && i.loggedIn && !i.blocked && !!i.path && !!i.sha256 && !!i.version;
        const unchanged = (i: RunnerInstall) => {
          try {
            verifyControllerBinary(i.path!, i.sha256);
            return true;
          } catch {
            return false;
          }
        };
        let install = d.installs()[choice.runner];
        if (!ready(install)) return refused(`RUNNER_NOT_READY: ${install.hint}`);
        // An updated CLI is a new binary: rediscover it and qualify it afresh.
        if (!unchanged(install) && d.rediscover) install = (await d.rediscover())[choice.runner];
        if (!ready(install)) return refused(`RUNNER_NOT_READY: ${install.hint}`);
        if (!unchanged(install)) return refused("UNVERIFIED_CONTROLLER_BINARY");
        let q: Awaited<ReturnType<RoleJobDependencies["qualify"]>>;
        try {
          q = await d.qualify(install, choice.model, signal);
        } catch (error) {
          if (signal.aborted) return refused("CANCELLED");
          return refused(
            "RUNNER_QUALIFICATION_FAILED: " + (error instanceof Error ? error.message : String(error)),
          );
        }
        if (signal.aborted) return refused("CANCELLED");
        if (!q.passed)
          return refused(
            "RUNNER_QUALIFICATION_FAILED: " + q.checks.filter((c) => !c.passed).map((c) => c.name).join(","),
          );
        const selection = { binary: install.path!, sha256: install.sha256!, model: choice.model };
        const inner =
          choice.runner === "codex"
            ? jobs.codex(
                {
                  ...base,
                  authHome: d.authHome,
                  selection: {
                    ...selection,
                    catalog: q.catalog!,
                    ...(choice.reasoning ? { reasoning: choice.reasoning } : {}),
                  },
                },
                prompt,
              )
            : jobs.claude(
                {
                  ...base,
                  home: d.home,
                  selection: { ...selection, ...(choice.reasoning ? { effort: choice.reasoning } : {}) },
                },
                prompt,
              );
        d.evidence.record({
          taskId,
          role,
          runner: choice.runner,
          version: install.version!,
          sha256: install.sha256!,
          model: choice.model,
          reasoning: choice.reasoning,
        });
        return inner.supervise(handle, timeoutMs, signal);
      },
    };
  };
}
