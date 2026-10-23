import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { noSymlinks } from "../cli/project.ts";
import { createLeanOffice } from "../lean/office.ts";
import type { LeanOffice } from "../lean/office.ts";
import { openLeanDb } from "../lean/schema.ts";
import { startLeanServer } from "../lean/server.ts";
import type { LiveConfig } from "./live.ts";

// The lean Office's service process. Plain `node` runs it: nothing here (or in
// src/lean) imports vendor TypeScript, so no loader is needed. The engine it
// reuses still loads vendor `ws` (src/runners/exec-relay.ts), so the vendor
// dependencies must be installed; `start --lean` checks that (NOT_INSTALLED).

/** A shutdown that has not finished by then is abandoned with a non-zero exit. */
const SHUTDOWN_LIMIT_MS = 10_000;
const WEB_ROOT = fileURLToPath(new URL("../lean/web", import.meta.url));

type Startup = {
  project: string;
  dataDir: string;
  port: number;
  token: string;
  instance: string;
  /** Sent by the launcher for every engine; the lean Office has no operator API. */
  operatorToken?: string;
  live?: LiveConfig;
};

// IPC configuration is supplied by the trusted local launcher, never an agent.
process.once("message", async (raw: unknown) => {
  // What is open so far, so a failure at any step closes exactly that.
  let db: DatabaseSync | undefined;
  let office: LeanOffice | undefined;
  let server: { port: number; close(): Promise<void> } | undefined;

  let closing: Promise<number> | undefined;
  /** Stops new work, stops accepting requests, then closes the Office, then the
   * database (the reverse of how they opened). Idempotent: later calls (a second
   * signal, a stop request and SIGTERM) get the shutdown already under way.
   * Resolves with the exit code. */
  function close(): Promise<number> {
    closing ??= (async () => {
      let code = 0;
      const step = async (name: string, run: (() => Promise<void> | void) | undefined) => {
        try {
          await run?.();
        } catch (error) {
          code = 1;
          console.error(`Lean shutdown: ${name} failed:`, error);
        }
      };
      // A task still waiting for its runner check must not be stored now.
      await step("stop", () => office?.beginStop());
      await step("server", () => server?.close());
      await step("office", () => office?.close());
      await step("database", () => db?.close());
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
      console.error(`Lean shutdown did not finish in ${SHUTDOWN_LIMIT_MS} ms.`);
      process.exit(1);
    }, SHUTDOWN_LIMIT_MS);
    // A start still under way is not closed from here: its database is in use by
    // the step that is running. The start reaches a checkpoint after that step
    // and closes what it has opened by then.
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
      !/^[a-f0-9]{32}$/.test(value.instance)
    )
      throw new Error("INVALID_HOST_CONFIG");

    // The launcher may stop a start that is still under way (SIGTERM).
    process.on("SIGTERM", shutdown);

    const project = realpathSync(value.project),
      // The real path: noSymlinks rejects a symlinked ancestor such as /var on macOS.
      dataDir = realpathSync(value.dataDir);
    noSymlinks(dataDir);
    db = openLeanDb(dataDir, project);
    // After every step below that waits: a SIGTERM that came meanwhile closes
    // exactly what is open by now (server, office, database) and ends the start.
    office = await createLeanOffice({
      db,
      project,
      // Scratch the engine keeps next to the database; never `<dataDir>/claw`.
      dataDir: join(dataDir, "lean"),
      token: value.token,
      live: value.live,
    });
    if (shuttingDown) return finish();
    // Only a live Office can run a task, and a task needs an agent.
    if (value.live) {
      await office.agents.ensureDefault();
      if (shuttingDown) return finish();
    }
    server = await startLeanServer({
      office,
      token: value.token,
      instance: value.instance,
      project,
      port: value.port,
      webRoot: WEB_ROOT,
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
