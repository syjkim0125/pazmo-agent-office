import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { removeSavedState } from "../cli/lifecycle.ts";
import { noSymlinks } from "../cli/project.ts";
import { startLifecycleServer } from "../lean/server.ts";
import { createTeamOffice, lifecycleView } from "../team/office.ts";
import type { TeamOffice } from "../team/office.ts";
import type { LiveConfig } from "./live.ts";

// The team Office's service process: one Story engine per registered repo, the
// claim scheduler and the Story Task executor (src/team/office.ts), behind a
// server with the lifecycle routes only (no page yet). Plain `node` runs it, as
// the lean service; the engines it reuses load `ws`, so `start --team` checks
// that the root dependencies are installed (NOT_INSTALLED).

/** A shutdown that has not finished by then is abandoned with a non-zero exit. */
const SHUTDOWN_LIMIT_MS = 10_000;

type Startup = {
  /** `<root>/team`: the team Office's own data, which is also its project. */
  project: string;
  dataDir: string;
  port: number;
  token: string;
  instance: string;
  live?: LiveConfig;
  /** The person's own PATH and HOME (and ssh agent socket, if any), for the host gh and git: the service
   * itself runs with Office's own HOME and a short PATH. */
  host: { pathEnv: string; home: string; sshAuthSock?: string };
};

// IPC configuration is supplied by the trusted local launcher, never an agent.
process.once("message", async (raw: unknown) => {
  // What is open so far, so a failure at any step closes exactly that.
  let office: TeamOffice | undefined;
  let server: { port: number; close(): Promise<void> } | undefined;

  /** Where `start` records this instance once it is ready; set when the data directory is checked. */
  let saved: { dataDir: string; instance: string } | undefined;
  /** Removes the saved state `start` wrote for this instance, if it still names it: first thing in a close, and
   * again when the close runs out of time, so that a slow or killed close never leaves a state the next start
   * cannot resolve. A failure is logged and changes no exit code. */
  function forgetState() {
    try {
      if (saved) removeSavedState(saved.dataDir, saved.instance);
    } catch (error) {
      console.error("Team shutdown: its runtime state could not be removed:", error);
    }
  }
  let closing: Promise<number> | undefined;
  /** Stops new work, stops accepting requests, then closes the Office (its
   * engines, their databases and the team store). Idempotent; resolves with
   * the exit code. */
  function close(): Promise<number> {
    closing ??= (async () => {
      forgetState();
      let code = 0;
      const step = async (name: string, run: (() => Promise<void> | void) | undefined) => {
        try {
          await run?.();
        } catch (error) {
          code = 1;
          console.error(`Team shutdown: ${name} failed:`, error);
        }
      };
      await step("stop", () => office?.beginStop());
      await step("server", () => server?.close());
      await step("office", () => office?.close());
      return code;
    })();
    return closing;
  }
  /** Close what is open and leave: 0 when every step closed, otherwise 1. */
  const finish = () => void close().then((code) => process.exit(code));
  let shuttingDown = false;
  // True once the start finished and `ready` was sent.
  let started = false;
  /** SIGTERM (the launcher's stop, or a stop request) ends the process: 0 when
   * every step closed, otherwise 1; and 1 when closing takes too long. */
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    // Not unref'd: if closing hangs with nothing else alive, this still ends
    // the process non-zero instead of letting it fall out of the event loop as 0.
    setTimeout(() => {
      console.error(`Team shutdown did not finish in ${SHUTDOWN_LIMIT_MS} ms.`);
      forgetState();
      process.exit(1);
    }, SHUTDOWN_LIMIT_MS);
    // A start still under way closes what it opened at its next checkpoint.
    if (started) finish();
  }

  try {
    const value = raw as Startup;
    if (
      !process.send ||
      !value ||
      typeof value !== "object" ||
      typeof value.project !== "string" ||
      typeof value.dataDir !== "string" ||
      !Number.isInteger(value.port) ||
      value.port < 0 ||
      value.port > 65535 ||
      typeof value.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.token) ||
      typeof value.instance !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.instance) ||
      !value.host ||
      typeof value.host !== "object" ||
      typeof value.host.pathEnv !== "string" ||
      typeof value.host.home !== "string" ||
      (value.host.sshAuthSock !== undefined && typeof value.host.sshAuthSock !== "string")
    )
      throw new Error("INVALID_HOST_CONFIG");

    // The launcher may stop a start that is still under way (SIGTERM).
    process.on("SIGTERM", shutdown);

    // The real path: noSymlinks rejects a symlinked ancestor such as /var on macOS.
    const dataDir = realpathSync(value.dataDir),
      project = realpathSync(value.project);
    noSymlinks(dataDir);
    // The team Office is its own project (teamProject); nothing else is accepted.
    if (project !== dataDir) throw new Error("INVALID_HOST_CONFIG");
    saved = { dataDir, instance: value.instance };
    const { pathEnv, home, sshAuthSock } = value.host;
    office = await createTeamOffice({
      root: dirname(dataDir),
      token: value.token,
      // Every repo's Story engine runs with it; without it nothing is claimed or run.
      live: value.live,
      // Their gh login is checked, and their git and gh run a Story Task's push and PR, with these.
      host: { pathEnv, home, ...(sshAuthSock ? { sshAuthSock } : {}) },
    });
    if (shuttingDown) return finish();
    const team = office;
    server = await startLifecycleServer({
      token: value.token,
      instance: value.instance,
      project,
      engine: "team",
      port: value.port,
      // A live team Office is `ready` here, as `up --team` and a later `start --team --live` compare it.
      status: () => lifecycleView(team.status()),
      assertIdle: () => team.assertIdle(),
      beginStop: () => team.beginStop(),
      // Same path as SIGTERM: one idempotent shutdown.
      onStop: () => process.emit("SIGTERM"),
    });
    if (shuttingDown) return finish();
    process.send({ type: "ready", port: server.port });
    started = true;
  } catch (error) {
    process.send?.({
      type: "error",
      error: error instanceof Error ? error.message : "STARTUP_FAILED",
    });
    process.exitCode = 1;
    process.disconnect?.();
    // Close what was opened, then leave; a lingering handle must not keep the
    // process (and the launcher's slot) alive.
    setTimeout(() => process.exit(1), SHUTDOWN_LIMIT_MS).unref();
    void close().then(() => process.exit(1));
  }
});
