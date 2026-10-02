import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { freezeCandidate } from "../src/core/candidates.ts";

async function setup(t, role = "developer") {
  const { KitRoleRun } = await import("../src/core/kit-role-runs.ts");
  const f = fixture(t);
  f.put(
    "story.md",
    f.story.replace(
      "Status: Draft",
      "Status: Approved\nUnderstanding gate (G1): approval.md · 2026-09-23 · Check-in: accepted",
    ),
  );
  f.put(
    "approval.md",
    "Synthetic G1 for adapter tests only; no real user approval.",
  );
  f.put("source.txt", "before");
  mkdirSync(join(f.root, "snapshots"));
  const candidate = freezeCandidate(
    f.project,
    ["source.txt"],
    join(f.root, "snapshots"),
  );
  let cancelled = false;
  const guard = () => {
    if (cancelled) throw Error("CANCELLED");
  };
  const assignment = {
    version: 1,
    taskId: "task-1",
    role,
    source: "story.md",
    scope: ["M1", "V1"],
    targetRevision: candidate.digest,
  };
  const open = () =>
    KitRoleRun.open({
      project: f.project,
      assignmentId: "work-1",
      assignment,
      candidate,
      guard,
    });
  return {
    ...f,
    candidate,
    assignment,
    guard,
    open,
    run: await open(),
    cancel: () => {
      cancelled = true;
    },
  };
}

test("Office dispatch uses persistent kit readiness and cannot launch the same node twice", async (t) => {
  const f = await setup(t);
  const ready = (await f.run.status()).ready[0];
  assert.equal(ready.id, "implement");
  const started = await f.run.start(ready.id, ready.token);
  assert.notEqual(started.started.token, ready.token);
  const restored = await f.open();
  assert.equal((await restored.status()).action, "wait");
  assert.equal(
    (await restored.continuation("implement")).token,
    started.started.token,
  );
  await assert.rejects(restored.start(ready.id, ready.token), /not ready/i);
});

test("Office routes question answers with the resumed token and rejects duplicate and stale replies", async (t) => {
  const f = await setup(t);
  const ready = (await f.run.status()).ready[0];
  const { started } = await f.run.start(ready.id, ready.token);
  const { question } = await f.run.question(
    started.id,
    started.token,
    "Which accepted case applies?",
  );
  const answered = await f.run.answer(
    question,
    "M1 applies",
    "Actual fixture operator answer.",
  );
  assert.notEqual(answered.resumed.token, started.token);
  assert.equal(
    (await (await f.open()).continuation("implement")).token,
    answered.resumed.token,
  );
  await assert.rejects(
    f.run.answer(question, "duplicate", "duplicate"),
    /stale|mismatched/i,
  );
  await assert.rejects(
    f.run.record(started, { summary: "stale" }, { passed: true }, "old output"),
    /stale/i,
  );
  await f.run.record(
    answered.resumed,
    { summary: "implemented" },
    { passed: true },
    "Fixture implementation evidence.",
  );
  assert.equal((await f.run.status()).ready[0].id, "self-check");
  const raw = JSON.parse(readFileSync(join(f.project, f.run.runFile), "utf8"));
  assert.equal(raw.state.nodes.implement.attempts, 1);
});

test("role completion needs an actual matching snapshot and feedback reopens the same run", async (t) => {
  const f = await setup(t);
  let ready = (await f.run.status()).ready[0];
  let { started } = await f.run.start(ready.id, ready.token);
  await f.run.record(
    started,
    { summary: "implementation" },
    { passed: true },
    "Fixture evidence.",
  );
  ready = (await f.run.status()).ready[0];
  ({ started } = await f.run.start(ready.id, ready.token));
  await assert.rejects(
    f.run.record(
      started,
      { summary: "checked", producedRevision: "invented" },
      { passed: true },
      "checks",
      f.candidate,
    ),
    /revision|candidate/i,
  );
  const done = await f.run.record(
    started,
    { summary: "checked", producedRevision: f.candidate.digest },
    { passed: true },
    "Actual snapshot checked (fixture).",
    f.candidate,
  );
  assert.equal(done.action, "role-complete");
  const next = await f.run.feedback(
    done.revisionToken,
    "implement",
    "Handle empty input",
    "Independent fixture review finding.",
  );
  assert.equal(next.runId, done.runId);
  assert.equal(next.ready[0].id, "implement");
  assert.match(
    JSON.stringify(next.ready[0].input.messages),
    /Handle empty input/,
  );
  await assert.rejects(
    f.run.feedback(done.revisionToken, "implement", "stale", "old"),
    /stale/i,
  );
});

test("needs_changes remains a native review verdict, never product approval", async (t) => {
  const f = await setup(t, "reviewer");
  const ready = (await f.run.status()).ready[0];
  const { started } = await f.run.start(ready.id, ready.token);
  const result = await f.run.record(
    started,
    {
      summary: "Missing case",
      reviewedRevision: f.candidate.digest,
      verdict: "needs_changes",
    },
    { passed: true },
    "Fixture finding R1.",
    f.candidate,
  );
  assert.equal(result.action, "role-complete");
  assert.equal(result.submission.output.verdict, "needs_changes");
});

test("cancelled Office work rejects late results before changing its kit run", async (t) => {
  const f = await setup(t);
  const ready = (await f.run.status()).ready[0];
  const { started } = await f.run.start(ready.id, ready.token);
  const before = readFileSync(join(f.project, f.run.runFile), "utf8");
  f.cancel();
  await assert.rejects(
    f.run.record(started, { summary: "late" }, { passed: true }, "late"),
    /CANCELLED/,
  );
  assert.equal(readFileSync(join(f.project, f.run.runFile), "utf8"), before);
});

test("reopening preserves changed-source rejection rather than silently creating a replacement run", async (t) => {
  const f = await setup(t);
  f.put(
    "story.md",
    readFileSync(join(f.project, "story.md"), "utf8").replace(
      "M1. Reject",
      "M1. Allow",
    ),
  );
  await assert.rejects(f.open(), /requirements changed/i);
});
