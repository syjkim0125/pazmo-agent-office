# run-command-group-kill-race implement — attempt 2

Story and problem: as in attempt 1 (`.ai-workflow/runs/run-command-group-kill-race-implement-1.md`, commit `c6c67e4`). This attempt answers review pass 1's Important 1 and Minor 2–4.

Review pass 1 (Important 1): attempt 1 stopped the repeated kill in `finish`, so on `close`. A child that escaped the group kill without inheriting stdout/stderr does not delay `close`, so the command ended as plain `TIMEOUT` while that child kept running; the comment ("kill until the group is empty") claimed more than the code did. The reviewer measured 0–22 surviving `sleep 7 >/dev/null 2>&1 &` per round of 10 shells with attempt 1 (6–40 with the original code).

Change (on top of `c6c67e4`):

- `src/runners/command.ts`: `finish` now `unref()`s the repeat timer instead of clearing it, so after the result is returned the group is still killed every 20 ms until `kill` fails or 5 s have passed since the first kill. Any kill error ends it: ESRCH when no process is left, and on macOS EPERM when only the unreaped leader is left (reviewer's check). The 5 s cap keeps a process that cannot die from leaving a timer in the long-running Office; `unref` keeps it from holding a short CLI process open. The comment states this.
- `tests/command.test.mjs`: the two tests share `forkingShells(child)`, which starts 5 `/bin/sh -c` shells. Each shell prints its pid (= the group id) and forks `child` back to back (at most 40) until a 30 ms timeout. This keeps at most 200 processes per test; attempt 1 had 10 × 50 (Minor 3). The comment notes that Linux closes this race in fork, so the tests guard macOS (Minor 4).
  - "a timeout also kills a child that was being forked when the group was killed" (`sleep 5`): every result is plain `TIMEOUT`, and the batch ends within 4 s.
  - New: "a stop leaves no process in the group, even one that does not hold the pipes" (`sleep 5 >/dev/null 2>&1`): within 2 s of the results, `ps -A -o pgid=` shows no process in any of the shells' groups.

Choosing the shape (5 shells, at most 40 forks, 30 ms, scratch harness against copies of the code): the original code had 4–5 of 5 pipe-holding escapes in 6/6 batches; with `c6c67e4`, 7–17 quiet children were still in the groups 300 ms after the results in 6/6 batches.

RED, using copies of the test file that import a copy of the code:
- Original `command.ts` (`bf3f31c`): both tests failed in 2/2 runs (5044–5053 ms; 2105–2172 ms).
- Attempt 1 (`c6c67e4`): only the new test failed, in 2/2 runs (no forked child may outlive the stopped command; 2105–2145 ms).
- On the worktree before this attempt's production change: the new test failed in 3/3 runs.

GREEN:
- `tests/command.test.mjs`: 6/6 in 3/3 runs (63–70 ms and 168–200 ms), and 6/6 in 3/3 runs with 12 CPU hogs on 12 cores (69–71 ms and 238–281 ms). The only `sleep 5` processes left afterwards belonged to another session's shell polling loop (live parent, its own group).
- Original shape (`#!/bin/sh` + `sleep 5` through `runCommand`, timeouts 1–40 ms, 10 at a time): 0 slow of 2000.
- `npm run typecheck`: exit 0.
- The same 20 related test files as attempt 1: 337/337, exit 0 (one test more than attempt 1).

Review pass 2 follow-up (commit `a963036` on `6ab8aa2`; pass 2 was "Ready to merge: Yes", these are its Minors 1–3):

- Minor 1: with `unref`, a caller that exits right after `runCommand` returns (the CLI paths `src/cli/launcher.ts`, `src/cli/runtime-setup.ts`) left quiet escapees running. The repeat timer is now a ref'd local `const`; it holds such a caller about one tick normally and at most the cap when a process cannot die.
- Minor 3: the cap is 250 tries instead of a `Date.now()` deadline, so a clock change cannot stretch it.
- Minor 2: with a 30 ms timeout under suite load the shells often had not started, so the tests checked nothing. `stopForkingShells(child)` now runs the caller as its own `node --input-type=module -e` process (`execFileSync`, importing `command.ts` via `import.meta.resolve`) that exits as soon as the results are back. The shells (`exec 2>/dev/null; echo $$; while :; do <child> & kill $!; done`) fork and kill one child at a time until a 200 ms timeout. The second test is renamed "a stop leaves no process in the group, even one without the pipes in a caller that exits" and uses `sleep 5 >/dev/null`.
- RED (test-file copies against code copies, 3/3 runs each): `bf3f31c` both tests failed (5278–5464 ms; 2319–2469 ms); `c6c67e4` only the second failed (2404–2446 ms); `6ab8aa2` only the second failed (2361–2533 ms), as did the worktree before the production change (1/1).
- GREEN: `tests/command.test.mjs` 6/6 in 3/3 runs (310–319 ms and 359–369 ms); all 5 groups recorded in 20/20 batches of the new shell shape; `npm run typecheck` exit 0; the 20 related files 337/337, exit 0.

Review pass 3 follow-up (test only; pass 3 was "With fixes": Important 1, Minor 2–4, applied as the reviewer suggested):

- Important 1: the endless `while :` loop would keep forking as an orphan if a change ever stopped the group kill from landing. Each shell now stops after 5000 forks. With a `detached: false` copy of the runner (so the kill misses), the shells ended on their own 8 s after the test started.
- Minor 2: 10 shells instead of 5, since one batch of 5 missed a regression about 1 time in 10 in the reviewer's runs.
- Minor 3: `execFileSync` has a 30 s `timeout`, so a hang fails instead of stalling the suite.
- Minor 4: the comment now says the caller has nothing left to do once the results are back, so only `runCommand`'s own timers keep it alive.
- RED (test-file copies, 3/3 runs each): `bf3f31c` both tests failed (5274–5281 ms; 2318–2345 ms); `c6c67e4` only the second (2321–2336 ms); `6ab8aa2` only the second (2301–2315 ms). GREEN on the worktree: 6/6 in 3/3 runs (310–314 ms and 350–353 ms); afterwards no `sleep 5` and no test shell left.
- These test changes were not reviewed again; the verification below runs on them.

Simplification (direct kit procedure; `ce-simplify-code` not used because the user's global instructions limit CE to `ce-compound` in this repo): one helper (`forkingShells`, then `stopForkingShells`) serves both fork tests; the repeat timer became a local `const` once `finish` no longer touches it. Nothing else to simplify.

Not changed here: the single group signal in `src/runners/exec-relay.ts`, `src/runners/claude-controller.ts` and `src/runners/runner-models.ts` (follow-up). A first kill that gets EPERM because the leader has exited but is not yet reaped still reports `:KILL_FAILED` (pre-existing; reviewer's declined item).
