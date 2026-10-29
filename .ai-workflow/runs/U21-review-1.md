# U21 workflow-review attempt 1: team Story board stage 2 (one Office, several repos)

Reviewers: independent read-only subagents (superpowers subagent-driven-development task and final review templates). Each got the task brief or the whole-branch diff and the approved decision (`docs/understanding/team-story-board-decision.md`, 구현 단계 2), not this session's history.

## Per-task reviews (7 tasks, plan `docs/plans/2026-10-27-1730-feat-team-story-office-repos-plan.md`)

| Task | Commits | Verdict |
|---|---|---|
| 1 registry, add/remove/list | 6d1efa6..9304e4e | Approved, no Critical/Important |
| 2 store, pause/resume/cap/status | 5e303e5..281a8d4 | Approved, no Critical/Important |
| 3 gh status probe | 281a8d4..8f42dc4 | Approved, no Critical/Important |
| 4 Story link to the Hub | 8f42dc4..748bf39 | Approved, no Critical/Important |
| 5 claim scheduler | 748bf39..f6b84a4 | Important 1 (a `retry` ended the whole tick, so one bad lane starved later lanes). Fixed in 1 round: the lane is skipped and the loop continues |
| 6 shared one-run gate | f6b84a4..99ae022 | Important 1 (the host's onSettled was skipped when the engine's own pump threw, stranding a peer). Fixed in 1 round: separate try/catch |
| 7 team Office, lifecycle, CLI, docs | 99ae022..6d62c71 | Approved, no Critical/Important |

Minor findings were deferred in the ledger; the ones that mattered were carried into later tasks (Task 7 caught timer rejections, kept the round-robin peer refresh, re-evaluated refused lanes every 300 s, and made `team remove` refuse a repo holding the open claim).

## Final whole-branch review (opus, eeef710..6d62c71)

Verdict: With fixes. Important 4, all fixed in one wave (5434f30, 7d5e061, 9daa7ce) and re-reviewed (sonnet, 6d62c71..9daa7ce: all 7 items addressed, no new Critical/Important):

1. A heartbeat answered 404 NOT_FOUND kept the open record forever. Now it drops the record (guarded by claimId); the next inbox recovery re-records it if the Task is still this member's.
2. A registered repo whose folder is missing failed with a raw ENOENT, and `team remove` refused it with OPEN_CLAIM. Now REPO_MISSING names the path and `team remove --project`; removing a missing folder drops the local record (REPO_REMOVED).
3. Docs claimed merge readiness and stale test counts before review and G4. Corrected.
4. Leftover lean work in a registered repo could resume unseen under a live team Office. Stage 2 now opens every repo engine locked (no live runtime, no ensureDefault).

Cheap minors in the same wave: `teamRunning` also treats `team/start.lock` as running; OPEN_CLAIM and LOCAL-PREVIEW wording; the internal Git host in the decision doc replaced with a placeholder (public repo).

## Parked (rulings in the SDD ledger)

- A stale `team/start.lock` (Ctrl-C during start) blocks `team add/remove` with TEAM_RUNNING; deleting it recovers, same as every engine's start lock.
- `status --team` reports execution "ready" under `--live` although engines are locked, so `up --team` can reuse a running Office; LOCAL-PREVIEW says so.
- No local escape for an open claim whose Hub is permanently unreachable; relinking to a reachable Hub clears it via 404. A `team drop` command is a stage 3/5 candidate.
- Stage 3 must not claim while execution is locked (`start --team` without `--live` still claims and heartbeats in stage 2).

## Limits

No review ran a real team Office against the shared Hub or a real repo task: stage 2 claims and heartbeats only. Execution of a claimed Task is stage 3.
