# U38 (PL planning) review, attempt 2

Snapshot `d13c5b9c…` = tree `c9676dd` (fix range `2b18dd6..c9676dd`, 5 commits). Allocation: 2 independent read-only reviewers (opus): fix-wave breadth (H1–H11, regressions, docs) and protocol/concurrency depth (lease holder, STATE, base commits on the Hub, repo snapshot, H1/H7/H8/H9). Reason: a 5-commit fix wave over a reviewed branch; within the budget of 3. Focused tests run by reviewers: hub-plan-store 27/27, hub-plan-link 11/11, hub-plan-pages 21/21, team-plan-link 3/3, team-plan-gates 4/4, team-planning 14/14, team-planner 28/28, hub-plan-office 3/3, team-office 41/41, team-executor 41/41, hub-link 26/26, hub-link-api 17/17, hub-story-link-api 3/3, team-story-link 19/19, team-scheduler 62/62; typecheck exit 0 on c9676dd.

## Disposition (controller)

**Ready to merge** (protocol reviewer: Ready; breadth reviewer: With fixes — docs only). Critical 0, Important 0. H1–H4 and H6–H11 resolved with pinning tests; H5's destructive half (another Office's `failed` cancelling a just-published Story; one shared lease) is closed. Recorded as passed.

- Stale doc lines the breadth reviewer listed (LOCAL-PREVIEW: the old "cancel leaves the plan cancelled and the Story open" line, the held-Task line, the "repo removed after G3 → 설계 승인 기록이 맞지 않습니다" line, the G3 section without "올라갈 Task 전부 보기", the restart wait; verification record: real-check items 10/11 and the high-risk step, the H5 row's scope, the typecheck row): corrected in the G4 delivery commit as a disclosed doc edit outside the kit review (precedent: U33, U35, U36). No code change.
- Deferred and disclosed (follow-ups before the mid-check):
  - A restarted Office waits up to 600000 ms before resuming a plan step it was holding (holder id is per process); the page shows "AI가 …하고 있습니다" meanwhile. Fix later: persist the holder per data root, or show the last heartbeat age.
  - Hub base commits are pushed without a fetch; an older second Mac whose clone lacks that commit fails the push ("src refspec … does not match any") on every retry until the repo is fetched. Fix later: fetch (or `cat-file -e`) before pushing a recorded commit.
  - H5 remainder: with two Offices of one PL and no live lease, an Office without the plan's repos can still lease the plan and fail it (a race per step). Fix later: `plan-next` carries the Office's ready repo ids.
  - The unlinked-repo line can name connected repos of a queued plan while another plan's step runs longer than 180 s (heartbeat stamps only the first lane's link). Fix later: hide it while the PL has a live plan lease.
  - Copy: the cancel note does not mention the H2 outcome; the not-owner line speaks of all project repos (the check is the snapshot); `REPOS_CHANGED` copy names a project change no route can make; Hub accepts only 40-hex base commits (SHA-256 repos).

## Reviewer reports (verbatim)

### Reviewer: breadth

## 수정 묶음 리뷰 `2b18dd6..c9676dd` (U38 리뷰 2회차, 범위 넓게 보기)

리뷰 방식: 코드는 읽기만 했습니다. 수정 계약과 구현자 보고서 둘, 소스 diff 전부, 시험 diff, 문서 세 개를 읽었습니다.

직접 돌린 집중 시험은 모두 통과했습니다.
- hub-plan-store 27/27, hub-plan-link 11/11, hub-plan-pages 21/21
- team-plan-link 3/3, team-plan-gates 4/4, team-planning 14/14, team-planner 28/28
- hub-plan-office(e2e) 3/3, team-office 41/41, team-executor 41/41
- `hubCall` 변경의 이웃 시험: hub-link 26/26, hub-link-api 17/17, hub-story-link-api 3/3, team-story-link 19/19, team-scheduler 62/62
- `npm run typecheck`는 c9676dd에서 exit 0입니다.
- 추적 중인 파일은 바꾸지 않았습니다. 전체 `npm test`는 돌리지 않았습니다(금지 사항).

