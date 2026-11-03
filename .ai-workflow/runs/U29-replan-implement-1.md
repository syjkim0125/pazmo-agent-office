# U29 (after merging main #50–#56) implement — attempt 1

Team Story board stage 3 (Story Task mode), plan `docs/plans/2026-10-30-1500-feat-team-story-task-mode-plan.md`, Story M16 · V18 · D24 · D34. Implemented task by task with TDD (RED shown before each change) in the app worktree `.claude/worktrees/compound-team-office`.

This run replaces `U29-team-story-task-mode.json` (started 2026-10-30 as U26, implement never recorded). Main's #51 had taken U26, and merging origin/main `43d18f6` on 2026-11-02 (`a3f3e1f`) changed the Story, so that run is stale; it stays as history.

Commits relative to origin/main `43d18f6`:

- Task 1 `7d7923e`: Hub `claim` names the member's open Task (`openTaskOf`); Story link report calls.
- Task 2 `0c8d97c`: team store phases, attempts, pending report, rerun request.
- Task 3 `19bf76d`, `c18637a`: claim only when a Story Task can run; an exit for every Hub answer.
- Task 4 `205c214`, `677c162`, `7d83011`: git steps in an Office-owned linked worktree; the reset guard.
- Task 5 `3150838`, `b2ca08b`: PR open/merge with the person's gh; same-Story base/head checks.
- Task 6 `6394bfb`, `e0ff2e9`: Hub Story Task → engine contract (story.md, task-1.md, verify-1.json, plan.md).
- Task 7 `72a2ad2`, `1ab0085`: engine Story Task from the Engineer to a verified candidate, no Task G4; `LiveRuntime.verify`.
- Merge fix-up `62c85f7`: the Hub claim test uses main's `app-be` alias.
- Task 8 `919f57d`, `af22cc3`, `0448352`: the executor state machine (`src/team/executor.ts`), store-first steps, owed merge unlock, lock-first merge step.
- Task 9 `848121e`, `46ebe90`, `8e74319`: team Office wiring, `team rerun --memo`, docs, D34; a locked Office leaves verified/merging records for a live start; runner checks only when a claim could follow.
- Final review fixes `cee9ff8`, `dec5c9c`, `d902128`, `1217710`, `c389101`, `957ec6e`: merge only at the pushed head; a closed PR is a stop; the lock is asked again before `mergePr`; a refused report is never re-claimed; minors and docs.

Scope: `src/` and `tests/` 36 files (+9154 −346), `docs/` 6 files (+721 −58), the plan and the run files. Tests per task are in the task reports; the fresh full run is in `U29-replan-verify-1.md`.
