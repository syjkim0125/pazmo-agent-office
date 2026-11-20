# U57 implement attempt 1 — QA place, dev PRs and their revert, merge targets on buttons (D50)

- Story: D50 and one V20 sentence, G1 recorded in 25a116c (story hash 1ef210ae…), after the explainer's version 50.
- Base: main 088c639. Code commit: 089a2b0.

## Changes
- **Merge targets named (D50 (1))**
  - `story-approve.ts` `mergeTarget(repos)`: "승인하고 <branch>에 머지" when every Story repo shares a base branch,
    else "승인하고 기준 브랜치에 머지" with a line "be → main · fe → develop" above the button.
  - The card's note, 기다리는 일 for others and the merge section say 기준 브랜치 instead of a fixed main
    ("기준 브랜치에 머지").
  - A work Task's page (not merged, not cancelled) says "리뷰와 검증을 통과하면 <code>feature/story-N/base</code>에
    자동으로 머지합니다." Team Tasks have no approve button (D24).
- **Local QA (D50 (2))**: `LOCAL_RUN_NOTE` on the card's run steps and under step 2 of the AI prompt: start services
  the repo's README/AGENTS.md way in the check folder, with the PL's local DB, secrets and repo addresses.
- **Dev branch setting (D50 (3))**: `hub_repos.dev_branch` (migrated in HubStore and, if absent, StoryBoard);
  `RepoView.devBranch`; `setDevBranch(member, repo, name)`: owners only (an admin who is not an owner is FORBIDDEN),
  trimmed, empty clears, `isBaseBranchName` (so no `feature/story-…`), and a base branch of any project the repo is in
  is INVALID. `/repos` shows "dev 브랜치: …" to all and a form in 관리 to owners; `POST /repos/:id/dev-branch`.
- **Dev records (Hub)**: table `hub_story_dev(story, repo, want, want_commit, dev, revert, reason)`.
  - `devCard(actor, story)`: each Story repo whose dev branch differs from its base branch, or with a record;
    `canOpen` (PL, 승인 대기, no approval, verified commit, dev branch, no request waiting, no open/merged dev PR of
    that commit), `canRevert` (PL, Story not done (cancelled included), dev PR merged, no request waiting, no open or
    merged revert).
  - `requestDev` (STALE for another commit than the verified one; `already` for a double click) and
    `requestDevRevert`; `devView(link)` and `devReport(link)` (`dev`, `revert`, `failed`) for the PL only.
  - Inbox `devReady`: a request waiting, or an open dev/revert PR on a Story not done.
  - Web `POST /stories/:id/dev`, `/dev-revert`; link `GET /api/link/story/dev`, `POST /api/link/story/dev-report`.
  - Story page: "dev에서 확인" inside the 결과 승인 card while it shows (state, PR link, "dev에 올라간 코드는 검증한
    커밋과 다릅니다." when the head moved, revert state, the failure reason, the PL's two buttons); elsewhere its own
    section once any record exists (everyone reads, buttons PL only).
- **PL Office (D50 (3)(4))**
  - `pr.ts` `ensureDevPr` (open, else merged PR of its head into dev, else create; never a fork's), `viewDevPr`
    (state, merge, head), `closeDevPr`; head must be `feature/story-N/to-dev-<sha12>` or `revert-dev-<sha12>`, base
    must not be a Story branch.
  - `branch.ts` `pushDevBranch` (only a to-dev name, only a commit on the origin's Story base, an existing branch is
    left as it is) and `revertDevMerge` (Office checkout only, dev tip detached, `revert -m 1` for a merge or as is for
    a squash, conflict aborted and reported, a merge not in dev `missing`, push to revert-dev). Neither writes the
    Story base or dev.
  - `story-dev.ts` `createStoryDev`: per tick, per repo: dev request → close an open dev PR of another commit, push,
    ensure PR, report; revert request → revert, ensure PR, report; else follow open PRs at most once a minute. git/gh
    refusals become the request's reason ("dev로 보낼 브랜치를 올리지 못했습니다: …"); a repo not on the Office is
    reported; the Office never merges a dev PR.
  - `office.ts`: runs after the finisher in the claim tick, only live and where a Task could run; counted in
    working/idle and stopped with the others. `story-link.ts`: `devView`, `devReport`, inbox `devReady` (absent from
    an older Hub = none).
- `skills/pazmo-hub-finish/SKILL.md`: local QA and the dev PR path, which never changes what is approved or merged.

## Evidence
- RED: `U57-dev-pr-implement-red-1.txt`: the new Hub tests 0/12 (missing exports and routes), the Office test files
  0/3 (missing modules) before the code.
- GREEN: `U57-dev-pr-implement-green-1.txt`: the touched test files after the code.
- Full suite and tsc: see the result summary.

## Not proven here
- A real GitHub dev PR, a real revert PR and a person's conflict resolution: the hands-on on a copy Hub, which writes
  to a test repo's dev branch, waits for the user's allowance.
- A dev PR merged by rebase: only the last commit's revert would be opened (merge and squash are tested).
- A newer dev PR of the same repo replaces the older record; an older merged dev PR is not reverted with it.
