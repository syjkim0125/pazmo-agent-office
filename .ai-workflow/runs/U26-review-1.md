# U26 review 1 (independent, report-only, 2026-10-30)

Reviewer: fresh general-purpose agent, given the worktree diff and Story D31/D28, not the implementer's conclusions.

Verdict: **Changes needed** (docs and test framing; production change in runner-models.ts and lifecycle.ts correct against D31).

## Important
- I1. 30 s lean wait and the relational test do not cover discovery's own worst case: claudeModels waits up to 15 s for an answer before the stop (15 + 17 = 32 s), after discoverRunners (4 x 10 s) and codexModels (15 s); ensureDefault may run a second discovery. Failure is safe (start times out, service SIGTERMed, discovery claude in its own group exits on EOF/SIGTERM). Test passes at 27000, so it does not pin 30 s. Fix: rename the test, state the 32 s case in lifecycle.ts comment and the verification doc; covering it (>= 42 s) is a user decision.
- I2. Solutions doc says runCommand never ends a claude, but discoverRunners runs `claude --version` and `claude auth status` through runCommand, which SIGKILLs the group on its 10 s timeout. Fix the sentence; add a follow-up / unverified item.

## Minor
- M1. tests/team-registry.test.mjs `call` spawnSync limit 30000 now equals STARTUP_MS.lean; use STARTUP_MS.claw + 60000.
- M2. Verification doc "한가할 때 0.55–2.53초": section 4 never measured idle (those rows were at load 59–174 right after a stress test).
- M3. "계획 claude는 잠금을 최대 7.5초 보고 포기": waiter retries 5 times 1–2 s apart then up to ~7.5 s more (10–11 s observed). Conclusion holds (12.1 s > ~11 s).
- M4. Claw also discovers synchronously in `/api/cli-status?refresh` (vendor host.ts:127) and on an agent PATCH when the runner is not usable (runner-settings.ts:171); D31 should say live lean Office.
- M5. Claw-startup doc: new sentence placement, stale line ref lifecycle.ts:261 (now 263), stale "unmerged".
- M6. Solutions doc "a loaded machine cannot make them flaky" overclaims (real-time 15 s test timeout remains).
- M7. Same 12 s in claude-controller.ts:90 and runner-models.ts:39; freeze CLAUDE_STOP_MS.
- M8. lean-service SHUTDOWN_LIMIT_MS 10 s < 17 s worst stop: a SIGTERM during startup discovery exits at 10 s without the final SIGKILL; only a CLI ignoring SIGTERM is orphaned (window 2 s -> 12 s).
- M9. Mocked tests: a test that already timed out may leave an unhandled rejection from `found`.

## Reviewer ran
runner-models 16/16; lean-lifecycle "discovery claude" 1/1; runner-settings 18/18; typecheck exit 0; Story check exit 0; mutations on a scratch copy: term 11999 fail, 12001 fail (timeout), 2000 fail, 12000 pass, lean 26999 fail, lean 27000 pass. No leaked fakes.

## Could not verify
Full npm test; real claude discovery behavior during a hung refresh (answers initialize? EOF starts shutdown?); real lean start time under load; whether `claude auth status` refreshes or takes the lock.

## Disposition (implementer)
- Fixed: I1 (test renamed to what it proves, lifecycle comment and docs state the 32 s case and that a timed-out start is safe), I2 (sentence corrected, follow-up recorded), M1, M2 (also the same wording in the solutions doc), M3, M4 (verification doc lists the Claw callers; D31 text kept, since editing the Story would invalidate this run for a wording detail), M5, M6 (wording), M7 (Object.freeze), M8 (recorded as a limit).
- Declined: M7 shared constant with claude-controller.ts (changing the boundary file re-runs runner qualification; equality is recorded in D31 instead); M9 (only on a test that already failed; the controller tests have the same shape).
- Not changed: the 30 s value (user choice); raising it to >= 42 s is surfaced to the user as a question.