### Per-fix verdict

- **H1 해결.** `src/team/planner.ts:533-536`: 읽어 온 Story가 open/verifying/awaiting_g4/done이면 fetch·push·open 없이 `{kind:"open"}`만 보냅니다.
  - 고정 시험: `tests/team-planner.test.mjs:780`. 머지된 Task로 base가 움직이고 bases.json도 없는 상태에서 새 planner를 띄워, push·fetch가 0이고 open이 올라가는 것을 봅니다.
- **H2 해결.** `src/hub/plan-store.ts:436-439`: 열린 Story가 있으면 기획을 `open`으로 옮기고 `story_id`를 적고 빌림을 지웁니다. `server.ts:402`가 `?opened=1`로 보내고, 화면이 안내 한 번과 Story 링크를 보입니다.
  - 시험: `hub-plan-store:750`(PL·관리자·failed 기획), `hub-plan-pages:783`.
- **H3 해결.** 레포 스냅숏은 `plan-store.ts:336`(createPlan)에서 찍고, `PlanRecord.repos`와 `PlanView.repos`가 그 스냅숏입니다.
  - 확인은 `#reposProblem:283` 하나입니다. 승인은 `#approveBlock`에서 이를 쓰고, `next()`는 `#leasable:549`에서 design·splitting을 `failed`로 옮깁니다.
  - Office는 `repoFolders(plan.repos)`만 쓰고, Hub의 `#storeBases`는 스냅숏 밖 레포 id를 거절합니다. 그래서 나중에 더한 레포는 Task도 base도 받지 못합니다.
  - 시험: `hub-plan-store:668/682/714`.
  - 남은 창: 이미 돌고 있는 한 단계 안에서는 담당자를 다시 보지 않습니다. 한 단계 길이의 창이라 Minor입니다.
- **H4 해결.** `src/runners/team-planning.ts:295`에 지문 줄이 들어가고, `checkApprovals`가 다시 그려 정확히 같은지 비교합니다.
  - Hub의 `splitDetails`(`plan-pages.ts:122-143`)는 모든 값을 `esc()`하고, 다른 모양의 나누기는 JSON 그대로 보입니다. 승인 버튼 앞에 놓이고 G3 뒤에도 남습니다.
  - 시험: `team-planning:618`, `team-plan-gates:179`(같은 제목 뒤에서 spec·files·argv·storyVerify를 바꾸면 거절), `hub-plan-pages:746`, `:666`(나누기 안의 악성 글이 이스케이프됨).
- **H5 일부만 해결.**
  - 고쳐진 쪽(파괴적인 시나리오 2): holder 확인(`plan-store.ts:572,616,654`, `office.ts:372`)과 `cancelled`일 때만 draft 취소(`planner.ts:491`)로, 다른 Office의 `failed`가 방금 올린 Story를 취소시키는 길은 막혔습니다.
  - 남은 쪽(원래 시나리오 1): 살아 있는 빌림이 없을 때 프로젝트 레포가 없는 Office가 먼저 물으면 여전히 빌리고 `failed`를 올립니다(`planner.ts:740-744`). 문구는 "레포 B을(를) PL의 Mac에서 쓸 수 없습니다…"입니다. "다시 시도해도 매번"이 아니라 단계마다 운에 따라 생기는 것으로 바뀌었을 뿐입니다. 아래 Minor b.
  - 시험: `hub-plan-store:585,615`, `hub-plan-link:104,128`, `team-plan-link:24,59`, `team-planner:929`, `team-office:1746`.
