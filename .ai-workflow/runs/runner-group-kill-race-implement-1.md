# runner-group-kill-race implement — attempt 1

Story: canonical `docs/understanding/pazmo-agent-office-contract.md` (minimal plan; the same stop-integrity area as M3/M4, as in run `run-command-group-kill-race`). Base: branch `claude/run-command-group-kill-race` at `70b8ff3` (unmerged), which fixed `runCommand`.

Problem: on macOS, a process that is still being forked when a single `kill(-pgid, SIGKILL)` lands misses it and keeps running in the group (`docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md`). Three stop paths still sent that one-shot group signal: `stopExecutor` in `src/runners/exec-relay.ts` (SIGKILL), `kill` in `src/runners/claude-controller.ts` (SIGTERM first, SIGKILL after the CLI exits or after its 12 s grace, at once for a refused stop) and `signal` in `src/runners/runner-models.ts` (stdin end, SIGTERM, SIGKILL).

## Change

- `src/runners/command.ts`: new exported `signalGroup(pid, signal)`. It sends `signal` to the group once and throws what that kill throws. Only for SIGKILL, and only after that first kill succeeded, it repeats the kill every 20 ms until a kill fails (any error) or 250 tries, with a ref'd timer that is never cleared by the caller. That is the reference behavior from `runCommand`'s `stop`, moved unchanged. `runCommand`'s `stop` now calls it; its first-kill error handling (`ESRCH` ignored, anything else `:KILL_FAILED`) is unchanged.
- `src/runners/exec-relay.ts`: `stopExecutor` calls `signalGroup(child.pid, "SIGKILL")`; the `RELAY_KILL_FAILED` handling is unchanged.
- `src/runners/claude-controller.ts`, `src/runners/runner-models.ts`: their wrappers call `signalGroup(child.pid, signal)`. Each stop sequence is unchanged: SIGTERM is still sent once and still comes first where it did (the OAuth refresh lock, `docs/solutions/integration-issues/stop-claude-model-discovery-without-sigkill.md`); only their SIGKILL steps now repeat.
- `exec-relay.ts` and `claude-controller.ts` are in `BOUNDARY_DIGEST` (`src/runners/runner-qualification.ts:20`), so the first role run after an update re-runs runner qualification once. `command.ts` stays outside the digest, as it was while `codex-controller.ts` already used `runCommand`.

## Tests

Shared fixture in `tests/runner-fixture.mjs`: `forkLoop(child)` (fork `child` and kill it at once, 5000 times) and `leftInGroups(groups)` (how many processes `ps -A -o pgid=` still shows in the groups once they are empty or 2 s have passed; uses the real `setTimeout` taken before any mock).

- `tests/exec-relay.test.mjs` "closing the relay leaves no process in the executor's group, even one being forked, in a caller that exits": a separate `node --input-type=module -e` caller opens 10 relays whose executors (`/bin/sh -c`, detached) send `{"pid":$$}` as a frame and fork `sleep 5 >/dev/null`; 200 ms after the pids arrive it closes all relays. Every `close()` must return true and no process may be left in the groups.
- `tests/claude-controller.test.mjs` "a claude killed while it forks leaves no process in its group, in a caller that exits": a separate caller runs 10 `claudeJob`s on one native fake in 10 homes. The fake writes its pid, forks `sleep 5 >/dev/null`, and after 0.2 s prints `{"type":"assistant"}`, which Office refuses (`CLAUDE_INIT_MISSING`) with an immediate SIGKILL. Every job must end `{ closed: true, error: "CLAUDE_INIT_MISSING" }` and no process may be left.
- `tests/runner-models.test.mjs` "a claude killed after its grace while it forks leaves no process in its group": 10 `claudeModels` calls in the test process with mocked `setTimeout` (its SIGKILL comes only after 3 s + 12 s of grace). The fakes (`refreshingClaude`) answer, wait for the end of their input, then fork `sleep 5 >/dev/null`, noting SIGTERM in a trap. The test ticks 3000, waits for every "term", ticks 12000. The models must come back and no process may be left. In-process rather than a separate caller, since that caller would need the same mocked clock; the short-caller property belongs to the shared helper and stays covered by `tests/command.test.mjs`.
- `tests/command.test.mjs`: its two fork-race tests now use `forkLoop` and `leftInGroups` instead of their own copies (simplification).

