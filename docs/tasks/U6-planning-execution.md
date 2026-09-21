# Task: Supervise PM and Lead in the shared Office execution budget
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
PM and Lead run sequentially against readonly project context and persist their result or required human intervention without duplicate execution.

## Covers — Story M/V IDs
- M2, M3, M4 / V2, V3, V4

## Scope
- IN: Shared planning/execution capacity, owned role completion, PM-to-Lead dispatch, interrupted-run recovery and additive migration.
- OUT: Public launch UI, authenticated model execution, automatic approval and capacity wakeup; retained in the Story.

## Constraints
- Keep existing contract leases and approval boundaries; planning does not approve or register its own proposal.
- Bind results to the saved conversation revision and input/context digests.
- Unknown supervisors retain capacity; confirmed late closure cannot revive cancelled work.

## Verify
- Test-first reservations, transactional rollback, cancellation, restart, malformed output and changed context.
- Race independent SQLite controllers across planning/implementation slots.
- Real service migration/restart and readonly VM tools; distinguish scripted model reports from live evidence.
- Evidence: docs/verification/2026-09-21-planning-execution.md
- Follow-up: docs/verification/2026-09-21-kit-handoff-context.md (snapshot prompt, skill fallback, old-profile preservation).
