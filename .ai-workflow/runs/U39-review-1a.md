# Final whole-branch review 1 of 2: correctness, requirements, regressions, tests

Range `0acd1d9..e89cd58` (16 commits) on `feat/hub-easy-flow`, checked against Story D42/V20/M16, the G3 design
`docs/understanding/hub-board-local-upload-plan.md` (K1–K9, "꼭 지킬 것", recovery, evidence), the plan
`docs/plans/2026-11-11-1400-feat-hub-board-plan.md` (Global Constraints, Review Focus 1–5) and the controller ledger
`progress.md`.

I reviewed in six passes over the diff package and the files at HEAD: (1) spec, design, plan, ledger;
(2) Hub store and board data (`story-store.ts`, `store.ts`, `board.ts`, `plan-store.ts`); (3) web layer (`server.ts`,
`pages.ts`, `board-pages.ts`, `story-pages.ts`, `plan-pages.ts`, `live-script.ts`, `paths.ts`, `link-api.ts`);
(4) upload command and the planner extraction (`upload.ts`, `story-bases.ts`, `planner.ts`, `cli/team.ts`, `cli/index.ts`);
(5) `mac connect` guide copy, SKILL.md, LOCAL-PREVIEW, verification record; (6) the new and changed tests.
I did not run the full suite (reported 1831/1831). To settle one doubt I ran one scratch script outside the worktree
(`/private/tmp/claude-502/-Users-jongkkim-Documents-pazmo-agent-office/e4a09923-81bd-495f-a9c5-52e81cdfceff/scratchpad/cancelled-card.mjs`).
It confirmed Important 1.

## Strengths

- **Column stamping is complete and in one place.** Every state or stage write calls `#touchColumn` (`src/hub/story-store.ts:507-508, 527, 538, 794, 957, 1069, 1146, 1248, 1265, 1295, 1303`). All four claim paths go through `#claim` (`:1017, 1056, 1083, 1535`), so rerun, pick, verify-claim and claimNext all restamp. The failed-keeps-its-column rule sits in one helper, `#columnOf` (`:416-419`). The migration is additive and idempotent (`:392-407`), so a rollback is safe as the design asks.
- **The upload's Hub side is transactional and ordered right.** Hash shape, then the current-Mac check, project, ownership, a prior Story under the key with no upload row (STATE), cancelled (UPLOAD_CANCELLED), then `publishStory` and the approval row in the same transaction (`story-store.ts:1212-1247`). Each refusal leaves nothing, and the tests check that with `storyByKey === null` (`tests/hub-story-upload.test.mjs:64, 191`).
- **The `mergeBases` extraction is a true shared rule.** The plan board's messages and behavior are unchanged (`plan-store.ts:622-627`). Upload-bases adds only the draft-only rule for new repos (`story-store.ts:1262-1283`).
- **The planner extraction is behavior-equivalent.** I traced `basesAndOpen` against the old code. `goOn(false)` can only throw `OfficeError CANCELLED`, because `cancelDraft` swallows its own errors (`planner.ts:461-493`), and the new catch unwraps exactly that case. The `bases.json` merge, the Hub-before-file precedence and the order heartbeat → pushes → open are all preserved.
- **`checkUpload` is thorough and plain.** It checks G1 and G3 binding with the kit hash, the design file taken from the kit profile, the Story shape, repos and base branches, the covers ↔ checks pairing, the Hub's own `validateGraph`/`validateStoryVerify`, and P5 coverage with the real M/V numbers (sparse arrays, `upload.ts:371-380`). Every refusal tells the person how to fix it. The CRLF test feeds the same bytes to kit `storyContract` (`tests/team-upload.test.mjs:157-169`), which settles Review Focus 3.
- **The end-to-end tests are real.** They use a TLS Hub, bare origins and a fake `gh`. They assert that the PL's clones are byte-for-byte unchanged (status, index, HEAD, branches) after success, failure and resume (`tests/hub-upload-office.test.mjs:252-324`). They show that the resume uses the commit the Hub kept rather than the moved tip, and that a teammate's scheduler claims the uploaded Task.
- **The landing flow is careful.** `pazmo_next` is set only for allow-listed GET paths and never for `/mac/approve` (`server.ts:2112-2116` in the diff). It is decoded inside try/catch, re-checked with `safePath`, and cleared on invite. A Hub without the board still lands on `/start`.
- **A Hub without the board is unchanged.** `layout` falls back to the old nav when `autoWork` is undefined (`pages.ts:102-111`), and `/` stays the request board (`server.ts` `/requests || (path === "/" && !c.board)`).

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **"취소한 것도 보기" never shows a cancelled Task card.**
   - File: `src/hub/board-pages.ts:14-20, 51-55`. The store side is `src/hub/story-store.ts:631-633` (`board()`).
   - What: with `cancelled: true`, `board()` returns cancelled cards with `column: "hidden"`. `COLUMNS` holds only the five visible keys, though, and `storyLane` renders only `s.cards.filter(c => c.column === key)` for those keys. Cancelled cards are therefore dropped on every render: a cancelled Task inside an open Story never appears, and a cancelled Story's lane comes back with its unfinished cards missing. I confirmed it with the scratch script: the store returns the card with `column` `hidden`, and the page does not contain `/tasks/<id>`.
   - Why: D42 (1) says "취소된 카드는 숨기고, 보기를 켜면 보인다", and K5 says "취소는 숨김(보기 켜면 보임)". The toggle meets this only for whole Stories. The page test (`tests/hub-board-page.test.mjs:193-214`) checks only the lane (`data-story`), and the store test checks only the data (`tests/hub-board-store.test.mjs:106-116`). That is why this passed.
   - Fix: while `v.cancelled` is on, render hidden cards. Either put them in the column of their stored `column_key` with a "취소됨" pill (done tone), or add a sixth "취소" column. Add a page assertion that the cancelled Task's link is present under `?cancelled=1` and absent without it.

