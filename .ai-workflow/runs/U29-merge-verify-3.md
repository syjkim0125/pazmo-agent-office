# U29 (after merging main #57·#58) workflow-verify — attempt 3

Fresh on `e69f0c6` (no other test run at the same time):

- `npm run typecheck`: exit 0
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0
- `npm test`: exit 0, tests 1276, pass 1276, fail 0, cancelled 0, skipped 0, 130.5 s (attempt 2's 1275 plus the new summary test).

Real check, phase 1 (2026-11-02–03, `docs/verification/2026-11-03-team-story-task-mode-real-check.md`): a local Hub, two private GitHub test repos and the VM ran one Story's three Tasks from claim to a merged, reported PR; the person's repo folders did not change; a locked start claimed nothing; an idle live Office checked its runners about every 5 minutes.

Not proven here: the real check's phase 2 (conflict and failed re-check, stop between steps, ssh push and commit signing, "Commit suggestion", closed PR, cancel during a re-check, a repo without merge commits), the runner-at-its-limit handling (a separate follow-up), other people's PCs, and G4 (human-owned).
