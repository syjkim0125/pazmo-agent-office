import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { freezeCandidate } from "../src/core/candidates.ts";

const kitModule = () => import("../src/core/kit-role-runs.ts");

/** A Developer or Reviewer run in a kit 5 task folder, as KitDelivery prepares it (D36). */
async function setup(t, role = "developer", { git = false } = {}) {
  const { KitRoleRun, kitWorkspace, kitG1, kitCandidate } = await kitModule();
  const f = fixture(t);
  f.put("source.txt", "before");
  if (git) {
    const run = (...args) =>
      execFileSync("git", args, { cwd: f.project, stdio: "ignore" });
    run("init", "-q");
    run("add", "-A");
    run("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "x");
  }
  mkdirSync(join(f.root, "snapshots"));
  const candidate = freezeCandidate(
    f.project,
    ["source.txt"],
    join(f.root, "snapshots"),
  );
  const view = f.story.replace(
    "Status: Draft",
    "Status: Approved\nUnderstanding gate (G1): g1.json · 2026-11-03 · Check-in: accepted",
  );
  const { root: kit, source } = kitWorkspace({
    project: f.project,
    key: "task-1:1:fixture",
    story: view,
    g1: kitG1(view, "challenge-1", {
      synthetic: "Adapter tests only; no real user approval.",
    }),
    checks: ["V1"],
  });
  kitCandidate(f.project, kit, candidate.digest, "round-1");
  let cancelled = false;
  const guard = () => {
    if (cancelled) throw Error("CANCELLED");
  };
  const assignment = {
    version: 1,
    taskId: "task-1",
    role,
    source,
    scope: ["M1", "V1"],
    targetRevision: candidate.digest,
  };
  const open = (assignmentId = "work-1") =>
    KitRoleRun.open({
      project: f.project,
      root: kit,
      assignmentId,
      assignment,
      candidate,
      guard,
    });
  return {
    ...f,
    kit,
    candidate,
    assignment,
    guard,
    open,
    run: await open(),
    cancel: () => {
      cancelled = true;
    },
    /** Office's VM observation of V1, as KitDelivery writes it before kit runs the relay. */
    observe: async (fields = {}) =>
      (await kitModule()).kitObservation(f.project, kit, {
        round: "round-1",
        check: "V1",
        candidate: candidate.digest,
        verdict: "pass",
        exitCode: 0,
        signal: null,
        timedOut: false,
        error: null,
        output: "ok 1 - fixture\n",
        ...fields,
      }),
  };
}

/** Records implement and starts self-check, so a test can verify and record it. */
async function selfCheck(run) {
  let ready = (await run.status()).ready[0];
  let { started } = await run.start(ready.id, ready.token);
  await run.record(started, { summary: "implemented" }, { passed: true }, "Fixture evidence.");
  ready = (await run.status()).ready[0];
  assert.equal(ready.id, "self-check");
  return (await run.start(ready.id, ready.token)).started;
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
  const raw = JSON.parse(
    readFileSync(join(f.project, f.run.projectRunFile), "utf8"),
  );
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
  await f.observe();
  assert.equal((await f.run.verify(started, "V1")).verification.passed, true);
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
  const before = readFileSync(join(f.project, f.run.projectRunFile), "utf8");
  f.cancel();
  await assert.rejects(
    f.run.record(started, { summary: "late" }, { passed: true }, "late"),
    /CANCELLED/,
  );
  assert.equal(
    readFileSync(join(f.project, f.run.projectRunFile), "utf8"),
    before,
  );
});

test("reopening preserves changed-source rejection rather than silently creating a replacement run", async (t) => {
  const f = await setup(t);
  const view = join(f.project, f.kit, "story.md");
  writeFileSync(
    view,
    readFileSync(view, "utf8").replace("M1. Reject", "M1. Allow"),
  );
  await assert.rejects(f.open(), /requirements changed|approval binding/i);
});

