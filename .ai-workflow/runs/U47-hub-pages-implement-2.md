# U47 implement attempt 2 — review 1 fixes

Review 1 (U47-hub-pages-review-1.md) was Not ready: I1–I3, m1–m3. Commit b3d5d03 on 1b6e01a (branch hub-na-pages).

## Fixes
- I1: /me — my held Task's 지금 할 일 card says "내 Mac에서 10분 넘게 소식이 없습니다. Mac을 켜면 이어서 합니다." and
  links the Task page as 자세히 (HELD_MINE).
- I2: wording by reader and kind. Task page: the one who can retry keeps plainFailure ("… 아래 이유를 보고 메모와 함께
  다시 시도하세요"); a reader with 풀기 only reads failureForLead (the cause, then "맡은 사람이 다시 시도할 수 있습니다.
  오래 멈춰 있으면 풀 수 있습니다."). A failed Story check reads verifyFailed(isPl) + "풀기는 고치지 않고 다시
  검증합니다." Story card: a failed check reads verifyFailed(true) ("고칠 Task는 내 Mac(claude 대화)에서 더하세요.").
- I3: tests for the invariants — the reason's <details> once per page and inside the card when there is one; at most
  one id="decide"; a lead who also holds the Task gets 다시 시도 before the fold and 풀기 folded; the Story card lists a
  Mac-silent Task with HELD_SHORT; AWAITING_G4 once for PL, member and admin and the card only for the PL; /me held card.
- m1: `.steps li` font-weight 500, current step 700; test pins it and the past-step bar colour.
- m2: with a card, the Mac-rest text and notes sit in the card before its action; without a card they stay in the head.
- m3: recorded as intended in docs/verification/2026-11-12-hub-pages.md (admin gets a Task card but no Story card; the
  PL's /me does not promote "내 Story에서 멈춘 일").
- Two older tests read the retry sentence as the PL; they now read it as the assignee (h.c), and the PL's sentence is
  checked separately.

## TDD evidence (Node v24.19.0)
- RED: U47-hub-pages-implement-red-2.txt — 3/12 U47 tests failing (held /me card, wording by reader, step weights).
- GREEN: U47-hub-pages-implement-green-2.txt — 139/139 (the same five files as attempt 1).
- All 43 Hub test files: U47-hub-pages-implement-hub-2.txt — 612/612. `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; check Hub 18444 untouched)
Re-ran the 80 after-checks on b3d5d03's code: overflow 0, past edge 0 (folds open); the undersized hit is again the
22px checkbox with the 322×44 label. Captures rebuilt in docs/verification/2026-11-12-hub-pages/.

## Limits
Unchanged from attempt 1.