2. **The installed claude guide puts the managed comment before the YAML frontmatter, so Claude Code most likely does not recognize it as a skill.**
   - File: `src/cli/mac.ts:256, 266` (`want = "<!-- pazmo-office managed: … -->\n" + body`). The test is `tests/mac-skill-copy.test.mjs:12, 25-30`.
   - What: `~/.claude/skills/pazmo-hub-upload/SKILL.md` starts with the HTML comment and only then `---\nname: pazmo-hub-upload\ndescription: …`. The SKILL.md format requires the frontmatter at byte 0. Anthropic's own skill validator rejects any file where `content.startswith('---')` is false (`~/.claude/skills/synced/…/skill-creator/scripts/quick_validate.py:65-69`).
   - Why: with no parsed `name` or `description`, the skill will not trigger on "허브에 올려줘". K8's whole purpose ("claude가 이 명령과 파일 모양을 알도록") is lost on every PL Mac, and silently: `mac connect` reports "안내를 … 두었습니다". The test pins the broken shape. The verification record lists "안내가 실제로 claude에게 읽히는지 보지 않았다". This is a defect in the plan as well as the code: Task 8 specified the header as the first line.
   - Fix: keep the marker out of byte 0. For example, put a YAML comment line `# pazmo-office managed: sha256=<hash of the rest>` right after the opening `---`, or keep the hash in a sidecar file next to SKILL.md. Change the test to assert that the installed file starts with `---\nname: pazmo-hub-upload\n` and still round-trips written/same/kept-user-edit.

