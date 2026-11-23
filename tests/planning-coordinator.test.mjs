import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createServer } from "node:http";
import { handleOperator } from "../src/runtime/operator.ts";
import { fixture } from "./contract-fixture.mjs";
import { applyLeanSchema } from "../src/lean/schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { PlanningCoordinator } from "../src/runners/planning-coordinator.ts";
const token = "a".repeat(64);
function setup(t, mode = "ready") {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "planning.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyLeanSchema(db, "/office-test-project");
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token),
    intake = new IntakeLedger(db, store, f.project),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification, Date.now, intake);
  mkdirSync(join(f.root, "context"));
  const context = freezeCandidate(
    f.project,
    ["story.md"],
    join(f.root, "context"),
  );
  const item = intake.create(token, "Validate input.", "normal"),
    packets = [],
    prompts = [];
  const jobFor = (packet, assignedContext, prompt) => {
    assert.ok(prompt.includes(assignedContext.digest));
    assert.ok(prompt.includes("/candidate/tree"));
    assert.ok(!prompt.includes(assignedContext.directory));
    packets.push(packet);
    prompts.push(
      JSON.parse(
        prompt
          .split("BEGIN PLANNING TASK DATA\n")[1]
          .split("\nEND PLANNING TASK DATA")[0],
      ),
    );
    return { binary: "unused-fixture", timeoutMs: 10000, packet };
  };
  const planner = {
    async run(candidate, job, beforeStart, signal) {
      const handle = "fixture-" + packets.length;
      beforeStart(handle);
      let body;
      if (job.packet.role === "pm")
        body =
          mode === "questions"
            ? {
                status: "questions",
                questions: [
                  { id: "Q1", text: "Which parser?", reason: "Scope." },
                ],
              }
            : {
                status: "ready",
                story: {
                  title: "Validate input",
                  goal: "Reject invalid input.",
                  domain: "Preserve records.",
                  must: ["Reject invalid input."],
                  should: [],
                  out: ["Deployment."],
                  assumptions: [],
                  verify: [
                    { must: [1], scenario: "Invalid input returns error." },
                  ],
                },
              };
      else
        body = {
          plan: "Inspect parser and test.",
          tasks: [
            {
              title: "Input validation",
              outcome: "Reject input.",
              scope: "Parser and tests.",
              constraints: "Keep records.",
              must: [1],
              verify: [1],
              checks: [{ id: "V1", argv: ["node", "--test"], timeoutMs: 1000 }],
              workspace: { include: ["src"], exclude: [] },
            },
          ],
        };
      return {
        handle,
        closed: true,
        cleanupErrors: [],
        result: {
          exitCode: 0,
          signal: null,
          timedOut: false,
          error: null,
          stderr: "",
          stdout: [
            { type: "turn.started" },
            // A Lead grounds its proposal in the readonly snapshot.
            ...(job.packet.role === "lead"
              ? [
                  {
                    type: "item.completed",
                    item: {
                      type: "command_execution",
                      command: "/bin/bash -lc 'ls /candidate/tree'",
                      exit_code: 0,
                      status: "completed",
                    },
                  },
                ]
              : []),
            {
              type: "item.completed",
              item: {
                type: "agent_message",
                text: JSON.stringify({
                  version: 1,
                  inputDigest: job.packet.inputDigest,
                  ...body,
                }),
              },
            },
            { type: "turn.completed" },
          ]
            .map(JSON.stringify)
            .join("\n"),
        },
      };
    },
  };
  const dataDir = join(f.root, "data");
  mkdirSync(dataDir);
  const deps = {
    intake,
    execution,
    planner,
    jobFor,
    dataDir,
  };
  return {
    ...f,
    db,
    store,
    intake,
    execution,
    context,
    item,
    packets,
    prompts,
    planner,
    deps,
    dataDir,
    coordinator: new PlanningCoordinator(deps),
  };
}

/** The PM's Story, approved by the person (G1), so the next run is the Lead's. */
async function approvedPm(f) {
  const pm = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  return f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, {
    decision: "approve",
    note: "Fixture human G1",
  });
}

