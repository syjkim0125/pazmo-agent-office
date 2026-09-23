import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { OfficeError, fail, noSymlinks } from "../cli/project.ts";
import {
  digest,
  freezeCandidate,
  protectedPath,
  readStable,
  verifyCandidate,
} from "../core/candidates.ts";
import type { Candidate } from "../core/candidates.ts";
import type { IntakeLedger } from "../core/intake.ts";
import type { OfficeStore } from "../core/store.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { HandoffLedger } from "../core/handoffs.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { CompletionLedger } from "../core/completion.ts";
import { UnderstandingRunner } from "../runners/understanding.ts";
import { PlanningCoordinator } from "../runners/planning-coordinator.ts";
import { OfficeCoordinator } from "../runners/coordinator.ts";
import { KitDelivery } from "../runners/kit-delivery.ts";
import { codexJob } from "../runners/codex-controller.ts";
import {
  verifyControllerBinary,
  CONTROLLER_MODEL,
} from "../runners/codex-profile.ts";
import { rolePrompt } from "../runners/role-context.ts";
import { runCommand } from "../runners/command.ts";
import {
  ContainerPlanner,
  ContainerWorkspace,
  ContainerReviewer,
  ContainerVerifier,
  dockerClient,
  EXEC_SERVER_SHA256,
  IMAGE,
} from "../runners/container-verifier.ts";

export type LiveConfig = {
  controller: string;
  binary: string;
  authHome: string;
  socket: string;
};
type Ledgers = {
  store: OfficeStore;
  intake: IntakeLedger;
  execution: ExecutionLedger;
  handoffs: HandoffLedger;
  verification: VerificationLedger;
  completion: CompletionLedger;
};
type Operation =
  | { kind: "planning" | "implementation"; taskId: string }
  | {
      kind: "understanding";
      taskId: string;
      requestId: string;
      answerDigest: string;
    };
type Active = Operation & { abort: AbortController; done: Promise<void> };
type Runners = {
  planning: (id: string, signal: AbortSignal) => Promise<unknown>;
  implementation: (id: string, signal: AbortSignal) => Promise<unknown>;
  understanding: (
    id: string,
    requestId: string,
    answerDigest: string,
    signal: AbortSignal,
  ) => Promise<unknown>;
  dispose: () => void;
};

