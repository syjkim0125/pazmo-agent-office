---
title: Keep workflow-graph evidence files immutable after recording a node
date: 2026-10-16
last_updated: 2026-10-28
category: workflow-issues
module: ai-workflow graph
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Recording kit graph nodes (node .ai-workflow/bin/graph.mjs record) with evidence files"
  - "Editing a verification doc or the Story after a node was recorded"
tags: [ai-workflow, graph, evidence, story-fingerprint, g4]
---

# Keep workflow-graph evidence files immutable after recording a node

## Context
The kit graph stores a hash of every evidence file when a node is recorded, and the run stores the Story's fingerprint. `status` recomputes the hashes and throws when they differ (`.ai-workflow/graph/workflow.mjs`, "Node evidence changed: <node>; reset affected work."). Three things blocked progress in the team hub work (U12, A, B):

- **Story fingerprint changed.** Adding B's Story lines (M13/D21/V15) made `record` on A's run fail with "Story requirements changed; replan in a new run." Editing a U12 Story line for the public-repo cleanup did the same to U12's run.
- **Evidence changed.** B's verification doc was used as evidence, then gained a real-screen section. `status` then answered "Node evidence changed: implement; reset affected work."
- **Path rejected.** A result file outside the project gave "Use a project-relative file path." A result file placed in a fresh worktree's `.superpowers/` was committed by `git add -A`, because `.superpowers` is not ignored there.

## Guidance
- **Append-only evidence.** After a node is recorded, never edit its evidence file. Put later facts (real check, G4) in a new file, such as `docs/verification/<date>-<unit>-g4.md`, and cite that file from the next node.
- **Record before the Story moves.** Record a unit's nodes before adding the next unit's Story lines. If the lines must go in first, temporarily remove them, record, commit, then restore them. If a run with no recorded evidence is already stale, delete it and run `graph.mjs init` again.
- **If you just edited an evidence file by mistake,** undo the edit so the file has the same bytes as when it was recorded. The hash then matches again, and `status` returns its earlier action with no reset. Put the new fact in its own file instead.
- **If evidence already changed** and must keep the change, run `graph.mjs reset <run> <node> "<reason>"`, then start and record the node again.
- **Result JSON** must be project-relative. Write it to a scratch name and remove it right after `record`, for example `.ai-workflow/tmp-<node>.json`. Stage files with explicit `git add <paths>`, never `-A`, in fresh worktrees.
- When the target branch's files are in use (running Offices read the source live), do graph work for other branches in a temporary `git worktree add` under the scratchpad.

## Why This Matters
The hashes are what make the graph's "ready for G4" trustworthy. Edits after recording are exactly what they are designed to catch. Working with them avoids replans and resets late in the gate.

## When to Apply
Every time a verification doc, Story or Task is both evidence and a living document. That is most units that go through a real check after review.

## Examples
- B: implement and review re-recorded after `reset`. The G4 went into `2026-10-15-office-role-characters-g4.md` and the verify node cited only that file. Final status `action: g4`.
- U12 and A: verify nodes cited new `*-g4.md` files and left the earlier verification docs untouched.
- U19, lean rerun of a stopped task (PR syjkim0125/pazmo-agent-office#37), 2026-10-28:
  - All three nodes were recorded, and `status` was `g4`. Changing the verification doc's "G4: 남아 있다" line to point at the G4 record made `status` fail with "Node evidence changed: implement".
  - Reverting that one line brought `status` back to `g4`.
  - The G4 went into `2026-10-27-lean-rerun-g4.md` and STATUS. The G4 file says why the verification doc still reads "남아 있다".
