# run-command-group-kill-race v3 · implement (attempt 1)

The change is unchanged since its kit 4.1.0 records:
- `.ai-workflow/runs/run-command-group-kill-race.json`: implement, three review passes, verify.
- `.ai-workflow/runs/run-command-group-kill-race-merge.json`: after main #62–#66.

Those runs became read-only when main #65 (kit 5) was merged in (`91a4b8c`; the only conflict was `docs/STATUS.md`, resolved keeping both entries). This v3 run re-records the change on the current Story and re-runs review and kit verification.

- Code: `src/runners/command.ts` and `tests/command.test.mjs`, byte-identical to `44a19b6`. Diagnosis, RED/GREEN and the fix's design are in `run-command-group-kill-race-implement-1.md` and `run-command-group-kill-race-implement-2.md`.
- Story: G1 re-bound to the Story with D36, D37 and D38 (`.ai-workflow/approvals/pazmo-agent-office-g1.json`, the user's answer "A. G1 승인 후 진행"), commit `0e57363`. This change's Story text is unchanged.
- Scope against main `1047da4`: `git diff --stat origin/main...HEAD` lists this change's files only.
