import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { parseReviewReport } from "../src/runners/review-report.ts";
import { runRegisteredReview } from "../src/runners/reviewer.ts";

const candidateDigest = "a".repeat(64),
  contractDigest = "b".repeat(64);
function report(overrides = {}) {
  return {
    version: 1,
    candidateDigest,
    contractDigest,
    verdict: "pass",
    findings: [],
    summary: "Reviewed exact candidate.",
    ...overrides,
  };
}
function stream(value = report(), extra = []) {
  return (
    [
      { type: "thread.started" },
      { type: "turn.started" },
      ...extra,
      {
        type: "item.completed",
        item: { type: "agent_message", text: JSON.stringify(value) },
      },
      { type: "turn.completed" },
    ]
      .map(JSON.stringify)
      .join("\n") + "\n"
  );
}
test("review parser accepts a terminal report bound to the exact candidate and contract", () => {
  assert.deepEqual(
    parseReviewReport(
      stream(report(), [
        {
          type: "item.completed",
          item: { type: "agent_message", text: "Reading the source." },
        },
        {
          type: "item.completed",
          item: {
            type: "command_execution",
            aggregated_output: JSON.stringify(report({ verdict: "fail" })),
          },
        },
      ]),
      candidateDigest,
      contractDigest,
    ),
    { verdict: "pass", findings: [], summary: "Reviewed exact candidate." },
  );
  assert.equal(
    parseReviewReport(
      stream(report({ verdict: "fail", findings: ["Missing validation."] })),
      candidateDigest,
      contractDigest,
    ).verdict,
    "fail",
  );
});
test("review parser refuses stale, malformed, ambiguous, nonterminal and oversized evidence", () => {
  const invalid = [
    stream(report({ candidateDigest: "c".repeat(64) })),
    stream(report({ contractDigest: "c".repeat(64) })),
    stream(report({ version: 2 })),
    stream(report({ summary: " " })),
    stream(report({ findings: [""] })),
    stream(report({ verdict: "approved" })),
    stream(report({ extra: true })),
    stream(report({ summary: "s".repeat(8193) })),
    stream(report({ findings: Array(101).fill("finding") })),
    stream(null),
    stream(report()).replace('{"type":"turn.completed"}\n', ""),
    stream(report()) + '{"type":"turn.started"}\n',
    stream(report(), [{ type: "turn.failed" }]),
    stream(report(), [
      {
        type: "item.completed",
        item: { type: "agent_message", text: JSON.stringify(report()) },
      },
    ]),
    stream(report()).replace(
      '{"type":"turn.completed"}',
      '{"type":"item.completed","item":{"type":"command_execution"}}\n{"type":"turn.completed"}',
    ),
    stream(report()).replace('{"type":"turn.started"}', "garbled"),
    "x".repeat(256 * 1024 + 1),
    [
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          aggregated_output: JSON.stringify(report()),
        },
      },
      { type: "turn.completed" },
    ]
      .map(JSON.stringify)
      .join("\n"),
  ];
  for (const value of invalid)
    assert.equal(
      parseReviewReport(value, candidateDigest, contractDigest),
      null,
      value.slice(0, 200),
    );
});

async function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "review.sqlite"));
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  const token = "a".repeat(64),
    store = new OfficeStore(db, f.project, token);
  const task = await store.register(token, f.input);
  for (const gate of ["G1", "G3"]) {
    const r = store.requestApproval(token, task.id, gate);
    store.decide(token, r.id, {
      decision: "approve",
      note: "Disposable fixture only.",
    });
  }
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const candidate = freezeCandidate(f.project, ["story.md"], storage);
  const verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification);
  const round = verification.begin(task.id, candidate);
  return { verification, execution, round, candidate, task };
}
function reviewer(overrides = {}) {
  return {
    async run(candidate, digest, job, beforeStart) {
      beforeStart("fixture-review-handle");
      return {
        handle: "fixture-review-handle",
        closed: true,
        cleanupErrors: [],
        observation: {
          kind: "review",
          exitCode: 0,
          signal: null,
          timedOut: false,
          error: null,
          output: "fixture",
          report: { verdict: "pass", findings: [], summary: "Fixture review." },
          ...overrides,
        },
      };
    },
  };
}
test("supervised review fills only its registered node and still waits for tests", async (t) => {
  const f = await setup(t),
    node = f.round.nodes.find((n) => n.kind === "review");
  const actual = await runRegisteredReview(
    f.execution,
    f.verification,
    reviewer(),
    f.round.id,
    node.id,
    {},
  );
  assert.equal(actual.recordingError, null);
  assert.equal(actual.lease.role, "reviewer");
  assert.equal(actual.lease.state, "released");
  assert.equal(actual.round.state, "checking");
  assert.equal(
    actual.round.nodes.find((n) => n.id === node.id).result.verdict,
    "pass",
  );
  await assert.rejects(
    runRegisteredReview(
      f.execution,
      f.verification,
      reviewer(),
      f.round.id,
      node.id,
      {},
    ),
  );
  await assert.rejects(
    runRegisteredReview(
      f.execution,
      f.verification,
      reviewer(),
      f.round.id,
      f.round.nodes.find((n) => n.kind === "test").id,
      {},
    ),
    { code: "INVALID_EXECUTION" },
  );
});
test("missing or failed review cannot pass and rejected supervisors retain unknown capacity", async (t) => {
  for (const mode of ["missing", "failure", "throw", "unclosed", "cancel"])
    await t.test(mode, async (t) => {
      const f = await setup(t),
        node = f.round.nodes.find((n) => n.kind === "review");
      const runner =
        mode === "throw"
          ? {
              run: async () => {
                throw Error("lost supervisor");
              },
            }
          : reviewer(
              mode === "missing"
                ? { report: null }
                : mode === "failure"
                  ? { exitCode: 7 }
                  : {},
            );
      if (mode === "unclosed" || mode === "cancel") {
        const run = runner.run;
        runner.run = async (...args) => {
          const r = await run(...args);
          if (mode === "unclosed") r.closed = false;
          else f.verification.cancel(f.round.id);
          return r;
        };
      }
      if (mode === "throw")
        await assert.rejects(
          runRegisteredReview(
            f.execution,
            f.verification,
            runner,
            f.round.id,
            node.id,
            {},
          ),
          /lost supervisor/,
        );
      else
        await runRegisteredReview(
          f.execution,
          f.verification,
          runner,
          f.round.id,
          node.id,
          {},
        );
      const lease = f.execution.list(f.task.id)[0],
        round = f.verification.get(f.round.id);
      assert.notEqual(round.state, "awaiting_g4");
      if (["throw", "unclosed"].includes(mode))
        assert.equal(lease.state, "unknown");
      if (mode === "cancel") {
        assert.equal(round.state, "cancelled");
        assert.equal(lease.state, "released");
        assert.equal(round.nodes.find((n) => n.id === node.id).result, null);
      }
    });
});
