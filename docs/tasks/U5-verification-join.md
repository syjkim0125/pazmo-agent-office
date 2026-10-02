# Task: Join verification on the same candidate

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

The controller requires every check and review for one candidate before offering G4, preserving failed and interrupted rounds.

## Covers — Story M/V IDs

- M3, M4 / V3, V4

## Scope

- IN: Persistent verification rounds, required results, exact candidate/contract binding, bounded fix routing and queue consistency.
- OUT: This Task does not establish live runner isolation, worker process cleanup, G4 understanding evaluation or delivery.

## Constraints

- Only controller-captured process observations may enter the internal ledger; worker success text is not evidence.
- Historical callbacks must not mutate the current task; incomplete, changed or unknown evidence cannot pass.

## Verify

- Real SQLite joins, repeated V IDs, out-of-order results, stale/duplicate results, two-fix bound, restart and rollback.
- Real candidate and contract mutations invalidate the eligibility for G4.
- Live runtime remains locked until runner and integration evidence exists.
