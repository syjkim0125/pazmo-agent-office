# U54 implement attempt 2 — review 1 fixes (D47, bundle 4a)

- Review: U54-story-check-review-1.md. No Critical findings; I1 Important; M1–M8 Minor.
- Code commit: 3bdf926, on top of 7364708.

## Fixes
- I1: `checkLanes` (office.ts) now maps every registered repo whose Hub repo id is known, whatever its lane state. `CheckLane` gained `ready` and a nullable `link`.
  - The checker talks to the Hub only through ready lanes.
  - It runs a repo's check on that repo's checkout even when its gh login lapsed or the lane needs relinking: the check needs neither.
- M1: the verdict is kept per claim (`pending`). The next tick sends it again before anything is checked again.
  - A verdict the Hub refuses for good is dropped, and the claim is checked again if the Hub still gives it. The refusals are NOT_YOURS, NOT_FOUND, STATE and INVALID.
- M2: a git or VM failure is reported only after 3 tries in a row that span at least 10 minutes (`FAIL_WINDOW_MS`). The clock is injectable.
- M3: each repo line in the summary carries the full checked commit. Bundle 4b binds the approval to that commit.
- M4: `canStart` is split into `canRun` (live, runners ready, no open record, no run, drive idle, no restart held, not stopping) and `canTake` (not paused).
  - A paused Office goes on with a check it already holds, so that claim keeps its heartbeat; it takes no new one.
  - `checker.active()` counts in the Mac presence (working) and in the restart idle test.
- M5: a Story base other than `storyBaseBranch(story.number)` is never checked out. That repo is reported failed with the reason.
- M6: `describe` strips `scheme://user:secret@` from any URL before the text reaches the Hub summary or the log.
- M7: new tests.
  - Checker: a lane that is not ready, the verdict resend, a verdict refused for good, the 10-minute window, credential stripping, a foreign Story base, a held check while paused, NOT_YOURS while the VM runs (the run is aborted), and stop() during a check.
  - Office: an open Task record blocks the check; a paused Office resumes a held check with its heartbeat.
- M8 (two Macs of one PL running the same held check) stays a recorded limit. Both would report the same claim; the Hub keeps the first verdict and answers the same verdict again with ok.

## TDD evidence (Node v24.19.0)
- RED: U54-story-check-implement-red-2.txt. These are the attempt-2 tests on 7364708.
  - 6 of 10 targeted tests fail there.
  - The two Office tests that fail show missing behaviour: the paused Office does not resume a held check, and the summary has a short commit.
  - Most checker unit failures come from the renamed gate (`canStart` → `canRun`/`canTake`), not from the behaviour itself.
- GREEN: U54-story-check-implement-green-2.txt — full suite 1985/1985 on 3bdf926; typecheck exit 0.

## Hands-on
- Attempt 1's run on a copy of the check Hub stands for the path that did not change: take, checkout, VM, report and page (U54-story-check-implement-hands-on-1.txt).
- These attempt-2 changes were checked by tests only: lane mapping, resend, the 10-minute window, the full commit line, pause and presence.

## Limits
- The AI review of D41 is not in 4a (D47 ASSUMED).
- Approval, merge and complete are bundle 4b.
- M8.
- The check Hub on 18444 runs the old code until it is restarted on merged main.
