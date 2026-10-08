import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { acceptPlanning, beginPlanning } from "../src/runners/planning.ts";

// Observed 2026-10-08: claude CLI 2.1.280 could not refresh its OAuth token and
// Office showed the PM failure as a plan-format validation failure.
const oauth = readFileSync(
  new URL("./fixtures/claude-oauth-refresh-failed.jsonl", import.meta.url),
  "utf8",
);
const observe = (stdout, exitCode = 1) => ({
  closed: true,
  result: { exitCode, signal: null, error: null, timedOut: false, stderr: "", stdout },
});
const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n");
const said = (text) => ({ type: "item.completed", item: { type: "agent_message", text } });
function rejection(fn) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, "PLANNING_INVALID");
    return error;
  }
  assert.fail("expected PLANNING_INVALID");
}
const pm = () => beginPlanning(randomUUID(), "Add input validation.", "normal");

test("an OAuth refresh failure before any plan output is a runner failure, not a format failure", () => {
  const error = rejection(() => acceptPlanning(pm(), observe(oauth)));
  assert.equal(error.origin, "runner");
  assert.equal(
    error.detail,
    "runner: OAuth token refresh failed (another CLI process was refreshing; usually transient); exitCode=1",
  );
});

test("a failed turn with no plan output names only an Office-authored runner label", () => {
  const secret = "PROJECT-SECRET-VALUE";
  for (const [stdout, exitCode] of [
    [lines({ type: "turn.started" }, said(`${secret} ${secret}`), { type: "turn.failed" }), 1],
    [lines({ type: "turn.started" }, { type: "turn.failed" }), 1],
    [lines({ type: "turn.started" }, said(secret), { type: "turn.failed" }), 0],
  ]) {
    const error = rejection(() => acceptPlanning(pm(), observe(stdout, exitCode)));
    assert.equal(error.origin, "runner");
    assert.equal(
      error.detail,
      `runner: turn failed before any plan output; exitCode=${exitCode}`,
    );
    assert.ok(!error.detail.includes(secret));
  }
});

test("a known runner message is recognized only as a turn's sole output", () => {
  // A plan-shaped report means the model ran: keep the output classification.
  const p = pm(),
    report = said(JSON.stringify({ version: 1, inputDigest: p.inputDigest, status: "ready" }));
  for (const stdout of [
    lines({ type: "turn.started" }, report, { type: "turn.failed" }),
    lines({ type: "turn.started" }, report, said("Failed to refresh OAuth token: x"), { type: "turn.failed" }),
  ]) {
    const error = rejection(() => acceptPlanning(p, observe(stdout)));
    assert.equal(error.origin, "output");
    assert.equal(error.detail, "exitCode=1");
  }
  // An auth-like sentence among other model text is not a runner diagnosis.
  const mixed = rejection(() =>
    acceptPlanning(
      p,
      observe(lines({ type: "turn.started" }, said("Looking."), said("Failed to refresh OAuth token: x"), { type: "turn.failed" })),
    ),
  );
  assert.equal(mixed.origin, "runner");
  assert.equal(mixed.detail, "runner: turn failed before any plan output; exitCode=1");
});

test("format, timeout and closure failures keep the output classification", () => {
  const p = pm();
  for (const observation of [
    observe("not a report", 0),
    observe(oauth.replace("turn.failed", "turn.completed"), 0),
    { ...observe(oauth), closed: false },
    { ...observe(oauth), result: { ...observe(oauth).result, timedOut: true } },
  ])
    assert.equal(rejection(() => acceptPlanning(p, observation)).origin, "output");
});
