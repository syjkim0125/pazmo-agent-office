# U37 (teammate web, bundle 2 of D41) review, attempt 1

Snapshot = tree `579ac84` (range `8055471..579ac84`, 8 commits). Allocation: 3 independent read-only reviewers (kit default 3), all opus:
1. generalist whole-branch review against plan, design, Story and the SDD ledger (with triage of every deferred minor);
2. seam: Hub web permissions, security and store concurrency;
3. seam: how members' team Offices meet what the Hub web does, and failure paths.
Reason: ~3.7k-line change whose central ruling (web actions reach the Office through its existing recovery) crosses the Hub/Office seam; seven task-scoped reviews already ran (all clean first pass). Reviewers ran only focused test files (general 95/95 over 5 files, hubweb 91/91) and scratch scenarios outside the checkout (office 5/5); the checkout was not modified.

## Disposition (controller)

Not ready: Critical 0, Important 4. Fix before merge:

| Fix | Source | What |
|---|---|---|
| F1 | office I1, office I2(b), general m4, hubweb minor (rerun has no link check) | "Linked" on the Hub is not "my running Office takes this repo": a pick (or a web rerun) in a repo whose lane is not ready (gh login, link on another machine) or on a locked Office is never driven, the member is BUSY for every repo, and the page says something untrue. Fix: the Hub counts a repo as reachable only when the member's link to it was used within `MAC_OFFLINE_MS` (180000 ms; a running team Office reads the inbox of every ready lane each 30 s tick while it holds no record, and the failed record's Task read each beat) and the member's newest Mac does not report `locked`. Pick and web rerun both require it (`NOT_LINKED`, new words); buttons follow the same rule. Pin with the real scheduler (a `gh` lane is not reachable). |
| F2 | office I2(a)(c)(d) | A person's own pick or rerun overrides `team pause` and the daily cap and is not counted in `claimedToday`; this was unrecorded and LOCAL-PREVIEW said the opposite. Fix: record it as a ruling (ASSUMED) and correct the docs; list the runner-not-ready wording and the restart-window pick as limits. |
| F3 | general I1 | 내 할 일 shows the rest sentence only inside the open-Task card, so a teammate whose claude is logged out (no Task open) is never told what to do; the not_ready sentence has no instruction. Fix: show the rest sentence on home whenever the Mac rests and no card shows it; add "Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요." |
| F4 | hubweb I1, general m1 | 취소 on a Task that holds the merge lock gives no warning, cannot be undone and refuses the late merged report (the change may already be in the Story base). Fix: the web refuses cancel while the merge lock is held (STATE, "먼저 풀기"), the page shows that sentence instead of the cancel form; the link API is unchanged. |
| F5 | office M2–M5, general m2, m5, ledger T1 minors | Wording: held sentence when the Mac is on; "Mac이 가져가기를 기다립니다" before the first beat instead of the Hub's own claim time; softer auto-on line; a plain sentence for git/gh step failures before the conflict row; web rerun STATE words ("다시 시도", refresh hint) also when the PL released meanwhile; a double-click that already succeeded lands on the Task page; release line "그 레포 담당자 누구든". |
| F6 | general m3, ledger T3 minor, hubweb minor, ledger T2 minor | Office sends `until` only as a safe non-negative integer (else null); memo CRLF counted as one line break; the revoked-Mac test isolates the Mac-alive clause of the link rule. |
| F7 | general m5, m6, office M1, ledger T7 minor | Docs: LOCAL-PREVIEW and the record say only what the code does (rest sentence place, "자세한 이유" on Task 상세, "마지막 소식" only where it is, repo owners only); remove the impossible verify-Task limitation; record F1–F6, the rulings and the new limits (a rerun on a gh-broken lane still passes the check because the failed Task read stamps the link; cancel after 풀기 still refuses a late report; a local `team rerun` memo is unused when the web reran first). |

