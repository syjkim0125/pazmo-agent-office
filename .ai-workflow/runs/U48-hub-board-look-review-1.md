# U48 review 1 — Story board look (`b5602d7..055c875`)

**Verdict: Not ready.** The fix needed is one line. The markup, CSS, layout, contrast and reading order are all correct, and nothing misleads a user. But the PR deliberately makes hover paint over a state colour. The Hub design checklist forbids that, and the checklist's sentence about Story cards is now false. Change either the CSS or the checklist before merging.

## Important

**I1 — Hover replaces the stop border, against checklist rule 5.**
- Where: `src/hub/pages.ts:158` (`.scard.stop`) and `:161` (`.scard:hover`); `docs/solutions/conventions/hub-design-checklist.md:45-47`.
- What happens: hover changes a stopped card's 2px border from stop red to accent blue. Measured: rgb(35,83,200) in light, rgb(141,176,255) in dark. The new test pins this order.
- What the rule says: "Hover must not paint over a state colour (a Task card's hover leaves its left state bar alone; a Story card has no state bar since U46…)". The last clause is no longer true.
- Scenario:
  - On the same boards, hovering a stopped Task card keeps its red bar, but hovering a stopped Story card turns it blue. The chip still says "멈춘 Task N", so state is never lost.
  - The next Hub reviewer who applies rule 5 will flag this as a violation, or someone will "fix" it. Either way the decision flip-flops.
- Fix, either one:
  - (a) Keep the red on hover: `.scard.stop:hover{border-color:var(--stop-bar)}`, and show hover another way, for example the title underline or a shadow. Change the U48 test from checking rule order to checking this rule.
  - (b) If the user wants the accent on hover, amend rule 5: a stopped Story card's 2px stop border (since U48) yields to hover, because its first-line chip carries the state. Replace the "no state bar since U46" clause.

## Minor (acceptable to ship)

1. **Some ways of bringing back narrow empty stages pass the tests.** Test-only gap, `tests/hub-board-page.test.mjs:1557-1565`. These still give 129/129:
   - a rail in another media block, for example `@media (min-width:861px){.stage:has(>.scards:empty){flex:0 0 64px}}`;
   - `.stage>.scards:empty::before{content:none}` inside the wide block, which hides 없음 on wide screens only;
   - a global `max-width:90px` on empty stages.

   Every revert of what this PR actually changed is caught. A browser check of equal stage widths is the real guard, and the change record has one.
2. **The stopped chip is not part of the link's name.** `src/hub/board-pages.ts:175-178`. Someone moving through links with a screen reader hears only the title. This is the same as before U48. In reading order the chip now comes first: 멈춘 Task 1 → Story #19 → title → stage word.
3. **The board grew taller:** about 155px at 1360 and about 230px at 861 on the demo data. This is the accepted cost of option (c) and is recorded in the change record.

## What I verified, and how

All checks were read-only in the worktree: HEAD 055c875, only the U48 run files untracked. Scratch work is in `.../scratchpad/review-u47/u48/`.

**Scope.** The PR changes `board-pages.ts`, `pages.ts`, the tests and a doc. `server.ts` and the stores are untouched. Per the code, permissions, forms and live.js behave as before. live.js re-renders the board with no layout code of its own, so the swaps assume nothing about rails.

**Rules that used to assume rails:**
- The 861–960px band rules (`pages.ts:173`) were written for equal columns (U41), and they fit again: at 861px every stage is 155px wide.
- `.stage[data-stage=planning]` keeps its dashed box and shows 없음.
- The phone rules (`pages.ts:181`) are unchanged: an empty stage is a 40–44px header row with its list hidden.
- No docs mention rails.

**Browser, the 7 widths 320/390/861/900/960/1000/1360 × light/dark:**
- After: 84/84 runs clean (demo Hub 18572 as pl, mj, he, admin; real-data copy 18571 as pl, admin). Nothing was drawn past the edge with folds open, and nothing scrolled sideways.
  - Every stage sits at the same x and width in every project, and every stage heading fits on one line.
  - Nothing inside a card is drawn outside it, and no pill wraps.
  - Every stopped card has a 2px border on all four sides and starts with the chip; calm cards are 1px.
  - Empty stages are short (88–96px) and say 없음.
- Before (main, 18573), for comparison: stages were misaligned at every width above 860. Example at 1360: 승인 대기 at x=1212 in one project and 822 in another. Empty-stage headings stood upright, 72–116px tall.

**Contrast of the stop border (≥3:1 needed for a non-text cue):**

| Theme | Against the card | Against the stage tray |
|---|---|---|
| Light | 3.95:1 | 3.35:1 |
| Dark | 5.22:1 | 5.52:1 |

**Deliberate reverts** (scratch copy, 3 test files, baseline 129/129). Each of these fails at least one test:
- no stop border;
- the stop rule moved after hover;
- a 1px stop border;
- the stop border in the line colour;
- the chip moved back after the stage word;
- the old wide-screen rail rule restored.

## Coverage limits

- Safari, Firefox and screen readers were not checked.
- I did not run the whole suite; I ran 3 page test files, 129/129.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
