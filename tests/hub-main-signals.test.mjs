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
