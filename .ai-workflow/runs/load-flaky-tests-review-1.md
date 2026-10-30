# load-flaky-tests: independent review, attempt 1

Reviewer: a fresh general-purpose subagent, report only, read-only on the checkout (mutations run on a copy under the scratchpad).

## Review of b8649d5 (d7a0af2..b8649d5): With fixes
- Ran `tests/claude-controller.test.mjs` 20/20 at load 95-124.
- Mutations of claude-controller.ts on a copy: grace 3 s, grace 9 s, no SIGKILL fallback, TIMEOUT as an integrity stop, hook ignored while stopping, boundary stop with SIGTERM, init check off — all caught (some at the 15 s test timeout).
- Important 1: "timed out while it refreshes" and "takes over 2 s" freeze the grace but had no `{ timeout }` and no process-group cleanup. Mutants "TIMEOUT sends no SIGTERM" and "cancel sends no SIGTERM" hung the whole file (old real-timer tests failed in ~7.5 s).
- Minor: `reached()` 30 s bound vs 15 s test timeouts; tests assume the controller clock is global setTimeout; lifecycle.ts comment said "every start" (cache is per data dir), numbers would go stale, team not mentioned; spawnSync limit tied to the claw value only by a comment; a wedged claw start leaves `up` silent and `stop` refusing for the whole wait (follow-up: a "still starting" message); loop style nits.
- Fixed in cfb14c4: 15 s timeouts on every mocked-clock test; `refreshingClaude(t, …)` kills the fake's group after each test; that cleanup skips an empty pid file (found while fixing: pid 0 made `kill(-0)` signal the test process's own group); `reached(path, t.signal)`; comment rewritten with numbers in docs/solutions; `STARTUP_MS` exported and `STARTUP_MS.claw + 60000` in lean-lifecycle; claw wait 120 s after a 12-start measurement. Not taken: the "still starting" message (follow-up).

## Re-review of b8649d5..cfb14c4 (read only): With fixes
- Verified: the pid guard (empty/missing/garbage pid all skip; single small write is atomic; `-group` is right for a detached leader), `t.signal` use in shadowed subtests, every mocked-clock test has a timeout and cleanup, all `refreshingClaude` call sites pass `t`, lifecycle comment accurate, nothing else assumes 15 s for claw.
- Important 1: three non-mocked lock tests ("cancelled while it refreshes", "a process the claude started…", "a line the claude prints…") call `fx.holding()` without a `{ timeout }`. With `reached()` now stopping only on `t.signal`, a fake that never writes its pid (spawn failure, lost HOME) polls forever. Not a regression against main (its loop was unbounded too), but the same hang class.
- Minor: the helper cleanups (`kill(helper())`) have the same 0-pid hazard, low risk and predating the branch; the solution doc lifecycle.ts points at was still uncommitted.

Outcome for the graph: fix — give the three tests a timeout, then re-review.
