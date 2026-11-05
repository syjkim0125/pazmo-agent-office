# U37 (teammate web) review, attempt 2 (scoped to the fix wave F1–F7)

Snapshot = tree `3a282fa` (fix range `579ac84..3a282fa`, 5 commits). Allocation: 2 read-only reviewers, opus: (1) a fresh scoped re-review of every fix F1–F7 and new breakage in the fix diff; (2) the attempt-1 Office-seam reviewer, resumed with its scratch scenarios, for F1/F2 against real Office timing. Reason: attempt 2 of 3, so scoped to the fixes. Reviewers ran focused tests (111/111) and scratch scenarios outside the checkout (9/9 and 1/1); the checkout was not modified.

## Disposition (controller)

All of F1–F7 ADDRESSED. Not ready: one new Important found by both reviewers. Fix before merge:

| Fix | Source | What |
|---|---|---|
| G1 | fixes reviewer Important = office reviewer N1 | `#pickBlock` checks NOT_LINKED before BUSY. While the member's Office works a Task (> 180 s) only that repo's link stays fresh, so every ready Task in the member's other repos shows "내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제)" on 내 할 일 and Task 상세 (with auto work on, the default) and a pick there is NOT_LINKED instead of BUSY. Fix: BUSY before NOT_LINKED; one store test; update the order where the plan, the record and the guide state it. |
| G2 | office reviewer I1 leftover, fixes reviewer Minor (concern 4) | Docs: the reachable check also lets through a pick within 180 s after an Office restart where a lane fell to `gh`, and any Hub call through a not-ready lane's link (a released record's heartbeat) stamps it; short wrong refusals right after a dropped record, the start's first drive or a merge (≤ 30 s). The release line says "그 레포 담당자" also on a Story verification Task; give that Task its own line. |

Deferred (disclosed): the "가져가기를 기다립니다" line also shows for up to 60 s after the Office's own claim (brief copy); Story M16 describes only the Office's own taking (the F2 ruling lives in the plan, the record and the guide; the Story is not edited inside this run).

## Reviewer reports (verbatim)

### Reviewer: fixes

# Kit review 2, reviewer 1 of 2: fix wave F1–F7 (bundle 2 "팀원 웹")

Range `579ac84..3a282fa` (5 commits). I read the diff file once, the Disposition and the attempt-1 reports, the fix brief and the implementer report. I made one focused check outside the diff for each named risk. The checkout was read-only throughout: `git status` shows only the 7 untracked `U37-*` run files that were already there.

Evidence I ran:
- Focused `tests/hub-web-office`, `hub-story-work`, `hub-story-pages`, `hub-store-mac`, `team-mac`: **111/111 pass**, exit 0.
- Scratch scenario `/private/tmp/claude-502/-Users-jongkkim-Documents-pazmo-agent-office--claude-worktrees-silly-liskov-b64760/3e953d43-7b8b-44f5-ac98-b68874478ce4/scratchpad/r2/busy-not-linked.test.mjs`: **1/1 pass**. It asserts the new breakage below, so a pass confirms the breakage exists.

### Findings

- **F1 ADDRESSED.**
  - `src/hub/store.ts:1069-1070`: `reachableRepos` keeps live links seen within `MAC_OFFLINE_MS` and returns an empty set when the newest Mac is locked. `liveLinkRepos` behaves as before (it now goes through `#liveLinks` at :1048).
  - `src/hub/server.ts:170,183,298-299`: home, the Task page, pick and the web rerun all use `reachableRepos`.
  - `src/hub/story-store.ts:820-825,838`: `rerunTask` refuses with `NOT_LINKED` after the other refusals and before the memo check. The link `rerun` is unchanged.
  - One message (`:206`). `TaskActions.rerun` is `yes|not-linked|no`, from the same `#rerunBlock`.
  - Pages: `story-pages.ts:88-89,198`.
  - Tests: the store test, the work test and the pages test, plus the real-scheduler `gh`-lane test in `tests/hub-web-office.test.mjs`. That test ticks the real scheduler and uses no sleeps.
  - The premise holds in code. `scheduler.ts:199-201`: with no record, `recover()` reads the inbox of every ready lane before `canExecute`/pause/cap. `store.ts:742` stamps `last_seen`. `office.ts:684` runs that tick every 30 s.
  - The fix creates a new Important problem; see the next section.
- **F2 ADDRESSED.** No code change.
  - The ruling is recorded verbatim (ASSUMED) in `docs/LOCAL-PREVIEW.md:260`, in the record's 판정 row `docs/verification/2026-11-05-teammate-web.md:34` and in the plan's "리뷰 뒤 바뀐 것" (`docs/plans/…-plan.md:310ff`).
  - The old "그 위에 그대로 적용된다" line is corrected.
  - Both limits are listed: runner not ready for one engine, and a pick inside the restart window.
