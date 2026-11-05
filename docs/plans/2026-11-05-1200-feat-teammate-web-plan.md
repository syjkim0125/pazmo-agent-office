# 브라우저 팀 흐름 묶음 2 (팀원 웹) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원이 Hub 웹에서 터미널 없이 자기 일을 본다. 첫 화면 **내 할 일**, **보드**(프로젝트 → Story → Task), **Task 상세**(3줄 요약·판단 기록·PR·멈춘 이유), **자동으로 일하기** 스위치, **작업하기**, **다시 시도**(메모), PL·관리자의 **풀기·취소** 버튼을 더한다. 웹에서 누른 것은 Hub 상태만 바꾸고, 각자 Mac의 Office가 지금 방식(가져가기·되찾기)으로 가져간다.

**Architecture:**
- **Hub 저장소(`StoryBoard`):** 사람마다 자동으로 일하기 설정(`hub_work_settings`, 행이 없으면 켜짐)을 두고, 꺼져 있으면 `claimNext`가 아무것도 주지 않는다. 웹 행동(작업하기·다시 시도·풀기·취소)은 사람(`Member`)을 행위자로 받는 메서드다. 작업하기와 다시 시도는 Hub에서 바로 그 사람의 claim을 만든다. 그러면 Office의 기존 되찾기(`scheduler.recover`: inbox → Task 읽기)가 그 claim을 가져간다. 그래서 **Office 코드와 프로토콜 3은 바뀌지 않는다.** 화면과 저장소가 같은 규칙을 쓰도록 버튼 표시 판정(`TaskActions`)도 저장소가 낸다.
- **Hub 웹:** 서버가 만드는 HTML 새 모듈 `src/hub/story-pages.ts`(스크립트 없음). `/`가 내 할 일이 되고, 지금의 요청 게시판은 `GET /requests`로 옮긴다. Story 보드가 없는 Hub(`board` 없이 띄운 서버)는 지금처럼 `/`가 요청 게시판이고 Story 화면은 404다.
- **쉬는 이유와 시각:** Office의 Mac 하트비트(프로토콜 4)에 선택 필드 `until`(다시 시도할 시각, ms)을 더한다. Hub는 `hub_macs.until`에 두고, 웹이 "사용 한도라 쉬는 중, 약 N분 뒤 다시 시도"를 보인다. Office 쪽 변경은 이것 하나다.

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행), npm 의존성 0, 서버가 만드는 HTML.

**Spec:**
- `docs/understanding/hub-web-team-flow-decision.md`(G3 2026-11-04)의 "팀원" 흐름 3–7, "나눠서 만들기"의 묶음 2. Story D41 / M16 / V19.
- 묶음 1 계획 `docs/plans/2026-11-04-1500-feat-mac-connect-plan.md`(Mac 연결, 머리글 "내 Mac", Mac 하트비트)와 그 "마지막 리뷰 뒤 바뀐 것".

## Global Constraints

- **작업 위치:** worktree `.claude/worktrees/silly-liskov-b64760`, 브랜치 `claude/silly-liskov-b64760`. 부모 체크아웃으로 `cd`하지 않는다. push는 PR 때만 한다. kit 실행은 `.ai-workflow/runs/U37-teammate-web.json`(main에서 U37이 비어 있음을 2026-11-05에 확인, 머지 전에 다시 확인).
- **Node 24:** `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:$PATH"`. 전체 `npm test`는 한 번에 하나만(다른 세션 포함, `pgrep -fl -- "--test"`로 확인). 새 npm 의존성 없음. 시험 실행: `node --experimental-vm-modules --test <파일>`.
- **더하기만 한다(예외 하나):** 프로토콜 1·2·3·4의 기존 필드, `/api/link/*`, `/api/mac/*`, 연결 문자열, `team pause|resume|cap|rerun`, `start --team`, `mac *`는 그대로다. 예외: 웹의 첫 화면이 내 할 일이 되면서 요청 게시판이 `/`에서 `/requests`로 옮긴다(그 시험의 경로만 바꾼다).
- **화면:** 쉬운 한국어. 스크립트를 새로 넣지 않는다(CSP `script-src 'self'` 그대로, 새 화면은 `<script>` 없음). 모든 값은 `esc()`를 거친다. 모든 POST는 지금의 Origin·CSRF 검사를 거친다.
- **공개 레포:** 사내 호스트·조직·repo 이름을 커밋하지 않는다. 시험 repo는 `app-be`·`app-fe`, 원격은 `github.example.com/...`이다.
- **값:**

  | 항목 | 값 |
  |---|---|
  | 받을 수 있는 일 목록 | 50개까지, Story 만든 순 → Task 번호 순(`claimNext`와 같은 순서) |
  | 끝낸 일 목록 | 20개까지, 최근 것부터 |
  | 다시 시도 메모 | `LIMITS.memoMax` 2000자, 앞뒤 공백 제거, 비면 없음(null) |
  | 멈춤(소식 없음) | `HELD_AFTER_MS` 600000 ms(지금과 같음) |
  | Office가 웹 행동을 가져가는 시간 | 작업하기: 다음 claim tick(`CLAIM_MS`). 다시 시도: 다음 하트비트(60000 ms)에서 옛 기록을 버리고 다음 tick에서 새 claim을 가져감 |
  | `until` | 0 이상의 안전한 정수(ms) 또는 null. 하트비트에 없으면 null로 지운다 |
  | 상대 시각 | 지났거나 1분 안 "곧", 60분 안 "약 N분 뒤", 그 밖 "약 N시간 M분 뒤"(M이 0이면 "약 N시간 뒤") |

- **새 오류 코드:** `NOT_LINKED` 409. 그 밖은 기존 `NOT_FOUND` 404, `FORBIDDEN` 403, `STATE` 409, `BUSY` 409, `INVALID` 400이다.

## 판정 (설계가 열어 둔 것, 이 계획에서 정함)

