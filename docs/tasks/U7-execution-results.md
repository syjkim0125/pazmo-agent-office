# Task: Inspect execution results from Office
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
The operator can inspect registered work, its current candidate, verification results, process records and G4/delivery state.
## Covers — Story M/V IDs
M2, M5, V2, V5
## Scope
Read-only UI through existing private APIs; refresh, failure, disconnect and untrusted-text handling.
## Constraints
No new model launch, approval evaluation, delivery mutation or independent kit node state.
## Verify
V2: manual listing and current result selection use authenticated GET only.
V5: distinguish pending, approved and delivered; reject stale display after disconnect/failure; desktop and narrow-screen checks.
