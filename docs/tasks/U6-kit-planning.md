# Task: Native PM and Lead graphs separated by actual G1
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
New Office requests use PM clarify/propose, stop for human Story approval, then run Lead investigate/plan against that exact approved Story.
## Covers — Story M/V IDs
M2, M3, M4, V2, V3, V4
## Scope
Native role CLI transport, existing planning supervision, addressed questions, human G1 API/UI, and persistent role receipts.
## Constraints
Preserve legacy conversations and approvals. Kit owns node transitions; Office owns human approval and process leases. Unknown execution is never replayed.
## Verify
V2: human Story approval precedes Lead and remains distinct from final contract/execution approval.
V3: actual installed CLI supplies all four nodes and question resume tokens.
V4: reject forged/stale approval and changed source; preserve cancellation/restart/capacity boundaries.
