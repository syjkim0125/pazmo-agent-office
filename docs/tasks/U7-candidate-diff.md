# Task: Generate G4 evidence from frozen snapshots

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

G4 shows a mechanically generated change whose patch and permission metadata reproduce the verified candidate from a named frozen baseline.

## Covers — Story M/V IDs

- M2, M4, M5 / V2, V4, V5

## Scope

- IN: Actual bounded Git comparison/replay, empty candidates, byte/mode/link evidence, same-round G4 binding and stale capture rejection.
- OUT: Engineer baseline provenance/selection coordinator, semantic evaluator, browser UI, authenticated pilots and artifact delivery.

## Constraints

- Candidate code, hooks, external diff and textconv must not execute while collecting evidence.
- Unverifiable or legacy raw-string evidence cannot obtain approval; complete project selection is a separate controller responsibility.

## Verify

- Actual patch replay, binary/non-UTF8/mode/link/type changes, empty/add/delete/no-change, tampering, size bounds, hostile Git environment and cancellation.
- Evidence: docs/verification/2026-09-21-candidate-diff.md
