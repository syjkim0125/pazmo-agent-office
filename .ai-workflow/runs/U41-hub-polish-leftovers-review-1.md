Verdict: Ready

Review of `git diff a3ef064..ec1ae2b` (U41, kit node `workflow-review`). All three leftovers are fixed as claimed and the hard
constraints hold. Routes, forms, permissions, CSRF/Origin and the no-JS paths are unchanged. live.js does not read any changed markup.
Every new output is a number or a fixed string, so escaping is unaffected. No internal names appear in added lines, and
`git diff --check` is clean. The four findings below are all Minor and none blocks a merge.

## Findings

1. Minor: the change record measures the wrong column for both pill claims
   (docs/verification/2026-11-11-hub-polish-leftovers.md:11, :12, :45)
   - What it says: the narrowest text box at 861px is 114px, so "설계 승인 대기" (107px) fits with 7px to spare. It also
     says padding alone could not fit "Story 검증 중" ("글자 칸 99–114px").
   - What the code does: "설계 승인 대기" is a web-plan state, so it only ever appears on draft cards in the dashed 기획 중
     column. That column has a 2px stage border and a 2px dashed card border. At 861px its card text box is
     157.8 − 4 − 16 − 4 − 24 ≈ 109.8px, so the real margin is about 3px. The 7px margin belongs to the other columns, where
     "멈춘 Task 12" lives.
   - The other way round: "Story 검증 중" only ever appears in the Story 검증 column, which is 114px wide (I measured it).
     I injected that pill at 861, 870, 887, 888, 900, 960, 961 and 1000px with the new CSS, and it stayed on one line
     (26px) every time.
   - Where "99" seems to come from: it matches the 기획 중 draft box under U40's old padding at 888px, not anything in the new layout.
   - Scenario: someone reads ":45" and assumes a 7px font tolerance near 861px. A slightly wider font (for example Windows
     Malgun Gothic) would wrap "설계 승인 대기" on web-plan cards first.
   - Fix: the change record is frozen, so correct the numbers in the STATUS entry: about 110px and about 3px in 기획 중.
     The rename stays justified by consistency with 진행 중 and 승인 대기, not by the padding argument. Optionally, give
     기획 중 cards 2–4px more room in the 861–960 range, for example `.stage[data-stage=planning]{padding:6px}`.

2. Minor: progressOf's comment overclaims, and draft Stories still disagree between card and page
   (src/hub/board-pages.ts:139-147 vs :160)
   - The comment says the progress line is "the same on its card, its page and its /tasks lane". That is not true for a
     draft Story.
   - Probe result (team fixture on the new code, publish without open):
     - The board card says `Task 3개 준비됨`.
     - `/stories/<id>` says `<progress value="0" max="3">Task 3개 중 0개 끝`.
   - This is the same class of mismatch that item 3 fixed for cancelled Stories, and an uploaded draft can sit in 기획 중
     for a while. The draft card is not in U41's stated scope.
   - Fix (either one):
     - Return `Task ${total}개 준비됨` from progressOf when `s.state === "draft"` and have draftCard use progressOf. Add a
       test for it.
     - Or narrow the comment to live and cancelled Stories, and list the draft case under 남은 것 in STATUS.

3. Minor: a width gap between the two media queries, and the tightening reaches cards that don't need it
   (src/hub/pages.ts:153)
   - The gap: `(min-width:861px) and (max-width:960px)` next to `(max-width:860px)` matches nothing for fractional
     viewport widths between 860 and 861 (browser zoom, non-integer DPR). At those widths the stages are still one row
     (column flow is the base), but without the tighter spacing.
   - Computed at 860.5px: the text box is about 98px, so "멈춘 Task 12" and "설계 승인 대기" wrap. There is no horizontal
     overflow. This is rare and cosmetic.
   - The extra reach: `.scard{padding:12px}` also hits the cancelled-strip cards (`.cancelled .scards`, tracks of 240px
     and up), which do not need it. This is harmless.
   - Fix: `@media (width > 860px) and (width <= 960px){...}` (range syntax is supported by every target browser), and scope
     the selector to `.stages .scard`. Update the CSS-text assertion in tests/hub-board-page.test.mjs:763 to match.

4. Minor: no rendered-page test pins the new word "검증 중" (tests/hub-board-page.test.mjs:158)
   - `lane.includes("검증 중")` also passes on the old "Story 검증 중", because it is a substring. I ran the new tests
     against the old code and this test passed.
   - Only the storyStateLabel unit test (tests/hub-story-pages.test.mjs:297) fails on the old word.
   - Scenario: a later change renders the long word on the board again and this test still passes.
   - Fix: assert `<span class="pill run">검증 중</span>`, or `>검증 중</span>` without "Story " in front, on the card. Also
     assert it on the `/tasks` lane and the Story page.

