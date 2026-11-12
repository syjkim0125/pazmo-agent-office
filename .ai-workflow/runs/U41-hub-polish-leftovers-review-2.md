Verdict: Ready

Round 2 of the U41 review: fix commit a635bcc (`git diff ec1ae2b..a635bcc`), checked against the four Minor findings from review 1 and for anything new.

## Review-1 findings: all four are resolved

1. **Change record measured the wrong column (resolved).**
   - What changed: the docs now give each column kind its own margin; `.stage[data-stage=planning]{padding:6px}` was added in src/hub/pages.ts:153.
   - Measured in headless Chromium at 861px: the 기획 중 draft card text box and the Story 검증 card text box are both 114px. "설계 승인 대기" (107px) fits on one line with a 7px margin.
   - At 961px (outside the rule) the boxes are 115px (기획 중) and 119px (others).
   - The corrected numbers now match the measurements: docs/verification/2026-11-11-hub-polish-leftovers.md:11, :12, :32, :34, :47 and STATUS:5-6.
   - The new reason for the rename is accurate: "Story 검증 중" (108.6px) would fit the 114px box, so the rename is about evenness and margin.
2. **Draft card and draft page disagreed (resolved).**
   - What changed: progressOf returns `Task N개 준비됨` for a draft Story, and draftCard uses it (src/hub/board-pages.ts:145, :161).
   - Probe on a635bcc:
     - draft card says `Task 3개 준비됨`;
     - draft page says `<p class="sprog">Task 3개 준비됨</p>` with no bar;
     - the same Story after cancelStory says `Task 3개 취소됨` on both page and card;
     - a draft title containing `<b>` is still escaped.
   - The comment on progressOf now states the lane exception correctly; drafts never get a storyLane.
3. **Gap between the media queries (resolved).**
   - What changed: `@media (width > 860px) and (width <= 960px)`, and the card rule is scoped to `.stages .scard`.
   - At 4× device scale factor, true layout widths of 860.25, 860.5 and 860.75px match the range: one row, 8px gap, 114px boxes. The old code shows 2 rows at those widths.
   - At 860px the board stacks as on a phone. At 960.5px and 961px the normal spacing returns.
   - The cards in the 취소됨 strip keep `14px 16px` padding inside the range.
4. **No page test pinned the new word "검증 중" (resolved).**
   - tests/hub-board-page.test.mjs:168-171 assert the exact `<span class="pill run">검증 중</span>` on the card, the /tasks lane and the Story page.
   - Run against a3ef064, that test fails at "the card", as intended.

## New findings
None (Critical 0, Important 0, Minor 0).

One note, not a finding: older browsers only lose the tighter spacing. The range syntax needs Chrome 104+, Firefox 63+ or Safari 16.4+. A browser without it drops only the 861–960px rule, so there is no overflow and the one-row layout is unchanged; long pills may wrap.
- The stylesheet already depends on `:has()` (Chrome 105+, Firefox 121+, Safari 15.4+).
- So the only newly affected browsers are Safari 15.4–16.3.

## What I checked
- **Diff read:** src/hub/board-pages.ts, src/hub/pages.ts, tests/hub-board-page.test.mjs, and the four docs (STATUS, LOCAL-PREVIEW, the change record, the grid learning doc).
- **Specificity of the new rules:**
  - `.stages .scard` (0,2,0) beats `.scard` (0,1,0).
  - `.stage[data-stage=planning]` (0,2,0) beats `.stage` (0,1,0) inside the same block.
  - Neither touches the ≤860px rules.
- **Changed tests on a635bcc** (`node24 --test tests/hub-board-page.test.mjs tests/hub-story-pages.test.mjs`): exit 0, 68/68 passed.
- **Related files that render draft cards and pages** (`tests/hub-plan-pages.test.mjs tests/hub-story-upload.test.mjs`): exit 0, 34/34 passed.
- **New tests against ec1ae2b** (git archive in scratchpad/rv-mid): exit 1, 66/68 passed, 2/68 failed.
  - "planning lanes" failed at "the Story page".
  - The stage CSS test failed on the range-syntax regex.
  - Both fail for the intended reason, and this matches the author's "RED 2/68".
- **New hub-board-page tests against a3ef064:** exit 1, 33/38 passed, 5/38 failed. "story card shows state…" now fails at "the card".
- **Probe tests** (scratchpad/rv-probe, importing worktree src): exit 0, 2/2 passed. Output is quoted under finding 2.
- **Headless Chromium** (playwright cache chrome-headless-shell-1234, scratchpad profile, iframes inside a scratchpad wrapper served from 18600):
  - Pages: after-demo/board.html and board-cancelled.html, plus before-demo/board.html.
  - Widths: 860, 861, 870, 887, 900, 960, 961 and 1000px, plus 860.25, 860.5, 860.75 and 960.5px.
  - After: 0 horizontal overflow, one row above 860px, stacked at 860px.
  - Injected "설계 승인 대기", "멈춘 Task 12" and "Story 검증 중" were all one line (26px) at every width.
  - Before: 2 rows at 861–887px and 860.x; at 900px three "Story 검증 중" pills on two lines, which confirms the bug again.
- **Doc claims vs code:**
  - All doc claims match the code and the measurements: 114px at 861px, 115–119px at 961px, the 7px margin, and "888px: 기획 중 99px쯤, 다른 칸 104px" (computed 100/104).
  - STATUS's review-1 summary matches my report.
  - I viewed the retaken capture after-board-900-dark.jpg: one row, "검증 중" pills on one line.
- **Hygiene:** `git diff --check ec1ae2b..a635bcc` exit 0; internal-name grep of the added lines found 0 matches.

## Coverage limits
- Not run: the full `npm test`, all Hub test files (559/559 claimed), and typecheck.
- Not measured in a browser:
  - dark theme;
  - 390px;
  - /tasks;
  - the Story page;
  - Safari, Firefox and Windows fonts.
- The demo data still has no real "설계 승인 대기" web-plan card, so that pill was measured by injection.
- This round I did not use the Playwright MCP, and I wrote nothing in the worktree. The ignored file `.playwright-mcp/console-…710Z.log` there shows a write at 10:47 that came from another session. All my files are under the scratchpad (rv-mid, rv-probe, pages/rv, rv-chrome-profile, logs).
