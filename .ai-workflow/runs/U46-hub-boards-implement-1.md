# U46 implement attempt 1 — 나 결정 카드 PR 2: both boards

Story: docs/understanding/pazmo-agent-office-contract.md (unchanged, edf0cb7a…; M16, V20; D41 scope, D42–D44 and U41 kept).
Plan source: N/A — small and reversible (UI only). Direction chosen by the user (explainer 7판, "나 결정 카드"); the
user said "PR 2 시작" after U45 merged. Split note: PR 2 covers both boards only; Story/Task pages and /me become PR 3,
the Story creation flow PR 4 (recorded in the change record). Base: main c6b7ca7. Commit: 841dcbe.

## Changed files
- src/hub/board-pages.ts: planTone(me, x) (need → run for a viewer who is not the plan's PL) on Story-board plan cards
  and /tasks planning cards; plan cards drop "아직 Task 없음"; the waiting row of a failed Task reads
  "Task 화면에서 이유를" instead of "아래 이유를".
- src/hub/pages.ts: .needs ul/li/a/glinks flattened (no tray, no bordered link, 44px kept), wide two-column rows;
  .titlebar h1 visually hidden; .stages flex (flex:1 1 0, min-width:0), wide-screen empty stage = 56px rail with
  vertical name (text-orientation:mixed), narrow stacks as before; .scard 1px border, no top bar, hover border accent,
  draft cards without ruled-line background.
- tests/hub-board-page.test.mjs: six U46 tests; U44 hover assertion, two grid-form stage assertions (U41/U43) and the
  plan-card markup assertion updated to the new form (same intent). tests/hub-plan-pages.test.mjs: plan-card markup.
- docs/verification/2026-11-12-hub-boards.md + 10 captures; docs/solutions/ui-bugs/count-elements-drawn-past-the-edge-when-overflow-is-clipped.md.

## TDD evidence (Node v24.19.0)
- RED: U46-hub-boards-implement-red-1.txt — 9/83 failing (board-page + plan-pages), each for the missing change.
- GREEN: U46-hub-boards-implement-green-1.txt — 98/98 (board-page, plan-pages, design-invariants) after updating the two
  grid-form stage tests; green-2 98/98 after the rail label orientation fix (upright spelled S-t-o-r-y letter by letter).
- All 43 Hub test files: U46-hub-boards-implement-hub-1.txt 589/589 + hub-1b (hub-board-store) 11/11 = 600/600.
- `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; check Hub 18444 untouched)
Before = main c6b7ca7 (`git archive`) on copies; after = this commit. 5 pages (board, another member's board, /tasks,
one-project chip, real-data copy board) × 320/390/640/861/900/1000/1360 × light/dark. After (70): horizontal overflow 0,
elements drawn past the edge outside a scroll box with all folds open 0, undersized targets 0, stages split over two rows
on windows wider than 860px 0. Board 1360px height 3065 → 2600; waiting box 816 → 673; real-copy narrowest card title at
861px 115 → 265px; empty stage 251 → 56px.

## Simplification pass
Inline: planTone shared by both boards; no other change.

## Limits
Safari/Firefox and a real screen reader not checked. The phone waiting box is still long by D44's choice.