- **F3 ADDRESSED.**
  - `story-pages.ts:120,138`: the rest sentence appears under the switch when the open card does not show it, and is shown once either way.
  - `:73`: the not_ready text names the first runner, or claude when there is none.
  - Test "a member with no open Task whose newest Mac rests with claude: not_ready sees what to do on /" covers: no Task, working card, failed, idle.
- **F4 ADDRESSED.**
  - `story-store.ts:884`: the refusal runs after PL-or-admin and ENDED, with the brief's text.
  - `server.ts:308`: the web cancel passes `{ refuseLocked: true }`.
  - `taskActions` returns `cancel: "locked"` (`:1255`), and the page shows the sentence instead of the form (`story-pages.ts:207`).
  - The link API still calls `cancelTask(link, id)`, and `link-api.ts:128` is untouched.
  - Covered by store, page and POST tests, including "after 풀기 it can be cancelled".
- **F5 items:**
  - **Held while the Mac is on: ADDRESSED.** `story-pages.ts:92,226`. `none` and `off` keep the old sentence.
  - **"가져가기를 기다립니다" before the first beat: ADDRESSED.** `story-pages.ts:97` `news()`, used on the Task page and the home open card. Tests check the assignee's and others' wording and that it switches to "마지막 소식 방금" after a beat.
  - **Softer auto-on line: ADDRESSED.** `story-pages.ts:191`.
  - **git/gh step failure row before the conflict row: ADDRESSED.** `story-pages.ts:43`. Pinned with a push failure and with a `CONFLICT`-bearing step reason.
  - **Web rerun STATE words, including after the PL released: ADDRESSED.** `RERUN_REFUSALS` `story-store.ts:216`. `#rerunBlock` returns STATE for not failed or no assignee. The link keeps "다시 실행" (`#rerun`), which is pinned.
  - **A double click that already succeeded lands on the Task page: ADDRESSED.** `server.ts:302` with `claimedBy` at `story-store.ts:1242`. Pinned for both pick and rerun. Another member's pick still gets the STATE page.
  - **Release line "그 레포 담당자 누구든": ADDRESSED.** `story-pages.ts:202`.
- **F6 items:**
  - **`until` sanitizing: ADDRESSED.** `src/team/mac.ts:293`. The test covers undefined, NaN, -1, 1.5, MAX_SAFE+2, Infinity, a string and a two-argument call. The key is always sent.
  - **Memo CRLF counted once: ADDRESSED.** `story-store.ts:802`, the shared rule for web and link. Pinned for 2019 raw characters → 2000 stored with LF, and one more character → INVALID.
  - **Revoked-Mac test isolates the Mac-alive clause: ADDRESSED.** `tests/hub-store-mac.test.mjs`: only the `hub_macs` row is revoked, and the test asserts the link row is still unrevoked. r2's owner row and the member stay, so only `k.revoked_at` can exclude the link. `reachableRepos` is asserted too, and the dead `t3` is gone.
- **F7 items:**
  - **LOCAL-PREVIEW says only what the code does: ADDRESSED.**
    - Rest sentence place: `:248`.
    - 자세한 이유 only on Task 상세: `:243`.
    - 마지막 소식 places: `:292`.
    - 그 repo 담당자: `:282`.
    - F1 rule: `:266`.
    - F4: `:284`.
  - **Record:**
    - "## 리뷰 1차 뒤 고친 것" with F1–F7, commits and tests: ADDRESSED (`:55`).
    - The changed 판정 rows are updated, and the 마지막 소식 ruling is at `:51`: ADDRESSED.
    - The impossible verify-Task limitation is removed (grep finds nothing): ADDRESSED.
    - Limits: gh-broken rerun, cancel after 풀기, local memo after web rerun, connection-string locked Office and board 멈춤 count, at `:101-105`: ADDRESSED.
    - 자동 검사 rows for this wave, with no review-2 or verify claims: ADDRESSED.
  - **Plan: ADDRESSED.** It has "## 리뷰 뒤 바뀐 것 (2026-11-05)" and 8 row markers. The brief's six rows are all among them, and no row was rewritten.

### New breakage in the fix diff

