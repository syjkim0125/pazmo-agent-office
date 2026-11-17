# U49 implement attempt 2 — review 1 fixes

Review 1 (U49-hub-line-breaks-review-1.md) was Not ready: I1 (without anchor positioning the ⓘ box opened at (0,0)),
I2 (only two of six never-hidden items guarded by tests), and eight Minors. Commit 13319de on b5a76ea.

## Fixes
- I1 (src/hub/pages.ts): the base `[popover].infobox` rule has no margin, so the popover's own `inset:0; margin:auto`
  centres it where the browser cannot anchor; the `@supports (position-area:bottom)` rule sets `inset:auto; margin:0;
  margin-top:6px` beside the ⓘ; the phone sheet sets `inset:auto 16px 16px; margin:0; width:auto; max-width:none`.
- I2 (tests/hub-board-page.test.mjs): one test reads each page with the popover boxes taken out and finds: the invite
  and device-link notes with "링크와 별도로 허브 인증서 지문(…)도 함께 전달해" (TLS test hub), the Mac code check on
  /mac/approve, the /trust fingerprint check, plan 취소, Task 취소, the merge-lock warning and why 취소 waits.
- Minor: bold first lines tested (held callout, a refused form's alert); the Story page's own board tested for the PL
  ("내 Mac에서 더하세요") and the admin ("PL이 … 더합니다"); a visible "기준 브랜치" per field on phones (`.rpl`, hidden on
  wide screens); the created pages' ⓘ at the end of the first line (`say(text, lead, after)`); say() also splits after
  "…)." and is tested for escaping and for keeping a parenthesis whole; macApprove's parameter renamed `pending`.
  Left as judged: the held note "오래 멈춰 있으면 PL이 풀 수 있습니다" stays in view (safe), `.ln` layout effects.
- The change record has a review-1 section.

## Evidence (Node v24.19.0)
- RED: U49-hub-line-breaks-implement-red-2.txt — 4/12 failing (styles, base-branch row, created ⓘ, say()); the
  never-hidden, bold and Story-board tests pass on the current code: they guard against regressions.
- GREEN: U49-hub-line-breaks-implement-green-2.txt — 12/12.
- All 43 Hub test files: U49-hub-line-breaks-implement-hub-2.txt — 632/632. `npx tsc --noEmit -p .` exit 0.
- Browser (copies, 13319de's code): 120 after-checks clean; 10 ⓘ boxes on screen and closing on Esc. With the anchoring
  rule deleted from the stylesheet (a browser without position-area), the 1360px box opens centred (510–850 × 415–485);
  with it, 6px under its ⓘ; at 390px a bottom sheet with 16px sides.
