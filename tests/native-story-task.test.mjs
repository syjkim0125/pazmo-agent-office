import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture as contractFixture } from "./contract-fixture.mjs";
import { openLeanDb } from "../src/lean/schema.ts";
import { createLeanOffice } from "../src/lean/office.ts";
import { LiveRuntime } from "../src/runtime/live.ts";
import { OfficeError } from "../src/cli/project.ts";
import { classifyObservation } from "../src/core/verification.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
import { continuePlanning, teamPlanningPacket } from "../src/runners/planning.ts";
import { writeStoryContract } from "../src/team/story-contract.ts";
import { normalizeClaudeStream } from "../src/runners/claude-profile.ts";
import { PLAN_ID, turn } from "./plan-fixture.mjs";

const TOKEN = "a".repeat(64);
const HUB_TASK = "hub-task-7";
const CLAIM = "c1c1c1c1-0000-claim";
const G1_NOTE = "Hub Story #3 opened by its PL; Story Task #7 claim c1c1c1c1";
const readyCatalog = () => ({
  installs: {
    codex: { runner: "codex", status: "ready", version: "0.160.0", sha256: "a".repeat(64), path: "/c", loggedIn: true, hint: "준비됨" },
    claude: { runner: "claude", status: "ready", version: "2.1.280", sha256: "b".repeat(64), path: "/k", loggedIn: true, hint: "준비됨" },
  },
  models: { codex: [{ slug: "gpt-5.5", reasoningLevels: [{ effort: "high" }] }], claude: [{ slug: "default" }] },
});
const work = { runner: "codex", model: "gpt-5.5", effort: "high" };
const review = { runner: "claude", model: "default", effort: null };
/** A Hub Story Task as the team Office claims it (the Task 6 fixture shape). */
const claimed = (extra = {}) => ({
  taskId: HUB_TASK,
  claimId: CLAIM,
  kind: "work",
  number: 7,
  title: "Input validation",
  spec: "Reject invalid input in src/a.",
  files: ["src/a"],
  verify: [{ id: "V9", argv: ["node", "--test"], timeoutMs: 30000 }],
  storyVerify: [],
  repoId: "r1",
  branch: "feature/story-3/task-7",
  story: { id: "s-1", number: 3, title: "Validate input", body: "Reject invalid input.", risk: "normal", branches: [] },
  upstream: [],
  lastFailure: null,
  ...extra,
});
const ok = (output = "", kind = "test") => ({ exitCode: 0, signal: null, timedOut: false, error: null, output, kind });

/** A lean Office (the Story engine is one) on its own database with a fake
 * live runtime that records every start, as the lean-office tests do. */
