# U37 (teammate web, bundle 2 of D41) implement, attempt 1

Tree: `claude/silly-liskov-b64760` at `579ac84`, on main `8055471` (PR #75, bundle 1). Range against main: `8055471..579ac84`, 8 commits (plan + 7 Tasks).

## What was built (plan `docs/plans/2026-11-05-1200-feat-teammate-web-plan.md`, Tasks 1–7)

Executed with superpowers subagent-driven development: one fresh implementer per Task, then a task-scoped spec + quality review. Every Task review was clean on the first pass (no fix rounds). The controller's rulings and every deferred minor are in the SDD ledger (`.superpowers/sdd/2026-11-05-1200-feat-teammate-web-plan/progress.md`, not committed) and in the verification record's 판정 적용.

| Task | Commit | Task-level tests (focused) |
|---|---|---|
| 1 Hub store: auto-work switch, pick, web rerun, member work, Actor | `8f3119c` | 16/16 new; hub+team 796/796 |
| 2 Hub store/Mac API: `until`, `macWait`, `liveLinkRepos` | `30c60ab` | 50/50 mac files; hub 365/365 |
| 3 Office heartbeat `until` | `0fdd477` | team 437/437 |
| 4 Hub web pages: 내 할 일, 보드, Story, Task 상세; request board → `/requests` | `f8e4487` | 17/17 new; hub+team 819/819 |
| 5 Hub web POSTs: switch, pick, rerun, release, cancel | `7e27d39` | 25/25 pages; hub 394/394 |
| 6 web action → real scheduler (characterization, 6 mutations caught) | `ddc0ece` | 4/4 |
| 7 docs: LOCAL-PREVIEW "팀원 웹", verification record | `579ac84` | docs |

RED/GREEN: Tasks 1–5 wrote failing tests first (RED counts in each task report). Task 6 tests pass from the start by design (no Office change); non-vacuity shown by 6 mutations, each run in an isolated archive copy and each caught.

## Checks on `7e27d39` (code head; `579ac84` adds docs only)

- Full `npm test` (one run, nothing else testing): **1607/1607**, exit 0, 119 s.
- `npm run typecheck`: exit 0.
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0.

## Story

No Story change; the run's Story fingerprint is the one G1 approved (D41). Bundle 2's rulings are plan-level (labelled ASSUMED where safe defaults) and listed in the plan's 판정 table.
