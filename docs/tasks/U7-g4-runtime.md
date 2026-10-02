# Task: G4 answer assessment from the operator screen
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
The operator can assess the saved human G4 answer with the qualified model and deliver only after the existing ledger accepts the exact answer against the verified candidate.
## Covers — Story M/V IDs
M2, M4, M5, V2, V4, V5
## Scope
Trusted readonly evaluator, existing execution budget, addressed screen launch and failure visibility.
## Constraints
No generated human answers, worker approval capability, duplicate state owner, approval bypass or new model route. Existing README conversational approval is preserved separately.
## Verify
V2: authenticated screen submits only request identity and answer digest; no caller-provided assessment.
V4: stale/cancelled/expired/malformed/unknown outcomes never approve or deliver; retries remain bounded.
V5: exact stored answer and evidence receive a separately recorded assessment; fixtures are not actual model or human evidence.