- **H6 해결.**
  - Office는 Hub의 base 커밋을 먼저 씁니다(`planner.ts:505-507`). 첫 push 전에 base 커밋을 실은 하트비트를 보냅니다(`:547`).
  - Hub는 레포마다 한 번만 적고, 다른 커밋은 409 `BASES_CHANGED`입니다(`plan-store.ts:622`). 전체가 롤백됩니다.
  - BASE_EXISTS 문구가 실제로 할 수 있는 두 길을 말합니다(`planner.ts:555`).
  - 시험: `team-planner:810,853`, `hub-plan-store:632`, `hub-plan-link:147`, `hub-plan-office:459`(bases.json 삭제, main·develop 이동 뒤 Hub의 커밋으로 열림).
- **H7 해결.** `executor.busy()`를 더했고 `office.ts:739`의 시작 조건에 넣었습니다. 시험: `team-executor:1515`, `team-office:1774`.
- **H8 해결.** `planner.ts:803`(`next()` 뒤), `:713`(단계 맨 앞). 시험: `team-planner:876`.
- **H9 해결.** 올린 직후 base 커밋 하트비트(`planner.ts:547`)가 첫 push 전의 취소 확인입니다. 시험: `team-planner:929`(push 0, draft 취소됨).
- **H10 해결.** 빌림이 살아 있는 동안 Mac이 꺼지면 그 줄이 보이고(`plan-pages.ts:190`), 실패한 Task는 "Story #S Task #T … 다시 시도하거나 풀어야"로 말합니다(`:99-104`). 시험: `hub-plan-pages:380,809`.
- **H11 해결. 다만 잘못 나오는 경우가 하나 있습니다(Minor c).** `plan-pages.ts:192-195`, `server.ts:223`. 시험: `hub-plan-pages:826`.

나머지 회귀 점검:
- 모든 호출 쪽이 `holder`를 보냅니다. `planLink`만 세 경로를 부르고 늘 보내며, Office·e2e·시험도 모두 넘깁니다.
- `hubCall`의 `state` 추가는 덧붙이기뿐이고 이웃 시험이 통과합니다.
- `canStart`의 실행기 확인은 planner 조건에만 들어가므로 Task 가져가기는 그대로입니다.
- 새 줄에 비밀값이 없습니다. 호스트 이름은 모두 `*.example.com`이고 다른 Claude 조직 이름도 없습니다.

### New issues

- **Critical:** 없음.
- **Important:** 없음.

**Minor**

- **a. Office를 단계 도중 다시 켜면 최대 10분 멈춥니다(새 회귀).**
  - 원인: holder가 프로세스 시작마다 새로 생기고(`office.ts:372`), `next()`는 holder가 다르면 null을 줍니다(`plan-store.ts:572`). 예전 빌림이 하트비트 뒤 600 s가 지나 끝날 때까지 다시 켠 Office는 아무것도 받지 못합니다.
  - 그동안 화면은 Mac이 켜져 있으니 "AI가 …하고 있습니다"라고 합니다. 이 묶음 전에는 바로 이어 갔습니다.
  - 해당 상황: Mac 재부팅, 비정상 종료, 단계 도중 `stop`/`up`, 결과 다시 보내기를 기다리는 중의 자기 재시작.
  - 시험: 실제 Hub로 단계 도중 재시작하는 시험이 없습니다(가짜 링크는 holder를 보지 않습니다).
  - 고치는 법: holder를 팀 데이터 루트에 저장해 같은 Office는 같은 id를 쓰게 합니다(다른 기계는 여전히 다릅니다). 아니면 이 기다림을 문서에 적습니다.
- **b. H5에서 남은 부분.**
  - Mac(레포 A) + 연결 문자열 Office(레포 B)인 PL이 레포 B만 쓰는 기획을 하면, 단계마다 먼저 물은 쪽이 맡습니다. A가 맡으면 PL에게 맞지 않는 "…PL의 Mac에서 쓸 수 없습니다"로 멈춥니다. 다시 시도는 운입니다.
  - 고치는 법: `plan-next`에 그 Office의 준비된 레포 id를 실어 보내고, Hub는 스냅숏이 그 안에 드는 기획만 빌려 줍니다. 최소한 문서에 적습니다.