| 판정 | 이유 |
|---|---|
| **자동으로 일하기는 Hub에 사람마다 둔다.** `hub_work_settings(member_id PRIMARY KEY REFERENCES hub_members(id), auto_work INTEGER NOT NULL CHECK(auto_work IN (0,1)), updated_at INTEGER NOT NULL)`이고 행이 없으면 켜짐이다. 꺼지면 `claimNext`가 `null`을 준다(응답은 지금처럼 `{task:null, open}`). 맡고 있는 Task, 작업하기로 고른 Task, 웹 다시 시도, PL의 Story 검증(`claimVerify`)에는 영향이 없다. Mac의 `team pause`·하루 상한은 그 위에 그대로 적용된다 | 설계 4: "끄면 새로 배정받지 않는다(맡은 Task는 끝까지)". Hub는 Office에 먼저 연락하지 못하니, 웹이 바꾸고 Office가 claim할 때 Hub가 판정하는 자리가 하나뿐이다 |
| **작업하기는 Hub에서 그 자리에서 claim을 만든다.** `claimNext`와 같은 `#claim`(새 claim id, `heartbeat_at`=지금), 이벤트 `picked`. Office는 다음 tick의 `recover()`(열린 기록이 없을 때 inbox의 `mine`을 읽음)로 가져간다. 조건(위에서부터 판정): 있는 Task(`NOT_FOUND`) → 작업 Task·`ready`·Story `open`(`STATE`) → 그 repo의 담당자(`FORBIDDEN`) → 그 사람에게 그 repo의 살아 있는 연결이 있음(Mac이든 연결 문자열이든, `NOT_LINKED`) → 맡은 Task 없음(`BUSY`). 스위치는 보지 않는다. 화면은 스위치가 꺼졌을 때만 버튼을 보인다 | 예약을 따로 두면 만료·해제 규칙과 프로토콜 필드가 더 필요하다. 되찾기 길은 이미 있고(응답을 잃은 claim용), 한 Task 한 사람·한 사람 한 Task는 Hub의 고유 색인이 지킨다. 연결 없는 repo를 고르면 아무도 그 claim을 돌리지 않는다 |
| **Mac이 가져가지 않은 작업하기도 다른 claim과 같다.** 10분 동안 하트비트가 없으면 멈춤(소식 없음)으로 보이고 PL이 푼다. 따로 만료하지 않는다 | 지금의 보류 규칙 하나로 다룬다 |
| **다시 시도는 지금의 Hub `rerun`을 웹에서 맡은 사람이 하는 것이다.** 실패한 작업 Task가 새 claim id로 `claimed`가 되고 메모가 저장되며 이벤트 `rerun`(메모)이 남는다. Office는 실패 기록의 Task 읽기(하트비트마다)가 `NOT_YOURS`를 받아 그 기록을 버리고, 다음 tick의 `recover()`가 새 claim을 가져간다. 첫 시도의 계약에는 Hub가 준 마지막 실패와 메모가 들어간다(`story-contract.ts`의 `lastFailure`). 로컬 `team rerun --memo`도 그대로 되고, 둘이 겹치면 늦은 쪽이 `STATE`다(Office는 `rerunTaken`으로 이미 처리함) | 프로토콜과 Office를 바꾸지 않는다. Task 6이 실제 스케줄러로 이 길을 고정한다 |
| **다시 시도는 맡은 사람만, 작업 Task만 한다.** 남이 누르면 `FORBIDDEN`("내가 맡은 Task만 다시 시도할 수 있습니다."), Story 검증 Task는 `STATE`("Story 검증은 PL의 Office가 다시 합니다.") | 다시 도는 곳은 맡은 사람의 Mac이다. Story 검증은 묶음 4다 |
| **풀기·취소는 지금의 `releaseTask`·`cancelTask`를 웹 사람이 행위자로 부른다(그 Story의 PL이나 Hub 관리자).** 풀기는 멈춤(소식 없음)·실패일 때, 취소는 끝나지 않은 작업 Task일 때다. 취소는 "정말 취소합니다" 체크(`confirm=yes`)가 있어야 하고 없으면 `INVALID`("취소하려면 '정말 취소합니다'를 체크하세요.")다. 화면은 각 버튼이 하는 일을 한 줄로 말한다 | 설계 PL 5: "지금 Hub에 있는 동작을 웹 버튼으로". 취소는 되돌릴 수 없다 |
| **보드 읽기와 풀기·취소의 첫 인자는 `Actor = { member: Member }`다**(`projects`, `stories`, `story`, `releaseTask`, `cancelTask`). `Link`도 그 모양이라 링크 API는 그대로다 | 이 메서드들은 `l.member`만 쓴다. 같은 규칙을 두 번 쓰지 않는다 |
| **모든 팀원이 모든 프로젝트·Story·Task를 본다.** 버튼은 할 수 있는 사람에게만 보이고, 서버는 저장소의 검사로 다시 막는다 | 지금 링크 API도 아무 연결로나 보드를 읽는다. 팀이 같은 보드를 본다 |
| **버튼 표시는 저장소가 정한다.** `taskActions`와 `memberWork`의 `pick`은 작업하기와 같은 판정 함수 하나(`#pickState`)를 쓴다 | 화면과 POST가 다른 규칙을 쓰면 누를 수 없는 버튼이 생긴다 |
| **첫 화면 `/`는 내 할 일이다.** 요청 게시판은 `GET /requests`(탭 `/requests?view=mine|repos`)로 옮긴다. 메뉴: 내 할 일 · 보드 · 레포 · 팀원·초대(관리자) · 요청 게시판 · 내 Office 연결 · 인증서. 초대 수락 뒤는 지금처럼 `/start`다. 내 할 일도 Mac이 없고 설치 한 줄을 주는 Hub면 "이 Mac 연결" 안내를 맨 위에 보인다 | 설계 "첫 화면은 '내 할 일'", 팀원 2 |
| **자동으로 일하기가 꺼져 있으면 모든 화면 머리글에 `자동으로 일하기 꺼짐` 표시(`/` 링크)가 붙는다.** 켜져 있으면 아무것도 붙지 않는다 | 꺼 둔 것을 잊으면 일이 오지 않는 이유를 모른다 |
| **내 할 일의 칸:** 지금 맡은 일(열린 Task 하나, 종류 무관), 받을 수 있는 일(내가 담당인 repo의 열린 Story에서 ready인 작업 Task), 내 Story에서 멈춘 일(내가 PL인 Story의 멈춤·실패 Task, 있을 때만), 끝낸 일(내가 마지막으로 머지 보고한 Task) | 설계 3: "배정된 Task, 진행 중, 멈춤, 끝난 것". 배정은 자동이라 "배정된 Task"는 맡은 하나다 |
| **상태 이름:** waiting "앞 Task 기다림", ready "할 일", claimed는 단계로 — 없음 "시작 중", build "진행 중(구현)", review "진행 중(리뷰)", verify "진행 중(검증)", merge "머지 중" —, held "멈춤(Mac 소식 없음)", failed "멈춤(실패)", merged "완료", passed "검증 통과", cancelled "취소됨". Story: draft "준비 중", open "진행 중", verifying "Story 검증 중", awaiting_g4 "승인 대기", done "완료", cancelled "취소됨" | 설계 5: 할 일 → 진행 중(구현·리뷰·검증) → 머지 중 → 완료 |
| **멈춘 이유는 쉬운 말 한 문장 + "자세한 이유"(원문 `<pre>`)다.** 실패 이유 앞부분으로 고른다: `RUNNER_LIMIT` "AI 사용 한도가 6시간 안에 풀리지 않았습니다. 한도가 풀린 뒤 다시 시도하세요." / `RUNNER_BILLING` "AI 결제·크레딧 문제입니다. 결제를 확인한 뒤 다시 시도하세요." / `RUNNER_LOGIN` "Mac의 AI 로그인이 풀렸습니다. Mac 터미널에서 claude를 실행해 로그인한 뒤 다시 시도하세요." / `RUNNER_NOT_READY` "Mac의 AI 실행기가 준비되지 않았습니다. Mac에서 claude 설치와 로그인을 확인한 뒤 다시 시도하세요." / `PR #`로 시작하고 `was closed on GitHub`가 있음 "GitHub에서 이 Task의 PR이 닫혔습니다. PR을 다시 연 뒤 다시 시도하세요." / `BUILD_TIMEOUT` "구현이 90분 안에 끝나지 않았습니다. 메모로 범위를 좁혀 다시 시도하세요." / `conflict`가 있음(대소문자 무시) "Story base와 합치다 충돌이 났습니다. 다시 시도하면 AI가 충돌을 풀며 처음부터 합니다." / 그 밖 "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요." Story 검증 Task의 실패는 "Story 검증이 실패했습니다. PL이 고칠 Task를 더한 뒤 다시 검증합니다." 멈춤(Mac 소식 없음)은 "맡은 사람의 Mac에서 10분 넘게 소식이 없습니다. Mac이 켜지면 이어서 합니다. 오래 멈춰 있으면 PL이 풀 수 있습니다."와, 그 사람의 Mac이 꺼짐이면 "(내 Mac: 꺼짐, 마지막 확인 N분 전)" | Office가 보내는 이유는 영어 원문이고 `team rerun` 같은 CLI 말이 섞여 있다. 원문은 지우지 않는다 |
| **쉬는 중의 말과 시각은 그 사람의 가장 새 Mac이 `limited`일 때만 보인다(꺼짐이면 보이지 않음).** detail `<실행기들>: <종류>`(묶음 1의 형식, 실행기는 `, `로 이음)를 읽는다: limit "AI 사용 한도라 쉬는 중입니다. {시각} 다시 시도합니다." / billing "AI 결제·크레딧 문제로 쉬는 중입니다. 결제를 확인하면 {시각} 다시 시도합니다." / login "Mac의 claude 로그인이 풀려 쉬는 중입니다. Mac 터미널에서 claude를 실행해 로그인하면 {시각} 다시 시도합니다." / not_ready "Mac의 AI 실행기({실행기들})가 준비되지 않아 쉬는 중입니다." / 읽을 수 없는 detail "쉬는 중입니다({detail})". `until`이 없으면 시각 조각은 "잠시 뒤"다. 내 할 일의 맡은 일과 Task 상세(맡은 사람 기준)에 보인다. 머리글 "내 Mac: 쉬는 중(한도)"는 그대로 둔다 | 설계 6: "사용 한도면 '한도라 쉬는 중, 언제 풀림'". Hub(OpenShift)의 시간대가 사람의 시간대와 다를 수 있어 상대 시각으로 쓴다 |
| **`until`은 프로토콜 4 하트비트의 선택 필드다.** Office는 열린 기록이 실행기 계정을 기다릴 때 그 `runnerWait.retryAt`을, 아니면 `null`을 보낸다. Hub는 숫자가 아니거나 음수·소수면 `INVALID`("다시 시도 시각이 올바르지 않습니다.")이고, 없거나 null이면 지운다. 예전 Hub는 본문의 모르는 키를 읽지 않으므로 새 Office와 같이 돈다 | 필드를 더하기만 해서 프로토콜 번호를 바꾸지 않는다 |
| **한 사람의 여러 repo 사이 순서는 지금 그대로다.** repo 하나 안에서는 Story 만든 순 → Task 번호 순, repo 사이는 그 사람 Office의 등록 순서다(ASSUMED, 한계로 기록) | Hub가 repo를 건너 가장 오래된 것을 고르면, 그 repo의 레인이 Office에서 준비 안 됨일 때 그 사람이 아무것도 못 받는다 |
| **화면은 저절로 새로 고치지 않는다.** 각 화면에 "새로 고침" 링크와 "마지막 소식 N분 전"(하트비트·갱신 시각)을 둔다(ASSUMED) | 스크립트 없이 하고, 메모를 쓰는 중에 화면이 바뀌면 글이 사라진다 |

