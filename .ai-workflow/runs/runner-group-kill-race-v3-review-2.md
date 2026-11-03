# runner-group-kill-race v3 · workflow-review (attempt 2)

- **Reviewer:** read-only `general-purpose` subagent (requested model `sonnet`; actual model not confirmed by host metadata). It ran no tests: the change is docs only.
- **Scope:** the uncommitted doc edits of implement attempt 2 (`git diff HEAD -- docs/`: two files, 6 insertions, 5 deletions). Context: `.ai-workflow/runs/runner-group-kill-race-v3-review-1.md` and `-v3-implement-2.md`.
- **Verdict:** "Ready: With fixes". Blocking 0, Minor 2, nits 2. All of them are STATUS wording.

## Confirmed

- Only the two docs changed, and only the hunks implement attempt 2 describes.
- `detached: true` is cited without a line number. It is at `src/runners/command.ts:70`.
- **SIGTERM scope** (solutions doc :63, STATUS :9):
  - claude-controller `stop` (:80-91) sends SIGTERM only for `CANCELLED`/`TIMEOUT` while the CLI runs. Every other reason, and any stop after exit, gets SIGKILL at once.
  - runner-models `stop` (:133-141) closes stdin, waits 3 s, sends SIGTERM, waits 12 s, then sends SIGKILL.
  - STATUS 2026-10-28 uses the same "Office refuses" set.
- **Timing sentence** (solutions doc :84): every number traces to a recorded note.
  - 0.17–0.2 s: review-1:37, implement-1:25.
  - 1422–1695 passes at load average 5–8: review-1:38.
  - 2.22 s: review-1:38.
  - 44 ms: v3-implement-1:24.
  - 0–14 passes: v3-review-1:15.
- The 364/364 label (pre-rebase `43c81f1`) matches `runner-group-kill-race-implement-1.md:44`.
- No internal host or organization names.

## Findings

1. **Minor:** STATUS :14 points at the v3 run's verify record, which does not exist yet. It holds only if verify records before the commit. The plan already requires that, so no edit.
2. **Minor:** STATUS :16 has two gaps.
   - The fix list omits the replaced timing figure.
   - The two items deferred to delivery (the solutions doc's branch line, committing the run files) are not under "남은 것".
3. **Nits:**
   - STATUS :9 could say discovery sends SIGTERM only if claude is still running 3 s after stdin closes.
   - STATUS :16 could say the reviewer who was cut off had started pass 2, not pass 1.

## Routing

Recorded as passed. All findings are STATUS wording, and STATUS is edited again in the G4 delivery commit (the G4 line and the PR number). kit 5 makes any tracked edit after review start stale, and each node has three attempts. So the wording fixes for findings 2 and 3 go into that delivery commit, as U30 did for a late wording fix (`docs/solutions/.../keep-workflow-graph-evidence-files-immutable.md`, kit 5 section). No behavior, test or measurement claim is affected.
