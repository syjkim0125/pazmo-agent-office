# U43 hub-many-projects · verify

Fresh checks through `graph.mjs verify` on the started token, HEAD `03c2f97` (after review 3: Ready, one non-blocking Minor). Worktree clean apart from `.ai-workflow/runs` and `.ai-workflow/evidence` during the run; no other test suite running.

- Verify attempt 1 ran `tests-1of3` with the shell's default Node v22.3.0 first on PATH: 40 of 92 files failed to load within 1.2 s (exit 1), an environment fault, not the code. The node was reset with that reason; attempt 2 ran every check with Node v24.19.0 first on PATH (`env PATH=/Users/jongkkim/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`), as U41's verify did.

| check | exit | result | time |
|---|---|---|---|
| tests-1of3 | 0 | 576/576 | 34 s |
| tests-2of3 | 0 | 636/636 | 80 s (load ~12) |
| tests-3of3 | 0 | 655/655 | 73 s |
| typecheck | 0 | `tsc -p tsconfig.json` | |
| story | 0 | PASS | |

Total **1867/1867** (main at `1fe9292` had 1863; this change adds four tests to `tests/hub-board-page.test.mjs`). Story hash `edf0cb7a` matches the G1 record. Logs: the `stdout`/`stderr` paths in each verification receipt under `.ai-workflow/evidence/d16972a8-7f16-4a25-9f43-c0e0b99185a3/`.
