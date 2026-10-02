# Task: Collect real checks from an isolated candidate

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

An approved deterministic check runs against the frozen candidate in the dedicated VM and supplies controller-observed evidence to its reserved verification node.

## Covers — Story M/V IDs

- M3, M4 / V3, V4

## Scope

- IN: Offline test execution, bounded output, observed exit status, cancellation, cleanup and persisted execution/result association.
- OUT: Authenticated Engineer/Reviewer execution, general dependency preparation, automatic dispatch, G4 and delivery. These remain in the Story; this is only part of U4.

## Constraints

- No host bind mounts, inherited credentials, network, or worker access to controller state.
- Unknown termination never grants success or releases an unconfirmed execution slot.

## Verify

- Real VM fixtures distinguish pass, exit 7, timeout with a child, cancellation and excessive output.
- Cleanup failures, supervisor exceptions and changed candidates cannot create successful evidence.
- Evidence: docs/verification/2026-09-21-container-verifier.md
