# U30 merge · workflow-verify (attempt 1)

Snapshot: merge c0bfef5 (this change + origin/main f4478f3). Executed by kit `graph verify` (receipts under .ai-workflow/evidence/0bb6b13e-e34b-48ae-ab43-c3ba3330f453/), node v24.19.0 first on PATH.

- tests-1of3: passed, exit 0, 36.3 s — 452/452
- tests-2of3: passed, exit 0, 79.3 s — 455/455
- tests-3of3: passed, exit 0, 70.2 s — 380/380
- typecheck: passed, exit 0, 2.9 s
- story: passed, exit 0 (shape/gate presence only; G4 not checked)

Total 1287/1287 (main added tests). Unproven: real Office runs (real VM, real CLIs) on kit 5 v3 role runs; the git barrier for case-variant or colon paths has no automated test (a reviewer reproduced it).