test("the kit 5 G1 record binds the view's canonical text exactly as kit hashes it", async () => {
  const { kitStoryHash, kitG1 } = await kitModule();
  const { storyContract } = await import("../.ai-workflow/graph/workflow.mjs");
  for (const text of [
    "# Story: a\nStatus: Approved\nUnderstanding gate (G1): g1.json · 2026-11-03 · Check-in: accepted\n## MUST\n- M1. x\n",
    "# Story: a\r\nStatus: Draft\r\nG4: PASS — fixture\r\nUnderstanding gate (G4): pending\r\n\r\n## Verify\r\n- V1 [M1]. y\r\n",
  ])
    assert.equal(kitStoryHash(text), storyContract(text).fingerprint);
  const record = JSON.parse(kitG1("# Story: a\n", "c-9", { taskId: "t" }));
  assert.deepEqual(
    [record.gate, record.responseRef, record.taskId],
    ["G1", "office-approval:c-9", "t"],
  );
});

test("kitG1 keeps office-approval:<id> by default and writes hub-approval:<id> when asked; kitG3 binds the design hash and the story hash", async () => {
  const { kitStoryHash, kitG1, kitG3 } = await kitModule();
  const { digest } = await import("../src/core/candidates.ts");
  const view = "# Story: a\nStatus: Approved\nUnderstanding gate (G1): hub-approval:a-1 · 2026-11-06 · Check-in: accepted\n## MUST\n- M1. x\n";
  const office = JSON.parse(kitG1(view, "c-9", { taskId: "t" }));
  assert.equal(office.responseRef, "office-approval:c-9");
  assert.equal(kitG1(view, "c-9", { taskId: "t" }, "office-approval"), JSON.stringify(office));
  const hub = JSON.parse(kitG1(view, "a-1", { planId: "p" }, "hub-approval"));
  assert.deepEqual(hub, { planId: "p", gate: "G1", storyHash: kitStoryHash(view), responseRef: "hub-approval:a-1" });
  const design = "# Decision requiring human G3\n\n계획\n\n## Task 목록\n- t1 · app-be · 주문 API\n\nUnderstanding gate (G3): pending\n";
  assert.deepEqual(JSON.parse(kitG3(design, view, "a-3", { planId: "p", gate: "G1" })), {
    planId: "p",
    gate: "G3",
    designHash: digest(design),
    storyHash: kitStoryHash(view),
    responseRef: "hub-approval:a-3",
  });
});

