# U55 implement attempt 3 — review 2 fixes (D48, bundle 4b)

- Review: U55-story-finish-review-2.md. Ready after a decision on I1; no Critical finding.
- Code commit: 221ba63 (on 23de7dd).

## Fixes
- **I1. Withdrawn PRs.**
  - When an approval ends, the Hub keeps every open, unmerged Story PR in `hub_story_finish.withdrawn` (`#ended`, once each). An approval ends when Tasks are added, on `reverify`, on `failed`, on `closed` (the closed PR itself excepted), or when the Story is cancelled.
  - The inbox `finishReady` also lists a PL's Story with withdrawn PRs, in any state.
  - The finisher closes each withdrawn PR first, with a comment saying the approval ended and not to merge it (`pr.closeStoryPr`, Story merge PRs only), then reports it `withdrawn`. The Hub forgets it; a resend does nothing, and the report is taken in any state.
  - A PR a person merged before it could be closed is logged with a hint to check that repo's base branch.
  - `closed` keeps the checked commits, so the PL can approve again.
- **I2.** A passed re-check is remembered by `<repoId>:<head>`. A later failure in the same pass (an expired gh login after the push) does not run the VM again.
- **M3.** The problem memo is cleared after any pass without an error, so a returning problem is shown again.
- **Recorded, not changed:**
  - `merge-tree --write-tree` needs git 2.38 or later.
  - `addTasks` on a done Story is V18's feedback flow; it is merge-safe now.
  - A small window remains between the approval re-read and `gh pr merge`.
  - An `opened` PR merged by a person at another head is reported as merged.
  - The new table has no migration, since it is new in this PR.

## TDD evidence (Node v24.19.0)
- RED: U55-story-finish-implement-red-3.txt. The attempt-3 tests on 23de7dd: 6 of 28 fail (withdrawal at the Hub and in the finisher, the re-check memo, the problem memo), and the new `closeStoryPr` import fails team-pr there.
- GREEN: U55-story-finish-implement-green-3.txt — full suite 2032/2032 on 221ba63; typecheck exit 0.

## New ASSUMED for G4
- The PL Office closes its own Story PRs on GitHub when their approval ends (with a comment).

## Not done yet
- The hands-on run up to a merge into the test repo's main waits for the user's allowance (V20).
