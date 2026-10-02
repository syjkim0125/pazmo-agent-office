import assert from "node:assert/strict";
import test from "node:test";
import { superviseRemote } from "../src/runners/remote-job.ts";
const success = {
  closed: true,
  result: {
    exitCode: 0,
    signal: null,
    error: null,
    timedOut: false,
    stdout: "done",
    stderr: "",
  },
};
test("an already cancelled remote job never invokes its controller", async () => {
  const abort = new AbortController();
  abort.abort();
  let called = 0;
  const r = await superviseRemote(
    {
      binary: "fixture",
      timeoutMs: 1000,
      supervise: async () => {
        called++;
        return success;
      },
    },
    "fixture",
    1000,
    abort.signal,
  );
  assert.equal(called, 0);
  assert.equal(r.result.error, "CANCELLED");
  assert.equal(r.closed, true);
});
test("late success after cancellation or timeout cannot become a successful job", async () => {
  for (const reason of ["cancel", "timeout"]) {
    const abort = new AbortController();
    const r = await superviseRemote(
      {
        binary: "fixture",
        timeoutMs: 1000,
        supervise: async (_handle, _time, signal) => {
          if (reason === "cancel") abort.abort();
          if (!signal.aborted)
            await new Promise((resolve) =>
              signal.addEventListener("abort", resolve, { once: true }),
            );
          return success;
        },
      },
      "fixture",
      reason === "timeout" ? 5 : 1000,
      abort.signal,
    );
    assert.equal(
      r.result.error,
      reason === "timeout" ? "TIMEOUT" : "CANCELLED",
    );
    assert.equal(r.closed, true);
  }
});
test("rejected or unresponsive controller cleanup remains unconfirmed", async () => {
  const failed = await superviseRemote(
    {
      binary: "fixture",
      timeoutMs: 10,
      supervise: async () => {
        throw Error("lost controller");
      },
    },
    "fixture",
    10,
  );
  assert.equal(failed.closed, false);
  assert.equal(failed.result.error, "lost controller");
  const hanging = await superviseRemote(
    { binary: "fixture", timeoutMs: 1, supervise: () => new Promise(() => {}) },
    "fixture",
    1,
  );
  assert.equal(hanging.closed, false);
  assert.equal(hanging.result.error, "TIMEOUT");
});

test("a later deadline cannot replace an earlier cancellation during cleanup", async () => {
  const abort = new AbortController();
  const r = await superviseRemote(
    {
      binary: "fixture",
      timeoutMs: 5,
      supervise: async () => {
        abort.abort();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return success;
      },
    },
    "fixture",
    5,
    abort.signal,
  );
  assert.equal(r.result.error, "CANCELLED");
});
