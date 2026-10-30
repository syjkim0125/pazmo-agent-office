# U26 review 2 (same independent reviewer, report-only, 2026-10-30)

Scope: the fixes for review 1 (.ai-workflow/runs/U26-review-1.md) in implement attempt 2.

Verdict: **Ready.** No Critical or Important issue remains.

## Checked
- I1 fixed: the 32 s case (a claude using its whole 15 s answer limit) and the safe failure are stated in src/cli/lifecycle.ts, the solutions doc and the verification doc; the lean-lifecycle test is named and described as a coupling guard.
- Safety claim verified: on a lean start timeout lifecycle.ts SIGTERMs only the service; the service exits within its 10 s limit; the detached discovery claude is not SIGKILLed; its stdin pipe closes when the service exits (scratch experiment: a detached child with Node stdio pipes got EOF when the parent called process.exit, while another child was alive). Real claude 2.1.280 `--version` with its stdout read end closed exited {code 0, signal null} where /bin/echo died of SIGPIPE, so the CLI does not die of SIGPIPE without its exit handler.
- I2, M1, M2, M3, M4 (verification doc), M5, M6, M7 (freeze) fixed; M8 recorded.
- Declined M7 shared constant (claude-controller.ts is in BOUNDARY_DIGEST, runner-qualification.ts) and M9: acceptable. Keeping D31's wording: acceptable for now.

## Minor (non-blocking)
- N1. Solutions doc snippet still showed the unfrozen constant. → fixed.
- N2. STATUS top section lacked the 32 s case and the open question on >= 42 s. → fixed.
- N3. Test name "is 10 s longer" while the assertion is "at least". → not changed: the test file is recorded implement evidence and the assertion message prints the value; wording only.
- N4. Keeping 30 s means knowingly not covering the 32 s case; the user's answer on >= 42 s should be recorded in D31 or a new decision. → surfaced to the user.

## Reviewer ran (Node 24.19.0, load ~16-20)
runner-models 16/16; lean-lifecycle "lean start wait" 1/1; team-registry 23/23; typecheck exit 0; Story check exit 0; EOF/SIGPIPE scratch experiments. No leftover fake processes; worktree unchanged by the reviewer.

## Not verified
Full npm test (run separately by the implementer); a real refreshing claude on EOF alone; real lean start time under load; whether `claude auth status` takes the lock.