/** Process ownership only. Existing ledgers and kit remain the work-state owners. */
export class LiveRuntime {
  #ledgers: Ledgers;
  #runners: Runners;
  #active = new Map<string, Active>();
  #closing = false;
  #error: { taskId: string; code: string } | null = null;
  constructor(ledgers: Ledgers, runners: Runners) {
    this.#ledgers = ledgers;
    this.#runners = runners;
  }
  status() {
    return {
      execution: this.#closing ? "stopping" : "ready",
      model: CONTROLLER_MODEL,
      active: [...this.#active.values()].map(({ kind, taskId }) => ({
        kind,
        taskId,
      })),
      lastError: this.#error,
    };
  }
  startPlanning(id: string, revision: number, inputDigest: string) {
    this.#ledgers.intake.packet(id, revision, inputDigest);
    if (
      this.#ledgers.execution
        .listPlanning(id)
        .some((l) => l.state !== "released")
    )
      fail("TASK_ACTIVE", "A planning process is active or requires recovery.");
    return this.#start({ kind: "planning", taskId: id });
  }
  startImplementation(id: string, contractDigest: string) {
    const item = this.#ledgers.store.get(id);
    if (item.contract.digest !== contractDigest)
      fail("CONTRACT_CHANGED", "Inspect the current execution contract.");
    if (!item.ready || ["cancelled", "done"].includes(item.status))
      fail(
        "CONTRACT_NOT_READY",
        "Approve the current execution contract before starting.",
      );
    if (this.#ledgers.execution.list(id).some((l) => l.state !== "released"))
      fail(
        "TASK_ACTIVE",
        "An implementation process is active or requires recovery.",
      );
    return this.#start({ kind: "implementation", taskId: id });
  }
  startUnderstanding(
    token: string,
    id: string,
    requestId: string,
    answerDigest: string,
  ) {
    this.#ledgers.completion.assessmentInput(
      token,
      id,
      requestId,
      answerDigest,
    );
    if (this.#ledgers.execution.list(id).some((l) => l.state !== "released"))
      fail(
        "TASK_ACTIVE",
        "An assessment process is active or requires recovery.",
      );
    return this.#start({
      kind: "understanding",
      taskId: id,
      requestId,
      answerDigest,
    });
  }
  #start(operation: Operation) {
    if (this.#closing) fail("EXECUTION_LOCKED", "The controller is stopping.");
    if (this.#active.has(operation.taskId))
      fail("TASK_ACTIVE", "This task already has an owned operation.");
    const abort = new AbortController();
    const active = { ...operation, abort, done: Promise.resolve() };
    this.#active.set(operation.taskId, active);
    if (this.#error?.taskId === operation.taskId) this.#error = null;
    active.done = Promise.resolve()
      .then(async () => {
        if (abort.signal.aborted) return;
        if (operation.kind === "understanding")
          await this.#runners.understanding(
            operation.taskId,
            operation.requestId,
            operation.answerDigest,
            abort.signal,
          );
        else
          await this.#runners[operation.kind](operation.taskId, abort.signal);
      })
      .catch((error) => {
        const code =
          error instanceof OfficeError ? error.code : "LIVE_EXECUTION_FAILED";
        this.#error = { taskId: operation.taskId, code };
        if (operation.kind === "planning") {
          const current = this.#ledgers.intake.get(operation.taskId);
          this.#ledgers.intake.interrupt(
            operation.taskId,
            current.revision,
            current.inputDigest,
            code,
          );
        }
      })
      .finally(() => {
        this.#active.delete(operation.taskId);
      });
    return { state: "accepted", ...operation };
  }
  abort(id: string) {
    this.#active.get(id)?.abort.abort();
  }
  cancelImplementation(id: string, contractDigest: string) {
    if (this.#ledgers.store.get(id).contract.digest !== contractDigest)
      fail("CONTRACT_CHANGED", "Inspect the current execution contract.");
    this.#ledgers.store.cancelExecution(id);
    const round = this.#ledgers.verification.latest(id);
    if (round) this.#ledgers.verification.cancel(round.id);
    this.abort(id);
    return { state: "cancelled", taskId: id };
  }
  assertIdle() {
    if (this.#active.size)
      fail(
        "TASK_ACTIVE",
        "Cancel active tasks and wait for process cleanup before stopping Office.",
      );
  }
  async close() {
    this.#closing = true;
    for (const active of this.#active.values()) active.abort.abort();
    await Promise.allSettled([...this.#active.values()].map((a) => a.done));
    this.#runners.dispose();
  }
}

async function git(project: string, args: string[]) {
  const result = await runCommand(
    "/usr/bin/git",
    [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-C",
      project,
      ...args,
    ],
    {
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      timeoutMs: 10000,
      maxBytes: 2 * 1024 * 1024,
    },
  );
  if (result.exitCode !== 0 || result.error)
    fail("GIT_PROJECT_REQUIRED", "Select an existing local Git project.");
  return result.stdout;
}

/** Immutable artifact reference, not a second workflow state. Reuse across G1/questions. */
export async function planningSnapshot(
  project: string,
  dataDir: string,
  taskId: string,
): Promise<Candidate> {
  const root = join(dataDir, "planning");
  noSymlinks(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const reference = join(root, digest(taskId) + ".json");
  noSymlinks(reference);
  if (existsSync(reference)) {
    const candidate = JSON.parse(
      readStable(reference, 4096).toString(),
    ) as Candidate;
    const path =
      typeof candidate.directory === "string"
        ? relative(root, candidate.directory)
        : "..";
    if (
      !path ||
      path.startsWith("..") ||
      isAbsolute(path) ||
      !verifyCandidate(candidate)
    )
      fail(
        "CANDIDATE_CHANGED",
        "Saved planning context is invalid; preserve it for inspection.",
      );
    return candidate;
  }
  const files = (
    await git(project, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
  )
    .split("\0")
    .filter((p) => p && !protectedPath(p) && existsSync(join(project, p)));
  if (!files.length)
    fail(
      "CONTEXT_REQUIRED",
      "The selected project has no files available for planning.",
    );
  const candidate = freezeCandidate(project, [...new Set(files)], root);
  writeFileSync(reference, JSON.stringify(candidate), {
    flag: "wx",
    mode: 0o600,
  });
  return candidate;
}

/** Trusted startup only: a browser cannot choose executables, credentials or a daemon. */
export async function createLiveRuntime(
  config: LiveConfig,
  project: string,
  dataDir: string,
  ledgers: Ledgers,
  operatorToken: string,
) {
  for (const path of Object.values(config)) {
    if (typeof path !== "string" || !isAbsolute(path))
      fail("LIVE_CONFIG", "Runtime paths must be absolute.");
    noSymlinks(path);
  }
  verifyControllerBinary(config.controller);
  if (
    digest(readStable(config.binary, 256 * 1024 * 1024)) !== EXEC_SERVER_SHA256
  )
    fail("UNVERIFIED_EXEC_SERVER", "Use the qualified Linux Codex executor.");
  const auth = join(config.authHome, "auth.json");
  noSymlinks(auth);
  if (!existsSync(auth))
    fail(
      "LOGIN_REQUIRED",
      "Log in to Codex on the Mac before starting live Office.",
    );
  if (
    realpathSync(
      (await git(project, ["rev-parse", "--show-toplevel"])).trim(),
    ) !== project
  )
    fail("GIT_PROJECT_REQUIRED", "Select the Git repository root.");
  const client = dockerClient(config.socket);
  try {
    const vm = await client.run(["info", "--format", "{{.Name}}"], 5000);
    if (
      vm.exitCode !== 0 ||
      vm.error ||
      vm.stdout.trim() !== "colima-pazmo-office"
    )
      fail("VM_NOT_READY", "Start the dedicated pazmo-office VM.");
    const image = await client.run(
      ["image", "inspect", IMAGE, "--format", "{{.Id}}"],
      5000,
    );
    if (
      image.exitCode !== 0 ||
      image.error ||
      !/^sha256:[a-f0-9]{64}$/.test(image.stdout.trim())
    )
      fail(
        "VM_IMAGE_REQUIRED",
        "The qualified Node image is missing from the dedicated VM.",
      );
    const job = (prompt: string) =>
      codexJob(
        { ...config, timeoutMs: 240000, openExecutor: client.openExecutor },
        prompt,
      );
    const planning = new PlanningCoordinator({
      project,
      intake: ledgers.intake,
      execution: ledgers.execution,
      planner: new ContainerPlanner(client.run),
      jobFor: (_packet, _context, prompt) => job(prompt),
    });
    const implementation = new OfficeCoordinator({
      ...ledgers,
      roles: new KitDelivery(
        project,
        ledgers.store,
        ledgers.handoffs,
        ledgers.verification,
      ),
      workspace: new ContainerWorkspace(client.run),
      reviewer: new ContainerReviewer(client.run),
      verifier: new ContainerVerifier(client.run),
      jobFor: (packet) => job(rolePrompt(packet)),
    });
    const understanding = new UnderstandingRunner({
      completion: ledgers.completion,
      execution: ledgers.execution,
      token: operatorToken,
      planner: new ContainerPlanner(client.run),
      jobFor: job,
    });
    return new LiveRuntime(ledgers, {
      planning: async (id, signal) =>
        planning.run(id, await planningSnapshot(project, dataDir, id), signal),
      implementation: async (id, signal) => {
        const result = await implementation.run(id, signal);
        if (result.state === "awaiting_g4")
          await ledgers.completion.prepare(id);
        return result;
      },
      understanding: (id, requestId, answerDigest, signal) =>
        understanding.run(id, requestId, answerDigest, signal),
      dispose: client.dispose,
    });
  } catch (error) {
    client.dispose();
    throw error;
  }
}
