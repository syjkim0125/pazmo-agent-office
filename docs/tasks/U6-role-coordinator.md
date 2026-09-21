# Task: Coordinate approved Engineer, verification and bounded fixes
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
One controller invocation advances an approved task through Engineer, frozen candidate, required tests/review and at most two fixes, stopping at G4 or an explicit blocker.

## Covers — Story M/V IDs
- M3, M4, M5 / V3, V4, V5

## Scope
- IN: Approved role context, existing runner coordination, persisted budgets, parallel verification, cancellation, duplicate/resume safety and actual CLI/VM fixture.
- OUT: Authentication approval, live semantic model evidence, public execution unlock, automatic unknown recovery, G4 approval and delivery; retained in Story.

## Constraints
- No second queue/database, account access, policy relaxation or nested model agents.
- Each retry uses the last candidate and re-runs all required checks with current evidence.
- Unknown closure cannot release slots or trigger fixes. Deferred external capacity is reported explicitly.

## Verify
- Test-first approval/context tampering, successful and exhausted fixes, duplicate invocation, cancellation and unknown/occupied capacity.
- Actual CLI/VM automatic failed-check → fix → recheck/review → G4 waiting; preserve original project.
- Evidence: docs/verification/2026-09-21-role-coordinator.md
