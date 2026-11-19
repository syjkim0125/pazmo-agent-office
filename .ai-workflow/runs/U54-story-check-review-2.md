# U54 review 2: fixes for review 1 (7364708..197e922, code commit 3bdf926)

Fix status: I1, M1, M3, M4, M5 and M6 are fixed and tested. M2 is fixed, but the fix brings a cost regression (N2). For M7, the tests asked for were added, but presence has no Office-level test (N4). M8 is recorded as a limit.

## Critical
None.

## Important
None. I found no regression that changes a verdict or lets the checker report on a claim that is not its own.
- `pending` and `tries` are keyed by claimId. The Hub's `#claim` makes a new UUID every time, so a drop followed by a re-take always starts clean.
- The NOT_YOURS, NOT_FOUND, STATE and INVALID refusals clear `pending`.
- A Cut clears `pending`.

## Minor
N1. Locations: story-check.ts:242-247 (drop rule) and 224-226 (full re-check). The INVALID drop can loop. When the Hub answers INVALID, the verdict is dropped. The Hub still gives the same claim through `inbox.mine`, so the next tick runs the whole check again, rebuilds the same summary and gets INVALID again. The cycle has no end. A scratch test confirmed it: 5 ticks gave 5 full VM runs. The risk is low, since `slice(LIMITS.summaryMax)` keeps the summary within the length rule. Fix: keep INVALID in `pending` and stop with a single log line, or count INVALID as a failed try.

N2. Location: story-check.ts:180-196. The 10-minute window reruns every earlier repo's VM checks on every tick. Scenario: storyVerify is [A, B] and B's base is missing, which is deterministic. On each tick, A gets a full checkout and VM run, then B fails and the run returns null. With fast checks, a scratch test needed 24 ticks and 24 VM runs of A before B was reported; before this fix it took 3. During each run the claim tick is busy (the planner still runs first each tick). D47 says a Story base that cannot be fetched is reported as a failure, and that is now delayed by at least 10 minutes. Fix options:
- `checkoutStoryBase` every repo first (cheap git), then run the VMs.
- Or treat "couldn't find remote ref" as deterministic and report it at once.
- Or cache passed repo results by (claimId, repo, head).

N3. How the counter works now: it is per claim, not "in a row".
- It is cleared only when a verdict is built (line 228) and is never reset when a repo succeeds.
- A NotNow between failures does not reset it.
- A failure at t=0, then a recovery, then a different repo failing at t≥10 min reaches the limit after only 2 more failures. That is acceptable, but the doc comment ("in a row") is wrong.
- Orphaned entries: when a claim is released between ticks, its `tries` and `pending` entries stay forever, and a Cut leaves its `tries` entry behind. The growth is one small entry per lost claim per process, which is negligible.

N4. Location: office.ts:543 and 596. `checker.active()` in presence and in `idle` is untested at the Office level. I removed both and no test failed. The two team-office failures I saw in my scratch copy also happen on the unmodified copy and pass in the worktree, so they come from the copy environment. In `idle` the change is redundant, because `claimTicking` already covers the whole check. Presence is the only real effect, and it is safe. Fix: add a presence assertion to the held-check Office test.

N5. Paused + held versus D47. Resuming a held check while paused is not "taking" one, so it matches the ASSUMED wording and the pause-only-stops-claims rule for work Tasks (story-store.ts:1495). The rule is written only in the implement record and code comments. Fix: add one ASSUMED clause to D47 and V20 ("멈춤이어도 이미 가진 검증은 이어 한다") so G4 reviewers see it.

N6. Lanes without a link. `checkLanes` (office.ts:755-758) still drops lanes whose plan link is null, which is the case for no-link repos. A registered repo with no Hub link is then reported as "이 Mac의 Office에 등록되지 않은 레포". Its Hub id cannot be known, so failing is correct, but the wording is not. The relink, gh and hub-too-old lanes are safe now: every registered repo's engine and checkout are made at start, or the start fails (office.ts:420-428). With openClaim null nothing else uses those checkouts, and `assertOfficeCheckout` still guards them.

N7. Note for 4b, not a 4a defect: a verdict held in `pending` can be resent hours later about an older commit. The full SHA in the summary makes this honest, but 4b's `finish` must compare it with the current tip of the Story base.

## Checked and fine
- **Full SHA at phone width:** the `pre` rule (pages.ts:164) has `white-space:pre-wrap;word-break:break-word;overflow:auto`, so the 40-character hash wraps and does not widen the page. Checked by reading the CSS only, not in a browser.
- **M5:** the Story base must equal `storyBaseBranch(number)`.
- **M6:** credentials are stripped from the summary and the log (tested).
- **I1:** the Hub is asked only through ready lanes (tested).
- **Office gates:** the new Office tests prove the gates. Removing `openClaim()===null` from `canRun` fails "open Task record". Applying pause to `canRun` fails "paused … goes on with the held check".

## What I ran (Node v24.19.0)
- **Worktree:** team-office plus team-story-check passed 65/65.
- **Scratch copy:** team-story-check passed 20/20. The 3 mutations above ran there. Scratch tests zz-review2 passed 2/2 (N1 and N2 numbers).
- **Worktree state:** I created nothing in the worktree.
