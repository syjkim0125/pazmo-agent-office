---
name: workflow
description: Use when a user requests a product or engineering change, especially from a vague feature idea, before planning, coding, or declaring delivery complete.
argument-hint: "[request | status | finish]"
---

# Workflow

Invoke in Codex with `$workflow`; in Claude Code with `/workflow`. After installation or updates, start a new task/session.

Turn `$ARGUMENTS` into an approved, reviewable change without creating documentation debt.

## Non-negotiable gates

- Do not plan implementation or edit production code before the Story is `Approved` and G1 is recorded.
- Do not declare delivery complete or merge a non-trivial change before G4 passes.
- Requirements have one source of truth. AI context may be richer; copied requirements may not diverge.

## Explain before asking

Before G1 or G3, explain the problem, intended change, safety rule and verification in plain language. Put the short explanation before technical details; use one concrete example when helpful. Keep G4 prediction-before-reveal intact.

## Route by current state

1. **No approved Story:** read `references/intake.md`. Use `assets/STORY.md`; ask only missing behavior questions and obtain G1.
2. **Approved, not implemented:** read `references/execution.md`. Read `references/domain-risks.md` only for relevant risk domains. Create a Task from `assets/TASK.md` only when one PR is not reviewable.
3. **Implemented or `finish`:** complete pending checks in `references/execution.md`, then follow `references/understanding-gate.md` for G4.
4. **`status`:** report stage, blocking decision, evidence present, and the single next action.

Use the user's language. Keep each response focused on one decision. Surface assumptions and evidence boundaries. Never say “AI decided”; name the human-owned decision or mark it open.
