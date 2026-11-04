# U34 workflow-review, attempt 2 (review 1 fixes)

- **Allocation:** the same read-only reviewer as attempt 1 (resumed with its context), on the delta `a825cf8..097b384`. It said it ran as Opus 5.5 (`claude-opus-5-5`); host metadata did not confirm the model.
- **Hygiene:** it worked in a throwaway worktree at `097b384`, removed it, and wrote nothing in the checkout (HEAD `097b384`; only the untracked `.ai-workflow/runs/U34-*` files).

## Verdict

"Ready to merge: No" — only the docs block it; the code and tests of `097b384` can merge as they are. All five findings of attempt 1 are resolved. New: Important 1, Minor 3.

## Earlier findings

- Important 1 (old path could start a hooked claude): fixed in the record, STATUS:36, the D39 record line 73; test 4 fails with the lean fix reverted.
- Important 2 (team Office): fixed in `sharedDiscovery`; test 5 fails if the shared discovery stores the raw result.
- Minor 1 (no-op call), Minor 2 (job-level test), Minor 3 (D29 reading): fixed.

## sharedDiscovery change

Correct for the start `hold`, TTL and flight (both return the kept result), a failed discovery (rejects before `kept` is assigned), closing (no state), the shared object (`keptClaudeBlock` is pure), and layering (a lower copy never unblocks a received block; it can only be more cautious, residual 1).

## Important

1. **A remaining D29 hazard is missing, and STATUS:11 overstates what the engine now refuses.**
   - The engine's copy changes only on task creation, agent save, and D39's rediscovery when a runner is not ready.
   - If a hook appears while a task runs and a successful listing reaches only the lean copy (the screen, or the team Office's `runnersReady` claim check), the engine's copy still says ready, no rediscovery happens, and the next claude role job starts. No failed listing is involved.
   - PROBE4 on `097b384`: lean screen `blocked: true`; `engineJobs` gives `error: null`, jobs `["claude"]`.
   - Not caused by U34 (same before), but the same "evidence seen only by an upper copy" hole the learning doc describes.
   - Fix for U34 (docs only): scope STATUS:11 to the failed-listing case; add this residual to the record, STATUS and the learning doc. A code fix is its own task.

## Minor

1. The no-block condition (record lines 45 and 109, STATUS:20) is narrower than the code: no block is kept whenever the latest copy had none, which also covers a successful no-hook listing followed by a hook and only failed listings. Suggest "직전 사본에 막힘이 없었던 경우(성공한 조회가 없었거나, 마지막 성공한 조회에 hook이 없었음; D29)".
2. The learning doc's "(single Office has no other copy)" (line 42) is wrong: in production `createNativeOffice` is only called from `src/lean/office.ts:275`.
3. Test 5 (`tests/team-office.test.mjs:675`) lets the mutant "shared discovery stores the raw result, returns the kept one" survive (27/27). PROBE5 (alpha hooked, alpha failed, beta failed): beta `undefined` under the mutant, blocked on `097b384`. Suggest adding the second failure.

## Reviewer's commands (throwaway worktree at `097b384`, Node 24.19.0)

- 7 related files: 172/172. `tsc`: exit 0.
- Mutants: lean revert 47/51 (1–4); lean keep-return-raw 48/51 (1, 2, 4); shared store raw 26/27 (5); shared keep-return-raw 26/27 (5); shared store-raw-return-kept 27/27 (survives); lean revert on team-office 27/27 (fine).
- PROBE4 1/1 (hooked claude starts), PROBE5 1/1 on `097b384`, PROBE5 under the surviving mutant: beta unblocked.

## Controller's evaluation

Accepted. The PROBE4 path was confirmed in code: `src/runtime/runner-jobs.ts:68` rediscovers only when the install is not ready or its binary changed. A fix round follows (reset `implement`, its last attempt): scope the STATUS claim, add the residual to the record, STATUS and the learning doc, fix the no-block wording and the learning doc's single-Office line, and add the second failed listing to test 5. The engine-copy staleness itself is proposed as a separate task.