## Review Focus

1. **Office가 실패 기록을 쥔 채 웹에서 다시 시도함(보통의 경우):** 다음 하트비트에서 옛 기록을 `NOT_YOURS`로 버리고, 다음 tick에서 새 claim을 되찾아 시도 0부터 돌며, 그 Task 읽기에 Hub의 마지막 실패와 메모가 있다. Hub에는 그 사람의 열린 Task가 하나뿐이다. Task 6 시험이 고정한다.
2. **두 번 누르기·겨루기:** 두 사람이 같은 Task를 작업하기 → 늦은 쪽은 `STATE`이고 아무것도 바뀌지 않는다. 같은 사람이 두 Task를 연달아 작업하기 → 둘째는 `BUSY`. 다시 시도 두 번 → 둘째는 `STATE`. 자동 claim과 작업하기가 겹치면 하나만 맡는다. Task 1 시험이 고정한다.
3. **맡은 채 스위치를 끔:** 맡은 Task는 계속 하트비트·보고를 받고, 끝난 뒤 `claimNext`는 아무것도 주지 않는다. 다시 켜면 다음 claim이 ready Task를 준다. Task 1(저장소)·Task 6(실제 스케줄러)이 고정한다.
4. **담당 repo인데 연결이 없음(clone 실패, 연결 해제, 이 Mac에 아직 없음):** 받을 수 있는 일에 그 Task가 보이지만 작업하기 버튼 대신 "이 레포는 아직 내 Mac에 연결되지 않았습니다"가 보이고, POST는 `NOT_LINKED`로 막힌다. 해제된 Mac이 만든 연결은 연결로 치지 않는다. Task 1·2·4·5 시험이 고정한다.
5. **믿을 수 없는 글:** Task 제목·설명·파일·요약·판단 기록·실패 이유·메모, Story 제목·본문, 사람·repo 이름은 새 화면 어디서나 이스케이프된다. 새 POST는 다른 Origin·CSRF 없음이면 403이다. 없는 id(`/tasks/<모르는 uuid>`)는 404 화면이다. Task 4·5 시험이 고정한다.