- **c. H11 줄이 잘못 나올 때.**
  - 원인: 기획 단계는 claim tick 안에서 돌고, `every()`는 겹쳐 돌지 않습니다(`office.ts:686`). 그래서 단계 도중에는 inbox를 읽지 않고, `lanes()[0]`의 링크만 기획 하트비트로 `last_seen`이 찍힙니다.
  - 그래서 기획 P1의 단계가 180 s를 넘기면, 줄 서 있는 기획 P2의 화면이 연결돼 있는 다른 레포들을 "PL의 Office에 연결되지 않은 레포: … 연결해야 기획이 시작됩니다"라고 이름 댑니다.
  - 긴 단계 직후 30 s 안에 PL이 답해도 잠깐 같은 일이 생깁니다.
  - 고치는 법: PL에게 살아 있는 기획 빌림이 하나라도 있으면 이 줄을 숨깁니다.
- **d. 문구.**
  - 화면의 `CANCEL` 문구는 H2(열린 Story면 기획이 열림으로 끝남)를 말하지 않습니다.
  - `NOT_OWNER` 문구 "프로젝트의 모든 레포 담당자여야"는 이제 확인 범위인 스냅숏 레포보다 넓게 말합니다(구현자 판단 4).

### Docs accuracy

현재 코드와 다른 줄(머지 전 문서만 고치는 것을 권합니다):
- `docs/LOCAL-PREVIEW.md:402`: "기획은 취소됨인데 Story는 열려 있다"는 H2와 반대입니다. 이제 기획은 `open`으로 끝나고 안내와 링크가 보입니다. 검증 기록 쪽은 고쳐져 있습니다.
- `docs/LOCAL-PREVIEW.md:380`: 맡고 있는 Task 줄이 옛 문구입니다. 실패한 Task는 이제 "다시 시도하거나 풀어야"이고 이름은 "Story #S Task #T"입니다.
- `docs/LOCAL-PREVIEW.md:406`과 `docs/verification/2026-11-05-pl-planning.md:114`: "G3 뒤 프로젝트에서 레포를 뺐을 때 '설계 승인 기록이 맞지 않습니다.'"는 낡았습니다. 이제 Hub의 `next()`가 레포 이름을 대며 `failed`로 옮깁니다.
- `docs/LOCAL-PREVIEW.md:352-353`(G3 절): "올라갈 Task 전부 보기"와, 승인이 설명·파일·확인 명령까지 덮는다는 점이 없습니다.
- `docs/LOCAL-PREVIEW.md:381`과 검증 기록 실제 확인 10번(`:181`, "기획 단계 도중 Office를 껐다 켜도 이어 가고"): 최대 10분 기다림을 말하지 않습니다(Minor a). 확인하는 사람이 실패로 볼 수 있습니다.
- 검증 기록 `:180`: 확인 항목이 옛 Task 줄 문구를 기대합니다. `:170-171`(높은 위험 단계)에는 상세 블록을 열어 보는 일을 더해야 합니다.
- 검증 기록 `:135`(H5 행): "다른 Office는 같은 기획을 가져가거나 결과를 보내지 못한다"는 빌림이 살아 있을 때만 맞습니다(Minor b).
- 검증 기록 검사 표의 typecheck 행은 아직 `60a6931` 기준입니다. 제가 c9676dd에서 돌린 결과는 exit 0입니다.

코드와 맞는 것: LOCAL-PREVIEW 388·395·396·397, 검증 기록 한계 100·102·103·105·106~110, 계획의 "마지막 리뷰 뒤 바뀐 것" 다섯 항목 모두.

### Declined to judge

