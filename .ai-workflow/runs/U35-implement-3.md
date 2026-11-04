# U35 implement, attempt 3 (docs only)

Reset reason: review 2 (`.ai-workflow/runs/U35-review-2.md`) Minors 1–2, both wording. Docs are inside the kit snapshot, so the wording fixes need this attempt and a docs-only review.

## Changed files (since attempt 2)
- `docs/verification/2026-11-04-claude-job-recheck.md`: the cancel bullet (no qualification after a cancel; `superviseRemote` already reported CANCELLED; the codex half is the same by code and untested); the cancel-delay residual (sequential probe limits 10/15/15 s plus up to 3+12+2 s claude stop, 18 s grace, `PROCESS_LIVENESS_UNKNOWN` when a CLI hangs; code reading only); a new "리뷰" section for rounds 1–2 and a pointer to round 3; the kit verification pointer `.ai-workflow/runs/U35-verify-1.md`.
- `docs/STATUS.md`: the same cancel wording and residual; review rounds; pointers to review 3 and the kit verification; the ASSUMED V18 clause to show at G4.
- No `src/` or `tests/` change since attempt 2 (`git diff` of those paths is the attempt-2 state).
