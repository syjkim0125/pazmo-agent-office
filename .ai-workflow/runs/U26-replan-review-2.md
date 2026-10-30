# U26 replan-2 review (same independent reviewer, report-only, 2026-10-30)

Scope: the M1 wording fix from replan review 1 (`U26-replan-review-1.md`, which covered the D31 edit and the main merge and was Ready on substance).

Verdict: **Ready.** The hedge is in D31 (contract:80), the lifecycle.ts STARTUP_MS comment, STATUS:5, the solutions doc and the verification doc, and matches what was measured (EOF on service exit, SIGPIPE ignored, no SIGKILL after the service exits; ending on EOF alone unmeasured).

- Before commit: the verification doc's post-merge full npm test line was still "(기록 예정)" while STATUS claimed the post-merge 1106/1106. → filled from the 14:28–14:30 post-merge run (1106/1106 exit 0) and the run after this fix.
- Optional, not applied: lifecycle.ts says the claude "is never SIGKILLed"; before the service exits (up to 10 s after the timeout SIGTERM) discovery's own SIGKILL can still reach a claude alive 12 s after its SIGTERM. A real claude took at most 9.1 s, so the conclusion holds; D31's wording ("서비스가 나가면 … 아무도 SIGKILL하지 않아") is exact. Not changed: comment only, and lifecycle.ts is recorded evidence.

Reviewer read `git diff` only; ran nothing, made no edits.
