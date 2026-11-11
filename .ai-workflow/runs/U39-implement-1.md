# U39 implement — attempt 1

Plan: docs/plans/2026-11-11-1400-feat-hub-board-plan.md (8 tasks, subagent-driven; each task implemented by a fresh agent and reviewed by a separate reviewer for spec and quality; fix rounds re-reviewed).
Story: D42 / V20 (G1 2026-11-11), design G3 2026-11-11 (docs/understanding/hub-board-local-upload-plan.md).

| Task | Commits | Review |
|---|---|---|
| 1 board data (column_at, board(), macBadges) | b93b2f2, 0b62de6 | clean (pre-review fix: failed Task keeps its column) |
| 2 board page, menus, /me, /team, safePath | 1c0cbed | clean |
| 3 live refresh (/live.js, ETag/304, CSP connect-src) | d3e11df | clean |
| 4 landing (pazmo_next, invite → board, /start copy) | 9d9b583 | clean |
| 5 plain words, tone colors | b86a22c, e56a944 | fix round 1: G3 split inner folds removed |
| 6 Hub upload routes | 2af7c83, f27fafc | fix round 1: shared mergeBases, 409 STATE for non-upload Story under key, current-Mac check on upload-bases, admin cancel test |
| 7 team upload command, story-bases extraction, SKILL.md | 59df0b4, d016c44, 75fe8ca | fix round 1: registered-clone-unchanged test, G3 design from kit profile |
| 8 guide copy on mac connect, docs | ff018b3, e89cd58 | clean |

TDD: each task's report records RED then GREEN (Task 3's RED was shown after the fact: 4/10 server-side tests failed on the pre-task source).
Tests at e89cd58: full `npm test` 1831/1831 (Task 8, no other run in progress), `npm run typecheck` exit 0. Per-task focused counts: hub-board-store 11/11, hub-board-page 15/15, hub-live 10/10, hub-landing 5/5, hub-plain-words 6/6, hub-story-upload 12/12, team-upload 9/9, hub-upload-office 5/5, mac-skill-copy 3/3.
Changed areas: src/hub (board.ts, board-pages.ts, paths.ts, live-script.ts, pages.ts, server.ts, story-store.ts, store.ts, plan-store.ts, plan-pages.ts, story-pages.ts, link-api.ts), src/team (upload.ts, story-bases.ts, planner.ts), src/cli (team.ts, index.ts, mac.ts), skills/pazmo-hub-upload/SKILL.md, tests, docs/LOCAL-PREVIEW.md, docs/verification/2026-11-11-hub-board.md.
Limits: the change record's per-file counts come from task reports; company Hub redeploy, two real Macs and real claude-written Task files are not checked here.
