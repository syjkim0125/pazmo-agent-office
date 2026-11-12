Verdict: Not ready

Review 2 of U43 (same reviewer as review 1), diff `dcd8ef8..1d5b256`, checking the review-1 fixes. Report as returned (layout condensed).

## Critical
None.

## Important
1. **The new ring on the chip marks takes the grey muted colour, not the chip's text colour.** `src/hub/pages.ts:76` `.flag{…box-shadow:0 0 0 2px currentColor}`, but the mark is a `<span>` inside `<nav class="chips">`, so `nav span{color:var(--muted)}` (`src/hub/pages.ts:32`) sets its colour and `currentColor` is the muted colour. Headless Chromium on 1d5b256: the mark's computed colour is `rgb(86,98,115)` (light) / `rgb(155,168,184)` (dark) on every chip. Contrast: unselected ring vs chip 6.19:1 (light) / 6.63:1 (dark), fine; selected light ring 2.66:1 against `#16202b` (fill still carries it: orange 7.65:1, red 4.17:1); **selected dark ring 2.03:1 against `#e6ecf3`, orange fill 1.81:1, red fill 2.58:1 — nothing reaches 3:1, so review 1's failure remains**; ring vs fill only 1.12–2.88:1. The verification doc (`docs/verification/2026-11-12-hub-many-projects.md:12`, `:39`) says the ring is the chip's text colour at 16.46:1 / 13.47:1 "고른 칩에서도 같다" — those are fg-vs-panel numbers, not what the browser draws. The test (`tests/hub-board-page.test.mjs:945`) only regex-matches CSS text, so it cannot catch this. Fix: `.flag{color:inherit;…}` (`.flag` 0,1,0 outranks `nav span` 0,0,2); checked on a scratch copy: dark selected ring becomes `rgb(26,34,45)`, unselected `rgb(230,236,243)`, 13.47:1. Add `color:inherit` to the CSS assertion; re-measure or adjust the doc.

## Minor
None new. The doc's link to the review record resolves once the run records are committed. Minors 5 and 7 fine as noted.

## Checked and fine
- Minor 2: LOCAL-PREVIEW says one mark, stopped first, matching `board-pages.ts`; the precedence test is real (a stopped Task in a project that also awaits approval → square). Square/round, `title`, `aria-label` confirmed in the rendered page.
- Minor 3: "보이는 Story가 없는 프로젝트" (`board-pages.ts:294`) holds for cancelled-only projects.
- Minor 4: the `ALL_PROJECTS` note shows only with a valid chosen chip; absent on 전체, for an unknown id, and when the box is empty; tests cover the first two.
- Minor 6: the escape test checks chip labels and the line with exact escaped output; plan-pages title fixed.
- Docs match the code except Important 1's contrast claim.
- RED 2 reproduced: 1d5b256 tests against dcd8ef8 code, 3/42 failing on the intended assertions. GREEN: board + plan-pages 63/63, `tsc` exit 0.

## Not checked
The doc's 120-layout re-run (box-shadow does not change layout). Real screen readers, non-Chromium browsers.
