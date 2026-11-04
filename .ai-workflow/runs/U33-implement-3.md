# U33 implement, attempt 3 (verify attempt 1 fix, review attempt 2 wording)

- **Input:**
  - `.ai-workflow/runs/U33-verify-1.md`: the new kept-block test failed in `tests-3of3`, 431/432.
  - `.ai-workflow/runs/U33-review-2.md`: two wording Minors.
- **Commit:** `a4209a0` on top of `4a00f25`. Node 24.19.0. This is the node's last attempt.

## Changes

1. **`tests/runner-settings.test.mjs` `rewriteClaude`:**
   - It now writes only `<bin>/claude.sh`, the script the native shim runs.
   - It no longer copies the shim over a fake that has already run. Overwriting an executed Mach-O in place sometimes made macOS SIGKILL its next `--version` (see the diagnosis in `U33-verify-1.md`).
   - The `fakeNative` import is no longer used and was removed.
   - The helper's comment says why.
2. **`docs/verification/2026-11-03-runner-not-ready-wait.md`, "후속":**
   - Review 2 Minor 1: "관련 시험 파일 11개" no longer claims to be the complete set. It says the reviewer counted 25 files that use the changed modules, and that the full suite covers the rest.
   - A bullet on the verify failure and its fix.
   - Review 2 Minor 2: the lean Office follow-up names all three readers of the raw lean copy: the runners screen, the `LeanAgents` save checks with no model chosen, and `defaultRunnerChoice` in `chooseRunner` and `ensureDefault`. The controller checked this in `src/lean/office.ts:258-268` and `src/lean/agents.ts:107-126,146-148`.
3. **`docs/STATUS.md`:** the same two corrections, plus review attempt 2 and verify attempt 1.
4. **Learning docs:**
   - New: `docs/solutions/test-failures/rewrite-a-fake-cli-script-not-its-executed-binary.md`.
   - `docs/solutions/workflow-issues/keep-workflow-graph-evidence-files-immutable.md`: under kit 5, put review and verify result JSON under `.ai-workflow/runs/`. A stray result file elsewhere made a passing review record refuse with "Code snapshot changed". This happened in this run, and the review was recorded again with the file under `.ai-workflow/runs/`.

## RED and GREEN

- **RED:** the failing behavior was reproduced with `--test-name-pattern` on the three tests that use `rewriteClaude`, 10 processes at a time, in a throwaway worktree at `4a00f25`. 4 of 60 runs failed. In each one the second discovery's `--version` ended with `signal: SIGKILL`.
- **GREEN, same stress:**
  - With the same helper change in the throwaway worktree: 0/60 failing.
  - In this checkout after the edit: 0/60 failing, and all 60 runs had 3 of 3 passing.
- **Other `fakeNative` calls** in the tests were checked: `launcher`, `runner-discovery`, `runner-models` and `claude-controller`. Each overwrites before the fake's first run, so they are not exposed to this.

## Checks after the last edit

| Check | Result |
|---|---|
| `tests/runner-settings.test.mjs` | 22/22 |
| `npx tsc -p tsconfig.json` | exit 0 |
| `check.mjs story` | exit 0 |

The other ten related files have no change since attempt 2 (238/238 in total there). The full suite runs in `workflow-verify` attempt 2.

## Limits

- The SIGKILL cause is inferred from the signal and the pattern: it appears only after an in-place overwrite of an executed file, and goes away without it. The kernel's own log (code-signing kill) was not read.
- The limits from attempts 1–2 are unchanged.
