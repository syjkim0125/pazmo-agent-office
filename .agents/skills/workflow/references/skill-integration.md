# Stage skills and role boundaries

The kit owns work-graph rules and human gates. Prefer compatible Superpowers focused skills for implementation discipline and verification, and Compound Engineering (CE) for planning, simplification, review and verified learning. The host runs agents and persists the authoritative state using the selected integration contract. Do not start a second end-to-end workflow inside a kit node.

## Select once for the assigned stage

Apply [model-selection.md](model-selection.md) before dispatch. Select from the host's permitted models for this task, including much smaller models when sufficient. Skill-internal workers inherit the same policy and limits; skill selection does not authorize a new provider or extra delegation.

Read the actual installed skill and required references before invoking it. Resolve its full name/path through the host's skill catalog; prefer the namespaced `compound-engineering:ce-*` entry when duplicates exist, unless the user selected another installation. Record the selected skill, mode and artifact path in existing task evidence, not a new registry. Similar names do not guarantee matching arguments.

Check that its mode and required tools fit the host's allowed workspace, delegation, model route, remaining budget and commit/publish permissions. A mode controls output/flow, not authorization. Return-to-caller does not automatically disable internal workers or implementation commits.

If a compatible skill is absent before invocation, use the direct stage procedure in `execution.md` and report the fallback. Do not silently install plugins or switch to a Superpowers end-to-end workflow. If an invoked skill blocks, fails or loses a required reference, preserve its partial work and return that blocker; do not launch a fallback over unknown state. Respect explicit user and host instructions.

## Role-to-stage mapping

These are skill invocation arguments, not Graph CLI flags. Invocation uses the host's normal skill mechanism. Roles select responsibility; they do not each run this entire table.

| Assigned work | Preferred skill and call contract | Return to the kit/host |
|---|---|---|
| PM: clarify behavior and propose scope | `intake.md`; use `ce-brainstorm` only for material unresolved alternatives | Canonical Story proposal or a specific question; no implementation or self-issued G1 |
| Team lead: plan approved work | `ce-plan` with an explicit caller-owned pipeline instruction and the approved Story | Plan, requirement links, confidence/review result and unresolved blockers |
| Developer: implement the assigned approved task | `superpowers:test-driven-development`; `superpowers:systematic-debugging` for unexplained failures | Changed files, applicable RED/GREEN evidence, diagnosis and blockers; return to the assigned graph |
| Verification owner: verify the submitted revision | `superpowers:verification-before-completion` | Fresh relevant commands, results, revision and limits |
| Developer: simplify after related GREEN checks | Inline simplification criteria in `execution.md`; compatible `ce-simplify-code` only within the shared budget below | Behavior-preserving changes or a justified no-change result, then affected checks |
| Reviewer: assess the submitted change | Budget-compatible `ce-code-review mode:agent base:<base-ref> plan:<plan-path>`, otherwise direct bounded review | Findings and evidence, including scope, verdict and coverage limits |
| Delivery owner: capture proven learning | Namespaced CE `ce-compound mode:non-interactive <verified-context>` when supported | One useful learning or an explicit no-lesson outcome |

For `ce-plan`, state: "Pipeline context: return the plan and review result to this workflow; the caller owns execution, human gates and the next action. Return unresolved decisions as blockers." Do not invent a `mode:pipeline` argument for a version that does not document it. Reuse an existing plan; a small reversible task can use the kit's minimal plan and direct implementation without creating a CE plan artifact solely to invoke `ce-work`.

If the user or host explicitly selects CE implementation instead, use `ce-work mode:return-to-caller <plan-path>` as an alternative executor, not an additional implementation pass. Give it an executable plan bounded to the assigned unit. Do not pass the whole project plan to a Developer assigned only one task: its completion contract covers the supplied plan. A bounded HOW artifact may reference the canonical plan and Story IDs; do not copy requirements into it. If the work is small enough to do directly, use the direct path instead of manufacturing plan files.

The reviewed local standalone `ce-compound` variant uses `mode:headless`, while the namespaced CE variant supports `mode:non-interactive` and depth selection. Use the selected installation's contract; never pass every possible alias. Its normal full capture may use research and reviewers; request `depth:lightweight` explicitly only for a bounded capture or constrained host where that supported mode is appropriate, and disclose the reduced validation. Resolve its knowledge directory once and reuse it for later retrieval (CE `docs_root` defaults to `docs`). Respect invalid-config errors rather than silently creating another knowledge store. Keep the kit's existing Story and gate artifact references intact.

Planning may already include document review. Reuse that receipt; a graph validator still checks structural validity but must not repeat the same semantic plan review without a new risk or changed input. Developer self-checks do not replace the Reviewer stage.