- 프로토콜·동시성 깊이(두 번째 리뷰어 몫).
- 실제 claude·Mac·GitHub·OpenShift에서의 시간.
- 1754/1754 전체 실행(다시 돌리는 것은 금지).
- 미뤄 두고 공개한 항목(bidi, 다시 시도 때 올라간 Story 비교 없음 등).
- 저장된 나누기와 설계 지문을 G3 때 Hub가 대조하지 않는 점: Office가 올리기 전에 막으므로 닫힌 쪽으로 실패합니다.

### Assessment

**Ready to merge? With fixes(문서만).** H1–H4, H6–H11은 고쳐졌고, H5는 파괴적인 쪽이 닫혔습니다. Critical·Important는 없습니다. 위의 낡은 문서 줄 약 8개를 고치고 재시작 기다림을 적은 뒤 머지하면 됩니다. Minor a–c는 공개하고 미뤄도 됩니다.

### Reviewer: protocol

## Seam review: Hub ↔ Office protocol and concurrency, fix range 2b18dd6..c9676dd (review attempt 2)

I only read code. I ran focused tests at HEAD c9676dd and every file passed: hub-plan-link 11/11, hub-plan-store 27/27, team-plan-link 3/3, team-planner 28/28, hub-plan-office (real Hub + Office end-to-end) 3/3, team-office 41/41, team-executor 41/41. I also ran one scratch git check in /tmp, outside the repo. It confirmed that `git push origin <sha>:refs/heads/…` fails with "src refspec … does not match any" when the local object store does not have that commit.

### Findings

**Critical:** none.
**Important:** none.

**Minor**

**M1. A restarted Office waits up to 600000 ms, and the page says the AI is working the whole time.**
- Where: `src/team/office.ts:372` makes a new holder id on every start. `plan-store.ts:572` answers `null` to any other holder while the old lease is live, and that request does not count as a heartbeat (correct).
- When: the PL's single Office is stopped or crashes in the middle of a step, for example `mac restart`, a Mac reboot during a long Lead turn, or a stop that lands during `next()`. The H8 path leaves the lease to run out by design (`planner.ts:803`).
- Effect:
  - Before H5, the restarted Office continued at once. Now it waits up to 10 minutes.
  - During that wait the page shows "기획 중 / AI가 기획하고 있습니다." The Mac is on, so no Mac line appears (`plan-pages.ts:45,190`). `heartbeatAt` is in the view but never shown.
  - `LOCAL-PREVIEW.md:396` only covers the two-Office case, not the much more common "my own Office restarted" case.
  - The wait is bounded and fixes itself, so this is a wording and documentation gap.
- Fix, any one of:
  - Add one known-limit line to LOCAL-PREVIEW and the verification record: "Office를 다시 켜면 하던 기획 단계는 10분까지 기다렸다 이어 갑니다".
  - Persist the holder per data root (for example `<root>/team/plan-holder`), so restarting the same Office resumes at once while a different Office still gets a different id.
  - Show "마지막 소식 N분 전" on the page once `heartbeatAt` is older than about 2 beats.

