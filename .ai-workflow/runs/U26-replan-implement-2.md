# U26 replan: implement attempt 2 (2026-10-30)

After replan review 1 (Ready, Minor M1): the claim that the discovery claude "ends by itself" after a timed-out lean start was stated as fact, but only EOF delivery, SIGPIPE being ignored by claude 2.1.280, and the absence of any SIGKILL are verified.

Wording changed (no behavior change):
- Story D31 (contract line 80): "입력 끝을 받고 아무도 SIGKILL하지 않아 잠금을 남기지 않으므로(갱신 중인 claude가 입력 끝만으로 끝나는지는 재지 않음)".
- src/cli/lifecycle.ts STARTUP_MS comment: "gets the end of its input and is never SIGKILLed, so it cannot strand its login lock" (comment only).
- Also (not evidence): STATUS, the solutions doc and the verification doc, same hedge; STATUS notes the post-merge 1106/1106 run.

Checks after the edit: typecheck exit 0; Story check exit 0; lean-lifecycle "lean start wait" 1/1. Full npm test runs in the verify node.

Run note: editing D31 changed the Story again, so `U26-discovery-stop-grace-replan.json` (implement 1, review 1 with M1, implement 2 started) also reports "Story requirements changed". This attempt is recorded in a new run, `U26-discovery-stop-grace-replan-2.json`; both earlier runs stay as evidence.