- **Important: a member who owns more than one repo is told their Mac has a fault while it works normally.** Every ready Task in their other repos shows "내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제)."
  - **Where:**
    - `src/hub/story-store.ts:1205-1206`: `#pickBlock` checks `NOT_LINKED` before `BUSY`.
    - `src/hub/store.ts:1069`: `reachableRepos` now depends on the link's `last_seen`.
    - `src/team/scheduler.ts:199`: `if (store.openClaim()) return { skipped: "open" }`. While the Office holds a record (claimed or failed), it reads no other lane. Only that record's own lane is stamped, by its beat or `watch()`.
  - **Scenario:**
    1. The PL, or any teammate, owns app-be and app-fe, and auto work is on (the default).
    2. Their Office claims a be Task. While the member holds it, every fe Task is BUSY for them, so before this wave no button and no line showed.
    3. After 3 minutes, `reachableRepos` holds only be. So `#pickState` returns `not-linked` for every ready fe Task, with auto work on or off.
    4. Home (`story-pages.ts:129`) and the Task page now show the fault sentence with a `/mac` link for the whole Task, up to 90 minutes. A hand-made pick is refused with NOT_LINKED ("…꺼짐·잠김이 아닌지…") instead of BUSY.
    5. The scratch test reproduces it: reachable after 4 beats = `[be]`, the fe card's pick = `not-linked` with auto work on, and the pick refusal = `NOT_LINKED`.
  - **Why Important:** No state is harmed; the button is absent either way. But this is the same class of defect that made F1 Important: the page tells a person something untrue and sends them to troubleshoot. It is now on the default working path, and the fix wave itself introduced it. None of the docs' cause lists (LOCAL-PREVIEW:266, record F1 rows) mention it, and no test pins it: the pages tests run on real time and never pass 3 minutes while busy.
  - **Fix (one line plus one test):** in `#pickBlock`, check `BUSY` before `NOT_LINKED`. Both `pickTask` and the buttons follow, since they share `#pickBlock`. Add a store test: a two-repo owner holding an open be Task for more than `MAC_OFFLINE_MS` sees fe cards as `busy`, and the pick is refused with BUSY. The rerun path is not affected, because the failed record's own lane is stamped by `watch()`.
- **Minor: after the Office's own `claimNext`, the waiting line is briefly untrue.**
  - **Where:** `story-pages.ts:97` (`news`) with `story-store.ts:677` (`#claim` sets `stage=NULL` for `claimNext` too).
  - **Scenario:** for up to one beat (≤60 s), a Task the Mac has already taken says "내 Mac이 가져가기를 기다립니다(보통 1분 안).". The brief specified this copy and the effect is short, so it can wait.

### Implementer concerns

1. **Rerun order, STATE before FORBIDDEN:** accept. It follows the brief literally. Every member sees every Task anyway, so nothing leaks, and it is pinned.
2. **No Mac (`none`) keeps the old held sentence:** accept. "Mac은 켜져 있지만" would be unknown there.
3. **Double-click redirect also hides a web memo when a local `team rerun` reached the Hub first:** accept. This is a rare race by the same person, and it is recorded as a limit in LOCAL-PREVIEW:299 and record:103.
4. **The release line "그 레포 담당자 누구든" also shows on a failed Story-verification Task, which has no repo:** accept as Minor, can wait. It is the brief's copy, and the old "누구든" was equally off. If touched later, branch on `t.kind`.
5. **The home rest sentence is wrapped in its own `<section>`:** accept. The `<p>` is as specified.
6. **Link API and protocol 3/4 unchanged:** accept. `link-api.ts` is not in the diff. The link `rerun`/`cancelTask` calls use the old signatures, and the only Office change is `mac.ts:293`.

### Out-of-scope observations

- Story M16 (`docs/understanding/pazmo-agent-office-contract.md:27`) still describes only the Office's own taking ("가져가기 멈춤·하루 상한에 걸리지 않을 때"). The F2 ruling lives in LOCAL-PREVIEW, the record and the plan, not the Story. This is consistent with the brief, and editing the Story would touch kit evidence. The controller may want a Story line at delivery.

### Verdict

**Ready to merge: No.** F1–F7 are all addressed (0 NOT ADDRESSED), but F1 introduced one Important regression. A teammate who owns several repos is shown a false "꺼짐·잠김·연결 문제" line on every other-repo Task for the whole time their Mac works. The fix is one line: check BUSY before NOT_LINKED in `#pickBlock`, plus one store test.

### Reviewer: office

# Kit review 2 (U37), Office seam re-check against the fix wave (reviewer 2 of 2)

