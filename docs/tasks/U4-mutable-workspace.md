# Task: Run an assigned workspace job in the VM and recover its result

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
An assigned Engineer job modifies a private VM copy; only a successfully closed job with a validated result can produce the handoff's verification candidate.

## Covers — Story M/V IDs
- M3, M4, M5 / V3, V4, V5

## Scope
- IN: Writable VM copy, stopped-writer export, bounded host receiver, execution/handoff connection and actual readonly re-verification.
- OUT: Authenticated Codex model/tools, Reviewer, automatic Office scheduling, G4 semantic evaluation, delivery and real project pilots.

## Constraints
- No host bind mounts, account credentials, network access or public execution endpoint.
- Readonly verifier behavior remains separate; invalid output must preserve controller staging and the user's checkout.
- Unconfirmed closure or rejected supervisor promises cannot supply a verification candidate.

## Verify
- Actual VM edit/delete/fail/path-escape/FIFO/timeout/cancel scenarios, cleanup inventory and existing readonly scenarios.
- Evidence: docs/verification/2026-09-21-mutable-workspace.md
