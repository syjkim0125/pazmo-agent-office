# runner-group-kill-race v3 · implement (attempt 2)

This attempt answers `workflow-review` attempt 1 (pass 2, `.ai-workflow/runs/runner-group-kill-race-v3-review-1.md`, routed `fix`). It changes docs only. Code and tests are as committed in `d46cfba`, `dfb171d` and `d05d554`. The edits stay uncommitted until after verify, because kit 5's snapshot includes HEAD.

A second session made these edits: the first hit its account's usage limit during pass 2.

## Edits

- `docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md`:
  - **Finding 1:** drops the stale line number for `detached: true` (now `command.ts:70`), as the rest of the doc does.
  - **Finding 3:**
    - Only a claude role run's cancel or timeout, and model discovery after it closes stdin, send SIGTERM first. Refused stops and stops after the CLI exited SIGKILL at once (matches STATUS 2026-10-28).
    - The timing note now cites what was measured: fakes reached end of input 0.17–0.2 s apart. At SIGTERM the first had done 1422–1695 of 5000 passes (load average 5–8). After dfb171d it is 0–14 passes (pass 2's probe). This replaces the unsupported "1.6–2.1 s".
- `docs/STATUS.md`:
  - **Finding 3:** the same SIGTERM scope.
  - **Finding 2:** the 364/364 count is labelled as measured before the rebase (`43c81f1`), and the final counts are pointed at the v3 run's verify record.
  - A line for review pass 2.

## Deferred to delivery (finding 3)

- The solutions doc's "followed on branch `claude/runner-group-kill-race`" line gets the PR number in the G4 delivery commit.
- The run files under `.ai-workflow/runs/runner-group-kill-race*` are committed with the kit record, as #67 did (`9e3dfa8`, `46f686e`).

## Checks

Docs only. No source or test file changed since attempt 1 (`git diff --stat HEAD` lists only the two docs). Full checks run in `workflow-verify`.
