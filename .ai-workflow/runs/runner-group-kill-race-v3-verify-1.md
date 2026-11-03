# runner-group-kill-race v3 · workflow-verify (attempt 1)

Snapshot `eb64ec53048d…`:
- HEAD `d05d554` (this change's three commits on main `4a6d6ed`)
- plus the uncommitted doc edits of implement attempt 2: `docs/STATUS.md` and the solutions doc

The kit `graph verify` receipts are under `.ai-workflow/evidence/cd6a38c4-fd7b-4719-a507-d56a83d63638/`. Node v24.19.0 was first on PATH. Each check started only when no other `--test` process was running (checked with `pgrep` before each one). The checks started 2026-11-03 15:56:54 KST. Every check reported the same snapshot.

- tests-1of3: passed, exit 0, 47.1 s, 436/436
- tests-2of3: passed, exit 0, 42.9 s, 448/448
- tests-3of3: passed, exit 0, 77.3 s, 424/424
- typecheck: passed, exit 0, 1.5 s
- story: passed, exit 0. It checks shape and gate presence only; G4 is checked by `delivery`.

Total **1308/1308**: main's 1305 at #67 plus this change's three fork-race tests.

The stdout logs hold only test names and durations. The one "Bearer" hit per test shard is a test title, and no user path appears.

Not proven here:
- Linux.
- Real claude or codex CLIs stopped mid-fork.
- The SIGTERM-moment race (SIGTERM is still sent once).
- The original `runCommand` failure's link to this race (#67, inferred).
