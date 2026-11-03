# run-command-group-kill-race v3 · workflow-verify (attempt 1)

Snapshot `064b3a289eec…` is HEAD `0e57363`: this change merged with main `1047da4` (#65) and `e8380d9` (#66), plus the re-approved G1. The kit `graph verify` receipts are under `.ai-workflow/evidence/7a804566-48ab-4cfe-a577-a5d1c4f9fc00/`. Node v24.19.0 was first on PATH. The checks started 2026-11-03 15:04 KST, when no other `--test` process was running. The snapshot before and after was the same for every check.

- tests-1of3: passed, exit 0, 45.5 s, 434/434
- tests-2of3: passed, exit 0, 39.0 s, 447/447
- tests-3of3: passed, exit 0, 64.8 s, 424/424
- typecheck: passed, exit 0, 1.6 s
- story: passed, exit 0. This checks shape and gate presence only; G4 is checked by `delivery`.

Total 1305/1305: main's 1303 plus this change's two fork-race tests. The stdout logs hold only test names and temporary paths. The only "Bearer token" hits are three test titles, and no user path appears.

Not proven here: the limits in `run-command-group-kill-race-verify-1.md` (the original failure's link is inferred; Linux and real CLIs were not run; the other single-signal call sites).
