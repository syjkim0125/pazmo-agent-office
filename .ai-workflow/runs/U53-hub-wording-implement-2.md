# U53 implement attempt 2 — review 1 Minor 1 taken up

Review 1 (.ai-workflow/runs/U53-hub-wording-review-1.md) was Ready. Minor 1 found that the held-Task info button had
no test, although the change record said it did. The caller took that up before verify.

Commit: 07f3184. The commit adds tests only and corrects the record; no code changed.

## Changes
- tests/hub-story-pages.test.mjs, in the held-Task test:
  - while the Mac is off, the PL's Task page carries the `info-held` button and its popover ("오래 멈춰 있으면 PL이 풀
    수 있습니다.");
  - the assignee's page does not carry it.
- docs/verification/2026-11-18-hub-wording.md now says which tests cover the three info buttons.

## Evidence (Node v24.19.0)
- The held-Task test passes on the current code. It guards behaviour that was already there.
- Dropping `!mine` so the button also shows to the assignee makes the test fail (fail 1). Restoring the file leaves
  only the test change (`git diff --stat`: the test file, 4 insertions).
- Hub test files plus team-planning, team-planner and planning: U53-hub-wording-implement-hub-2.txt — 703/703.

## Limits
- Minors 2 and 3 are left as recorded: the held info button sits on its own line, and "내 Mac이 10분 넘게
  조용합니다" follows the table's 맡은 사람 row.
