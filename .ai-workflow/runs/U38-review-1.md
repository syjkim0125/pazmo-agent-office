# U38 (PL planning) review, attempt 1

Snapshot `395fcb38…` = tree `2b18dd6` (range `3e23810..2b18dd6`, 17 commits). Allocation: 3 independent read-only reviewers (kit default 3), opus: generalist whole-branch with ledger triage; seam security (authorization, approval integrity, web input, the new remote write); seam lifecycle (plan lifecycle across Hub ↔ Office, failure paths, concurrency). Reason: 9.5k-line change with an approval chain and a new remote write; eleven task-scoped reviews already ran. Focused tests run by reviewers: hub-plan-pages 16/16, team-planner 24/24, hub-plan-store 19/19, team-office 39/39.

## Disposition (controller)

Not ready: Critical 0; Important 5 (after merging duplicates) plus small items fixed with them. Fix before merge:

| Fix | Source | What |
|---|---|---|
| H1 | general I1 = lifecycle M1 | A re-lease of a plan whose Story already opened (open reached the Hub, the `open` result did not) re-pushes every base; once a Task merged into the base, `BASE_EXISTS` fails the plan forever and the page points the PL at deleting a base with teammates' work. Fix: if the published Story is opened, post `open` without touching bases. |
| H2 | lifecycle M2 (Task 1 deferred) | Cancelling a `splitting` plan whose Story just opened leaves plan `cancelled`, Story open and claimable, no Story link. Fix: the Hub reconciles such a plan to `open` with `story_id` and tells the PL "Story #N이 이미 열려 기획은 끝났습니다". |
| H3 | security I1 | An approval does not bind the project's repo set: a repo added after G1 (creator/admin, no ownership needed) gets Tasks and a pushed base under the PL's credentials; a lost ownership is never re-checked. Fix: snapshot the plan's repos (ids, names, base branches) at createPlan and use the snapshot everywhere; approve and the Hub's leasing of `design`/`splitting` re-check that the PL still owns them and the project still holds them (otherwise `failed` with a plain reason). |
| H4 | security I2 | G3 binds and shows only the plan text and Task titles/order; each Task's spec, files, verify argv and storyVerify are published without the PL seeing them, and titles can fake a dependency. Fix: the design text carries a digest line of the canonical split JSON (so the G3 hash covers the whole split; the Office re-checks it), and the G3 page shows the full stored split (escaped) under a details block. |
| H5 | lifecycle I1 = general M2 | A plan lease is tied to the person, not the Office: two team Offices of one PL (Mac + connection-string Office) share a lease; one can fail the plan the other can do, or make the other cancel its own just-published Story (STATE also means `failed`). Fix: a lease holder id sent by the Office on plan-next/heartbeat/result (other holders get no work / NOT_YOURS); the Office cancels a draft only when the Hub says the plan is `cancelled`. |
| H6 | lifecycle I2 (Task 8 deferred, R1) | `bases.json` lives only on the Office: a new Mac or lost data folder after a partial base push re-fetches a moved tip and hits `BASE_EXISTS` forever; the message tells a non-developer to "check the branch". Fix: the Office records base commits on the Hub plan (never replaced) right after publish and prefers them; the BASE_EXISTS line names the real ways out. |
| H7 | lifecycle M3 | The planner's git (fetch → FETCH_HEAD) can overlap a still-running executor git step on the same checkout after a dropped record, persisting a wrong tip. Fix: the planner starts only when the executor drive is idle. |
| H8 | lifecycle M4 | A stop during `next()` still runs the step (bases pushed and Story opened during shutdown). Fix: check `stopped` after `next()` and at the top of the step. |
| H9 | lifecycle M5 | A cancel between the pre-publish heartbeat and publish still pushes every base before the pre-open check. Fix: one cancel check right after publish. |
| H10 | lifecycle M6 + general M3 | The plan page shows no PL Mac line while a lease is live (Mac asleep mid-step looks like "AI가 …하고 있습니다" for up to 10 min); the held-failed-Task line says it will end by itself and omits the Story number. |
| H11 | lifecycle M7 | With no ready lane on the PL's Office the page gives no reason (Review Focus 2 promised the missing repo is named). Fix: for a plan without a live lease, the Hub names project repos the PL has no recent Office link for. |

Deferred (disclosed in the verification record): paused/capped Offices now run runner discovery for possible plan work (general M1 = lifecycle M10, additive deviation in timing only; claims unchanged); a result that can never be sent cycles every ~10 min (lifecycle M8, pathological); a tick that ran a plan step skips that tick's Task recovery (lifecycle M9); plan folders never cleaned up (lifecycle M11); bidi/zero-width characters allowed in model text (security M1); a retry with `published` does not compare the published Story with the approved body (security M2, own-key only). Every ledger `minor (deferred)` item: CAN WAIT per the generalist's triage (49 items), including the person-facing ones (answers lost on a refused answer, double-click two plans, LFS filters) — disclosed.

## Reviewer reports (verbatim)

### Reviewer: general

## 묶음 3 "PL 기획" 최종 리뷰 (3e23810..2b18dd6)

**결론: 고친 뒤 머지(With fixes).** 머지 전에 고칠 것은 Important 한 건입니다. 이미 열린 Story에 Office가 Story base를 다시 밀다가 기획이 영원히 '멈춤'에 걸리는 경로이고, Office 쪽 몇 줄과 시험 하나면 고쳐집니다. 승인 묶음, 새 원격 쓰기 보호, 비밀값, 웹 보안, 공개 레포 규칙에서는 머지를 막을 결함을 찾지 못했습니다. ledger의 deferred minor 49건은 모두 CAN WAIT로 판정했습니다.

