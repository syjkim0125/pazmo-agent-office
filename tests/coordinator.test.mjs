import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { officeFixture } from "./coordinator-fixture.mjs";
import { OfficeCoordinator } from "../src/runners/coordinator.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { OfficeError } from "../src/cli/project.ts";

function runner(
  f,
  {
    failures = 0,
    unknown = false,
    wait,
    onReview,
    jobError,
    engineerError,
    reviewFailures = 0,
    reviewRunnerFailures = 0,
    reviewTimeouts = 0,
    onEngineer,
  } = {},
) {
  const packets = [],
    calls = [],
    base = {
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
      output: "fixture",
    };
  let engineers = 0,
    active = 0,
    maximum = 0;
  const enter = () => {
      active++;
      maximum = Math.max(active, maximum);
    },
    leave = () => active--;
  const c = new OfficeCoordinator({
    ...f,
    jobFor(packet) {
      packets.push(packet);
      if (jobError?.(packet)) throw Error("Unable to construct role job");
      return {
        binary: "fixture",
        timeoutMs: 30000,
        supervise: () => assert.fail("fake runner owns fixture only"),
      };
    },
    workspace: {
      async runRemote(candidate, scope, destination, job, start, signal) {
        engineers++;
        calls.push("engineer");
        start("engineer-" + engineers);
        enter();
        try {
          if (wait) await wait(signal);
          writeFileSync(
            join(destination, "src/a"),
            engineers <= failures ? "needs-fix" : "after",
          );
          onEngineer?.(destination, engineers);
          return {
            handle: "engineer-" + engineers,
            closed: true,
            cleanupErrors: [],
            observation: {
              ...base,
              error: signal.aborted ? "CANCELLED" : (engineerError ?? null),
            },
          };
        } finally {
          leave();
        }
      },
    },
    verifier: {
      async run(candidate, check, start, signal) {
        // One handle per check process, as the real verifier gives (a task may register several checks).
        const handle = "test-" + engineers + "-" + candidate.digest + "-" + calls.length;
        start(handle);
        calls.push("test");
        enter();
        try {
          await delay(10);
          return {
            handle,
            closed: true,
            cleanupErrors: [],
            observation: {
              ...base,
              kind: "test",
              exitCode:
                readFileSync(
                  join(candidate.directory, "tree/src/a"),
                  "utf8",
                ) === "after"
                  ? 0
                  : 1,
              error: signal.aborted ? "CANCELLED" : null,
            },
          };
        } finally {
          leave();
        }
      },
    },
    reviewer: {
      async run(candidate, contract, job, start, signal) {
        const handle = "review-" + engineers + "-" + candidate.digest;
        start(handle);
        calls.push("review");
        enter();
        try {
          onReview?.(f);
          await delay(5);
          return {
            handle,
            closed: !unknown,
            cleanupErrors: [],
            observation: {
              ...base,
              kind: "review",
              report: {
                verdict: engineers <= reviewFailures ? "fail" : "pass",
                summary: "Fixture review.",
                findings:
                  engineers <= reviewFailures
                    ? ["Fixture R1: explain the missing case."]
                    : [],
              },
              error: signal.aborted ? "CANCELLED" : null,
              // ContainerReviewer reads no report from a non-zero exit.
              ...(engineers <= reviewRunnerFailures
                ? { exitCode: 1, report: null }
                : {}),
              ...(engineers <= reviewTimeouts
                ? { timedOut: true, exitCode: null, report: null }
                : {}),
            },
          };
        } finally {
          leave();
        }
      },
    },
  });
  return {
    c,
    packets,
    calls,
    get maximum() {
      return maximum;
    },
    get engineers() {
      return engineers;
    },
  };
}

