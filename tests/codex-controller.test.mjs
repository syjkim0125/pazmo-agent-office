import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { codexJob, runCodexOnRelay } from "../src/runners/codex-controller.ts";

test("a cancelled model job does not inspect auth or start its executor", async () => {
  const abort = new AbortController();
  abort.abort();
  const job = codexJob(
    {
      controller: "/missing",
      binary: "/missing",
      authHome: "/missing",
      timeoutMs: 1000,
      openExecutor: () => {
        throw Error("must not launch");
      },
    },
    "Bounded task",
  );
  const result = await job.supervise("a".repeat(64), 1000, abort.signal);
  assert.equal(result.closed, true);
  assert.equal(result.result.error, "CANCELLED");
});

test("invalid controller configuration is rejected before account or executor use", async () => {
  let spawned = false;
  const job = codexJob(
    {
      controller: "/missing",
      binary: "/missing",
      authHome: "/missing",
      timeoutMs: 1000,
      openExecutor: () => {
        spawned = true;
        throw Error("must not launch");
      },
    },
    "Bounded task",
  );
  await assert.rejects(
    job.supervise("a".repeat(64), 1000, new AbortController().signal),
  );
  assert.equal(spawned, false);
});

test("CLI zero cannot replace turn completion or confirmed transport closure", async () => {
  const options = {
    cwd: tmpdir(),
    env: {},
    timeoutMs: 3000,
    signal: new AbortController().signal,
  };
  for (const [output, closed, failure, expectedError] of [
    ["not a completed turn", true, null, "MISSING_TURN_COMPLETION"],
    ['{"type":"turn.completed"}', false, null, null],
    ['{"type":"turn.completed"}', true, "EXECUTOR_CLOSED", "EXECUTOR_CLOSED"],
  ]) {
    let closes = 0;
    const result = await runCodexOnRelay(
      process.execPath,
      ["-e", "console.log(process.argv[1])", output],
      options,
      {
        close: async () => {
          closes++;
          return closed;
        },
        failure: () => failure,
      },
    );
    assert.equal(closes, 1);
    assert.equal(result.closed, closed);
    assert.equal(result.result.error, expectedError);
  }
});
