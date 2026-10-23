// Preload for the lean-service startup tests (node --import). It redirects the
// service's imports of the office and the server to wrappers that make one start
// step slow (LEAN_TEST_SLOW: office | ensureDefault | server) and append what
// happens to the office and the server to LEAN_TEST_EVENTS, one line each.
// The service itself is unchanged; the real office and server do the work.
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createLeanOffice as realOffice } from "../src/lean/office.ts";
import { startLeanServer as realServer } from "../src/lean/server.ts";

const events = process.env.LEAN_TEST_EVENTS;
const slow = process.env.LEAN_TEST_SLOW;
const log = (line) => appendFileSync(events, `${line}\n`);
async function pause(step) {
  if (slow !== step) return;
  log(`${step}:begin`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  log(`${step}:end`);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (
      context.parentURL?.endsWith("/src/runtime/lean-service.ts") &&
      (specifier === "../lean/office.ts" || specifier === "../lean/server.ts")
    )
      return { url: import.meta.url, format: "module", shortCircuit: true };
    return resolved;
  },
});

export async function createLeanOffice(config) {
  await pause("office");
  // A live start is stood in for here: the real runtime is not under test.
  const office = await realOffice({ ...config, live: undefined });
  log("office:created");
  const { beginStop, close } = office;
  office.beginStop = () => {
    log("office:beginStop");
    return beginStop();
  };
  office.close = async () => {
    log("office:close");
    await close();
    log("office:closed");
  };
  // Not the real one: it would probe the CLIs installed on this machine.
  office.agents.ensureDefault = async () => {
    log("ensureDefault:called");
    await pause("ensureDefault");
    return { id: "stand-in" };
  };
  return office;
}

export async function startLeanServer(options) {
  await pause("server");
  const server = await realServer(options);
  log("server:listening");
  return {
    ...server,
    close: async () => {
      log("server:close");
      await server.close();
      log("server:closed");
    },
  };
}
