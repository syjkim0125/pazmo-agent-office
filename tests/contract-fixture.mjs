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
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  mkdirSync(project);
  const story = `# Story: Validate input\nStatus: Draft\nOwner: Human\n\n## Goal\nReject invalid input.\n## Domain\nPreserve existing records.\n## MUST\n- M1. Reject invalid input.\n## SHOULD\n- S1. Explain errors.\n## OUT\n- O1. Deployment.\n## Decisions\n- D1. Local only.\n## Verify\n- V1 [M1]. Check invalid input.\n`;
  const task = `# Task: Input validation\nReadiness: Implementation-ready\nStory: story.md\nPlan source: N/A — small and reversible\n\n## Outcome\nReject invalid input.\n## Covers — Story M/V IDs\nM1, V1\n## Scope\nInput parser.\n## Constraints\nNo deployment.\n## Verify\nV1: node --test\n`;
  const verification = {
    version: 1,
    checks: [{ id: "V1", argv: ["node", "--test"], timeoutMs: 30000 }],
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
