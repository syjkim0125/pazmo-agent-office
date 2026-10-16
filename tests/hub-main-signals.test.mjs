import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/hub/main.ts";

// A supervisor may send SIGTERM as soon as it sees the readiness line, so the handlers must
// already be installed when that line is written; otherwise the default action kills the hub
// without stopping it.
test("the entrypoint installs its stop handlers before it announces readiness", async () => {
  const data = mkdtempSync(join(tmpdir(), "hub-main-signals-"));
  const before = new Set(process.listeners("SIGTERM"));
  const beforeInt = new Set(process.listeners("SIGINT"));
  const log = console.log;
  const exit = process.exit;
  let atReady = null;
  let exited;
  const exitedOnce = new Promise((resolve) => (exited = resolve));
  console.log = () => {
    atReady = process.listeners("SIGTERM").filter((l) => !before.has(l));
  };
  process.exit = (code) => exited(code);
  try {
    await main({ PAZMO_HUB_PUBLIC_URL: "https://pazmo-hub.apps.example.com", PAZMO_HUB_LISTEN: "127.0.0.1:0", PAZMO_HUB_DATA_DIR: data });
    const handlers = process.listeners("SIGTERM").filter((l) => !before.has(l));
    handlers[0]?.("SIGTERM"); // stop the hub in every outcome so a failure cannot leave it listening
    assert.equal(await exitedOnce, 0, "stopping the hub then exits 0");
    assert.equal(atReady?.length, 1, "a SIGTERM handler must exist when the readiness line is written");
  } finally {
    console.log = log;
    process.exit = exit;
    for (const l of process.listeners("SIGTERM")) if (!before.has(l)) process.removeListener("SIGTERM", l);
    for (const l of process.listeners("SIGINT")) if (!beforeInt.has(l)) process.removeListener("SIGINT", l);
    rmSync(data, { recursive: true, force: true });
  }
});

// The CLI `hub` command (runHub) had the same order: a supervisor that signals on the first
// line could kill the hub by the default action before it stopped (tests/hub-cli.test.mjs flake).
test("runHub installs its stop handlers before it prints the result line", async () => {
  const { runHub } = await import("../src/hub/run.ts");
  const data = mkdtempSync(join(tmpdir(), "hub-run-signals-"));
  const before = new Set(process.listeners("SIGINT"));
  const beforeTerm = new Set(process.listeners("SIGTERM"));
  const log = console.log;
  let atReady = null;
  console.log = () => {
    atReady = process.listeners("SIGINT").filter((l) => !before.has(l));
  };
  try {
    const running = runHub({ mode: "proxy", publicUrl: "https://pazmo-hub.apps.example.com", listenHost: "127.0.0.1", listenPort: 0, dataDir: data });
    for (let i = 0; i < 200 && !process.listeners("SIGINT").some((l) => !before.has(l)); i++) await new Promise((r) => setTimeout(r, 10));
    process.listeners("SIGINT").filter((l) => !before.has(l))[0]?.("SIGINT"); // stop in every outcome
    assert.deepEqual(await running, { stopped: true });
    assert.equal(atReady?.length, 1, "a SIGINT handler must exist when the result line is printed");
  } finally {
    console.log = log;
    for (const l of process.listeners("SIGINT")) if (!before.has(l)) process.removeListener("SIGINT", l);
    for (const l of process.listeners("SIGTERM")) if (!beforeTerm.has(l)) process.removeListener("SIGTERM", l);
    rmSync(data, { recursive: true, force: true });
  }
});
