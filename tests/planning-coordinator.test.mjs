import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
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
  const item = intake.create(token, "Validate input.", "normal"),
    packets = [];
  const jobFor = (packet) => {
    packets.push(packet);
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
  const deps = { intake, execution, planner, jobFor };
  return {
    ...f,
    db,
    store,
    intake,
    execution,
    context,
    item,
    packets,
    planner,
    deps,
    coordinator: new PlanningCoordinator(deps),
  };
}

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
