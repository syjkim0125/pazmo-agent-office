# U30 replan · workflow-verify (attempt 1)

Snapshot: HEAD 25d3df7 (reviewed in round 3). Executed by kit `graph verify` (receipts under .ai-workflow/evidence/1e012d0e-08e6-4d7a-84bc-382c740c6e74/), node v24.19.0 first on PATH, load about 9-14.

- tests-1of3: passed, exit 0, 36.2 s — 451/451
- tests-2of3: passed, exit 0, 84.5 s — 455/455
- tests-3of3: passed, exit 0, 113.9 s — 379/379
- typecheck: passed, exit 0, 1.8 s
- story: passed, exit 0 (shape/gate presence only; Status is not Delivered, G4 not checked)

Total tests 1285/1285. The earlier full-suite flake (team-gh "a gh that hangs times out") did not recur.
Unproven here: real Office runs (real VM, real claude/codex) on kit 5 v3 role runs; the case-variant/colon-path git barrier has no automated test (reproduced by a reviewer).
