# U55 review 2: fixes a9e604b (diff 4a84203..23de7dd)

Verdict: **ready to verify**, after a decision on I1 (fix it now, or record it as ASSUMED with M-level follow-ups). No Critical findings remain.

## Review 1 findings: each one is fixed and has a test that catches its mutation

Everything below was run in a fresh scratch copy of HEAD with Node 24. tsc is clean. Test results: hub-story-finish 10/10, team-finish 6/6, team-branch 44/44, team-story-finish 12/12, team-pr 25/25, hub-story-pages 35/35.

- **C1 is fixed.** I reran zz-evil-merge: both the evil merge and the `commit-tree` merge now come back `moved`.
  - New probes (zz-chains):
    - Swapped parents (main first, verified second): `moved`.
    - Two clean Office-style merges in a row: `current, check:true`.
    - A clean merge of an old main commit that main later reverted: accepted, but the Office's next merge of main removes the file. No reverted content survives.
  - Octopus merges are refused (exactly two parents). A first parent off the verified chain fails, because the walk must land on `verified`.
  - If `merge-tree` and the person's `git merge` disagree, the result is `moved`. The re-check then reports the new tip, so the failure is safe and does not loop.
  - The 20-merge cap also fails safe (`moved`).
- **C2 is fixed.** I reran zz-hub-wipe:
  - A new passed check keeps the merged repos.
  - `addTasks` clears the approval and `verified`, and drops the merged record of every repo that gets new work.
  - `ensureStoryPr` reuses a merged PR only at the same head and skips fork PRs. `mergeStoryPr` refuses a PR that was merged at another head.
- **I1–I4, M1 and M2 are fixed.**
- Mutations run against the fixes; each one makes a test fail:
  - drop the tree check: team-branch 2 fail
  - drop the approval re-read before the merge: team-story-finish 1 fail
  - drop the fork filter: team-pr 1 fail
  - drop the merged-head check: team-pr 1 fail
  - drop the re-check on restart (the mutation that survived in review 1): now 1 fail
  - drop the tip comparison: 1 fail
- **A restart after a merge but before the Hub report** cannot open a second PR. The `opened` record is posted before the merge, so the next tick reads the PR as MERGED and reports `merged`. A new PR at another head is reported through `rec.prNumber !== pr.number`.

## Important

**I1. A PR the Hub stopped tracking stays open on GitHub, follows the Story base, and a person can still merge it.** Location: src/hub/story-store.ts:869-878 (`addTasks`), and the `reverify`/`failed` cases of `finishReport` (they keep only merged repos), plus `cancelStory`.
- Scenario: fe's PR #5 is handed to a person ("사람 머지 대기"). The PL adds a Task, and `addTasks` drops the handed record. The finisher stops watching the PR and the Story page no longer lists it.
- The new Task then merges into `feature/story-N/base`. GitHub updates PR #5 to that tip.
- The person who was asked to merge PR #5 merges it. Work nobody checked or approved lands in main, and the Hub never learns of it.
- The same happens to an `opened` PR after `reverify`, and to any open PR when the Story is cancelled (review 1's M3).
- I verified this by reading the code. The state change itself (handed record dropped) is what zz-hub-wipe showed.
- Fix: when an approval ends with PRs that are open but not merged, have the PL Office close them, or at least comment on them. The Hub could keep them as "withdrawn" until the Office confirms they are closed.

**I2. A Story that keeps failing after its push re-runs the full VM Story check on every tick.** Location: src/team/story-finish.ts:141-149.
- Scenario: gh's login expires after the Office pushed its merge of main. On every tick, `prepare` returns `current, check:true`, `recheck` runs every Story check in the VM, and then `ensure` fails.
- Other Stories and claims are no longer starved, because the tick now returns `ran:false`. But the VM and the "working" state are taken every cycle.
- Fix: remember a passed re-check by (repoId, head) in memory, or back off a Story that failed (for example, skip it for 10 minutes).

## Minor

- **M1. `merge-tree --write-tree` needs git 2.38 or later**, and nothing checks the version. On older git every restart-after-push, or base-branch-moved case, becomes a permanent "problem". Check the version in doctor, or say the requirement.
- **M2.** `addTasks` still reopens a `done` Story (src/hub/story-store.ts:812). This is now merge-safe, but D48 does not say it should happen.
- **M3.** `problems` in story-finish.ts:227 is never cleared when the Hub clears the problem (a later repo report). If the same error comes back, it is not shown again.
- **M4.** There is still a window between the approval re-read and `gh pr merge`. If `addTasks` lands in it, the approved commit is merged but the report is refused (STATE). If the new Tasks are in another repo, a later round opens a merge-only PR for this repo. That is noise, not unchecked content.
- **M5. The `problem` column** has no migration, which is fine because the table is new in this PR. But a Hub data folder that was started on a33d3a4 (for example, the manual check copy) would fail with "no such column". Recreate that copy, or add an `ALTER TABLE ... ADD COLUMN` guard.
- **M6.** If a person merges an `opened` (not handed) PR at another head, the next tick reports it `merged` without comparing heads. This is a person's own action on GitHub, but the record is not bound to the checked head.