**M2. Hub base commits are pushed without making sure the commit exists locally.**
- Where: `planner.ts:505` skips `fetchBaseTip` for a repo that has a Hub base, then `planner.ts:552` → `branch.ts:534` push `<sha>:refs/heads/…`. The `published` retry path runs no `planTree` and no fetch at all.
- When: the Hub's bases were recorded by a different Mac, and the current Mac's repo (the story-checkout is a worktree of the person's repo, so it shares that object store) has not fetched the base branch since. A brand-new Mac with a fresh clone is fine; an older second Mac is not.
- Effect:
  - The push fails as GIT_FAILED.
  - The plan fails with "레포 X에 Story 시작 브랜치 …를 만들지 못했습니다. 레포 권한과 브랜치 규칙을 확인한 뒤 다시 시도하세요" plus the detail "src refspec … does not match any".
  - Every retry fails the same way until someone fetches that repo. The Office has no periodic fetch.
  - Rare, because it needs a partial base failure and a switch to an old Mac.
- Fix: for a repo whose commit comes from the Hub or `bases.json`, still run `fetchBaseTip` and discard the tip. Alternatively, check `cat-file -e <sha>^{commit}` and fetch only when the commit is missing. Add a planner test where the fake git lacks the object.

**M3. Leftover from H5: with two Offices, the first to ask still takes and fails a plan it cannot do.**
- Where: `planner.ts:787` asks the Hub through any lane. `planner.ts:740-743` posts `failed` when one of the plan's repos is missing on this Office.
- When: a PL runs two team Offices with different repos (one live link per member and repo).
- Effect:
  - An Office without the plan's only repo can lease the plan and fail it. Each 다시 시도 is a race between the two Offices.
  - The shared-lease and cancel-the-other-Office's-Story parts of H5 are fixed.
  - `LOCAL-PREVIEW.md:396` does not say that the Office that takes the plan may stop it.
- Fix: one doc clause ("그 Office에 기획의 레포가 없으면 기획이 멈춥니다. PL의 팀 Office는 하나로 두세요"). Optionally, have `plan-next` carry the Office's repo ids so the Hub leases only plans whose snapshot those repos cover.

**M4 (nit). The Hub accepts only 40-hex base commits; the Office accepts 64-hex too.**
- Where: `plan-store.ts:143` (`COMMIT`, 40-hex only) against the Office's `OBJECT_ID` (40 or 64 hex) at `planner.ts:139`.
- Effect: a SHA-256 repo's bases would get 400 INVALID. The Office treats that as "retry" → HubNotNow three times → "Hub가 답하지 않아 …", and every retry repeats it.
- Not reachable on GitHub, and it matches the contract's "40-hex". Align the two regexes if SHA-256 ever matters.

**M5 (nit). Some copy names a project change that no screen or route can make.**
- Where: `plan-store.ts:157-158` and `plan-pages.ts` `REPOS_CHANGED`: "프로젝트를 처음대로 되돌리…".
- No route or page removes a repo from a project or changes its base branch; `hub_project_repos` is INSERT-only. The tests reach these branches only through raw SQL.
- The copy is unreachable today, so there is no user impact. If such a route is added later, reword the copy.

### Checked and fine

**1. Lease holder**
- Validation:
  - The link routes take `holder` through `str()`, so a missing holder is 400 INVALID (`link-api.ts:145-149`).
  - `holderOf` requires `^[a-f0-9]{32}$` on `next`, `heartbeat` and `result` (`plan-store.ts:178`).
- Storage:
  - A new lease stores the holder (`:588`).
  - `LEASE_CLEARED` clears it on every result, cancel and advance, and the expired-lease clear does too (`:578`).
- Another holder of the same PL:
  - `next()` gives `null`, through either repo link, and does not refresh the heartbeat (`:572`).
  - `heartbeat` and `result` answer NOT_YOURS (`:616`, `:654`).
  - When the holding Office dies, the lease expires after 600000 ms and the other holder gets a new lease id; the old lease's heartbeat then gets NOT_YOURS (test at hub-plan-store:585-612).
- A second Office cannot take another plan of the same PL while a lease is held. That is the partial unique index `hub_one_plan_lease` (`:117`), one lease per PL, unchanged from before; earlier the second Office got the same lease, never a different plan. No regression.
- All callers send the holder: Office default links (`office.ts:252,372-376`), `planLink`'s per-process default (`plan-link.ts:51-53`), the end-to-end test (`hub-plan-office.test.mjs:256`), and the link and store tests.

**2. STATE**
- `PlanStateError` is thrown only from `heartbeat` (`:613`). It is serialized with `state` only in the story-route catch (`link-api.ts:190-197`); every other HubError goes out through the generic `{error, message}` (`server.ts:432-434`).
- `hubCall` adds `state` only when the reply carries a string `state` (`hub-link.ts:109`), so nothing else changes for other callers.
- The draft is cancelled only in `goOn` when `cut.planState === "cancelled"` (`planner.ts:491`). The periodic beat only aborts, and `goOn` asks again before any write. `failed` and `open` (the latter now produced by H2's cancel) stop the step and leave the draft alone.

**3. Base commits on the Hub**
- Stored only by the live holder, after the lease, live and holder checks (`:613-617`).
- Each repo id must be in the snapshot and each value 40-hex; a commit is never replaced. A different commit is BASES_CHANGED, and because the transaction rolls back, nothing changes (heartbeat time included).
- Recorded before the first push: `goOn(s, story, true, bases)` at `planner.ts:547` comes before the push loop. If that heartbeat fails, it throws HubNotNow, nothing is pushed, the step runs again on a later tick, and after 3 tries the plan fails with HUB_UNSURE. A cut stops the step.
- The Office prefers the Hub's commits, then `bases.json`, then a fetch, and rewrites `bases.json` to match (`:497-518`).
- With a correct Office, BASES_CHANGED cannot happen: only one holder can write, and the lease record is read fresh every tick.
- Not bumping the revision cannot let a stale result through: results are also tied to the lease id and the holder, and a woken stale Office gets NOT_YOURS or STALE.
- The race between a Mac that slept and woke and the new holder is now harmless: both push the same Hub commit, and the second push is `exists`.
- End-to-end test 3 (bases.json deleted, main and develop moved, retry) passes. It runs on the same Mac's object store; see M2 for a different Mac.

**4. Repo snapshot**
- Taken at `createPlan` (`:336`), returned by `#record` and the view (`:472,535`). `#branches` lists only Story repos, so the bases the Office sends always lie inside the snapshot.
- `approve` re-checks through `#approveBlock`. Leasing a design or splitting plan, whether new or a held lease handed back, re-checks through `#leasable` (`:549-557`) and fails the plan naming the repo, then leases the next plan; the loop ends because each failed plan leaves the selected states.
- No spurious failure:
  - Ownership is direct, the same rule `createPlan` uses; admin status changes nothing.
  - Repos cannot be renamed, and a project's repos cannot be removed or have their base branch changed.
  - The only real trigger is `removeOwner`. Its way out (an admin adds the owner again, then 다시 시도) is stated, and the Mac Office picks up the new link by itself.
- Retry repeats the failure until the problem is fixed, and the message says what to do.

**5. H1, H7, H8, H9**
- H1: every split path goes through `basesAndOpen`, and an opened Story posts `open` with no base touched (`:533-536`).
- H7: `canStart` includes `!ex.busy()` (`office.ts:739`).
  - Nothing can start executor git during a step: claims and recovery run in the same tick, and a drive with no open record returns at once (`executor.ts:676-679`).
  - Planning cannot starve: the drive's work is finite.
- H8: `stopped` is checked after `next()` (`planner.ts:803`, before any pending post) and at the top of `runStep` (`:713`).
- H9: the heartbeat that records bases is also the cancel check right after publish, before any push.

### Declined to judge
- Trust in the Hub's base commits: a compromised Hub or Hub admin can now choose which local commit becomes `feature/story-N/base`. This sits inside the accepted "Hub records are trusted" risk; it is for the security lens.
- Ownership lost in the middle of a step is not re-checked until the next lease: the step can still push bases and open the Story. The contract scopes the re-check to lease boundaries.
- Page copy for H10 and H11 beyond the restart wait: the breadth reviewer has it.

### Verdict for this seam: Ready
No Critical or Important issue. The holder, STATE, bases, snapshot and H1/H7/H8/H9 fixes work as the contract says, and the tests cover them. M1 (a documentation line, or persisting the holder per data root) and M2 (fetch before pushing a Hub base) are cheap fixes worth doing now. Otherwise disclose them with M3–M5 as deferred.

