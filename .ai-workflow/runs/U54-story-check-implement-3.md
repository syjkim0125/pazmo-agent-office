# U54 implement attempt 3 — review 2 fixes (D47, bundle 4a)

- Review: U54-story-check-review-2.md. No Critical or Important findings; Minors N1–N7.
- Code commit: 3138815, on top of 197e922.

## Fixes
- N2: `checkAll` now has two passes.
  - First it checks out every repo's Story base (cheap git, each on its own checkout). The VMs run only once every checkout succeeded.
  - While one base cannot be fetched, no VM runs for any repo.
  - When that claim's tries run out, the failed repo becomes a result. The other repos are then checked once and the verdict is reported.
- N1: a verdict the Hub refuses as INVALID is kept in `pending` and sent again on later ticks. The VM is never re-run for it. It is said once in the log, and the PL can release the check on the web.
  - NOT_YOURS, NOT_FOUND and STATE still drop it.
- N3: the comments now say the counter is per claim, not reset by a success in between, and cleared once a verdict is made.
  - At a run's start, the `tries`, `pending` and said-once entries of any other claim are forgotten.
- N4: a new Office test asserts the Mac presence is working while a Story check fetches its base, and idle again once it is reported.
- N6: a repo the Office cannot map (not registered, or registered with no Hub link) reads "이 Mac의 Office에 없거나 Hub에 연결되지 않은 레포라 검사하지 못했습니다."
- N5 is not a code change. The paused + held behaviour is shown on the G4 page as an ASSUMED line; the Story text is not edited after G1.
- N7 is carried to 4b: `finish` must compare the verified commit with the Story base's current tip.

## TDD evidence (Node v24.19.0)
- RED: U54-story-check-implement-red-3.txt. These are the attempt-3 tests on 197e922.
  - 3 of 22 checker tests fail there: the N2 VM order, N1 INVALID kept, and N6 wording.
  - The targeted Office run passes 11 of 12 there, since presence already counted the check from 3bdf926; N4 adds only the test.
- GREEN: U54-story-check-implement-green-3.txt — full suite 1988/1988 on 3138815; typecheck exit 0.

## Limits
- Same as attempt 2: no AI review in 4a, approval and merge in 4b, M8 (two Macs), and the check Hub on 18444 still runs the old code.