test("the PM's Story waits for the person's G1 through the operator API, then the Lead plans from the approved Story", async (t) => {
  const f = setup(t);
  const pm = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(pm.state, "human_required");
  assert.equal(pm.intake.reason, "G1_REQUIRED");
  assert.deepEqual(
    f.packets.map((p) => p.role),
    ["pm"],
  );
  assert.equal(pm.intake.story.must[0], "Reject invalid input.");
  // No Lead model before G1, however often the controller looks.
  await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 1);
  assert.throws(
    () =>
      f.intake.approveStory(
        "worker",
        f.item.taskId,
        pm.intake.revision,
        pm.intake.inputDigest,
        { decision: "approve", note: "Fixture human scope approval" },
      ),
    { code: "UNAUTHORIZED" },
  );
  const server = createServer(
    (req, res) =>
      void handleOperator(
        req,
        res,
        new URL(req.url, "http://localhost").pathname,
        f,
      ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/pazmo/intakes/${f.item.taskId}/approve-story`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        revision: pm.intake.revision,
        inputDigest: pm.intake.inputDigest,
        answer: { decision: "approve", note: "Fixture human scope approval" },
      }),
    },
  );
  assert.equal(response.status, 200);
  const approved = await response.json();
  assert.equal(approved.state, "waiting_lead");
  assert.equal(
    approved.events.at(-1).payload.scopeApproval.answer.note,
    "Fixture human scope approval",
  );
  assert.throws(
    () =>
      f.intake.approveStory(
        token,
        f.item.taskId,
        pm.intake.revision,
        pm.intake.inputDigest,
        { decision: "approve", note: "Repeat" },
      ),
    { code: "STALE_INTAKE" },
  );
  const lead = await new PlanningCoordinator(f.deps).run(
    f.item.taskId,
    f.context,
  );
  assert.equal(lead.state, "proposal");
  assert.deepEqual(
    f.packets.map((p) => p.role),
    ["pm", "lead"],
  );
  assert.deepEqual(f.packets[1].story, pm.intake.story);
  assert.deepEqual(
    lead.intake.events.map((e) => e.actor),
    ["human", "pm", "human", "lead"],
  );
  assert.ok(
    f.execution
      .listPlanning(f.item.taskId)
      .every((l) => l.state === "released"),
  );
  assert.equal(f.store.list().length, 0);
});

test("a rejected G1 stops planning without a Lead turn", async (t) => {
  const f = setup(t);
  const pm = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  const rejected = f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, {
    decision: "reject",
    note: "Fixture: not this scope",
  });
  assert.equal(rejected.state, "human_required");
  assert.equal(rejected.reason, "G1_REJECTED");
  await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 1);
});

test("a revision that already ran a planning turn is not run again", async (t) => {
  const f = setup(t);
  // Emulates a released turn of this revision whose result never advanced the conversation: the revision keeps its
  // one lease, so no second model turn starts for it.
  const lease = f.execution.reservePlanning(
    f.item.taskId,
    f.item.revision,
    f.item.inputDigest,
    f.context.digest,
  );
  f.db.prepare("UPDATE pazmo_planning_leases SET state='released' WHERE id=?").run(lease.id);
  let turns = 0;
  const original = f.planner.run;
  f.planner.run = async (...args) => {
    turns++;
    return original(...args);
  };
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "deferred");
  assert.equal(turns, 0);
  assert.equal(f.intake.get(f.item.taskId).state, "waiting_pm");
  assert.equal(f.execution.listPlanning(f.item.taskId).length, 1);
});

test("planning saved for the removed workflow runtime stops with its plain reason and runs no model (가)", async (t) => {
  const { digest } = await import("../src/core/candidates.ts");
  const f = setup(t),
    p = f.intake.packet(f.item.taskId, f.item.revision, f.item.inputDigest);
  const { inputDigest: _, ...data } = { ...p, workflow: "kit-role-v1" };
  const legacy = { ...data, inputDigest: digest(JSON.stringify(data)) };
  f.db
    .prepare("UPDATE pazmo_intakes SET packet_json=? WHERE task_id=?")
    .run(JSON.stringify(legacy), f.item.taskId);
  const warnings = t.mock.method(console, "warn", () => {});
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "human_required");
  assert.equal(result.intake.reason, "LEGACY_TASK");
  assert.equal(f.packets.length, 0);
  assert.equal(f.execution.listPlanning(f.item.taskId).length, 0);
  assert.equal(warnings.mock.callCount(), 1);
  assert.match(warnings.mock.calls[0].arguments[0], new RegExp(f.item.taskId));
  // Other requests keep planning.
  const other = f.intake.create(token, "Other work.", "normal");
  assert.equal(
    (await new PlanningCoordinator(f.deps).run(other.taskId, f.context)).intake.reason,
    "G1_REQUIRED",
  );
});


/** Marks the request's saved packet as the removed runtime's planning packet (`workflow: "kit-role-v1"`), as
 * requests begun before the upgrade have it, keeping its state. */
async function markLegacyPacket(f, taskId) {
  const { digest } = await import("../src/core/candidates.ts");
  const p = JSON.parse(f.db.prepare("SELECT packet_json FROM pazmo_intakes WHERE task_id=?").get(taskId).packet_json);
  const { inputDigest: _, ...data } = { ...p, workflow: "kit-role-v1" };
  f.db
    .prepare("UPDATE pazmo_intakes SET packet_json=? WHERE task_id=?")
    .run(JSON.stringify({ ...data, inputDigest: digest(JSON.stringify(data)) }), taskId);
  return f.intake.get(taskId);
}

test("a legacy request's questions, Story G1 and planning retry are refused with LEGACY_TASK, and the controller stops it from any open state (가)", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { pmQuestions } = await import("./planning-fixture.mjs");
  // Questions pending at the upgrade: answering would drop the mark and plan on.
  const asking = setup(t);
  pmQuestions(asking.intake, asking.item.taskId, [{ id: "Q1", text: "Which parser?", reason: "Scope." }]);
  const waiting = await markLegacyPacket(asking, asking.item.taskId);
  assert.equal(asking.intake.legacy(waiting.taskId), true);
  assert.throws(
    () => asking.intake.answer(token, waiting.taskId, waiting.revision, waiting.inputDigest, [{ id: "Q1", answer: "Public." }]),
    { code: "LEGACY_TASK" },
  );
  const stopped = asking.intake.stopLegacy(waiting.taskId);
  assert.deepEqual([stopped.state, stopped.reason], ["human_required", "LEGACY_TASK"]);
  assert.equal(asking.intake.stopLegacy(waiting.taskId).revision, stopped.revision, "stopping again changes nothing");

  // A Story waiting for G1, and rejected output waiting for a retry.
  const story = setup(t);
  const pm = (await story.coordinator.run(story.item.taskId, story.context)).intake;
  const g1 = await markLegacyPacket(story, pm.taskId);
  assert.throws(
    () => story.intake.approveStory(token, g1.taskId, g1.revision, g1.inputDigest, { decision: "approve", note: "n" }),
    { code: "LEGACY_TASK" },
  );
  assert.equal(story.intake.stopLegacy(g1.taskId).reason, "LEGACY_TASK");
  const rejected = setup(t);
  const original = rejected.planner.run;
  rejected.planner.run = async (...args) => {
    const report = await original(...args);
    report.result.stdout = "malformed";
    return report;
  };
  const failed = await markLegacyPacket(rejected, (await rejected.coordinator.run(rejected.item.taskId, rejected.context)).intake.taskId);
  assert.throws(
    () => rejected.intake.retryPlanning(token, failed.taskId, failed.revision, failed.inputDigest, "retry"),
    { code: "LEGACY_TASK" },
  );
  // A request planned after the upgrade is not legacy and cannot be stopped as one.
  const fresh = setup(t);
  assert.equal(fresh.intake.legacy(fresh.item.taskId), false);
  assert.throws(() => fresh.intake.stopLegacy(fresh.item.taskId), { code: "INTAKE_STATE" });
});

test("explicit planning recovery keeps the approved Story and bounds retries", async (t) => {
  const f = setup(t);
  const approved = await approvedPm(f);
  const original = f.planner.run;
  f.planner.run = async (...args) => {
    const report = await original(...args);
    report.result.stdout = "malformed fixture response";
    return report;
  };
  const failed = (await f.coordinator.run(approved.taskId, f.context)).intake;
  assert.equal(failed.reason, "PLANNING_INVALID");
  assert.throws(
    () =>
      f.intake.retryPlanning(
        "worker",
        failed.taskId,
        failed.revision,
        failed.inputDigest,
        "retry",
      ),
    { code: "UNAUTHORIZED" },
  );
  const next = f.intake.retryPlanning(
    token,
    failed.taskId,
    failed.revision,
    failed.inputDigest,
    "Fixture user: resume after protocol fix",
  );
  assert.equal(next.state, "waiting_lead");
  assert.deepEqual(next.story, approved.story);
  assert.throws(
    () =>
      f.intake.retryPlanning(
        token,
        failed.taskId,
        failed.revision,
        failed.inputDigest,
        "duplicate",
      ),
    { code: "STALE_INTAKE" },
  );
  f.planner.run = original;
  const done = await new PlanningCoordinator(f.deps).run(approved.taskId, f.context);
  assert.equal(done.state, "proposal");
  assert.deepEqual(
    f.packets.map((p) => p.role),
    ["pm", "lead", "lead"],
  );
  assert.equal(
    done.intake.events.filter((e) => e.payload.scopeApproval).length,
    1,
  );
});

test("a Lead that never inspected the readonly snapshot cannot become a proposal", async (t) => {
  const f = setup(t);
  const approved = await approvedPm(f);
  const original = f.planner.run;
  f.planner.run = async (...args) => {
    const report = await original(...args);
    // Observed 2026-10-02: a Lead claimed /candidate/tree was unavailable without
    // running any command, relying on an earlier proposal.
    if (args[1].packet.role === "lead")
      report.result.stdout = report.result.stdout
        .split("\n")
        .filter((line) => JSON.parse(line).item?.type !== "command_execution")
        .join("\n");
    return report;
  };
  const result = (await f.coordinator.run(approved.taskId, f.context)).intake;
  assert.equal(result.state, "human_required");
  assert.equal(result.reason, "INSPECTION_REQUIRED");
  assert.equal(result.proposal, null);
  assert.equal(f.execution.listPlanning(approved.taskId).at(-1).state, "released");
});

test("Lead prompts state the snapshot is reachable and the approved Story is not evidence", async (t) => {
  const f = setup(t),
    original = f.deps.jobFor,
    prompts = [];
  f.deps.jobFor = (packet, context, prompt) => {
    prompts.push({ role: packet.role, prompt });
    return original(packet, context, prompt);
  };
  const pm = (await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context))
    .intake;
  f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, {
    decision: "approve",
    note: "Fixture human G1",
  });
  await new PlanningCoordinator(f.deps).run(pm.taskId, f.context);
  const instructions = (p) => p.split("BEGIN PLANNING TASK DATA")[0];
  const lead = prompts.filter((p) => p.role === "lead");
  assert.equal(lead.length, 1);
  for (const { prompt } of lead) {
    assert.match(instructions(prompt), /shell commands reach the readonly snapshot at \/candidate\/tree/);
    assert.match(instructions(prompt), /not evidence/);
    // Only the PM asks (D1): the Lead is told so, and its limits list no question set.
    assert.match(instructions(prompt), /Office does not accept questions from the Lead/);
    assert.doesNotMatch(instructions(prompt), /- questions: 1-/);
  }
  for (const { prompt } of prompts) assert.doesNotMatch(prompt, /\bkit\b/i);
  for (const { prompt } of prompts.filter((p) => p.role === "pm"))
    assert.doesNotMatch(instructions(prompt), /shell commands reach/);
});

test("the Lead cannot ask questions: a Lead question set is rejected output", async (t) => {
  const f = setup(t);
  const approved = await approvedPm(f);
  const original = f.planner.run;
  f.planner.run = async (...args) => {
    const report = await original(...args),
      packet = args[1].packet;
    const lines = report.result.stdout.split("\n").map(JSON.parse);
    lines.at(-2).item.text = JSON.stringify({
      version: 1,
      inputDigest: packet.inputDigest,
      status: "questions",
      questions: [{ id: "Q1", text: "Which test command?", reason: "Project choice" }],
    });
    report.result.stdout = lines.map(JSON.stringify).join("\n");
    return report;
  };
  const result = (await f.coordinator.run(approved.taskId, f.context)).intake;
  assert.equal(result.state, "human_required");
  assert.equal(result.reason, "PLANNING_INVALID");
  assert.equal(result.questions, null);
});

test("planning recovery rejects unknown, cancelled and exhausted requests without replay", async (t) => {
  const f = setup(t),
    original = f.planner.run;
  f.planner.run = async (...args) => {
    const r = await original(...args);
    r.result.stdout = "malformed";
    return r;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const failed = (await f.coordinator.run(f.item.taskId, f.context)).intake;
    if (attempt === 0) {
      const lease = f.execution.listPlanning(f.item.taskId).at(-1);
      f.db
        .prepare("UPDATE pazmo_planning_leases SET state='unknown' WHERE id=?")
        .run(lease.id);
      assert.throws(
        () =>
          f.intake.retryPlanning(
            token,
            failed.taskId,
            failed.revision,
            failed.inputDigest,
            "resume",
          ),
        { code: "TASK_ACTIVE" },
      );
      f.db
        .prepare("UPDATE pazmo_planning_leases SET state='released' WHERE id=?")
        .run(lease.id);
    }
    if (attempt < 2)
      f.intake.retryPlanning(
        token,
        failed.taskId,
        failed.revision,
        failed.inputDigest,
        "Fixture explicit retry",
      );
    else {
      assert.throws(
        () =>
          f.intake.retryPlanning(
            token,
            failed.taskId,
            failed.revision,
            failed.inputDigest,
            "again",
          ),
        { code: "PLANNING_RETRY_LIMIT" },
      );
      const cancelled = f.intake.cancel(
        token,
        failed.taskId,
        failed.revision,
        failed.inputDigest,
      );
      assert.throws(
        () =>
          f.intake.retryPlanning(
            token,
            cancelled.taskId,
            cancelled.revision,
            cancelled.inputDigest,
            "again",
          ),
        { code: "INTAKE_STATE" },
      );
    }
  }
  assert.equal(f.packets.length, 3);
});

function failWith(f, kinds) {
  const original = f.planner.run,
    oauth = readFileSync(
      new URL("./fixtures/claude-oauth-refresh-failed.jsonl", import.meta.url),
      "utf8",
    );
  f.planner.run = async (...args) => {
    const r = await original(...args);
    if (kinds.shift() === "runner") {
      r.result.stdout = oauth;
      r.result.exitCode = 1;
    } else r.result.stdout = "malformed";
    return r;
  };
}
const failure = (i) =>
  i.events.findLast((e) => e.actor === "controller" && e.payload.error).payload;

test("a runner failure is recorded as one and does not spend the format recovery budget", async (t) => {
  const f = setup(t);
  failWith(f, ["runner", "runner", "output", "output", "output"]);
  const origins = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const failed = (await f.coordinator.run(f.item.taskId, f.context)).intake;
    assert.equal(failed.reason, "PLANNING_INVALID");
    const payload = failure(failed);
    origins.push(payload.origin);
    if (payload.origin === "runner") {
      assert.match(payload.detail, /^runner: OAuth token refresh failed/);
      assert.ok(payload.output, "the raw runner output is still archived");
    }
    const retry = () =>
      f.intake.retryPlanning(
        token,
        failed.taskId,
        failed.revision,
        failed.inputDigest,
        "Fixture explicit retry",
      );
    if (attempt < 4) {
      const next = retry();
      assert.equal(next.events.at(-1).payload.planningRetry.origin, payload.origin);
    } else assert.throws(retry, { code: "PLANNING_RETRY_LIMIT" });
  }
  assert.deepEqual(origins, ["runner", "runner", "output", "output", "output"]);
});

test("runner failure recoveries have their own bound", async (t) => {
  const f = setup(t);
  failWith(f, ["runner", "runner", "runner", "runner"]);
  for (let attempt = 0; attempt < 4; attempt++) {
    const failed = (await f.coordinator.run(f.item.taskId, f.context)).intake;
    const retry = () =>
      f.intake.retryPlanning(
        token,
        failed.taskId,
        failed.revision,
        failed.inputDigest,
        "Fixture: signed in again",
      );
    if (attempt < 3) retry();
    else assert.throws(retry, { code: "PLANNING_RETRY_LIMIT" });
  }
  assert.equal(f.packets.length, 4);
});

test("controller restart quarantines the active lease and never replays the same turn", async (t) => {
  const f = setup(t),
    original = f.planner.run;
  f.planner.run = async (...args) => {
    const report = await original(...args);
    f.execution.recoverInterrupted();
    return report;
  };
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "human_required");
  assert.equal(f.execution.listPlanning(f.item.taskId)[0].state, "unknown");
  await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 1);
});

test("PM and Lead execute in order and persist a proposal without approving or registering work", async (t) => {
  const f = setup(t);
  await approvedPm(f);
  const r = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(r.state, "proposal");
  assert.deepEqual(
    f.packets.map((p) => p.role),
    ["pm", "lead"],
  );
  assert.ok(f.packets[1].story);
  assert.deepEqual(
    f.intake.get(f.item.taskId).events.map((e) => e.actor),
    ["human", "pm", "human", "lead"],
  );
  assert.deepEqual(
    f.execution.listPlanning(f.item.taskId).map((l) => l.state),
    ["released", "released"],
  );
  assert.equal(f.store.list().length, 0);
  await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 2);
});

test("questions stop dispatch until an addressed human answer, then resume only the new revision", async (t) => {
  const f = setup(t, "questions");
  await f.coordinator.run(f.item.taskId, f.context);
  const waiting = f.intake.get(f.item.taskId);
  assert.equal(waiting.state, "awaiting_answer");
  assert.equal(f.packets.length, 1);
  await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 1);
  f.intake.answer(
    token,
    waiting.taskId,
    waiting.revision,
    waiting.inputDigest,
    [{ id: "Q1", answer: "Public parser." }],
  );
  await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 2);
  assert.equal(f.packets[1].dialogue[0].answers[0].answer, "Public parser.");
});

test("capacity deferral reserves no extra execution and the turn runs once capacity frees", async (t) => {
  const f = setup(t),
    leases = [];
  for (let i = 0; i < 3; i++) {
    const s = f.intake.create(token, "Other work.", "normal");
    leases.push(
      f.execution.reservePlanning(
        s.taskId,
        s.revision,
        s.inputDigest,
        f.context.digest,
      ),
    );
  }
  assert.equal(
    (await f.coordinator.run(f.item.taskId, f.context)).state,
    "deferred",
  );
  assert.equal(f.execution.listPlanning(f.item.taskId).length, 0);
  f.execution.startPlanning(leases[0].id, "fixture-capacity-release");
  f.execution.finishPlanning(leases[0].id, "fixture-capacity-release", {
    closed: true,
    result: { exitCode: 1, signal: null, error: null, timedOut: false, stdout: "", stderr: "Fixture failure" },
  });
  const pm = (await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context)).intake;
  assert.equal(pm.reason, "G1_REQUIRED");
  assert.equal(f.execution.listPlanning(f.item.taskId).length, 1);
});

test("cancellation and controller abort discard late success while awaiting confirmed cleanup", async (t) => {
  for (const mode of ["cancel", "abort", "restart", "duplicate"])
    await t.test(mode, async (t) => {
      const f = setup(t),
        parent = new AbortController();
      const original = f.planner.run;
      f.planner.run = async (...args) => {
        const report = await original(...args);
        if (mode === "cancel")
          f.intake.cancel(
            token,
            f.item.taskId,
            f.item.revision,
            f.item.inputDigest,
          );
        if (mode === "abort") parent.abort();
        if (mode === "restart") f.execution.recoverInterrupted();
        if (mode === "duplicate") {
          const duplicate = await new PlanningCoordinator(f.deps).run(
            f.item.taskId,
            f.context,
          );
          assert.equal(duplicate.state, "deferred");
          f.intake.cancel(
            token,
            f.item.taskId,
            f.item.revision,
            f.item.inputDigest,
          );
        }
        return report;
      };
      const r = await f.coordinator.run(
        f.item.taskId,
        f.context,
        parent.signal,
      );
      assert.equal(
        r.state,
        mode === "cancel" || mode === "duplicate"
          ? "cancelled"
          : "human_required",
      );
      assert.equal(f.packets.length, 1);
      assert.equal(
        f.execution.listPlanning(f.item.taskId)[0].state,
        mode === "restart" ? "unknown" : "released",
      );
      assert.equal(
        f.intake.get(f.item.taskId).events.some((e) => e.actor === "pm"),
        false,
      );
    });
});

test("lost supervisor and altered context stop durably without relaunch", async (t) => {
  for (const mode of ["lost", "context"])
    await t.test(mode, async (t) => {
      const f = setup(t);
      if (mode === "lost")
        f.planner.run = async () => {
          throw Error("supervisor disappeared");
        };
      else f.context.digest = "c".repeat(64);
      assert.equal(
        (await f.coordinator.run(f.item.taskId, f.context)).state,
        "human_required",
      );
      const count = f.packets.length;
      await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context);
      assert.equal(f.packets.length, count);
      if (mode === "lost")
        assert.equal(
          f.execution.listPlanning(f.item.taskId)[0].state,
          "unknown",
        );
    });
});

test("an old saved role profile stops for inspection instead of silently rewriting the conversation", async (t) => {
  const { digest } = await import("../src/core/candidates.ts");
  const f = setup(t),
    p = f.intake.packet(f.item.taskId, f.item.revision, f.item.inputDigest);
  p.profile.ref = "pazmo-pm@1.0.0";
  const { inputDigest, ...data } = p;
  p.inputDigest = digest(JSON.stringify(data));
  const before = JSON.stringify(p);
  f.db
    .prepare("UPDATE pazmo_intakes SET packet_json=? WHERE task_id=?")
    .run(before, f.item.taskId);
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "human_required");
  assert.equal(result.intake.reason, "ROLE_PROFILE_INVALID");
  assert.equal(f.packets.length, 0);
  assert.equal(f.execution.listPlanning(f.item.taskId).length, 0);
  assert.equal(
    f.db
      .prepare("SELECT packet_json FROM pazmo_intakes WHERE task_id=?")
      .get(f.item.taskId).packet_json,
    before,
  );
});

function rejectWith(f, stdout) {
  const original = f.planner.run;
  f.planner.run = async (...args) => {
    const report = await original(...args);
    report.result.stdout = stdout;
    return report;
  };
}
function rejection(f, result) {
  const event = result.intake.events.at(-1);
  assert.equal(event.actor, "controller");
  return event.payload;
}

test("rejection records its rule and keeps raw output only in the data directory", async (t) => {
    const f = setup(t),
      raw = "PROJECT-CONTENT-MARKER not a report";
    rejectWith(f, raw);
    const result = await f.coordinator.run(f.item.taskId, f.context);
    assert.equal(result.intake.reason, "PLANNING_INVALID");
    const payload = rejection(f, result);
    assert.equal(payload.error, "PLANNING_INVALID");
    assert.equal(payload.detail, `terminal report missing (stdout ${raw.length} bytes)`);
    assert.match(payload.output, /^planning\/rejected\/[a-f0-9]{64}-r1\.jsonl$/);
    assert.equal(payload.outputBytes, raw.length);
    assert.equal(payload.truncated, undefined);
    const file = join(f.dataDir, payload.output);
    assert.equal(readFileSync(file, "utf8"), raw);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const stored = f.db
      .prepare("SELECT payload_json FROM pazmo_intake_events")
      .all()
      .map((r) => r.payload_json)
      .join("\n");
    assert.doesNotMatch(stored, /PROJECT-CONTENT-MARKER/);
    assert.equal(f.execution.listPlanning(f.item.taskId)[0].state, "released");
  });

test("rejected output is capped at 64KB and the original size is recorded", async (t) => {
  const f = setup(t);
  rejectWith(f, "x".repeat(100000));
  const payload = rejection(
    f,
    await f.coordinator.run(f.item.taskId, f.context),
  );
  assert.equal(payload.outputBytes, 100000);
  assert.equal(payload.truncated, true);
  assert.equal(statSync(join(f.dataDir, payload.output)).size, 65536);
});

test("without a data directory the rejection still records its detail", async (t) => {
  const f = setup(t);
  rejectWith(f, "not a report");
  delete f.deps.dataDir;
  const payload = rejection(
    f,
    await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context),
  );
  assert.deepEqual(payload, {
    error: "PLANNING_INVALID",
    detail: "terminal report missing (stdout 12 bytes)",
    origin: "output",
  });
});

for (const [label, path, accepted] of [
  ["a successful bridge file read inside the snapshot", "/candidate/tree/README.md", true],
  ["a file read outside the snapshot", "/tmp/README.md", false],
]) {
  test(`Lead inspection evidence: ${label}`, async (t) => {
    const f = setup(t);
    const pm = (await f.coordinator.run(f.item.taskId, f.context)).intake;
    f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, {
      decision: "approve",
      note: "Fixture human G1",
    });
    const original = f.planner.run;
    f.planner.run = async (...args) => {
      const report = await original(...args);
      // A claude Lead reads files through the Office bridge instead of a shell.
      if (args[1].packet.role === "lead")
        report.result.stdout = report.result.stdout
          .split("\n")
          .map((line) =>
            JSON.parse(line).item?.type === "command_execution"
              ? JSON.stringify({ type: "item.completed", item: { type: "file_read", path, status: "completed" } })
              : line,
          )
          .join("\n");
      return report;
    };
    const result = (await f.coordinator.run(pm.taskId, f.context)).intake;
    if (accepted) {
      assert.notEqual(result.reason, "INSPECTION_REQUIRED");
      assert.ok(result.proposal);
    } else assert.equal(result.reason, "INSPECTION_REQUIRED");
  });
}