**리뷰 방식:** 740 KB 묶음 파일은 통째로 읽지 않았습니다. 파일별 `git diff 3e23810..2b18dd6 -- <path>`와 현재 소스를 여러 번에 나눠 읽었습니다. 순서는 Hub(plan-store, link-api, server, plan-pages) → Office(planner, plan-gates, plan-tree, branch, office.ts, live/native/lean) → 문서입니다. 확인을 위해 돌려야 할 의문이 없어서 시험은 하나도 돌리지 않았습니다.

### Strengths
- **정본과 상태 기계:** 기획의 정본은 Hub의 `PlanBoard` 하나입니다. 모든 변경은 한 트랜잭션에서 revision을 1 올리고, 낡은 탭이나 두 번 누르기는 오류 화면 대신 `?changed=1`로 돌려보냅니다.
- **승인 묶음(끝에서 끝까지 확인):**
  - 웹 승인은 보여 준 글의 sha256에 묶이고, Office는 구조화된 초안을 다시 그려 같은 바이트인지 확인합니다.
  - G1 뒤에 `queued`로 돌아가는 길이 없어서 승인한 초안이 바뀔 수 없습니다.
  - 높은 위험 기획은 G3 없이 `splitting`에 갈 수 없고, 저장된 나누기를 다시 검사하며 G3는 그려진 설계에 묶입니다.
  - 올라가는 것: 제목은 PL이 적은 제목, 본문은 승인한 초안, 위험도는 만들 때 고른 값, Task는 보통 위험이면 Lead 결과(spec이 허용), 높은 위험이면 G3가 승인한 나누기입니다.
- **새 원격 쓰기 `pushStoryBase`:** 이름 정규식, 전체 커밋 id, 강제 push 없음, followTags·submodule push 끔, 이미 있는 base는 옮기지 않음. 기존 `pushTaskBranch` 보호 규칙은 그대로입니다.
- **base와 열기 순서:** 모든 base를 만든 뒤에만 엽니다. 올리기와 열기 직전에 하트비트로 다시 확인하고(F5), Mac이 잠들었다 깨어난 뒤에도 쓰기 전에 새로 확인합니다.
- **기획 입력:** Office 전용 체크아웃(story-checkout)과 임시 index만 쓰고 사람의 레포 폴더는 건드리지 않습니다. 보호 경로는 빼고, APFS 대소문자·NFC 겹침도 처리하고, 크기 한도를 풀기 전에 검사합니다.
- **웹:** 스크립트 없음, 모든 값 `esc()`. 1 MiB 읽기는 Origin과 세션 검사 뒤, 두 경로에서만 합니다.
- **Office 운전:** 결과 다시 보내기는 3번까지이고, 포기하면 10분 쉬어서 Task 가져가기를 막지 않습니다. 옛 Hub와 사라진 빌림을 구분합니다.
- **문서:** 알려진 한계를 솔직하게 적었습니다.

### Issues

#### Critical (Must Fix)
없음.

#### Important (Should Fix)

**I1. 이미 열린 Story에 base를 다시 밀어 `BASE_EXISTS`로 영구 멈춤** — `src/team/planner.ts:578`(`if (plan.published) return basesAndOpen(...)`), `:504–520`

- **무슨 일인가:** 같은 `splitting` 기획을 나중 빌림이 다시 돌리면 `basesAndOpen`이 Story 상태를 보지 않고 적어 둔 커밋으로 `pushStoryBase`를 부릅니다. 열린 뒤 팀원(또는 PL)의 Task PR이 `feature/story-<N>/base`에 머지됐으면 원격 tip이 그 커밋과 달라서 `BASE_EXISTS` → `failed` "레포 X: …이미 다른 커밋으로 있습니다. 그 브랜치를 확인한 뒤 다시 시도하세요."가 됩니다. 다시 시도할 때마다 같습니다.
- **어떻게 생기나:** `open()`은 Hub에 닿았는데 `open` 결과가 닿지 않은 경우입니다.
  - 그 사이 Mac이 잠들거나 Office가 꺼졌다 켜지고, 빌림이 끝난 뒤 새 빌림이 생김.
  - 또는 결과 보내기가 4번 실패해 `giveUp`(planner.ts:618) → 10분 쉬는 동안 PL 자신의 Office가 방금 열린 Story의 Task를 가져가 머지.
- **PL에게 미치는 영향:**
  - Story는 열려서 진행 중인데 기획은 '내가 쓰는 Story'에 '멈춤'으로 계속 남습니다.
  - `story_id`가 기록되지 않아 기획 화면에 Story 링크도 없습니다.
  - 같은 문장에 대해 LOCAL-PREVIEW.md:395가 "그 브랜치를 사람이 지우거나"라고 안내하므로, PL이 팀원의 머지된 작업이 든 base를 지우도록 이끕니다.
