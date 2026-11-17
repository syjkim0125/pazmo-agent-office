# U49 review 2 — fix `b5a76ea..13319de`, then the whole PR `add28e9..13319de`

**Verdict: Ready.** Both Important findings from review 1 are fixed, and so are the Minors that were taken up. Every fix is pinned by a test, and nothing confirmed in review 1 has regressed.

## Critical / Important

None.

## Minor (acceptable to ship)

1. **Some sentences still split oddly.**
   - say() splits after "다. ", so a Mac-sent detail that contains "다. " inside `waitText`'s parentheses would still be cut in two, for example "쉬는 중입니다(… 다시 합니다." and "ok)". The text is escaped, so this is cosmetic.
   - The approve page's held-Task warning (`src/hub/pages.ts:489`) does not go through say(), so its two sentences stay on one bold line. It is a security warning that stays in view.
2. **Carried as judged in review 1:**
   - the held-Task note stays in view, which is the safe direction from the explainer;
   - side effects of `.ln{display:block}`: the plan page's state pill sits on its own line, and the not-linked link shows as two lines.

## What I verified, and how

All checks were read-only in the worktree (HEAD 13319de; only the U49 run files are untracked). Scratch work is in `.../scratchpad/review-u47/u49*`.

**I1: the ⓘ box when the browser cannot anchor it.** Measured in Chromium 151 on 18572.

| Case | Where the box opened |
|---|---|
| `@supports` block removed, 1360px | Centred, for example 340×69 at (510,415) in a 1360×900 window. Before the fix it opened at (0,0). |
| With the block, 1360px | 6px under its ⓘ |
| Phone, 390px | Bottom sheet 16px from each side (x=16, width 358) |

- Every box was on screen, and Esc closed it.
- 36 page/width/anchor runs had no duplicate ids and no ⓘ inside a label.
- The base rule has no margin. The `@supports` rule and the phone rule each set `margin:0`, and the test pins all three.

**I2: the four reverts that slipped through in review 1.** The new test "stay in view, never behind an ⓘ" removes the popover boxes from each page, then checks the sentences are still there. All four reverts now fail it:

| Revert | Hidden behind an ⓘ |
|---|---|
| H1 | the fingerprint note |
| H2 | the Mac code check |
| H3 | the plan 취소 result |
| H5 | the /trust check |

**The fixed Minors.** I broke each fix on a scratch copy of 13319de and ran 10 Hub test files (231 tests). Every breakage failed at least one test:

| Breakage | Tests failing |
|---|---|
| Bold dropped from an alert (S2) | 1 |
| Bold dropped from the held callout (S3) | 1 |
| Story-page board treats everyone as the PL (B2) | 1 |
| `margin:0` restored on the base rule | 1 |
| Phone sheet without `width:auto` | 1 |
| The created ⓘ moved back after the lines | 1 |
| Phone branch label hidden | 1 |
| Split regex without the ")" case | 1 |
| say() never splits | 6 |
| Board tells everyone to retry | 8 |
| Popover text not escaped | 2 |

**On screen:**
- At 390px each base-branch input on the new-project form has a visible "기준 브랜치" label above it.
- On the invite page, the ⓘ now sits beside "받는 사람에게만 전달하세요.", and the fingerprint sentence stays in view (direct render, 1360px and 390px).

**say() split after ")":**
- Splitting after ")." changes no string the Hub shows; every other ")." in `src/hub` is in a code comment.
- None of the 423 Korean string literals in `src/hub` split oddly in a way that matters (only the cosmetic case in Minor 1).

**Unchanged from review 1, rechecked:**
- `macApprove`'s `info` parameter is renamed to `pending`, so the helper name is no longer shadowed.
- live.js: an open ⓘ holds the swap for a full tick, and the page swaps after Esc. With JavaScript off, the popover still opens.
- `server.ts` changed only to pass the side notes and `me`.

**Tests.** 10 Hub test files pass 231/231 on an untouched copy. I did not run the whole suite.

## Coverage limits

- Real Safari and Firefox were not tried; the no-anchor case was simulated by removing the `@supports` block. No screen reader was used.
- The 'created' pages were rendered directly, not reached through a POST.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
