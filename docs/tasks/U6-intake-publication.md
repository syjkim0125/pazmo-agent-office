# Task: Register a saved Lead proposal for human approval
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
A saved proposal becomes project documents and linked tasks awaiting the existing approval gates.

## Covers — Story M/V IDs
- M2, M3, M4 / V2, V3, V4

## Scope
- IN: Authenticated publication CLI/API, exclusive document creation, atomic task/receipt/history registration and additive DB migration.
- OUT: Live model supervision, dependency scheduling, UI controls and automatic approval; retained in the Story.

## Constraints
- Never overwrite existing project documents or adopt abandoned files automatically.
- Recheck conversation ownership after asynchronous validation; no partial task registrations on failure.
- Publication creates no approval and starts no worker.

## Verify
- Test-first: multiple tasks, idempotent retry, stale/cancel/concurrent requests, invalid contract and SQLite rollback.
- Real CLI/API, restart, migration backup and unchanged approval enforcement.
- Evidence: docs/verification/2026-09-21-intake-publication.md