- **시험 빈틈:** Review Focus 2("재시작 뒤 이어 가도 Story는 하나다")와 Task 8의 재시작 시험은 base가 적어 둔 커밋에 그대로 있는 경우만 봅니다.
- **고치는 법:** `splitStep`/`basesAndOpen`에서 `plan.published.state`나 읽어 온 `view.state`가 `OPENED`이면 base를 건드리지 않고 `{kind:"open", storyId}`를 보냅니다. Story는 모든 base 뒤에만 열리고, Hub도 이미 열린 상태의 `open` 결과를 받으므로 Task 1 판정과 맞습니다. "열린 Story + base 이동" planner 시험을 더합니다.
- **같이 하면 좋은 것(선택):** Hub `cancel()`/`next()`가 published Story가 열린 `splitting` 기획을 `open` + `story_id`로 맞추면 Task 1의 "열린 뒤 취소" deferred 항목도 닫힙니다.

#### Minor (Nice to Have)

**M1. 멈춘 팀 Office도 실행기를 확인하고 매 tick 기획 일을 물음** — `src/team/office.ts:621–627`
- **무슨 일인가:** 멈춤(pause)이나 하루 상한에 걸린 live 팀 Office는 PL이 아닌 팀원 것도 `planCouldFollow` 때문에 실행기 확인(CLI 실행)을 합니다. 실행기가 준비 안 됐으면 30초마다, 준비됐으면 5분마다입니다. 매 tick `plan-next` 호출도 생깁니다. 묶음 3 전에는 둘 다 없었습니다.
- **영향:** 묶음 1·2 동작이 조금 바뀝니다(CLI 실행, 로그 소음).
- **고치는 법:** 기획 일이 있다는 신호가 있을 때만 기획을 위한 실행기 확인을 합니다.

**M2. 한 PL의 Office 둘이 같은 빌림을 함께 돌림** — `src/hub/plan-store.ts:467`
- **무슨 일인가:** 살아 있는 빌림은 그 사람의 어느 연결에도 같은 id로 돌아갑니다. 그래서 같은 PL의 live Office 둘이 같은 단계를 함께 돌립니다.
- **영향:** B가 `failed`를 먼저 보내면, A의 열기 직전 하트비트가 `STATE`를 받고 F5의 `cancelDraft`가 방금 올린 Story를 취소합니다. 다시 시도는 "Story가 취소됐습니다"가 됩니다.
- **가능성:** 낮습니다. Mac 연결은 이전 Mac을 해제하므로, 옛 연결 문자열 Office가 같이 떠 있어야 합니다.
- **고치는 법:** `plan-next`에 Office 인스턴스 id를 넣습니다.

**M3. 기획 화면의 PL Mac 줄 문구** — `src/hub/plan-pages.ts:93`
- **무슨 일인가:** PL이 `failed` Task를 쥐고 있어도 "그 Task가 끝나면 이어서 기획합니다"라고 합니다. 그 Task는 다시 시도하거나 풀기 전에는 끝나지 않습니다. 또 "Task #N"에 Story 번호가 없습니다.
- **고치는 법:** `OpenTaskRef`의 `state`와 `storyNumber`로 문구를 바꿉니다.

### Deferred-minor triage
머지 전에 고칠 것(MUST FIX)은 없고, 49건 모두 CAN WAIT입니다.

**컨트롤러가 짚은 사람에게 보이는 항목:**
- **T3 답이 거절되면 적은 답이 사라짐:** CAN WAIT. 실제로는 공백만 적은 칸에서만 생기고(maxlength·required가 나머지를 막음), 문서에 있으며, 브라우저 뒤로 가기가 대개 되살립니다. 나중에 값을 넣은 기획 화면을 다시 그리면 됩니다.
- **T3 [기획 시작] 두 번 누르기 → 기획 둘:** CAN WAIT. 문서에 있고, 기획마다 따로 G1을 거쳐야 무엇이든 올라가며, 취소는 한 번 클릭입니다. 나중에 폼에 일회용 nonce를 넣으면 됩니다.
- **T1 열린 Story가 있는 `splitting` 기획 취소:** CAN WAIT. 문서에 있고 open()→결과 사이의 좁은 창이며 main에는 닿지 않습니다. I1과 함께 Hub에서 맞추기를 권합니다.
- **T8 `bases.json`이 Office에만 있음(R1과 어긋남):** CAN WAIT. 문서에 해결법이 있고, base push가 일부 실패한 상태에서 데이터 폴더를 잃고, 그 사이 기준 브랜치까지 움직여야 생깁니다. 중간점검 전 후속으로, Story가 draft이고 원격 base가 기준 브랜치 tip의 조상이면 그 커밋을 채택하거나 base를 Hub 기획 행에 적기를 권합니다.
- **T8 401을 다시 해 본 뒤 "Hub가 답하지 않아":** CAN WAIT. 결과도 같은 해제된 연결로 보내므로 PL은 그 문장을 보지 못하고, 기획이 기다림에 머뭅니다(문서에 있음).
- **T9 높은 위험 갈래가 `gates.split` 유무로 나뉨:** CAN WAIT. `checkApprovals(needSplit: risk==="high")`는 높은 위험이면 반드시 PLAN_GATE를 던지거나 split을 돌려주는 것을 확인했습니다. 높은 위험 기획이 `leadSplit`에 갈 수 없으므로 굳히기일 뿐입니다.
- **T6/T9 초안 `story` JSON·나누기 JSON의 Hub 바이트 한도 미확인:** CAN WAIT. story는 32256바이트 이하 글로 그려지므로 JSON은 64 KiB에 한참 못 미칩니다. 나누기가 512 KiB를 넘으려면 비정상 출력이어야 하고, 대가는 오해를 부르는 '버전' 문구와 Lead 재실행입니다.
- **T4 checkout-index가 사람의 git filter(LFS)를 따름:** CAN WAIT. 문서에 있고 `freezeCandidate`가 실제 바이트로 100 MiB를 다시 막습니다. 나중에 `GIT_LFS_SKIP_SMUDGE=1`과 `core.autocrlf=false`를 더하면 됩니다.

