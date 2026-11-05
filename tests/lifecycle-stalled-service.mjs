// Preload for the start-interruption tests (node --import), and the service it
// starts in place of the real one. As a preload it redirects lifecycle.ts's
// import of node:child_process here, so `start` spawns this file as its service;
// everything else in `start` (its lock, its state file, its wait) is the real
// code. As that service (--stalled-service) it never reports ready: it logs its
// pid once the startup message arrives, then waits, and logs a SIGTERM before it
// exits on one. Its stdout is the Office's office.log.
import { spawn as realSpawn } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const self = fileURLToPath(import.meta.url);

if (process.argv[2] === "--stalled-service") {
  process.on("SIGTERM", () => {
    console.log("stalled-service: SIGTERM");
    process.exit(0);
  });
  process.once("message", () => console.log(`stalled-service: waiting ${process.pid}`));
  // Alive until a signal ends it, whether or not its launcher is still there.
  setInterval(() => {}, 1000);
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "node:child_process" && context.parentURL?.endsWith("/src/cli/lifecycle.ts"))
        return { url: import.meta.url, format: "module", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

// Everything else lifecycle.ts imports from node:child_process is the real one.
export * from "node:child_process";
export function spawn(command, _args, options) {
  return realSpawn(command, [self, "--stalled-service"], options);
}