---

### Task 1: Hub 저장소 — 자동으로 일하기, 작업하기, 웹 다시 시도, 내 할 일

**Files:**
- Modify: `src/hub/story-store.ts`(SCHEMA, `claimNext`, `rerun`, `projects`·`stories`·`story`·`releaseTask`·`cancelTask`의 첫 인자, 새 메서드)
- Test: `tests/hub-story-work.test.mjs`(`tests/hub-story-fixture.mjs`의 `setup()`·`opened()`를 쓴다)

**Interfaces:**
- Consumes: `HubStore`의 표 `hub_repo_owners`·`hub_repos`·`hub_members`(같은 db).
- Produces(`src/hub/story-store.ts`):
  - `export type Actor = { member: Member }`(`Member`는 `./store.ts`)
  - `export type PickState = "yes" | "auto-on" | "not-linked" | "busy" | "no"`
    - 판정(`#pickState(memberId, task, linked)`): 작업 Task·`ready`·Story `open`·그 repo의 담당자가 아니면 `"no"` → 그 repo가 `linked`에 없으면 `"not-linked"` → 맡은 Task가 있으면 `"busy"` → 스위치가 켜져 있으면 `"auto-on"` → `"yes"`
  - `export type WorkCard = { taskId: string; number: number; kind: "work" | "verify"; title: string; repo: { id: string; name: string } | null; story: { id: string; number: number; title: string }; state: TaskViewState; stage: string | null; assignee: { id: string; name: string } | null; prUrl: string | null; failure: string | null; heartbeatAt: number | null; updatedAt: number; pick: PickState }`
    - `pick`은 `ready` 칸에서만 판정하고 나머지 칸은 `"no"`다.
  - `export type MemberWork = { autoWork: boolean; open: WorkCard | null; ready: WorkCard[]; led: WorkCard[]; done: WorkCard[] }`
  - `export type TaskActions = { pick: PickState; rerun: boolean; release: boolean; cancel: boolean }`
    - `rerun`: 맡은 사람이고 저장 상태 `failed`인 작업 Task
    - `release`: PL·관리자이고 보이는 상태가 held·failed
    - `cancel`: PL·관리자이고 끝나지 않은 작업 Task
  - `StoryBoard.autoWork(memberId: string): boolean`
  - `StoryBoard.setAutoWork(member: Member, on: boolean): { autoWork: boolean }`: `on`이 boolean이 아니면 `INVALID`("켜기 또는 끄기를 골라주세요.")
  - `StoryBoard.memberWork(memberId: string, linked: ReadonlySet<string>): MemberWork`
  - `StoryBoard.taskDetail(a: Actor, taskId: string): { story: StoryView; task: TaskView }`: 모르는 id는 `NOT_FOUND`("Task를 찾을 수 없습니다.")
  - `StoryBoard.taskActions(member: Member, taskId: string, linked: ReadonlySet<string>): TaskActions`
  - `StoryBoard.pickTask(member: Member, taskId: string, linked: ReadonlySet<string>): { ok: true }`
  - `StoryBoard.rerunTask(member: Member, taskId: string, memo: string): { ok: true }`
  - 첫 인자가 `Actor`로 바뀜: `projects(a)`, `stories(a, projectId)`, `story(a, storyId)`, `releaseTask(a, taskId)`, `cancelTask(a, taskId)`

