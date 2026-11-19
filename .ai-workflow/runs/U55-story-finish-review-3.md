# U55 review 3: fixes 221ba63 (diff 23de7dd..fc5c076)

Verdict: **ready to verify.** I found no Critical or Important issues. The Minor items below can be follow-ups or ASSUMED notes.

## What I ran

All in a fresh scratch copy of HEAD with Node 24. tsc is clean. Test results: hub-story-finish 12/12, team-story-finish 15/15, team-pr 26/26, team-finish 6/6, hub-story-pages 35/35.

Mutations (each "caught" one makes a test fail):

| Mutation | Result |
|---|---|
| Drop the `withdrawn` branch that runs before the approval guard | caught (hub 1 fail) |
| Drop the inbox `OR f.withdrawn<>'[]'` | caught (hub 1 fail) |
| Skip `withdraw()` in the finisher | caught (finisher 1 fail) |
| Drop the passed re-check memo | caught (finisher 1 fail) |
| `closeStoryPr` closes a PR that is not open | caught (pr 1 fail) |
| `#ended` starts from `[]` instead of the existing withdrawn list | **survives** (see M1) |

## Fixes checked by reading

- **I1 is fixed.**
  - Every path that ends an approval keeps the earlier withdrawn entries and adds the unmerged PRs: addTasks, reportVerify, reverify, failed, closed (minus the PR that was closed) and cancel. approve, repo, problem and done spread `f`.
  - The finisher calls `withdraw` before `ensure` in the same `finish()` call. If closing fails, `finish()` throws before any `ensure`. A PR from an ended round can only be reused by `ensure` while it is still open, so the finisher never closes a PR that belongs to the current approval.
  - `closeStoryPr` checks `checkStoryMerge(base, head)`, so a Task PR (head `feature/story-N/task-M`) is refused as INVALID and never closed.
  - Resends are idempotent: after a close, a PR that is already closed returns `CLOSED` and the report goes out again.
- **Cancelled or done Stories cannot block anything.** Their withdrawn entries only add a `finishView` per tick, and `finish` returns before the merge loop. Failures go through the per-Story `ran:false` path, so they cannot block other Stories.
- **I2 and M3 are fixed.** The memo key `repoId:head` is sound, because a Story's checks do not change and a head belongs to one Story. M3: `problems.delete` now runs after any pass that has no error.

## Minor

- **M1. Test gap for keeping the withdrawn list** (src/hub/story-store.ts:1459). The code is right, but no test ends an approval twice before the Office closes the PR (addTasks, then cancel, while the Office is off). Add that case.
- **M2. A PR can be opened on GitHub without ever being recorded, so it is never withdrawn** (src/team/story-finish.ts:181-194).
  - Scenario: the finisher's `ensure` creates PR #7. Then `addTasks` or a cancel lands, or the Office stops, before the `opened` or `handed` report. That report is refused with STATE, so the Hub never learns of #7.
  - #7 stays open, follows the Story base, and its body says the PL approved it. For a cancelled Story nobody ever closes it.
  - The window is narrow. Fix: when the Story is no longer approved, make the Hub put `repo` reports into `withdrawn` instead of refusing them, or close the PR when the report is refused with STATE.
- **M3. A withdrawn PR that a person merged before it was closed is reported only in the PL's local log** (story-finish.ts:110-112). The Hub drops the entry, and the Story page never says that unchecked work reached the base branch. Fix: send `was` with the `withdrawn` report and show it as an event or problem.
- **M4. A withdrawn PR in a repo that is not on the PL Office stays in `finishReady` forever.** It uses the same `sayOnce` key as the Story's other messages, so the two lines can replace each other and repeat. A person who closed the PR has no way to clear the entry.