**나머지(모두 CAN WAIT):**
- **T1:** open 상태 확장 미시험(한 줄 규칙); 한도 리터럴 관계 시험; draft 캐스트·raw SQL; 시험 빈틈(같은 검사가 이미 시험됨).
- **T2:** isObject 복사본; 주석과 닿지 않는 guard.
- **T3:** 문구 상수 중복; 새 프로젝트 폼 값 사라짐(문서에 있음); 답 경로 413 미시험(같은 한도 코드); 확인 없는 취소가 FORBIDDEN보다 INVALID 먼저(PL이 아니면 폼이 없음).
- **T4:**
  - 빠진 링크를 거치는 링크 사슬(문서에 있음).
  - ls-tree 출력 한도가 GIT_FAILED로 나옴(문구만).
  - symlink 빈 대상(planTree는 못 닿음).
  - candidate.json 쓰기 중 충돌(4 KB 미만 한 번 쓰기).
  - 보호 파일이 잠깐 디스크에 있음(0700, 문서에 있음).
  - continuePlanning이 `team`을 버림(부르는 곳 없음).
  - 구조적 프롬프트 시험; 얼리기 오류 이름 붙이기.
- **T5:** 시험 세부; 인자 순서·변경 가능한 export·UTF-16 자르기.
- **T6:** 폴링 중 presence 깜빡임; hub-too-old 쉬는 시간 무시(실행기 확인만 늘어남); describe 복사본; stop 시험 없음; "undefined:"·서로게이트 자르기(겉모습).
- **T7:** `at` RangeError(Hub가 now로 씀); UNSAFE_PATH 문구는 이미 해결(splitStep의 RECORDS); 큰 시험·digest 두 번.
- **T8:** gc된 base 커밋; bases UNSAFE_PATH 문구; push 주석; already:true 미시험; 문구·코드 목록 중복(목록은 이미 고침); planner 크기·hasOwn(id가 uuid).
- **T9:** G3 뒤 레포 제거 시 문구(그런 웹 경로 없음); 동어반복 단언·다음 할 일 없는 문구·죽은 `?? ""`.
- **T10:** sleep(300)·existsSync·특정 시점 확인.
- **T11:** UTF-16 순서 문구(기록은 고정됨).

### Declined to judge
아래는 계획·spec 밖이거나 이미 허용된 것이라 판정하지 않았습니다.
- 보통 위험의 Task 목록이 PL 검토 없이 올라감: spec이 정한 non-goal.
- G3 해시가 spec·files·checks·storyVerify를 묶지 않고, Hub 관리자나 뚫린 Hub가 기록을 바꿀 수 있음: spec이 받아들인 위험이고, 설계 화면도 제목만 보입니다.
- 링크 `publishStory`에 담당자 검사 없음: 계획의 "이 계획 밖".
- 모델이 만든 검사 명령이 팀원 Mac에서 돎, 레포 내용을 통한 프롬프트 주입: 기존 VM 위협 모델.
- 모든 팀원이 의도·답·초안을 봄: 계획의 ASSUMED.
- 화면 저절로 새로 고침·알림·설계 다시 쓰기 없음, 열린 Story 취소 버튼 없음: 계획 밖이거나 묶음 4.
- 옛 Office가 Hub를 따라오지 않아 화면이 "보통 1분 안"에 머무는 것: spec이 버전 맞추기를 만드는 사람에게 맡겼고 문서에 있습니다.
- base 커밋이 Lead가 읽은 사본보다 새것일 수 있음: 문서에 있는 ASSUMED, 묶음 4가 받습니다.
- 기획이 많은 PL의 Task 가져가기가 밀림: R4 ASSUMED 우선순위.
- 기획 수·이벤트 표 크기 제한 없음: 사내 도구이고 spec에 한도 없음.
- 실패 이유의 git 문구: 등록 URL에 자격 정보가 없고 기존 Task 경로와 같습니다.
- git-crypt 같은 filter가 PL 자신의 모델에 풀린 파일을 보임: Task 체크아웃과 같습니다.
- 실제 claude·VM·GitHub ruleset·OpenShift: 확인하지 않은 범위로 중간점검에 미룸.
- `planner.ts`의 구조: 동작이 아니라 코드 정리 문제.
- STATUS: G4 뒤에 씁니다.

### Recommendations
1. I1을 고치고 시험 하나를 더합니다. Hub 쪽 맞추기를 함께 하면 Task 1의 취소 항목도 닫힙니다.
2. 중간점검 전에: `bases.json` 원격 채택(R1), LFS·autocrlf 굳히기, 새 Story 폼 nonce, 답 거절 시 값 되돌리기.
3. G4 증거에 적을 것: G3는 그려진 설계에만 묶이고 spec·files·checks는 Hub 기록을 믿는다는 점.

### Assessment
**Ready to merge?** With fixes

**Reasoning:** 승인한 것만 올라가고, 새 원격 쓰기는 좁게 막혀 있으며, main에는 아무것도 닿지 않습니다. 남은 것은 I1 하나인데, 드물지만 PL을 팀원 작업이 든 base 삭제로 이끌 수 있고 몇 줄이면 고쳐지므로 머지 전에 고칠 가치가 있습니다.

