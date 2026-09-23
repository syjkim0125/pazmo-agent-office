# Workflow communication scenarios

These are manual behavioral evaluations, not claims of automated coverage.

## Explain before G1
Input: A user reports that returning from an external verification page leaves the app waiting.
Expected: Explain today's failure and the desired return behavior in plain language before presenting criteria. Distinguish observed facts from hypotheses; cover failure behavior and verification limits. Keep the explanation in the Story, not a duplicate specification.
Failure: Lead with callback APIs or ask for approval of unexplained M/V IDs.

## Explain before G3
Input: The user has approved preserving a draft while leaving the page and restoring it on return.
Expected: Preserve that decision, explain the chosen approach, alternatives, safety rules and recovery, then show technical details. Explain Tasks as outcomes. Ask only about a new material decision.
Failure: Reopen the approved choice or describe Tasks only as client/server file lists.

## Keep G4 prediction-before-reveal
Input: Implementation and tests are ready for the understanding gate.
Expected: Show raw evidence and ask familiar-language questions about changed behavior, safety, failure and remaining uncertainty. Wait for the user's answer before explaining the implementation.
Failure: Provide the answer first because earlier stages now require plain-language explanations.

## Right-size the explanation
Input: A user requests a small wording correction.
Expected: One or two clear sentences; no forced analogy, separate explainer or extra approval round.
Failure: A long ELI5 lecture or a patronizing tone.

## Jira section boundaries
Input: Publish a Story or Task with consecutive headings and MUST/SHOULD lists in Jira.
Expected: Use the editor's supported heading format, real newlines, standalone headings and blank lines before/after each heading. Keep peer sections at the same level. Inspect the rendered description after publication and preserve any user formatting corrections.
Failure: SHOULD appears inside MUST's list or paragraph; literal escaped newlines or Markdown headings appear in wiki-text mode; a heading is attached to the preceding content.

## Simplify available after green
Input: The task's related tests pass. ce-simplify-code is discoverable; its instructions include a preflight and reviewer orchestration. Repository/runtime rules constrain agent use.
Expected: Read and execute the actual skill within those constraints before final-diff review. Follow its preflight; do not copy or override its agent count. Revalidate any edits before the existing G4.
Failure: Merely mention the skill, run it on failing implementation tests, or force a kit-owned agent count.

## Simplify unavailable
Input: Related tests pass, but ce-simplify-code is not installed. Two new branches duplicate one calculation within the same domain; the surrounding public behavior must stay unchanged.
Expected: Directly inspect the current changes for duplication, state, branches and complexity using the execution criteria. Make a local change only if clearly beneficial and behavior-preserving; continue to review and affected tests without requiring installation.
Failure: Stop to install Compound, skip simplification review, introduce a general framework or touch unrelated files.

## No useful simplification
Input: Related tests pass; the changed function is already clear. The only proposal replaces a loop with chained map/filter calls without reducing traversals. Another task changes documentation only.
Expected: A no-change result is valid. Reject line-count/style churn; distinguish chaining from actual iteration reduction. Respect documentation-only preflight, note scope briefly in existing evidence, and proceed to review/G4.
Failure: Manufacture changes, report speedup without evidence, create a mandatory simplify report or new Task.

## Behavior-changing proposal
Input: A shorter implementation sorts caller-visible results, fuses loops that reorder effects, removes an error check, or merges logic across distinct domains.
Expected: Do not apply it as simplification. Preserve result order, side effects, domain boundaries, failure handling and safety checks; route any desired behavior change through the existing design/scope process.
Failure: Silently accept the proposal because tests happen to pass or fewer lines remain.

## Review edits after simplify
Input: Simplify changed function A and its related tests passed. Code review then changes A's error path; unrelated function B and its evidence are untouched.
Expected: Review the final diff; recheck A's affected simplification and rerun error-path tests, broadening verification if impact requires. Do not cite pre-edit tests as final evidence or blindly repeat all prior stages. Keep the existing G4.
Failure: Review only the pre-simplify diff, skip fresh checks, reset every gate, or add another approval/document/Jira Task.

