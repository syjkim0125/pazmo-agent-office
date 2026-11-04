# U33 implement, attempt 2 (review attempt 1 fixes)

- **Input:** `.ai-workflow/runs/U33-review-1.md`, Minors 1–4. Minor 5 (lean Office cache) is outside this change. It is written down as a follow-up in STATUS and the change record. Minor 6 is handled by `workflow-verify`.
- **Commit:** `4a00f25` on top of `09e1a2c`. Node 24.19.0.

## Changes

1. `docs/verification/2026-11-03-runner-not-ready-wait.md` line 14: "프로세스를 띄우기 전에" changed to "역할의 실행기 프로세스를 띄우기 전에". Item 5's list of places now names that line too.
2. The related test set is now described as 11 files: the files that use the changed modules directly or indirectly, including `completion` and `intake-publication`. The count is updated in STATUS and the change record.
3. The uncovered gap is restated in STATUS, the change record and the learning doc: any change at `createLiveRuntime`'s `roleJobFactory` call that drops or overrides `rediscover`, such as passing the fields one by one or `rediscover: undefined` after the spread.
4. `tests/runner-settings.test.mjs`:
   - "a claude that cannot list its hooks is blocked too" now asserts `blocked === "hook 목록 없음"` and the exact hint.
   - The kept-block login test loops over both block kinds (a listed hook, and a hooks-listing error). It checks that the kept `blocked` equals the first discovery's, and that the kept hint equals a fresh listing's for the current login.

STATUS also records review attempt 1's result and the lean Office follow-up.

## Checks

The tests check behavior that already held, so they were checked against mutants (`node --experimental-vm-modules --test --test-reporter=tap tests/runner-settings.test.mjs`):

| Run | Result |
|---|---|
| current code | 22/22 |
| H: `hookBlock` always uses the listed-hooks text (the reviewer's uncaught mutant) | 21/22, "a claude that cannot list its hooks is blocked too" fails |
| H2: only `keptClaudeBlock` rebuilds the unlisted kind with the listed-hooks text | 21/22, the kept-block login test fails |

Both mutants were reverted, and `git diff --stat src/` was empty afterwards.

Related test files, fresh, one at a time, after the last edit:

| File | Result |
|---|---|
| completion | 43/43 |
| intake-publication | 11/11 |
| live-runtime | 17/17 |
| lean-office | 47/47 |
| native-story-task | 19/19 |
| native-office | 18/18 |
| runner-account | 9/9 |
| runner-settings | 22/22 |
| runner-jobs | 17/17 |
| team-office | 26/26 |
| team-gate | 9/9 |
| **Total** | **238/238** |

`npx tsc -p tsconfig.json`: exit 0.

## Limits

These are unchanged from attempt 1:
- only fake CLIs were used
- the `rediscover` override or omission at the `createLiveRuntime` call is still uncovered
