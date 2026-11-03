# U30 replan · workflow-review (round 2) — minor changes

Same three reviewers re-checked 23d554d. All four round-1 Important findings Fixed. No new Critical or Important.

Remaining, to change now:
- PATH puts /usr/bin before Office's Node, so on a host with /usr/bin/node (Linux) the relay would run another Node. GIT_DIR already prevents git shadowing, so the reorder bought nothing.
- The verification record overclaims: it says four mutations but lists three, and says all Minor items were fixed.

Accepted and documented, not changed:
- A-B-A candidate.json race: needs two coordinators for one task, which OfficeCoordinator's per-task active guard prevents in one Office.
- An Office update that changes the relay stops kit folders already written (KIT_SOURCE_CHANGED).
- A kit 4 task with no round returns KIT_UPGRADE_REQUIRED without storing it (as KIT_REQUIRED does today); a kit 4 round awaiting G4 without a receipt keeps refusing G4 (fail closed).
- No test shows the ceiling alone failing for a case-variant or colon path; kit 4 migration tests with a real kit 4 round are not written.
- team-gh timing flake confirmed unrelated (file alone 15/15).
