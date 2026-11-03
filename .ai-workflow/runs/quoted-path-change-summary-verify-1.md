# quoted-path-change-summary workflow-verify — attempt 1

Fresh on the tree of `e0245fd` (the full run started on the uncommitted working tree and `git diff --stat` was the same before and after the run; the commit holds exactly that diff). Node 24.19.0, Git 2.50.1 (`/usr/bin/git`), no other test run at the same time.

- `npm test`: exit 0, tests 1278, pass 1278, fail 0, cancelled 0, skipped 0, 141.9 s (main's 1276 plus the pair test and the escape unit test).
- `npm run typecheck`: exit 0.
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0.
- Related files alone (`tests/decision-summary.test.mjs`, `tests/team-story-contract.test.mjs`, `tests/hub-snapshot.test.mjs`, `tests/candidate-diff.test.mjs`): 40/40.

Earlier full runs in this attempt: run 1 (before the review fixes) was 1277/1278, exit 1. The failure was `tests/team-gh.test.mjs` "a gh that hangs times out": it took 5206 ms against a 4000 ms limit, while the other assertions (`reason: "timeout"`) held. That test does not touch the changed code. It passed 3/3 alone (about 206 ms each), and runs 2 and 3 of the full suite passed 1278/1278. 5206 ms is about the 200 ms timeout plus `runCommand`'s 5 s close grace, but the cause was not diagnosed. Run 1 overlapped the independent reviewer's runs of two test files.

Not proven here: a real Story Task or Office G4 run with non-ASCII file names (only the real producer and the summary function were exercised), other Git versions' quoting, and G4 (human-owned).
