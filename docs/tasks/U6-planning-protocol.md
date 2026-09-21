# Task: Connect PM questions and Lead proposals to contract drafts
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
Controller-captured PM/Lead responses produce bounded questions or reviewable contract documents that still require existing human approvals.

## Covers — Story M/V IDs
- M2, M3, M4 / V2, V3, V4

## Scope
- IN: Pinned planning role profiles, current-input binding, question/answer handoff, structured requirement/task mapping, generated contract drafts and existing approval-store integration.
- OUT: Live model calls, persistent conversation/CAS, UI, automatic document writes/registration and scheduling; retained in Story.

## Constraints
- Proposals grant no execution or approval. Office supplies identity and risk; the model cannot choose files or approval metadata.
- All MUST/Verify IDs must be covered; Tasks stay under 30 non-empty lines.
- Three questions per round and three rounds maximum; exhaustion requires human intervention.

## Verify
- Test-first question/answer to PM/Lead draft and registration with G1/G3 still required.
- Reject stale/failed/ambiguous reports, wrong answers, Markdown metadata injection, invalid scopes/checks and incomplete mappings.
- Evidence: docs/verification/2026-09-21-planning-protocol.md
