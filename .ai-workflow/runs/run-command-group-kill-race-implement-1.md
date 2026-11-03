# run-command-group-kill-race implement — attempt 1

Story: `docs/understanding/pazmo-agent-office-contract.md` (M3/M4: a runner that times out or is cancelled must not end as if it completed, and stop paths must really stop; M16: the team Office's `gh` login check). Plan source: N/A — small and reversible. No Story change.

Problem: `tests/team-gh.test.mjs` "a gh that hangs times out" failed once in a full run (5206 ms against 4000 ms; `reason: "timeout"` held). Diagnosis on Node 24.19.0 (libuv 1.52.1), macOS 26.2 (Darwin 25.2.0):

- Load alone does not do it: a sampler of the same call during one full `npm test` (1276/1276) plus a loop over the two test files that overlapped the failure gave 0 slow of 813 (worst 295 ms); with 24 CPU hogs 0 slow of 30 (worst 951 ms).
- Moving the kill onto the moment `/bin/sh` forks `sleep` does it. A probe with the same spawn and kill as `runCommand` (timeouts 1–40 ms, 10 at a time) gave 122 slow of 10000. In every one the shell died of SIGKILL right after the kill (`exit` at the timeout + 0–56 ms, `kill` returned no error), and 300 ms later a `sleep 5` with ppid 1 and the killed group's pgid was still running. A process still being created when `kill(-pgid, SIGKILL)` lands misses it and holds stdout/stderr, so `close` waits for its 5 s and `runCommand` ends with `TIMEOUT:CLI_CLOSE_UNCONFIRMED` after the 5 s grace (seen with `runCommand` itself: 1 of 300 at a 20 ms timeout, 5025 ms).
- In the failed full run the shell's start was presumably delayed by load until about 200 ms, so its fork met the 200 ms timeout: 200 ms + 5 s ≈ 5206 ms. That run's `result.error` was not kept, so this last step is inferred from the matching time, not observed.

Change:

- `src/runners/command.ts`: after the first group SIGKILL succeeds, `stop` repeats it every 20 ms until `kill` fails (ESRCH: the group is empty) or the result is finished (`finish` clears the interval). The 5 s grace and its `CLI_CLOSE_UNCONFIRMED` stay for a process that still does not close. Applies to every stop reason (`TIMEOUT`, `CANCELLED`, `OUTPUT_LIMIT`).
- `tests/command.test.mjs`: "a timeout also kills a child that was being forked when the group was killed". Ten `/bin/sh -c` shells at once fork `sleep 5` back to back (at most 50 each) and time out at 30 ms; every result must be plain `TIMEOUT` and all must end within 4 s.

RED (before the production change): 3/3 runs of `tests/command.test.mjs` failed only the new test (4/5 pass), 5051–5094 ms, results `TIMEOUT:CLI_CLOSE_UNCONFIRMED`. While choosing the shape, 6/6 batches of 10 such shells had escapes (4–10 of 10).

GREEN: `tests/command.test.mjs` 5/5 in 3/3 runs (new test 62–73 ms), no `sleep 5` left afterwards. `npm run typecheck`: exit 0. The 20 test files that import `runCommand` or a caller of it (`candidate-diff`, `codex-controller`, `codex-profile`, `container-verifier`, `command`, `completion`, `launcher`, `intake-publication`, `native-story-task`, `lean-lifecycle`, `live-runtime`, `lean-office`, `team-branch`, `lifecycle`, `runner-discovery`, `team-executor`, `runtime-setup`, `runner-models`, `team-pr`, `team-gh`): 336/336, exit 0.

Original shape (a `#!/bin/sh` fake that runs `sleep 5`, as in `tests/team-gh.test.mjs`), through `runCommand` itself, timeouts 1–40 ms, 10 at a time: the unchanged `command.ts` (HEAD copy) 22 slow of 2000, all `TIMEOUT:CLI_CLOSE_UNCONFIRMED`; the changed one 0 slow of 10000.

Simplification (direct kit procedure; `ce-simplify-code` not used because the user's global instructions limit CE to `ce-compound` in this repo): the change is one interval beside the existing kill; nothing to simplify.

Not changed here: `src/runners/exec-relay.ts`, `src/runners/claude-controller.ts` and `src/runners/runner-models.ts` also send a single group signal (with their own stop sequences); they are left as a follow-up.
