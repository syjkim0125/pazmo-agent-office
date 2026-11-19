# U55 implement attempt 2 — review 1 fixes (D48, bundle 4b)

- Review: U55-story-finish-review-1.md. Not ready: C1, C2; Important I1–I4; Minor M1–M4.
- Code commit: a9e604b (on 4a84203).

## Fixes
- **C1 (branch.ts `onlyBaseMerges`).** A Story base tip other than the checked commit is taken only as a first-parent chain of up to 20 commits, each of which:
  - is a merge with exactly two parents;
  - has its second parent in the base branch tip;
  - has a tree equal to `git merge-tree --write-tree <p1> <p2>` (clean).
  Anything else is `moved`, and the Story is checked again. Real-git tests show three cases are `moved`: an evil merge that adds a file, a `commit-tree` with the right parents and any tree, and a merge of another branch. The Office's own clean merge is still taken (and re-checked).
- **C2**
  - **pr.ts.** `ensureStoryPr` takes `headSha`. It reuses an OPEN PR, or a MERGED PR only when its `headRefOid` is this commit; else it opens a new PR. Cross-repository (fork) PRs are ignored, which also covers M2. `mergeStoryPr` refuses a PR merged at another commit (INVALID).
  - **Hub.** `addTasks` ends any approval and clears the verified commits. It drops the merged records of the repos the new Tasks touch; other merged records stay. `reportVerify` keeps merged records, where it used to wipe them.
  - **Finisher.** It reads the approval again right before each merge: an ended or replaced approval stops it before main.
  - A conflict result now carries its head, so the handed PR is head-bound too.
- **I1.** A GH_FAILED merge re-reads the origin's Story base tip (`branch.storyBaseTip`). If it moved, the finisher reports `reverify`, never a handed PR.
- **I2.**
  - A failing Story no longer returns `ran: true`: the claim tick goes on to the Task claim and the next approved Story.
  - Its reason is posted once as the new Hub report `problem`. The Hub stores it in `hub_story_finish.problem`, and any progress clears it.
  - The Story page shows it in a callout under "main 머지". `team finish` returns it while the Story is approved.
- **I3.** Tests cover a restart with `current, check:true` and a failing re-check, the moved-before-merge refusal, the approval ending mid-merge, and the C2 Hub rules.
- **I4.** New Hub `recheckStory` (route `POST recheck`, PL only). It applies to a Story at 승인 대기 without commits and without an approval: the check is ready again and the Story is open. `team finish` calls it and answers `rechecking`. The guide says so.
- **M1.** On an already-approved Story, `team finish` renames a left-over record whose hash equals the approval's.
- **M3.** A handed PR is left open when a Story is cancelled. This is recorded as a limit.
- **M4.** The change in 4a behaviour (a work-only repo missing on the PL's Office now fails the check) is recorded in the change record.

## TDD evidence (Node v24.19.0)
- RED: U55-story-finish-implement-red-2.txt. The attempt-2 tests on 4a84203: 13 of 132 fail, one or more per fix.
- GREEN: U55-story-finish-implement-green-2.txt — full suite 2026/2026 on a9e604b; typecheck exit 0.
  - One expectation changed between runs: a conflict now carries its head.

## Not done yet
- The hands-on run up to a merge into the test repo's main waits for the user's allowance (V20).
