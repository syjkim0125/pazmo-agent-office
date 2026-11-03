# U30 replan · implement (attempt 2, after review round 1)

Commit 23d554d on top of df48a79. Fixes every Important and accepted Minor finding in U30-replan-review-1.md: GIT_DIR barrier, unique kit check ids per registered check (kitCheckIds), assertCurrent before any lease with KIT_UPGRADE_REQUIRED kept as the round reason, executed() resume removed, relay as snapshot input, atomic candidate.json, relay 5 s / verify CLI 30 s, PATH system folders first, earlier-attempt receipts in the completion proof, docs aligned.
New tests: two checks of one V; kit 4 second run; relay rejects timedOut and error observations; second execution of a check refused.
Mutations caught: no barrier (fail; GIT_DIR alone passes), no id numbering (fail), no early kit 4 check (fail).
Checks: kit test files 69/69; npm test 1284/1285 exit 1 — the one failure is tests/team-gh.test.mjs "a gh that hangs times out" (a 4 s timing assertion at 5212 ms under load, unrelated; the file alone 15/15 three times); typecheck exit 0; Story check exit 0.