3. **The live swap folds open `<details>` back up and drops text selection and focus. On Story, Task and board pages this happens about once a minute.**
   - Files: `src/hub/live-script.ts:12-25, 41-44` (`typing()` checks only form fields; `main.innerHTML = fresh.innerHTML`).
   - What: the ETag changes whenever the page text changes. These pages carry minute-granular relative times: an uploaded Story's "로컬 승인 · … · N분 전" (`story-pages.ts:188`), a Task's "마지막 소식 N분 전" (`story-pages.ts:102-105`) and the board's "N분째". So the swap runs every minute while something is active. It rebuilds `<main>`, which closes every opened `<details>`: the K9 "개발 정보" folds (`story-pages.ts:84`), "자세한 이유" on a failed Task, and "하고 싶은 일" on a plan. It also clears any text selection and moves keyboard focus off a focused link or button.
   - Why: K9 (T5) moved PR URLs, merge commits, file paths and checks into folds that people now open in order to read or copy them, and K6 (T3) closes those folds within a minute. A reasonable person expects an open fold, a selection, or the card they tabbed to, to stay put. The Task 3 deferred minor "swap loses text selection / focus on buttons" is the same issue and should be fixed with this, not deferred.
   - Fix: in `tick` and again after the fetch, treat the page as busy when any of these holds: `main.querySelector("details[open]")` exists, `getSelection().toString()` is non-empty, or `document.activeElement` is inside `main` (other than `body`). Alternatively, record the open `details` by index or summary text and reopen them after the swap. Add vm tests for "skips while a fold is open" and "skips while text is selected".

4. **After the live script stops, the page still says "저절로 업데이트" and keeps the 새로 고침 link hidden.**
   - Files: `src/hub/live-script.ts:26-29, 37` (`stop()` only clears the interval). The CSS is `src/hub/pages.ts:50` (`html.live .refresh{display:none}`, `.live-note` shown).
   - What: on any status other than 200 or 304 the script stops, as Review Focus 1 intends. But `html.live` stays set, so the 새로 고침 link stays hidden and the "저절로 업데이트" note stays visible on a page that no longer updates. This happens on 401 (an expired session), on 403/404 (a cancelled Story or a permission change), and on a router 502/503 during a Hub restart or redeploy. The deployment uses proxy mode behind a router, and Hub redeploys are planned. Network errors keep polling; HTTP 5xx from the router does not.
   - Why: the board is meant to be left open and watched. After one Hub restart, every open board shows stale cards with a label claiming they update, and the one fallback the design names ("스크립트가 없으면 새로 고침 링크가 그대로 보인다") is hidden.
   - Fix: in `stop()`, call `root.classList.remove("live")` so the refresh link comes back and the note goes away. That one line is the whole fix within the design. Separately, consider treating 502/503/504 like a network error and retrying, and stopping only on 401/403/404. That would change Review Focus 1, so the user needs to decide it. Extend the vm stop test to assert that the `live` class is removed.

5. **V20 promises an automated test that web-planned and uploaded Stories appear together on one board. There is none.**
   - Where: V20 says "웹 기획으로 만든 Story와 로컬로 올린 Story가 같은 보드에 함께 보임을 자동 시험한다", and the design's evidence section lists it as automated. The verification record moved it to the manual plan (`docs/verification/2026-11-11-hub-board.md`, step 6). `grep uploadStory|runUpload tests/` finds only `hub-story-upload` and `hub-upload-office`, and neither has a plan-made Story. The board "planning lanes" test (`tests/hub-board-page.test.mjs:182-191`) uses a plain `publishStory` draft, not an upload.
   - Why: the risk is low, since `board()` does not care where a Story came from. But G4 asks the human to understand the evidence boundary, and the Story's own Verify line claims coverage that does not exist.
   - Fix: add a short board-page test (about 20 lines) with one web plan (PlanCard), one opened web-plan Story, and one uploaded Story (draft in the 기획 중 lane, then opened as a lane), all on `/`. Alternatively, reword V20 before G4. Rewording needs a new G1, so the test is the cheaper path.

### Minor (Nice to Have)

