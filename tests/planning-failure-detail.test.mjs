import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  beginPlanning,
  answerPlanning,
  acceptPlanning,
} from "../src/runners/planning.ts";

const story = {
  title: "Validate input",
  asIs: "Invalid input is accepted.",
  toBe: "Invalid input is rejected.",
  unchanged: "Valid records are kept.",
  decisions: [{ fork: "Where to validate", options: ["Parser", "Caller"], pick: "Parser", because: "One place." }],
  copies: "",
  must: ["Reject invalid input."],
  out: ["Deployment."],
  qa: [
    { refs: ["M1"], how: "script", scenario: "Invalid input returns an error." },
    { refs: ["Unchanged"], how: "script", scenario: "Valid input is stored." },
    { refs: ["not shown"], how: "agent", scenario: "No new screen appears." },
  ],
};
const task = {
  title: "Input validation",
  outcome: "Reject input.",
  scope: "Parser and tests.",
  constraints: "Keep records.",
  must: [1],
  verify: [1, 2, 3],
  checks: [1, 2, 3].map((n) => ({ id: `Q${n}`, argv: ["node", "--test"], timeoutMs: 1000 })),
  workspace: { include: ["src"], exclude: [] },
};
function observe(stdout, result = {}) {
  return {
    closed: true,
    result: {
      exitCode: 0,
      signal: null,
      error: null,
      timedOut: false,
      stderr: "",
      stdout,
      ...result,
    },
  };
}
function turn(report) {
  return [
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(report) },
    },
    { type: "turn.completed" },
  ]
    .map(JSON.stringify)
    .join("\n");
}
const pm = () => beginPlanning(randomUUID(), "Add input validation.", "normal");
const ready = (p, s) =>
  observe(turn({ version: 1, inputDigest: p.inputDigest, status: "ready", story: s }));
function leadPacket() {
  const p = pm();
  return acceptPlanning(p, ready(p, story)).packet;
}
function detail(fn) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, "PLANNING_INVALID");
    assert.match(
      error.message,
      /no work was approved/,
      "the public message stays fixed",
    );
    return error.detail;
  }
  assert.fail("expected PLANNING_INVALID");
}
const withStory = (change) => () => {
  const p = pm(),
    s = structuredClone(story);
  change(s);
  return acceptPlanning(p, ready(p, s));
};

test("process and transport failures name the observed condition", () => {
  const p = pm(),
    good = turn({ version: 1, inputDigest: p.inputDigest, status: "ready", story });
  for (const [result, expected] of [
    [{ ...observe(good), closed: false }, "process not closed"],
    [observe(good, { exitCode: 1 }), "exitCode=1"],
    [observe(good, { exitCode: null, signal: "SIGTERM" }), "exitCode=null; signal=SIGTERM"],
    [observe(good, { timedOut: true }), "timed out"],
    [observe(good, { error: "ENOENT" }), "error=ENOENT"],
    [observe(good, { error: "free text with project content" }), "error=reported"],
    [observe("not a report"), "terminal report missing (stdout 12 bytes)"],
    [
      observe(turn({ version: 1, inputDigest: "0".repeat(64), status: "ready", story })),
      "report.inputDigest: mismatch",
    ],
    [
      observe(turn({ version: 2, inputDigest: p.inputDigest, status: "ready", story })),
      "report.version: expected 1",
    ],
    [
      observe(turn({ version: 1, inputDigest: p.inputDigest, status: "done", story })),
      "report.status: expected ready",
    ],
  ])
    assert.equal(detail(() => acceptPlanning(p, result)), expected);
});

test("each Story rule reports its field path and rule", () => {
  for (const [change, expected] of [
    [(s) => (s.asIs = "First paragraph.\n\nSecond paragraph."), "story.asIs: line break"],
    [(s) => (s.toBe = "Tab\there"), "story.toBe: control character"],
    [(s) => (s.unchanged = "   "), "story.unchanged: empty"],
    [(s) => (s.asIs = 3), "story.asIs: not a string"],
    [(s) => (s.title = "t".repeat(121)), "story.title: too long (121>120)"],
    [(s) => (s.must = []), "story.must: 0 items (allowed 1-16)"],
    [(s) => (s.decisions = "none"), "story.decisions: not a list"],
    [(s) => (s.decisions[0].options = ["Parser"]), "story.decisions[0].options: 1 items (allowed 2-4)"],
    [(s) => (s.copies = 3), "story.copies: not a string"],
    [(s) => (s.out[0] = "Deploy now"), "story.out[0]: line break"],
    [(s) => (s.qa[0].refs = ["M2"]), "story.qa[0].refs[0]: out of range M1-M1"],
    [(s) => (s.qa[0].refs = ["V1"]), "story.qa[0].refs[0]: expected M<n>, Unchanged or not shown"],
    [(s) => (s.qa[0].refs = ["M1", "M1"]), "story.qa[0].refs: duplicate reference"],
    [(s) => (s.qa[1].refs = ["Unchanged", "M1"]), "story.qa[1].refs: Unchanged stands alone"],
    [(s) => (s.qa[0].how = "manual"), "story.qa[0].how: expected script, agent or person"],
    [(s) => s.must.push("Second behavior."), "story.must[1]: not covered by qa (M2)"],
    [(s) => s.qa.splice(1, 1, { ...s.qa[0] }), "story.qa: no Unchanged scenario"],
    [(s) => s.qa.splice(2, 1, { ...s.qa[0] }), "story.qa: no not shown scenario"],
    [(s) => s.qa.push(...Array(18).fill(s.qa[0])), "story.qa: 21 items (allowed 1-20)"],
    [(s) => (s.approved = true), "story: unexpected approved"],
    [(s) => delete s.asIs, "story: missing asIs"],
    [
      (s) => {
        s["목표 설명"] = s.asIs;
        delete s.asIs;
      },
      "story: missing asIs; unexpected 1 other",
    ],
    [(s) => (s.qa[0] = ["x"]), "story.qa[0]: not an object"],
  ])
    assert.equal(detail(withStory(change)), expected);
});

