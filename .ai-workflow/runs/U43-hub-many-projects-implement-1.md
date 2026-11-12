# U43 hub-many-projects · implement (attempt 1)

Story D44 (G1 2026-11-12, Story hash `edf0cb7a`, commit `b54ea6e`). Implementation commit `dcd8ef8` on `b54ea6e` (main `1fe9292` + the Story change). Change record: `docs/verification/2026-11-12-hub-many-projects.md`.

## What changed

- `src/hub/board-pages.ts`
  - `waitingOnMe`: collects `Wait` items (rank, tone, word, why, link), stable-sorts by rank (stopped 0, plans waiting for an answer 1, approvals 2) and groups by tone+word. Each row: `<li><p class="ghead">pill<span class="count">N</span>[<span class="gwhy">why</span>]</p><p class="glinks">links</p></li>`; the reason only when every item in the row has the same one. Heading count = all items. Nothing hidden. Still reads every project (`v.projects`), whatever chip is chosen.
  - `BoardView.project` (asked id) → `filtersOf` reads an unknown id as 전체. `boardHref(base, filters)` adds `project=<encodeURIComponent(id)>` after `mine`/`cancelled`; only hub project ids reach it.
  - `chips(me, base, v, f)`: only with ≥ 2 projects; 전체 + one chip per project (all projects, whatever the filters), count = Stories + web plans shown under the filters, dot `stop` if a Task stopped else `need` if a Story awaits G4 (`role="img"` + aria-label). `aria-current="true"` on the chosen chip. Placed in the titlebar under the tabs; tabs and toggles carry the project.
  - `projectsOf(me, base, v, f, body)`: shows the chosen project only; on 전체 with chips, a project with no Story or plan goes to one `<p class="quiet">` line of name links to its chip view (same board, same filters); 내 Story만 still drops projects with nothing of mine.
- `src/hub/pages.ts`: CSS for the grouped rows (grid `minmax(0,1fr)`), links as 44px chips, `.chips` (wrap, 44px, chosen = dark), `.flag` dots, `.quiet` line (44px links); `.gwhy`, `.chips a`, `.quiet a` join the `overflow-wrap:anywhere` list.
- `src/hub/server.ts`: passes `project` from the query; POST `/projects` redirects to `/board?project=<new id>` (a new empty project is only a name on the 전체 line). Not written in the Story: to confirm at G4.
- `docs/LOCAL-PREVIEW.md`: board reading section.

## RED / GREEN

- RED (`U43-hub-many-projects-implement-red-1.txt`, code at `b54ea6e`): `tests/hub-board-page.test.mjs` 6/42 fail — the two existing waiting-box tests (new row markup) and the four new D44 tests (grouping/order, chips, empty line, chip CSS). The chip test first failed with a TypeError (no chip row); an `assert.ok(chips)` line was added so it fails as an assertion.
- Further RED steps, seen and fixed one at a time (outputs in the session, not saved): the project-creation redirect (`'/board'` ≠ `'/board?project=…'`, `hub-plan-pages` and the `hub-plan-office` `newStory` helper, 3 tests on the first full Hub run); the layout assertion for `.gwhy` (`a long word breaks inside \.gwhy`) after a measured overflow (a long unbroken word in the shared reason widened the 390px page to 782px).
- Existing tests changed and why: the two waiting-box tests (row shape, D44 (1)); "an empty project says what comes next" now reads `/?project=<id>` (D44 (3); passes on old code too, since old code ignored the parameter); the two project-creation redirect checks.
- GREEN (`U43-hub-many-projects-implement-green-1.txt`): all `tests/hub-*.test.mjs` 563/563 (load ~8); `tests/hub-board-page.test.mjs` 42/42; `npm run typecheck` exit 0.

## Screens (scratchpad copies; check Hub 18444 untouched, its DB copied with VACUUM INTO from a read-only connection)

- Many-projects data (8 projects, 3 empty, 8 waiting items for 지은), old code `1fe9292` vs new: page 3626→3152 (1360) / 6013→5466 (390); waiting box 522→498 / 1093→820; first project heading 766→798 / 1484→1474 (the phone chip row, five lines for 8 projects, uses up the height the grouping saved); projects drawn with five columns 8→5.
- Overflow and targets: 6 pages × 320/390/861/1000/1360 × light/dark × (as is, long words injected into a chip, the empty line, a grouped title and the shared reason) = 120 checks, horizontal overflow 0, every chip/link ≥ 44px.
- Check-Hub copy (2 projects, one empty): 3 chips, the empty one on the line, the one waiting item (질문) as a grouped row; no overflow at 1360 light/dark and 390 light.
