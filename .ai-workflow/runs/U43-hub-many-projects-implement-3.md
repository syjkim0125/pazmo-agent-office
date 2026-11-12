# U43 hub-many-projects · implement (attempt 3)

Fixes review 2 of this run (`U43-hub-many-projects-review-2.md`: Not ready, Important 1). Commit `03c2f97` on `1d5b256`.

- Important 1 — `src/hub/pages.ts`: `.flag{color:inherit;…}`. The mark is a `<span>` inside `<nav class="chips">`, and `nav span{color:var(--muted)}` coloured it, so the `currentColor` ring was muted grey. `.flag` (0,1,0) outranks `nav span` (0,0,2); the ring now takes the chip's text colour.
- `tests/hub-board-page.test.mjs`: the CSS assertion requires `.flag{color:inherit;…box-shadow:0 0 0 2px currentColor`.
- Change record: the review-2 finding, the admission that the attempt-2 numbers measured the chip's text colour and not the drawn mark, and the drawn numbers below. Captures regenerated.

## Measured on what the browser draws (saved pages from the restarted preview Hub, Chromium)

The mark's computed `color` (ring) and `background-color` (fill) against the chip's background, on four pages (전체; the 회원 등급 chip chosen, an approval mark; the 쿠폰 개편 chip chosen, a stop mark; `/tasks` with one project) × light/dark, before and after hovering an unchosen chip:

- Light: unchosen ring `rgb(22,32,43)`, chosen ring `rgb(255,255,255)`: 16.46:1 on every chip.
- Dark: unchosen ring `rgb(230,236,243)`, chosen ring `rgb(26,34,45)`: 13.47:1 on every chip.
- Hover leaves both unchanged. Fill vs chip 1.81–7.65:1 (the ring carries the boundary); shape square (2px) vs round (50%).
- Layout is unaffected (colour only); the 120-check layout pass after attempt 2 stands.

## RED / GREEN

- RED 3 (`U43-hub-many-projects-implement-red-3.txt`, code at `1d5b256` with the new assertion): `tests/hub-board-page.test.mjs` 1/42 fails (the CSS test) for the intended reason.
- GREEN 3 (`U43-hub-many-projects-implement-green-3.txt`): all `tests/hub-*.test.mjs` 563/563; board tests 42/42; `npm run typecheck` exit 0.
