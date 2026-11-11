---
title: Bind a kit G3 through the verification profile, and switch it off after delivery
date: "2026-11-11"
category: workflow-issues
module: ai-workflow graph
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A Story change is high risk and its design approval (G3) should be enforced by the kit graph, not only written in prose"
  - "A tool or command reads kit G3 records outside the kit (for example `pazmo-office team upload` for high-risk Stories)"
  - "A run that carried G3 has been delivered and the next change starts"
tags: [ai-workflow-kit, g3, verification-profile, design-approval, graph-init, delivery]
---

# Bind a kit G3 through the verification profile, and switch it off after delivery

## Context

U39 (D42, PR #81) was the first change in this repo to bind a G3 through the kit graph. Earlier G3s were recorded only as a Story header line. Two things were not obvious. The kit takes the design document's path from the verification profile, not from the G3 record. And the profile switch stays on for every later run unless it is turned off. The upload command built in the same change first read the design path from the G3 record. The final review caught it (a G3 written the kit way would have been refused in a loop), and the command was fixed to read the profile.

## Guidance

1. **Write the design document first, then get the human decision.** After the user approves it, write `.ai-workflow/approvals/<slug>-g3.json` with `gate: "G3"`, the canonical `storyHash`, `decisionHash` = sha256 of the design file's bytes, and a `responseRef` naming the actual answer. Point the Story's `Understanding gate (G3):` line at that JSON. The line is progress metadata, so changing it does not move the Story hash.
2. **Turn the profile on before `graph.mjs init`.** In `.ai-workflow/verification.json`, set `requiresG3: true` and `design: "<path to the design doc>"`. The profile is refused if `requiresG3` is on without a design path (`.ai-workflow/graph/verification.mjs:29`). At init the CLI hashes `profile.value.design` and checks it against the bound G3 record (`.ai-workflow/graph/cli.mjs:84-86`). Add the change's new V id to every check's `covers` at the same time; profile edits after init need a new run.
3. **Never edit the design document after G3.** With `requiresG3` on, the design file is a snapshot input (`.ai-workflow/graph/cli.mjs:95`), so an edit makes the run stale and breaks the `decisionHash`. Keep HOW changes in the separate implementation plan.
4. **Read the design path the kit's way in your own tools.** Take it from the profile's `design`, and fall back to a `design` field in the G3 record only when the profile names none. Refuse when both name different files. `src/team/upload.ts` (`designPath`, profile at `.ai-workflow/verification.json`, line 134 onward) does this for high-risk uploads.
5. **Switch it off in the delivery commit.** After G4 and `graph.mjs delivery`, set `requiresG3: false` and drop `design`. Otherwise every later run must bind a G3 to that old design document, which fails for an unrelated small change.

## Why This Matters

A prose-only G3 is not enforced: an implementation can drift from the approved design without any check failing. Binding it through the profile makes `init` refuse a missing or mismatched approval, and makes design edits visible as a stale run. The two traps, reading the design path from the wrong place and leaving the switch on, each cost a late fix round or block the next change.

## When to Apply

- High-risk changes: approval trust, remote writes, money, data migration, or anything the kit's high-risk signals list.
- Not for small reversible changes. They need no G3, and the profile should stay `requiresG3: false`.

## Examples

U39's profile during the run (abridged):

```json
{ "version": 1, "recipe": "docs/verification/kit-checks.md",
  "checks": [{ "id": "tests-1of3", "covers": ["V1", "…", "V20"], "argv": ["node", "scripts/kit-test-shard.mjs", "0", "3"] }],
  "requiresG3": true, "design": "docs/understanding/hub-board-local-upload-plan.md" }
```

In the delivery commit the last line became `"requiresG3": false` with no `design`.

## Related

- [keep-workflow-graph-evidence-files-immutable.md](keep-workflow-graph-evidence-files-immutable.md): the same rule for evidence files and the G1 binding.
- `.agents/skills/workflow/references/verification.md` ("Bind human decisions").
