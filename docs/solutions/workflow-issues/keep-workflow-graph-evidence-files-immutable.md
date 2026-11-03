---
title: Keep workflow-graph evidence files immutable after recording a node
date: 2026-10-16
last_updated: 2026-11-03
category: workflow-issues
module: ai-workflow graph
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Recording kit graph nodes (node .ai-workflow/bin/graph.mjs record) with evidence files"
  - "Editing a verification doc or the Story after a node was recorded"
  - "Under kit 5: changing the canonical Story, committing after review or verify started, or merging main into a branch with a run"
tags: [ai-workflow, graph, evidence, story-fingerprint, g4, kit5, g1-binding, snapshot]
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
- **Result JSON** must be project-relative. Write it to a scratch name and remove it right after `record`, for example `.ai-workflow/tmp-<node>.json` (under kit 5, put review and verify results under `.ai-workflow/runs/` instead; see below). Stage files with explicit `git add <paths>`, never `-A`, in fresh worktrees.
- When the target branch's files are in use (running Offices read the source live), do graph work for other branches in a temporary `git worktree add` under the scratchpad.

### kit 5 adds two more bindings (since PR syjkim0125/pazmo-agent-office#65, D36)

kit 5 binds two more things to a run.

- **G1 is bound to the Story text.** The G1 record is a JSON file (`gate`, `storyHash`, `responseRef`). `storyHash` is kit's canonical Story hash: the text without its progress lines, which are `Status:`, `Understanding gate (G1/G3/G4):` and `G4:` (`.ai-workflow/graph/snapshot.mjs`, `canonicalStory`). Every graph command checks it. A Story whose requirement text changed is refused with "G1 approval binding changed or missing; obtain a fresh human decision for this Story/revision".
- **Review and verification are bound to a code snapshot.** The snapshot covers HEAD, the index, tracked and non-ignored untracked files, plus the verification profile and recipe. A change returns `stale`, and a passing `record` is refused.

What follows from that:

- **One G1 per Story change.** This repo keeps one canonical Story and adds a Decision for each change, so every change, and every main merge that brings another change's Decision, moves the hash. The user's fresh answer is needed each time. An agent must not re-bind on its own. In practice the question rides along with the change's own G3 or G4 question, or with the merge question: "approve the combined Story as G1?". The JSON's `responseRef` names that answer. Progress-line edits (the G4 line, `G4: PASS`) need nothing.
- **Commit before review starts.** Write code and every doc, STATUS included, then commit, then start `workflow-review`. After that, any tracked edit, and any commit at all (HEAD changes), makes review and verify stale.
- **Kit outputs are committed after delivery.** `.ai-workflow/runs`, `evidence` and `approvals` are outside the snapshot, but committing them still moves HEAD. So write the G4 JSON (`gate`, `storyHash`, `snapshot`, `runId`, `responseRef`) and the Story's G4 lines, run `check.mjs gate G4` and `graph.mjs delivery <run>`, and only then commit the kit outputs and the STATUS G4 line.
- **Put a review or verify result JSON under `.ai-workflow/runs/`.** A passing `record` of a review or verify node computes the snapshot again while the result file exists. A result file elsewhere, such as `.ai-workflow/tmp-<node>.json`, is an untracked file inside the snapshot, so the record is refused with "Code snapshot changed during review/verification; reset affected work." Delete the stray file and record again; the node is still running, so no attempt is lost (U33, 2026-11-03). Implement nodes and failed records do not check the snapshot.
- **A profile edit needs a new run** ("Verification profile changed; replan in a new run."). Keep each check under kit's 300 s limit, for example by sharding the tests, before the first `init`.
- **Each node has three attempts.** A wording fix found in a late review round can use up the review's attempts. Settle the docs before review starts, or carry a late correction into the next merge run.
- **Merging main means a new merge run** (`<unit>-merge.json`): implement (the merge evidence) → review (the merge delta) → `graph verify` again. If main changed the Story, get the G1 first.

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
- U30, kit 5 upgrade (PR syjkim0125/pazmo-agent-office#65), 2026-11-03:
  - **New run after a profile change.** Under load the whole suite ran for 336 s. The repo profile was split into three test shards, and the run was restarted as `U30-kit5-upgrade-replan.json`.
  - **Three review attempts.** The third review found an overclaiming sentence in STATUS and the verification record. Editing it would have made that last review attempt stale, so the fix went into the next merge commit.
  - **Merges.** Main was merged three times, and each merge got its own merge run and kit verify. #64 (D38) changed the Story, so G1 was asked for again as "합치고 G1 승인". #66 (D37) arrived after G4. The G4 and delivery stayed bound to the earlier snapshot, the merged result was checked with the full suite, and #67's session later re-bound G1 for D37.