Two things found while writing the tests:
- **TERM trap and `kill $!`.** A shell that traps TERM lets a just-forked child keep the trap for a moment, so the loop's `kill $!` misses it. A first draft of the runner-models test filled the user's process table (2666 processes, `fork: Resource temporarily unavailable`, 15 s timeout). Measured with 200 forks of a tagged `sleep`: no trap with `kill` left 0/200 alive; trap with `kill` left 139/200; trap with `kill -9`, 0/200; no trap with `kill -9`, 0/200. `forkLoop` therefore uses `kill -9 $!`.
- **Native fake start cost.** Each new copy of the native shim takes about 0.2 s to start the first time (0.17–0.20 s measured, second start 0.00 s), and 10 copies started one after another (about 2 s). The claude-controller test therefore uses one binary in ten homes (2.3–2.5 s to 0.84–0.88 s). The runner-models test keeps `refreshingClaude` (ten copies, about 2.2 s) for its cleanup.

## RED and GREEN

Each run was one file at a time, with no other `node --test` run active except the one noted below, sampling the user's process count (`ps -u`).

- **exec-relay RED** (HEAD code): 3/3 failed with "no forked child may outlive the closed relay", 6, 7 and 6 left; max 442–454 user processes.
- **claude-controller RED**, first shape (ten binaries): 3/3 failed with 4, 4 and 2 left. Final shape (one binary), with HEAD's `claude-controller.ts` swapped in: 3/3 failed with 6, 6 and 4 left. Every job ended `CLAUDE_INIT_MISSING`, `closed: true`.
- **runner-models RED** (HEAD code, `kill -9` loop): 3/3 failed with 9, 8 and 8 left; max 456–461 user processes. These three runs overlapped another session's full `npm test`; see the note below.
- **GREEN**, 3/3 runs each:
  - exec-relay 410–432 ms
  - claude-controller 843–879 ms (final shape)
  - runner-models 2222–2270 ms
  - Max 429–462 user processes.
  - In one timed runner-models run, the fakes took 2.0 s to reach their loop and the group check 0.11 s.
- **`tests/command.test.mjs`** after the refactor:
  - Original `command.ts` from `bf3f31c`: both fork tests failed in 3/3 runs (`TIMEOUT:CLI_CLOSE_UNCONFIRMED`, 5272–5282 ms; 9, 7 and 5 left).
  - `c6c67e4` and `6ab8aa2`: the caller-exit test failed in 2/2 runs each (5 and 4; 9 and 6 left).
  - Fix: 6/6 in 3/3 runs.
- **Related files:** the 25 test files that import a changed module, the runner fixture, the launcher, runner settings or team gh gave 364/364, exit 0, 86 s, max 466 user processes.
- **Typecheck:** `npm run typecheck` exit 0.

Node 24.19.0 (nvm), macOS 26.2. `npm ci` in this worktree.

## Simplification

Direct kit procedure; the user's global instructions limit CE to `ce-compound`. One production helper replaces the repeat that `runCommand` had inline and the three one-shot calls. One fixture pair replaces the fork loop and the `ps` check that the four test files would otherwise each carry. Nothing else changed.

## Load on the shared machine

- **Process table full.** The first draft's process-table exhaustion (about 6 runs between about 14:45 and 14:53:40 KST) probably overlapped the start of a full run in another worktree (14:50:12).
- **Overlap with another full run.** The runner-models RED runs (14:54:10–14:55:05) ran during another worktree's full run (started 14:53:50), because the harness did not wait for it.
- **Afterwards.** Both are written in the shared notes folder. Since then, every run waits until no `node … --test` process is active.

## Not changed or not proven here

- **SIGTERM stays one-shot.** A child being forked when the SIGTERM lands also misses it. claude-controller follows with a SIGKILL once the CLI exits; runner-models does not kill the group when the claude exits within its grace, as before.
- **The exit-time and 12 s-grace SIGKILLs in claude-controller** go through the same `kill` as the tested refused-stop path; they were not driven separately.
- **Linux:** untested. Real CLIs were not run.