1. **The board page's query count still grows with projects.** `server.ts:237, 242` call `plans.projectPlans(id)` and `board.ownsProject(me.id, id)` once per project on every board render, and so on every 10 s poll per tab. K5 asks for a fixed query count per screen. The test (`tests/hub-board-store.test.mjs:137`) counts only `board.board()`. The performance cost is negligible on in-process SQLite. Fold both into one query each: plans for all projects, and an ownership aggregate grouped by project.
2. **The header is never refreshed.** The "내 Mac:" pill and the auto-work switch (`pages.ts` `boardHeader`) sit outside `<main>`, so on a live page they can stay stale indefinitely, including the switch's hidden `on` value. This follows the design ("`<main>`과 제목만"), so it is a gap in the plan. Consider swapping `header .me` too.
3. **A web plan that has published its draft Story shows twice in the 기획 중 lane**, once as the plan card and once as the draft Story card (`board-pages.ts:62-71`). `projectPlans` returns plans in `splitting` and `failed` (`plan-store.ts:507-511`). Dedupe by the plan's Story, or hide drafts whose key is a plan key.
4. **Done Stories never leave the board.** Every `done` Story keeps a lane with up to five cards (`story-store.ts:631-646` filters only `cancelled`), so the first page grows without bound. The spec says nothing either way. A collapsed "끝난 Story N개" section or a cutoff by age would match what people expect.
5. **Time in column appears only on taken cards in 진행 중 and 리뷰** (`board-pages.ts:37-41`). D42 (1) lists time-in-column as something Task cards show. A 할 일 card that has waited three hours shows nothing, and that is exactly what a PL wants to see. The plan's test covers only an assigned card. Decide this and either widen it or note it as a ruling.
6. **The upload result's `already: true` means two different things.** It is returned both for a resumed run that did push bases and open the Story (`tests/hub-upload-office.test.mjs:315-316`, `upload.ts:578`) and for a run that changed nothing. SKILL.md:61 and LOCAL-PREVIEW say `already: true` means "changes nothing". Either fix the wording or return an extra field such as `resumed`.
7. **The docs claim the board shows "로컬 승인 · Mac 이름".** It appears only on the Story page (`docs/LOCAL-PREVIEW.md:437`, `docs/verification/2026-11-11-hub-board.md:19, 55`).
8. **The team page has no "내 Mac" link.** K7 lists `/team` links as 레포·내 Mac·팀원·초대·인증서, but `pages.ts:300-307` has no `/mac` link. The header pill does reach `/mac`.
9. **The Hub trusts the client's `storyHash` and does not recompute `kitStoryHash(body)`.** The test uploads the same body under a second hash and gets a second Story (`tests/hub-story-upload.test.mjs:341`). Our command computes the hash correctly, so this only matters for a non-standard client. Still, the Hub's "Story 해시" record and the "one Story per text" rule rest entirely on the client. The fix is one line in `uploadStory`. Flagged for reviewer 2.
10. **The G3 requirement depends on `risk` from the Task file** (`upload.ts:237-247`), which is not part of the approved Story. A Story with a G3 line, or under a kit profile with `requiresG3: true`, can be uploaded as `normal` and skip the G3 binding check. Flagged for reviewer 2. A cheap guard: require G3 binding when the Story has a G3 line or the profile says `requiresG3`.
11. **Test hygiene** (deferred T1/T2 items, still present): the placeholder `assert.ok(l2)` and the unused `l2` (`tests/hub-board-store.test.mjs:207, 217`), `assert.ok(pub.storyId)` used as filler (`:51`), and the unused `csrf` parameter in `boardPage` (`board-pages.ts:59-60`).

## Deferred minors from the ledger: triage

| Ledger item | Verdict |
|---|---|
| T3: swap loses text selection / focus on buttons | **Fix before merge**, as part of Important 3 |
| T8: LOCAL-PREVIEW/SKILL.md omit STATE, HUB_UNREACHABLE, HUB_BAD_RESPONSE | Fix while SKILL.md is being reworked for Important 2 (three table rows). SKILL.md's closing catch-all sentence makes this non-blocking on its own |
| T3: live script follows redirects | Defer. No live GET route redirects, and a cross-origin redirect fails in fetch and is caught |
| T3: ETag on non-live GET HTML | Defer, harmless (`no-store` pages are never revalidated) |
| T3: `/mac/approve` valid 200 has no-script check missing | Defer. It renders with `chrome()` (`server.ts:335`) |
| T1: test hygiene; no rerun-after-review-failure test | Defer. By reading, rerun goes through `#claim` → `#touchColumn` and lands in doing (`story-store.ts:1079-1085`) |
| T2: failed assignees in "지금 일하는 사람"; unused csrf; duplicate asserts; mine/cancelled parsed twice | Defer |
| T4: `cookieOf` called twice | Defer |
| T5: only the exact `ASSUMED:` prefix is rewritten; unused untoned pill fallback | Defer |
| T6: NOT_YOUR_MAC wording for a member with no Mac | Defer. The command refuses earlier with UPLOAD_LINK |
| T7: no symlink refusal in `projectText`; no absolute-path test; `coverageWords` coupled to English wording | Defer. There is a fallback message, and the PL's own files are inside the trust model |
| T8: stray `.tmp` after a failed rename; "안내만 새로 받는다" understated | Defer |