### Reviewer: security

## Security review: authorization, approval integrity, web input and remote writes (range 3e23810..2b18dd6, feat/pl-planning)

I only read code. I ran one focused test file: `tests/hub-plan-pages.test.mjs` passed **16/16**. I wrote no new tests, so findings 1 and 2 come from reading the code and are not reproduced.

### Findings

**Critical:** none.

**Important 1: An approval does not bind the project's repo set, so a repo added after G1 receives Tasks and a pushed base branch.**
- **Where:**
  - `src/hub/plan-store.ts:445-449`: `#record` reads `hub_project_repos` fresh on every lease.
  - `src/hub/plan-store.ts:299-302 / 317-318`: `ownsProject` is checked only at `createPlan` and `approve`.
  - `src/team/plan-gates.ts:64-91`: `checkApprovals` never compares the repo set.
  - `src/team/planner.ts:601`: a normal-risk split runs a fresh Lead turn over the current `plan.repos`.
  - `src/hub/story-store.ts:466-479` and `link-api.ts:111`: `addProjectRepo` lets the project creator or any hub admin add **any** registered repo. Ownership is not required.
- **Scenario:**
  1. Project P has repo A. The PL owns A, and the PL's G1 on a normal-risk plan moves it to `splitting`.
  2. Before the PL's Mac leases the step (this can take hours if the Mac is off), the project creator or an admin calls `POST /api/link/story/project-repos` and adds repo B. The PL does not own B.
  3. If the PL's Office has a lane for B, the Lead splits across A and B. `publishStory` accepts it, because the graph is checked only against the current project repos.
  4. `pushStoryBase` then creates `feature/story-N/base` on B's origin with the PL's credentials, and the Story opens.
  5. A later `retry` behaves the same way. Ownership revoked after G1 is also never re-checked.
- **Effect:**
  - The rule "the PL approves what goes into each repo" (comment at `plan-store.ts:246`) and "admins cannot approve" can be bypassed: an admin can route a PL's approved Story into a repo nobody approved.
  - If the PL has no lane for B, the plan instead fails permanently at `planner.ts:703`. That is a cheap denial of service by the creator or an admin.
  - High-risk plans are mostly protected, because G3 re-runs `ownsProject` and the stored split only targets the original repos.
- **Fix:**
  - Snapshot the repo ids and base branches into the plan at `createPlan`, or into the approval (for example a `reposHash` next to `textHash`).
  - Have `#record` return the snapshot, and have `checkApprovals` refuse a mismatch.
  - Re-check `ownsProject` in `next()` before leasing `splitting`. Alternatively, refuse `addProjectRepo` while the project has a plan in `design`, `awaiting_g3` or `splitting`.
  - No test covers this today.

**Important 2: G3 does not bind or show most of the split it publishes.**
- **Where:**
  - `src/runners/team-planning.ts:265-273`: `renderTeamDesign` renders only `split.plan` plus, per Task, its id, folder, title and dependencies.
  - `plan-gates.ts:89`: equality of that rendering is the only G3 binding.
  - `plan-pages.ts:162`: the page tells the PL "승인하면 이 Task 목록을 그대로 올리고 엽니다."
- **Not shown and not covered by the G3 hash:**
  - each Task's `spec` (Outcome, Scope, Constraints, Covers)
  - each Task's `files`
  - each Task's `verify` checks (`argv` command lines)
  - all of `storyVerify`
- **Effect:** for high risk, these are published (`planner.ts:589-590`) without the PL ever seeing them. The rendering is also ambiguous: a title such as `X(앞: t1)` fakes a dependency, so two different splits can render the same text. As a result, the Office's re-check would not detect a Hub-side change to specs, files or argv.
- **Mitigating factors:**
  - Only the PL's own Office can write `split`, and nothing can change it after G3. The gap is about what the PL actually consents to, plus weaker defense-in-depth; it is not an outside tampering path.
  - Checks run inside `ContainerVerifier`.
  - For normal risk, the whole split is unreviewed. That matches the decision doc (auto-split after G1) and the page says so.
- **Fix:**
  - Add a line with `sha256` of the canonical split JSON to the design text, so the G3 hash covers the whole split.
  - Show the full Task specs, files and argv, and `storyVerify`, escaped in a `<details>` block on the G3 page.
  - Either render titles unambiguously or reject the `(앞:` pattern in titles.

**Minor 1: Bidi and zero-width characters can make the approved text look different from its bytes.**
- `src/runners/planning.ts:126-127` blocks line breaks and C0 control characters but allows U+202A–202E, U+2066–2069 and U+200B–200F.
- The draft and design are shown in `<pre>` (`plan-pages.ts:159,162`). The PL approves exactly the stored bytes (the hash is computed server-side), but model text could visually reorder a MUST or Verify line.
- Fix: reject those code points in `text()`.

**Minor 2: On retry, a Story already published under `plan:<id>` is opened without comparison.**
- At `planner.ts:578`, the Office goes straight to bases and open for any Story under `plan:<id>`. It never compares that Story's body or graph with `approvedStory(draft)` or the stored split.
- Only the PL's own link tokens can publish under that key (`story-store.ts:512-513`, keys are scoped per PL), so this is not an escalation. It is self-inflicted at most.
- Fix: compare `view` against the approved body and the split fingerprint before pushing bases.

