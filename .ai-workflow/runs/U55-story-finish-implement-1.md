# U55 implement attempt 1 — local result approval, PL Office merge and complete (D48, bundle 4b)

- Story: D48 and one V20 sentence were added. G1 was recorded (Story hash 0019cd0f…, commit 0075c1b).
- Base: main 1e9d1d8. Code commit: a33d3a4.

## Changes
- **Hub** (`src/hub/story-store.ts`, `link-api.ts`, `story-pages.ts`, `server.ts`)
  - New table `hub_story_finish(story_id, verified, approval, repos)`.
  - `reportVerify` takes optional `commits`, one full commit per Story repo. A passed check keeps them; a failed one clears them.
  - `finishView(link, number|id)` is PL-only. It returns the Story's state, fingerprint, check summary, branches, each repo's Story checks, the verified commits, the approval and the per-repo merges.
  - `approveStory` (route `POST approve`, NOT_YOUR_MAC like upload) requires all of:
    - the PL's current Mac;
    - the Story at awaiting_g4;
    - the same fingerprint;
    - exactly the verified commits;
    - a 64-hex record hash.
    The same hash again answers `already`; another hash over an approval is STATE.
  - `finishReport` (route `POST finish-report`) takes these kinds:
    - `repo`: opened, handed or merged. A merged repo stays merged.
    - `closed`: a handed PR was closed. The approval ends; merged repos stay.
    - `reverify`: the check is ready again and the Story is open.
    - `failed`: the check failed and the Story is open.
    - `done`: needs every repo merged.
  - The link `complete` route now goes through `done`.
  - The inbox has `finishReady`.
  - The Story page has a "main 머지" section: approval Mac and time, each repo as 머지 전, 머지 중, 사람 머지 대기 or 머지됨, with its PR link and the reason a PR was handed. The waiting sentence follows the state.
- **Story check** (`story-check.ts`)
  - Every Story repo's Story base is checked out, including repos with work but no Story checks. Those report "Story 검사 없음", and a passed report carries all the commits.
  - The INVALID log line now says how such a check really ends (4a R1).
- **git** (`branch.ts`): `prepareStoryMerge` returns one of:
  - `moved`: commits that did not come from the base branch landed after the check (merges excepted);
  - `current`: the Story base holds the base branch, with `check` saying base commits came in;
  - `merged`: the base branch was merged in and pushed as a fast-forward of the Story base;
  - `conflict`: the merge was aborted and nothing was pushed.
  It refuses a Story-branch base and anything that is not the Office checkout.
- **gh** (`pr.ts`): `ensureStoryPr` reuses an open or merged PR, never a closed one. `viewStoryPr` and `mergeStoryPr` use `--match-head-commit`. They accept only a Story base into a non-Story branch.
- **Office** (`story-finish.ts`, `office.ts`): `createStoryFinisher` runs on the claim tick after the Story check. It waits for no pause and runs where a Task could. Per repo, in Story order:
  - A merged repo is skipped.
  - A recorded PR is read: merged is reported merged; closed ends the approval; handed and open waits.
  - A repo with no verified commit, or `moved`, means a reverify.
  - On `merged`, or `current` with base commits in, the repo is re-checked in the VM; a failure is reported `failed`.
  - On `conflict`, the PR is opened and handed.
  - Otherwise the PR is opened and merged. A refused merge (GH_FAILED) is handed with gh's reason.
  - When every repo is merged, `done` is reported.
  - Waits are logged once. Git, gh and Hub errors are retried next tick. A busy VM waits.
  - Presence, the restart idle test and `beginStop` count it.
- **Command** (`finish.ts`, `cli/team.ts`, `cli/index.ts`): `team finish --story <N>`.
  - `needs-approval` gives the summary, the commits, the record path (`<data>/team/approvals/story-<N>-g4.json`) and a template.
  - With the record, the command checks gate, story, responseRef, date, fingerprint and commits (FINISH_RECORD or FINISH_STALE), then approves and renames the record to `*.approved.json`.
  - Other outcomes: `approved` with the repos when already approved; `done`; FINISH_STATE.
  - `--guide` prints the skill.
- **Guide:** `skills/pazmo-hub-finish/SKILL.md`. `mac connect` installs it beside the upload guide (`installFinishGuide`).

## TDD evidence (Node v24.19.0)
- RED: U55-story-finish-implement-red-1.txt — the new and changed tests on 0075c1b. 16 of 115 targeted tests fail there, and three new files fail on missing exports.
- GREEN: U55-story-finish-implement-green-1.txt — full suite 2017/2017 on a33d3a4; typecheck exit 0.
  - An earlier full run found two expectation changes: the help text must not say "approval", and the inbox now reads `finishReady: []` from an older Hub. Both were fixed before this run.
- Over a real TLS Hub:
  - `team finish` refuses a connection-string link (NOT_YOUR_MAC) and approves from the PL's Mac link.
  - The finisher merges both repos of an approved Story and the Story is done.
  - The Story check stores both repos' commits with the PL's 자동으로 일하기 off.

## Not done yet
- The hands-on run on a copy of the check Hub writes to the test repo's main. V20 says it waits for the user's allowance, so it has not been run.
