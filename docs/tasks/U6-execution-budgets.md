# Task: Reserve execution capacity before launch

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

The controller preserves execution limits and workflow ownership across concurrent reservations, failures and restarts.

## Covers — Story M/V IDs

- M3, M4 / V3, V4

## Scope

- IN: Persisted execution reservations, implementation/fix bounds, resource exclusion, verification completion, restart quarantine and automatic bounded test dispatch.
- OUT: This Task does not establish process isolation, authenticated role execution, process termination or human recovery authorization.

## Constraints

- Unknown liveness cannot free capacity; only controller-supervised observations can complete a running reservation.
- Reservation, budget use and workflow changes must be atomic in the existing Office database.

## Verify

- Concurrent database connections cannot reserve over three slots; at most two reservations are for implementation.
- Duplicate/late results, changed candidates, failed transactions and restart cannot reset budgets or grant success.
- Real VM dispatch proves three overlapping checks, a fourth waiting for capacity, and cancellation without launching queued work; see docs/verification/2026-09-21-verification-dispatch.md.
