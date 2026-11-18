# U54 implement attempt 1 — the PL's Office runs the Story check on its own (D47, bundle 4a)

- Story: D47 added with one V20 sentence; G1 recorded (Story hash 3717e8f4…, commit 584e822).
- Base: main 1ccc3a2. Code commits: 453f5ba, d4e515d.

## Changes
- src/team/story-check.ts (new): `createStoryChecker`.
  - It runs only when `canStart` allows. The Office passes: live, runners ready, no open Task record, no engine run, executor drive idle, no restart held, not stopping, and not `team pause`. The PL's 자동으로 일하기 is not read; the Hub already allows `claimVerify` while it is off.
  - It reads the inbox. A Story check this member already holds (state claimed) is checked again from the start (restart). Otherwise it takes the first `verifyReady` Story with `claimVerify`. A refused take is said once and waits for the next tick. A work Task held, or nothing ready, leaves the tick to the claim.
  - Its heartbeat (stage verify) goes out at once and every `beatMs`. NOT_YOURS, NOT_FOUND or STATE aborts the check with no report.
  - For each Story-check repo: `checkoutStoryBase` on that repo's Office checkout, `freezeProject`, then `verifyCandidate` in the VM. Duplicate check ids are renumbered V1…
  - BUSY, EXECUTION_LOCKED, STOPPING and CANCELLED are not counted. Any other git or VM error is tried again; the third failure in a row reports failure with the reason.
  - A repo this Office does not have is reported failed by its Hub name, or by its id when the Hub sends no name.
  - `storyCheckSummary` writes the outcome line, one line per repo (commit and each check's verdict), and the output of each check that did not pass. Outputs are cut from the front so that the summary fits 4000 characters.
- src/team/branch.ts:
  - `checkoutStoryBase` puts the Office checkout, detached, on the origin's latest `feature/story-<N>/base`. It aborts a merge and clears the tree, keeping ignored files and `.pazmo-office`.
  - It refuses any folder that is not the Office's story-checkout. That check is now shared with `startTaskBranch` as `assertOfficeCheckout`.
- src/team/story-link.ts: `claimVerify(storyId)` and `verified(taskId, claimId, passed, summary)` over the existing Hub routes.
- src/team/office.ts:
  - The checker gets one lane per ready repo: its Hub repo id from the plan link, its repo name from the link file (else the folder name), its checkout and its engine.
  - On the claim tick it runs after plan work and before the claim. A tick that ran a check claims nothing. `beginStop` stops it.
- src/hub/story-store.ts: `ClaimedTask.story.branches[]` also carries `repoName`. This is an added field; older Offices ignore it.
- src/hub/story-pages.ts: the Story page shows "Story 검증 결과" under 지금 할 일. It shows the summary once the check passed, or the failure while it stays failed. It shows nothing while the check runs or after a release.
- tests: team-story-check (14, one over a real TLS Hub with the PL's 자동으로 일하기 off), team-office (2: live claim-tick wiring and pause), team-branch (2), hub-story-pages (1), hub-story-claim (repoName expected).

## TDD evidence (Node v24.19.0)
- RED: U54-story-check-implement-red-1.txt. On HEAD 584e822 with the new tests, 4 of 5 targeted runs fail: a missing export, a missing module, the Office not taking the check, and no result section. The pause test passes on HEAD because nothing was taken there.
- GREEN: U54-story-check-implement-green-1.txt — full suite 1976/1976 on 453f5ba; typecheck exit 0.
- After d4e515d: U54-story-check-implement-team-1.txt — Story, team and Hub-story files 368/368; `npx tsc --noEmit -p .` exit 0.

## Hands-on (copy of the check Hub, never 18444 or its Offices)
- The check Hub's sqlite was copied with VACUUM INTO, with its TLS folder, to a scratch folder and served on 18575 with the branch code. PL's be clone was copied, its copied `.pazmo-office` was set aside, and it was registered in a new PL data dir linked to the copy as PL.
- `up --team` ran live: VM canary passed, runners ready. The PL's 자동으로 일하기 is off on that Hub.
- On the first claim tick the copy PL Office took Story 1's check, then Story 7's, with no click (U54-story-check-implement-hands-on-1.txt).
  - Story 7: the Office fetched feature/story-7/base at 0b3ee093deb1 and ran V1–V5 in the VM. All passed. The Hub moved the Story to awaiting_g4 with the summary "Story 검사 통과: 레포 1개, 검사 5개."
  - Story 1: its fe repo is not registered in that copy Office, so the check was reported failed. The summary named the repo by id. d4e515d makes it the Hub's repo name.
- Story 7's page at 1360 and 390 shows 승인 대기 and the result section, with 0 horizontal overflow.

## Limits
- The AI review of D41 is not in 4a (D47 ASSUMED).
- Approval, merge and complete are bundle 4b.
- The hands-on check ran on a copy; the check Hub on 18444 still waits for a restart on the merged code.
- The hands-on run predates d4e515d, so the repo-name wording was checked only by tests.
- Network-failure retry was checked by tests only.
