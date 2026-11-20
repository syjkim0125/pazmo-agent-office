import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { storyShapeErrors, taskShapeErrors } from "../src/core/contract-shape.ts";

test("the fixture Story and Task pass the shape checks", (t) => {
  const f = fixture(t);
  assert.deepEqual(storyShapeErrors(f.project, f.story), []);
  assert.deepEqual(taskShapeErrors(f.task), []);
});

test("Story rules: section order, MUST/Verify mapping and duplicates, title, Status and Owner", (t) => {
  const f = fixture(t);
  const errors = (text) => storyShapeErrors(f.project, text);
  assert.deepEqual(errors(f.story.replace("## Domain", "## OUT\n## Domain")), [
    "Story sections are out of order; keep the canonical template order.",
  ]);
  assert.deepEqual(errors(f.story.replace("- V1 [M1]", "- V1 [M2]")), [
    "Verify case references unknown MUST M2: - V1 [M2]. Check invalid input.",
    "MUST M1 is not mapped to a V# verification case.",
  ]);
  assert.deepEqual(errors(f.story.replace("- M1.", "- M1. a\n- M1.")), ["Duplicate MUST ID: M1."]);
  assert.deepEqual(
    errors(f.story.replace("# Story: Validate input", "# Story: <title>").replace("Status: Draft", "Status: Done").replace("Owner: Human", "Owner: pending")),
    ["Story needs a descriptive “# Story:” title.", "Status must be Draft, Approved, or Delivered.", "Story needs a human Owner."],
  );
});

test("an Approved Story needs a G1 line naming non-empty evidence inside the project; Delivered also needs G4: PASS", (t) => {
  const f = fixture(t);
  const errors = (status) => storyShapeErrors(f.project, f.story.replace("Status: Draft", status));
  assert.deepEqual(errors("Status: Approved"), ["Missing Understanding gate (G1) record."]);
  writeFileSync(join(f.project, "g1.json"), "{}");
  writeFileSync(join(f.project, "empty.json"), "");
  assert.deepEqual(errors("Status: Approved\nUnderstanding gate (G1): g1.json · 2026-11-20 · Check-in: accepted"), []);
  assert.deepEqual(errors("Status: Approved\nUnderstanding gate (G1): empty.json · 2026-11-20 · Check-in: accepted"), [
    "G1 evidence artifact is empty: empty.json",
  ]);
  assert.deepEqual(errors("Status: Approved\nUnderstanding gate (G1): ../g1.json · 2026-11-20 · Check-in: accepted"), [
    "G1 evidence artifact escapes project root: ../g1.json",
  ]);
  assert.deepEqual(errors("Status: Approved\nUnderstanding gate (G1): g1.json · Check-in: declined"), ["G1 check-in was declined."]);
  const g1 = "Understanding gate (G1): g1.json · Check-in: accepted";
  assert.deepEqual(errors(`Status: Delivered\n${g1}\nUnderstanding gate (G4): g1.json · Check-in: accepted`), [
    "G4 evidence exists, but the Story is missing an explicit “G4: PASS — <human restatement evidence>” record.",
  ]);
  assert.deepEqual(errors(`Status: Delivered\n${g1}\nUnderstanding gate (G4): N/A — docs only change here`), []);
  assert.deepEqual(errors("Status: Approved\n- OPEN BLOCKING which store?\n" + g1), [
    "Approved Story contains OPEN BLOCKING and cannot proceed.",
  ]);
});

test("Task rules: at most 30 non-empty lines, Readiness, Story, Plan source, sections and coverage", (t) => {
  const f = fixture(t);
  assert.deepEqual(taskShapeErrors(`${f.task}${"x\n".repeat(20)}`), ["Task has 34 non-empty lines; maximum is 30."]);
  assert.deepEqual(
    taskShapeErrors(f.task.replace("Readiness: Implementation-ready", "Readiness: Soon").replace("Story: story.md", "Story: <path>").replace("M1, V1", "M1")),
    [
      "Task Readiness must be Draft or Implementation-ready.",
      "Task must reference its canonical Story.",
      "Task Covers must reference at least one Story M# and V# ID.",
    ],
  );
  assert.deepEqual(taskShapeErrors(f.task.replace("## Scope\nInput parser.\n", "")), ["Missing Task section: Scope."]);
});