## Rulings checked against the Story and design

No ruling contradicts the Story or the design in substance. Notes:

- **The query is dropped from a remembered sign-in path** (`/plans/<id>?changed=1` → `/plans/<id>`). This is a small narrowing of D42 (2) "그 주소로 간다". It is documented and acceptable.
- **The Mac label "꺼짐(4분 전)"** carries the "마지막 확인" that D42 (1) asks for. Fine.
- **The tone table** puts waiting/backlog cards in "진행 중" blue. This is consistent with K9's four colors and "need" meaning only where a person must act.
- **Fetching and pushing from the PL's registered clone** fits Global Constraint "호스트 git은 `branch.ts`의 `git()`로만" and K1. D34 governs Task execution, not the upload. The clone-unchanged test pins the promise.
- **"Extra codes … if wrong, the guide lists them anyway"**: the guide does not list three of them (see triage).
- **The NOT_YOUR_MAC 403 for a retired Mac's token on the upload routes only** matches Review Focus 4. Note that it reveals only that the token's Mac was retired.

## Declined to judge

- Approval-trust and security depth: client-trusted `storyHash`, `risk` taken from the Task file, sessions kept alive by 10 s polling, the `retiredMacLink` disclosure, symlinked gate paths. These belong to reviewer 2. I noted the correctness side above.
- Live swap refreshing hidden `revision`/`hash` in plan approve forms. I set this aside: the approve button only shows in `draft`/`awaiting_g3`, where the Office does not change the plan, so a silent swap from draft X to draft Y under a visible button needs a `queued` state in between, during which the button is gone. Left for reviewer 2.
- Real-browser behavior of `live.js` (hidden-tab events, IME composition, bfcache). Only vm tests exist, and nothing here can exercise a browser.
- Claude Code's exact skill-loader tolerance. Important 2 rests on the documented SKILL.md format and Anthropic's validator, not on a run of the loader.
- Router and redeploy behavior of the internal Hub, real GitHub protection rules, and a real two-Mac run. These are outside automated evidence and are listed honestly in the verification record.
- Story order inside a project (oldest first). The spec is silent and the impact is small.
- Cost of the full-table board read every 10 s per tab. Fine at team scale.
- The untracked kit run files under `.ai-workflow/runs/` and the G1 record rebind. These are kit workflow artifacts, not code.

## Recommendations

- Fix Important 1–4 in one small round: two page/render changes, one SKILL.md install format change and two live-script guards, each with a test. Then add the V20 test (Important 5). None of these touches the store, the link protocol or the planner.
- When reworking SKILL.md for Important 2, add the three missing error rows and the `already` wording (Minor 6) in the same edit.
- Consider Minor 1 (fixed queries per screen) now. It is cheap, and the plan's own constraint K5 asks for it.

## Assessment

**Ready to merge: With fixes**

**Reasoning:** The data model, upload protocol, command, extraction and landing are correct and well tested, and the existing flows (web planning, Task buttons, Mac connect, a Hub without the board) are intact. Five gaps remain. Two meet only part of their requirement: the cancelled-card toggle (D42 (1)) and the installed guide's frontmatter (K8). Two come from the live refresh colliding with the dev folds and from its stopped state. The fifth is a V20 evidence gap. All five are small, local fixes.
