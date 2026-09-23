# Task: Deliver the approved local candidate

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

After evaluated G4 approval, the operator receives the exact verified candidate and its evidence as a private local artifact; only a committed delivery receipt marks the task done.

## Covers — Story M/V IDs

- M2, M4, M5 / V2, V4, V5

## Scope

- IN: Local snapshot and evidence receipt, private delivery CLI/API, transaction failure handling, restart validation and backed-up additive migration.
- OUT: Authenticated models, semantic G4 evaluator, browser approval UI, original checkout application, remote publication and full Story acceptance.

## Constraints

- Delivery cannot grant G4, execute candidate code or adopt uncommitted output.
- Candidate, contract, joined evidence and human approval must match; late cancellation cannot undo valid delivery.

## Verify

- Missing approval, wrong operator, snapshot integrity, idempotence, database failure, restart, stale evidence, orphan output and actual CLI/API behavior.
- Evidence: docs/verification/2026-09-21-local-delivery.md
