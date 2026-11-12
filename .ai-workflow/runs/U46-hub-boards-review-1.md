# U46 review 1 — independent reviewer (c6b7ca7..841dcbe), copied from the reviewer's final answer

Verdict: Ready. Critical 0, Important 0, Minor 6.

## Minor
1. /tasks plan-card tone has no test (board-pages.ts:349; hub-board-page.test.mjs:1192). Reverting the /tasks lane to
   `tone("plan", x.state)` in a scratch copy still passed 83/83. Fix: also check /tasks as B (card run, pill run 초안) and
   as the PL (card need). The Story-board half is guarded (a never-flipping planTone failed that test, 61/62).
2. The board still says "아래 이유를" in the failed Task card (board-pages.ts:87): on /tasks the waiting row reads
   "Task 화면에서 이유를…" but the failed card below still reads "…아래 이유를 보고…" with nothing below; same on the Story
   page's Task board. Fix: one boardFailure() helper at :87 and :212 (/me's story-pages.ts:116 can wait for PR 3).
3. The waiting row's count badge became invisible (pages.ts:71 `.needs .ghead .count{background:var(--panel)}`): the row
   is now transparent inside a --panel section; measured rgb(255,255,255) on rgb(255,255,255) (light) and rgb(26,34,45)
   on the same (dark). Fix: `background:var(--tray)` or drop the override.
4. The plan page still shows other members the PL's turn (plan-pages.ts:197 `tone("plan", v.state)`): B sees blue 초안 on
   the board, orange one click later; hub-plan-pages.test.mjs pins need for h.b in TONES. Fix: run when !v.isPl, or record
   as PR 3/4 scope.
5. Stale words: checklist rule 5 (hub-design-checklist.md:45-46) still says a Story card's hover leaves its top state bar
   alone; its "How to measure" (:81) does not say to open every <details> first; board-pages.ts:316 comment "every
   project's stages line up" — with rails they no longer do across projects (1360px: 결제 v2 56/1032/56/56/56, 쿠폰 개편
   251×5); confirm intended and reword.
6. (optional) Card edges faint in dark mode: 1px --line edge 1.38:1 on the tray, card fill 1.06:1, no shadow; readable.

## Verified (summary)
- planTone for every plan state and viewer (pl/mj/he/admin), before vs after: only 질문/초안/설계 승인 대기 flip
  need→run for non-PLs, 멈춤 stays stop, PL view unchanged; 나를 기다리는 일 identical except the reason text; matches
  plan-store #actions (only the PL may answer/rewrite/approve/retry; admin may cancel).
- "아래 이유를" replacement: plainFailure returns fixed sentences, exactly two contain the phrase; still esc()'d; the Task
  page keeps its words.
- One row and equal shares: 7 pages × 320/390/640/861/880/900/960/961/1000/1360 × 2 themes, folds open: 0 past edge,
  scrollWidth = width, every .stages one row above 860; all five stages filled: 154.6px each at 861 (as before), narrowest
  card title 117px (115 before); long-word stress (60-letter Hangul + 55-letter Latin) still one row, 0 past edge.
- Rails 56px; label contrast 5.26–5.61 (light) / 7.01–7.37 (dark), count 6.19/6.63; nothing focusable in a rail; a stage
  with 이전 완료 보기 can never be a rail.
- Headings: one h1 per board (1×1); h1 → h2 나를 기다리는 일 → h2 project → h3 stage.
- Hover 1px accent border all round, keyboard focus 3px accent outline; both themes.
- Removed lines: :focus-visible/outline 3 removed and 3 added; no aria or reduced-motion removed; lost tokens are the
  intended --*-bar on .scard and --bg on .needs li.
- hub-board-page.test.mjs 62/62 in a scratch copy of HEAD.

## Coverage limits
Headless Chromium only (no Safari/Firefox for :has and vertical text, no real screen reader, no touch-emulation target
check); 200% zoom only as a 640px window; no full suite or typecheck; demo hub plus one real-data copy.
Scratch: /private/tmp/claude-502/-Users-jongkkim-Documents-pazmo-agent-office/aa29f576-03cb-4627-bfad-969c719aef70/scratchpad/review-u46/