async function fixture(t, { live: withLive = true } = {}) {
  const c = contractFixture(t);
  mkdirSync(join(c.project, "src"));
  c.put("src/a", "before");
  const db = openLeanDb(c.root, c.project);
  // onVerified: what the team Office's callback does after it is recorded (it
  // may throw or never return); settled: how often the host's onSettled ran.
  const state = { active: [], lastError: null, verifying: false, othersActive: false, verified: [], onVerified: null, settled: 0 };
  const calls = { planning: [], implementation: [], understanding: [], cancelled: [], aborted: [], verify: [], planTurn: [] };
  const captured = {};
  const live = {
    status: () => ({ execution: "ready", active: state.active, verifying: state.verifying, lastError: state.lastError }),
    startPlanning: (...args) => calls.planning.push(args),
    startImplementation: (...args) => calls.implementation.push(args),
    startUnderstanding: (...args) => calls.understanding.push(args),
    cancelImplementation: (...args) => calls.cancelled.push(args),
    abort: (id) => calls.aborted.push(id),
    verify: async (...args) => {
      calls.verify.push(args);
      return args[1].map((check) => ({ id: check.id, verdict: "pass", output: "fake" }));
    },
    planTurn: async (...args) => {
      calls.planTurn.push(args);
      return turn(args[0], PLAN_QUESTIONS);
    },
    assertIdle() {},
    close: async () => {},
  };
  const config = {
    db,
    project: c.project,
    dataDir: c.root,
    token: TOKEN,
    runnerCatalog: async () => readyCatalog(),
    othersActive: () => state.othersActive,
    onSettled: () => {
      state.settled++;
    },
    onVerified: (taskId, round) => {
      state.verified.push([taskId, round]);
      return state.onVerified?.();
    },
    ...(withLive
      ? {
          createRuntime: async (...args) => {
            captured.ledgers = args[3];
            return live;
          },
        }
      : {}),
  };
  const opened = [await createLeanOffice(config)];
  c.defer(async () => {
    for (const office of opened) await office.close();
    db.close();
  });
  const alice = await opened[0].agents.create({ name: "Alice", work, review });
  return {
    ...c,
    db,
    state,
    calls,
    alice,
    live,
    get office() {
      return opened.at(-1);
    },
    get ledgers() {
      return captured.ledgers;
    },
    /** The same database again; `overrides` changes the config (e.g. no runtime). */
    async reopen(overrides = {}) {
      await opened.at(-1).close();
      opened.push(await createLeanOffice({ ...config, ...overrides }));
      return opened.at(-1);
    },
  };
}
const meta = (f, extra = {}) => ({ hubTaskId: HUB_TASK, claimId: CLAIM, agentId: f.alice.id, g1Note: G1_NOTE, ...extra });
async function submit(f, attempt = 1, extra = {}) {
  const input = writeStoryContract(f.project, claimed(), attempt, null);
  const id = await f.office.submitStoryTask(input, meta(f, extra));
  return { id, input };
}
/** One Engineer run of the task: it writes src/a and exits with `exitCode` (or ends on the supervisor's `error`). */
let runs = 0;
function engineer(f, id, { output = "Engineer done", exitCode = 0, content = "after", error = null } = {}) {
  const { handoffs } = f.ledgers;
  // Short leases: three rounds stay inside the task's reserved-time budget.
  const attempt = handoffs.prepare(id, 60000);
  const handle = `fixture-engineer-${++runs}`;
  handoffs.start(attempt.leaseId, handle);
  writeFileSync(join(attempt.workspace, "src/a"), content);
  return handoffs.finish(attempt.leaseId, handle, {
    closed: true,
    observation: { exitCode, signal: null, timedOut: false, error, output },
  });
}
/** Every node of the round: the checks exit with `check`, the review reports `verdict` (or ends as `review`). */
function judge(f, round, { verdict = "pass", check = 0, review = null } = {}) {
  const { execution } = f.ledgers;
  for (const node of round.nodes) {
    const lease = execution.reserveNode(round.id, node.id, [], 60000);
    execution.start(lease.id, node.id);
    execution.finish(lease.id, node.id, {
      closed: true,
      observation: {
        ...ok(`${node.kind} output`, node.kind),
        ...(node.kind === "test" ? { exitCode: check } : {}),
        ...(node.kind === "review" ? { report: { verdict, findings: verdict === "fail" ? ["Wrong"] : [], summary: "Fixture" } } : {}),
        ...(node.kind === "review" ? review : {}),
      },
    });
  }
  return f.ledgers.verification.get(round.id);
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Rejects when `promise` is still pending after `ms`: a held engine. */
const settles = (promise, what, ms = 3000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not settle`)), ms).unref()),
  ]);
const status = (f, id) => f.db.prepare("SELECT status FROM tasks WHERE id=?").get(id).status;
const count = (f, sql, ...args) => f.db.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...args).n;

test("a Story Task starts at the Engineer with a recorded G1 and no decision cards", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  const item = f.ledgers.store.get(id);
  assert.deepEqual(f.calls.implementation, [[id, item.contract.digest]], "the Engineer is dispatched at once");
  assert.deepEqual(f.calls.planning, [], "no PM or Lead runs");
  assert.equal(item.approved.G1, true);
  assert.equal(item.status, "planned");
  assert.equal(item.contract.input.risk, "normal");
  const approval = f.db.prepare("SELECT answer_json FROM pazmo_approvals WHERE gate='G1'").get();
  assert.deepEqual(JSON.parse(approval.answer_json), { decision: "approve", note: G1_NOTE });
  assert.equal(count(f, "pazmo_native_decisions"), 0, "no G1 or G3 card");
  assert.deepEqual(await f.office.decisions(), []);
  assert.equal(count(f, "pazmo_intakes WHERE task_id=?", id), 0, "no intake");
  assert.deepEqual(f.db.prepare("SELECT * FROM pazmo_story_tasks").all().map((r) => ({ ...r })), [
    { task_id: id, hub_task_id: HUB_TASK, claim_id: CLAIM },
  ]);
  assert.equal(f.db.prepare("SELECT agent_id FROM tasks WHERE id=?").get(id).agent_id, f.alice.id);
  assert.deepEqual(
    f.office.chooseRunner("engineer", id),
    { runner: "codex", model: "gpt-5.5", reasoning: "high" },
    "the agent's work runner builds it",
  );
  assert.deepEqual(f.office.storyOutcome(id), { kind: "running", stage: "build" });
  f.state.active = [{ taskId: id, kind: "implementation" }];
  assert.deepEqual(f.office.storyOutcome(id), { kind: "running", stage: "build" });
  await f.office.refresh();
  assert.equal(f.calls.implementation.length, 1, "dispatched once");
});

test("storyTaskFor names the newest engine task submitted for a claim", async (t) => {
  const f = await fixture(t);
  assert.equal(f.office.storyTaskFor(HUB_TASK, CLAIM), null);
  const first = await submit(f, 1);
  assert.equal(f.office.storyTaskFor(HUB_TASK, CLAIM), first.id);
  // A later attempt of the same claim is a new engine task under the same ids.
  f.state.active = [{ taskId: first.id, kind: "implementation" }];
  const second = await submit(f, 2);
  assert.notEqual(second.id, first.id);
  assert.equal(f.office.storyTaskFor(HUB_TASK, CLAIM), second.id);
  assert.equal(f.office.storyTaskFor(HUB_TASK, "another-claim"), null);
  assert.equal(f.office.storyTaskFor("another-task", CLAIM), null);
  // Survives a restart: the executor adopts it instead of submitting again.
  await f.reopen();
  assert.equal(f.office.storyTaskFor(HUB_TASK, CLAIM), second.id);
});

test("a Story Task is all or nothing: a refused submission leaves no task behind", async (t) => {
  const f = await fixture(t);
  const before = count(f, "tasks");
  const input = writeStoryContract(f.project, claimed(), 1, null);
  await assert.rejects(f.office.submitStoryTask(input, meta(f, { agentId: "nobody" })), { code: "NOT_FOUND" });
  // The G1 note is checked after registration, inside the same transaction.
  await assert.rejects(f.office.submitStoryTask(input, meta(f, { g1Note: " " })), { code: "INVALID_APPROVAL" });
  await assert.rejects(f.office.submitStoryTask({ ...input, risk: "high", decision: input.plan }, meta(f)), {
    code: "INVALID_CONTRACT",
  });
  assert.equal(count(f, "tasks"), before, "no half-made task");
  assert.equal(count(f, "pazmo_task_contracts"), 0);
  assert.equal(count(f, "pazmo_story_tasks"), 0);
  assert.deepEqual(f.calls.implementation, []);
  // The same contract submits once the meta is right.
  const id = await f.office.submitStoryTask(input, meta(f));
  assert.equal(f.ledgers.store.get(id).status, "planned");

  const locked = await fixture(t, { live: false });
  const other = writeStoryContract(locked.project, claimed(), 1, null);
  await assert.rejects(locked.office.submitStoryTask(other, meta(locked)), { code: "EXECUTION_LOCKED" });
  assert.equal(count(locked, "pazmo_task_contracts"), 0);
});

test("a verified Story Task calls onVerified once, never opens G4 and ends done", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  const frozen = engineer(f, id);
  assert.deepEqual(f.office.storyOutcome(id), { kind: "running", stage: "review" });
  const round = judge(f, frozen.round);
  assert.equal(round.state, "awaiting_g4");
  f.state.active = [{ taskId: id, kind: "implementation" }];
  await f.office.refresh();
  assert.deepEqual(f.state.verified, [], "not while its run is still settling");
  assert.deepEqual(f.office.storyOutcome(id), { kind: "running", stage: "verify" });
  f.state.active = [];
  await f.office.refresh();
  assert.equal(f.state.verified.length, 1);
  const [taskId, told] = f.state.verified[0];
  assert.equal(taskId, id);
  assert.equal(told.id, round.id);
  assert.deepEqual(told.candidate, round.candidate);
  assert.equal(status(f, id), "done");
  assert.deepEqual(f.office.storyOutcome(id), { kind: "verified", roundId: round.id });

  // No G4, no assessment, no delivery; the evidence was still prepared.
  assert.equal(count(f, "pazmo_native_decisions"), 0);
  assert.equal(count(f, "pazmo_g4_requests"), 0);
  assert.equal(count(f, "pazmo_g4_evidence WHERE task_id=?", id), 1);
  assert.deepEqual(f.calls.understanding, []);
  assert.equal(f.ledgers.completion.delivery(id).status, "not_delivered");

  // Reading it again (as the board, the detail and the executor do) keeps it done.
  await f.office.refresh();
  f.office.board();
  f.office.detail(id);
  f.office.storyEvidence(id);
  assert.equal(f.ledgers.verification.latest(id).state, "awaiting_g4");
  assert.equal(status(f, id), "done");
  assert.equal(f.state.verified.length, 1, "once per round");
  await f.reopen();
  await f.office.refresh();
  assert.equal(f.state.verified.length, 1, "a restart does not tell it again");
  assert.equal(status(f, id), "done");
  assert.deepEqual(f.office.storyOutcome(id), { kind: "verified", roundId: round.id });
});

test("a stopped Story Task reports stopped with its reason", async (t) => {
  const f = await fixture(t);
  // The review could not decide: verification gives the task to a person.
  const unknown = await submit(f, 1);
  judge(f, engineer(f, unknown.id).round, { verdict: "unknown" });
  await f.office.refresh();
  const stopped = f.office.storyOutcome(unknown.id);
  assert.equal(stopped.kind, "stopped");
  assert.match(stopped.reason, /UNKNOWN_RESULT/);
  // The checks failed in every round the engine may fix.
  const exhausted = await submit(f, 2);
  let round = engineer(f, exhausted.id).round;
  for (let n = 1; n <= 3; n++) {
    round = judge(f, round, { check: 1 });
    if (n < 3) round = engineer(f, exhausted.id, { output: `fix ${n}` }).round;
  }
  assert.equal(round.state, "human_required");
  const budget = f.office.storyOutcome(exhausted.id);
  assert.equal(budget.kind, "stopped");
  assert.match(budget.reason, /FIX_BUDGET_EXHAUSTED/);
  assert.match(budget.reason, /V1/, "names the check that failed");
  // The Engineer's own run failed.
  const failed = await submit(f, 3);
  engineer(f, failed.id, { exitCode: 1 });
  assert.equal(status(f, failed.id), "pending");
  assert.deepEqual(f.office.storyOutcome(failed.id).kind, "stopped");
  assert.match(f.office.storyOutcome(failed.id).reason, /ENGINEER_FAILED/);
  assert.deepEqual(f.state.verified, []);
});

/** What a claude run refused by its account leaves as output (claude 2.1.280's stream, normalized). */
const LIMIT = "You've hit your org's monthly spend limit · your weekly limit resets 4am (Asia/Seoul)";
const refusedRun = (error, text = LIMIT) =>
  normalizeClaudeStream(
    [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text }] }, error },
      { type: "result", subtype: "success", is_error: true, result: text },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );

test("a Story Task stopped by its runner's account names the problem, from the Engineer's run or the review's", async (t) => {
  const f = await fixture(t);
  const built = await submit(f, 1);
  engineer(f, built.id, { exitCode: 1, output: refusedRun("rate_limit") });
  assert.deepEqual(f.office.storyOutcome(built.id), {
    kind: "stopped",
    reason: "구현이 멈췄습니다: ENGINEER_FAILED",
    runnerAccount: { runner: "claude", kind: "limit", message: LIMIT, resetsAt: null },
  });
  // The Engineer's run went through; the review's runner was logged out.
  const reviewed = await submit(f, 2);
  judge(f, engineer(f, reviewed.id).round, {
    review: { exitCode: 1, output: refusedRun("authentication_failed", "OAuth token has expired"), report: undefined },
  });
  const review = f.office.storyOutcome(reviewed.id);
  assert.equal(review.kind, "stopped");
  assert.match(review.reason, /REVIEW_RUNNER_FAILED/);
  assert.deepEqual(review.runnerAccount, { runner: "claude", kind: "login", message: "OAuth token has expired", resetsAt: null });
  // A failure of the work's own names none.
  const plain = await submit(f, 3);
  engineer(f, plain.id, { exitCode: 1, output: refusedRun("server_error", "API Error: 500") });
  assert.deepEqual(f.office.storyOutcome(plain.id), { kind: "stopped", reason: "구현이 멈췄습니다: ENGINEER_FAILED" });
});

/** What a role run the engine refused before starting its runner leaves (runner-jobs.ts): no exit, no output. */
const notReady = (runner, hint) => ({ exitCode: null, error: `RUNNER_NOT_READY ${runner}: ${hint}`, output: "" });
const LOGIN = "터미널에서 claude auth login을 실행하세요.";

test("a Story Task refused before its runner started names the runner not ready, from the Engineer's run or the review's (D39)", async (t) => {
  const f = await fixture(t);
  const built = await submit(f, 1);
  engineer(f, built.id, notReady("claude", LOGIN));
  assert.deepEqual(f.office.storyOutcome(built.id), {
    kind: "stopped",
    reason: "구현이 멈췄습니다: ENGINEER_FAILED",
    runnerAccount: { runner: "claude", kind: "not_ready", message: LOGIN, resetsAt: null },
  });
  // The Engineer's run went through; the review's runner was refused: an unknown review, not a failed one.
  const reviewed = await submit(f, 2);
  const round = judge(f, engineer(f, reviewed.id).round, { review: { ...notReady("codex", "move ~/.codex/AGENTS.md"), report: null } });
  assert.equal(round.reason, "UNKNOWN_RESULT");
  const review = f.office.storyOutcome(reviewed.id);
  assert.equal(review.kind, "stopped");
  assert.match(review.reason, /UNKNOWN_RESULT/);
  assert.deepEqual(review.runnerAccount, { runner: "codex", kind: "not_ready", message: "move ~/.codex/AGENTS.md", resetsAt: null });
  // Any other refusal before the runner started still counts.
  const changed = await submit(f, 3);
  engineer(f, changed.id, { exitCode: null, error: "UNVERIFIED_CONTROLLER_BINARY", output: "" });
  assert.deepEqual(f.office.storyOutcome(changed.id), { kind: "stopped", reason: "구현이 멈췄습니다: ENGINEER_FAILED" });
});

test("a Story Task whose run failed or was cancelled is stopped, not running", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  f.state.active = [{ taskId: id, kind: "implementation" }];
  assert.deepEqual(f.office.storyOutcome(id), { kind: "running", stage: "build" });
  // The run ended with an error the engine will not retry by itself.
  f.state.active = [];
  f.state.lastError = { taskId: id, code: "LIVE_EXECUTION_FAILED" };
  await f.office.refresh();
  const failed = f.office.storyOutcome(id);
  assert.equal(failed.kind, "stopped");
  assert.match(failed.reason, /LIVE_EXECUTION_FAILED/);

  const other = await submit(f, 2);
  f.state.active = [{ taskId: other.id, kind: "implementation" }];
  await f.office.cancelStoryTask(other.id);
  const digest = f.ledgers.store.get(other.id).contract.digest;
  assert.deepEqual(f.calls.cancelled, [[other.id, digest]], "the run is cancelled as cancel() does");
  f.state.active = [];
  f.ledgers.store.cancelExecution(other.id);
  assert.deepEqual(f.office.storyOutcome(other.id).kind, "stopped");
  await assert.rejects(f.office.cancelStoryTask("unknown"), { code: "NOT_FOUND" });
});

test("an Office restarted without a runtime still cancels a Story Task", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  engineer(f, id);
  await f.reopen({ createRuntime: undefined });
  await f.office.cancelStoryTask(id);
  assert.equal(status(f, id), "cancelled");
  assert.equal(f.ledgers.verification.latest(id).state, "cancelled");
  assert.equal(f.office.storyOutcome(id).kind, "stopped");
});

test("cancelling a finished Story Task does nothing", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  judge(f, engineer(f, id).round);
  await f.office.refresh();
  assert.equal(status(f, id), "done");
  await f.office.cancelStoryTask(id);
  assert.deepEqual(f.calls.cancelled, []);
  assert.equal(status(f, id), "done");
  assert.equal(f.office.storyOutcome(id).kind, "verified");
});

test("an onVerified that never returns holds neither this engine nor the other repos", async (t) => {
  const f = await fixture(t);
  f.state.onVerified = () => new Promise(() => {});
  const first = await submit(f, 1);
  judge(f, engineer(f, first.id).round);
  // Its run settles: the engine concludes it, tells the team Office and lets the other repos continue.
  await settles(f.live.onSettled(), "the settle continuation");
  assert.equal(status(f, first.id), "done");
  assert.equal(f.state.verified.length, 1);
  assert.equal(f.state.settled, 1, "the host's onSettled ran");
  const second = await settles(submit(f, 2), "the next submission");
  assert.deepEqual(
    f.calls.implementation.map(([id]) => id),
    [first.id, second.id],
    "the next pump dispatches",
  );
  judge(f, engineer(f, second.id).round);
  await settles(f.office.refresh(), "the next pump");
  assert.equal(status(f, second.id), "done");
  assert.equal(f.state.verified.length, 2);
});

test("a throwing onVerified leaves the Story Task done and is logged", async (t) => {
  const f = await fixture(t);
  const logged = t.mock.method(console, "error", () => {});
  f.state.onVerified = () => {
    throw new Error("team store closed");
  };
  const { id } = await submit(f);
  const round = judge(f, engineer(f, id).round);
  await f.office.refresh();
  await tick();
  assert.equal(status(f, id), "done");
  assert.deepEqual(f.office.storyOutcome(id), { kind: "verified", roundId: round.id });
  assert.ok(logged.mock.calls.some((call) => call.arguments.join(" ").includes("team store closed")));
  await f.office.refresh();
  assert.equal(f.state.verified.length, 1, "not told again");
});

test("a conclusion the engine refuses stops the Story Task with one notice; an unexpected error is tried again", async (t) => {
  const f = await fixture(t);
  const logged = t.mock.method(console, "error", () => {});
  const { completion } = f.ledgers;
  // Not an Office error (a passing disk error): logged, and the next pump concludes it.
  const flaky = await submit(f, 1);
  judge(f, engineer(f, flaky.id).round);
  completion.prepare = async () => {
    throw new Error("EIO: disk hiccup");
  };
  await f.office.refresh();
  assert.equal(status(f, flaky.id), "review");
  assert.deepEqual(f.office.storyOutcome(flaky.id), { kind: "running", stage: "verify" });
  assert.ok(logged.mock.calls.some((call) => call.arguments.join(" ").includes("disk hiccup")));
  delete completion.prepare;
  await f.office.refresh();
  assert.equal(status(f, flaky.id), "done");
  // An Office error is final: one stop notice, never concluded and never told.
  const refused = await submit(f, 2);
  judge(f, engineer(f, refused.id).round);
  completion.prepare = async () => {
    throw new OfficeError("EVIDENCE_REQUIRED", "Fixture refusal.");
  };
  await f.office.refresh();
  await f.office.refresh();
  const notices = f.db
    .prepare("SELECT content FROM messages WHERE task_id=? AND content LIKE '실행을 멈췄습니다: %'")
    .all(refused.id)
    .map((row) => row.content);
  assert.deepEqual(notices, ["실행을 멈췄습니다: EVIDENCE_REQUIRED"]);
  const round = f.ledgers.verification.latest(refused.id);
  assert.equal(count(f, "pazmo_native_events WHERE identity=?", `error:verified:${round.id}`), 1);
  assert.deepEqual(f.office.storyOutcome(refused.id), { kind: "stopped", reason: "실행을 멈췄습니다: EVIDENCE_REQUIRED" });
  delete completion.prepare;
  await f.office.refresh();
  assert.equal(status(f, refused.id), "review", "never concluded once it stopped");
  assert.deepEqual(f.state.verified.map(([id]) => id), [flaky.id]);
});

test("storyEvidence returns the round's baseline, candidate and engineer outputs", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  const first = engineer(f, id, { output: "first run\nASSUMED: keep the parser" });
  assert.throws(() => f.office.storyEvidence(id), { code: "EVIDENCE_REQUIRED" });
  // A failed check sends it back to the Engineer for a second round.
  assert.equal(judge(f, first.round, { check: 1 }).state, "fix_required");
  const second = engineer(f, id, { output: "second run\nASSUMED: reject empty input", content: "after" });
  const round = judge(f, second.round);
  await f.office.refresh();
  assert.equal(status(f, id), "done");
  const evidence = f.office.storyEvidence(id);
  assert.deepEqual(evidence.baseline, first.origin, "the project as the first round started");
  assert.deepEqual(evidence.candidate, round.candidate);
  assert.deepEqual(evidence.engineerOutputs, ["first run\nASSUMED: keep the parser", "second run\nASSUMED: reject empty input"]);
  assert.equal(evidence.evidence.diff.candidateDigest, round.candidate.digest);
  assert.equal(evidence.evidence.diff.baselineDigest, first.origin.digest);
  assert.match(evidence.evidence.diff.rawDiff, /after/);
  assert.equal(readFileSync(join(evidence.candidate.directory, "tree/src/a"), "utf8"), "after");
  assert.equal(status(f, id), "done", "reading the evidence keeps it done");
  assert.throws(() => f.office.storyEvidence("unknown"), { code: "NOT_FOUND" });
});

test("freezeProject freezes the whole checkout as it is now, without its metadata", async (t) => {
  const f = await fixture(t);
  writeStoryContract(f.project, claimed(), 1, null);
  f.put(".env", "secret");
  mkdirSync(join(f.project, "docs"));
  f.put("docs/notes.md", "merged from the base");
  const candidate = await f.office.freezeProject();
  assert.ok(verifyCandidate(candidate));
  const paths = JSON.parse(readFileSync(join(candidate.directory, "manifest.json"), "utf8")).entries.map((e) => e.path);
  assert.ok(paths.includes("src/a") && paths.includes("docs/notes.md") && paths.includes("story.md"));
  assert.ok(!paths.some((p) => p.startsWith(".pazmo-office") || p === ".env"), paths.join(","));
  f.put("docs/notes.md", "changed later");
  assert.equal(readFileSync(join(candidate.directory, "tree/docs/notes.md"), "utf8"), "merged from the base");
  assert.ok(!candidate.directory.startsWith(f.project), "frozen outside the checkout");
  assert.ok(existsSync(candidate.directory));
});

test("verify runs each check and classifies pass, fail and unknown; it refuses BUSY while a run is active", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  const candidate = await f.office.freezeProject();
  const ran = [];
  let release;
  let verifying = null;
  let startDuring = null;
  const observations = {
    pass: ok("all good"),
    fail: { ...ok("1 failing"), exitCode: 1 },
    slow: { ...ok("still running"), exitCode: null, timedOut: true, error: "TIMEOUT" },
  };
  const runtime = new LiveRuntime(f.ledgers, {
    planning: async () => assert.fail("no planning"),
    implementation: () => new Promise((resolve) => (release = resolve)),
    understanding: async () => assert.fail("no assessment"),
    verify: async (frozen, check, signal) => {
      ran.push([frozen.digest, check, signal instanceof AbortSignal]);
      verifying ??= runtime.status().verifying;
      startDuring ??= (() => {
        try {
          runtime.startImplementation(id, f.ledgers.store.get(id).contract.digest);
          return "started";
        } catch (error) {
          return error.code;
        }
      })();
      return observations[check.argv[0]];
    },
    dispose() {},
  });
  let settled = 0;
  runtime.onSettled = async () => {
    settled++;
  };
  const checks = [
    { id: "V1", argv: ["pass"], timeoutMs: 1000 },
    { id: "V2", argv: ["fail"], timeoutMs: 2000 },
    { id: "V3", argv: ["slow"], timeoutMs: 3000 },
  ];
  const results = await runtime.verify(candidate, checks);
  assert.deepEqual(results, [
    { id: "V1", verdict: "pass", output: "all good" },
    { id: "V2", verdict: "fail", output: "1 failing" },
    { id: "V3", verdict: "unknown", output: "still running" },
  ]);
  assert.deepEqual(
    ran.map(([digest, check, signal]) => [digest, check, signal]),
    checks.map(({ argv, timeoutMs }) => [candidate.digest, { argv, timeoutMs }, true]),
    "one after another on the same frozen candidate",
  );
  assert.equal(verifying, true, "a verify is a run of its own while it lasts");
  assert.equal(startDuring, "BUSY", "no run starts beside a verify");
  assert.equal(runtime.status().verifying, false);
  await tick();
  assert.equal(settled, 1, "settles like a run, so waiting work continues");
  // The same pass/fail/unknown rule as a round's nodes.
  assert.deepEqual(Object.values(observations).map(classifyObservation), ["pass", "fail", "unknown"]);

  runtime.startImplementation(id, f.ledgers.store.get(id).contract.digest);
  await assert.rejects(runtime.verify(candidate, checks), { code: "BUSY" });
  assert.equal(ran.length, 3, "nothing ran beside the active run");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runtime.status().active, []);
  assert.equal((await runtime.verify(candidate, checks.slice(0, 1)))[0].verdict, "pass");
  await assert.rejects(runtime.verify(candidate, []), { code: "INVALID_REQUEST" });
  await runtime.close();
  await assert.rejects(runtime.verify(candidate, checks), { code: "EXECUTION_LOCKED" });
});

test("a verify never waits for a pump, stops at once when cancelled and refuses unusable check ids", async (t) => {
  const f = await fixture(t);
  const candidate = await f.office.freezeProject();
  const ran = [];
  // The signal the runner cancels when it runs a check named abort.
  let controller = new AbortController();
  const runtime = new LiveRuntime(f.ledgers, {
    planning: async () => assert.fail("no planning"),
    implementation: async () => assert.fail("no implementation"),
    understanding: async () => assert.fail("no assessment"),
    verify: async (_candidate, check) => {
      ran.push(check.argv[0]);
      if (check.argv[0] === "abort") controller.abort();
      return ok("done");
    },
    dispose() {},
  });
  let settled = 0;
  // The engine's continuation after a run: here a pump that never ends.
  runtime.onSettled = () => {
    settled++;
    return new Promise(() => {});
  };
  const check = (id, argv = ["pass"]) => ({ id, argv, timeoutMs: 1000 });
  assert.deepEqual(await settles(runtime.verify(candidate, [check("V1")]), "a verify"), [
    { id: "V1", verdict: "pass", output: "done" },
  ]);
  assert.equal(settled, 1, "the engine is still told the verify settled");
  // Unusable ids are refused before anything runs.
  for (const checks of [[check("")], [check(" ")], [check("V1"), check("V1")], [{ argv: ["pass"], timeoutMs: 1000 }]])
    await assert.rejects(runtime.verify(candidate, checks), { code: "INVALID_REQUEST" });
  // Cancelled before it starts, or while a check runs: it rejects at once and starts no other check.
  await assert.rejects(runtime.verify(candidate, [check("V1")], AbortSignal.abort()), { code: "CANCELLED" });
  assert.deepEqual(ran, ["pass"]);
  await assert.rejects(
    settles(runtime.verify(candidate, [check("V1", ["abort"]), check("V2"), check("V3")], controller.signal), "a cancelled verify"),
    { code: "CANCELLED" },
  );
  assert.deepEqual(ran, ["pass", "abort"]);
  // Cancelled during its last check: rejected, never reported as a result.
  controller = new AbortController();
  await assert.rejects(runtime.verify(candidate, [check("V1", ["abort"])], controller.signal), { code: "CANCELLED" });
  assert.deepEqual(ran, ["pass", "abort", "abort"]);
  assert.equal(runtime.status().verifying, false);
  await runtime.close();
});

test("verifyCandidate reaches the live verify, and another engine's run or a verify in flight makes it busy", async (t) => {
  const f = await fixture(t);
  const candidate = await f.office.freezeProject();
  const checks = [{ id: "V1", argv: ["node", "--test"], timeoutMs: 30000 }];
  assert.deepEqual(await f.office.verifyCandidate(candidate, checks), [{ id: "V1", verdict: "pass", output: "fake" }]);
  assert.deepEqual(f.calls.verify, [[candidate, checks, undefined]]);
  f.state.othersActive = true;
  await assert.rejects(f.office.verifyCandidate(candidate, checks), { code: "BUSY" });
  f.state.othersActive = false;
  // A verify counts as this engine's run: no task starts and the others wait.
  f.state.verifying = true;
  assert.equal(f.office.busy(), true);
  await submit(f);
  assert.deepEqual(f.calls.implementation, [], "not dispatched beside a verify");
  f.state.verifying = false;
  assert.equal(f.office.busy(), false);
  await f.office.refresh();
  assert.equal(f.calls.implementation.length, 1);

  const locked = await fixture(t, { live: false });
  await assert.rejects(locked.office.verifyCandidate(candidate, checks), { code: "EXECUTION_LOCKED" });
});

const PLAN_QUESTIONS = { status: "questions", questions: [{ id: "Q1", text: "어느 화면부터?", reason: "범위가 바뀝니다." }] };
/** A team plan's PM packet over one repo folder. */
const planPacket = () =>
  teamPlanningPacket({
    planId: PLAN_ID,
    intent: "주문 내역 화면",
    risk: "normal",
    role: "pm",
    repos: [{ folder: "app-be", baseBranch: "main" }],
    dialogue: [],
    story: null,
    rewrite: null,
    retry: null,
  });

test("planTurn reaches the live planning turn; another engine's run makes it BUSY; a locked engine is EXECUTION_LOCKED; after beginStop the lean engine says STOPPING", async (t) => {
  const f = await fixture(t);
  const candidate = await f.office.freezeProject();
  const packet = planPacket();
  assert.deepEqual(await f.office.planTurn(packet, candidate), turn(packet, PLAN_QUESTIONS));
  const signal = new AbortController().signal;
  await f.office.planTurn(packet, candidate, signal);
  assert.deepEqual(f.calls.planTurn, [
    [packet, candidate, undefined],
    [packet, candidate, signal],
  ]);
  f.state.othersActive = true;
  await assert.rejects(f.office.planTurn(packet, candidate), { code: "BUSY" });
  f.state.othersActive = false;
  assert.equal(f.calls.planTurn.length, 2, "nothing reached the runtime beside another engine's run");

  const locked = await fixture(t, { live: false });
  await assert.rejects(locked.office.planTurn(packet, candidate), { code: "EXECUTION_LOCKED" });

  f.office.beginStop();
  await assert.rejects(f.office.planTurn(packet, candidate), { code: "STOPPING" });
  assert.equal(f.calls.planTurn.length, 2);
});

test("LiveRuntime.planTurn is a run of its own: BUSY while a run or verify is active, status().verifying true while it runs, onSettled after it, CANCELLED when its signal aborts", async (t) => {
  const f = await fixture(t);
  const { id } = await submit(f);
  const candidate = await f.office.freezeProject();
  const packet = planPacket();
  const observation = turn(packet, PLAN_QUESTIONS);
  const seen = [];
  const during = {};
  let releaseRun, releaseVerify;
  // `hold`: the next turn waits for it; `abortWith`: the next turn aborts that controller and waits for its signal.
  let hold = null;
  let abortWith = null;
  const runtime = new LiveRuntime(f.ledgers, {
    planning: async () => assert.fail("no planning"),
    implementation: () => new Promise((resolve) => (releaseRun = resolve)),
    understanding: async () => assert.fail("no assessment"),
    verify: () => new Promise((resolve) => (releaseVerify = () => resolve(ok("done")))),
    planTurn: async (p, c, signal) => {
      seen.push([p, c, signal instanceof AbortSignal]);
      during.verifying ??= runtime.status().verifying;
      during.start ??= (() => {
        try {
          runtime.startImplementation(id, f.ledgers.store.get(id).contract.digest);
          return "started";
        } catch (error) {
          return error.code;
        }
      })();
      during.verify ??= await runtime.verify(candidate, [{ id: "V1", argv: ["x"], timeoutMs: 1000 }]).then(
        () => "ran",
        (error) => error.code,
      );
      if (abortWith) {
        abortWith.abort();
        await new Promise((resolve) => (signal.aborted ? resolve() : signal.addEventListener("abort", resolve)));
      }
      if (hold) await hold;
      return observation;
    },
    dispose() {},
  });
  let settled = 0;
  runtime.onSettled = async () => {
    settled++;
  };

  assert.deepEqual(await runtime.planTurn(packet, candidate), observation);
  assert.deepEqual(seen, [[packet, candidate, true]]);
  assert.equal(during.verifying, true, "a planning turn is a run of its own while it lasts");
  assert.equal(during.start, "BUSY", "no run starts beside it");
  assert.equal(during.verify, "BUSY", "nor a verify");
  assert.equal(runtime.status().verifying, false);
  await tick();
  assert.equal(settled, 1, "settles like a run, so waiting work continues");

  // Another planning turn in flight.
  let release;
  hold = new Promise((resolve) => (release = resolve));
  const first = runtime.planTurn(packet, candidate);
  await tick();
  await assert.rejects(runtime.planTurn(packet, candidate), { code: "BUSY" });
  release();
  await first;
  hold = null;

  // A run is active, then a verify.
  runtime.startImplementation(id, f.ledgers.store.get(id).contract.digest);
  await assert.rejects(runtime.planTurn(packet, candidate), { code: "BUSY" });
  releaseRun();
  await tick();
  const verifying = runtime.verify(candidate, [{ id: "V1", argv: ["x"], timeoutMs: 1000 }]);
  await assert.rejects(runtime.planTurn(packet, candidate), { code: "BUSY" });
  releaseVerify();
  await verifying;
  assert.equal(seen.length, 2, "nothing ran beside the run or the verify");

  // Cancelled before it starts, or while the turn runs.
  await assert.rejects(runtime.planTurn(packet, candidate, AbortSignal.abort()), { code: "CANCELLED" });
  assert.equal(seen.length, 2);
  const controller = new AbortController();
  abortWith = controller;
  await assert.rejects(settles(runtime.planTurn(packet, candidate, controller.signal), "a cancelled turn"), { code: "CANCELLED" });
  assert.equal(seen.length, 3);
  assert.equal(runtime.status().verifying, false);
  abortWith = null;

  await runtime.close();
  await assert.rejects(runtime.planTurn(packet, candidate), { code: "EXECUTION_LOCKED" });
});

const STORY = {
  title: "README",
  goal: "Clarify execution",
  domain: "Documentation",
  must: ["Show actual command"],
  should: [],
  out: ["Runtime changes"],
  assumptions: [],
  verify: [{ must: [1], scenario: "Command matches CLI" }],
};
async function answer(f, kind, note) {
  const decision = (await f.office.decisions()).find((d) => d.decision_kind === kind);
  assert.ok(decision, `an open ${kind} decision`);
  await f.office.reply(decision.id, 1, note);
}

test("a normal lean task still goes to G4 (unchanged)", async (t) => {
  const f = await fixture(t);
  const { id } = await f.office.createTask({ title: "Improve README", body: "", agentId: f.alice.id, risk: "normal" });
  const { intake, store } = f.ledgers;
  const i = intake.get(id);
  intake.acceptKit(
    id,
    i.revision,
    i.inputDigest,
    { kind: "lead", packet: continuePlanning(intake.packet(id, i.revision, i.inputDigest), STORY, "lead") },
    { runId: "test", runFile: "test", nodeId: "requirements", action: "role-complete", revisionToken: "test" },
  );
  await f.office.refresh();
  await answer(f, "story", "README 실행 안내만 수정하는 범위를 승인합니다.");
  // The Lead's publication: one registered contract task under the request, no Story row.
  f.put(
    "verify.json",
    JSON.stringify({
      version: 1,
      workspace: { include: ["src"], exclude: [] },
      checks: [{ id: "V1", argv: ["node", "--test"], timeoutMs: 15000 }],
    }),
  );
  const child = (await store.register(TOKEN, { ...f.input, risk: "normal", decision: null })).id;
  f.db.prepare("UPDATE tasks SET source_task_id=? WHERE id=?").run(id, child);
  f.db.prepare("INSERT INTO pazmo_intake_publications VALUES (?,?)").run(id, JSON.stringify({ taskIds: [child] }));
  f.db.prepare("UPDATE tasks SET status='planned' WHERE id=?").run(id);
  await f.office.refresh();
  assert.deepEqual((await f.office.decisions()).map((d) => [d.decision_kind, d.task_id]), [["G1", child]], "its G1 card opens");
  await answer(f, "G1", "실행 범위를 확인했습니다.");
  assert.deepEqual(f.calls.implementation.map(([taskId]) => taskId), [child]);
  judge(f, engineer(f, child).round);
  await f.office.refresh();
  assert.deepEqual((await f.office.decisions()).map((d) => [d.decision_kind, d.task_id]), [["G4", child]], "G4 opens");
  assert.equal(status(f, child), "review");
  assert.deepEqual(f.state.verified, [], "onVerified is for Story Tasks only");
  assert.throws(() => f.office.storyOutcome(child), { code: "NOT_FOUND" });
  assert.equal(f.office.storyTaskFor(HUB_TASK, CLAIM), null);
});
