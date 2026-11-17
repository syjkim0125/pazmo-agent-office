# U49 review 1 — line breaks, ⓘ popovers, board wording by reader (`add28e9..b5a76ea`)

**Verdict: Not ready.** The content is right. Nothing that must stay visible is hidden. No sentence changed meaning except the intended reader wording. Everything is escaped. Popover ids are unique, no ⓘ button sits inside a label, live.js and no-JS both work, and the board wording follows the reader.

Two things need fixing before merge:

1. The ⓘ box lands in the top-left corner in browsers without anchor positioning. The code comment, the change record and the user-facing explainer all promise it is centred.
2. The tests do not guard rule (3), "never hidden", for four of its six items.

Both fixes are small.

## Important

### I1 — Without anchor positioning, the ⓘ box opens at (0,0), not centred

- **Where:** `src/hub/pages.ts:82` (`[popover].infobox{margin:0;…}`), `:204-205` (the `@supports` block), and `docs/verification/2026-11-13-hub-line-breaks.md:80`.
- **Why:** the browser's own popover style centres the box with `inset:0; margin:auto`. The base rule's `margin:0` cancels that. Only the `@supports (position-area:bottom)` block moves the box next to its button.
- **Measured:** I removed that block on Chromium at 1360px to stand in for a browser without the feature, then opened each ⓘ.
  - Every box drew at x=0, y=0, over the logo and menu.
  - Each was 441–770px from its button.
  - With the block present, each box sits 6px under its button.
- **Who is affected:** Safari before 26, and any Firefox without `position-area`. A user clicks the ⓘ beside 풀기 and the note appears in the far corner of the window, possibly unnoticed.
- **It contradicts what was promised:**
  - the `pages.ts:204` comment says "centred otherwise";
  - the change record says "상자가 화면 가운데에 뜬다";
  - the explainer the user chose from (v20) told them the box would be centred.
- **Suggested fix:** drop `margin:0` from the base rule, or use `margin:auto` there, and keep `margin:0`/`margin-top:6px` only inside the `@supports` block. Alternatively, give the wide-screen fallback the phone's bottom sheet. Pin the fallback with a test.

### I2 — Rule (3), "never hidden", is guarded for only two of its six items

I made one change at a time on a scratch copy of b5a76ea and ran 10 Hub test files (226 tests). These changes still pass 226/226:

| Change | What it hides |
|---|---|
| H1 | The invite's "허브 인증서 지문도 함께 전달" sentence moved behind the ⓘ. No test asserts this sentence when TLS is on. |
| H2 | The Mac-code check "터미널의 코드와 같고 … 때만 허용" moved into a popover. `hub-mac-pages.test.mjs:125` matches the text anywhere, including inside a popover. |
| H3 | The plan's 취소 result moved behind an ⓘ. |
| H5 | The /trust "SHA-256 지문이 … 같은지 확인" step moved behind an ⓘ. |

Only the Task 취소 result (U49 test) and the merge-lock line (`hub-story-pages`) are caught.

- **Scenario:** a later "tidy-up" moves a security check behind an ⓘ and the suite stays green.
- **Suggested fix:** one test that strips `<span … popover …>…</span>` from each of these pages, then asserts each sentence is still present:
  - the invite and device-link pages (with TLS);
  - /mac/approve;
  - /trust;
  - the plan's 취소;
  - the Task's 취소 and merge-lock line.

## Minor (acceptable to ship)

1. **Bold first lines are pinned only for the PL's failed-Task card.**
   - Where: `src/hub/plan-pages.ts:66` (`alert`); `src/hub/story-pages.ts` (the held callout).
   - Dropping `lead` from `alert()` (S2) or from the held callout (S3) passes every test.
   - Older bold assertions now go through `unline()`, which removes the line markup and the `<b>` with it. Pin one alert and one held callout.
2. **A test gap on the Story page's board.** `src/hub/board-pages.ts:113`. Setting `lead` to always true (B2) passes. The scenario: an admin reading a failed check on the Story page would be told "고칠 Task는 내 Mac(claude 대화)에서 더하세요."
3. **The new-project form loses a visible label on phones.**
   - Where: `pages.ts:193` (`.rphead{display:none}`) and `plan-pages.ts:71`.
   - Before, each row read "기준 브랜치"; now each row shows only an input reading "main". The `aria-label` and the legend remain.
   - Suggested fix: a label that is visible on phones and visually hidden on wide screens.
