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