- [ ] **Step 1: 실패하는 시험.**
  - "auto work is on with no row; off makes claimNext give nothing and openTaskOf stays null; on again gives the oldest ready Task": `setAutoWork(b, false)` → `autoWork(b.id)` false, `board.claimNext(linkOf(b, fe))` null. 다시 켜면 ready Task.
  - "turning auto work off keeps the open Task: its heartbeat and merged report still work" **[Review Focus 3]**
  - "auto work off does not stop the PL's claimVerify"
  - "pickTask claims the ready Task for the member with a new claim id and a picked event; inbox(link).mine names it" — `hub_task_events`에 `picked` 한 줄.
  - "pickTask refuses in order: unknown NOT_FOUND, waiting or verify or draft-Story STATE, not an owner FORBIDDEN, no live link NOT_LINKED, an open Task BUSY; nothing changes" — 각 경우 뒤 Task의 `state`·`claimed_by`가 그대로다.
  - "pickTask ignores the switch: a member with auto work on can pick"
  - "two members pick the same Task: the second gets STATE and the first keeps it; one member picking a second Task gets BUSY" **[Review Focus 2]**
  - "a claim and a pick of the same Task: whichever is first holds it and the other gets null or STATE" **[Review Focus 2]**
  - "rerunTask by the assignee turns the failed work Task claimed under a new claim id, stores the trimmed memo (empty → null) and a rerun event; taskForClaim with the new claim id carries lastFailure {reason, memo}"
  - "rerunTask: another member FORBIDDEN, a Task that is not failed STATE, a 2001-character memo INVALID, the Story verification Task STATE; a second rerun is STATE" **[Review Focus 2]**
  - "the link rerun still works and a web rerun after it is STATE" — 기존 `rerun(link, …)`과 규칙을 하나로 둔다(`#rerun`).
  - "memberWork: open is the member's claimed or failed Task; ready lists ready work Tasks of open Stories in the member's repos in claim order (at most 50); led lists held and failed Tasks of the member's Stories; done lists the member's merged Tasks newest first (at most 20)"
  - "memberWork pick: yes only with auto off, a linked repo and no open Task; auto-on, not-linked and busy otherwise" **[Review Focus 4]**
  - "taskActions: rerun for the assignee of a failed work Task; release for the PL and an admin on held or failed; cancel for the PL and an admin on unfinished work Tasks; none for others"
  - "releaseTask and cancelTask take {member} from the web like a link, with the same PL-or-admin rule"
  - "taskDetail returns the Story view and the Task; an unknown id is NOT_FOUND"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-story-work.test.mjs`
- [ ] **Step 3: 구현.** `hub_work_settings`는 SCHEMA에 `CREATE TABLE IF NOT EXISTS`로 더한다(옛 db도 그대로 열림). 쓰기는 모두 `transaction` 안이다. 오류 문구:
  - `pickTask`: `STATE` "지금 받을 수 있는 Task가 아닙니다. 화면을 새로 고쳐 상태를 확인하세요." / `FORBIDDEN` "이 레포의 담당자만 받을 수 있습니다." / `NOT_LINKED` "이 레포는 아직 내 Mac에 연결되지 않았습니다. 내 Mac 화면에서 연결 상태를 확인하세요." / `BUSY` "이미 맡은 Task가 있습니다. 그 Task가 끝나거나 PL이 풀어 준 뒤 고르세요."
  - `rerunTask`: 위 판정 표의 문구
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-story-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: let a member switch automatic work, pick a ready Task and rerun a failed one on the Hub`

### Task 2: Hub 저장소·Mac API — 쉬는 이유와 시각, 살아 있는 연결

**Files:**
- Modify: `src/hub/store.ts`(`#migrate`, `macHeartbeat`, 새 메서드), `src/hub/mac-api.ts`(하트비트의 `until`)
- Test: `tests/hub-store-mac.test.mjs`, `tests/hub-mac-api.test.mjs`(시험 추가)

**Interfaces:**
- Produces(`src/hub/store.ts`):
  - `export type MacWait = { kind: "limit" | "billing" | "login" | "not_ready" | "other"; runners: string[]; until: number | null; detail: string | null }`
  - `HubStore.macHeartbeat(m: MacAuth, state: string, detail: string | null, until: number | null = null): { ok: true }`
  - `HubStore.macWait(memberId: string): MacWait | null`: 가장 새 살아 있는 Mac이 `limited`일 때만(꺼짐 판정이면 null). detail을 `/^([a-z0-9_.-]+(?:, [a-z0-9_.-]+)*): (limit|billing|login|not_ready)$/`로 읽고, 정확히 `not_ready`면 실행기 없는 `not_ready`, 그 밖은 `other`다.
  - `HubStore.liveLinkRepos(memberId: string): Set<string>`: `link()`와 같은 조건(팀원 활성, 담당자, 연결 해제 안 됨, Mac 연결이면 그 Mac이 살아 있음)인 연결의 repo id.
- Produces(`src/hub/mac-api.ts`): `POST /api/mac/heartbeat` 본문 `{ state, detail?, until? }`. `until`이 있고 null이 아니면 숫자여야 한다(아니면 `INVALID` "until 숫자가 필요합니다.").

- [ ] **Step 1: 실패하는 시험.**
  - store: "macHeartbeat stores until and a beat without it clears it; a negative, fractional or non-number until is INVALID"
  - store: "macWait reads the newest live limited Mac: limit with runners [claude] and until; not_ready with runners from 'claude, codex: not_ready'; plain 'not_ready'; other for an unreadable detail; null when the Mac is off, idle or none"
  - store: "liveLinkRepos holds a connection-string link and a live Mac's link, but not a revoked link, a revoked Mac's link or a repo the member no longer owns" **[Review Focus 4]**
  - store: "an old hub.sqlite gains hub_macs.until"(이 버전 전 스키마로 만든 파일을 연다 — 묶음 1 `mac_id` 시험과 같은 방식)
  - api: "the heartbeat takes until as a number or null and refuses a string with INVALID; an old body without until still works"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-store-mac.test.mjs tests/hub-mac-api.test.mjs`
- [ ] **Step 3: 구현.** `#migrate`는 `hub_macs`에 `until INTEGER`가 없으면 `ALTER TABLE`로 더한다. `macHeartbeat`는 `until`을 검사해 함께 쓴다. `until` 검사 실패 문구: "다시 시도 시각이 올바르지 않습니다."
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-store*.test.mjs tests/hub-link.test.mjs tests/hub-mac-pages.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: keep when a limited Mac tries again and which repos a member's links reach`

