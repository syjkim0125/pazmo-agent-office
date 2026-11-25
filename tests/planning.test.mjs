import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./contract-fixture.mjs";
import { applyLeanSchema } from "../src/lean/schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { workspaceScope } from "../src/core/workspace.ts";
import {
  beginPlanning,
  answerPlanning,
  acceptPlanning,
  planningPrompt,
} from "../src/runners/planning.ts";

const question = {
  id: "Q1",
  text: "Which input?",
  reason: "Needed to identify the public behavior.",
};
const story = {
  title: "Validate input",
  asIs: "Invalid input is accepted.",
  toBe: "Invalid input is rejected.",
  unchanged: "Existing records are preserved.",
  decisions: [
    { fork: "Where validation runs", options: ["Local only", "Local and remote"], pick: "Local only", because: "Local use only." },
  ],
  copies: "",
  must: ["Reject invalid input."],
  out: ["Deployment."],
  qa: [
    { refs: ["M1"], how: "script", scenario: "Invalid input returns an error." },
    { refs: ["Unchanged"], how: "script", scenario: "Valid input is stored." },
    { refs: ["not shown"], how: "agent", scenario: "No new screen appears." },
  ],
};
function response(packet, value) {
  const report = { version: 1, inputDigest: packet.inputDigest, ...value };
  return {
    closed: true,
    result: {
      exitCode: 0,
      signal: null,
      error: null,
      timedOut: false,
      stderr: "",
      stdout: [
        { type: "turn.started" },
        {
          type: "item.completed",
          item: { type: "agent_message", text: JSON.stringify(report) },
        },
        { type: "turn.completed" },
      ]
        .map(JSON.stringify)
        .join("\n"),
    },
  };
}
function start() {
  return beginPlanning(randomUUID(), "Add input validation.", "high");
}
function leadResponse(packet) {
  return response(packet, {
    plan: "Inspect the parser, add a failing behavior test, implement validation, then verify and review.",
    tasks: [
      {
        title: "Validate parser input",
        outcome: "Reject invalid input.",
        scope: "Parser implementation and tests.",
        constraints: "Preserve existing records.",
        must: [1],
        verify: [1, 2, 3],
        checks: [1, 2, 3].map((n) => ({ id: `Q${n}`, argv: ["node", "--test"], timeoutMs: 30000 })),
        workspace: { include: ["src"], exclude: [] },
      },
    ],
  });
}

