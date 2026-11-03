# U32 workflow-verify, attempt 1 (D39)

Snapshot `2bd45e717c12…`: HEAD `1047da4` plus D39's uncommitted change, after implement attempt 2 and review attempt 3.

The kit `graph verify` receipts are under `.ai-workflow/evidence/c9f836b7-916e-4dd9-a4af-22a6da38643d/`. Node v24.19.0 was first on PATH. Each check started only when no other `--test` process was running (checked with `pgrep` before each one). The checks started 2026-11-03 16:02:51 KST. Every check reported the same snapshot.

- tests-1of3: passed, exit 0, 45.7 s, 438/438
- tests-2of3: passed, exit 0, 40.4 s, 445/445
- tests-3of3: passed, exit 0, 68.8 s, 429/429
- typecheck: passed, exit 0, 1.6 s
- story: passed, exit 0. It checks shape and gate presence only; G4 is checked by `delivery`.

Total **1312/1312**: main `1047da4`'s 1303 plus D39's nine new tests. Those are:
- runner-jobs +4
- runner-settings +1
- runner-account +1
- native-story-task +1
- team-executor +1
- lean-office +1

team-store's test was extended rather than added.

The stdout logs hold only test names and durations. The one "Bearer" hit per test shard is a test title. No user path appears.

Not proven here:
- A real logged-out, missing or blocked CLI through a team Office (V18 says so).
- The five Minor follow-ups in `U32-review-2.md`.
- This run is on `1047da4`. Merging main later needs a merge run.
