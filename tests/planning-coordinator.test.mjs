import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createServer } from "node:http";
import { handleOperator } from "../src/runtime/operator.ts";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { PlanningCoordinator } from "../src/runners/planning-coordinator.ts";
const token = "a".repeat(64);
function setup(t, mode = "ready", kitRoles = false) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "planning.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
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
  const item = intake.create(token, "Validate input.", "normal", kitRoles),
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
  const deps = { intake, execution, planner, jobFor, project: f.project };
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
    coordinator: new PlanningCoordinator(deps),
  };
}

test("native PM completes its graph, real human G1 gates Lead, and Lead uses the approved Story", async (t) => {
  const f = setup(t, "ready", true);
  const pm = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(pm.state, "human_required");
  assert.equal(pm.intake.reason, "G1_REQUIRED");
  assert.deepEqual(
    f.packets.map((p) => p.role),
    ["pm", "pm"],
  );
  assert.equal(pm.intake.story.must[0], "Reject invalid input.");
  await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 2);
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
    ["pm", "pm", "lead", "lead"],
  );
  assert.deepEqual(
    f.prompts.map((p) => p.kit.node.id),
    ["clarify", "propose", "investigate", "plan"],
  );
  for (const prompt of f.prompts) {
    assert.match(prompt.kit.node.token, /^[a-f0-9]{64}$/);
    assert.equal(prompt.kit.node.input.assignment.taskId, f.item.taskId);
  }
  const native = lead.intake.events
    .filter((e) => e.payload.kit)
    .map((e) => e.payload.kit);
  assert.deepEqual(
    native.map((e) => e.nodeId),
    ["clarify", "propose", "investigate", "plan"],
  );
  assert.equal(native[1].action, "role-complete");
  assert.equal(native[3].action, "role-complete");
  assert.notEqual(native[0].runId, native[2].runId);
  assert.ok(
    f.execution
      .listPlanning(f.item.taskId)
      .every((l) => l.state === "released"),
  );
  assert.equal(f.store.list().length, 0);
});

test("native question resumes its token and attempt after an addressed human answer", async (t) => {
  const f = setup(t, "questions", true);
  const waiting = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  assert.ok(waiting.events.at(-1).payload.kit?.questionId);
  f.intake.answer(
    token,
    waiting.taskId,
    waiting.revision,
    waiting.inputDigest,
    [{ id: "Q1", answer: "src/parser.ts" }],
  );
  const answered = (
    await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context)
  ).intake;
  const native = answered.events
    .filter((e) => e.payload.kit)
    .map((e) => e.payload.kit);
  assert.equal(native[0].runId, native[1].runId);
  assert.notEqual(native[0].questionId, native[1].questionId);
  assert.equal(f.packets[1].dialogue[0].answers[0].answer, "src/parser.ts");
  assert.equal(f.packets.length, 2);
  const run = JSON.parse(
    readFileSync(join(f.project, native[1].runFile), "utf8"),
  );
  assert.equal(run.state.nodes.clarify.attempts, 1);
  assert.deepEqual(
    run.history
      .filter((e) => ["question", "answer"].includes(e.event))
      .map((e) => e.event),
    ["question", "answer", "question"],
  );
});

test("native cancellation after model closure releases the lease without recording role success", async (t) => {
  const f = setup(t, "ready", true);
  const original = f.planner.run;
  f.planner.run = async (...args) => {
    const result = await original(...args);
    f.intake.cancel(token, f.item.taskId, f.item.revision, f.item.inputDigest);
    return result;
  };
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "cancelled");
  assert.equal(
    result.intake.events.some((e) => e.payload.kit),
    false,
  );
  assert.equal(f.execution.listPlanning(f.item.taskId)[0].state, "released");
  await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 1);
});

test("native malformed output stops but releases a supervisor-confirmed closed process", async (t) => {
  const f = setup(t, "ready", true),
    original = f.planner.run;
  f.planner.run = async (...args) => {
    const report = await original(...args);
    report.result.stdout = "not a report";
    return report;
  };
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "human_required");
  assert.equal(result.intake.reason, "PLANNING_INVALID");
  assert.equal(f.execution.listPlanning(f.item.taskId)[0].state, "released");
  await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(f.packets.length, 1);
});