test("integration feedback invalidates prepared G4 and reaches the next Engineer before fresh review", async (t) => {
  const f = await officeFixture(t);
  const { CompletionLedger } = await import("../src/core/completion.ts");
  const completion = new CompletionLedger(
    f.db,
    f.store,
    f.verification,
    f.execution,
    "a".repeat(64),
    f.handoffs,
  );
  const r = runner(f, {
    onEngineer(directory, attempt) {
      if (attempt > 1)
        writeFileSync(join(directory, "src/clarification"), "fixed ambiguity");
    },
  });
  const first = await r.c.run(f.task.id);
  assert.equal(first.state, "awaiting_g4");
  await completion.prepare(f.task.id);
  f.verification.requestChanges({
    roundId: first.round.id,
    candidateDigest: first.round.candidate.digest,
    contractDigest: first.round.contractDigest,
    source: "controller integration review",
    findings: ["M1: clarify the contradictory sentence."],
  });
  assert.throws(() => completion.request("a".repeat(64), f.task.id), {
    code: "EVIDENCE_REQUIRED",
  });
  const resumed = await r.c.run(f.task.id);
  assert.equal(resumed.state, "awaiting_g4", JSON.stringify(resumed));
  assert.equal(resumed.round.number, 2);
  assert.notEqual(resumed.round.candidate.digest, first.round.candidate.digest);
  const second = r.packets.filter((p) => p.role === "engineer")[1];
  assert.deepEqual(second.integrationFeedback.findings, [
    "M1: clarify the contradictory sentence.",
  ]);
  await completion.prepare(f.task.id);
});
test("approved work automatically fixes and re-verifies a new candidate then stops at G4", async (t) => {
  const f = await officeFixture(t),
    r = runner(f, { failures: 1 });
  const done = await r.c.run(f.task.id);
  assert.equal(done.state, "awaiting_g4", JSON.stringify(done));
  assert.equal(r.engineers, 2);
  assert.equal(done.round.number, 2);
  assert.equal(r.maximum, 2);
  assert.equal(f.store.get(f.task.id).status, "review");
  assert.equal(readFileSync(join(f.project, "src/a"), "utf8"), "before");
  assert.equal(r.packets.length, 4);
  for (const packet of r.packets) {
    assert.equal(packet.profile.role, packet.role);
    assert.equal(packet.profile.ref, `pazmo-${packet.role}@1.0.0`);
  }
  const fix = r.packets.find((p) => p.role === "engineer" && p.attempt === 2);
  assert.equal(fix.feedback.find((x) => x.kind === "test").verdict, "fail");
  assert.ok(
    fix.documents.some((d) => d.content.includes("Reject invalid input")),
  );
  const reviews = r.packets.filter((p) => p.role === "reviewer");
  assert.notEqual(reviews[0].candidateDigest, reviews[1].candidateDigest);
  assert.equal(reviews[1].diff.roundTripVerified, true);
  assert.equal(reviews[1].diff.candidateDigest, done.round.candidate.digest);
  assert.ok(!JSON.stringify(fix).includes(f.root));
  assert.ok(
    f.execution
      .list(f.task.id)
      .filter((l) => l.role !== "verifier")
      .every((l) => l.timeout_ms === 30000),
  );
  await r.c.run(f.task.id);
  assert.equal(r.engineers, 2);
});

test("a Reviewer's requested changes reach the next Engineer and its candidate is reviewed again", async (t) => {
  const f = await officeFixture(t);
  const r = runner(f, { reviewFailures: 1 });
  const result = await r.c.run(f.task.id);
  assert.equal(result.state, "awaiting_g4");
  assert.equal(r.engineers, 2);
  assert.equal(result.round.number, 2);
  assert.match(
    JSON.stringify(r.packets.filter((p) => p.role === "engineer")[1].feedback),
    /Fixture R1/,
  );
  const reviews = r.packets.filter((p) => p.role === "reviewer");
  assert.equal(reviews.length, 2);
  assert.equal(reviews[1].diff.candidateDigest, result.round.candidate.digest);
});

test("a Reviewer with no verdict stops for a person instead of rebuilding the candidate", async (t) => {
  for (const [option, reason] of [
    ["reviewRunnerFailures", "REVIEW_RUNNER_FAILED"],
    ["reviewTimeouts", "UNKNOWN_RESULT"],
  ]) {
    const f = await officeFixture(t);
    const r = runner(f, { [option]: 1 });
    const result = await r.c.run(f.task.id);
    assert.equal(result.state, "human_required", reason);
    assert.equal(result.reason, reason);
    assert.equal(result.round.number, 1, reason);
    assert.equal(r.engineers, 1, reason);
    assert.equal((await r.c.run(f.task.id)).state, "human_required", reason);
    assert.equal(r.engineers, 1, reason);
  }
});

test("Reviewer changes requested every round cannot reserve a fourth Engineer", async (t) => {
  const f = await officeFixture(t);
  const r = runner(f, { reviewFailures: 9 });
  const result = await r.c.run(f.task.id);
  assert.equal(result.state, "human_required");
  assert.equal(r.engineers, 3);
  assert.equal((await r.c.run(f.task.id)).state, "human_required");
  assert.equal(r.engineers, 3);
});

test("a failed closed Engineer remains human_required on coordinator reconstruction", async (t) => {
  const f = await officeFixture(t),
    r = runner(f, { engineerError: "ENGINEER_FAILED" });
  assert.equal((await r.c.run(f.task.id)).state, "human_required");
  const next = runner(f),
    resumed = await next.c.run(f.task.id);
  assert.equal(resumed.state, "human_required");
  assert.equal(next.engineers, 0);
  assert.equal(next.packets.length, 0);
});