### Checked and fine
1. **Who can do what:**
   - Web project creation keeps only owned repos for non-admins (`story-store.ts:449-450`, form list at `server.ts` `projectRepos`).
   - Starting a plan requires owning every repo (`plan-store.ts:247`; GET form `server.ts` new-story).
   - Answer, rewrite, approve and retry go through `#pl`/`#assertPl` (`:223-238`). Approve also requires `ownsProject` at that moment (`:317-318`), and admins are refused there by `#assertPl` (`:311`).
   - Cancel is allowed for the PL or an admin (`:348`).
   - On the link side, `next` only uses `l.member.id` (`:466,476`); heartbeat and result go through `#mine`, which returns NOT_YOURS or PLAN_GONE (`:487-491`).
   - Results are tied to the revision and the live lease (`:516-518`) and to the state they come from (`RESULT_FROM :102-108`). `open` must be the PL's own `plan:<id>` Story in an opened state (`:544-546`).
   - A draft cannot be posted after G1: `queued` never carries `g1`, and G1 is only ever set from `draft`. A split cannot be replaced after G3: `design` comes only from the `design` state, which is unreachable after G3.
2. **Approval integrity:**
   - The hidden revision, gate and hash go through `approve` with revision, gate-state and hash checks against the stored text (`:313-316`). A stale tab or a double click hits STALE and redirects to `?changed=1` (`server.ts:396`).
   - The browser never posts the draft or design text back, so CRLF normalisation cannot cause a mismatch.
   - The Office re-checks approver = PL, the hash, OPEN BLOCKING, and that the structured story re-renders to the exact draft (`plan-gates.ts:68-81`).
   - The published body is `approvedStory(draft.text)`, which replaces only the first Status and G1 lines; the real ones always come first. The title and risk are what the PL entered (`planner.ts:585-587`).
3. **Web input:**
   - Every POST checks Origin (`server.ts:140`), then the session (`:151`), then sets the limit by route before any byte is read (`:158`), then checks CSRF (`:161`).
   - The 1 MiB read applies only to `^/projects/<id>/plans$` and `^/plans/<id>/answer$` (`:44`).
   - All person- and model-supplied strings go through `esc` (quotes included, `pages.ts:5`), including the `</textarea>` case.
   - The new pages load no script. Their only URLs carry UUIDs and `changed=1`.
4. **Remote writes:**
   - `pushStoryBase` accepts only `^feature/story-\d+/base$` and a full hex SHA, as `<sha>:refs/heads/<base>`, with no `+`, `followTags=false`, `recurseSubmodules=no`, hooks off and remote fixed to `origin` (`branch.ts:518-591`). It never moves an existing ref (`BASE_EXISTS`).
   - `pushTaskBranch` keeps the same guards.
   - The SHA pushed is the recorded or fetched tip from `bases.json`, validated as hex (`planner.ts:236-258,487-497`). The checkout is the Office's registered lane (`office.ts` `planLanes`).
   - Nothing the model or Hub supplies reaches a git argument or path: the plan folder requires a UUID (`planner.ts:699`, `plan-gates.ts:104`); repo folders must match `TEAM_FOLDER` (`plan-tree.ts:28-38`); base branches go through `checkBase`; the Story base must equal `storyBaseBranch(number)` (`planner.ts:503`); model `files` only reach Hub records, validated by `validFilePath`.
5. **Prompt and secret hygiene:**
   - The packet carries only the intent, folders and base branches, the dialogue, the story and the rewrite or retry reason (`planning.ts:280+`). No token or approval goes in.
   - The plan folder holds no tokens. Log lines carry ids, status/code and text folded to one line.
   - Model questions, draft, design and failure reasons are escaped wherever they are shown, and are validated by the Office before use.

### Declined to judge
- Two Macs of the same PL can receive the same live lease (`plan-store.ts:467-469`) and run one step twice; for example, different recorded bases lead to BASE_EXISTS while the other Mac opens the Story. That belongs to the lifecycle reviewer.
- Whether git's stderr on a failed push could contain an origin URL with credentials. That text becomes a `failed` reason that every member can see. The "To <url>" line is skipped, and this matches the existing Task-failure path.
- Unverified: whether `node:sqlite` turns a lone surrogate in the raw `design` column into U+FFFD. If it does, a model title containing `\ud800` would make G3 fail permanently. That fails closed and is not a bypass.

### Verdict for this seam: Ready with fixes
Important 1 (bind or snapshot the repo set, or re-check ownership before splitting) should be fixed before merge. Important 2 needs either a fix (digest plus full listing) or an explicit decision to accept it and change the page wording.


### Reviewer: lifecycle

## Seam review: plan lifecycle across Hub ↔ Office (range 3e23810..2b18dd6)

I read plan-store.ts, plan-link.ts, planner.ts, plan-gates.ts, plan-tree.ts, the office.ts, branch.ts, live.ts and lean diffs, plan-pages.ts, executor drive/drop and the scheduler. I also checked the plan's rulings and ledger. Focused tests: team-planner 24/24, hub-plan-store 19/19, team-office 39/39. I confirmed the two-link lease behaviour with a scratch script in /tmp/plrev (outside the repo).

### Findings

**Critical:** none.

**Important**

**I1. A plan lease is tied to the person, not to the Office.** A second team Office of the same PL gets the same live lease, and it can fail the plan or cancel the other Office's Story.
- Evidence:
  - `plan-store.ts:466-470`: `next()` looks only at `l.member.id` and hands back the held lease, same id and revision.
  - `plan-store.ts:497-505`: the heartbeat accepts any link of that member.
  - `planner.ts:701-707`: an Office missing a project repo posts `failed` under that shared lease.
  - `planner.ts:471`: `cancelDraft` runs on any `STATE`, and `STATE` also means "the plan is now `failed`", not only "cancelled".
