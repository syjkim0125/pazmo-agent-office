# U48 review 2 — fix `055c875..d5c8ee6`, then the whole PR `b5602d7..d5c8ee6`

**Verdict: Ready.** I1 is fixed in the CSS, the checklist and the test. All three slipping reverts from review 1 are now caught. Nothing that review 1 confirmed has regressed. One wording nit remains in the checklist, and it is fine to ship.

## Critical / Important

None.

## Minor (acceptable to ship)

1. **"darkens" is only true in light mode.** `docs/solutions/conventions/hub-design-checklist.md:46-47`. Rule 5 now says the stop border "only darkens to `--stop` on hover". In dark mode `--stop` is lighter than `--stop-bar`: rgb(240,104,92) becomes rgb(255,154,144). Someone checking against the rule in dark mode would read "darkens" and expect the wrong change. Suggested wording: "shifts to `--stop` on hover (still the stop colour)". The same applies to the test title "hover darkens". That changed line is also wider than the rest of the paragraph.
2. **Carried over from review 1, as judged then:**
   - the stopped chip is outside the link's accessible name, as before U48;
   - the board is about 155–230px taller.

## What I verified, and how

All checks were read-only in the worktree: HEAD d5c8ee6, only the U48 run files untracked. Scratch work is in `.../scratchpad/review-u47/`.

**I1 in the browser** (demo Hub 18572, 1360px):

| Theme | Stopped card at rest | Stopped card on hover | Calm card on hover |
|---|---|---|---|
| Light | rgb(229,72,59), 2px | rgb(173,35,24) | accent rgb(35,83,200) |
| Dark | rgb(240,104,92), 2px | rgb(255,154,144) | accent rgb(141,176,255) |

- The hover colour against the card and the stage background is 6.93:1 and 5.89:1 in light, 7.84:1 and 8.29:1 in dark.
- Rest against hover is 1.76:1 in light and 1.50:1 in dark, so the hover change is visible.
- Keyboard focus on a stopped card still draws the 3px accent outline (focus is an allowed accent use).
- `.scard.stop:hover` is more specific than `.scard:hover`, so it wins whatever the rule order.

**Tests and deliberate breakages** (scratch copy, 3 page test files, 129/129 at baseline). Each change below fails at least one test:
- removing the stopped-card hover rule;
- setting that hover to the accent colour;
- removing the stop border;
- a 1px stop border;
- moving the chip back after the stage word;
- the old rails;
- a rail in another media block;
- 없음 hidden on wide screens only;
- a global cap on empty stages;
- a rail written with another selector.

The first three slips are review 1's U6, U7 and U8, all now caught.

**The whole PR, browser.**
- 84/84 runs clean: demo Hub 18572 as pl, mj, he, admin; real-data copy 18571 as pl, admin; widths 320/390/861/900/960/1000/1360; light and dark.
- In every run:
  - nothing is drawn past the edge with folds open, and nothing scrolls sideways;
  - each stage sits at the same x and width in every project;
  - stage headings stay on one line;
  - nothing in a card is drawn outside it, and no pill wraps.
- Every stopped card has a 2px border and starts with the chip.

**The whole PR, unchanged parts.**
- The 861–960px band rules, the planning stage and the phone rules are as checked in review 1.
- `server.ts` and the stores are untouched.

## Coverage limits

- Safari, Firefox and screen readers were not checked.
- I did not run the whole suite.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
