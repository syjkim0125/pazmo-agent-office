# runner-group-kill-race workflow-review — pass 1

- **Reviewer:** independent, read-only `general-purpose` subagent dispatched with the superpowers code-review template. It got the requirements and the commit range, not the implementer's session.
- **Range:** `70b8ff3..43c81f1`, one commit, 9 files.
- **Verdict:** "Ready to merge: With fixes". Critical 0, Important 1, Minor 2.

## Confirmed by the reviewer

- **`signalGroup`** (`src/runners/command.ts:21-39`) is a faithful extraction of the base's repeat:
  - The first kill is synchronous and throws to the caller.
  - The repeat runs only after that kill succeeds, and only for SIGKILL.
  - Any kill error ends it, and it is capped at 250 tries.
  - The timer is ref'd and no caller can reach it.
  - No new import cycle: `command.ts` imports only `node:child_process`.
- **Call sites.** Each one's first-kill error handling is unchanged: runCommand `:KILL_FAILED` unless ESRCH, exec-relay `RELAY_KILL_FAILED` unless ESRCH, claude-controller and runner-models swallow all errors. SIGTERM behaves exactly as before, so the OAuth-lock order is kept. Several SIGKILLs on one group in claude-controller are harmless.
- **Fake timers:**
  - claude-controller and runner-models mock only `setTimeout`, so the repeat runs on the real clock.
  - team-office mocks `setInterval`, but none of its paths reaches a group SIGKILL. Even if one did, the repeat would freeze, which is the old one-shot behavior; no hang.
  - `leftInGroups` uses a `setTimeout` captured before any mock.
- **Tests:**
  - RED confirmed by the reviewer for all three new tests, against `70b8ff3`'s files: exec-relay 0/1 twice (5 and 10 left), claude-controller 0/1 twice (7 and 5 left), runner-models 0/1 three times.
  - Mutation `setInterval(...).unref()` in `signalGroup`: exec-relay 0/1 and claude-controller 0/1 (their separate callers matter), runner-models 1/1 as its comment says.
  - The `kill -9 $!` switch does not weaken `tests/command.test.mjs`: `bf3f31c` 0/2, `6ab8aa2` 1/2 (the caller-exit test fails, 7 left).
  - At HEAD: exec-relay 7/7, claude-controller 21/21, runner-models 17/17, command 6/6, `tsc` exit 0.
  - The loops are bounded and the escapees are `sleep 5`.
- **Boundary digest:** do not add `command.ts` to `BOUNDARY_DIGEST`. The list is a hand-picked set of boundary files, not their imports: codex-controller always used `runCommand` unlisted. Qualification does not check how a group is killed. Listing a general-purpose runner would requalify every runner after any change to it.
- **Hygiene:** no internal host or organization names; comments match the surrounding style.

## Findings

1. **Important — stale solution doc.** `docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md`:
   - Line 83 still lists the three call sites as "Still open … (follow-up)".
   - Lines 39 and 41-56 show the inline repeat at `command.ts:74-98`.
   - Line 73 cites `tests/command.test.mjs:51-80`.
   - Fix: mark the follow-up resolved through `signalGroup`, repoint the references, and say why `forkLoop` uses `kill -9`.
2. **Minor — runner-models test margin.** `tests/runner-models.test.mjs:296-311`:
   - Ten `refreshingClaude` copies of the native shim start one after another, so the fakes reach `eof` about 0.17–0.2 s apart.
   - In 5 probe runs, when SIGTERM landed (about 20 ms after the last `eof`), the first fake had done only 1422–1695 of its 5000 passes, with load average 5–8. One loop alone runs 5000 passes in 2.22 s.
   - On a faster or idler machine, a fake could finish its loop before SIGTERM, never write `term`, and leave the test waiting for its 15 s timeout.
   - Fix: one binary in ten homes, or a `go` file.
3. **Minor — requalification.** The edits to `exec-relay.ts` and `claude-controller.ts` change `BOUNDARY_DIGEST`, so every runner requalifies once after the update. Say so in the PR description.

## Declined to judge (reviewer's list)

- Linux (untested; the product is macOS-only).
- The SIGTERM fork race (out of scope by requirement).
- runner-models not killing the group when claude exits within its grace (pre-existing).
- exec-relay skipping the group kill when the leader has already exited (pre-existing).
- Pgid reuse under a mocked `setInterval` (no test reaches it).
- The exit-time and 12 s-grace SIGKILLs not driven separately.
- Real CLIs and the full suite not run (machine rules).

## Routing

Findings 1 and 2 need changes to the implementation, so this pass fails with `fix`. Finding 3 goes in the PR text.
