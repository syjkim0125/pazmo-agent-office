# Task: Connect remote Codex tools and readonly review to candidate verification

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
An isolated Engineer result becomes a frozen candidate; a separately supervised readonly reviewer supplies a bounded report for that exact candidate and contract to the required verification join.

## Covers — Story M/V IDs
- M3, M4, M5 / V3, V4, V5

## Scope
- IN: Existing remote exec transport, readonly Reviewer, structured report validation, persisted execution association, actual CLI tool and VM integration fixtures.
- OUT: Live authentication/model use, public launch, automatic coordinator, semantic G4 evaluation, delivery and real project pilot. These remain in the Story.

## Constraints
- No account credentials, host mounts, worker network, authentication fallback or VM policy changes.
- A controller exit zero, tool output, stale report or unconfirmed closure cannot substitute for a valid review.
- Existing pending authentication G3 remains pending; fixture model results are not independent semantic review.

## Verify
- Actual Codex read succeeds and candidate write fails in the readonly VM; result joins the exact candidate's test results.
- Missing, malformed, conflicting or stale reports, findings, cancellation, supervisor failure and unconfirmed closure cannot grant G4 eligibility.
- Evidence: docs/verification/2026-09-21-codex-workspace-review.md
