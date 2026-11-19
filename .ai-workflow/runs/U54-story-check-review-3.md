# U54 review 3: fixes for review 2 (197e922..e122556, code commit 3138815)

Verdict: **Ready to verify.** N1, N2, N3, N4 and N6 are fixed and tested. N1 has one Minor problem with its wording (R1 below). No Critical or Important findings.

## Critical
None.

## Important
None.

## Minor
R1. The INVALID path's log line is not true: it says the PL can release the check on the web, but the PL cannot. Locations: story-check.ts:288-293 and 260.
- `run()` sends a heartbeat (line 260) on every tick before it resends the verdict.
- So a verdict the Hub refuses as INVALID keeps its claim live forever.
- The Hub's `releaseTask` needs a check that is held (no heartbeat for 10 minutes) or failed, so the PL cannot release it.
- Result: the Story stays in verifying, the PL is BUSY for every Task, and the only way out is to cancel the Story or stop the Office for 10 minutes.
- Reachability: on the current Hub, INVALID cannot happen. The summary is a string, kept within 4000 characters by `slice`, and the body limit is 1 MB (`LINK_LIMIT`). The case is defensive only.
- Fix, either:
  - on INVALID, send a short fallback verdict (passed=false, the head line and the repo lines only);
  - or stop beating that claim so it turns held.
  - In both cases, fix the log text.

R2. The counter is per claim, so failures add up across the two passes. For example, if a base fetch failed 4 times over 7.5 minutes and then the first transient VM error comes after the window, that repo is reported failed at once, with no retry. This matches the documented semantics, so it is acceptable.

## Checked by reading
- **Two-pass safety:**
  - Each repo has its own `<dataDir>/story-checkout` and its own engine.
  - The storyVerify repo ids are unique, so no two entries share a lane.
  - `freezeProject` runs in `verify` (line 179), after that repo's own checkout. Nothing between the two passes touches that checkout: `canRun` requires no open record, the claim tick is serialized, and the drive has nothing to drive.
  - The recorded `head` is the frozen tree.
- **Cut and NotNow:** `signal.aborted` is checked before each checkout and before each VM run. Errors in both passes go through `failed()`, which rethrows Cut and NotNow (BUSY and the others) without counting them.
- **A VM failure on repo A after all checkouts:** it is counted. Within the window the tick returns null, and the next tick does all the cheap checkouts again and then the VMs from A. After the window, A becomes a problem result and B's VM still runs.
- **Deterministic problems** (repo not mapped, foreign base) become results without counting a try.
- **Forget-other-claims** (line 243): a member holds at most one Hub task, so clearing the entries of other claim ids at the start of a run is safe. It also bounds the maps to a single entry.
- **N6:** the new wording covers both an unregistered repo and one with no Hub link.

## What I ran (Node v24.19.0)
- **Worktree:** team-story-check plus team-office passed 68/68.
- **Scratch copy:**
  - My review-2 scratch tests now show 1 VM run for a persistent INVALID (was 5), and 1 VM run of repo A before B's missing base is reported (was 24).
  - Mutation: removing `checker?.active()` from `presenceOf` makes the new presence test fail (1 fail of 2 matched). So N4 really is tested.
- **Worktree state:** nothing created or changed in the worktree.