Range: fix base 579ac84 → head 3a282fa, checked only against my attempt-1 findings (I1, I2, M1–M5) plus new breakage on the Office↔Hub-web seam. The checkout was read only; `git status` is the same before and after (only the kit run files are untracked). I ran the scenarios in a `git archive 3a282fa` copy:
`/private/tmp/claude-502/-Users-jongkkim-Documents-pazmo-agent-office--claude-worktrees-silly-liskov-b64760/3e953d43-7b8b-44f5-ac98-b68874478ce4/scratchpad/r3b/tests/seam-r3b.test.mjs`. They use the real Hub, the real Story links and the real scheduler: **9/9 pass**, and each test asserts the behavior named below. In the copy only, `tests/team-fixture.mjs` also passes `storeNow`, so the `HubStore` clock (which stamps `last_seen`) moves with `h.tick`. `hubWithStory` gives the clock only to the board. This means the checkout's own `hub-web-office` tests cannot age a link: the 180000 ms boundary is pinned only by the store test `hub-store-mac.test.mjs:588`.

### Findings

**I1 — ADDRESSED for S1 and S5's intended cases. Two narrow strands are left that the docs do not record.**

`src/hub/store.ts:1069-1078` (`reachableRepos`) works as follows:
- `link()` stamps `last_seen` on every Bearer call (`store.ts:742`).
- A team Office with no open record calls `recover()` → `inbox()` on every ready lane each 30 s tick, before `canExecute`, pause and cap (`scheduler.ts:199-201`).
- A failed record's lane is stamped by `watch()` at each 60 s beat.

So the timing claim holds for an idle Office and for a failed record. What I saw live:
- **S1:** a `gh` lane that never polled is refused with NOT_LINKED and nothing changes.
- **S1c:** a lane that polled, then fell to `gh`, is refused once 180001 ms have passed.
- **S5b:** a failed record whose lane has had no beat for 180 s gets `rerun: "not-linked"` and the POST is NOT_LINKED.
- **S5:** with a beat, the web rerun on a `gh` lane passes and strands. This is the recorded limit (`LOCAL-PREVIEW.md:295`, record :101).

Q1, part 1: a non-taking lane that still gets stamped, so the strand remains. The `gh`-lane rerun is not the only case:
- **(a) Recorded:** the rerun on a `gh` lane (S5).
- **(b) Not recorded, narrow (S1b, live):** the ≤180 s after an Office restart in which a lane fell to `gh`/`no-link` at start. For example, a `mac restart` or a `stop`/`up` whose new gh check fails. The previous run's stamps are still fresh, so the pick passes, is never recovered, and goes held after 10 minutes with the member blocked. `LOCAL-PREVIEW.md:266` and record :36/:97 say a lane that is not ready is always refused, and that a strand happens only when the Office stops within 3 minutes of the click.
- **(c) Not recorded, narrow, the same family as (a):** any Hub call through a not-ready lane's link stamps it. The scheduler and executor use `lane.link` whatever the lane's state. Example: a record on a `gh` lane that the PL released. Its NOT_YOURS heartbeat stamps the lane, and a pick in that repo within 180 s strands.
- **(d) Recorded:** a team Office linked by connection string (no Mac) running locked (S2b live: badge `none`, pick accepted and heartbeated forever, `LOCAL-PREVIEW.md:300`).

Q1, part 2: a ready, polling lane that is NOT stamped within 180 s, so a person is wrongly refused:
- **(i) While the Office holds any open record**, `runTick` returns `skipped: "open"` before `recover()` (`scheduler.ts:199`). Every lane except the record's goes stale after 180 s. This one is a new breakage in practice; see N1.
- **(ii) A record the Hub no longer counts as the member's open Task** has the same effect while the member is *not* BUSY on the Hub. Examples: a held Task the PL released (until the next beat drops it), or a `verified`/`merging` record kept by `keepOnNotYours` until the start's first drive settles, which can last the re-verify's whole check time limits. The member is refused for other repos with "꺼짐·잠김·연결 문제" words that do not apply. This is transient, and the Office would not take a new claim until the record clears anyway.
- **(iii) Right after the member's Task merges:** other lanes stay stale until the next tick, ≤30 s (S6, live).

Fix for (b) and (c): record them next to the `gh`-rerun limit, for example: "Office가 다시 켜진 뒤 3분 안, 또는 준비 안 된 레인의 기록이 Hub와 이야기한 뒤 3분 안에는 그 repo도 가져갈 수 있다로 보일 수 있다". No code change is needed for a narrow window.

**I2 — ADDRESSED.**
- **(a)** is now the F2 ruling (ASSUMED) in plan :315, record :34/:98 and `LOCAL-PREVIEW.md:262`. Plan row 43 keeps its old sentence, but it now points to '리뷰 뒤 바뀐 것'.
- **(b), S2 (live):** a Mac that reports `locked` empties `reachableRepos` (`store.ts:1070`). The pick is NOT_LINKED, and a failed Task's `rerun` is `not-linked` with a NOT_LINKED POST, even though the locked Office still polls and stamps.
- **(b) for an Office with no Mac** is a recorded limit (`LOCAL-PREVIEW.md:300`, record :104).
- **(c)** and **(d)** are recorded limits (LOCAL-PREVIEW, "AI 실행기 하나가 준비 안 됨인 동안…" and "Office가 스스로 다시 켜지는 몇 초 사이…").

