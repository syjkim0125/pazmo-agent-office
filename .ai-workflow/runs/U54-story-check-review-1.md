# U54 review 1 (D47 4a Story check), 1ccc3a2..7364708

## Critical
None. The Hub decides who owns the claim, through `#owned` with the claimId, and the resend path also checks the claimId. So the checker cannot report a verdict on a claim that is no longer its own. No infinite loop was found. The work-Task scheduler is never blocked when it could have claimed anything: while the PL holds the verify, the Hub refuses every claim anyway.

## Important
I1. A registered repo whose lane is temporarily not ready gets a false Story failure with the wrong reason. Locations: src/team/office.ts:751-763 (`checkLanes` drops lanes with state != "ready") and src/team/story-check.ts:121-123.
- Scenario: the gh login of repo B lapses, or a 401 sets the lane to relink. Then the last work Task merges. Lane A takes the check, B has no lane, and the checker reports passed=false with "이 Mac의 Office에 등록되지 않은 레포라 검사하지 못했습니다".
- Result: the Story reopens and the PL has to release it on the web, because a gh lapse at the wrong moment counted as a failed check.
- The Story check does not need gh at all, since it only runs a git fetch and the VM. D47's ASSUMED reports a failure only for repos that are not registered.
- Fix: map every registered lane, whatever its state, to its checkout and engine. If a repo is registered but its lane is not ready, either throw NotNow (wait) or refuse to take the check. Keep the "not registered" message for repos that really are missing.

## Minor
M1. A failed `verified()` reruns the whole VM check on every tick instead of resending the verdict (story-check.ts:196-201). I confirmed this in a scratch test: the report failed 3 times and that cost 4 full VM runs. `reportVerify` can be resent safely under the same claimId. Fix: keep `{passed, summary}` per claimId, as the planner's `pending` does, and resend it before running again.

M2. The tries count does not tell a lasting failure from a passing one (story-check.ts:180-190). Three failed tries at 30 s claim ticks, roughly 60-90 s of network trouble, report the Story as failed in the same way as a missing remote ref. Fix: only count tries that look deterministic ("couldn't find remote ref", a missing lane), or retry network errors for longer.

M3. Readiness for 4b: the summary keeps only 12 characters of each commit, and nothing records the full commit locally. D47 (3) needs "PL Office가 검증한 커밋" to tie the approval to that commit. Fix: put the full SHA in the summary, or keep a local record per claimId now.

M4. While paused, the Office does not resume a verify claim it already holds after a restart. The claim gets no heartbeat, the Hub shows it held, and the PL is stuck BUSY until they release it. During git fetch and freeze, `presenceOf` reports idle. Fix: either keep beating a held verify while paused or document this. Add `checker.active()` to `presenceOf`.

M5. `checkoutStoryBase` (branch.ts:371) checks the shape `feature/story-\d+/base` but does not check that N is `task.story.number`. The value comes from the Hub, so it is low risk; a check of N against the Story number would be cheap.

M6. Git stderr reaches the Hub summary through `describe()`. A remote URL with credentials in it could leak this way. The executor's existing failure reports (executor.ts:535, 668) already send the same kind of text, so this is not a new exposure. `mac-sync.ts:159` already strips user:secret@ from URLs and could be reused here. Pages escape the text correctly (`esc`, tested).

M7. Test gaps (I checked each one by mutation or a scratch test):
- The Office-level gates `openClaim()===null` / `gate.busy` / `ex.busy` / `watch.holding` are not tested directly. When I removed them, only 2 of 43 team-office tests failed, and both were unrelated call-sequence tests.
- The paused test does prove its claim: removing `paused` from `canStart` makes it fail.
- Not covered: a NOT_YOURS heartbeat in the middle of a check, `stop()` during a check, a failed report, and a restart through the real Office. My scratch tests show the first two behave correctly: the VM is aborted and nothing is reported.

M8. A PL with two Macs: `next()` treats any claimed verify returned by `inbox.mine` as its own and runs it again. Both Offices then check and report at the same time. This edge case is rare.

## Checked and fine
- **Restart:** `inbox.mine` resumes the same claim from the start.
- **Released or cancelled check:** a heartbeat answered NOT_YOURS, NOT_FOUND or STATE aborts the signal and nothing is reported.
- **Already reported:** after a report, `inbox` returns neither mine nor verifyReady, so the check is not run again.
- **BUSY:** a BUSY answer to `claimVerify` waits and lets the scheduler run.
- **Concurrency:** the planner, the checker and the scheduler are serialized in one claim tick (`claimTicking`). The executor drive has nothing to drive without an open record. A web pick or rerun is refused BUSY by the Hub. A VM verify counts as `gate.busy()`.
- **`checkoutStoryBase`:** it uses the same `assertOfficeCheckout` / reset / `clean -fd -e .pazmo-office` as `startTaskBranch`, its refs are validated, and the person's repo is refused (tested).
- **Story page:** the result shows only when passed or failed now, and it disappears after a release.

## Run
- Node 24: team-story-check plus hub-story-pages passed 47/47; team-office plus team-branch passed 84/84.
- `tsc --noEmit` reported no errors.
- Mutations and scratch tests ran in a copy under the scratchpad, never in the worktree. `git status` shows only the existing change to `.ai-workflow/runs/U54-story-check.json`.