### Task 3: Office — 하트비트에 다시 시도 시각 보내기

**Files:**
- Modify: `src/team/mac.ts`(`MacClient.heartbeat`), `src/team/mac-watch.ts`(`Presence`, `beat`), `src/team/office.ts`(`presenceOf`)
- Test: `tests/team-mac.test.mjs`, `tests/team-mac-watch.test.mjs`, `tests/team-office.test.mjs`(시험 추가·고침)

**Interfaces:**
- Consumes: Task 2의 하트비트 `until`.
- Produces:
  - `export type Presence = { state: MacState; detail: string | null; until: number | null }`(`mac-watch.ts`)
  - `MacClient.heartbeat(state: MacState, detail: string | null, until: number | null): Promise<void>`: 본문에 `until`을 늘 넣는다(없으면 null).
  - `presenceOf()`: 열린 기록이 계정을 기다리면(`waitingOf`) `until`은 그 기록의 `runnerWait.retryAt`, 그 밖은 null이다.

- [ ] **Step 1: 실패하는 시험.**
  - mac: "heartbeat sends state, detail and until; until null when not given"
  - watch: "beat passes the presence until to the Hub"
  - office: "presence of a record waiting on its runner's account carries the record's retryAt as until; other states carry null" — 묶음 1의 presence 시험에 `until`을 더한다.
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-mac.test.mjs tests/team-mac-watch.test.mjs tests/team-office.test.mjs`
- [ ] **Step 3: 구현.** 하트비트를 주입하는 기존 시험의 가짜 `heartbeat`은 세 번째 인자를 기록하게만 고친다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/team-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: tell the Hub when a Mac waiting on its runner tries again`

### Task 4: Hub 웹 — 내 할 일, 보드, Story, Task 상세

**Files:**
- Create: `src/hub/story-pages.ts`
- Modify: `src/hub/pages.ts`(`layout` 메뉴와 `Chrome.autoWork`, 요청 게시판 탭 주소), `src/hub/server.ts`(GET 경로)
- Modify(경로만): `tests/hub-server.test.mjs`, `tests/hub-decline-page.test.mjs`, `tests/hub-start-page.test.mjs`, `tests/hub-openshift-server.test.mjs` — 요청 게시판을 보던 `GET /`를 `GET /requests`로
- Test: `tests/hub-story-pages.test.mjs`(`startTestHub(t, { now })`; Story는 `store.pair(store.createLinkCode(…))`로 만든 연결로 `board.publishStory`·`openStory`)

**Interfaces:**
- Consumes: Task 1의 `memberWork`·`taskDetail`·`taskActions`·`projects`·`stories`·`story`·`autoWork`, Task 2의 `macWait`·`liveLinkRepos`, 기존 `macBadge`.
- Produces(`src/hub/story-pages.ts`):
  - `taskStateLabel(state: TaskViewState, stage: string | null): string`, `storyStateLabel(state: StoryState): string`(판정 표의 이름)
  - `plainFailure(reason: string, kind: "work" | "verify"): string`(판정 표의 문장)
  - `waitText(w: MacWait, now: number): string`, `inTime(until: number | null, now: number): string`(값 표의 상대 시각, `until` null은 "잠시 뒤")
  - `home(me: Member, csrf: string, w: MemberWork, o: { macNudge: boolean; wait: MacWait | null }, chrome: Chrome): string`
  - `workBoard(me: Member, rows: { project: ProjectView; stories: StorySummary[] }[], chrome: Chrome): string`
  - `storyPage(me: Member, s: StoryView, chrome: Chrome): string`
  - `taskPage(me: Member, csrf: string, d: { story: StoryView; task: TaskView }, o: { actions: TaskActions; wait: MacWait | null; assigneeMac: MacBadge | null }, chrome: Chrome): string`
  - `Chrome`에 `autoWork?: boolean`(false일 때만 머리글에 `<a class="pill" href="/">자동으로 일하기 꺼짐</a>`)
- 경로(`board`가 있을 때만, 없으면 Story 화면은 404이고 `/`는 요청 게시판):

  | 경로 | 화면 |
  |---|---|
  | `GET /` | 내 할 일 |
  | `GET /requests` | 요청 게시판(`view` 질의는 지금과 같음) |
  | `GET /board` | 프로젝트마다 Story 표(번호·제목·상태·머지/전체·멈춤·PL) |
  | `GET /stories/<uuid>` | Story 본문(`<pre>`), 상태, PL, repo별 Story base, Task 표(번호·레포·할 일·상태·맡은 사람·앞 Task·PR) |
  | `GET /tasks/<uuid>` | Task 상세 |

- 화면 내용:
  - **내 할 일:** 맨 위 자동으로 일하기 상태와 켜기/끄기 버튼(폼 `POST /me/auto-work`, `on`=`1`|`0`). 켜져 있으면 "켜져 있어 내 Mac이 받을 수 있는 일을 차례대로 가져갑니다." 꺼져 있으면 "꺼져 있어 새 일을 받지 않습니다. 아래에서 직접 고를 수 있습니다." 칸 넷(판정 표). 받을 수 있는 일의 `pick`: `yes` → [작업하기](폼 `POST /tasks/<id>/pick`), `not-linked` → "이 레포는 아직 내 Mac에 연결되지 않았습니다"(`/mac` 링크), `busy`·`auto-on` → 버튼 없음. 맡은 일에는 상태, 쉬는 중 문장(`wait`), 실패면 쉬운 말 이유와 "자세히·다시 시도" 링크. 비어 있는 칸은 한 줄 안내.
  - **Task 상세:** Story·Task 번호와 제목, 레포, 상태, 맡은 사람과 "마지막 소식 N분 전". 멈춤이면 판정 표의 문장(실패는 쉬운 말 + `<details><summary>자세한 이유</summary><pre>`), 쉬는 중이면 `waitText`. 결과: 3줄 요약 `<pre>`, 판단 기록 목록(`ASSUMED:`로 시작하는 줄은 `<b>`), PR 링크(`rel="noreferrer"`), 머지 커밋 앞 12자. 할 일 내용: 설명 `<pre>`, 만질 파일 목록, 앞 Task(번호마다 `/tasks/<id>` 링크와 상태). 마지막 메모. 버튼(Task 5가 받는 폼):
    - `actions.pick === "yes"` → [작업하기]. `auto-on`이면 "자동으로 일하기가 켜져 있어 내 Mac이 차례대로 가져갑니다."
    - `actions.rerun` → 메모 칸(`maxlength="2000"`, 선택) + [다시 시도]
    - `actions.release` → [풀기] + "풀면 이 Task는 다시 '할 일'이 되고 누구든 처음부터 다시 받습니다." 머지 잠금이 있으면 "머지 중이었을 수 있습니다."를 더한다
    - `actions.cancel` → `<label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label>` + [취소] + "취소하면 이 Task는 하지 않고, 뒤 Task는 이것 없이 진행합니다."
  - 모든 Story 화면에 "새로 고침" 링크.