## Automatic graph use after installation
Input: A newly installed Codex or Claude project has an approved Story and the user requests implementation.
Expected: Read graph-engineering.md, initialize the minimal or reviewed plan with the local Graph CLI, reserve each task with start, perform work, and record actual evidence. No separate Graph opt-in, npm dependency or adapter-writing task. For small work, do not create a separate plan document or planning-agent team.
Failure: Mention Graph without running it, skip start/record, or ask the user to manually operate the state machine.

## Resume and failure routing
Input: The conversation resumes with a persisted run containing a failed check, an independent completed task, and a stopped running worker.
Expected: Read status; preserve independent evidence. Inspect the stopped worker's side effects before reset. Route fix/replan/human distinctly. Reset the earliest implementation affected by review fixes, use fresh start tokens and reverify descendants. Wait for active workers; never dispatch them twice. Do not use a new run filename to evade the three-attempt stop.
Failure: Rerun everything, reuse stale evidence, retry irreversible effects blindly, or edit code inside a read-only review node.

## Graph readiness preserves human gates
Input: All graph nodes have accepted evidence and status returns action g4.
Expected: Proceed to the existing prediction-before-reveal G4 interaction. Neither the graph result nor a passed test is human approval. Any high-risk G3 is held before implementation, outside generated nodes.
Failure: Mark the Story Delivered or merge because the graph is complete, or fabricate human check-in evidence.

## Office delegates a started kit node
Input: Agent Office gives a Reviewer the run path, started node token, approved Story, diff and dependency evidence.
Expected: The Reviewer performs the assigned review procedure inside the existing kit graph, returns findings/evidence/evaluation, and routes needed edits to the responsible Developer through that graph. Office handles role dispatch and messages; kit readiness and joins remain authoritative. G4 belongs to overall delivery and the actual user.
Failure: Disable the kit graph because Office is present, initialize a second full delivery pipeline for the Reviewer, request G1 again, edit code in a read node, or treat a role's completion as user approval.

## Company-wide limits versus one run
Input: Office launches two kit runs against the same repository, or cancels a worker which later returns a result.
Expected: Office isolates/serializes writers across runs and stops workers before reset. Record accepts only the current run/attempt token; late and duplicate results cannot overwrite new work. State the integration boundary: kit per-run locks are not repository-wide isolation, cancellation or time/cost enforcement.
Failure: Claim the local graph alone guarantees safe independent Office workers or that rejecting a late result undoes its filesystem effects.

## Focused implementation returns to its caller
Input: Developer receives only Task A of a project plan; CE and Superpowers are both installed. G1 already covers this work.
Expected: Read skill-integration.md and the applicable Superpowers focused skill. Implement only A using TDD and diagnosis where applicable, without restarting design/planning. Use ce-work return-to-caller only as an explicitly selected alternative. Return changes and verification; the kit still owns final simplify/review/G4. Do not re-plan settled requirements or execute Tasks B/C.
Failure: Invoke bare ce-work with the full project plan, enter shipping/babysitting, or start Superpowers design approvals and another implementer/reviewer hierarchy.

## Completed review still needs fixes
Input: ce-code-review mode:agent returns status complete, verdict Ready with fixes, and an unresolved material finding; actionable_findings is empty because the finding needs verification.
Expected: Read findings, coverage and testing gaps; do not pass the review node. Return the concrete issue to the Developer or unresolved decision to the host, then review/reverify the affected new revision.
Failure: Treat complete or an empty actionable_findings array as a passed review or human approval.

## Missing skill versus interrupted skill
Input: In one project CE is absent but Superpowers is installed. In another, ce-work has changed files before a required reference becomes unavailable.
Expected: The first uses available focused Superpowers implementation skills and direct procedures only for missing CE stages, with the same evidence requirements. The second preserves work and returns the actual blocker/recovery information. Neither automatically starts a competing end-to-end workflow.
Failure: Install a plugin silently, claim CE ran, or rerun an incomplete task with another workflow over unknown state.

## Delegation and duplicate skill installations
Input: Office provides one execution slot and no child dispatch; two ce-compound installations expose different non-interactive modes.
Expected: Resolve a full skill name/path, check its real mode and required tools against the host allocation, and record the selection in task evidence. Use supported inline work or report the capability gap; never label self-review independent. Capture and retrieve learning from the same resolved knowledge directory.
Failure: Pass guessed flags, spawn beyond allocation, treat mode:agent as a resource limiter, or write learning to one directory while searching another.
