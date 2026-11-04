# U35 implement, attempt 2 (review 1 fixes)

Reset reason: review 1 (`.ai-workflow/runs/U35-review-1.md`) Minors 3–5.

## Changed files (since attempt 1)
- `src/runtime/runner-jobs.ts`: after the rediscovery, `if (signal.aborted) return refused("CANCELLED")`, so a job cancelled while the (non-abortable) discovery ran ends as CANCELLED without qualification, instead of `RUNNER_NOT_READY` or a qualify call with an aborted signal. Applies to every rediscovery (claude D40, not-ready D39).
- `tests/runner-jobs.test.mjs`: the hook-refusal test runs pm, lead, engineer and reviewer (4 discoveries); new test "a claude job cancelled while its rediscovery runs is refused as CANCELLED, before qualification (D40)" for a fresh ready and a fresh blocked claude.
- Docs (not evidence): verification record and STATUS (counts, cancel, in-flight sharing, team TTL/hold, non-abortable discovery).

## RED
- `tests/runner-jobs.test.mjs` with the new cancel test, before the src change: 20/21; the ready case gave qualify 1 (expected 0). With the cases' order swapped (temporary copy, deleted): the blocked case gave `RUNNER_NOT_READY claude: remove the hook` (expected `CANCELLED`).
- The pm/lead loop: the review-1 mutant "skip the rediscovery for pm and lead" now fails (74/75) instead of surviving (74/74).

## GREEN
- Related files (runner-jobs, lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office, live-runtime, runner-account): 222/222. `npm run -s typecheck` exit 0.
- Mutant "drop the abort check": 74/75 (the cancel test). Restored byte-for-byte.

## Simplification
- One guard inside the existing rediscovery block; nothing further.
