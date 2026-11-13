# U47 implement attempt 3 — review 2 fixes

Review 2 (U47-hub-pages-review-2.md) was Not ready: I1′ and five Minors. Commit c0084be on b3d5d03 (branch hub-na-pages).

## Fixes (src/hub/story-pages.ts)
- I1′: `heldText(mine, on)` with `macOn(badge)` (on = any state but off/none). /me's held card uses my own badge
  (`chrome.mac`); the Task page uses the assignee's. Mine and no Mac reporting: "내 Mac에서 10분 넘게 소식이 없습니다.
  Mac을 켜면 이어서 합니다."; mine and on (or resting): "내 Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래
  멈춰 있으면 PL이 풀 수 있습니다."; others: HELD / HELD_MAC_ON as before.
- Minor 3 (and N2): a failed work Task's sentence is chosen by `mine`: the assignee reads plainFailure (retry), anyone
  else reads `failureForOthers(reason, release)` — the cause, "맡은 사람이 다시 시도할 수 있습니다.", and "오래 멈춰
  있으면 풀 수 있습니다" ("PL이 풀 수 있습니다" when the reader cannot release).
- Minor 2: a failed Story check adds "풀기는 고치지 않고 다시 검증합니다." only with `actions.release`.
- Minor 4: the Story card's head is "멈춘 Task N개. 각 Task 화면에서 풀 수 있습니다." and says "다시 시도하거나" only when
  the PL has a failed work Task of their own. Each line uses `stoppedForLead(t, me)`; /me's 내 Story에서 멈춘 일 uses
  it too (same class of defect as I2, found while fixing: the PL read "다시 시도하세요" about others' Tasks there).
- Minor 5: HELD_MAC_ON's doc comment is back above it; HELD_MINE and failureForLead are gone.

## Tests (tests/hub-board-page.test.mjs, block "U47 review 2")
- My held Task by Mac state on /me and the Task page (none, idle, limited with the rest line first); the PL's line.
- Failed Task by reader: B (no 풀기), admin, the PL's own Task with a quiet link (풀기 is the action, the retry sentence,
  the not-linked note before the action) — N2, minor 3, N8.
- The Mac rest line and the merge-lock note before 풀기 in the card — N6, N8.
- Failed check: B has no 풀기 sentence, admin has it; the Story card says no 다시 시도; exactly one id="decide" for the
  PL and none for B and admin on the Story page — minor 2, minor 4, M13.
- Story card and /me led speak to the PL; the PL's own silent Task reads as my Mac.
- Changed: the U47 Story-card test now expects who can retry C's Task. Two older tests in hub-story-pages
  (the assignee's held sentence; the PL's stuck list) expect the reader's sentence.

## Evidence (Node v24.19.0)
- RED: U47-hub-pages-implement-red-3.txt — 6/18 U47 tests failing for the expected reasons (the N6/N8 order test passed
  before the change: it pins behaviour from attempt 2).
- GREEN: U47-hub-pages-implement-green-3.txt — 145/145 (board-page, story-pages, design-invariants, story-upload,
  web-office).
- All 43 Hub test files: U47-hub-pages-implement-hub-3.txt — 618/618. `npx tsc --noEmit -p .` exit 0.
- Browser (copies only; 18444 untouched): 80 after-checks, overflow 0, past edge 0; the 24 small hits are the cancel
  checkbox with its 44px label (as before). Captures rebuilt.

## Limits
Unchanged. The board's failure wording (U46) still speaks to the assignee for every reader; recorded in the change record.
