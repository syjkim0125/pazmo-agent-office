# U47 implement attempt 1 — 나 결정 카드 PR 3: 지금 할 일 on the Task, Story and /me pages

Story: docs/understanding/pazmo-agent-office-contract.md (unchanged, edf0cb7a…; M16, V20; D41 scope). Plan source:
N/A — small and reversible (UI only). Direction chosen by the user (explainer 7판); "PR 3 시작" after U46 merged.
Base: main 2a5c7d7. Branch hub-na-pages. Commit: 1b6e01a.

## Changed files
- src/hub/story-pages.ts: `failureElsewhere()` (exported); /me card() links the Story, failureLine uses it, a stopped
  open Task makes its section `section.decide` ("지금 할 일"); storyPage: a PL-only decide card (stopped Tasks with links
  and plain reasons; the result approval), AWAITING_G4 under the steps only for non-PLs, the uploaded draft's cancel form
  inside `details.other` "이 Story 취소"; taskPage: actionForms returns {primary, rest, notes}; primary = rerun, else
  release, else pick; a decide card holds the stop reason, the primary form and `details.other` "다른 방법" with the rest;
  with no primary the rest folds in the head under "이 Task 바꾸기"; notes stay in the head.
- src/hub/board-pages.ts: boardFailure() uses failureElsewhere().
- src/hub/pages.ts: tray rule excludes section.decide; `section.decide{border:2px solid var(--need-bar)}`,
  `.decide form{background:none;padding:0}`, `details.other>summary` muted; `ul.work>li` rows split by lines; `.steps li`
  a 4px top bar and a name, `.steps li.past` done bar, `.steps li[aria-current=step]` fg bar.
- tests/hub-board-page.test.mjs: six U47 tests. tests/hub-story-pages.test.mjs: two /me expectations follow the intended
  changes (board wording on /me; the stopped Task's section heading is 지금 할 일).
- docs/verification/2026-11-12-hub-pages.md + 10 captures.

## TDD evidence (Node v24.19.0)
- RED: U47-hub-pages-implement-red-1.txt — 6/6 U47 tests failing on the missing card, links, wording and styles.
- GREEN: U47-hub-pages-implement-green-1.txt — 133/133 (board-page, story-pages, design-invariants, story-upload,
  web-office), after correcting my own test (the PL cannot rerun C's Task: rerun follows the assignee's link; the PL's
  card action is 풀기, 취소 folds) and two older /me expectations.
- All 43 Hub test files: U47-hub-pages-implement-hub-1.txt — 606/606. `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; check Hub 18444 untouched)
Before = main 2a5c7d7 (`git archive`), after = 1b6e01a. 10 pages (Task failed as assignee and as PL, Mac-silent Task as
PL, running→silent Task as PL, Story as PL and as another member, /me as 정하은 and 박지수, real-copy Story and Task) ×
320/390/861/1360 × light/dark = 80 after-checks: overflow 0, past edge 0 (folds open); the one undersized hit was the
22px checkbox whose label is 322×44 (checklist rule 3 counts the label).

## Simplification pass
Inline: one failureElsewhere() for boards, /me and the Story card; actionForms returns parts instead of a joined string.

## Limits
Safari/Firefox and a real screen reader not checked. In the demo data 정하은 cannot rerun her own failed Task (same
before and after; out of scope).
