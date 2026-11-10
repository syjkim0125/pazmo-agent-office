# U38 (PL planning, bundle 3 of D41) implement, attempt 1

Tree: `feat/pl-planning` at `2b18dd6`, base main `3e23810`. Range `3e23810..2b18dd6`: 17 commits, 41 files, +9472 / −202. Plan `docs/plans/2026-11-05-1600-feat-pl-planning-plan.md` (commit `cefcecd`); controller rulings R1–R10 in its 판정 table; pre-flight scan (14 findings, all ruled before Task 1) and every task ruling in the SDD ledger (`.superpowers/sdd/2026-11-05-1600-feat-pl-planning-plan/progress.md`, not committed).

Executed with superpowers subagent-driven development: one fresh implementer per Task, test-first (RED seen for the right reason), then a task-scoped spec + quality review. Tasks 4, 6 and 11 needed one fix round each; Task 7 had one controller amendment before review.

| Task | Commits | Focused tests reported |
|---|---|---|
| 1 Hub `PlanBoard` (state machine, leases, approvals) | `4ea5728` | hub-plan-store 19/19 |
| 2 Hub `plan-*` link routes + Office `plan-link` | `fc82028` | hub-plan-link 7/7 |
| 3 Hub web (projects, new Story, plan page, buttons) | `774a526` | hub-plan-pages 16/16, hub-* 447/447 |
| 4 multi-repo readonly planning tree + team packet | `f139fd0`, `3d862fa` | team-plan-tree 6/6, team-branch 36/36 |
| 5 team PM/Lead readers, P5, renderers (F3 helpers shared with single-Office) | `d3f9cc9` | team-planning 11/11, planning 7/7, planning-coordinator 34/34 |
| 6 planner driver (lease, heartbeat, result, one-run slot, presence) | `f74d9d6`, `cb5afe1` | team-planner 12/12, team-office 39/39 |
| 7 G1/G3 checks + kit records (kit-shaped G3) | `0d58676`, `2f1e100` | team-plan-gates 3/3, kit-role-runs 11/11 |
| 8 split, publish, guarded Story-base push, open | `6d24d5e` | team-planner 20/20, team-branch 39/39 |
| 9 high-risk design + G3, publish the stored split | `16c21f5` | team-planner 24/24, team-executor 40/40 |
| 10 end to end: real Hub + team Office + real git | `60a6931` | hub-plan-office 3/3 (~10.6 s) |
| 11 docs: LOCAL-PREVIEW PL section, verification record, plan "구현 중 바뀐 것" | `3e8ea50`, `77b7c56`, `2b18dd6` | docs; typecheck 0, Story check 0 |

## Checks

- Full `npm test` on `60a6931` (code complete; later commits are docs only — `git diff 60a6931..2b18dd6 -- src tests` is empty): `ℹ tests 1726`, `ℹ pass 1726`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0 after 205 s → **1726/1726**.
- `npm run typecheck`: exit 0. Story check `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0.

## Not proven here

A real PL run with a real claude, real Mac Offices over a real Hub, real GitHub base branches (only local bare origins), the OpenShift Hub and two people's Macs. The whole-branch review runs as `workflow-review`; fresh kit checks as `workflow-verify`.
