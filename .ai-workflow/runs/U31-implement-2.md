# U31 implement — attempt 2

Reset by workflow-review attempt 1 (`fix`). Everything in `.ai-workflow/runs/U31-implement-1.md` stands; this attempt adds the two fixes the re-check found:

- `src/runners/runner-account.ts`: codex wording order is now unambiguous billing words (`out of credits`, `add credits to continue`, `quota exceeded`, `insufficient_quota`, `check your plan and billing`) → limit words (`usage limit`, `rate limit`, `429`, `too many requests`) → a bare `upgrade to plus` (billing). A 429 `insufficient_quota` refusal is billing again; the free-plan "You've hit your usage limit. Upgrade to Plus …" stays limit.
- `src/runners/claude-profile.ts`: a later assistant reply that is not a refusal also clears the reset time of the limit before it.

RED (node 24.19.0, spec reporter): `tests/runner-account.test.mjs` 2/8 failed — the 429 `insufficient_quota` case read as limit, and a stale reset time survived a reply claude went on from.
GREEN: affected files (runner-account, claude-profile, native-story-task, team-store, team-scheduler, team-executor, team-story-contract, team-office, team-lifecycle, planning-runner-failure, reviewer, claude-controller) 258/258; typecheck exit 0.
