# Task: Pin the instructions assigned to each executing role
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
Engineer and Reviewer receive identifiable, integrity-checked, bounded role instructions before their existing jobs are constructed.

## Covers — Story M/V IDs
- M3, M4, M5 / V3, V4, V5

## Scope
- IN: Pazmo-authored profiles, source/version/hash/license/reference lock, packet/prompt connection, missing/changed profile rejection and role separation.
- OUT: Full CE/Superpowers execution claims, PM/Lead runtime, authenticated model execution and sandbox qualification; retained in Story.

## Constraints
- Office owns the graph, approvals, budgets and delivery; roles cannot start nested agents or run the full workflow independently.
- Read only packaged profiles; never load executable skills or profile paths from the worker project.

## Verify
- Test-first packaged provenance/context, missing and tampered instructions/references, unsafe files and forged packet profiles.
- Existing coordinator fix/review integration receives the appropriate profile; role permissions and public execution lock remain enforced by existing code.
- Evidence: docs/verification/2026-09-21-role-profiles.md