Already disclosed by the author, so no action: on the board card the cancelled Story's "취소됨" pill is grey, but on its
page and its /tasks lane it is green (`tone("story","cancelled")` is "done"). U41 fixed the counting text, which now
matches on all three.

## What I checked
- Code read in full:
  - board-pages.ts: storyCard, storyLane, storyTaskBoard, counts, goneLine, progressOf, draftCard, storyBoardPage, taskBoardPage.
  - story-pages.ts: STORY_STATE, STEPS, storyPage.
  - pages.ts: STYLE, including both media queries and tone().
  - server.ts:296-300: the Story page route.
  - story-store.ts: board, storyBoard, #boardStory with doneMore, cancelStory.
  - live-script.ts: the selectors it uses.
- Counting edge cases, all hold:
  - On the Story board and /tasks, cancelled Stories and their hidden cards appear only together under `cancelled=1`, so
    the 취소됨 count is complete.
  - Done cards folded into doneMore are counted in "끝남" on both boards.
  - The Story page uses doneMax=Infinity, so doneMore is 0 and every done card is counted directly.
  - cancelStory also cancels the Story verify Task, so a cancelled Story never shows "아직 Task 없음".
  - A live non-draft Story always keeps its verify Task, so the lane's new "아직 Task 없음" case cannot be reached.
- Every remaining "Story 검증 중" in src and docs is either a 409 error message (story-store.ts:774) or historical plan
  text. Stage names "Story 검증" (STAGES, STEPS) are unchanged, as D42/D43 require.
- `node24 --test tests/hub-board-page.test.mjs tests/hub-story-pages.test.mjs`: exit 0, 68/68 passed (load average about 20).
- The same two new test files run against a3ef064, from a git archive in the scratchpad (rv-old): exit 1, 4/68 failed, 64/68 passed.
  - Failing: stage CSS, long-word CSS, cancelled page/lane, state words. Each failed for the intended reason.
  - The author's RED of 3/68 predates the edit to the long-word assertion, so the two counts are consistent.
- Probe test (scratchpad rv-probe, new code): exit 0, 1/1 passed. It showed the draft card/page mismatch in finding 2.
- Live GET on 18571 (new) and 18573 (old), Story #24 (cancelled):
  - Page: old `<bar>Task 1개 중 1개 끝`, new `Task 3개 취소됨 · 1개 끝남`.
  - /tasks lane: the same change.
  - The board card already said `Task 3개 취소됨 · 1개 끝남`.
- Chromium (Playwright) on the saved after-demo/board.html at 861, 870, 887, 888, 900, 960, 961 and 1000px:
  - Stages on one row in both projects, 0px horizontal overflow, no pill taller than one line.
  - Card text box 114/116/119/119/122/134/119/126px (Story 검증, 승인 대기 and 완료 columns).
  - Injected pills, all one line (26px): 설계 승인 대기 107, 멈춘 Task 12 106.8, Story 검증 중 108.6, 나누기 대기 92.5px.
- Same check on before-demo/board.html:
  - 861 and 887px: 2 rows.
  - 888 and 900px: 1 row, with "Story 검증 중" on two lines.
  - This confirms both the bug and the record's corrected "888px부터" claim in STATUS.
- Arithmetic for the 기획 중 draft box at 861px: (821 − 4·8)/5 = 157.8, then − 4 − 16 − 4 − 24 = 109.8px.
- All nine capture links in the change record resolve.
- I viewed after-board-870-light.jpg: one row of five stages, "검증 중" on one line.

## Coverage limits
- I did not run the full `npm test`, nor the claimed "Hub 시험 파일 전부 559/559".
- I did not re-run typecheck.
- I did not re-measure the claimed 41 screens × 10 widths × 2 themes. My own browser checks cover:
  - Story board only (saved page), light theme.
  - Not dark, not 390px, not /tasks or the Story page in a browser.
- I did not check the planning column with a real "설계 승인 대기" plan card, because the demo data has none. Finding 1
  rests on computed widths.
- I did not check Safari, Firefox or Windows fonts. There is no browser-level test in the suite; the CSS tests only match
  stylesheet text.
- Side effect: the Playwright MCP server appended console lines to
  `<worktree>/.playwright-mcp/console-2026-11-11T08-47-59-710Z.log`. An earlier session created that file at 17:47. The
  file is gitignored, and `.ai-workflow/graph/snapshot.mjs` uses `ls-files --others --exclude-standard`, so the snapshot
  should be unaffected. I made no other writes outside the scratchpad.
