# 검증 기록: 브라우저 팀 흐름 묶음 2 (팀원 웹)

Story: M16 · V19 · D41. 결정은 [hub-web-team-flow-decision.md](../understanding/hub-web-team-flow-decision.md)(G3 2026-11-04)의 "팀원" 흐름 3–7과 "나눠서 만들기"의 묶음 2다. 계획은 [2026-11-05-1200-feat-teammate-web-plan.md](../plans/2026-11-05-1200-feat-teammate-web-plan.md), kit 실행은 `.ai-workflow/runs/U37-teammate-web.json`이다. 사용 안내는 [LOCAL-PREVIEW.md의 "팀원 웹"](../LOCAL-PREVIEW.md#팀원-웹)이다.

이 묶음은 팀원이 Hub 웹에서 터미널 없이 자기 일을 보는 데까지다. 첫 화면 **내 할 일**, 프로젝트 → Story → Task **보드**, **Task 상세**(3줄 요약·판단 기록·PR·멈춘 이유), **자동으로 일하기** 스위치, **작업하기**, **다시 시도**(메모), PL·관리자의 **풀기·취소** 버튼, 사용 한도로 쉬는 중일 때의 말과 시각이다. 웹에서 누른 것은 Hub 상태만 바꾸고, 각자 Mac의 Office가 지금 방식(가져가기·되찾기)으로 가져간다. PL의 웹 Story 작성·G1·Task 나누기(묶음 3)와 Story 검증·G4·머지(묶음 4)는 이 묶음 밖이다.

**자동 시험만 마쳤다. 실제 Mac과 사내 OpenShift 허브, 두 사람의 Mac으로는 돌려 보지 않았다(아래 "실제 확인 계획").** 그래서 실제 확인 전에는 팀원에게 쓰라고 안내하지 않는다. 머지는 G4 질문 관문 뒤에 정한다.

## 만든 것

기준 커밋은 계획 커밋 `f075432`(main `8055471` 위)다. 아래 시험 수는 그 Task 때 구현자가 보고한 그 Task의 시험 묶음이다. 전체 결과는 "자동 검사"에 따로 적는다.

| Task | 커밋 | 내용 | 그 Task의 시험 |
|---|---|---|---|
| 1 Hub 저장소 | `8f3119c` | 사람마다 자동으로 일하기(`hub_work_settings`, 행이 없으면 켜짐, 꺼지면 `claimNext`가 아무것도 안 줌), 작업하기·다시 시도·풀기·취소(사람이 행위자), 내 할 일(`memberWork`)·Task 상세(`taskDetail`)·버튼 판정(`taskActions`) | 새 시험 16/16 (hub+team 796/796) |
| 2 쉬는 이유 저장 | `30c60ab` | Mac 하트비트의 `until`(`hub_macs.until`), 쉬는 중의 말(`macWait`), 사람의 살아 있는 연결 repo(`liveLinkRepos`) | Mac 시험 50/50 (hub 365/365) |
| 3 Office 하트비트 | `0fdd477` | Office가 실행기를 기다릴 때 다시 시도할 시각(`until`)을 하트비트에 실어 보냄. Office 변경은 이것 하나 | team 437/437 |
| 4 Hub 웹 | `f8e4487` | 새 모듈 `src/hub/story-pages.ts`(스크립트 없음): 내 할 일(`/`), 보드, Story, Task 상세. 요청 게시판은 `/requests`로 옮김. 꺼짐 표시 | 17/17 (hub+team 819/819) |
| 5 웹 행동 | `7e27d39` | 스위치·작업하기·다시 시도·풀기·취소의 POST 경로(Origin·CSRF 검사 안) | 25/25 (hub 394/394) |
| 6 Office 되찾기 고정 | `ddc0ece` | 실제 스케줄러로 "웹에서 한 일을 Office가 자기 되찾기로 가져간다"를 고정(시험만, src 변경 없음). 임시 변경 6가지를 넣어 시험이 잡는 것을 확인 | 4/4 |
| 7 문서 | (이 커밋) | 사용 안내, 이 기록 | — |

- 리뷰는 Task마다 한 번씩 했고, 모두 첫 리뷰에서 통과했다(수정 라운드 없음). 브랜치 전체 리뷰 1차(`.ai-workflow/runs/U37-review-1.md`)가 고칠 것 F1–F7을 냈다. 아래 "리뷰 1차 뒤 고친 것"에 있다.
- Office를 바꾼 곳은 하트비트의 `until` 하나다(리뷰 1차 뒤 F6: 보내기 전에 안전한 0 이상 정수만 남긴다). 웹 행동은 Office의 기존 되찾기(`scheduler.recover`)로 가져간다. Task 6이 이것을 고정한다.
- 더하기만 했다. 프로토콜 1·2·3·4의 기존 필드, `/api/link/*`, `/api/mac/*`, 연결 문자열, `team pause|resume|cap|rerun`, `start --team`, `mac *`는 그대로다. 예외 하나: 첫 화면이 내 할 일이 되면서 요청 게시판이 `/`에서 `/requests`로 옮겼다.
- 새 npm 의존성은 없다. 새 화면에는 `<script>`가 없다.

## 판정 적용

계획의 "판정" 표를 그대로 구현했다. 구현 중 컨트롤러가 정한 판정(`Ruling`)과 리뷰가 찾은 것은 오른쪽 칸에 적었다. "—"인 행은 계획 그대로다.

| 계획의 판정 | 적용 | 구현 중 바뀐 것 |
|---|---|---|
| 자동으로 일하기는 Hub에 사람마다 둔다(행이 없으면 켜짐). 꺼지면 `claimNext`가 `null`. 맡은 Task·작업하기·웹 다시 시도·Story 검증에는 영향 없음 | Task 1·5 | **판정(리뷰 1차 뒤, F2, ASSUMED):** 사람이 직접 고른 작업하기와 다시 시도는 Mac의 `team pause`와 하루 상한을 따르지 않고(사람이 고른 일이다), 하루 상한에 세지 않는다. 계획의 "`team pause`·하루 상한은 그 위에 그대로 적용된다"는 자동으로 받는 일에만 맞다. 코드 변경 없음(Office의 되찾기는 처음부터 그랬고 Task 6이 고정한다) |
| 작업하기는 Hub에서 그 자리에서 claim을 만든다(없음 404 → 상태 409 → 담당자 403 → 연결 없음 `NOT_LINKED` → 맡은 Task 있음 `BUSY`). 스위치는 보지 않는다 | Task 1·5. 두 사람이 같은 Task를 누르면 늦은 쪽은 `STATE`, 한 사람이 둘을 누르면 둘째는 `BUSY` | **리뷰 1차 뒤(F1):** "연결 있음"은 "내 Office가 지금 그 repo를 가져감"이다. 살아 있는 연결 중 Office가 `MAC_OFFLINE_MS`(180000 ms) 안에 쓴 것만 치고, 가장 새 Mac이 잠김이면 하나도 치지 않는다(`HubStore.reachableRepos`). 준비 안 된 레인(gh), 다른 기계의 연결, 꺼진 Office는 연결을 쓰지 않는다. `NOT_LINKED` 말과 버튼 자리의 말이 바뀌었다. **(F5):** 두 번 눌러 첫 번째가 이미 됐으면(`STATE`이고 그 Task가 내 `claimed`) 둘째도 Task 상세로 간다. 켜짐 줄은 "자동으로 일하기가 켜져 있으면 내 Mac이 차례대로 가져갑니다." |
| Mac이 가져가지 않은 작업하기도 다른 claim과 같다. 10분 뒤 멈춤, PL이 푼다 | Task 1·4 | **리뷰 1차 뒤(F1):** 꺼짐·잠김·준비 안 된 레인은 버튼과 POST가 막으므로, 이 경우는 누른 직후(3분 안) Office가 멈춘 때로 좁아졌다 |
| 다시 시도는 맡은 사람이 지금의 Hub `rerun`을 웹에서 한다. Office는 옛 기록을 `NOT_YOURS`로 버리고 새 claim을 되찾는다 | Task 1·5, Task 6이 실제 스케줄러로 고정 | **판정(Task 1):** `taskActions`는 없는 id에 `taskDetail`처럼 `NOT_FOUND`를 던진다(페이지가 어차피 404여야 한다). **리뷰 1차 뒤(F1):** 웹 다시 시도도 작업하기와 같은 `reachableRepos`가 필요하다(`NOT_LINKED`, 버튼은 `yes|not-linked|no`). 링크 API의 `rerun`은 그대로다. **(F5):** 두 번 눌러 첫 번째가 이미 됐으면 Task 상세로 간다. **(F6):** 메모의 CRLF는 다듬기와 2000자 검사 전에 LF 하나가 된다(웹과 링크 공통) |
| 다시 시도는 맡은 사람만, 작업 Task만 한다 | Task 1·5 | **리뷰 1차 뒤(F5):** 웹의 검사 순서는 Story 검증 Task(`STATE`) → 실패가 아니거나 맡은 사람이 없음(PL이 풂) `STATE` "실패한 Task만 다시 시도할 수 있습니다. 화면을 새로 고쳐 확인하세요." → 남의 실패한 Task `FORBIDDEN` → `NOT_LINKED` → 메모다. 링크 API는 "실패한 Task만 다시 실행할 수 있습니다."를 그대로 쓴다 |
| 풀기·취소는 PL이나 관리자가 `releaseTask`·`cancelTask`로 한다. 취소는 "정말 취소합니다" 체크(`confirm=yes`)가 필요하다 | Task 1·5 | **판정(Task 5):** 체크가 없으면 없는 id여도 `INVALID`(400)다. 체크를 조회보다 먼저 보므로 id에 대해 아무것도 알려 주지 않는다. 손으로 만든 요청만 404 대신 400을 본다. **리뷰 1차 뒤(F4):** 웹 취소는 머지 잠금을 쥔 Task를 `STATE`("머지 잠금을 쥔 Task는 취소할 수 없습니다. 머지됐을 수 있으니 먼저 풀기를 하세요.")로 거절하고, 화면은 폼 대신 "머지 잠금을 쥐고 있어 지금은 취소할 수 없습니다. …"를 보인다(`cancelTask`의 `refuseLocked`, 버튼은 `yes|locked|no`). 링크 API의 취소는 그대로다. **(F5):** 풀기 문장은 "…그 레포 담당자 누구든 처음부터 다시 받습니다." |
| 보드 읽기와 풀기·취소의 첫 인자는 `Actor = { member }` | Task 1 | — |
| 모든 팀원이 모든 프로젝트·Story·Task를 본다. 버튼은 할 수 있는 사람에게만, 서버가 다시 막는다 | Task 1·4·5 | — |
| 버튼 표시는 저장소가 정한다(`#pickState` 하나) | Task 1 | **리뷰 1차 뒤(F1·F4):** 다시 시도와 취소의 버튼도 그 POST와 같은 저장소 규칙(`#rerunBlock`, 머지 잠금)에서 나온다 |
| 첫 화면 `/`는 내 할 일, 요청 게시판은 `/requests` | Task 4 | **판정(Task 4):** 메뉴의 "내 할 일"·"보드"는 Story 보드가 있는 Hub에만 보인다(보드 없는 Hub에는 Story 화면이 없다) |
| 자동으로 일하기가 꺼져 있으면 모든 화면 머리글에 "자동으로 일하기 꺼짐" | Task 4 | — |
| 내 할 일의 칸: 지금 맡은 일·받을 수 있는 일·내 Story에서 멈춘 일·끝낸 일 | Task 1·4 | **리뷰 전 이월(Task 1 → 4):** 풀기 뒤 다시 고른 Task에 옛 실패가 남아 있으므로, 화면은 상태가 실패일 때만 실패 이유를 보인다 |
| 상태 이름(할 일·진행 중(구현·리뷰·검증)·머지 중·멈춤·완료 등) | Task 4 | — |
| 멈춘 이유는 쉬운 말 한 문장 + "자세한 이유"(원문) | Task 4 | **판정(Task 4):** 멈춤(Mac 소식 없음)의 "내 Mac"은 맡은 사람에게만 "내 Mac"이고, 다른 사람에게는 "맡은 사람의 Mac"이다(남이 보면 "내 Mac"은 거짓이다). **리뷰 1차 뒤(F5):** 맡은 사람의 Mac이 소식을 보내는 중이면 멈춤 문장은 "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다."다(꺼짐·Mac 없음은 그대로). 충돌 행 바로 앞에 git·gh 단계 실패 행(`/ failed \d+ times in a row: /` → "Mac에서 git·GitHub 단계가 세 번 잇달아 실패했습니다. …")을 더했다. "자세한 이유"는 Task 상세에만 있고 내 할 일은 쉬운 말 한 문장과 링크다 |
| 쉬는 중의 말과 시각은 그 사람의 가장 새 Mac이 `limited`일 때만 | Task 2·4 | **판정(Task 4):** 실행기 이름 없이 not_ready면 빈 괄호 없이 "Mac의 AI 실행기가 준비되지 않아 쉬는 중입니다."(문구 다듬기). **리뷰 1차 뒤(F3):** 내 할 일은 맡은 일 카드가 말하지 않으면(맡은 일이 없거나 진행 중이 아님) 스위치 바로 아래에 보인다. not_ready에는 "Mac 터미널에서 {첫 실행기}를 실행해 설치와 로그인을 확인하세요."(실행기 이름이 없으면 claude)가 붙는다 |
| `until`은 프로토콜 4 하트비트의 선택 필드(0 이상의 안전한 정수 또는 null) | Task 2·3 | — |
| 한 사람의 여러 repo 사이 순서는 그 사람 Office의 등록 순서(ASSUMED) | 바꾸지 않음. 아래 "사람에게 보이는 한계" | — |
| 화면은 저절로 새로 고치지 않는다(ASSUMED). "새로 고침" 링크와 마지막 소식 시각 | Task 4 | **판정(리뷰 1차 뒤, F7):** "마지막 소식 N분 전"은 Task 상세와 내 할 일의 맡은 일 카드에만 있다(보드·Story·받을 수 있는 일·멈춘 일·끝낸 일에는 없다). 계획의 "각 화면에"는 그만큼 좁다. "새로 고침" 링크는 내 할 일·보드·Story·Task 상세에 있다. **(F5):** 단계가 아직 없는 claim은 "마지막 소식"(Hub가 claim한 시각) 대신 "내 Mac이 가져가기를 기다립니다(보통 1분 안)."(남에게는 "맡은 사람의 Mac이…")다 |

**계획 밖 판정.** Task 6의 시험은 처음부터 통과한다(Office가 바뀌지 않았다는 것을 고정하는 시험이므로). 그래서 RED 대신, 되찾기와 다시 시도 길을 임시로 깨 시험이 실패하는 것(임시 변경 6가지 모두 잡힘)을 보인 뒤 되돌렸다. 시험이 아무것도 고정하지 않는 일을 막는 증거다.

## 리뷰 1차 뒤 고친 것

브랜치 전체 리뷰 1차(리뷰어 셋, `.ai-workflow/runs/U37-review-1.md`)는 Critical 0, Important 4였다. 컨트롤러가 F1–F7로 묶었다. 시험마다 먼저 실패(RED)를 본 뒤 고쳤다. F6의 해제된 Mac 시험은 이미 있는 규칙을 따로 고정하는 시험이라, 그 조건을 임시로 지워 실패하는 것을 본 뒤 되돌렸다.

| 고친 것 | 커밋 | 무엇 | 시험 |
|---|---|---|---|
| F1 가져갈 수 있는 repo | `4bc8e1c` | `HubStore.reachableRepos`: 살아 있는 연결 중 Office가 180000 ms 안에 쓴 것, 가장 새 Mac이 잠김이면 없음. 작업하기·웹 다시 시도와 그 버튼이 이것을 쓴다(`NOT_LINKED` 말 하나). `TaskActions.rerun`은 `yes|not-linked|no` | `hub-store-mac` "reachableRepos holds a live link seen within 180000 ms …", `hub-story-work` "pickTask is NOT_LINKED for a stale link; rerunTask is NOT_LINKED …", 실제 스케줄러 `hub-web-office` "a lane that is not ready (gh) is not reachable …", `hub-story-pages` "a failed Task whose repo the assignee's Mac is not taking now …" |
| F2 직접 고른 일과 pause·상한 | (리뷰 1차 문서 커밋) | 판정(ASSUMED)과 문서만. 코드 변경 없음 | Task 6의 "even with the local pause on" 시험이 이미 고정 |
| F3 쉬는 중 문장의 자리 | `669b9a9` | 내 할 일은 맡은 일 카드가 말하지 않으면 스위치 바로 아래에 쉬는 이유를 보인다. not_ready에 할 일을 더했다 | `hub-story-pages` "a member with no open Task whose newest Mac rests with claude: not_ready sees what to do on /", `waitText` 단언 |
| F4 머지 잠금 중 취소 | `e7cbe1f` | 웹 취소는 머지 잠금을 쥔 Task를 `STATE`로 거절(`cancelTask(…, { refuseLocked: true })`), 화면은 폼 대신 문장. `TaskActions.cancel`은 `yes|locked|no`. 링크 API는 그대로 | `hub-story-work` "the link cancel of a merge-locked Task still works; with refuseLocked it is STATE and nothing changes", `hub-story-pages` 버튼 시험과 "취소 of a Task that holds the merge lock is a STATE page …" |
| F5 문구 | `669b9a9` | Mac이 켜진 멈춤, 단계 없는 claim의 "가져가기를 기다립니다", 켜짐 줄, git·gh 단계 실패 행, 웹 다시 시도의 `STATE` 말(풀린 Task 포함), 두 번 누르기는 Task 상세로, 풀기 문장 | `hub-story-pages`의 멈춤·"a claim the Mac has not taken yet …"·작업하기·다시 시도 POST·`plainFailure` 시험, `hub-story-work` 다시 시도 검사 순서 |
| F6 단단하게 | `acf1a37` | Office는 `until`을 안전한 0 이상 정수일 때만 보낸다(그 밖은 null). 메모의 CRLF는 LF 하나로 센다. 해제된 Mac 시험은 `hub_macs` 행만 해제해 Mac이 살아 있어야 한다는 조건을 따로 고정한다(`reachableRepos`도) | `team-mac` "macClient sends until only as a safe non-negative integer …", `hub-story-work` "a 2000-character rerun memo whose line breaks arrive as CRLF …", `hub-store-mac` liveLinkRepos 시험 |
| F7 문서 | (리뷰 1차 문서 커밋) | LOCAL-PREVIEW "팀원 웹", 이 기록, 계획의 "리뷰 뒤 바뀐 것" | — |

## 자동 검사

| 검사 | 결과 |
|---|---|
| 전체 `npm test` | Task 6까지 끝난 `7e27d39`에서 **1607/1607**, exit 0(119초). 실패 0, 취소 0, 건너뜀 0 |
| 전체 `npm test`(리뷰 1차 수정 뒤) | 리뷰 1차 수정의 코드 `acf1a37`에서(이 문서 변경은 커밋 전, 시험은 문서를 읽지 않는다) **1617/1617**, exit 0(113초). 실패 0, 취소 0, 건너뜀 0. 새 시험 10개 |
| 리뷰 1차 수정의 시험 파일 8개 | `hub-story-work`·`hub-story-pages`·`hub-store-mac`·`hub-mac-api`·`hub-web-office`·`team-mac`·`team-mac-watch`·`team-office` **185/185**, exit 0 |
| `npm run typecheck` | exit 0(`7e27d39`), 리뷰 1차 수정 뒤 exit 0(`acf1a37`) |
| Story 검사 `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0, 리뷰 1차 수정 뒤 exit 0 |
| 브랜치 전체 리뷰와 kit 검증 | 리뷰 1차는 위 "리뷰 1차 뒤 고친 것"이다. 리뷰 2차와 kit 검증은 이 기록을 고친 뒤에 한다. 결과는 kit 실행 기록 `.ai-workflow/runs/U37-review-N.md`·`U37-verify-N.md`에 남는다. 여기에 적지 않는다 |

Task별 리뷰와 그 시험 수는 "만든 것"에 있다. Task 3 구현 중 `team-lifecycle`의 사내 CA 시험이 한 번 실패했으나 혼자 12/12, 그 뒤 전체 실행에서 통과했다(이번 전체 실행도 통과). G4 기록은 kit 검증 뒤에 한다.

## 확인하지 않은 범위

자동 시험은 로컬 Hub와 가짜 Mac·실행기, 실제 스케줄러(Task 6)를 쓴다. 다음은 시험으로 증명하지 않았다.

- **실제 브라우저에서 본 모양:** 화면은 서버가 만든 HTML을 문자열로 확인했다. 실제 브라우저에서 줄바꿈·표·버튼 배치·좁은 화면, "새로 고침" 뒤 흐름을 눈으로 보지 않았다.
- **실제 Mac의 Office가 웹 행동을 가져가는 시간:** 시험은 가짜 시계로 한 tick을 건넌다. 실제로 작업하기가 1–2분 안에, 다시 시도가 다음 하트비트와 tick을 거쳐 가져가지는지.
- **실제 사용 한도·결제·로그인 문제:** 쉬는 중의 말과 "약 N분 뒤" 시각이 실제 Office의 `retryAt`과 맞는지(시험은 값을 직접 넣는다).
- **실제 OpenShift 허브:** 재배포한 허브에서 새 화면, 사람의 시간대와 다른 서버 시간대, 라우터·프록시 뒤의 POST(Origin·CSRF).
- **두 사람의 Mac:** 한 Story의 Task를 두 사람이 겹치지 않게 받는지, 두 사람이 같은 Task에 작업하기를 누를 때 실제 경합.
- PL의 웹 Story 작성·G1·Task 나누기(묶음 3), Story 검증·G4·머지(묶음 4). 맡은 사람의 반납 버튼, 알림, 화면 저절로 새로 고침, repo를 건너는 오래된 순 배정.

**사람에게 보이는 한계(리뷰가 미룬 것 중에서).** 아래는 알면서 두었다. 고칠지는 마지막 리뷰와 G4가 정한다.

- **화면이 저절로 새로 고쳐지지 않는다.** 내 할 일·보드·Story·Task 상세의 "새로 고침" 링크를 쓴다(ASSUMED). "마지막 소식"은 Task 상세와 내 할 일의 맡은 일 카드에만 있다.
- **여러 repo를 맡은 사람의 repo 사이 순서는 그 사람 Mac의 등록 순서다**(ASSUMED). repo 하나 안에서는 Story 만든 순 → Task 번호 순이다. 그 repo의 레인이 Office에서 준비 안 됨이면 그 사람은 다른 repo의 일을 받는다.
- **Mac이 가져가지 않은 작업하기는 10분 뒤 "멈춤(Mac 소식 없음)"으로 보이고, PL이 풀어야 한다.** 꺼짐·잠김·준비 안 된 레인은 버튼과 POST가 막으므로(F1), 누른 직후(3분 안) Office가 멈춘 때만 그렇게 된다.
- **자동으로 일하기 스위치는 자동으로 받는 것만 막는다.** 맡은 Task, 작업하기, 다시 시도, PL의 Story 검증은 꺼져 있어도 돈다. Mac의 `team pause`와 하루 상한도 자동으로 받는 일만 막는다(직접 고른 작업하기와 다시 시도는 따르지 않고 상한에 세지 않는다, F2).
- **AI 실행기 하나가 준비 안 됨인 동안 직접 고른 다른 repo의 Task는 돈다.** 그동안 머리글은 "쉬는 중(한도)"이고 Task 상세는 "Mac의 AI 실행기(…)가 준비되지 않아 쉬는 중입니다."를 보인다(F2의 한계).
- **Office가 스스로 다시 켜지는 몇 초 사이(`mac restart`)에 작업하기를 누르면** 다시 켜기가 그 Task가 끝날 때까지 미뤄질 수 있다(F2의 한계).
- **gh 로그인이 풀린 레인의 실패한 Task도 웹 다시 시도는 `reachableRepos`를 통과한다.** 실패 기록의 Task 읽기(하트비트마다)가 그 연결을 쓰기 때문이다. 새 claim은 gh가 다시 될 때까지 되찾아지지 않고, 그동안 10분이 넘으면 멈춤(Mac은 켜져 있지만…)으로 보인다.
- **풀기 뒤의 취소도 늦은 머지 보고를 받지 않는다.** F4는 머지 잠금을 쥔 동안만 막는다. 풀기가 잠금을 풀므로 그 뒤 취소는 된다.
- **웹 다시 시도 뒤에 보낸 로컬 `team rerun --memo`의 메모는 쓰이지 않는다.** Office는 Hub의 새 claim(웹 메모)을 받아들인다. 반대로 로컬 다시 시도가 먼저 Hub에 닿았으면 웹의 다시 시도는 Task 상세로 가고 웹 메모는 저장되지 않는다(F5의 두 번 누르기 규칙).
- **연결 문자열로 붙인 Office(Mac 없음)가 잠김으로 돌면 Hub는 모른다.** 잠김은 Mac 하트비트로만 알기 때문이다. 그 repo의 작업하기는 받아들여지고, Office는 그 claim을 되찾아 하트비트만 보내며 돌리지 않는다.
- **보드의 멈춤 수에는 실패한 Story 검증이 들어가지 않는다**(링크 API의 `StorySummary`를 바꾸므로 묶음 4).
- **요청 게시판이 `/requests`로 옮겼다.** `/`의 예전 북마크는 내 할 일을 연다(Story 보드가 있는 Hub).
- **보드의 Story 목록은 Story마다 Task를 따로 읽는다**(팀 규모에서는 문제없다).
- 구현 중 Task별 작은 지적 중 시험에만 관련된 것(사용하지 않는 변수, 약한 단언 등)은 `progress.md`의 장부에 있고, 사람에게 보이지 않는다.

## 실제 확인 계획

사용자 확인 뒤에 한다. 공유 허브, app-be(실제 데이터 폴더와 OpenShift 허브 연결이 있음), 회사 repo에는 쓰지 않는다. 그런 것이 필요하면 따로 묻는다. 실제 Mac의 `~/Library/LaunchAgents/com.pazmo.office.plist`를 쓰는 확인은 [묶음 1의 계획](2026-11-04-mac-connect.md#실제-확인-계획) 머리말을 따른다.

### 이번 묶음: 로컬 LAN 허브 + 이 Mac + 시험 팀원 한 명 더

묶음 1의 "이번 묶음" 준비(로컬 허브, `NODE_EXTRA_CA_CERTS`, 시험용 `--data-dir`)를 그대로 쓴다. 팀원 A는 이 Mac에 `mac connect`로 연결하고, 팀원 B는 **두 번째 시험 데이터 폴더**의 Office를 연결 문자열(`hub-link`)로 연결해 "두 번째 사람" 역할만 한다(Mac이 아니어도 된다).

1. **준비.** 시험 프로젝트에 repo 둘(`app-be`, `app-fe` 같은 시험 repo)을 두고 PL·A·B를 담당으로 나눈다. PL이 Story를 만들고 Task 몇 개를 ready로 둔다(웹 Story 작성은 묶음 3이라 지금은 `story` CLI나 시험 시드로 만든다). 시험 repo의 원격은 시험용이고 회사 repo가 아니다.
2. **내 할 일과 보드.** A의 `/`에 맡은 일·받을 수 있는 일·끝낸 일 칸이 보이고, `/board`에서 프로젝트 → Story → Task로 들어가 Task 상세(3줄 요약·판단 기록·PR)가 보인다. 없는 Task 주소는 404 화면이다. 요청 게시판이 `/requests`에 있다.
3. **자동 받기.** A가 자동으로 일하기를 켠 채(기본)로 두면 Office가 ready Task를 가져가고, 내 할 일의 상태가 시작 중 → 진행 중(구현·리뷰·검증) → 머지 중 → 완료로 바뀐다(화면은 "새로 고침"을 눌러야 바뀐다).
4. **스위치 끄기·켜기.**
   - 일하는 동안 끈다. 맡은 Task는 끝까지 가고, 끝난 뒤 새 Task를 받지 않는다. 머리글에 "자동으로 일하기 꺼짐"이 보이고 누르면 내 할 일로 간다.
   - 다시 켜면 다음 가져가기에서 ready Task를 받는다.
5. **작업하기.**
   - 끈 상태에서 받을 수 있는 일 하나의 "작업하기"를 누른다. 1–2분 안에 Mac이 가져가는지, 내 할 일에 맡은 일로 보이는지.
   - 내 Mac이 지금 가져가지 않는 repo(연결 없음, Office에서 gh 준비 안 됨, Mac 꺼짐·잠김)의 Task는 버튼 대신 "내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제)."가 보인다. Office를 켠 뒤 1분 안에 버튼이 돌아오는지.
   - 이미 맡은 Task가 있을 때, 그리고 A와 B가 같은 Task를 동시에 누를 때(늦은 쪽이 거절되고 아무것도 안 바뀐다).
6. **일부러 실패시킨 Task의 다시 시도와 메모.**
   - Task 하나를 실패하게 만든다(예: 빌드 시간 안에 끝나지 않을 범위, 또는 실행기 로그아웃으로 한도·로그인 실패). 멈춘 이유가 쉬운 말 한 문장이고 "자세한 이유"에 원문이 있다.
   - 메모를 적고 **다시 시도**를 누른다. Mac이 1–2분 안에 새 시도로 가져가고, AI가 메모를 읽고 처음부터 도는지(Task 계약에 마지막 실패와 메모가 들어간다). 실제 브라우저에서 두 번 빨리 누르면 둘 다 Task 상세로 가고 메모는 첫 것만 남는지.
   - B로 같은 Task의 다시 시도를 누르면 "내가 맡은 Task만…"으로 거절되는지.
7. **PL의 풀기·취소.**
   - A의 Mac을 끄고 10분 넘게 둔다. Task가 "멈춤(Mac 소식 없음)"으로 보이고, PL의 화면에 풀기가 있고 A와 B에게는 없다. 풀면 "할 일"로 돌아가고 그 repo 담당자 누구든 다시 받는다.
   - 머지 잠금을 쥔 채 멈춘 Task에는 취소 대신 "먼저 풀기를 하세요" 문장이 보이는지.
   - 끝나지 않은 Task의 취소는 "정말 취소합니다"를 체크하지 않으면 눌리지 않고, 체크하면 그 Task가 취소됨이 되며 뒤 Task가 이것 없이 진행하는지.
8. **사용 한도 쉬는 중 문장과 시각.** `claude auth logout`이나 실제 한도로 Mac이 쉬는 중(한도)이 되게 한다. 내 할 일과 Task 상세에 "AI 사용 한도라 쉬는 중입니다. 약 N분 뒤 다시 시도합니다."(결제·로그인·준비 안 됨도 각각)가 나오고, N이 실제 `retryAt`과 맞는지, 로그인한 뒤에 사라지는지. Mac을 끄면 이 문장이 나오지 않는지.
9. **요청 게시판 이동.** `/requests`와 `/requests?view=mine|repos`가 지금 방식대로 열린다. Story 보드 없이 띄운 Hub(`board` 없는 서버)는 `/`가 요청 게시판이다.
10. **믿을 수 없는 글.** 제목·설명·메모에 `<script>`, `"><img>` 꼴을 넣은 Task·Story를 만들어 모든 화면에서 글자로 보이는지.

### 중간점검(네 묶음 뒤): 사내 OpenShift 허브와 두 사람의 Mac

사내 OpenShift에 허브를 새 버전으로 다시 띄운 뒤, **두 사람의 Mac**으로 한다. [묶음 1의 중간점검 목록](2026-11-04-mac-connect.md#중간점검네-묶음-뒤-사내-openshift-허브와-두-사람의-mac)(설치 한 줄, 회사 GitHub Enterprise, 라우터·`x-forwarded-for`, 한 사람 한 Mac, 로그인 때 자동 실행)을 그대로 하고, 이 묶음의 것을 더한다.

- **두 사람의 내 할 일이 겹치지 않게 배정된다.** 같은 repo를 담당하는 두 사람이 자동으로 일하기를 켜 두고, 각자 다른 Task를 받는다(한 Task는 한 사람). 서버 시간대가 사람의 시간대와 달라도 "약 N분 뒤"가 맞다.
- 위 "이번 묶음" 4–10을 같은 방식으로 다시 한다: 스위치 끄기·켜기, 작업하기, 일부러 실패시킨 Task의 다시 시도와 메모, PL의 풀기·취소, 사용 한도 쉬는 중 문장과 시각, 요청 게시판 이동.
- 사내 프록시·라우터 뒤에서 모든 POST(스위치·작업하기·다시 시도·풀기·취소)가 Origin·CSRF 검사를 통과하는지.

### 네 묶음 뒤 중간점검이 덮어야 할 것(묶음 1·2 합친 목록)

사용자가 요청한 짧은 체크 목록이다. 상세 절차는 위 두 계획에 있다.

- [ ] 사내 OpenShift 허브를 새 버전으로 재배포(이때 `PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF`, OpenShift Template 매개변수)
- [ ] 두 사람이 깨끗한 Mac에서 설치 한 줄(Homebrew, 관리자 암호 여부, GitHub·Claude 로그인, 허용 화면, Rosetta 터미널)
- [ ] 회사 GitHub Enterprise repo의 gh 로그인·`setup-git`·clone, 사내 프록시와 인증서
- [ ] 라우터 앞 로드밸런서와 `x-forwarded-for`(시작 요청 10번/10분이 팀 전체에 걸리는지)
- [ ] 한 사람 한 Mac(같은 사람 두 대는 앞 Mac 해제, 다른 사람의 두 Mac은 서로 안 해제)
- [ ] 로그인 때 자동 실행과 VPN 없는 로그인 직후의 복구, 재로그인·재부팅 뒤 켜짐
- [ ] 머리글 "내 Mac" 상태 다섯 가지(대기 중·일하는 중·쉬는 중·잠김·꺼짐)
- [ ] 내 할 일: 두 사람에게 겹치지 않게 배정, 상태가 시작 중 → 진행 중 → 머지 중 → 완료로 바뀜
- [ ] 자동으로 일하기 끄기·켜기(맡은 일은 끝까지, 끈 동안 새 일 없음, 머리글 표시)
- [ ] 작업하기(1–2분 안에 가져감, 내 Mac이 가져가지 않는 repo 안내, 동시에 누르기)
- [ ] 일부러 실패시킨 Task의 다시 시도와 메모(쉬운 말 이유, 메모가 AI에 전달)
- [ ] PL의 풀기·취소(10분 넘게 소식 없는 멈춤, 취소 확인 체크)
- [ ] 사용 한도로 쉬는 중 문장과 시각("약 N분 뒤"가 실제와 맞음)
- [ ] 요청 게시판 `/requests` 이동
- [ ] 묶음 1의 미룬 것: `insteadOf` 호스트 별칭, `/api/mac/link` 응답 유실, 담당 repo 변경 때 스스로 다시 켜기

실제 확인 전에는 팀원에게 쓰라고 안내하지 않는다.
