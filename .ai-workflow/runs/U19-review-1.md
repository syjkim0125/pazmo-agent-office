# U19 workflow-review attempt 1: lean rerun of a stopped task

Reviewer: an independent read-only subagent (superpowers requesting-code-review template). It got the approved decision (`docs/understanding/lean-rerun-decision.md`) and the diff, not this session's history.

## Round 1 (base `1e7883e`, changes before the fixes)

- Reviewer's own checks: lean 4 files 133/133, `npm test` 938/938, typecheck 0, story check 0, `git diff --check` clean.
- Verdict: Critical 0, Important 0, Minor 6, "With fixes (Minor only)".
- Minor findings and what was done:
  1. Stop state checked only before the runner wait. Fixed: `checkRerun` (ALREADY_RERUN, NOT_STOPPED) runs again inside the transaction that stores the task and its link. New test went RED first.
  2. Missing tests: accepted-then-start-failure (added; passes, pins decision table row 4). app.js source-regex tests: declined (would assert source text; branching is in tested view.js; wiring checked in a real browser).
  3. Verification note blanks: filled with fresh results.
  4. Log title re-read the task row: now uses the validated title returned by createTask.
  5. `previous_id` without ON DELETE: comment added (a rerun task is never removed).
  6. Irreversible-cancel note not announced: `aria-describedby` on the rerun dialog.
- Declined-to-judge items (engine scope or user choice): replanning instead of resume (option A), unknown leases and slots after cancel, orphan process after a held dispatch, partial cancel of subtasks, same-title cards, second-resolution log timestamps, eevee-be real check.

## Round 2 (base `187431a` after moving onto main, the fixes only)

- Critical/Important: none. No regression found. Checked that nothing called inside the transaction refuses an active transaction (nested calls use SAVEPOINT).
- Nit: unbounded wait loop in the race test. Declined: same pattern as the existing stop race test in the file; a hang does not pass falsely.
- Verdict: mergeable given the full run passes (G4 separate).

## Limits

The review did not run the eevee-be Office and did not judge the engine's recovery (option B).
