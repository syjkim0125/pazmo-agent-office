# U32 implement, attempt 2 (D39)

Run `.ai-workflow/runs/U32-runner-not-ready-wait.json`. This attempt answers `workflow-review` attempt 2 (`.ai-workflow/runs/U32-review-1.md`, routed `fix`). Base unchanged: uncommitted diff on `1047da4`.

The session that started this attempt hit its account's usage limit after the code and test fixes. A second session finished it from the hand-over (mutation checks, docs, this record). The code and tests are as the first session left them; the second session changed only docs.

## Review fixes

- **P2, a failed claude hook listing unblocks a hooked claude.** `src/runtime/runner-settings.ts`: `keptClaudeBlock` keeps an earlier block on the same binary (same `sha256`, still `ready`) when the new discovery listed no claude models. A listing that goes through decides again.
- **P3, a rejected rediscovery ends `closed:false`.** `src/runtime/runner-jobs.ts`: the rejection is logged and the last discovery stays. A not-ready runner is then refused cleanly before any process starts.
- **P2, real refresh wiring untested.** `tests/lean-office.test.mjs`: the engine's copy sees claude logged out, the person logs in, and the Engineer runs through the real `RunnerSettings.refresh()`.
- **P2, refusal format not tied to the parser.** `tests/runner-jobs.test.mjs`: `runnerNotReady(out.result.error)` reads the real refusal.
- **P2, `not_ready` in `claim.waiting` untested; LOCAL-PREVIEW text.** `tests/team-store.test.mjs` asserts `waitingOf(...).kind`. `docs/LOCAL-PREVIEW.md` lists `not_ready` and says its message is the Office's hint.
- **P3, missing tests.** `tests/runner-jobs.test.mjs`: no rediscovery when ready and unchanged. `tests/team-executor.test.mjs`: the hint stays out of the next Engineer contract for `not_ready`.
- **P3, docs.** The change record drops the unsourced "1–2 s" and states the limits the reviewers raised: review-stage waits re-run the Engineer, `since` carries across kinds, the discovery runs inside the 240 s supervise timer, and two Story phrases ("몇 초", "켤 때·업데이트 때만") are inferred or hold for the team Office only. STATUS says the same. The Story text is unchanged.

## RED (new behavior)

`node --experimental-vm-modules --test --test-reporter=tap tests/runner-jobs.test.mjs tests/runner-settings.test.mjs` before the code fixes: tests 36, pass 34, fail 2.
- "a discovery that fails ends in a clean refusal from the last one…"
- "a refresh that could not list claude's hooks keeps the block…" (`undefined`/`준비됨` instead of the SessionEnd hook block and its hint)

## Mutation checks (tests over code written in attempt 1)

Each mutation was applied to one source file, the named tests run, and the file restored. Afterwards the worktree diff was byte-identical to a backup taken before the checks.

| Mutation | Tests | Result |
|---|---|---|
| A. rediscover only on a changed binary (the old condition) | runner-jobs `D39`; lean-office `D39` | 2/4 fail; 1/1 fail |
| B. rediscover on every run | runner-jobs `D39` | 1/4 fail ("ready and unchanged is not discovered again") |
| C. store drops the `not_ready` kind | team-store "setPhase records the runner wait…" | 1/1 fail |
| D. `storyOutcome` ignores the run error | native-story-task `D39` | 1/1 fail |
| E. `live.ts` loses its `rediscover` wiring | lean-office `D39` | **passes** (1/1) |
| F. the executor passes the wait message to the next Engineer | team-executor `D39` | 1/1 fail |
| G. `waitingOf` hides `not_ready` | team-store "setPhase records the runner wait…" | 1/1 fail |

E survives because the lean-office helper `engineJobs` copies the `live.ts` line instead of calling it. The gap predates D39, and D39 does not change that line. The change record states it.

## GREEN

`node --experimental-vm-modules --test --test-reporter=tap tests/runner-jobs.test.mjs tests/runner-settings.test.mjs tests/runner-account.test.mjs tests/native-story-task.test.mjs tests/team-store.test.mjs tests/team-executor.test.mjs tests/lean-office.test.mjs` → exit 0, **183/183**. `npm run typecheck` → exit 0. Both rerun after the docs were finished.

## Simplify

Inline review of the two fixes (+20 lines in `runner-jobs.ts` and `runner-settings.ts`): `keptClaudeBlock` is one guard and one spread; the rediscovery catch is a single fallback. No change.

## Limits

Touched files only; the full suite runs in `workflow-verify`. No real logged-out, missing or blocked CLI ran through a team Office (V18 says so).
