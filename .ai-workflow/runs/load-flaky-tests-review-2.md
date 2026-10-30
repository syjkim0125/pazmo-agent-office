# load-flaky-tests: independent review, attempt 2

Same reviewer as attempt 1 (`load-flaky-tests-review-1.md`), read only, no tests run.

## Final check of cfb14c4..10a5642: Ready to merge — Yes
- Every lock test is bounded: all `refreshingClaude` tests and "a cancel after the claude itself exited" have a test timeout (15 s; 30 s where a 10 s helper-reaping poll runs).
- The two old unbounded loops in "a cancel after the claude itself exited" stop on `t.signal` (`reached(pid)`, and the `gone()` loop with `throwIfAborted()`).
- The header comment matches the code. Leaving the pre-existing `kill(helper())` cleanups is acceptable: the helper file is fully written before anything can kill the fake.

## Non-blocking follow-ups (predate the branch)
1. "a cancel after the claude itself exited" reads its pid as soon as the file exists; a read between the shell's truncate and write gives 0, and `gone(0)` is never true, so the test would fail at 30 s. Microsecond window; fix by waiting for a non-empty file.
2. A fake that runs but writes its pid somewhere other than `root/pid` (a regression in how the claude's HOME is set) would leave the mocked-clock tests with nothing to kill; `tests/claude-profile.test.mjs` asserts HOME, so it would also fail visibly there. Fix: write the pid first to an absolute path baked into the script.

## Evidence the orchestrator supplied (reviewer did not rerun)
- Spawn-failure mutant: the file ends in 150 s with 20/20 tests failing, controller restored byte-identical.
- Normal: 20/20 three times. 36 stress threads on 10a5642: 6/6 runs (120/120), load up to 176.
