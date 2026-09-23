# Task: Bind local contracts to operator approval

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

Users register local contracts and approve their exact revisions through the Office controller.

## Covers — Story M/V IDs

- M2, M4 / V2, V4

## Scope

- IN: Canonical Story/Task validation, same-queue persistence, private operator approval and candidate snapshot primitives.
- OUT: Live Codex execution and publication.

## Constraints

- Markdown approval text is untrusted; only authenticated operator decisions grant approval.
- Changed contracts or candidates must invalidate dependent approvals and evidence.
- UI and execution remain locked until all applicable runtime guards pass.

## Verify

- Real SQLite rollback, replay, expiration, exact revision binding and workflow formatting tests.
- CLI through HTTP integration, token separation, owned-DB backup and foreign-DB refusal.
- File snapshots detect content/mode/link changes; live worker isolation is separate evidence.
