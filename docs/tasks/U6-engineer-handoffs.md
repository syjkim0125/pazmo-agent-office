# Task: Bind Engineer attempts to their input and verification candidate

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
An approved workspace selection is captured before an Engineer starts; only its successful, closed attempt can supply the next verification candidate and G4 baseline.

## Covers — Story M/V IDs
- M3, M4, M5 / V3, V4, V5

## Scope
- IN: Approved selection, persisted baseline/attempt/candidate identity, fix ancestry, closure admission, G4 binding, backed-up schema v6 and private inspection.
- OUT: Authenticated model execution, VM workspace transport, automatic Office coordinator, semantic evaluator, delivery and live pilots.

## Constraints
- Staging is controller-owned transport data; it does not authorize executing worker commands on the host.
- Failed, cancelled, unknown, changed or unbound attempts must not produce eligible G4 evidence.
- Legacy contracts without a workspace remain readable but cannot start an Engineer.

## Verify
- Real SQLite/filesystem/Git and HTTP/CLI tests; supervisor and reviewer observations remain fixtures.
- Evidence: docs/verification/2026-09-21-engineer-handoffs.md
