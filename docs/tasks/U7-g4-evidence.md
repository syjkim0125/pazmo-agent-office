# Task: Bind G4 understanding to verified evidence

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome

The operator sees immutable evidence, submits an understanding answer, and receives approval only after that exact answer has a trusted evaluation for the same candidate.

## Covers — Story M/V IDs

- M2, M4, M5 / V2, V4, V5

## Scope

- IN: Evidence/request/answer/evaluation persistence, private operator HTTP/CLI, invalidation and backed-up schema migration.
- OUT: Production diff capture and semantic evaluator adapters, browser approval UI, authenticated pilots, delivery and the full Story's G4 acceptance.

## Constraints

- Answer submission cannot self-approve; worker text and HTTP evaluation fields cannot grant G4.
- Candidate/contract changes, cancellation and expired challenges cannot retain usable approval.

## Verify

- Same-candidate receipts, immutable diff, exact answer digest, restatement, rejection, concurrent requests, restart, transaction rollback and actual HTTP/CLI tests.
- Evidence: docs/verification/2026-09-21-g4-evidence.md
