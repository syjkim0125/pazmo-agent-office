# Task: Supported operator model launch
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
The operator can start and cancel the existing native planning and approved implementation flows from the screen using explicitly configured qualified Mac/VM runtime paths.
## Covers — Story M/V IDs
M2, M3, M4, V2, V3, V4
## Scope
Supported live startup options, readiness reporting, addressed launches, persisted planning snapshots, operator controls and process shutdown.
## Constraints
Preserve approvals, kit authority, global budgets, existing project changes and unknown leases. No local worker fallback or new workflow engine.
## Verify
V2: screen uses the authenticated supported service routes; scope approval and execution approval remain distinct.
V3: reuse the native planning and implementation coordinators with the qualified controller and VM.
V4: reject missing qualification/approval, duplicate or stale launch; cancel and stop without closing an active worker's ledgers.