- [ ] **Step 1: 실패하는 시험.**
  - "/ is the member's work page with the four sections, and the request board moved to /requests with its view tabs"
  - "a hub without a board keeps the request board at / and answers 404 for /board, /stories/<id> and /tasks/<id>"
  - "home shows the Mac nudge only when the hub installs Macs and the member has none" — OpenShift 모드 서버(`hub-mac-pages.test.mjs`의 `openshift`처럼)에 `board`를 넣어 띄운다.
  - "a ready Task shows 작업하기 only with auto work off, a live link and no open Task; not-linked says so and links /mac" **[Review Focus 4]**
  - "the header carries 자동으로 일하기 꺼짐 on every page only while auto work is off"
  - "the board lists projects with Story progress; the Story page lists every Task with its state word and stage"
  - "state words: ready 할 일, claimed with stage build 진행 중(구현), merge 머지 중, held 멈춤(Mac 소식 없음), failed 멈춤(실패), merged 완료" — `now`를 HELD_AFTER_MS 넘게 돌려 held를 만든다.
  - "a failed Task shows the plain reason for RUNNER_LIMIT, a closed PR, a conflict and the default, with the raw reason under 자세한 이유"
  - "a limited assignee Mac shows '사용 한도라 쉬는 중' with '약 25분 뒤' from until; an off Mac shows no wait text"
  - "a merged Task shows the summary, the decision lines with ASSUMED in bold and the PR link"
  - "buttons follow taskActions: the assignee sees 다시 시도 on a failed Task, the PL and an admin see 풀기 and 취소, another member sees none"
  - "untrusted text is escaped on the work, board, Story and Task pages" — `<img src=x onerror=…>`를 Task 제목·설명·파일·요약·판단 기록·실패 이유·메모, Story 제목·본문, 이름에 넣고 원문이 없음을 본다. **[Review Focus 5]**
  - "an unknown Task or Story id is a 404 page; the new pages load no script"
  - 순수 함수: "inTime says 곧, 약 25분 뒤, 약 2시간 뒤, 약 1시간 5분 뒤 and 잠시 뒤 for null", "plainFailure picks by prefix and falls back to the default"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-story-pages.test.mjs`
- [ ] **Step 3: 구현.** `server.ts`는 화면마다 `board.memberWork(me.id, store.liveLinkRepos(me.id))`처럼 저장소 값을 모아 `story-pages.ts`에 넘긴다. 저장소의 `HubError`(404 등)는 지금처럼 오류 화면이 된다. `chrome()`에 `autoWork: c.board?.autoWork(me.id)`를 더한다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: show the member's work, the Story board and Task details on the Hub web`

### Task 5: Hub 웹 — 버튼(자동으로 일하기, 작업하기, 다시 시도, 풀기, 취소)

**Files:**
- Modify: `src/hub/server.ts`(POST 경로)
- Test: `tests/hub-story-pages.test.mjs`(시험 추가)

**Interfaces:**
- Consumes: Task 1의 `setAutoWork`·`pickTask`·`rerunTask`·`releaseTask`·`cancelTask`, Task 2의 `liveLinkRepos`.
- 경로(`board`가 있을 때만, 모두 Origin·CSRF 검사):

  | 경로 | 본문 | 하는 일 | 다음 |
  |---|---|---|---|
  | `POST /me/auto-work` | `on`=`1`\|`0` | `setAutoWork(me, on === "1")`. 그 밖의 값은 `INVALID` | `/` |
  | `POST /tasks/<uuid>/pick` | — | `pickTask(me, id, store.liveLinkRepos(me.id))` | `/tasks/<id>` |
  | `POST /tasks/<uuid>/rerun` | `memo` | `rerunTask(me, id, memo)` | `/tasks/<id>` |
  | `POST /tasks/<uuid>/release` | — | `releaseTask({ member: me }, id)` | `/tasks/<id>` |
  | `POST /tasks/<uuid>/cancel` | `confirm`=`yes` | 없으면 `INVALID`, 있으면 `cancelTask({ member: me }, id)` | `/tasks/<id>` |

- [ ] **Step 1: 실패하는 시험.**
  - "switching auto work off and on from the web changes what claimNext gives"
  - "작업하기 from the web claims the Task for the member; the Task page then says 시작 중 and the member's inbox names it"
  - "작업하기 without a live link is a NOT_LINKED page and changes nothing" **[Review Focus 4]**
  - "다시 시도 from the web reruns the failed Task with the memo; a second click is a STATE page" **[Review Focus 2]**
  - "풀기 and 취소 work for the PL and an admin and are FORBIDDEN pages for others; 취소 without the confirm box is an INVALID page and the Task stays"
  - "every new POST is 403 from another origin or without the CSRF token" **[Review Focus 5]**
  - "an unknown Task id is a 404 page for every button"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-story-pages.test.mjs`
- [ ] **Step 3: 구현.** 경로는 지금 POST들처럼 `browser()` 안, CSRF 검사 뒤에 둔다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: switch automatic work, pick, rerun, release and cancel Tasks from the Hub web`

