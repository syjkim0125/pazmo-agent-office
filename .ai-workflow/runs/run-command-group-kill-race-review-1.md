# run-command-group-kill-race workflow-review — attempt 1

Reviewer: an independent read-only reviewer subagent (general-purpose, Superpowers `requesting-code-review` template). It got the requirements, the commit range and the implementer's notes to check, not this session's history. `ce-code-review` was not used: the user's global instructions limit CE to `ce-compound` in this repo. The reviewer did not run the full suite (one full run at a time on this machine). It ran `tests/command.test.mjs` and `tests/team-gh.test.mjs`, and tested scratch copies of each runner version.

## Pass 1: `bf3f31c..c6c67e4`

Verdict "With fixes": Critical 0, Important 1, Minor 3.

The reviewer confirmed the cause on its own:
- A raw probe with one group SIGKILL at 30 ms left 17 `sleep` processes alive with ppid 1 and the killed group's pgid. A second group kill removed them.
- The team-gh shape gave 24 slow of 3000 runs with the old copy, all `TIMEOUT:CLI_CLOSE_UNCONFIRMED`, and 0 of 5000 with the new one.
- An instrumented copy showed GREEN came from successful re-kills, not from timing luck.
- On macOS, `kill` on a group whose only member is an unreaped zombie gives EPERM, not ESRCH. So the catch must accept any error.

Findings:
1. **Important:** the re-kill stopped at `close`. A child that escaped without holding the pipes kept running behind a plain `TIMEOUT`, and the comment ("until the group is empty") overstated what the code did. Fixed in `6ab8aa2`.
2. **Minor:** the comment should say that any kill error, including EPERM, ends the loop. Fixed.
3. **Minor:** the test created up to 500 processes. Fixed: 5 × 40, later 10 self-reaping shells.
4. **Minor:** the test guards macOS only, because Linux closes the race in fork. Noted in the test comment.

## Pass 2: `c6c67e4..6ab8aa2`

Verdict "Ready to merge: Yes": Critical 0, Important 0, Minor 4.

The reviewer checked:
- The 5 s cap held: 239 re-kills when every kill was made to succeed.
- `unref` let the process exit.
- The timer ended with ESRCH 18–37 ms after the result.
- The pid-reuse exposure did not widen, because the timer keeps going only while a kill succeeds, so the group still exists.

Findings:
1. **Minor:** with `unref`, a caller that exits right after the result left 11–13 quiet escapees in 3 of 4 runs. Fixed in `a963036`: the timer stays ref'd.
2. **Minor:** with a 30 ms timeout under suite load the shells often had not started, so the tests checked nothing, and detection was probabilistic. Fixed in `a963036`: a caller process, a 200 ms timeout and self-reaping shells.
3. **Minor:** a `Date.now()` cap could stretch if the clock steps back. Fixed: 250 tries.
4. **Minor:** the smaller shell count still failed test 1 on `bf3f31c`. No change needed.

## Pass 3: `6ab8aa2..a963036`

Verdict "With fixes": Critical 0, Important 1, Minor 3.

The reviewer found the production change correct. It also confirmed each RED/GREEN result failed or passed for the right reason, with the HEAD test file against copies of the four runner versions:

| Runner | Test 1 | Test 2 |
|---|---|---|
| `bf3f31c` | RED 3/3 | RED 2/3 |
| `c6c67e4` | GREEN | RED 3/3 |
| `6ab8aa2` | GREEN | RED 3/3 |
| HEAD | 6/6 in 3/3 runs | (counted in the 6/6) |

It also found:
- The separate-process caller works under `node --test`: type-stripped `.ts` import, no warnings, and the child's error shows when the child crashes.
- With `detached: false` (the kill never lands), the shell was still running afterwards.

Findings:
1. **Important:** the endless shell loop had no bound, so a kill regression would leave CPU-burning orphan shells. Fixed in `44a19b6`: 5000 forks per shell. Checked: with a `detached: false` copy the shells ended on their own.
2. **Minor:** one batch of 5 shells missed a regression about 1 time in 10. Fixed: 10 shells.
3. **Minor:** `execFileSync` had no timeout. Fixed: 30 s.
4. **Minor:** the comment wording about when the caller exits. Fixed.

The pass-3 fixes are test-only. They were checked by the implementer (RED on the three earlier versions, GREEN 6/6 in 3/3 runs), not reviewed again.

## Declined by the reviewer (not changed here)

- The same single group signal in `src/runners/exec-relay.ts`, `src/runners/claude-controller.ts` and `src/runners/runner-models.ts` (follow-up).
- A first kill that gets EPERM on an unreaped leader reports `:KILL_FAILED` (pre-existing).
- Processes that leave the group with setsid or setpgid (existing design).
- Remote container stop (out of `runCommand`'s scope).
- Linux behavior (no Linux host).
- Whether the original 5206 ms failure was this race: inferred, since that run's error string was not kept.
- The ref'd timer can hold a short CLI up to about 5 s when a group member cannot die (the accepted cost).
- Output buffers stay reachable for up to about 5 s (bounded).