No part of I2 remains a wrong behavior that is not recorded.

**M1 — ADDRESSED (doc).** `LOCAL-PREVIEW.md` "웹에서 다시 시도한 뒤 터미널에서 보낸 `team rerun --memo`의 메모는 쓰이지 않는다". The Office log line still says "with the member's memo" (`executor.ts:627`), which is acceptable under the no-Office-change rule. The reverse order (terminal rerun first, then web) now lands silently on the Task page and drops the web memo, through F5's double-click redirect (`server.ts:296-303`). That is documented in the same line.

**M2 — ADDRESSED.** `story-pages.ts:43`: `/ failed \d+ times in a row: /` comes before the conflict row and matches `stepFailed`'s `"<step> failed N times in a row: …"` (`executor.ts:665`). Note that "preparing the attempt" also covers contract and engine-submit errors, not only git and GitHub. That wording is acceptable.

**M3 — ADDRESSED.** `story-pages.ts:92` and the `macOn` check in `taskPage`: a held Task whose assignee's Mac reports anything other than off or none says "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다…". This covers `leaveRefused`, REPO_REMOVED and case (b) above.

**M4 — ADDRESSED.** `story-pages.ts:191` now reads "켜져 있으면 …". With reachable repos, `auto-on` only appears where the Office polls the repo. Off, locked and not-ready lanes show the NOT_LINKED line instead, and only paused or at-cap Mac states still get the soft line.

**M5 — ADDRESSED.** `story-pages.ts:97-100` (`news`): a `claimed` Task with no stage says "내 Mac / 맡은 사람의 Mac이 가져가기를 기다립니다(보통 1분 안)." in place of the Hub's own claim time. This shows on Task 상세 and on home's open card. A small leftover: after `recover()` but before the first beat (≤60 s), the page still says it is waiting.

### New breakage

**N1 (Important). While a member's Task runs longer than 3 minutes, every ready Task in their *other* repos says the Mac is not taking it. This happens with auto work on, the default.**
- **Where:** `src/hub/story-store.ts:1202-1206`. `#pickBlock` checks NOT_LINKED (line 1205) before BUSY (line 1206). Its input is now `reachableRepos`, and that set goes stale for every lane except the record's while a record is open (`scheduler.ts:199`).
- **What the person sees (S7, live):** member A with repos be and fe; be-1 is claimed automatically and runs for 4 minutes with heartbeats on be only.
  - `memberWork(…reachableRepos).ready` = `[["fe-1","not-linked"]]`. Before the fix, with `liveLinkRepos`, it was `[["fe-1","busy"]]`.
  - Home renders `내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제).` linking to `/mac` on each such card (`story-pages.ts:129-130`). It does so whatever the switch says.
  - The Task page shows the same text (`story-pages.ts:192`).
  - A POST pick there answers NOT_LINKED instead of BUSY.
  - The same happens while the member holds a failed Task.
- **Effect on a person:** this is a routine false alarm. Almost every Task lasts longer than 3 minutes, so any member with more than one repo sees their Mac blamed for "꺼짐·잠김·연결 문제" during most of the day. It sends them to `/mac` or to the PL to troubleshoot a Mac that is working. No Task is lost or run wrongly.
- **Fix:** check BUSY before NOT_LINKED in `#pickBlock`, which also fixes `#pickState` and the POST. Update the order in the plan 판정 row 44, the record row 35 and the `hub-story-work` "pickTask refuses in order" test. Add one test: a member holding an open Task whose other repo's link is stale sees `busy` (no text), not `not-linked`. `#rerunBlock` is not affected, because a failed record's own lane is stamped every beat.

No other new breakage on this seam:
- `until` is now sanitized in `mac.ts:286-294`. `RERUN_REFUSALS` and the double-click redirect do not change what the Office receives.
- `cancelTask({refuseLocked})` keeps the late-report path: release, then the lock holder's report.
- The link API's `rerun` and `cancel` are unchanged.

### Verdict

**Ready to merge: No.** One Important item is left: N1, a one-line check reorder plus a test, introduced by F1. Narrow strands (b) and (c) under I1 should be recorded as limits; no code change is needed for them. I1 and I2 are otherwise addressed, and M1–M5 are addressed.
