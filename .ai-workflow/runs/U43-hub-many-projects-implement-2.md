# U43 hub-many-projects · implement (attempt 2)

Fixes review 1 of this run (`U43-hub-many-projects-review-1.md`: Ready, Important 1, Minor 6). Commit `1d5b256` on `dcd8ef8`.

- Important 1 — chip marks: `.flag` gets `box-shadow:0 0 0 2px currentColor` (the chip's text colour), stop is a square (`border-radius:2px`), need a round dot (`50%`); STOP_FLAG/NEED_FLAG add `title` beside `role="img"` and `aria-label`. Measured on the saved pages: ring vs chip background 16.46:1 (light) and 13.47:1 (dark), the same on the chosen chip; fill 1.81–7.65:1 (the ring carries the boundary). Shape differs, so not colour alone.
- Minor 2 — `docs/LOCAL-PREVIEW.md` says one mark, square for stopped, else round for approval; the chip test adds a stopped Task to a project that already waits for approval and expects the square (count 2).
- Minor 3 — the folded line says "보이는 Story가 없는 프로젝트" (a project with only cancelled Stories lands there with the toggle off). The chip view's old empty sentence is unchanged (pre-existing; noted in the change record).
- Minor 4 — under a chosen chip, 나를 기다리는 일 has `<p class="muted">고른 프로젝트와 관계없이 모든 프로젝트의 일입니다.</p>` under its heading (`waitingOnMe(me, v, f)`); none on 전체 (tested both).
- Minor 6 — the fold test adds a project named `<img src=x onerror=alert(1)>`: no raw markup, escaped in its chip and on the line; `hub-plan-pages` test title now says "opens its own view on /board".
- Left as noted: Minor 5 (bare counts for screen readers), Minor 7 (one-project hub carries `project=` invisibly; reviewer: acceptable).
- Change record updated (marks, note, wording, review summary, contrast numbers); captures regenerated.

## RED / GREEN

- RED 2 (`U43-hub-many-projects-implement-red-2.txt`, code at `dcd8ef8` with the new tests): `tests/hub-board-page.test.mjs` 3/42 fail for the intended reasons — chip mark markup (title), the line's wording, the mark CSS. The escaping assertions sit after the wording failure and pass on the old code too (new coverage, not a behaviour change); the waiting-box note and the precedence check are in the chip test, which fails first on the mark markup.
- GREEN 2 (`U43-hub-many-projects-implement-green-2.txt`): all `tests/hub-*.test.mjs` 563/563; `tests/hub-board-page.test.mjs` 42/42; `npm run typecheck` exit 0.
- Layout re-measured after the fix: 120 checks (6 pages × 320/390/861/1000/1360 × two themes × with/without long words), overflow 0, targets < 44px 0.