test("native source tampering after G1 cannot start Lead or silently replace the PM run", async (t) => {
  const f = setup(t, "ready", true);
  const pm = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, {
    decision: "approve",
    note: "Fixture scope",
  });
  const reference = pm.events.filter((e) => e.payload.kit).at(-1).payload.kit;
  const run = JSON.parse(
    readFileSync(join(f.project, reference.runFile), "utf8"),
  );
  writeFileSync(
    join(f.project, run.assignment.value.source),
    "tampered request",
  );
  const result = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(result.state, "human_required");
  assert.equal(result.intake.reason, "KIT_SOURCE_CHANGED");
  assert.equal(f.packets.length, 2);
});

test("native controller restart quarantines the active lease and never replays the same node", async (t) => {
  const f = setup(t, "ready", true),
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

test("Lead can ask a native question without losing the approved Story or restarting its attempt", async (t) => {
  const f = setup(t, "ready", true);
  const pm = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  f.intake.approveStory(token, pm.taskId, pm.revision, pm.inputDigest, {
    decision: "approve",
    note: "Fixture scope",
  });
  const original = f.planner.run;
  let asked = false;
  f.planner.run = async (...args) => {
    const report = await original(...args),
      packet = args[1].packet;
    if (packet.role === "lead" && !asked) {
      asked = true;
      const lines = report.result.stdout.split("\n").map(JSON.parse);
      lines[1].item.text = JSON.stringify({
        version: 1,
        inputDigest: packet.inputDigest,
        status: "questions",
        questions: [
          {
            id: "Q1",
            text: "Which parser test command?",
            reason: "Existing project choice",
          },
        ],
      });
      report.result.stdout = lines.map(JSON.stringify).join("\n");
    }
    return report;
  };
  const waiting = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  assert.equal(waiting.state, "awaiting_answer");
  const answered = f.intake.answer(
    token,
    waiting.taskId,
    waiting.revision,
    waiting.inputDigest,
    [{ id: "Q1", answer: "node --test" }],
  );
  assert.equal(answered.state, "waiting_lead");
  assert.deepEqual(answered.story, pm.story);
  const result = (await f.coordinator.run(f.item.taskId, f.context)).intake;
  assert.equal(result.state, "proposal");
  const reference = result.events.filter((e) => e.payload.kit).at(-1)
    .payload.kit;
  const run = JSON.parse(
    readFileSync(join(f.project, reference.runFile), "utf8"),
  );
  assert.equal(run.state.nodes.investigate.attempts, 1);
});

test("native capacity deferral resumes the saved dispatch without spending another node attempt", async (t) => {
  const f = setup(t, "ready", true),
    leases = [];
  for (let i = 0; i < 3; i++) {
    const item = f.intake.create(token, "Other work", "normal");
    leases.push(
      f.execution.reservePlanning(
        item.taskId,
        item.revision,
        item.inputDigest,
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
    result: {
      exitCode: 1,
      signal: null,
      error: null,
      timedOut: false,
      stdout: "",
      stderr: "Fixture failure",
    },
  });
  const pm = (
    await new PlanningCoordinator(f.deps).run(f.item.taskId, f.context)
  ).intake;
  assert.equal(pm.reason, "G1_REQUIRED");
  const reference = pm.events.filter((e) => e.payload.kit).at(-1).payload.kit;
  const run = JSON.parse(
    readFileSync(join(f.project, reference.runFile), "utf8"),
  );
  assert.equal(run.state.nodes.clarify.attempts, 1);
});

test("PM and Lead execute in order and persist a proposal without approving or registering work", async (t) => {
  const f = setup(t),
    r = await f.coordinator.run(f.item.taskId, f.context);
  assert.equal(r.state, "proposal");
  assert.deepEqual(
    f.packets.map((p) => p.role),
    ["pm", "lead"],
  );
  assert.ok(f.packets[1].story);
  assert.deepEqual(
    f.intake.get(f.item.taskId).events.map((e) => e.actor),
    ["human", "pm", "lead"],
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

test("capacity deferral reserves no extra execution", async (t) => {
  const f = setup(t);
  for (let i = 0; i < 3; i++) {
    const s = f.intake.create(token, "Other work.", "normal");
    f.execution.reservePlanning(
      s.taskId,
      s.revision,
      s.inputDigest,
      f.context.digest,
    );
  }
  assert.equal(
    (await f.coordinator.run(f.item.taskId, f.context)).state,
    "deferred",
  );
  assert.equal(f.execution.listPlanning(f.item.taskId).length, 0);
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
