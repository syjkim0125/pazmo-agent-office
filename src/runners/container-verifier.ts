import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Candidate } from "../core/candidates.ts";
import { digest, readStable, verifyCandidate } from "../core/candidates.ts";
import { noSymlinks } from "../cli/project.ts";
import type { Observation } from "../core/verification.ts";
import { workspaceScope } from "../core/workspace.ts";
import type { WorkspaceScope } from "../core/workspace.ts";
import { receiveWorkspace, TRANSFER_BYTES } from "./workspace-transfer.ts";
import { runCommand } from "./command.ts";
import type { CommandResult } from "./command.ts";
import { superviseRemote } from "./remote-job.ts";
import type { RemoteJob } from "./remote-job.ts";
import { parseReviewReport } from "./review-report.ts";

export const EXEC_SERVER_SHA256 =
  "9b7c1c7abdc26fc3c4f47c77656a8e9121def5483dbae830ef1ee561758448a9";

export const IMAGE =
  "node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df";
type DockerCommand = (
  args: string[],
  timeoutMs?: number,
  maxBytes?: number,
  signal?: AbortSignal,
) => Promise<CommandResult>;
const preparation = readFileSync(
  new URL("./prepare-candidate.mjs", import.meta.url),
  "utf8",
);
const exporter = readFileSync(
  new URL("./export-workspace.cjs", import.meta.url),
  "utf8",
);
type Job = { argv: string[]; timeoutMs: number };
function good(r: CommandResult) {
  return (
    r.exitCode === 0 && r.signal === null && !r.timedOut && r.error === null
  );
}