Deferred (disclosed, not blocking): hubweb "revoked while the POST body arrives" (the existing browser-POST pattern; the Mac API already re-checks); general m7 (board 멈춤 count ignores a failed Story verification — changes the link API's StorySummary; bundle 4). Every other ledger `minor (deferred)` item: CAN WAIT per the generalist's triage.

## Reviewer reports (verbatim)

### Reviewer: general

# Kit review 1 — generalist (bundle 2 "팀원 웹"), range 8055471..579ac84

Reviewer: generalist whole-branch (1 of 3). Read: plan (Global Constraints, 판정, Review Focus, Tasks), design `hub-web-team-flow-decision.md`, Story M16/D41/V19/Domain, the SDD ledger, the full diff of `src/hub/{story-store,store,server,pages,story-pages,mac-api}.ts`, `src/team/{mac,mac-watch,office}.ts`, all new/changed tests, `docs/LOCAL-PREVIEW.md` "### 팀원 웹", `docs/verification/2026-11-05-teammate-web.md`, plus the Office paths the web relies on (`scheduler.recover/runTick/settle`, `office.ts` timers and `presenceOf`, `executor.failAttempt/waitForRunner/prClosed`).

Ran (read-only): `node --experimental-vm-modules --test tests/hub-story-work.test.mjs tests/hub-story-pages.test.mjs tests/hub-web-office.test.mjs tests/hub-store-mac.test.mjs tests/hub-mac-api.test.mjs` → **95/95 pass**, 0 fail. Full suite not re-run (1607/1607 reported). `main` moved since base: `cd32dd0` (PR #76) changes only `.ai-workflow/runs/U36-review-1.md` — no overlap; no `U37` on `main`.

### Strengths

- **One rule for buttons and actions.** `#pickBlock` drives both `pickTask` (refusal code/message) and `#pickState` (button state on home and Task page); `taskActions` mirrors `rerunTask`/`releaseTask`/`cancelTask` exactly (`stuck()`, `ENDED`). A screen cannot offer a button the POST then refuses, except through a race. Pinned by "memberWork pick …" and the `taskActions` tests.
- **Office unchanged except `until`, and that claim is proven, not asserted.** `tests/hub-web-office.test.mjs` drives the real scheduler against a real Hub for pick (even with local pause on), web rerun (old record dropped as NOT_YOURS at the next beat, new claim recovered at attempt 0 with lastFailure+memo), the switch, and PL release; RED was shown by 6 mutations (ledger Ruling). This is the right evidence for the plan's central 판정.
- **Store changes are additive and safe on old data.** `hub_work_settings` via `CREATE TABLE IF NOT EXISTS` (no row = on, so existing teams keep working), `hub_macs.until` via `#migrate` with an old-file test; `Actor` widening keeps the link API (`Link` has `member`); protocol 4 `until` is optional both ways (old Office → `num()` null clears; old Hub ignores the key).
- **Concurrency is held by the existing unique index and transactions.** Pick-vs-pick (STATE), pick-vs-claimNext, double rerun (STATE), link rerun vs web rerun, one open Task per member — all pinned in `hub-story-work.test.mjs` with "nothing changed" row snapshots.
- **Escaping and CSRF are thorough.** Every interpolated value on the new pages goes through `esc()` (numbers excepted); the hostile-text test covers titles, spec, files, summary, decision lines, failure, memo, Story title/body, member and repo names on all four pages; every new POST is inside `browser()` after the Origin/CSRF gate, and a hub without a board 404s both new GETs and POSTs.
- **Pages follow the 판정 table closely:** state words, plain failure sentences in the specified order (verified against the real Office reason strings in `executor.ts`: `RUNNER_*`, `PR #… was closed on GitHub`, `BUILD_TIMEOUT:`), failure shown only while `failed` (the Task 1 carried minor is resolved and pinned by "a Task that failed, was released and is claimed again shows no failure text"), the "내 Mac / 맡은 사람의 Mac" ruling, the confirm checkbox (client `required` + server `INVALID`).

### Issues

#### Critical

None.

#### Important

**I1. 내 할 일 says nothing when the member's Mac rests with no open Task — the ordinary "claude logged out" case — and the not_ready sentence never says what to do.**
- Where: `src/hub/story-pages.ts:104-111` (the wait line is rendered only inside the open-Task card, `o.wait && working(open.state)`), `src/hub/story-pages.ts:70-71` (not_ready text), with `src/team/office.ts:504-505` (a live Office whose runners are not ready, with no record, beats `limited` / `"claude: not_ready"` and claims nothing).
- What is wrong: D39 reports a logged-out or missing CLI as `not_ready` *before* any run, so it occurs with no open record. The Hub has the reason (`macWait` → `{kind:"not_ready", runners:["claude"]}`), but the home page shows only "자동으로 일하기 켜짐 … 켜져 있어 내 Mac이 받을 수 있는 일을 차례대로 가져갑니다." above a list of ready Tasks. The header pill says "내 Mac: 쉬는 중(한도)" (bundle 1 label, wrong cause), and `/mac` shows the raw "쉬는 중(한도) — claude: not_ready". When a Task *is* open, the line shown is "Mac의 AI 실행기(claude)가 준비되지 않아 쉬는 중입니다." — still no instruction (compare `plainFailure` RUNNER_NOT_READY, which does say "Mac에서 claude 설치와 로그인을 확인한 뒤…").
- Effect on a person: a non-developer teammate whose claude login lapsed sees "your Mac takes work" and ready Tasks, and nothing ever comes; no screen tells them to run `claude` and log in. This is exactly the design's anti-goal ("로그인 만료 같은 예외는 웹이 무엇을 할지 쉬운 말로 알려 준다") and weakens 팀원 6. (Plan-aligned wording/scope — the 판정 row limits the line to "맡은 일과 Task 상세" — so this is a plan gap, not an implementation slip.)
- Fix (small): on home, when `o.wait` is non-null and no open working card already shows it, render `<p>${esc(waitText(o.wait, Date.now()))}</p>` under the switch line; extend the not_ready text with the action, e.g. "Mac의 AI 실행기(claude)가 준비되지 않아 쉬는 중입니다. Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요." One page test: a member with no open Task and a `limited` / `claude: not_ready` Mac sees the sentence on `/`. If the human prefers not to re-open this branch, it must land before the 중간점검 (teammates are not told to use the web before then), and the record/STATUS should list it.

#### Minor

**m1. The 취소 form does not warn about a held merge lock, while 풀기 does.** `src/hub/story-pages.ts:183-185` vs `180-182`. Cancelling a Task that holds its (Story, repo) merge lock can leave its change already merged into the Story base while the Task reads 취소됨 (`reportMerged` refuses a late report for a cancelled Task, `story-store.ts` late path `seen.state !== "cancelled"`). Effect: the PL believes the change is excluded; Story verification later runs over it. Fix: when `t.mergeLock`, append "머지 중이었을 수 있습니다. 이미 Story base에 들어간 변경은 취소해도 남습니다." to the cancel line too.

**m2. A double-click on 작업하기 or 다시 시도 ends on an error page after the action succeeded.** `src/hub/server.ts:296-297` with `story-store.ts:786`. Browsers commonly send both submits and show the second response: pick → "지금 받을 수 있는 Task가 아닙니다. 화면을 새로 고쳐 상태를 확인하세요." (tolerable), rerun → "실패한 Task만 다시 실행할 수 있습니다." (reads like the rerun failed; uses "다시 실행" while the button says "다시 시도"). The error page (`pages.ts:54-55`, `layout(…, null, …)`) has no menu and only "처음으로". This makes ledger Task 1 minor #1 reachable by an ordinary double-click, not only by hand-made requests as the record says. Fix: in the two routes, when the refusal is STATE and the Task is now the member's `claimed` Task, redirect to `/tasks/<id>` (idempotent success); otherwise give the web rerun its own STATE text ("이미 다시 시도 중이거나 실패 상태가 아닙니다. 화면을 새로 고쳐 확인하세요.").

**m3. The Office does not make `until` acceptable before sending it.** `src/team/mac.ts:288`. `macClient.heartbeat` sanitizes `detail` so "a beat is never lost", but forwards `until` raw; the Hub refuses a negative/fractional/unsafe value with 400 for the whole beat, and `mac-watch` only logs non-401 failures — the Mac would read 꺼짐 for the entire runner wait (up to 6 h). Latent today (`retryAt` = `Math.min(ceil(resetsAt) or now+30min, since+6h)` is always a safe integer), but the invariant now depends on executor arithmetic. Fix: `until: Number.isSafeInteger(until) && until >= 0 ? until : null` (also covers the ledger's `until ?? null`).

**m4. A web pick on a member whose Office runs locked (no `--live`) is taken back and heartbeated forever without running; the PL cannot release it.** `src/team/scheduler.ts:198-204` (`recover()` runs before `canExecute()`), `src/team/office.ts:254-256` ("Without live … only its heartbeat goes on"). The Hub shows "진행 중(구현)"/"시작 중" with a fresh 마지막 소식, never held, so 풀기 is never offered; the only exit is 취소 (irreversible) or the member restarting live. Rare (the LaunchAgent runs `up --team`, which is live; a manual `start --team` is a developer path), so Minor; the Office seam reviewer should confirm. Fix options: do not offer 작업하기 when the member's newest Mac is `locked` (the Hub knows via `macBadge`), and/or let a locked Office skip `recover()` for claims it has no record of.

**m5. Docs state behavior the code does not have.**
- `docs/LOCAL-PREVIEW.md:243`: "멈췄으면 쉬운 말 한 문장과 '자세한 이유'(원문)가 붙는다" — home shows only the plain sentence for a failed Task (자세한 이유 is on Task 상세) and nothing extra for a held one.
- `docs/LOCAL-PREVIEW.md:248`: "맡은 일 위에 … 문장이 나온다" — it is inside the open-Task card and only when a Task is open (see I1).
- `docs/LOCAL-PREVIEW.md:277` (and the release line on the page): "누구든 처음부터 다시 받는다" — only that repo's owners can take it.
- `docs/verification/2026-11-05-teammate-web.md:84` lists as a person-visible limitation "PL의 실패한 Story 검증 Task가 내 할 일에서 '자세히·다시 시도'로 링크된다" — unreachable: `memberWork.open` requires `claimed_by = member`, and `reportVerify(passed:false)` sets `claimed_by=NULL` (the only path to a failed verify Task); the `led` cards never render that link. The record is frozen after kit review, so correct it in the delivery commit's STATUS entry; fix LOCAL-PREVIEW in the same commit.

**m6. Unrecorded plan deviation: "마지막 소식 N분 전" is not on each screen.** The 판정 row says every screen carries a 새로 고침 link and 마지막 소식 (ASSUMED); the implementation shows it only on Task 상세 and home's open card (board, Story page, ready/led/done cards have none). Effect is small (the Task page has it), but it is neither a Ruling nor in the record's "구현 중 바뀐 것". Fix: record it as a Ruling in the delivery STATUS, or add the heartbeat age to the Story page's Task rows.

**m7. The board's 멈춤 column ignores a failed Story verification.** `src/hub/story-store.ts:1028-1049` (`stories()` reads `t.kind='work'` only). A failed verification reopens the Story ("진행 중") and the row shows 멈춤 0; the PL learns of it only from 내 할 일 "내 Story에서 멈춘 일". Fix: count the verify Task in `failed` (or show the Story as "Story 검증 실패" while its verify Task is failed).

### Deferred minors triage

| Ledger line | Verdict | Reason |
|---|---|---|
| T2: `hub-store-mac.test.mjs:362` revoked-Mac assertion passes via the link cascade, not `liveLinkRepos`'s `k.revoked_at` clauses | CAN WAIT | Every Mac revoke path (`#revokeMac` used by `revokeMac`/`revokeOwnMac`/second-Mac approve, and `revokeMember`) revokes the Mac's links in the same transaction, so no person can reach the unpinned clause today; add a row-only revoke test when touching the file. |
| T2: dead `t3` / `void t3` | CAN WAIT | Test hygiene only. |
| T2: `store.ts` redundant `typeof` check in `macHeartbeat` | CAN WAIT | `Number.isSafeInteger` already rejects non-numbers; harmless. |
| T1: non-failed web rerun shows "실패한 Task만 다시 실행할 수 있습니다." | CAN WAIT | No state harm; but reachable by a double-click, not only hand-made requests — see m2 for the fix; do it with the next copy batch. |
| T1: PL release between render and rerun → FORBIDDEN instead of STATE | CAN WAIT | A race; nothing changes, a reload shows the true state; wording only. |
| T1: no `memberWork` test that `ready` excludes Tasks of a non-open Story | CAN WAIT | Draft Stories keep Tasks `waiting` (`#recompute` skips draft/cancelled), so the `s.state='open'` clause is defensive; pick refusal for a draft Story is pinned. |
| T1: unused `check` in `hub-story-work.test.mjs` | CAN WAIT | Test hygiene only. |
| T3: `mac.ts` sends `until: undefined` for a two-argument JS caller | CAN WAIT | The Hub's `num()` treats a missing key exactly like null (clears), and TS callers pass three args; fold into m3's sanitizing line. |
| T3: `team-mac.test.mjs` L329/339/345/351 still call heartbeat with two args; test name merged | CAN WAIT | Exercises the same path the Hub accepts; test hygiene. |
| T4: `story-pages.ts:108` PL's failed verify Task links "자세히·다시 시도" | CAN WAIT | Unreachable (a failed verify Task has no assignee, so it is never `open`); the record's limitation line claiming it is wrong — see m5. |
| T4: tests don't pin "마지막 소식 N분 전", 새로 고침 only on /board and Story, no hostile Mac detail through `waitText` on a page, revoked-Mac link not exercised through pages | CAN WAIT | Both `waitText` call sites wrap it in `esc()`; liveness is pinned at store level; these are coverage gaps, not behavior gaps. |
| T4: `button()` emits `class=""` (pinned by a test); `/board` N+1 stories query | CAN WAIT | Cosmetic markup; team-scale data. |
| T6: merged helper omits `forget()`/`reply.ready`; `tick(600001)` hard-codes HELD_AFTER_MS; stage via `stageOf` stub; test 4 chains scenarios | CAN WAIT | Test structure; the mutations showed the tests catch the paths they claim. |
| T5: unknown-id test only for an admin without links; CSRF test's state check weak for release/cancel | CAN WAIT | `#found` runs first in every action (NOT_FOUND order pinned at store level); the CSRF gate is one check before every POST route in `browser()`. |
| T7: docs say every page has "마지막 소식"; guide carries a design rationale; 만든 것 counts mix scopes | CAN WAIT | Doc wording; fix in the delivery commit together with m5/m6 (the record itself stays frozen). |
| T1 (carried to T4, not deferred): failure kept through release+pick | Resolved | `failedNow()` gates every failure render; pinned by "a Task that failed, was released and is claimed again shows no failure text". |

### Declined to judge

- Header label "쉬는 중(한도)" for every `limited` kind — bundle 1 wording; the plan keeps it ("머리글 … 그대로 둔다").
- Fixed plan copy that names claude even when the runner is codex (RUNNER_LOGIN/NOT_READY sentences, `login` wait) — plan-specified text.
- Cross-repo order follows the Office's lane order; no auto refresh — both ASSUMED rows in the plan, recorded as limits.
- No 반납 button, notifications, Story cancel on the board, PL web Story authoring/G1/Task split, Story verification/G4/main merge — plan "이 계획 밖" and bundles 3–4.
- Error pages without menu (`layout(…, null, …)`) — pre-existing pattern for all Hub errors (touched only in m2's suggestion).
- Visual rendering in a real browser, real Mac pickup timing, real OpenShift proxy/time zone — not verifiable here; listed in the record's 확인하지 않은 범위.
- Office lifecycle/failure paths beyond what the web relies on (restart hold, runner checks, drive) — Office seam reviewer (3); m4 is flagged for them to confirm.
- Hub web permissions/concurrency in depth (session, Origin list behind the router, rate limits) — Hub web seam reviewer (2).
- Rolling back to an older Hub (ignores `hub_work_settings`, so everyone works automatically again) — operational, outside the plan.
- `inTime` rounding at 59.5–60 min ("약 1시간 뒤") — within "약".

### Verdict

**Ready to merge: With fixes.** No Critical; one Important (I1: the web never tells a teammate whose claude is logged out what to do, and shows nothing at all when no Task is open) — a small page change plus one test; the Minors and every deferred ledger minor can wait for the delivery commit or a later copy batch, with m5 corrected in STATUS since the record is frozen.

### Reviewer: hubweb

# Kit workflow-review — reviewer 2 of 3 (seam: Hub web permissions, security, store concurrency)

Range 8055471..579ac84, checkout `.claude/worktrees/silly-liskov-b64760`, read-only. Files read in full or by diff: `src/hub/story-store.ts`, `src/hub/store.ts`, `src/hub/mac-api.ts`, `src/hub/pages.ts`, `src/hub/story-pages.ts`, `src/hub/server.ts`, `src/hub/link-api.ts` (unchanged), `src/core/approvals.ts` (`transaction`), the Office `until` sender (`src/team/office.ts`, `mac.ts`, `mac-watch.ts`, `executor.ts` retryAt) for the wire contract only.

Evidence I ran:
- Focused seam tests `tests/hub-story-work.test.mjs tests/hub-story-pages.test.mjs tests/hub-store-mac.test.mjs tests/hub-mac-api.test.mjs`: **91/91 pass, exit 0**.
- Scratch probes (in-memory store and a proxied hub, scratchpad only): `probe1.mjs` (web rerun without ownership/link; cancel vs release of a merge-locked held Task followed by the lock holder's late merged report), `probe2.mjs` (cancel POST by a PL revoked while the body arrives). Results are quoted in the findings.
- `git status --porcelain` after the runs shows only the three untracked kit run files that were already there.

### Strengths

- **Authorization stays in the store.** Every new web action is a `StoryBoard` method that does its own check inside `transaction` (`BEGIN IMMEDIATE`): `pickTask` checks in the planned order NOT_FOUND → STATE → FORBIDDEN (`#owns`) → NOT_LINKED → BUSY. `rerunTask` checks NOT_FOUND → verify STATE → FORBIDDEN (assignee only) → state, then the memo. Release and cancel reuse the unchanged `#assertPlOrAdmin`. The server passes only `me` from the session, so a member cannot act as someone else, and the switch writes only the caller's row.
- **One rule for the button and the POST.** `#pickBlock` drives both `#pickState` (buttons on the home and Task pages) and `pickTask`. `taskActions` mirrors the rerun, release and cancel checks. I found no case where a button shows for an action that the POST refuses, other than the rerun link gap in Minor 1, where the button and the POST agree with each other and both skip the link check.
- **`liveLinkRepos` matches `link()` clause for clause:** active member, owner join, link not revoked, and if the link was minted by a Mac, that Mac row exists and is not revoked. A revoked member or device has no session. A revoked Mac's links fail both the cascade and the `k.revoked_at` clause. A removed owner fails the owner join. Pick runs with no `await` between `liveLinkRepos` and `pickTask`, so there is no in-process TOCTOU.
- **Refusals leave no partial writes.** Every pick and rerun refusal happens before `#claim`. The memo is validated before the claim. `on` and `confirm` are checked in the route before any store write. `macHeartbeat` validates `until` before its single UPDATE. A unique-index violation would roll back the transaction and show the generic 500 page.
- **CSRF and Origin.** Every new POST sits inside `browser()` after the Origin check (which runs before the session lookup) and the timing-safe CSRF compare. The test at `tests/hub-story-pages.test.mjs:598` covers all five POSTs with a foreign origin, no token and a wrong token, and checks that nothing changed. Redirects go only to `/` or `/tasks/${id}`, where `id` matched `[0-9a-f-]{36}`, so there is no open redirect. GET pages have no new side effects. On a hub without a board, the new POSTs fall through to 404.
- **Escaping is complete in `story-pages.ts`.** Every value from the store or a Mac goes through `esc`: titles, Story body, specs, files, summary, decision lines (ASSUMED bolding wraps `esc(line)`), failure (plain line and `<pre>`), memo, names, repo, project and base-branch names, `waitText` (detail and runners), `macOff`, PR URLs, ids and the error messages in `page.error`. Numbers are interpolated raw only where they are SQLite integers. PR `href` safety rests on `prUrlOf` at write time: `https:` only, no credentials, no quotes or angle brackets. CSP and HEADERS are unchanged, and the new pages have no `<script>` (pinned by the test at :453).
- **Concurrency rules are kept.** Two members picking one Task, and a pick racing `claimNext`, are serialized by `BEGIN IMMEDIATE`, with the `hub_one_open_task` partial unique index as a backstop. A web rerun and a link `rerun` share `#rerun`, so whichever comes second gets STATE (the Office's `rerunTaken` then adopts the web claim through `inbox`). Release keeps `lock_member`/`lock_claim`, so a late merged report still counts; the probe confirms `{"ok":true,"already":false}`. `claimVerify` ignores the switch, as planned.
- **Backward compatibility.** `/api/link/*` and its replies are byte-identical in behaviour: `Link` is structurally an `Actor`, link `rerun` keeps its old check order and messages, and `claim` still answers `{task:null, open}`. On protocol 4, a heartbeat without `until` clears the stored value, and an old Hub ignores the extra key. `hub_macs.until` comes from an `ALTER` in `#migrate` and `hub_work_settings` from `CREATE TABLE IF NOT EXISTS`; all inserts use explicit column lists, so a downgrade still works.

### Issues

#### Critical

None.

#### Important

1. **Cancelling a Task that holds the merge lock: no warning, irreversible, and a merge that already landed is then disowned.**
   - **Where:** `src/hub/story-pages.ts:183-184` (cancel form), with `src/hub/story-store.ts:1205` (`taskActions.cancel`), `:412-418` (`#cancel` clears `lock_member`/`lock_claim`) and `:906-907` (`late` excludes `cancelled`).
   - **Scenario:** C's Office takes the merge lock on Task #1 and merges the PR into the Story base with `gh`. The Mac then drops before `reportMerged`. Ten minutes later the PL gets the held alert and opens the Task page. Both buttons show:
     - 풀기 says "…머지 중이었을 수 있습니다."
     - 취소 says only "취소하면 이 Task는 하지 않고, 뒤 Task는 이것 없이 진행합니다."

     The PL picks 취소 and ticks the box. The Mac comes back and sends its late merged report under the locking claim, and gets `NOT_YOURS`. The probe shows exactly this sequence: after release, the same report counts.
   - **Effect on people:**
     - The Hub says 취소됨 while the change is in the Story base.
     - Dependents become ready, and their `upstream` omits this Task's summary and decision lines.
     - The board shows no PR or merge commit for the Task.
     - The change ships at G4 anyway, although the PL believed it was dropped.
     - Cancel cannot be undone. Before this branch, no human client called `cancel-task` (`src/team` has no caller), so the web is the first place a person meets this.
   - **Fix (web only, link API unchanged):** while `t.mergeLock` is true, hide 취소 by adding `&& t.merge_lock === 0` to `taskActions.cancel` and refusing in the cancel route with STATE ("머지 잠금이 있는 Task는 먼저 풀어 주세요"), so the PL releases first and the late report path stays. At minimum, add the warning to the cancel form when `t.mergeLock`: "머지 중이었을 수 있습니다. 이미 머지됐다면 취소해도 그 변경은 Story base에 남습니다." Add a test with a held, locked Task: the cancel button is absent or warned, and release-then-late-report still counts.

#### Minor

1. **Web rerun ignores repo ownership and a live link, unlike pick and unlike the link rerun.**
   - **Where:** `src/hub/story-store.ts:805-814` (`rerunTask`), `:1203` (`taskActions.rerun`), `src/hub/server.ts:297`.
   - **Scenario:** an admin removes C as an owner of app-be while C holds a failed app-be Task. Or C's only link to that repo was revoked, for example the Mac was replaced and the new Mac has not linked the repo yet. The Task page still offers 다시 시도, and `rerunTask` succeeds. The probe shows `liveLinkRepos(c)` = `[]` and rerun `{"ok":true}`, with the row now `claimed` under a new claim id.
   - **Effect on people:**
     - The Task shows 시작 중, then after 10 minutes 멈춤(Mac 소식 없음). The plain failure reason disappears because `failedNow` is false.
     - In the removed-owner case no Office can ever take it, since `link()` requires ownership.
     - The link `rerun` refuses this, because it needs a valid link of that repo. Pick refuses it with NOT_LINKED for exactly the plan's reason: "연결 없는 repo를 고르면 아무도 그 claim을 돌리지 않는다".

     No security impact: the claim is unusable without a link.
   - **Fix:** pass `linked` into `rerunTask` and `taskActions`. Refuse with NOT_LINKED when the repo is not in `linked` (this covers a removed owner as well), and show the same `/mac` hint instead of the button.
2. **The browser session is read before the body and not re-checked, so a member or device revoked mid-request still acts.**
   - **Where:** `src/hub/server.ts:135` (session) vs `:141` (`await readBody`).
   - **Scenario:** the probe opens a cancel POST as the PL, sends 5 bytes, has the admin run `revokeMember(PL)` (the session is invalid at that point), then finishes the body. The response is `303`, and the Task is `cancelled`.
   - **Context:** this is the pre-existing pattern for every browser POST. The new release and cancel routes inherit it, while the Mac API deliberately re-authorizes after its body (`mac-api.ts:76-80`, tests at `hub-mac-api.test.mjs:481/500`). The marginal risk is low, because whoever holds the cookie could act before the revocation anyway.
   - **Fix:** re-run `c.store.session(cookie(req))` after `readBody` (no `await` before the store call) and refuse with 401 if it is gone.
3. **The rerun memo limit and line breaks.**
   - **Where:** `src/hub/story-pages.ts:178` (`maxlength="2000"`) vs `src/hub/story-store.ts:787` (`memo.trim()` then length).
   - **Scenario:** form submission sends textarea line breaks as CRLF, while `maxlength` counts a line break as one character in current browsers. A memo near 2000 characters with line breaks passes the browser and fails on the server with INVALID "메모는 2000자 이하의 문자열이어야 합니다.". With `cache-control: no-store`, the Back button may not restore the typed memo. Stored memos also carry `\r\n` into the Office contract.
   - **Fix:** normalize `\r\n` to `\n` in `#rerun` before trimming and measuring, which keeps the link and web paths alike.

The ledger's deferred minors in this seam still stand and are not repeated here:
- the non-failed rerun message
- release between render and POST is FORBIDDEN
- the revoked-Mac test passes via the cascade
- the verify "자세히·다시 시도" link
- cancel INVALID before the lookup

### Declined to judge

- How the Office takes a web pick or rerun over (`recover`, `rerunTaken`, how local pause interacts with a pick): reviewer 3's seam. I checked only that the Hub replies and `inbox.mine` give it what it needs.
- That every member sees every Story, Task, failure and memo, and another member's Mac state and wait reason on the Task page: a plan ruling (판정 "모든 팀원이 모든 프로젝트·Story·Task를 본다"), not a defect of this code.
- Multi-process or multi-replica Hub writes: the deployment is one process on one sqlite file. `BEGIN IMMEDIATE` would serialize anyway; I did not test it.
- Refusing the whole heartbeat for a bad `until`, rather than dropping the field: planned as INVALID. The Office always sends an integer (`Math.ceil` in `claude-profile.ts:179`), so I did not judge it further.
- A double-click on 작업하기 or 다시 시도 showing a STATE page after the first click succeeded: a plan ruling (Review Focus 2). I did not exercise it in a real browser.

### Verdict

**Ready to merge: With fixes.** Fix Important 1 before merge, at least by hiding or warning on 취소 while the merge lock is held. The three Minors can be deferred to the ledger. I found no Critical issue: authorization, CSRF and Origin, escaping, transaction use, migration and link API compatibility all hold.

### Reviewer: office

# Kit review 1, reviewer 3 of 3: where the member's team Office meets the Hub web, and failure paths

Range 8055471..579ac84 (bundle 2, 팀원 웹). Read-only. The Office code that did not change was read where it lives in the checkout. Experiments ran in a `git archive HEAD` copy:
`/private/tmp/claude-502/-Users-jongkkim-Documents-pazmo-agent-office--claude-worktrees-silly-liskov-b64760/3e953d43-7b8b-44f5-ac98-b68874478ce4/scratchpad/r3/tests/seam-r3.test.mjs`. It uses the real Hub, the real Story links, the real scheduler and the real executor's `failed`-phase step. Result: 5/5 pass. Each test asserts the behavior described below, so a pass confirms the behavior exists. The checkout's `git status` is the same before and after.

### Strengths

- **The usual path works as the plan says.** A pick becomes a Hub claim. `recover()` (inbox `mine` → `task` read) records it at the next tick under the Hub's claim id. A web rerun gets NOT_YOURS on the failed record's `watch()` at the next beat. The record is dropped with `onDropped`, and the next tick recovers the new claim at attempt 0. I read every step in `scheduler.ts:134-157, 198-209, 336-365` and saw the same result live.
- **The memo and the last failure reach the contract on both rerun paths.** The recovered record has `lastFailure: null`, so `executor.ts:325-332` passes `failure = null` on attempt 1. `story-contract.ts:217` then falls back to `task.lastFailure` (`{reason, memo}` from `#claimedTask`, `story-store.ts:707`). Attempts 2+ take `memo` from `task.lastFailure` (`executor.ts:329`). The local `replaceClaim` path writes the same contract. Each link in this chain is tested: Task 6 asserts the Task read, and `tests/team-story-contract.test.mjs:165` asserts that plan.md uses `task.lastFailure`.
- **Nothing runs twice.** `#issueLink` revokes any earlier link per (member, repo), and `pollMac` revokes the earlier Mac. So only one Office can see a picked claim in its inbox. The Hub's one-open-Task-per-member rule keeps a pick and a `claimNext` from both winning.
- **A local rerun and a web rerun do not break each other.** `executor.rerun` answers STATE with `rerunTaken`, which adopts the web's claim (seen live as S3). The drive's rerun and the beat's drop both guard with `current()`/`still()`, so a drop between the request and the reply ends cleanly and the next tick recovers. When the local rerun goes first, the web rerun gets STATE (S4).
- **Reporting, `unlockOwed` and `keepOnNotYours` are not affected.**
  - The Hub stays `claimed` until it accepts the failed report, so the web rerun cannot fire while the record is `reporting`.
  - A failed record always has `unlockOwed: false` (`executor.ts:599`).
  - A web rerun needs the Hub to show `failed` under the record's claim, so it can never reach a `verified`/`merging` record.
- **`until` is sent only when it is true.**
  - It is sent only while `waitingOf` holds (phase `claimed` with `runnerWait`); a re-run after the wait reports `working`.
  - Office and Hub validate it the same way (safe integer ≥ 0), so a beat is never refused over it.
  - An old Hub or an old Office ignores the field or treats it as null.
  - An off Mac shows no wait text, because `macWait` uses `#macView`'s off state.
- **Task 6's mutation evidence is sound for what it drives.** M1 and M1b, which move recovery or the pause, are exactly the changes that would break picks.

### Issues

#### Critical

None found. No scenario loses a Task, runs one twice or merges wrongly. Every stuck case below can be undone by a PL release or cancel.

#### Important

**I1. "Linked" on the Hub is not "my running Office will take it": a pick or a web rerun in a repo whose lane is not ready strands the member until the PL acts.**
`src/hub/store.ts:1047-1060` (`liveLinkRepos`), `src/hub/story-store.ts:1158-1164` (`#pickBlock`), `src/hub/story-store.ts:805-814` and `:1203` (`rerunTask` and `taskActions.rerun` check no link at all), against `src/team/scheduler.ts:136` (`recover()` skips `!isReady` lanes).
- **What counts as linked.** `liveLinkRepos` counts any link that is not revoked and whose minting Mac is not revoked. The running Office recovers a claim only on a lane that is `ready`: it has a link file and its gh check passed.
- **When the two differ for a real person:**
  - The Office started while `gh auth status` for that host failed (an expired token, a keychain that was locked at login). The lane stays `gh` until the 5-minute recheck sees gh pass. The Mac still shows 대기 중.
  - The member's live link to the repo is a connection-string link held by another Office (bundle 1's `LINKED_ELSEWHERE`). This Mac's lane then has no link.
  - A registered repo's `hub-link.json` is missing or unreadable (`no-link`).
- **Scenario S1 (live).** Lane fe is `gh` and auto work is off. The 내 할 일 page offers 작업하기 for fe-1 (`pick: "yes"`), and the member presses it.
  - Every tick answers `{claimed:null, open:fe-1}`. The Office's `blockedBy` is fe-1, and automatic claims for **every** repo now return null.
  - After 10 minutes fe-1 shows `멈춤(Mac 소식 없음)` with "Mac이 켜지면 이어서 합니다", but the Mac is on.
  - The assignee's `taskActions` are all false. Only the PL's 풀기 frees the member. Fixing gh also frees it, but nothing on the web says so.
- **Scenario S5 (live).** The same happens with 다시 시도 on a failed Task in a `gh` lane. The beat drops the failed record (a Hub call needs no gh), then recovery skips the lane and the new claim goes held. Before this bundle, the local `team rerun` sent the same request through `executor.rerun`, which does not look at lane state.
- **Effect on a person.** They press 작업하기 or 다시 시도, and nothing happens for 10 minutes. Then the page tells them something untrue, the rest of their work stops too, and they must ask the PL. The plan's 판정 says NOT_LINKED exists precisely because "연결 없는 repo를 고르면 아무도 그 claim을 돌리지 않는다". The verification record's limit (`docs/verification/2026-11-05-teammate-web.md:81`) names only "Mac이 꺼져 있으면".
- **Fix, preferred.** Make the pick/rerun "linked" set the links that were *used recently*: `hub_links.last_seen` within about `MAC_OFFLINE_MS`. With no open record, a running team Office calls `inbox()` on every ready lane every 30 s tick, even when paused, with auto work off or while holding a restart (`scheduler.ts:199-201`, `store.link()` stamps `last_seen` at `store.ts:742`). A `gh` lane, a link on another machine and an off Mac never stamp it.
  - Apply the same set to `rerunTask` and `taskActions.rerun`.
  - Give NOT_LINKED words that cover "내 Mac이 지금 이 레포를 가져갈 수 없습니다(꺼짐·gh 로그인·연결)".
- **Fix, minimum.** Record this limit in the verification record and LOCAL-PREVIEW. When the assignee's Mac is *not* off, use a different held sentence (see M3).

**I2. A pick and a web rerun skip every execution gate of the Office. That exception is not recorded, and the docs and M16 say the opposite.**
`src/team/scheduler.ts:198-209`: `recover()` runs before `canExecute()` (live, runners ready, no restart held), before `paused` and before the daily cap. A picked claim is recorded as `recovered`, which `claimedToday()` does not count (`store.ts:405-411`). Task 6 pins "even with the local pause on". The person-visible results:
- **(a) Paused or at the cap.** The Task runs.
  - `docs/LOCAL-PREVIEW.md:259` tells teammates that "Mac의 `team pause`와 하루 상한은 그 위에 그대로 적용된다". So does the plan's 판정 row (line 43).
  - Story M16 (`pazmo-agent-office-contract.md:27`) says the Office takes a Task only when it is live, its runners are ready, and it is not paused or at the cap.
  - No 판정 row states the exception. The row for 작업하기 says only "스위치는 보지 않는다".
- **(b) Locked Office (`start --team` without `--live`).** The picked or rerun claim is recovered and its heartbeat goes out every minute (`office.ts:694-697`), but nothing drives it (`office.ts:680-683, 699`).
  - Scenario S2 (live): after 30 minutes of beats the Task is still `claimed`/`build`, shown as 진행 중(구현). It never turns held, so the PL's 풀기 is refused (STATE) and only 취소 remains.
  - LOCAL-PREVIEW:426 says a locked Office "요청을 그대로 둔다". That holds for the local rerun but not the web one.
- **(c) Live, one engine's runners not ready, a pick in another engine's repo.** The Task runs.
  - `presenceOf()` checks `!runnersReady` before `working` (`office.ts:504-506`), and runners are not re-checked while a record is open (`office.ts:574-588`).
  - So for the whole Task, the header says 쉬는 중(한도) and the Task page says "Mac의 AI 실행기(codex)가 준비되지 않아 쉬는 중입니다." while the stage moves on.
- **(d) A pick inside the restart window (`watch.holding()`).** The pick is taken and can make `mac restart`'s stop fail with TASK_ACTIVE. The repo-set change then waits up to `RESTART_RETRY_MS` under the "다시 켜도 그대로여서" line. The window is narrow: from the spawn to the stop.
- **Fix.**
  - Record a 판정 (ASSUMED is enough) that a person's own pick or rerun ignores `team pause`, the daily cap and the runner check, and is not counted in `claimedToday`.
  - Correct LOCAL-PREVIEW:259 and the plan row to say so.
  - Have `#pickBlock` (and the rerun) refuse, or show its own state, when the member's newest Mac reports `locked`: one Hub-side check, no Office change.
  - Optionally note (c) as a known wording limit.

#### Minor

- **M1. A local `team rerun --memo` that races a web rerun loses the local memo without a word** (`src/team/executor.ts:606-627`). S3 (live): `requestRerun("local memo…")`, then the web rerun, then `drive()`. The Office adopts the web claim (memo "web memo") and logs "running again under a new claim with the member's memo". `team rerun` had already answered `{"requested":true}`. The plan's "늦은 쪽이 STATE다" holds for the web but not for the CLI person. Fix: one line in LOCAL-PREVIEW ("웹에서 이미 다시 시도했으면 로컬 메모는 쓰이지 않는다"). Or, when this path is next touched, make the `rerunTaken` log say the Hub had already rerun it.
- **M2. The default `plainFailure` blames the AI for git and gh step failures** (`src/hub/story-pages.ts:35-47`).
  - `stepFailed` reports "`<step> failed 3 times in a row: …`" (`executor.ts:665`). Examples: a refused push, a gh error, a checkout that could not be made, a merge-lock call that keeps failing. The page shows "AI가 세 번 시도했지만 끝내지 못했습니다".
  - Such a reason containing a `CONFLICT` code (for example, an attempt folder that already exists) matches `/conflict/i` and reads as a Story base conflict.
  - Fix: add a row before the conflict row for `/ failed \d+ times in a row: /`, for example "Mac에서 git·gh 단계가 세 번 잇달아 실패했습니다. 아래 이유를 확인한 뒤 다시 시도하세요."
- **M3. The held sentence promises "Mac이 켜지면 이어서 합니다" when the Mac is on and the Office has already let the claim go** (`src/hub/story-pages.ts:86, 199-203`). The Office has let it go in these cases:
  - `leaveRefused` after HUB_REFUSED_REPORT (`scheduler.ts:161-175`).
  - REPO_REMOVED (LOCAL-PREVIEW:451).
  - I1's not-ready lane.

  In each case the Mac shows 대기 중 and the Task will not continue. Fix: when `assigneeMac.state` is not `off`, say "Mac은 켜져 있지만 이 Task 소식이 없습니다. PL이 풀 수 있습니다."
- **M4. The `auto-on` line "자동으로 일하기가 켜져 있어 내 Mac이 차례대로 가져갑니다" is shown when the Mac will not take the Task** (`story-pages.ts:173`): while paused, at the cap, with the lane not ready, or with the Mac off or locked. The person also gets no button. Fix: soften it to "켜져 있으면 내 Mac이 차례대로 가져갑니다(Mac이 멈춤·상한이 아닐 때)", or show it only while the Mac badge is 대기 중 or 일하는 중.
- **M5. Right after a pick or a web rerun, "마지막 소식" is the Hub's own claim time, not news from the Mac.** `#claim` sets `heartbeat_at=now` (`story-store.ts:660-665`). A pick on an off Mac therefore reads "시작 중 · 마지막 소식 방금" and stays fresh-looking for 10 minutes. Fix: say "고른 시각" while `stage` is null, or leave the time out until the first beat.
- **M6. Task 6 leaves the gaps above unpinned** (`tests/hub-web-office.test.mjs:41-54`).
  - Every lane is `ready` and `canExecute` is always true.
  - The executor is replaced by helpers.
  - Nothing goes through `office.ts`'s locked and presence paths.

  The ruling is proven for the usual case, but I1, I2(b) and M1 are not. Fix: add one test that pins whichever I1 ruling is chosen (a pick on a `gh` lane is refused, or it goes held as documented). Add one more that pins I2(b) if the `locked` guard is added.

### Declined to judge

- Permissions, CSRF and escaping on the new POSTs and pages: reviewer 2's area.
- Whether picks *should* count toward the daily cap or respect `team pause`: that is a product decision. I flagged only that it is unrecorded and contradicted by the docs (I2).
- Mac/Hub clock skew in "약 N분 뒤": `until` is in the Mac's clock and `inTime` uses the Hub's `Date.now()`. That is a small, acceptable assumption; I did not measure it on real machines.
- Real-Mac timing ("1–2분 안에"): the timer arithmetic (≤30 s tick, ≤60 s beat + ≤30 s tick) checks out, but only the planned real check can confirm it.
- Story verification (`claimVerify`) with auto work off: bundle 4.

### Verdict

**Ready to merge: With fixes.** No Critical. I1 needs at least the honest held sentence (M3) and a recorded limit. The recent-`last_seen` gate would close it. I2 needs a recorded 판정, corrected LOCAL-PREVIEW and plan wording, and ideally the Hub-side `locked` guard on pick and rerun. The Minors can be deferred.
