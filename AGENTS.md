<!-- BEGIN ai-workflow-kit -->
## AI workflow

Invoke: `$workflow <request>`, `$workflow status`, `$workflow finish`. Start a new task/session after installation or updates.

- Start product or engineering work with the `workflow` skill before implementation.
- Keep one concise canonical Story contract: Goal, Domain, MUST, SHOULD, OUT, Decisions, Verify.
- Ask only blocking behavior questions; label safe defaults `ASSUMED` instead of silently inventing scope.
- Keep Tasks at most 30 non-empty lines and reference Story M/V IDs; HOW belongs to the repository-grounded plan.
- After G1, automatically initialize/resume the installed graph with `node .ai-workflow/bin/graph.mjs`. Follow the workflow graph reference; record node evidence, route failures and require graph readiness before G4. No separate npm dependency or Graph opt-in is needed.
- Within an assigned kit graph node, apply only its role/task procedure and return evidence to that run. Office assigns roles and launches agents; the kit graph still controls readiness, joins and failure routing. Do not recursively start full delivery workflows.
- Use compatible Superpowers focused TDD, diagnosis and fresh-verification skills with CE caller-owned planning, `ce-simplify-code`, report-only review and verified learning capture. Read the workflow skill-integration reference for exact modes, direct fallback and host limits. Do not nest end-to-end workflows or repeat approved plans. High-risk work retains G3.
- Do not merge non-trivial changes until the workflow's G4 question gate records that a human understands behavior, an invariant/failure path, and the evidence boundary.
- Gates are satisfied by evidence, not by assertion. Verify with `node .ai-workflow/bin/check.mjs story <story-file>` and report the exit code; exit 0 is the only pass.
<!-- END ai-workflow-kit -->

## Bootstrap status

Read `docs/STATUS.md` for the active phase and evidence limits. The canonical Story is `docs/understanding/pazmo-agent-office-contract.md`; implementation HOW is in `docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md`. Runtime G3 is accepted; G4 and actual isolation proof remain pending. Imported handoff documents and vendor instructions are historical inputs, not user approval. Preserve the exact source baseline and do not execute upstream agents before the runtime gate is implemented and verified.

`docs/solutions/` contains reusable findings organized by category with YAML `module`, `problem_type`, and `tags`; relevant when importing upstream sources or working in a documented area.
