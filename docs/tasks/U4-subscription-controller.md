# Task: Connect the approved subscription controller to bounded Office roles

Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md
G3: docs/understanding/remote-controller-auth-decision.md

## Outcome
The trusted Mac controller uses the approved existing Codex login while role tools remain in the dedicated VM and existing Office ledgers own results.

## Covers — Story M/V IDs
- M3, M4 / V3, V4

## Scope
- IN: Pinned native controller/model metadata, bounded per-process profile, real CLI boundary qualification, internal opt-in job adapter, actual readonly PM/Lead smoke on Office documents.
- OUT: Public launch, Engineer feedback/fix pilot, human G4, delivery and full product qualification. Those remain required by the Story.

## Constraints
- No worker credentials, local tool fallback, automatic provider/model substitution, global configuration changes or AppArmor exception.
- Fixture tool tests and actual model reports are distinct evidence; neither creates user approval.
- Current-machine qualification does not authorize arbitrary controller versions, model catalogs or managed policies.

## Verify
- Changed binary/catalog or invalid remote address is rejected; cancellation and remote failure cannot freeze a candidate.
- Actual CLI tools cannot access fake host secrets, inherit controller environment, reach external network or mutate the readonly reviewer candidate.
- Actual PM/Lead output passes Office schemas and transitions without fabricated responses or approvals.
