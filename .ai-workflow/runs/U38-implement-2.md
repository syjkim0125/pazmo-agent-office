# U38 (PL planning) implement, attempt 2

Reset reason: `.ai-workflow/runs/U38-review-1.md` (3 reviewers: Critical 0, Important 5) — fix H1–H11 before merge.

Tree: `c9676dd` on top of `2b18dd6`. Fix range `2b18dd6..c9676dd`: 5 commits. Two implementers in parallel on disjoint files under one fixed wire contract (Office holder id on plan-next/heartbeat/result; heartbeat STATE carries the plan state; base commits stored once on the Hub via heartbeat; repo snapshot at createPlan; split digest line in the design text); each test-first. The controller updated the docs.

| Fix | Commits | Focused tests reported |
|---|---|---|
| H4 Office half — digest line `나누기 지문` in the design text, re-checked in `checkApprovals` | `087fb6e` | team-plan-gates 4/4, team-planning 14/14 |
| Hub — lease holder, STATE state, base commits stored once (`BASES_CHANGED`), repo snapshot + ownership/project re-check at approve and before leasing design/splitting (`REPOS_CHANGED`), full split on the G3 page (H4), H2 cancel → `open` with Story link, H10 Mac/held-Task lines, H11 unlinked repos named | `d1f940d` | hub-plan-store 27/27, hub-plan-link 11/11, hub-plan-pages 21/21, hub neighbours pass |
| Office — holder id, cancel a draft only for `cancelled`, bases via heartbeat and Hub bases preferred, H1 opened Story → `open` without bases, H6 BASE_EXISTS wording, H7 planner waits for an idle executor, H8 stop after `next()`, H9 cancel check after publish; additive `hubCall` state copy and `executor.busy()` | `b532f66` | team-planner 28/28, team-plan-link 3/3, team-office 41/41, team-executor 41/41 |
| e2e — retry a half-made Story from a Mac that lost `bases.json`, at the Hub's base commits | `a359f38` | hub-plan-office 3/3 |
| Docs — LOCAL-PREVIEW, verification record ("마지막 리뷰 뒤 고친 것", limits), plan "마지막 리뷰 뒤 바뀐 것" | `c9676dd` | docs |

## Checks on `a359f38` (code identical to `c9676dd`; that commit is docs only)

- Full `npm test`: `ℹ tests 1754`, `ℹ pass 1754`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0 after 127 s → **1754/1754**.
- `npm run typecheck`: exit 0. Story check: exit 0.

## Decisions (cost if wrong)

- Approve checks ownership per snapshot repo (a repo added to the project later does not block approval).
- Storing base commits does not bump the plan revision (the step's own result stays valid).
- The unlinked-repo line is hidden while the PL holds a Task or the Mac is off/locked; the Mac line during a lease shows only for `off`.
- `d1f940d` alone fails `hub-plan-link`'s planLink tests until `b532f66` (shared contract); the branch head passes.

## Not proven here

Real claude, real Mac Offices over a real Hub, real GitHub base branches, the OpenShift Hub and two people's Macs.
