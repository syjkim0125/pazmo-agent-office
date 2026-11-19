# U54 verify attempt 1 — fresh kit verification (D47, bundle 4a)

- Tree: e122556 plus the uncommitted run records of review 3 (code 3138815).
- Checks: the kit graph ran each with Node v24.19.0. Logs are in .ai-workflow/evidence/3a73ed48-21de-470c-9c9e-e3ffb87ad03d/.
  - tests-1of3: exit 0, 597/597.
  - tests-2of3: exit 0, 676/676.
  - tests-3of3: exit 0, 715/715.
  - Total: 1988/1988.
  - typecheck: exit 0.
  - story (`check.mjs story`): exit 0.
- Changed-file scope, 1ccc3a2..e122556 (src and tests):
  - src/team/story-check.ts (new), src/team/branch.ts, src/team/story-link.ts, src/team/office.ts
  - src/hub/story-store.ts (`repoName` added to `ClaimedTask.story.branches`), src/hub/story-pages.ts
  - tests: team-story-check (new), team-office, team-branch, team-fixture, hub-story-pages, hub-story-claim
- Unproven boundaries:
  - The hands-on run on a copy of the check Hub used the attempt-1 code. Story 7 went to awaiting_g4 after V1–V5 passed in the VM.
  - Everything changed since then was checked by tests only: the repo name, lane mapping, resend, the 10-minute window, the full commit, two-pass order, pause and presence.
  - The check Hub on 18444 was not changed.
  - No AI review (D47 ASSUMED). Approval, merge and complete are 4b.
  - Not done: M8 (two Macs of one PL), and R1 (the INVALID log wording, unreachable on this Hub).