test("Lead task and check rules report their path", () => {
  const packet = leadPacket();
  const reply = (change) => () => {
    const v = { version: 1, inputDigest: packet.inputDigest, plan: "Plan.", tasks: [structuredClone(task)] };
    change(v);
    return acceptPlanning(packet, observe(turn(v)));
  };
  for (const [change, expected] of [
    [(v) => (v.tasks = []), "report.tasks: 0 items (allowed 1-8)"],
    [(v) => (v.risk = "normal"), "report: unexpected risk"],
    [(v) => (v.plan = "Line\nbreak"), "report.plan: line break"],
    [(v) => (v.tasks[0].must = [2]), "report.tasks[0].must[0]: out of range 1-1"],
    [(v) => (v.tasks[0].checks[0].id = "V2"), "report.tasks[0].checks[0].id: not a task QA id"],
    [(v) => (v.tasks[0].checks[0].argv = [""]), "report.tasks[0].checks[0].argv: empty command"],
    [(v) => (v.tasks[0].checks[0].argv = ["node", 3]), "report.tasks[0].checks[0].argv[1]: invalid argument"],
    [(v) => (v.tasks[0].checks[0].timeoutMs = 0), "report.tasks[0].checks[0].timeoutMs: expected integer 1-600000"],
    [(v) => (v.tasks[0].checks = []), "report.tasks[0].checks: 0 items (allowed 1-32)"],
    [(v) => (v.tasks[0].workspace.include = ["../outside"]), "report.tasks[0].workspace: UNSAFE_PATH"],
  ])
    assert.equal(detail(reply(change)), expected);
});

test("question rules report their path and round limit", () => {
  let p = pm();
  const ask = (questions) =>
    observe(turn({ version: 1, inputDigest: p.inputDigest, status: "questions", questions }));
  const q = { id: "Q1", text: "Which input?", reason: "Scope." };
  assert.equal(
    detail(() => acceptPlanning(p, ask([{ ...q, id: "Q9" }]))),
    "report.questions[0].id: expected Q1-Q3",
  );
  assert.equal(
    detail(() => acceptPlanning(p, ask([q, q]))),
    "report.questions: duplicate id",
  );
  assert.equal(
    detail(() => acceptPlanning(p, ask([{ ...q, text: "Two\nlines" }]))),
    "report.questions[0].text: line break",
  );
  const asked = acceptPlanning(p, ask([q]));
  assert.equal(
    detail(() => answerPlanning(p, asked, [{ id: "Q2", answer: "x" }])),
    "answers: do not match questions",
  );
  for (let i = 0; i < 3; i++)
    p = answerPlanning(p, acceptPlanning(p, ask([q])), [{ id: "Q1", answer: "A." }]);
  assert.equal(
    detail(() => acceptPlanning(p, ask([q]))),
    "report: question rounds exhausted",
  );
});

test("detail never carries model-authored text and stays short", () => {
  const secret = "PROJECT-SECRET-VALUE";
  const cases = [
    withStory((s) => (s.asIs = `${secret}\n${secret}`)),
    withStory((s) => (s[secret] = secret)),
    withStory((s) => (s.title = secret.repeat(20))),
    () => acceptPlanning(pm(), observe(secret.repeat(100))),
  ];
  for (const run of cases) {
    const d = detail(run);
    assert.ok(!d.includes(secret), d);
    assert.ok(d.length <= 200, d);
  }
});

test("the prompt states the same limits the validator enforces", async () => {
  const { planningPrompt } = await import("../src/runners/planning.ts");
  const p = pm(),
    prompt = planningPrompt(p),
    data = prompt.indexOf("BEGIN PLANNING TASK DATA");
  const stated = Number(prompt.match(/- story\.must 1-(\d+) items/)?.[1]);
  assert.ok(stated > 0 && prompt.indexOf("story.must 1-") < data);
  assert.match(prompt, /never drop a requirement/);
  assert.match(prompt, /single line: no line breaks/);
  const sized = (n) => ({
    ...story,
    must: Array.from({ length: n }, (_, i) => `Requirement ${i + 1}.`),
    qa: [
      { refs: Array.from({ length: n }, (_, i) => `M${i + 1}`), how: "script", scenario: "All." },
      ...story.qa.slice(1),
    ],
  });
  assert.equal(acceptPlanning(p, ready(p, sized(stated))).kind, "lead");
  assert.equal(
    detail(() => acceptPlanning(p, ready(p, sized(stated + 1)))),
    `story.must: ${stated + 1} items (allowed 1-${stated})`,
  );
  const leadPrompt = planningPrompt(leadPacket());
  const tasks = Number(leadPrompt.match(/tasks 1-(\d+) items/)?.[1]);
  assert.equal(tasks, 8);
  assert.doesNotMatch(leadPrompt, /story\.must 1-/);
  assert.match(leadPrompt, /timeoutMs an integer 1-600000/);
});