- Confirmed by script: links (pl,be) and (pl,fe) get the same leaseId and revision. The fe Office's `failed` is accepted (revision 2). The be Office's next heartbeat answers 409 STATE.
- When it happens: one live link per (member, repo) (`store.ts:649,720`), so this needs two Offices with disjoint repos. Example: a paired Mac with repo A plus a connection-string team Office with repo B (R3 says connection-string Offices are supported).
- Scenario 1: a plan in a project that only uses B. Office A leases it within 30 s and posts "레포 B을(를) PL의 Mac에서 쓸 수 없습니다", even though B is connected on the other Office. Every 다시 시도 ends the same way, and any work Office B was doing comes back STALE.
- Scenario 2: Office B is splitting (Story published, pushing bases) when Office A posts `failed`. B's next heartbeat sees STATE and cancels the draft Story it just published. The PL presses retry and gets STORY_CANCELLED: cancel, then redo the draft, G1 and G3.
- Fix:
  - Store a lease holder (an Office instance id sent with plan-next, heartbeat and result). `next()` from another holder while the lease is live returns null; heartbeat or result from another holder is NOT_YOURS.
  - In `goOn`, cancel the draft only when the plan is actually `cancelled`.
  - If deferred, record "one team Office per PL" as a stated limit.

**I2. BASE_EXISTS after a new Mac or a lost data folder is a dead end, and the failure text gives the PL no exit they can use.**
- The ledger deferred this (Task 8, plan-level). The brief asks for a judgement, so here it is.
- Where:
  - `bases.json` lives only on the Office (`planner.ts:478-493`).
  - A retry with `published` and no `bases.json` fetches the base branch tip again. If it moved, `pushStoryBase` throws BASE_EXISTS (`branch.ts:572`, `planner.ts:520`).
  - The same happens when an old Mac wakes up and races a new Mac: whichever pushes first with its own commit wins.
- What the PL sees: "레포에 feature/story-N/base가 이미 다른 커밋으로 있습니다. 그 브랜치를 확인한 뒤 다시 시도하세요." A non-developer cannot "check the branch", and retrying never succeeds.
- The only real exits are a developer deleting that branch, or cancelling and starting a new Story (losing G1/G3). Neither is stated.
- Fix:
  - At minimum, reword the plan-path BASE_EXISTS line to name both exits.
  - Properly, keep the base commits on the Hub (an Office-written field on the plan), in line with R1 "continue from Hub records".
  - Do not blindly adopt an existing remote base: a Hub reset reuses Story numbers.

**Minor**

**M1. Story already open, but the `open` result never landed.**
- When: the Office crashed or stopped between the open call and posting the result, or the result was given up.
- What happens: the re-lease still re-pushes every base (`planner.ts:501-528`). With `bases.json` missing and main moved, that is BASE_EXISTS, so the plan goes `failed` while its Story is open and teammates are claiming its Tasks. Retry loops the same way.
- Fix: `if (OPENED.includes(view.state)) return { kind: "open", storyId }` before the bases. The Hub only opens after the Office made all bases.

**M2. A plan cancelled while its Story has just opened ends with the Story open and invisible from the plan.**
- The ledger deferred this "to final review triage".
- `plan-store.ts:345-356` cancels only a draft Story. The window is open → result landed: normally milliseconds, but up to about 11 minutes if the `open` post is resent and then given up. During that time the page says "AI가 Task로 나누고 올리는 중입니다" and offers 취소.
- Effect: the plan is cancelled, the Story stays open and claimable, the plan page has no Story link, and this bundle has no web cancel for an open Story.
- Recommend fixing now in `cancel()`: if `storyByKey` is in OPENED_STORY, record `story_id` and move the plan to `open`, or refuse with "Story #N이 이미 열렸습니다".

**M3. The executor's git step can overlap the planner's git on the same checkout.**
- `canStart` (`office.ts:734`) waits for "no open record", but not for the executor drive to be idle (`executor.ts:697-703`).
- When the heartbeat drops a record (NOT_YOURS, `scheduler.ts:241-250`) while prepare or merge is still running, the next claim tick can start planner fetches in that checkout.
- Both use FETCH_HEAD (`branch.ts:157-165`). The planner can then read the wrong tip, for example another Story's base, into the planning tree or into `bases.json` (persisted), or fail with GIT_FAILED.
- Fix: expose executor-busy (its `running` promise) and add it to `canStart`, or use a per-checkout git mutex.

**M4. A stop during `next()` still runs the step.**
- `stop()` aborts `current`, which is still null at that point. `tick()` does not check `stopped` after `await next()` (`planner.ts:746-788`), so the step runs with a fresh, non-aborted controller.
- On the `published` path it pushes bases and opens the Story during shutdown, then drops the result (`:741`). The next start recovers it.
- Fix: check `stopped` after `next()` and at the top of `runStep`.

**M5. After a cancel lands between the pre-publish heartbeat and publish, the Office still pushes `feature/story-N/base` to every repo** before the pre-open check notices (`planner.ts:513-528`). The result is orphan branches for a cancelled Story. Fix: one `goOn(s, story, true)` right after publish.

