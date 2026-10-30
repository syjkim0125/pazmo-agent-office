# U27 review 2 (same independent reviewer, report-only) — commit 9216ed4

Verdict: Approve. Minors 1-4 of review 1 resolved; no new correctness problem. Nothing Critical or Important.

Reviewer ran (Node 24.19.0): launcher + live-runtime + runner-settings + runner-discovery 63/63 (exit 0, one more than review 1: the runnerLoginOptions test); runner-jobs + codex-controller + cli + team-lifecycle + lean-office 85/85 (exit 0); typecheck exit 0; story check exit 0. HEAD and tracked tree unchanged.

Checked: the pinned RUNNER_BLOCKED headline is accurate with or without an installed codex and the test rejects the old wording; the login cue renders "codex를 쓰려면 터미널에서 codex login도 실행하세요." (and the claude form) with correct particles, unchanged for a logged-in blocked CLI; runnerLoginOptions matches the old inline expression and typechecks where assertRunnerLogin takes it; only the call site itself stays untested, and the reason for no `up` CLI test (real claude in /opt/homebrew/bin) holds; D32 follows D28's "(…를 바꿈)" convention; the solution doc names pinnedCodexProblem and both callers.

Minor
1. docs/STATUS.md:9 still calls the pinned inconsistency an open decision.
2. Solution doc: "Office started on `auth.json` alone" understates the old behaviour; under pinned it also started without `auth.json` when any runner was usable.
3. Review 1 Minor 5 (discovery under pinned) stays a follow-up.

Disposition (author): 1 and 2 fixed in docs after this review (STATUS is not kit evidence; the solution doc is not in the implement evidence). 3 recorded under "아직 하지 않은 것" in the verification doc.