4. **On the 'created' pages the ⓘ sits alone on the next line.** `pages.ts:342`. It comes after the last `.ln` block, so on the invite, device-link and connect-string pages it is not beside the sentence it explains. Put it inside the last line.
5. **Some sentences are not split.**
   - say() splits only after 다, 요, 까 or 오 followed by `.`, `?` or `!`.
   - `plan-pages.ts:95`, "PL의 Mac이 꺼져 있습니다(마지막 확인 …). 켜지면 이어서 합니다.", stays one line.
   - A Mac-sent rest detail containing "다. " inside `waitText`'s parentheses would split mid-parenthesis. It is escaped, so this is cosmetic.
   - Elsewhere: none of the hub's string literals with sentence breaks inside parentheses were split wrongly, and 72 multi-sentence strings split as intended.
6. **The held Task text differs from the explainer table, in the safe direction.** The table moved "오래 멈춰 있으면 PL이 풀 수 있습니다" behind an ⓘ; the code keeps it visible as a third line.
7. **Small layout effects of `.ln{display:block}`.**
   - On the plan page the state pill now sits on its own line above the state text.
   - `RERUN_NOT_LINKED` (a link) becomes two block lines.
   - Both are fine.
8. **A name clash in `macApprove`.** Its parameter `info` (`pages.ts:486`) hides the new `info()` helper, which is a trap for whoever adds an ⓘ to that page.

## What I verified, and how

All checks were read-only in the worktree (HEAD b5a76ea; only the U49 run files are untracked). Scratch work is in `.../scratchpad/review-u47/u49*`.

**Hidden vs visible.** I compared every ⓘ text against the explainer table (v20, read from the artifact).

- Behind an ⓘ:
  - the 풀기 note (the user's table lists it);
  - validity and one-time use on created pages;
  - the invite's 30 days;
  - install "처음 한 번";
  - the new-Story notes;
  - the project base-branch note.
- In view:
  - the 취소 results (Task, plan, Story draft);
  - the merge-lock line;
  - the fingerprint notes;
  - the /trust check;
  - the Mac code check;
  - the action buttons.

**Board wording by reader** (demo Hub 18572, /tasks):

| Reader | What they read |
|---|---|
| 정하은 (assignee) | "…Task 화면에서 이유를 보고 메모와 함께 다시 시도하세요." |
| 박지수 (PL), 김민준, admin | "…끝내지 못했습니다." / "맡은 사람이 다시 시도할 수 있습니다." |

- The PL's waiting box matches.
- `stoppedReason` gives "내 Mac에서 더하세요" to the PL and "PL이 더합니다" to others for a failed check.

**Popovers in the browser** (Chromium 151, 12 pages × 390/1360, as pl, admin and he):

- No duplicate ids, and no ⓘ button inside a label or summary.
- Every ⓘ opens a box on screen and Esc closes it.
- On wide screens the box sits 6px under its button.
- On phones it is a bottom sheet (16px insets).
- With JavaScript off the popover still opens.

**live.js** (synthetic Task page served on 18572):

- An open ⓘ held the swap for a full 10-second tick, then the page swapped after Esc.
- Removing both `noting()` checks fails the U49 live test.

**Escaping.** `say()` and `info()` escape, and the `lns` callers pass constants only.

- Feeding `<b>&"x` through `say()` escapes it.
- Making `info()` stop escaping its text (P1) fails 2 tests.
- Making `say()` stop splitting (S1) fails 2 tests.
- Telling everyone to retry on the boards (B1) fails 8 tests.

**Tests.** 10 Hub test files pass 226/226 on an untouched copy. I did not run the whole suite.

## Coverage limits

- Real Safari and Firefox were not tried; the no-anchor case was simulated by removing the `@supports` block. No screen reader was used.
- /mac with the installer on and the created pages were rendered directly, not POSTed.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