test("external capacity defers without spending an Engineer attempt, then explicit wake resumes", async (t) => {
  const f = await officeFixture(t),
    token = "a".repeat(64),
    held = [];
  for (let i = 0; i < 3; i++) {
    const task = await f.store.register(token, f.input);
    for (const gate of ["G1", "G3"]) {
      const c = f.store.requestApproval(token, task.id, gate);
      f.store.decide(token, c.id, {
        decision: "approve",
        note: "Capacity fixture.",
      });
    }
    if (i < 2) held.push(f.execution.reserveEngineer(task.id));
    else {
      const storage = join(f.root, "other-candidate");
      mkdirSync(storage);
      const candidate = freezeCandidate(f.project, ["src/a"], storage),
        round = f.verification.begin(task.id, candidate);
      held.push(f.execution.reserveNode(round.id, round.nodes[0].id));
    }
  }
  const r = runner(f),
    deferred = await r.c.run(f.task.id);
  assert.equal(deferred.state, "deferred");
  assert.equal(deferred.reason, "SLOT_LIMIT");
  assert.equal(r.engineers, 0);
  assert.deepEqual(f.execution.list(f.task.id), []);
  for (const l of held) {
    const handle = "capacity-" + l.id;
    f.execution.start(l.id, handle);
    f.execution.finish(l.id, handle, {
      closed: true,
      ...(l.role === "verifier"
        ? {
            observation: {
              kind: "test",
              exitCode: 0,
              signal: null,
              timedOut: false,
              error: null,
              output: "fixture",
            },
          }
        : {}),
    });
  }
  const done = await r.c.run(f.task.id);
  assert.equal(done.state, "awaiting_g4");
  assert.equal(r.engineers, 1);
});

test("a review deferred for capacity runs once on the same candidate", async (t) => {
  const f = await officeFixture(t);
  const reserve = f.execution.reserveNode.bind(f.execution);
  f.execution.reserveNode = (roundId, nodeId, ...args) => {
    if (
      f.verification.get(roundId).nodes.find((n) => n.id === nodeId)?.kind ===
      "review"
    )
      throw new OfficeError("SLOT_LIMIT", "Fixture external capacity");
    return reserve(roundId, nodeId, ...args);
  };
  const r = runner(f);
  assert.equal((await r.c.run(f.task.id)).state, "deferred");
  f.execution.reserveNode = reserve;
  assert.equal((await r.c.run(f.task.id)).state, "awaiting_g4");
  assert.equal(r.calls.filter((c) => c === "review").length, 1);
});

test("failure constructing a fix persists human_required instead of retrying the failed round", async (t) => {
  const f = await officeFixture(t),
    r = runner(f, {
      failures: 1,
      jobError: (p) => p.role === "engineer" && p.attempt === 2,
    });
  const done = await r.c.run(f.task.id);
  assert.equal(done.state, "human_required");
  assert.equal(done.round.state, "human_required");
  assert.equal(done.round.reason, "DISPATCH_FAILED");
  assert.equal(r.engineers, 1);
  const later = await runner(f).c.run(f.task.id);
  assert.equal(later.state, "human_required");
});

/** Rows the removed workflow runtime left for this task's current revision, as an upgraded data folder has them. */
function markLegacy(f, taskId) {
  f.db.exec(`CREATE TABLE IF NOT EXISTS pazmo_kit_assignments (
    task_id TEXT NOT NULL, revision INTEGER NOT NULL, assignment_id TEXT NOT NULL,
    role TEXT NOT NULL, run_file TEXT NOT NULL, target_revision TEXT NOT NULL,
    PRIMARY KEY(task_id,revision,assignment_id))`);
  f.db
    .prepare("INSERT INTO pazmo_kit_assignments VALUES (?,?,?,?,?,?)")
    .run(taskId, f.store.get(taskId).revision, `kit5:${taskId}:1:developer:`, "developer", ".pazmo-office/kit-runs/x/run.json", "0".repeat(64));
}

test("a task begun under the removed workflow runtime stops with its plain reason and others keep running (가)", async (t) => {
  const { LEGACY_TASK_MESSAGE, reasonText } = await import("../src/core/legacy-tasks.ts");
  const warnings = t.mock.method(console, "warn", () => {});
  const f = await officeFixture(t);
  const first = await runner(f).c.run(f.task.id);
  assert.equal(first.state, "awaiting_g4");
  // A second task of the same project: mid-delivery when the Office was upgraded.
  const token = "a".repeat(64),
    other = await f.store.register(token, f.input);
  for (const gate of ["G1", "G3"]) {
    const c = f.store.requestApproval(token, other.id, gate);
    f.store.decide(token, c.id, { decision: "approve", note: "Legacy fixture." });
  }
  const failing = runner(f, { failures: 9 });
  markLegacy(f, other.id);
  const stopped = await failing.c.run(other.id);
  assert.deepEqual([stopped.state, stopped.reason], ["human_required", "LEGACY_TASK"]);
  assert.equal(failing.engineers, 0);
  assert.deepEqual(f.execution.list(other.id), []);
  // Nothing was reserved, so the next run reports the same reason, not an unknown process.
  const again = await failing.c.run(other.id);
  assert.deepEqual([again.state, again.reason], ["human_required", "LEGACY_TASK"]);
  assert.equal(warnings.mock.callCount(), 1);
  assert.match(warnings.mock.calls[0].arguments[0], new RegExp(other.id));
  assert.equal(reasonText("LEGACY_TASK"), LEGACY_TASK_MESSAGE);
  assert.match(LEGACY_TASK_MESSAGE, /취소하고 다시 만드세요/);
  // The legacy rows are read, never written or removed.
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM pazmo_kit_assignments").get().n, 1);
});