**M6. The plan page shows no Mac line while the lease is live** (`plan-pages.ts:125`). For up to 600000 ms after the PL's Mac sleeps or turns off mid-step, or after a given-up result, the page says "AI가 …하고 있습니다". Fix: also show the Mac line when the lease is live and `plMac.state === "off"`.

**M7. With zero ready lanes the page gives no reason.**
- Cases: no project repo registered on the PL's team Office, gh logged out everywhere, a locked Office, or no team Office at all.
- The planner never asks the Hub (`planner.ts:750-751`), so nothing fails and nothing names a repo. The page shows "기획 대기" plus "PL의 Mac: 대기 중", "잠김" or "연결된 Mac 없음".
- Review Focus 2 promises the missing repo is named, but that only happens when at least one lane is ready.
- Fix (Hub side): for a plan with no live lease, compare the project's repos with `store.reachableRepos(pl)` and name the ones not connected.

**M8. A result that can never be sent cycles forever.**
- Cases: persistent 5xx or 413 on plan-result, or a `failed` the Hub refuses with 400.
- What happens: 3 resends, then give-up, then a 600000 ms rest during which the lease still shows as live. The lease then expires, a new lease id is issued and the step re-runs with a new model turn. Repeat (`planner.ts:615-621,649-650`).
- The PL's newer plans are blocked too, because `next()` always picks the oldest plan (`plan-store.ts:475-478`).
- This is pathological. Remember given-up results per (planId, revision) rather than per lease.

**M9. Doing plan work first skips the scheduler's Task recovery in every tick that ran a plan step** (`office.ts:747`).
- A Task the Hub holds for the PL but the local store lost (a lost claim reply, or a web pick) waits behind all queued plan work and shows held after 10 minutes.
- Meanwhile the page's Mac line says the opposite ("그 Task가 끝나면 이어서 기획합니다").

**M10. Additive deviation, documented in Task 6: paused or capped Offices now run runner discovery.**
- `planCouldFollow` ignores pause, the daily cap and the quiet times (`office.ts:621-628`), so discovery runs every `recheckMs` on paused or capped Offices, including non-PL teammates. Presence can flip to limited while paused.
- Claim behaviour itself is unchanged.

**M11. Plan folders are never cleaned up.** `<root>/team/plans/<id>`, which holds a frozen candidate of up to 100 MiB, is never removed after open or cancel.

### Checked and fine

1. **Plan states**
   - A dead Office's lease ends after 600000 ms without a heartbeat (`plan-store.ts:206-208,471-482`). The page then shows "PL의 Mac이 꺼져 있습니다" (`plan-pages.ts:91-96`).
   - `failed` always has 다시 시도 for the PL (`plan-store.ts:366`, `plan-pages.ts:134-139`). Retry returns to `failure.from` with approvals kept (`:332-339`).
   - Hub not answering: 3 tries, then HUB_UNSURE `failed` (`planner.ts:662-673`). A 400 gets one HUB_REFUSED `failed` (`:634-640`). A missing repo is named (`:701-707`).
   - An old Hub is told once and asked again every 300 s (`:329-335`).
2. **Single-Office restart and races**
   - The lease is handed back; the publish key `plan:<id>` is idempotent; recorded base commits are never replaced (`:478-493`); a same-commit base counts as `exists` (`branch.ts:575-591`); an open answered STATE on an open Story counts as opened (`planner.ts:529-539`).
   - A cancel mid-step is caught by the periodic heartbeat (`:681-695`) and by the heartbeats before publish and open, plus the Hub's own draft cancel in one transaction (`plan-store.ts:351-353`). Stale results are dropped.
   - The 60 s heartbeat keeps long turns alive against the 600 s TTL. A lease re-leased after expiry answers NOT_YOURS or gone, which aborts the step.
3. **Gate**
   - `planTurn` takes the runtime's single slot (`live.ts:242-270`), counted by `busy()` (`lean/office.ts:692-695`). Runs are refused beside it (`live.ts:323`), and it is released in `finally` and on close (`live.ts:384-391`).
   - The planner's flags and heartbeat are cleared in `finally` (`planner.ts:736-739,789-791`).
   - The step runs inside the claim tick, so no claim or recovery overlaps it.
   - The quiet time and the post-give-up rest return `ran:false`, so Task claims go on. The "wait" codes (BUSY, CANCELLED and the like) are only transient.
4. **Story bases**: open only after all bases; a failed repo is named and the Story stays draft; recorded commits are reused; a cancelled Story stops before any base (`:504`); branch names are checked (`:509-511`). New Mac or lost folder: see I2 and M1.
5. **Additive**
   - The planner runs only when live (`office.ts:727`).
   - No plan work means `ran:false` and the scheduler tick runs as before (`:747-748`).
   - Pause and the daily cap still gate claims (`scheduler.ts:203-206`).
   - Old Hubs (404 without PLAN_GONE, or 426 expecting protocol 1 or 2) are left quiet.
   - The self-restart now waits while a plan step runs (`!planner.active()`, `:587`).

### Declined to judge
Model and prompt quality; permissions on the base push and the web forms (the security reviewer has these); real ContainerPlanner timeouts; Story-number collisions after a Hub reset (deployment); wording outside the lifecycle.

### Verdict for this seam: **With fixes**
Before merge:
- the I2 wording, at minimum;
- M1 (a one-line skip);
- M2 triage (a one-line fix in the Hub `cancel`);
- I1: either the lease-holder binding plus scoping `cancelDraft` to a cancelled plan, or record "one team Office per PL" as a stated limit.

The rest can be deferred.


