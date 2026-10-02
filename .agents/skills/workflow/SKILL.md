---
name: workflow
description: Use when a user requests a product or engineering change, especially from a vague feature idea, before planning, coding, or declaring delivery complete.
argument-hint: "[request | status | finish]"
---

# Workflow

Invoke in Codex with `$workflow`; in Claude Code with `/workflow`. After installation or updates, start a new task/session.

Turn `$ARGUMENTS` into an approved change. For assigned roles, follow `references/role-graphs.md` and `references/skill-integration.md`: reuse the supplied run/node/token or automatically initialize `init-role`. Do not restart delivery.

## Non-negotiable gates

- Do not plan implementation or edit production code before the Story is `Approved` and G1 is recorded.
- Do not declare delivery complete or merge a non-trivial change before G4 passes.
- Requirements have one source of truth. AI context may be richer; copied requirements may not diverge.

## Explain before asking

Before G1/G3, explain the problem, change, safety rule and verification plainly. Keep G4 prediction-before-reveal intact.

## Route by current state

1. **No approved Story:** read `references/intake.md`. Use `assets/STORY.md`; ask only missing behavior questions and obtain G1.
2. **Approved, not implemented:** read `references/execution.md` and `references/graph-engineering.md`. Automatically initialize/resume the installed Graph CLI; use the minimal plan for small work. Read `references/domain-risks.md` for relevant risks. Create a Task only when one PR is not reviewable.
3. **Implemented or `finish`:** complete pending checks in `references/execution.md`, then follow `references/understanding-gate.md` for G4.
4. **`status`:** run the existing graph's `status` command; report stage, blocking decision, evidence and next action. Without a run, report the Story stage.

Use the user's language. State assumptions, evidence limits and human-owned decisions.
