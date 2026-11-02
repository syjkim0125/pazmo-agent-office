# U29 (after merging main #50–#56) workflow-review — attempt 1

Recorded by the controller session. The reviews themselves were independent subagent reviews (fresh context, read-only, diff packages), not the implementers' self-review.

Per task (spec compliance + code quality, then scoped re-reviews of each fix round):

| Task | First review | Fix rounds | Result |
|---|---|---|---|
| 1 Hub open Task | Approved | 0 | clean |
| 2 team store | Approved | 0 | clean |
| 3 scheduler | Needs fixes (2 Important: NOT_YOURS with a pending merged report; failed record with no exit) | 1 | clean |
| 4 branch.ts | Needs fixes (2 Important: deleted-but-registered checkout; tracking-ref restore) | 1 | clean |
| 5 pr.ts | Approved | 0 | clean |
| 6 story-contract.ts | Needs fixes (1 Important: a Story title could trip the checker's gate regex) | 1 | clean |
| 7 engine Story Task | Needs fixes (1 Important: onVerified inside the pump could freeze the engine) | 1 | clean |
| 8 executor | Needs fixes (Critical: a merged head that failed its re-check could be merged after a stop; Important: a lost merge unlock never retried) | 2 (round 1 brought a regression: a PR a person merged was not reported; round 2 went back to lock first) | clean |
| 9 team Office wiring | Needs fixes (Important: a locked restart could drop an unreported merge; an idle live Office started the runner CLIs every 30 s) | 1 | clean |

Final whole-branch review (43d18f6..8e74319, five passes, 157/157 focused tests, four probe tests): no Critical; four Important, each reproduced by a probe:

1. the merge step merged the remote Task-branch tip, not the head the Office checked and pushed (a foreign commit merged with 0 checks);
2. a PR a person closed was replaced by a new PR and merged;
3. a PL cancel or release during a re-check was not honoured before `mergePr`;
4. a merged report the Hub refused for good was re-claimed and refused in a loop.

All four and seven Minors were fixed in one wave (`cee9ff8`..`957ec6e`). The scoped re-review marked every finding ADDRESSED, re-ran the original probes (4/4, now passing) and adapted probes (8/8), confirmed RED against `8e74319`, and found no new Critical or Important problem.

Failure paths covered by tests: stop between every two steps (no second PR, no double merge, report once), Hub outage while reporting, busy merge lock, moved base with a failing re-check, conflict, three failed attempts and `team rerun --memo`, push refused three times, PL cancel while building and during a re-check, a PR a person merged or closed, a foreign commit on the Task branch, a refused report, a locked restart with a merging record. The person's repo (HEAD, branch, `git status --porcelain`) is unchanged after a merged Task (real git).

Open (deferred, not blocking per the final review's triage): a foreign commit pushed while attempt 2+ builds fails the Task after three refused pushes instead of costing one attempt (fails closed); runner readiness can be up to 300 s old; a stranded verified/merging record when the person cannot start live (documented); the real gh/GitHub/VM checks.
