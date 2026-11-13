# U48 implement attempt 2 — review 1 fixes

Review 1 (U48-hub-board-look-review-1.md) was Not ready: I1 (hover paints the accent over the stop border, against
checklist rule 5) and Minor 1 (rail reverts in another block slip past the tests). Commit d5c8ee6 on 055c875.

## Fixes
- I1: `.scard.stop:hover{border-color:var(--stop)}` — a stopped Story card stays red on hover (darker in light, lighter in
  dark), like a Task card whose hover leaves its state bar alone. Checklist rule 5's Story-card clause now says a stopped
  Story card's 2px stop border (U48) only darkens to `--stop` on hover.
- Minor 1: the equal-stage test strips the phone blocks (`@media (max-width:860px)`) and fails on any remaining
  `.stage:has(>.scards:empty)` rule or `.scards:empty::before{content:none}`, in any other block or at the top level.
- The change record notes review 1 and the hover.
- Minors 2 (the chip is outside the link name, as before U48) and 3 (the board is taller, accepted with option (c)) left.

## Evidence (Node v24.19.0)
- RED: U48-hub-board-look-implement-red-2.txt — 1/11 failing (the hover rule). The tightened rail test passes on the
  current code: it is a guard against reverts.
- GREEN: U48-hub-board-look-implement-green-2.txt — 11/11.
- All 43 Hub test files: U48-hub-board-look-implement-hub-2.txt — 620/620. `npx tsc --noEmit -p .` exit 0.
- Browser (demo copy 18572, d5c8ee6's code): a stopped card 2px rgb(229,72,59) → hover rgb(173,35,24) light,
  rgb(240,104,92) → rgb(255,154,144) dark; a calm card 1px line → hover accent as before.