test("PM question, addressed human answer, Lead proposal produces contracts that still require real approvals", async (t) => {
  const first = start();
  assert.equal(first.role, "pm");
  assert.match(planningPrompt(first), /Pazmo PM/);
  const q = acceptPlanning(
    first,
    response(first, { status: "questions", questions: [question] }),
  );
  const next = answerPlanning(first, q, [
    { id: "Q1", answer: "The public parser." },
  ]);
  assert.notEqual(first.inputDigest, next.inputDigest);
  assert.match(planningPrompt(next), /The public parser/);
  const pm = acceptPlanning(next, response(next, { status: "ready", story }));
  assert.equal(pm.kind, "lead");
  assert.equal(pm.packet.role, "lead");
  assert.match(planningPrompt(pm.packet), /Pazmo Lead/);
  const draft = acceptPlanning(pm.packet, leadResponse(pm.packet));
  assert.equal(draft.kind, "proposal");
  assert.match(draft.files["story.md"], /\n---\nStatus: Draft\nOwner: Human\n$/);
  assert.match(draft.files["story.md"], /^- Q1 \[M1\] \(script\)\. Invalid input returns an error\.$/m);
  assert.doesNotMatch(draft.files["story.md"], /Understanding gate|## Verify|## Domain/);
  assert.match(draft.files["task-1.md"], /## Covers — Story M\/Q IDs\n- M1 \/ Q1, Q2, Q3/);
  assert.ok(
    draft.files["task-1.md"].split("\n").filter((s) => s.trim()).length <= 30,
  );
  const f = fixture(t);
  for (const [name, content] of Object.entries(draft.files))
    writeFileSync(join(f.project, name), content);
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  applyLeanSchema(db, "/office-test-project");
  const token = "a".repeat(64),
    store = new OfficeStore(db, f.project, token);
  const task = await store.register(token, draft.contracts[0]);
  assert.equal(task.ready, false);
  assert.equal(task.blocker, "G1_REQUIRED");
  const g1 = store.requestApproval(token, task.id, "G1");
  assert.equal(
    store.decide(token, g1.id, {
      decision: "approve",
      note: "Fixture human G1",
    }).blocker,
    "G3_REQUIRED",
  );
  const g3 = store.requestApproval(token, task.id, "G3");
  store.decide(token, g3.id, {
    decision: "approve",
    note: "Fixture human plan approval",
  });
  assert.ok(
    store
      .roleContext(task.id)
      .documents.some(
        (d) => d.path === "plan.md" && d.content.includes("Inspect the parser"),
      ),
  );
  writeFileSync(join(f.project, "plan.md"), "Changed plan after approval.");
  assert.equal(store.get(task.id).blocker, "CONTRACT_CHANGED");
});

test("stale, failed, ambiguous or tool-nested reports cannot advance planning", () => {
  const p = start();
  for (const mutate of [
    (r) => {
      r.closed = false;
    },
    (r) => {
      r.result.exitCode = 1;
    },
    (r) => {
      r.result.timedOut = true;
    },
    (r) => {
      r.result.stdout = r.result.stdout.replace(p.inputDigest, "0".repeat(64));
    },
    (r) => {
      r.result.stdout = r.result.stdout.replace(
        "agent_message",
        "command_execution",
      );
    },
    (r) => {
      r.result.stdout += "\n" + JSON.stringify({ type: "turn.completed" });
    },
  ]) {
    const r = response(p, { status: "ready", story });
    mutate(r);
    assert.throws(() => acceptPlanning(p, r), { code: "PLANNING_INVALID" });
  }
});

test("answers must address the exact current question set and question rounds are bounded", () => {
  let p = start();
  for (let i = 0; i < 3; i++) {
    const q = acceptPlanning(
      p,
      response(p, { status: "questions", questions: [question] }),
    );
    for (const answers of [
      [],
      [{ id: "Q2", answer: "x" }],
      [
        { id: "Q1", answer: "x" },
        { id: "Q1", answer: "y" },
      ],
    ])
      assert.throws(() => answerPlanning(p, q, answers), {
        code: "PLANNING_INVALID",
      });
    const next = answerPlanning(p, q, [
      { id: "Q1", answer: "A clear answer." },
    ]);
    assert.throws(
      () => answerPlanning(next, q, [{ id: "Q1", answer: "stale" }]),
      { code: "PLANNING_INVALID" },
    );
    p = next;
  }
  assert.throws(
    () =>
      acceptPlanning(
        p,
        response(p, { status: "questions", questions: [question] }),
      ),
    { code: "PLANNING_INVALID" },
  );
});

test("approval injection, unmapped requirements, invalid checks and incomplete plans are rejected", () => {
  const p = start();
  for (const change of [
    (s) => {
      s.asIs += "\nStatus: Approved";
    },
    (s) => {
      s.approved = true;
    },
    (s) => {
      s.qa[0].refs = ["M2"];
    },
    (s) => {
      s.qa = s.qa.filter((q) => q.refs[0] !== "Unchanged");
    },
    (s) => {
      s.qa[2].how = "manual";
    },
    (s) => {
      s.must.push("Another required behavior.");
    },
  ]) {
    const s = structuredClone(story);
    change(s);
    assert.throws(
      () => acceptPlanning(p, response(p, { status: "ready", story: s })),
      { code: "PLANNING_INVALID" },
    );
  }
  const lead = acceptPlanning(
    p,
    response(p, { status: "ready", story }),
  ).packet;
  for (const change of [
    (v) => {
      v.tasks[0].must = [2];
    },
    (v) => {
      v.tasks[0].checks[0].id = "V1";
    },
    (v) => {
      v.tasks[0].workspace.include = ["../outside"];
    },
    (v) => {
      v.tasks[0].workspace = {
        include: ["README_ko.md"],
        exclude: ["src", "docs", "package.json", "package-lock.json"],
      };
    },
    (v) => {
      v.tasks = [];
    },
    (v) => {
      v.risk = "normal";
    },
  ]) {
    const r = leadResponse(lead),
      lines = r.result.stdout.split("\n"),
      event = JSON.parse(lines[1]),
      v = JSON.parse(event.item.text);
    change(v);
    event.item.text = JSON.stringify(v);
    lines[1] = JSON.stringify(event);
    r.result.stdout = lines.join("\n");
    assert.throws(() => acceptPlanning(lead, r), { code: "PLANNING_INVALID" });
  }
});

test("a normal-risk multi-task proposal preserves mappings without manufacturing G3 or writing files", () => {
  const p = beginPlanning(
    randomUUID(),
    "Validate two independent parser inputs.",
    "normal",
  );
  const s = structuredClone(story);
  s.must.push("Reject invalid secondary input.");
  s.qa.push({
    refs: ["M2"],
    how: "script",
    scenario: "Invalid secondary input returns an error.",
  });
  const lead = acceptPlanning(
    p,
    response(p, { status: "ready", story: s }),
  ).packet;
  const base = JSON.parse(
    JSON.parse(leadResponse(lead).result.stdout.split("\n")[1]).item.text,
  );
  const second = structuredClone(base.tasks[0]);
  second.must = [2];
  second.verify = [4];
  second.checks = [{ ...second.checks[0], id: "Q4" }];
  base.tasks.push(second);
  const result = acceptPlanning(
    lead,
    response(lead, { plan: base.plan, tasks: base.tasks }),
  );
  assert.equal(result.contracts.length, 2);
  assert.equal(result.files["decision.md"], undefined);
  assert.equal(result.contracts[1].decision, null);
  assert.equal(result.contracts[1].plan, "plan.md");
  assert.match(result.files["task-2.md"], /M2 \/ Q4/);
});

test("identical check commands for different MUST sets are published as a Decisions warning, not rejected", () => {
  const p = beginPlanning(randomUUID(), "Validate three inputs.", "normal");
  const s = structuredClone(story);
  s.must.push("Reject invalid secondary input.", "Keep existing records.");
  // Q1-Q3 check M1-M3 (task 1-3); Q4 and Q5 are the Unchanged and not-shown scenarios task 3 also covers.
  s.qa = [
    { refs: ["M1"], how: "script", scenario: "Invalid input returns an error." },
    { refs: ["M2"], how: "script", scenario: "Invalid secondary input returns an error." },
    { refs: ["M3"], how: "script", scenario: "Existing records are unchanged." },
    { refs: ["Unchanged"], how: "script", scenario: "Valid input is stored." },
    { refs: ["not shown"], how: "agent", scenario: "No new screen appears." },
  ];
  const lead = acceptPlanning(
    p,
    response(p, { status: "ready", story: s }),
  ).packet;
  const same = ["node", "--test", "test/mockup-ui.test.mjs"];
  const task = (must, checks) => ({
    title: `Task ${must}`,
    outcome: "Reject input.",
    scope: "Parser and tests.",
    constraints: "Keep records.",
    must: [must],
    verify: must === 3 ? [3, 4, 5] : [must],
    checks:
      must === 3
        ? [3, 4, 5].map((n) => ({ ...checks[0], id: `Q${n}`, argv: [...checks[0].argv, `--test-name-pattern=Q${n}`] }))
        : checks,
    workspace: { include: ["src"], exclude: [] },
  });
  // Observed 2026-10-02: V1-V8 (now Q ids) all ran one already-passing test file.
  const weak = acceptPlanning(
    lead,
    response(lead, {
      plan: "Inspected the parser.",
      tasks: [
        task(1, [{ id: "Q1", argv: same, timeoutMs: 1000 }]),
        task(2, [{ id: "Q2", argv: same, timeoutMs: 1000 }]),
        task(3, [{ id: "Q3", argv: ["node", "--test", "test/records.test.mjs"], timeoutMs: 1000 }]),
      ],
    }),
  );
  assert.equal(weak.kind, "proposal");
  const decisions = weak.files["plan.md"].split("## Decisions\n")[1];
  assert.match(decisions, /WARNING: Q1, Q2 run the same command/);
  assert.match(decisions, /M1; M2/);
  assert.doesNotMatch(decisions, /Q3/);
  assert.match(weak.files["task-1.md"], /WARNING: Q1 shares its command with Q2/);
  assert.match(weak.files["task-2.md"], /WARNING: Q2 shares its command with Q1/);
  assert.doesNotMatch(weak.files["task-3.md"], /WARNING/);
  assert.equal(weak.files["story.md"].includes("WARNING"), false);

  const distinct = acceptPlanning(
    lead,
    response(lead, {
      plan: "Inspected the parser.",
      tasks: [
        task(1, [{ id: "Q1", argv: [...same, "--test-name-pattern=primary"], timeoutMs: 1000 }]),
        task(2, [{ id: "Q2", argv: [...same, "--test-name-pattern=secondary"], timeoutMs: 1000 }]),
        task(3, [{ id: "Q3", argv: ["node", "--test", "test/records.test.mjs"], timeoutMs: 1000 }]),
      ],
    }),
  );
  assert.equal(distinct.files["plan.md"].includes("## Decisions"), false);
  assert.equal(distinct.files["task-1.md"].includes("WARNING"), false);
});

test("planning receives an explicit readonly snapshot without leaking controller paths or implying skill execution", async (t) => {
  const { mkdirSync } = await import("node:fs");
  const { freezeCandidate } = await import("../src/core/candidates.ts");
  const f = fixture(t);
  mkdirSync(join(f.root, "context"));
  const context = freezeCandidate(
    f.project,
    ["story.md"],
    join(f.root, "context"),
  );
  const packet = start(),
    prompt = planningPrompt(packet, context);
  const data = JSON.parse(
    prompt
      .split("BEGIN PLANNING TASK DATA\n")[1]
      .split("\nEND PLANNING TASK DATA")[0],
  );
  assert.deepEqual(data.context, {
    digest: context.digest,
    workspace: "/candidate/tree",
    access: "read",
    purpose: "proposal",
  });
  assert.equal(data.procedure.mode, "direct");
  assert.equal(data.procedure.skillStatus, "not-qualified");
  assert.equal(prompt.includes(context.directory), false);
  assert.equal(data.verificationEnvironment.gitMetadata, false);
  assert.deepEqual(data.verificationEnvironment.availableCommands, [
    "node",
    "/bin/sh",
  ]);
  assert.equal(data.verificationEnvironment.network, "none");
  assert.deepEqual(
    workspaceScope(data.verificationEnvironment.workspaceSelection.singleFileExample),
    { include: ["README_ko.md"], exclude: [] },
  );
  assert.match(
    data.verificationEnvironment.evidenceBoundary,
    /semantic.*Reviewer/,
  );
  assert.equal(prompt.includes(f.project), false);
  assert.match(prompt, /read.*assigned.*snapshot/i);
  assert.equal(
    JSON.parse(
      planningPrompt(packet)
        .split("BEGIN PLANNING TASK DATA\n")[1]
        .split("\nEND PLANNING TASK DATA")[0],
    ).context,
    null,
  );
  assert.throws(
    () => planningPrompt(packet, { ...context, digest: "b".repeat(64) }),
    { code: "CANDIDATE_CHANGED" },
  );
});
