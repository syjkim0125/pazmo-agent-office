# Task: Persist planning conversations and operator replies
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
Requests and PM/Lead exchanges survive restart, and only a reply to the current conversation can advance it.

## Covers — Story M/V IDs
- M2, M3, M4 / V2, V3, V4

## Scope
- IN: Existing SQLite/task queue, append-only dialogue events, version-bound replies/results, operator create/read/answer/cancel CLI/API, owned DB backup/migration.
- OUT: Live planning supervision, model slot reservations, automatic recovery or publication, UI controls and downstream task registration; retained in Story.

## Constraints
- No public model-result submission or approval bypass. Planning proposals remain drafts.
- State and history commit together. Late/duplicate results and cancelled tasks cannot revive planning.
- Unknown/invalid model observations require human intervention; no automatic retry.

## Verify
- Test-first persistence, token rotation, stale/wrong replies, cancellation, proposal retention and transaction rollback.
- Real CLI/server restart and private API checks; v1–v7 backups before schema v8.
- Evidence: docs/verification/2026-09-21-intake-ledger.md
