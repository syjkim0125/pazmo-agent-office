import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-contract-")));
  // t.after hooks run in registration order, so a test's own after hook would
  // run after root (and the Office manifest it needs to stop) is gone. Deferred
  // cleanups run first, newest first; root is removed even if one throws.
  const cleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const project = join(root, "project");
  mkdirSync(project);
  const story = `# Story: Validate input\n\n## Goal\n1. As-is: Invalid input is accepted.\n2. To-be: Invalid input is rejected.\n3. Unchanged: Existing records.\n\n## Decisions\n- D1. Local only.\n\n## MUST\n- M1. Reject invalid input.\n\n## OUT\n- O1. Deployment.\n\n## QA\n- Q1 [M1] (script). Check invalid input.\n- Q2 [Unchanged] (script). Valid input is stored.\n\n---\nStatus: Draft\nOwner: Human\n`;
  const task = `# Task: Input validation\nReadiness: Implementation-ready\nStory: story.md\nPlan source: N/A — small and reversible\n\n## Outcome\nReject invalid input.\n## Covers — Story M/Q IDs\nM1, Q1\n## Scope\nInput parser.\n## Constraints\nNo deployment.\n## Checks\nQ1: node --test\n`;
  const verification = {
    version: 1,
    checks: [{ id: "Q1", argv: ["node", "--test"], timeoutMs: 30000 }],
  };
  const put = (path, text) => writeFileSync(join(project, path), text);
  put("story.md", story);
  put("task.md", task);
  put("verify.json", JSON.stringify(verification));
  put(
    "decision.md",
    "Change authorization controls; preserve existing records.",
  );
  return {
    root,
    defer: (cleanup) => cleanups.push(cleanup),
    project,
    story,
    task,
    verification,
    put,
    input: {
      story: "story.md",
      task: "task.md",
      verification: "verify.json",
      risk: "high",
      decision: "decision.md",
    },
  };
}
