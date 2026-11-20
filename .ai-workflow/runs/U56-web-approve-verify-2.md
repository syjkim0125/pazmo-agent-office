# U56 verify — fresh kit verification (D49 web result approval)

- Tree: 26931c0 plus the uncommitted run records of review 3. Code commits: 3f57ad0, d1d94e0, ac1cb5c.
- Attempt 1 (verify token 8ebf1a1f…): tests-1of3, tests-3of3, typecheck and story passed; tests-2of3 failed 607/608 on
  `tests/team-registry.test.mjs` "a registered repo cannot be started as a single Office; after remove it can" (line
  493: `stop` of a lean single Office returned 1). That module and the Office start/stop path are untouched by this
  change; the machine had just come down from a load average of 80–116 caused by other programs, the same kind of
  stop-under-load failure seen in the implement attempt 2 full run (`lifecycle`), and the test passed in both full runs
  of attempt 3's code. A check runs once per attempt, so the node was reset (attempt 2).
- Attempt 2 (this record): the kit graph ran each check with Node v24.19.0; logs under
  .ai-workflow/evidence/6037030d-8332-49c9-bb30-57424a2e9080/.
  - The three test parts: exit 0, 738/738 + 608/608 + 703/703 = 2049/2049.
  - typecheck: exit 0.
  - story (`check.mjs story`): exit 0.
- Changed-file scope, d256fc6..ac1cb5c (src, tests, skills, docs other than the Story):
  - Hub: story-approve (new: storyItems, compareUrl, shellLine, approvalPlan, INSTALL_NOTE), story-store
    (approvalView, approveOnWeb, FinishApproval via/by, recheckStory by any actor), story-pages (결과 승인 card,
    wording), server (POST approve and recheck), pages (copy-only CSS, Chrome.copy), copy-script (marks the page),
    board-pages (board wording).
  - Office: team/finish.ts (records set aside when the Hub has an approval or the own approve loses).
  - skills/pazmo-hub-finish (web path), docs/LOCAL-PREVIEW.md.
  - Tests: hub-story-approve (new), hub-story-finish, hub-story-pages, hub-board-page, hub-live, team-finish,
    team-story-finish.
- Unproven boundaries:
  - The hands-on run (V20 (D49): web approval on a copy of the check Hub, then the PL Office's merge into the test
    repos' main and done) has not been run; it waits for the user's choice and allowance.
  - The copy button and the card are checked by HTML tests, not in a real browser yet.
  - The run steps were exercised with real git (bash and zsh) only by the reviewer's scratch probes, not by repo tests.
- Limits recorded from review 3 (Minor):
  - A record whose approve call failed for a non-STATE reason, followed by a web approval, no `team finish` rerun and
    a PR closed unmerged, can still approve the next round without a new answer (fix later: bind records to the
    approval round).
  - Worktrees of an earlier round's commit are not cleaned up automatically.
  - Repo names in the prompt are not flattened to one line (only a repo owner can set them).