test("new runs are kit 5 role runs in kit-runs, and a kit 4 run file is never touched", async (t) => {
  const { KitRoleRun } = await kitModule();
  const f = fixture(t);
  f.put("request.json", JSON.stringify({ request: "fixture" }));
  mkdirSync(join(f.root, "snapshots"));
  const candidate = freezeCandidate(f.project, ["request.json"], join(f.root, "snapshots"));
  const legacy = join(f.project, KitRoleRun.legacyRunFile("pm-1"));
  mkdirSync(join(legacy, ".."), { recursive: true });
  writeFileSync(legacy, '{"version":2}');
  const run = await KitRoleRun.open({
    project: f.project,
    assignmentId: "pm-1",
    assignment: {
      version: 1,
      taskId: "task-1",
      role: "pm",
      source: "request.json",
      scope: [],
      targetRevision: candidate.digest,
    },
    candidate,
    guard: () => {},
  });
  assert.equal(run.projectRunFile, `${KitRoleRun.projectRunDirectory("pm-1")}/run.json`);
  assert.match(run.projectRunFile, /^\.pazmo-office\/kit-runs\//);
  const raw = JSON.parse(readFileSync(join(f.project, run.projectRunFile), "utf8"));
  assert.deepEqual([raw.version, raw.kind], [3, "role"]);
  assert.equal(readFileSync(legacy, "utf8"), '{"version":2}');
});

test("a self-check passes only with a relay receipt of the VM observation of this candidate and round", async (t) => {
  const f = await setup(t);
  // No receipt: kit refuses the pass Office would otherwise just claim.
  let started = await selfCheck(f.run);
  await assert.rejects(
    f.run.record(started, { summary: "checked", producedRevision: f.candidate.digest }, { passed: true }, "claim", f.candidate),
    /Verification execution required for V1/,
  );
  // No observation yet: the relay fails, and its failed receipt cannot carry a pass.
  let ran = await f.run.verify(started, "V1");
  assert.equal(ran.verification.passed, false);
  assert.match(
    readFileSync(join(f.project, f.kit, ran.verification.stderr), "utf8"),
    /no VM observation of V1 in round round-1/,
  );
  await assert.rejects(
    f.run.record(started, { summary: "checked", producedRevision: f.candidate.digest }, { passed: true }, "claim", f.candidate),
    /failed|snapshot/i,
  );
  // kit runs a check once per attempt: a second execution needs a reset first.
  await assert.rejects(f.run.verify(started, "V1"), /already executed/);
  // An observation of another candidate, and a failed one, are refused by the relay too.
  for (const [id, fields, why] of [
    ["work-2", { candidate: "another" }, /another candidate or round/],
    ["work-3", { verdict: "fail", exitCode: 1 }, /did not pass/],
    ["work-5", { timedOut: true }, /did not pass/],
    ["work-6", { error: "VM lost" }, /did not pass/],
  ]) {
    const { kitCandidate } = await kitModule();
    const round = `round-${id}`;
    kitCandidate(f.project, f.kit, f.candidate.digest, round);
    const other = await f.open(id);
    started = await selfCheck(other);
    await f.observe({ round, ...fields });
    ran = await other.verify(started, "V1");
    assert.equal(ran.verification.passed, false);
    assert.match(readFileSync(join(f.project, f.kit, ran.verification.stderr), "utf8"), why);
  }
  // The passing observation of this candidate and round: the relay prints its output and kit records the pass.
  const { kitCandidate } = await kitModule();
  kitCandidate(f.project, f.kit, f.candidate.digest, "round-work-4");
  const good = await f.open("work-4");
  started = await selfCheck(good);
  await f.observe({ round: "round-work-4", output: "ok 1 - real VM output\n" });
  ran = await good.verify(started, "V1");
  assert.equal(ran.verification.passed, true);
  assert.equal(
    readFileSync(join(f.project, f.kit, ran.verification.stdout), "utf8"),
    "ok 1 - real VM output\n",
  );
  const done = await good.record(started, { summary: "checked", producedRevision: f.candidate.digest }, { passed: true }, "VM checks", f.candidate);
  assert.equal(done.action, "role-complete");
  const proof = await good.completionProof();
  assert.ok(proof.files.every((file) => file.path.startsWith(`${f.kit}/`)));
  assert.ok(proof.files.some((file) => file.path.endsWith("/stdout.log")));
  assert.ok(proof.files.some((file) => file.path === `${f.kit}/g1.json`));
});

test("a Reviewer is bound to the candidate it reviews, not to the person's checkout", async (t) => {
  const f = await setup(t, "reviewer", { git: true });
  assert.equal((await f.run.status()).action, "execute");
  // The person edits and commits in their own checkout: the review stays valid.
  f.put("source.txt", "edited by the person");
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qam", "edit"], { cwd: f.project });
  const ready = (await f.run.status()).ready[0];
  assert.equal(ready.id, "review");
  const { started } = await f.run.start(ready.id, ready.token);
  // Office points the folder at another candidate: this review is stale and cannot pass.
  const { kitCandidate } = await kitModule();
  kitCandidate(f.project, f.kit, "another-candidate", "round-2");
  assert.equal((await f.run.status()).action, "stale");
  await assert.rejects(
    f.run.record(started, { summary: "ok", reviewedRevision: f.candidate.digest, verdict: "pass" }, { passed: true }, "review", f.candidate),
    /snapshot changed/i,
  );
  assert.ok(!existsSync(join(f.project, ".ai-workflow")));
});