### Task 6: 웹에서 누른 것을 실제 Office 스케줄러가 가져가는지

**Files:**
- Test: `tests/hub-web-office.test.mjs`(`tests/team-fixture.mjs`의 `hubWithStory(t)`와 `cfgOf`, `storyLink`, `openTeamStore`, `createClaimScheduler` — `tests/team-executor.test.mjs`의 `world()`가 같은 짜임)
- Modify(시험이 빈틈을 찾았을 때만): `src/team/scheduler.ts`

**Interfaces:**
- Consumes: Task 1의 저장소 메서드(시험은 웹 대신 저장소를 바로 부른다. 웹 → 저장소는 Task 5가 고정한다).

- [ ] **Step 1: 시험.**
  - "a Task picked on the web is recovered by the member's scheduler at the next tick, even with the local pause on and auto work off, and its claim id is the Hub's"
  - "a web rerun of a failed Task: the next beat drops the failed record as NOT_YOURS, the next tick recovers the new claim at attempt 0, and the Task read carries the last failure and the memo; the Hub holds one open Task for the member" **[Review Focus 1]**
  - "with auto work off the scheduler's tick claims nothing and says no open Task; turned on, the next tick claims the oldest ready Task" **[Review Focus 3]**
  - "a PL release from the web drops the assignee's record at its next beat (NOT_YOURS)"
- [ ] **Step 2: 실행.** `node --experimental-vm-modules --test tests/hub-web-office.test.mjs`. 기대: 처음부터 통과(이 묶음은 Office를 바꾸지 않는다는 판정을 고정). 실패하면 그 원인을 판정 표의 근거와 함께 고치고, 고친 것을 이 Task의 커밋에 넣는다.
- [ ] **Step 3: 커밋.** `test: pin that a team Office takes what the Hub web did through its own recovery`

### Task 7: 문서와 검증 기록

**Files:**
- Modify: `docs/LOCAL-PREVIEW.md`(팀 허브 절에 "### 팀원 웹")
- Create: `docs/verification/2026-11-05-teammate-web.md`

- [ ] **Step 1: 사용 안내.** 내 할 일·보드·Task 상세에서 보이는 것, 자동으로 일하기(기본 켜짐, 끄면 맡은 일은 끝까지, 작업하기로 직접 고름), 다시 시도(메모, Mac이 1–2분 안에 가져감), 풀기·취소(PL·관리자), 쉬는 중 문장, 요청 게시판이 `/requests`로 옮긴 것, 한계(화면이 저절로 새로 고치지 않음, repo 사이 순서는 Mac의 등록 순서, Mac이 가져가지 않은 작업하기는 10분 뒤 멈춤).
- [ ] **Step 2: 검증 기록 뼈대.** 절: 만든 것(Task·커밋 표), 판정 적용(이 계획의 판정 표, 구현 중 바뀐 것), 자동 검사(X/X), 확인하지 않은 범위, **실제 확인 계획**(중간점검: 사내 OpenShift 허브 재배포 + 두 사람의 Mac. 묶음 1의 확인 목록에 이 묶음의 것 — 두 사람의 내 할 일에 겹치지 않게 배정, 스위치 끄기·켜기, 작업하기, 일부러 실패시킨 Task의 다시 시도와 메모, PL의 풀기·취소, 사용 한도 쉬는 중 문장과 시각, 요청 게시판 이동 — 을 더한다). "실제 확인 전에는 팀원에게 쓰라고 안내하지 않는다"를 적는다. **이 기록은 kit 리뷰를 시작하기 전에 끝내고, 그 뒤에는 고치지 않는다**(늦은 내용은 STATUS에 쓴다).
- [ ] **Step 3: 통과 확인.** 전체 `npm test` X/X, `npm run typecheck` exit 0, `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` exit 0.
- [ ] **Step 4: 커밋.** `docs: record the teammate web bundle`

STATUS 맨 위 항목은 G4 기록과 `graph.mjs delivery` 뒤에 전달 커밋에서 쓴다(kit 스냅샷이 STATUS를 덮는다).

---

## 결정 → Task

| 설계(D41) | 어디서 |
|---|---|
| 팀원 3: 첫 화면 내 할 일(맡은 일·진행 중·멈춤·끝난 것), 옆에 보드 | Task 1(`memberWork`), Task 4 |
| 팀원 4: 자동 배정(권한 있는 repo만·한 Task 한 사람·그래프 순서), 스위치(기본 켜짐, 끄면 새로 받지 않음), 끈 상태의 작업하기 | Task 1·5·6, 판정 표 |
| 팀원 5: 상태가 저절로 바뀜(할 일 → 진행 중 → 머지 중 → 완료), 3줄 요약·판단 기록·PR | Task 4 |
| 팀원 6: 멈춘 이유를 쉬운 말로, 다시 시도(메모), 사용 한도면 언제 풀리는지 | Task 1·2·3·4·5·6 |
| 팀원 7: 머리글 "내 Mac" | 묶음 1 그대로(Task 4는 꺼짐 스위치 표시만 더함) |
| PL 5: 멈춘 Task 풀기·취소를 웹 버튼으로 | Task 1·4·5 |
| 지키는 것: Hub는 먼저 연락하지 않음, 웹은 Hub 상태만 바꿈 | 판정 표(작업하기·다시 시도), Task 6 |

## 이 계획 밖

- PL의 웹 Story 작성·질문·G1·Task 나누기(묶음 3), Story 검증·G4·main 머지(묶음 4). 보드의 Story 취소 버튼도 묶음 3·4에서 정한다.
- 맡은 사람이 자기 Task를 반납하는 버튼, 알림, 화면 저절로 새로 고침, repo를 건너는 오래된 순 배정.
- 사내 OpenShift 허브 재배포와 두 사람 Mac 실제 확인은 네 묶음 뒤 중간점검에서 한다.
