import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { storyShapeErrors, taskShapeErrors } from "../src/core/contract-shape.ts";

test("the fixture Story and Task pass the shape checks", (t) => {
  const f = fixture(t);
  assert.deepEqual(storyShapeErrors(f.project, f.story), []);
  assert.deepEqual(taskShapeErrors(f.task), []);
});

test("Story rules: section order, MUST/QA mapping and duplicates, QA line shape, title, Status and Owner", (t) => {
  const f = fixture(t);
  const errors = (text) => storyShapeErrors(f.project, text);
  assert.deepEqual(errors(f.story.replace("## Decisions", "## OUT\n- O2. x\n\n## Decisions")), [
    "Story sections are out of order; keep the canonical template order.",
  ]);
  assert.deepEqual(errors(f.story.replace("- Q1 [M1]", "- Q1 [M2]")), [
    "QA scenario references unknown MUST M2: - Q1 [M2] (script). Check invalid input.",
    "MUST M1 is not mapped to a Q# scenario.",
  ]);
  assert.deepEqual(errors(f.story.replace("- M1.", "- M1. a\n- M1.")), ["Duplicate MUST ID: M1."]);
  assert.deepEqual(errors(f.story.replace("- Q2 [Unchanged]", "- Q1 [Unchanged]")), ["Duplicate QA ID: Q1."]);
  assert.deepEqual(errors(f.story.replace("(script). Check", "(manual). Check")), [
    "QA scenario needs “- Q<n> [<targets>] (script|agent|person). <scenario>”: - Q1 [M1] (manual). Check invalid input.",
    "MUST M1 is not mapped to a Q# scenario.",
  ]);
  assert.deepEqual(errors(f.story.replace("[Unchanged]", "[Later]")), [
    "QA scenario has an unknown target Later: - Q2 [Later] (script). Valid input is stored.",
  ]);
  // A method may carry a note, as people write approved Stories (review 1).
  assert.deepEqual(errors(f.story.replace("(script). Check", "(person: G1은 사람이 누름. 나머지는 agent). Check").replace("(script). Valid", "(script: 명령 `npm test`). Valid")), []);
  assert.deepEqual(errors(f.story.replace("## MUST", "## Human decides\n- PL 답: a → b\n\n## MUST")), []);
  assert.deepEqual(errors(f.story.replace("## QA", "## Human decides\n- a\n\n## QA")), [
    "Story Human decides belongs between Decisions and MUST.",
  ]);
  assert.deepEqual(
    errors(f.story.replace("# Story: Validate input", "# Story: <title>").replace("Status: Draft", "Status: Done").replace("Owner: Human", "Owner: pending")),
    ["Story needs a descriptive “# Story:” title.", "Status must be Draft or Approved.", "Story needs a human Owner."],
  );
  assert.deepEqual(errors(f.story.replace("Status: Draft", "Status: Approved (G1 hub-approval:x · 2026-11-24)")), []);
});

test("a Story in the format before story-qa is refused for its missing QA section", (t) => {
  const f = fixture(t);
  const old = "# Story: Validate input\nStatus: Draft\nOwner: Human\n\n## Goal\nReject invalid input.\n## Domain\nPreserve existing records.\n## MUST\n- M1. Reject invalid input.\n## SHOULD\n- S1. Explain errors.\n## OUT\n- O1. Deployment.\n## Decisions\n- D1. Local only.\n## Verify\n- V1 [M1]. Check invalid input.\n";
  const errors = storyShapeErrors(f.project, old);
  assert.ok(errors.includes("Missing Story section: QA."), errors.join(" | "));
  assert.ok(errors.includes("MUST M1 is not mapped to a Q# scenario."));
});

test("Task rules: at most 30 non-empty lines, Readiness, Story, Plan source, sections and coverage", (t) => {
  const f = fixture(t);
  assert.deepEqual(taskShapeErrors(`${f.task}${"x\n".repeat(20)}`), ["Task has 34 non-empty lines; maximum is 30."]);
  assert.deepEqual(
    taskShapeErrors(f.task.replace("Readiness: Implementation-ready", "Readiness: Soon").replace("Story: story.md", "Story: <path>").replace("M1, Q1", "M1")),
    [
      "Task Readiness must be Draft or Implementation-ready.",
      "Task must reference its canonical Story.",
      "Task Covers must reference at least one Story M# and Q# ID.",
    ],
  );
  assert.deepEqual(taskShapeErrors(f.task.replace("## Scope\nInput parser.\n", "")), ["Missing Task section: Scope."]);
});
