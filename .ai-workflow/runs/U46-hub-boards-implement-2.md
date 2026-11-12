# U46 implement attempt 2 — review 1 fixes

Review 1 (U46-hub-boards-review-1.md): Ready, Minor 6. Applied in commit d39c036:
- Minor 1: a test pins the viewer tone of plan cards on /tasks (PL: card need + pill need; B: card run + pill run). It
  passed before the fix (the code was right); it now guards the /tasks half.
- Minor 2: `boardFailure()` in src/hub/board-pages.ts is used by the failed Task card (both boards) and the waiting row:
  "Task 화면에서 이유를" instead of "아래 이유를". The Task page keeps its words. Test: /tasks and the Story page carry no
  "아래 이유를" and show the board wording.
- Minor 3: `.needs .ghead .count{background:var(--tray)}` (was --panel on a transparent row inside a --panel section).
- Minor 5: checklist rule 5 cites a Task card's left bar instead of the Story card's removed top bar; "How to measure"
  starts with opening every <details> and counting elements drawn past the edge; the board-pages comment no longer says
  every project's stages line up.
- Not applied: Minor 4 (plan page tone for non-PLs) belongs to PR 4's screen — recorded in the change record; Minor 6
  (faint dark-theme card edges, optional) recorded.

## Evidence (Node v24.19.0)
- RED: U46-hub-boards-implement-red-2.txt — 2/6 U46 tests failing (wording, count chip).
- GREEN: U46-hub-boards-implement-green-3.txt — 130/130 (board-page, plan-pages, design-invariants, story-pages).
- All 43 Hub test files: U46-hub-boards-implement-hub-2.txt — 600/600. `npx tsc --noEmit -p .` exit 0.
- Browser re-measure on restarted preview Hubs (copies only): 70 after-checks, overflow 0, past edge 0, small 0,
  split stage rows above 860px 0; record captures rebuilt.