test("a legacy task with an open round has that round stopped for a person", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = await officeFixture(t);
  const r = runner(f, { failures: 9 });
  const storage = join(f.root, "legacy-candidate");
  mkdirSync(storage);
  const round = f.verification.begin(f.task.id, freezeCandidate(f.project, ["src/a"], storage));
  markLegacy(f, f.task.id);
  const stopped = await r.c.run(f.task.id);
  assert.deepEqual([stopped.state, stopped.reason], ["human_required", "LEGACY_TASK"]);
  assert.deepEqual([stopped.round.id, stopped.round.state, stopped.round.reason], [round.id, "human_required", "LEGACY_TASK"]);
  assert.equal(r.engineers, 0);
});

test("already aborted work is cancelled without constructing a role job", async (t) => {
  const f = await officeFixture(t),
    r = runner(f),
    a = new AbortController();
  a.abort();
  const done = await r.c.run(f.task.id, a.signal);
  assert.equal(done.state, "cancelled");
  assert.equal(r.packets.length, 0);
  assert.deepEqual(f.execution.list(f.task.id), []);
});
test("two failed fixes exhaust persisted budget without a fourth Engineer", async (t) => {
  const f = await officeFixture(t),
    r = runner(f, { failures: 99 });
  const done = await r.c.run(f.task.id);
  assert.equal(done.state, "human_required", JSON.stringify(done));
  assert.equal(done.round.number, 3);
  assert.equal(r.engineers, 3);
  assert.equal(done.round.reason, "FIX_BUDGET_EXHAUSTED");
  await runner(f).c.run(f.task.id);
  assert.equal(
    f.execution.list(f.task.id).filter((l) => l.role === "engineer").length,
    3,
  );
});
test("approval and changed documents prevent any role factory or execution", async (t) => {
  for (const kind of ["unapproved", "changed"])
    await t.test(kind, async (t) => {
      const f = await officeFixture(t, kind !== "unapproved"),
        r = runner(f);
      if (kind === "changed") f.put("story.md", f.story + "changed");
      const done = await r.c.run(f.task.id);
      assert.equal(done.state, "approval_required");
      assert.equal(r.packets.length, 0);
      assert.equal(f.execution.list(f.task.id).length, 0);
    });
});
test("cancellation persists before stopping Engineer; overlapping invocation cannot duplicate it", async (t) => {
  const f = await officeFixture(t),
    abort = new AbortController();
  let entered;
  const ready = new Promise((r) => (entered = r)),
    r = runner(f, {
      wait: (signal) =>
        new Promise((resolve) => {
          entered();
          signal.addEventListener("abort", resolve, { once: true });
        }),
    });
  const running = r.c.run(f.task.id, abort.signal);
  await ready;
  const duplicate = await r.c.run(f.task.id);
  assert.equal(duplicate.state, "deferred");
  abort.abort();
  const done = await running;
  assert.equal(done.state, "cancelled");
  assert.equal(f.store.get(f.task.id).status, "cancelled");
  assert.equal(r.engineers, 1);
  const later = await r.c.run(f.task.id);
  assert.equal(later.state, "cancelled");
  assert.equal(r.engineers, 1);
});
test("unknown reviewer closure stops all owned verification and cannot trigger fixes", async (t) => {
  const f = await officeFixture(t),
    r = runner(f, { unknown: true });
  const done = await r.c.run(f.task.id);
  assert.equal(done.state, "human_required");
  assert.equal(r.engineers, 1);
  assert.ok(f.execution.list(f.task.id).some((l) => l.state === "unknown"));
  assert.ok(!done.round.g4Subject);
});
test("contract mutation during review aborts without admitting old evidence", async (t) => {
  const f = await officeFixture(t),
    r = runner(f, { onReview: () => f.put("story.md", f.story + "changed") });
  const done = await r.c.run(f.task.id);
  assert.notEqual(done.state, "awaiting_g4");
  assert.equal(r.engineers, 1);
  assert.equal(done.round.state, "human_required");
});
