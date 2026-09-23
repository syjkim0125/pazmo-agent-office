# Task: Inspect and accept the verified result in Office
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
An operator can inspect the exact prepared diff, submit their own G4 answer, and receive an already approved local result through the existing console.
## Covers — Story M/V IDs
M2, M4, V2, V4
## Scope
Authenticated evidence retrieval, persisted G4 question/answer display, human-only submission, local delivery and artifact location.
## Constraints
Reuse the existing evidence, approval and delivery ledgers. No browser-authored evaluation or automatic approval. Pending controller evaluation is explicit.
## Verify
V2: browser controls use supported APIs; entered answers remain exact; approved delivery shows its location.
V4: reject unverified or stale evidence, preserve drafts on uncertain writes, ignore late responses after disconnect, never auto-resubmit or auto-deliver.
