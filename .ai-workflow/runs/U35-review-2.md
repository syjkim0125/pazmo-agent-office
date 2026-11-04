# U35 review, attempt 2

Allocation: the same 1 independent reviewer, scoped to the review-1 fixes (changed code since round 1).

## Reviewer report (verbatim)

# U35 review 2 (round-1 fixes)

**Ready to merge: Yes.** No Critical or Important findings; two Minor ones.

## Abort guard (`src/runtime/runner-jobs.ts:78`)
- **Correct.** After the guard, a cancelled job is never qualified and claude never starts. A job that was not cancelled is never reported CANCELLED.
- `signal` is `superviseRemote`'s inner signal. A TIMEOUT also aborts it, but the outer wrapper then reports `TIMEOUT` (`src/runners/remote-job.ts:56-65`).
- **No effect on the team Office.** Whenever the job signal is aborted, `superviseRemote` throws away the inner result and returns `failure("CANCELLED")`, and `container-verifier.ts:553` maps an aborted run to `CANCELLED`. So the team never saw `RUNNER_NOT_READY` for a cancelled run, even before this fix.
- The guard's real effect is that a cancelled job no longer reaches `qualify`. That matters when no stored qualification exists, because qualification would then start the fixture.
- `runnerNotReady` and `src/team/` need no change.

## Findings
1. **Minor: the D39 codex half of the guard is untested.**
   - Mutant "guard for claude only": 75/75, survived.
   - The verification doc says "준비 안 됨인 codex를 다시 탐색할 때(D39)도 같다", but no test covers it.
2. **Minor: the cancel-delay residual understates the bound** (`docs/STATUS.md`, `docs/verification/2026-11-04-claude-job-recheck.md`: "10–15초 안").
   - One discovery runs in sequence: version/login probes (10 s each), the codex model listing (15 s), then the claude listing (15 s, plus a stop of up to 3+12+2 s).
   - After a cancel, `superviseRemote` waits only 18 s of grace. A discovery still running after that leaves `closed:false`, so the lease is unknown and the run ends `PROCESS_LIVENESS_UNKNOWN`, not a clean cancel. This needs hung CLIs.
   - My round-1 wording ("10–15 s") was the source of the error.

## Tests and counts
- runner-jobs 21/21, lean-office 54/54.
- The other 8 related files: 147/147 (lean-agents 15, lean-server 29, native-story-task 19, runner-settings 22, team-gate 9, team-office 27, live-runtime 17, runner-account 9).
- Total 222/222, matching the claim. `tsc` exit 0.
- Recount: 7 new tests (runner-jobs: the role-loop hook test, the cancel test, still-ready, failed discovery; lean-office: 3) plus 1 changed. The STATUS line "새 시험 7개와 고친 시험 1개" and the doc's 6-row mutant table are accurate.
- Mutants (scratch copy, 75 tests, restored, `cmp` identical):

| Mutant | Result | Caught? |
|---|---|---|
| drop the guard | 74/75 | yes |
| guard before the discovery | 74/75 | yes |
| guard after the ready check | 74/75 | yes |
| skip pm/lead | 74/75 | yes (survived in round 1) |
| pre-fix condition | 68/75 | yes |
| guard for claude only | 75/75 | **no, survived** |
| guard moved outside the block | 75/75 | survived, but equivalent (the outer wrapper already returns CANCELLED for a pre-aborted signal) |

## Round-1 Minors 1, 2, 6
- **1 and 2:** represented accurately, in STATUS and in the verification doc. The doc states the in-flight window, the 5 s TTL, the hold, "코드로만 확인", and that no listing cost is spent then.
- **6:** still pending. It is only promised for G4 in the disposition, and the docs do not yet record it. Check it at G4.

## Not checked
- A real claude.
- A team test for the TTL and hold.
- The full `npm test`.

## Disposition (controller)
- Ready to merge: Yes. The doc wording fixes below change the snapshot (docs are inside it), so this round is recorded as `fix` and `implement` gets its third attempt (docs only).
- Minor 1 (the D39 codex half of the guard is untested): the verification record now says the codex case is the same by code and only claude is tested; no test added (the outer `superviseRemote` already reports CANCELLED for an aborted signal, so the codex half only saves a qualification).
- Minor 2 (cancel-delay bound): the verification record and STATUS now give the sequential probe limits, the 18 s grace and `PROCESS_LIVENESS_UNKNOWN` when a CLI hangs (code reading, untested).
- Round-1 Minor 6 (G1 binds the ASSUMED V18 clause): shown at G4.
