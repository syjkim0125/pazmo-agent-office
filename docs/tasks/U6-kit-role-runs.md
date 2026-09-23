# Task: Persist native kit role runs in Office
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
Office assigns bounded work through the installed kit 4.1.0 role CLI without duplicating local transitions.
## Covers — Story M/V IDs
M2, M3, M4, V2, V3, V4
## Scope
Trusted CLI transport, role assignment and immutable evidence; question/answer and feedback; binding to actual candidate identity; restart/cancel boundaries.
## Constraints
Office-only changes, no Jira, no fabricated approval. Preserve legacy runs and authentication boundary.
## Verify
V2: installed doctor and actual role CLI commands.
V3: role readiness, question/answer and external review feedback through Office adapter.
V4: stale token, cancelled result, changed source, wrong candidate, duplicate and restart cases.
