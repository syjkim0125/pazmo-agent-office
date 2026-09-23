# Delivery and Execution

## Assigned graph work

If a host such as Agent Office delegates a started kit node, use its run/token and perform only the assigned role's procedure below. Return evidence and feedback to that graph; do not restart the entire workflow. Office coordinates roles and communication, while the kit continues to govern the work graph. See `graph-engineering.md` for dispatch boundaries.

## Stage integration

Read `skill-integration.md` before selecting skills. Prefer Superpowers focused implementation/verification skills and CE planning/simplify/review/learning modes; keep one workflow owner. Existing approvals and the assigned role/task bound each invocation. Use the same evidence requirements with a disclosed direct fallback when a compatible skill is unavailable.

## Size first

- **Small/reversible:** one reviewable outcome, local effect. Record `Plan source: N/A — small and reversible`; use test-first implementation and review.
- **Normal:** use `ce-plan` in caller-owned pipeline context → Superpowers focused TDD/diagnosis → `ce-simplify-code` → `ce-code-review mode:agent` when compatible skills are available; simplify only after related tests pass. Otherwise perform equivalent repository-grounded stages directly.
- **High-risk/hard to reverse:** add G3. Present the key design decision, alternatives, invariant, rollback/recovery path, and evidence plan; end the turn for human approval before work. Save that decision to `docs/understanding/<slug>-plan.md` and record `Understanding gate (G3): <artifact> · <YYYY-MM-DD> · Check-in: accepted`.

High-risk signals: money/payment, authentication/authorization, concurrency, destructive migration, sensitive data, data loss, and irreversible external side effects.

## Explain the plan before G3

Lead with the human-visible change and the reason for the chosen approach. Then explain the key design decision in plain language: what is kept, what changes, why the alternative was not chosen, what must never happen, how failures recover, and what evidence will establish success. Put code symbols and file paths afterward, only where they help review.

Use one concrete scenario rather than a list of framework names. Explain each proposed Task by the behavior it delivers and how it connects to the next Task, not just the repository or layer it touches. Keep already-approved decisions visible without asking for them again; ask only for a new material decision. This explanation belongs to the existing plan and G3 checkpoint, not an extra document or gate.

This is pre-implementation explanation. It does not reveal the implementation answer during G4; follow that gate's prediction-before-reveal sequence.

## Task rule

Create Tasks only when the approved Story cannot be reviewed as one PR. Each Task has one independent outcome, references Story M/V IDs, stays within 30 non-empty lines, and contains no speculative implementation choreography. **HOW belongs to the repository-grounded plan.**

## Execute

For user-authorized optional Jira publication after G1, follow `jira.md`. Without a connector or authorized target, produce a preview only; the Story remains canonical.

1. Read the approved Story, relevant code, tests, repository instructions, and prior learnings.
2. Make a plan that maps every M/V ID to code and evidence. Do not create a second requirement source.
   Automatically initialize/resume the installed graph as described in `graph-engineering.md`. Use `-` for small work; otherwise supply the reviewed task DAG. The CLI adds final review and fresh verification. Complete any required G3 before implementation nodes run.
3. Use compatible `superpowers:test-driven-development` for implementation and `superpowers:systematic-debugging` for unexplained failures. For new behavior or a bug fix, demonstrate RED before production code, then GREEN after the minimum change. Proceed when related tests pass.
4. Refactor while green: perform the simplification pass below. If `ce-simplify-code` is available, read its `SKILL.md` and execute it; naming the skill is not execution. If unavailable, apply the same criteria below directly; do not require installation or stop the workflow.
5. Review the final diff after simplification against the Story, including failure paths and what tests do not prove. Use `ce-code-review mode:agent` when available; let its risk-based scope choose depth and resolve material findings. Do not apply fixes from a read-only review assignment.
6. Apply compatible `superpowers:verification-before-completion`. Revalidate affected behavior after simplify/review edits before G4. If review edits affect previously simplified code, recheck only the affected scope; do not restart the whole pipeline automatically. Broaden tests when impact warrants it; never claim old results cover new edits.
7. Record the evidence in the graph, run its `status` command, and require `action: g4` before continuing to `understanding-gate.md`; passing tests alone are not completion.

## Simplification pass

- Review is a default part of refactoring, not a change quota: no changes is a valid result when no clear benefit exists. Documentation-only or mechanical changes may need no code simplification; follow the skill's preflight.
- Limit scope to the current task's changed code and necessary related seams. Avoid unrelated refactoring, new abstractions or packages, and edits made just to fill a diff.
- Reduce duplication, unnecessary state, branches and complexity to improve understanding. Fewer lines or replacing `for` with a stream is not evidence of improvement; chaining operations does not necessarily reduce traversals. Check actual iteration and evaluation behavior before claiming efficiency.
- Preserve behavior, result order, side effects, domain boundaries, failure handling and safety checks. A proposal that changes them belongs to the existing design or scope-change process, not a silent simplification.
- Follow the invoked skill and applicable repository/runtime instructions for execution and agent use; this kit sets no fixed agent count. Do not copy the skill's orchestration into this workflow.
- Include changes (or no-change outcome), review scope and fresh checks briefly in existing review/verification evidence. Add no separate approval gate, mandatory document or Jira Task.


## Graph planning and execution

Graph execution is installed and used automatically after G1. Small changes use the built-in minimal plan without a separate plan document; split larger work only where dependency tracking or independent verification helps. Keep the size-based route above: no planning ceremony for a small/reversible change.

Planning is repository-grounded planning → review → deterministic validation. Research code, tests and risks as needed; do not require separate analyzer, advocate or mediator agents. Reuse an existing `ce-plan` result. The host performs agent/tool work and the installed CLI owns readiness, evidence records and recovery; never create a second nested orchestration pipeline for the same task.

The execution graph does not replace human gates. G1 still approves scope before planning/implementation, G3 still protects high-risk choices, and G4 still requires prediction-before-reveal. Superpowers focused skills and CE stage skills provide node behavior as mapped in `skill-integration.md`; the graph owns dependency and retry structure rather than copying those skills.

After each node, explicitly evaluate and record its evidence. Route failed checks to `fix`, changed assumptions to `replan`, and unresolved human decisions to `human`. For fixes within an unchanged plan, reset the earliest affected node and its descendants, preserving independent completed work. Changed plans/requirements require a new validated run; do not transplant stale evidence. Three attempts exhaust the run's retry allowance. Never silently create a new run to evade a stop. See `graph-engineering.md` for the executable protocol.

## Capture verified learning

After review findings are resolved and fresh verification passes, use the compatible non-interactive `ce-compound` mode in `skill-integration.md` to capture a reusable lesson in the resolved knowledge directory (default `docs/solutions/`). Otherwise record the proven cause, correction and prevention rule in the same directory directly. Skip the file when there is no reusable lesson; state that briefly. Read relevant prior lessons before later work. This is retrieval of project knowledge, not model retraining.

Capture once at the useful task boundary; do not make every role duplicate the same lesson. Learning records cannot replace G4 or turn an unverified hypothesis into a fact. For delegated work, return the lesson candidate to the delivery owner for consolidation.
