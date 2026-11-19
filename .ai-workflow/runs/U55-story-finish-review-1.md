# U55 (D48, bundle 4b) review 1: diff 1e9d1d8..4a84203

Verdict: **not ready to verify.** Two Critical findings break D48's core promise: main gets exactly the approved commits, plus the base branch.

Baseline in a scratch copy (Node 24): tsc clean; hub-story-finish 7/7, team-finish 5/5, team-story-finish 9/9, team-branch 43/43, team-story-check 22/22, team-pr 24/24, hub-story-pages 35/35.

## Critical

**C1. A merge commit someone else pushes to the Story base reaches main without the PL's approval.** Location: src/team/branch.ts:414 (`rev-list --count --no-merges`), src/team/story-finish.ts:74.
- Scenario: the check passes on `verified`. Someone then pushes a merge of main into the Story base and adds an extra file in that same commit (an evil merge). They could also use `commit-tree` with any tree and the parents verified and main.
- Result: `prepareStoryMerge` returns `{kind:"current", check:true}`, not `moved`. The only guard is the VM re-check. For a repo with no Story checks, `recheck` returns null at once. The unapproved tree is then merged into main.
- **Verified by running** (scratch test, both variants): the result was `current, check:true`.
- Fix: accept a tip other than `verified` only if it is a merge the Office made itself. Have the Office report the merge commit it pushes, and make the Hub keep it as the pending head. Or check each merge above `verified`: its parents must be (the previous commit, an ancestor of baseTip) and its tree must equal `git merge-tree --write-tree p1 p2`. Anything else is `moved`.

**C2. Work added after a repo was merged never reaches main, yet the Story ends as done.** Location: src/hub/story-store.ts:1363, src/hub/story-store.ts:803-850, src/team/pr.ts:137 and :287, src/team/story-finish.ts:98.
- Scenario: the Story is approved. Repo be is merged; fe is handed to a person. The PL adds a fix Task in be. `addTasks` allows this: the Story goes back to open, the approval stays and the merged record stays.
- The fix merges into be's Story base, and the next check passes. `reportVerify` then resets `repos` to `{}`.
- After the re-approval, the finisher works on be. `prepare` merges main in and pushes. `ensureStoryPr`'s lookUp finds no open PR, so it returns the old **MERGED** PR #3. `mergeStoryPr` sees MERGED and returns the old merge commit without comparing `headSha`. be is reported merged, then the Story is done, and the fix is not in main.
- If the wipe did not happen, line 98 (`merged → continue`) would skip be anyway.
- A related race: the finisher's loop keeps merging after `addTasks` reopens the Story. Its report is then refused (STATE), so a merge into main goes unrecorded.
- **Verified by running:** the Hub half (repos `{}` after the new pass; addTasks gives an open Story with the approval and merged repo kept). **By reading:** the pr.ts half.
- Fix:
  - When a PR is already merged, return it only if its head commit is `headSha`. `ensureStoryPr` should not reuse a merged PR whose head is not the current tip.
  - `addTasks` on an `awaiting_g4` Story should clear the approval. It should refuse new Tasks in already-merged repos, or drop that repo's merged record on purpose. It should also refuse a `done` Story.
  - In `reportVerify`, choose one rule (keep only the merged repos, or reset everything) and test it.

## Important

**I1. A merge refused because the head moved is handed to a person, not sent back to the check.** Location: src/team/story-finish.ts:163.
- Scenario: someone pushes to the Story base after `prepare`. `--match-head-commit` makes gh refuse the merge with GH_FAILED. The finisher hands the PR to a person, who may merge a head nobody checked. D48 says a Story base that moves goes back to the check.
- Fix: on GH_FAILED, read the remote Story base tip again. If it is not `prep.head`, report `reverify`.

**I2. A persistent error stops the PL Office from claiming any Task, and only its own log says why.** Location: src/team/story-finish.ts:199-205, src/team/office.ts:831.
- Scenario: one approved Story keeps hitting a gh error (for example the gh login has expired). Every tick returns `ran:true`, so `scheduler.tick()` is never reached. Approved Stories queued after it are never processed.
- The Story page keeps showing "승인됨, 머지 중" and the reason is in the local log only.
- Fix: return `ran:false` or back off, go on to the next Story, and report a visible reason to the Hub (for example on the repo record).

**I3. The restart-after-push path has no test at the finisher level.**
- Mutation: change `(prep.kind === "merged" || prep.check)` to `prep.kind === "merged"`. This skips the VM re-check after a restart, and team-story-finish still passes 9/9.
- Mutation: change `headSha: prep.head` to `headSha: verified`. This one is caught (8/9).
- **Both verified by running.** Add a test where `prepare` returns `current, check:true` and the re-check fails. Add a C2 regression test as well.

**I4. Stories that reached 승인 대기 under 4a cannot be finished.** Under 4a the check reported no commits, so `verified` is null.
- `approve` refuses such a Story (STATE). The `complete` route now needs an approval. `release` works only on a held or failed Task.
- Only `addTasks` reopens the Story. Provide a re-check path, for example release a passed check that has no commits.

## Minor

- **M1** (src/team/finish.ts:82 and :101): a crash between `approve` and the rename leaves the record in place. The "already approved" branch never renames it. After a later `closed`, with `verified` unchanged, that old record is posted as a new approval with no new answer from the PL. Fix: rename the record whose hash equals `approval.recordHash`, or bind the record to an approval round.
- **M2** (src/team/pr.ts:118-137): `gh pr list --head <branch>` also matches fork PRs. A fork PR could be returned and handed to a person as the Story PR. Filter on `isCrossRepository` or `headRepositoryOwner`.
- **M3:** cancelling a Story leaves a handed PR open and no longer watched, so a person can still merge it into main. Mention this on cancel, or close the PR.
- **M4:** the Story check now fails a Story whose work-only repo is not on the PL's Office, where 4a passed it. This is as D48 intends, but it changes 4a behaviour; worth stating in V20 or the summary. The record's `date` is not validated.

## What holds

- The Office never pushes to the base branch: `pushRef` pushes only the Story base.
- The base branch cannot be a Story or Task branch: both `prepareStoryMerge` and `checkStoryMerge` refuse it.
- The approval is bound to the fingerprint, the checked commits and the current Mac.
- The link `complete` route now requires the approval and every repo merged.
- Resent repo, closed and done reports are idempotent or refused safely.
- Restarts after a PR is opened, or after one repo is merged, are handled.