## Consume results, not completion claims

- A skill's `status: complete` means its invocation ended; inspect its outcome. In review JSON, `Ready with fixes`, `Not ready`, unresolved material findings or missing required coverage do not pass the review node. An empty `actionable_findings` array alone is insufficient; inspect `findings`, testing gaps and coverage too.
- Require actual commands/results and applicable verification evidence for implementation. Match review and verification to the submitted change revision; changed code invalidates affected evidence. A commit ID alone does not identify uncommitted edits.
- Preserve the returned artifact and its native result. Summarize it into the existing graph result (`output.summary`, evidence paths, explicit evaluation) only when the assigned work has a terminal pass/fail. Record a failure with actionable feedback; never reinterpret a blocked/skipped/degraded skill as success.
- Questions are not failed tests. Use the CLI `question`/`answer` transitions in `role-graphs.md`; the host transports the question and actual answer. Continue with `resumed.token` without consuming another attempt. An answer is not approval. External review feedback uses `feedback` on the affected implementation node.
- Only the delivery owner coordinates final verification, useful learning capture and G4. A review verdict, role completion or CE handoff never authorizes merge or supplies the user's gate response.

## Execution limits and review authority

Office/host assigns roles, runs agents, transports messages and owns global execution limits. All skill-internal workers and correction attempts consume those same limits. Use permitted inline execution when the selected skill supports it; otherwise return a capability/budget blocker. Never claim an inline self-review was an independent reviewer. Do not weaken an independence requirement to fit a budget or force every review to the heaviest depth.

### One review allocation

Before dispatch, the caller chooses the round's allocation and records the reason in existing review evidence. Graph review task input supplies `reviewBudget`: **default 3 agents**, 0–2 for small changes, 4–5 for specific high-risk seams. Host/user limits take precedence, including zero delegation. This is an operating default, not a measured optimum or a CLI-enforced scheduler.

- Normal round: combine correctness/security, tests/spec/runtime evidence, and maintainability/performance into three bounded assignments. Give each only the relevant diff, requirements and evidence references.
- Docs/mechanical changes: 0–1; a small behavioral change: 1–2. Add a specialist only for a named uncovered risk such as authorization or migration recovery; state why 4–5 is needed.
- Count **all** simplify/review/validation/report workers in the same round. Main performs simplification and aggregation by default. Reviewers return findings directly and do not re-delegate. New rounds need changed code or a named unresolved concern; unchanged work does not earn another full panel.
- Check the installed skill before invoking it. `mode:agent` selects output, not a worker cap. If its internal fan-out cannot fit the allocation, use the direct bounded review instead of launching it and hoping. Do not invent `max_reviewers` flags. Preserve any required independent-review coverage; report a gap if host limits prevent it.

The host enforces actual dispatch counts. Graph's ready-node width is a separate DAG limit and does not cap nested skill workers. Model choice follows `model-selection.md`; extra personas on one model are not the multi-model evidence of Pstack `interrogate`. Do not automatically append interrogate to CE review.

The Reviewer reports fixes to the Developer; do not use `apply:local` on a read-only review assignment. "Read-only" concerns product changes; allow required review artifacts only in the designated output/scratch paths. Do not invoke CE shipping, PR, babysitting, or external-model routes merely because they are installed. A user-approved route still applies within its authorized scope.

## Superpowers coexistence

Do not automatically invoke `brainstorming → writing-plans → executing-plans/subagent-driven-development → finishing-a-development-branch` inside this workflow. That adds another owner for design approval, task dispatch, review and delivery.

Use Superpowers' focused TDD, systematic-debugging and verification skills by default where available and applicable to the assigned stage. Read their actual instructions; a skill name in evidence is not proof of execution. No artificial RED test is needed for a prose-only change. Preserve existing approvals and plans, and respect higher-priority host instructions. Do not rerun a procedure already completed with sufficient evidence. Missing focused skills use the kit's direct procedure, with the fallback disclosed. This is a deliberate composition of focused skills, not a claim that the full Superpowers workflow ran. Capture reusable knowledge through CE after resolved review and fresh verification.

This reference is host instruction policy, not an SDK bridge or a code-enforced Office adapter. The kit installs this policy, not CE or Superpowers. Confirm capabilities in each actual agent environment; neither plugin's presence in the current developer session proves it is available in Office workers.

Pstack's principles and creation guide are selectively vendored with MIT notices in `pstack/provenance.json`. Read `verification.md` at setup/execution: discover/reuse the project's verification skill or guide, bind it through profile `recipe`, and drive its real journeys under SP's fresh-evidence procedure. No second orchestration or duplicate verification pass. Retrieve relevant `docs/solutions/` lessons and capture verified learning once after review and fresh checks.