export function dockerClient(socket: string) {
  if (
    !isAbsolute(socket) ||
    !socket.endsWith("/.colima/pazmo-office/docker.sock")
  )
    throw new Error("Use the dedicated Pazmo VM socket.");
  const home = mkdtempSync(join(tmpdir(), "pazmo-docker-client-"));
  const run: DockerCommand = (
    args,
    timeoutMs = 30000,
    maxBytes = 256 * 1024,
    signal,
  ) =>
    runCommand(
      "/opt/homebrew/bin/docker",
      ["--config", home, "--host", `unix://${socket}`, ...args],
      {
        timeoutMs,
        maxBytes,
        signal,
        env: {
          HOME: home,
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
      },
    );
  return {
    run,
    openExecutor: (handle: string) => {
      if (!/^[a-f0-9]{64}$/.test(handle))
        throw new Error("INVALID_CONTAINER_ID");
      return spawn(
        "/opt/homebrew/bin/docker",
        [
          "--config",
          home,
          "--host",
          `unix://${socket}`,
          "exec",
          "-i",
          "--workdir",
          "/candidate/tree",
          handle,
          "/runner/codex",
          "exec-server",
          "--listen",
          "stdio",
        ],
        {
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            HOME: home,
            PATH: "/opt/homebrew/bin:/usr/bin:/bin",
            LANG: "C.UTF-8",
          },
        },
      );
    },
    dispose: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** The verifier has no writable-mode switch in its public interface. */
export class ContainerVerifier {
  #docker: DockerCommand;
  constructor(docker: DockerCommand) {
    this.#docker = docker;
  }
  async run(
    candidate: Candidate,
    check: Job,
    beforeStart: (handle: string) => number | void,
    signal?: AbortSignal,
  ) {
    const report = await runContainer(
      this.#docker,
      candidate,
      check,
      beforeStart,
      signal,
    );
    return {
      ...report,
      observation: { ...report.observation, kind: "test" as const },
    };
  }
}
/** Remote reviewer with an unconditionally readonly candidate mount. */
export class ContainerReviewer {
  #docker: DockerCommand;
  constructor(docker: DockerCommand) {
    this.#docker = docker;
  }
  async run(
    candidate: Candidate,
    contractDigest: string,
    job: RemoteJob,
    beforeStart: (handle: string) => number | void,
    signal?: AbortSignal,
  ) {
    let stdout = "";
    const report = await runContainer(
      this.#docker,
      candidate,
      {
        argv: ["node", "-e", "setInterval(()=>{},1000)"],
        timeoutMs: job.timeoutMs,
      },
      beforeStart,
      signal,
      undefined,
      {
        ...job,
        supervise: async (...args) => {
          const result = await job.supervise(...args);
          stdout = result.result.stdout;
          return result;
        },
      },
    );
    const o = report.observation;
    return {
      ...report,
      observation: {
        ...o,
        kind: "review" as const,
        report:
          report.closed &&
          o.exitCode === 0 &&
          !o.error &&
          !o.signal &&
          !o.timedOut
            ? parseReviewReport(stdout, candidate.digest, contractDigest)
            : null,
      },
    };
  }
}
/** Mutable workspace transport for controller-selected jobs. No model login or public launch route. */
export class ContainerWorkspace {
  #docker: DockerCommand;
  constructor(docker: DockerCommand) {
    this.#docker = docker;
  }
  run(
    candidate: Candidate,
    scope: WorkspaceScope,
    destination: string,
    job: Job,
    beforeStart: (handle: string) => number | void,
    signal?: AbortSignal,
  ) {
    return runContainer(this.#docker, candidate, job, beforeStart, signal, {
      scope: workspaceScope(scope),
      destination,
    });
  }
  runRemote(
    candidate: Candidate,
    scope: WorkspaceScope,
    destination: string,
    job: RemoteJob,
    beforeStart: (handle: string) => number | void,
    signal?: AbortSignal,
  ) {
    return runContainer(
      this.#docker,
      candidate,
      {
        argv: ["node", "-e", "setInterval(()=>{},1000)"],
        timeoutMs: job.timeoutMs,
      },
      beforeStart,
      signal,
      { scope: workspaceScope(scope), destination },
      job,
    );
  }
}
async function runContainer(
  docker: DockerCommand,
  candidate: Candidate,
  check: Job,
  beforeStart: (handle: string) => number | void,
  signal?: AbortSignal,
  workspace?: { scope: WorkspaceScope; destination: string },
  remote?: RemoteJob,
) {
  const name = (workspace ? "pazmo-work-" : "pazmo-verify-") + randomUUID(),
    volume = name + "-candidate",
    seed = name + "-prepare";
  const runtimeVolume = name + "-runtime";
  const containers: string[] = [],
    cleanupErrors: string[] = [];
  let volumeAttempted = false,
    runtimeAttempted = false,
    handle: string | null = null,
    closed = true;
  let transferred: string | null = null;
  const observation: Omit<Observation, "kind" | "report"> = {
    exitCode: null,
    signal: null,
    timedOut: false,
    error: null,
    output: "",
  };
  const call = async (args: string[], timeout = 30000) => {
    const r = await docker(args, timeout);
    if (!good(r))
      throw new Error(
        `${args[0]} (${r.exitCode ?? r.signal ?? "unknown"}): ${r.error ?? r.stderr.slice(0, 1000)}`,
      );
    return r.stdout.trim();
  };
  try {
    if (!verifyCandidate(candidate)) throw new Error("CANDIDATE_CHANGED");
    if (remote) {
      noSymlinks(remote.binary);
      if (
        digest(readStable(remote.binary, 256 * 1024 * 1024)) !==
        EXEC_SERVER_SHA256
      )
        throw new Error("UNVERIFIED_EXEC_SERVER");
    }
    if (
      !Array.isArray(check.argv) ||
      !check.argv.length ||
      check.argv.length > 128 ||
      check.argv.some(
        (a) => typeof a !== "string" || a.includes("\0") || a.length > 16000,
      ) ||
      !check.argv[0] ||
      !Number.isInteger(check.timeoutMs) ||
      check.timeoutMs < 1 ||
      check.timeoutMs > 600000
    )
      throw new Error("INVALID_CHECK");
    if (signal?.aborted) throw new Error("CANCELLED");
    if (
      (await call(["info", "--format", "{{.Name}}"])) !== "colima-pazmo-office"
    )
      throw new Error("WRONG_DAEMON");
    const imageId = await call([
      "image",
      "inspect",
      IMAGE,
      "--format",
      "{{.Id}}",
    ]);
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
      throw new Error("INVALID_IMAGE_ID");
    volumeAttempted = true;
    await call([
      "volume",
      "create",
      "--label",
      `pazmo.verifier=${name}`,
      volume,
    ]);
    if (remote) {
      runtimeAttempted = true;
      await call([
        "volume",
        "create",
        "--label",
        `pazmo.verifier=${name}`,
        runtimeVolume,
      ]);
    }
    containers.push(seed);
    const seedId = await call([
      "create",
      "--name",
      seed,
      "--label",
      `pazmo.verifier=${name}`,
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--cap-add",
      "CHOWN",
      "--security-opt",
      "no-new-privileges:true",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--pids-limit",
      "64",
      "--cpus",
      "1",
      "--mount",
      `type=volume,src=${volume},dst=/candidate,volume-nocopy`,
      ...(remote
        ? [
            "--mount",
            `type=volume,src=${runtimeVolume},dst=/runner,volume-nocopy`,
          ]
        : []),
      "--entrypoint",
      "node",
      IMAGE,
      "-e",
      preparation +
        (remote
          ? `\nconst runtimeHash=crypto.createHash('sha256'), runtimeBuffer=Buffer.alloc(65536), runtimeFd=fs.openSync('/runner/codex',fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let runtimeRead;while((runtimeRead=fs.readSync(runtimeFd,runtimeBuffer,0,runtimeBuffer.length,null))>0)runtimeHash.update(runtimeBuffer.subarray(0,runtimeRead));fs.closeSync(runtimeFd);if(runtimeHash.digest('hex')!==${JSON.stringify(EXEC_SERVER_SHA256)})throw Error('UNVERIFIED_EXEC_SERVER');`
          : ""),
      candidate.digest,
      ...(workspace ? ["writable"] : []),
    ]);
    if (!/^[a-f0-9]{64}$/.test(seedId)) throw new Error("INVALID_CONTAINER_ID");
    await call(["cp", candidate.directory + "/.", `${seedId}:/candidate`]);
    if (remote) await call(["cp", remote.binary, `${seedId}:/runner/codex`]);
    await call(["start", seedId]);
    if ((await call(["wait", seedId])) !== "0") {
      const logs = await docker(["logs", seedId]);
      throw new Error(
        "CANDIDATE_PREPARATION_FAILED: " +
          (logs.stdout + logs.stderr).slice(0, 4000),
      );
    }
    if (!verifyCandidate(candidate)) throw new Error("CANDIDATE_CHANGED");
    containers.push(name);
    handle = await call([
      "create",
      "--name",
      name,
      "--label",
      `pazmo.verifier=${name}`,
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--user",
      "1000:1000",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "64",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--cpus",
      "1",
      "--log-driver",
      "none",
      "--tmpfs",
      "/work:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000,mode=700",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000,mode=700",
      "--env",
      "HOME=/work",
      "--env",
      "TMPDIR=/tmp",
      ...(remote ? ["--env", "CODEX_HOME=/work/codex-home"] : []),
      "--workdir",
      "/candidate/tree",
      "--mount",
      `type=volume,src=${volume},dst=/candidate,${workspace ? "" : "readonly,"}volume-nocopy`,
      ...(remote
        ? [
            "--mount",
            `type=volume,src=${runtimeVolume},dst=/runner,readonly,volume-nocopy`,
          ]
        : []),
      "--entrypoint",
      check.argv[0],
      IMAGE,
      ...check.argv.slice(1),
    ]);
    if (!/^[a-f0-9]{64}$/.test(handle)) throw new Error("INVALID_CONTAINER_ID");
    const inspected = JSON.parse(await call(["inspect", handle]))[0];
    const h = inspected.HostConfig,
      mounts = inspected.Mounts,
      candidateMount = mounts.find(
        (m: { Destination: string }) => m.Destination === "/candidate",
      ),
      runtimeMount = mounts.find(
        (m: { Destination: string }) => m.Destination === "/runner",
      );
    if (
      inspected.Id !== handle ||
      inspected.Image !== imageId ||
      inspected.Config.User !== "1000:1000" ||
      inspected.Config.WorkingDir !== "/candidate/tree" ||
      h.NetworkMode !== "none" ||
      h.ReadonlyRootfs !== true ||
      h.Privileged ||
      JSON.stringify(h.CapDrop) !== '["ALL"]' ||
      (h.CapAdd?.length ?? 0) !== 0 ||
      !h.SecurityOpt?.includes("no-new-privileges:true") ||
      h.PidsLimit !== 64 ||
      h.Memory !== 268435456 ||
      h.MemorySwap !== 268435456 ||
      h.NanoCpus !== 1000000000 ||
      (h.Binds?.length ?? 0) !== 0 ||
      mounts.length !== (remote ? 2 : 1) ||
      candidateMount?.Type !== "volume" ||
      candidateMount?.Name !== volume ||
      candidateMount?.RW !== Boolean(workspace) ||
      (remote &&
        (runtimeMount?.Type !== "volume" ||
          runtimeMount?.Name !== runtimeVolume ||
          runtimeMount?.RW !== false))
    )
      throw new Error("UNSAFE_CONTAINER_CONFIGURATION");
    if (signal?.aborted) throw new Error("CANCELLED");
    const remaining = beforeStart(handle) ?? check.timeoutMs;
    if (!Number.isInteger(remaining) || remaining < 1)
      throw new Error("START_DEADLINE_EXCEEDED");
    let attached: CommandResult;
    if (remote) {
      await call(["start", handle]);
      closed = false;
      const supervised = await superviseRemote(
        remote,
        handle,
        Math.min(check.timeoutMs, remaining),
        signal,
      );
      attached = supervised.result;
      closed = supervised.closed === true;
    } else
      attached = await docker(
        ["start", "--attach", handle],
        Math.min(check.timeoutMs, remaining),
        256 * 1024,
        signal,
      );
    observation.output = (attached.stdout + attached.stderr).slice(
      0,
      256 * 1024,
    );
    if (Buffer.byteLength(attached.stdout + attached.stderr) > 256 * 1024)
      observation.error = "OUTPUT_LIMIT";
    if (attached.timedOut) {
      observation.timedOut = true;
      observation.error = "TIMEOUT";
    } else if (signal?.aborted || attached.error === "CANCELLED")
      observation.error = "CANCELLED";
    else if (attached.error || attached.signal)
      observation.error = attached.error ?? "ATTACH_INTERRUPTED";
    if (observation.error) await call(["kill", handle]).catch(() => {});
    const state = JSON.parse(
      await call(["inspect", handle, "--format", "{{json .State}}"]),
    );
    if (!remote && (state.Running || state.Pid !== 0))
      throw new Error("PROCESS_CLOSURE_UNCONFIRMED");
    if (state.OOMKilled || state.Error)
      observation.error = "CONTAINER_RUNTIME_FAILURE";
    if (
      remote &&
      !observation.error &&
      (!state.Running || state.Pid <= 0 || !closed)
    )
      observation.error = "REMOTE_SESSION_INTERRUPTED";
    if (remote && !observation.error) observation.exitCode = attached.exitCode;
    if (!remote && !observation.error) {
      const waited = await call(["wait", handle]);
      if (
        !/^\d+$/.test(waited) ||
        Number(waited) !== state.ExitCode ||
        (attached.exitCode !== 0 && attached.exitCode !== state.ExitCode)
      )
        throw new Error("EXIT_CODE_MISMATCH");
      observation.exitCode = state.ExitCode;
    }
    if (!verifyCandidate(candidate)) observation.error = "CANDIDATE_CHANGED";
    if (workspace && observation.exitCode === 0 && observation.error === null) {
      // Removing the writer closes the entire PID namespace before a fresh reader
      // inspects the volume. No worker-produced archive is extracted on the host.
      await call(["rm", "--force", handle]);
      containers.pop();
      const reader = name + "-export";
      containers.push(reader);
      const readerId = await call([
        "create",
        "--name",
        reader,
        "--label",
        `pazmo.verifier=${name}`,
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--pids-limit",
        "16",
        "--memory",
        "1g",
        "--memory-swap",
        "1g",
        "--cpus",
        "1",
        "--log-driver",
        "none",
        "--mount",
        `type=volume,src=${volume},dst=/candidate,readonly,volume-nocopy`,
        "--entrypoint",
        "node",
        IMAGE,
        "-e",
        exporter,
        JSON.stringify(workspace.scope),
      ]);
      if (!/^[a-f0-9]{64}$/.test(readerId))
        throw new Error("INVALID_CONTAINER_ID");
      const exported = await docker(
        ["start", "--attach", readerId],
        30000,
        TRANSFER_BYTES,
        signal,
      );
      if (!good(exported) || (await call(["wait", readerId])) !== "0")
        throw new Error(
          "WORKSPACE_EXPORT_FAILED: " +
            (exported.error ?? exported.stderr.slice(0, 1000)),
        );
      transferred = exported.stdout;
    }
  } catch (error) {
    observation.error =
      error instanceof Error ? error.message : "VERIFIER_FAILED";
  } finally {
    for (const container of containers.reverse()) {
      try {
        await call(["rm", "--force", container]);
      } catch (error) {
        closed = false;
        cleanupErrors.push(String(error));
      }
    }
    if (volumeAttempted)
      try {
        await call(["volume", "rm", volume]);
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    if (runtimeAttempted)
      try {
        await call(["volume", "rm", runtimeVolume]);
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    if (cleanupErrors.length) observation.error = "CLEANUP_FAILED";
  }
  if (
    workspace &&
    transferred !== null &&
    closed &&
    observation.error === null
  ) {
    try {
      if (signal?.aborted) throw new Error("CANCELLED");
      if (!verifyCandidate(candidate)) throw new Error("CANDIDATE_CHANGED");
      receiveWorkspace(transferred, workspace.scope, workspace.destination);
    } catch (error) {
      observation.error =
        error instanceof Error ? error.message : "WORKSPACE_RECEIVE_FAILED";
    }
  }
  return { handle, closed, observation, cleanupErrors };
}
