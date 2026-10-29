# G3 proposal: 팀 Story 보드 (PL이 쪼개 올리고, 각자 Office가 가져가 실행)

Status: Approved
Understanding gate (G3): user conversation · 2026-10-22 · Check-in: accepted ("일단 해보지 뭐 이대로 승인", 설명 페이지 https://claude.ai/artifact/HDGp2jzgsQ8DSZ8huMG6Z3 확인 후)
Story: pazmo-agent-office-contract.md (M16; V18; D24)
Builds on: lean-office-decision.md (D23), team-hub-decision.md (D16). 대체: D16–D18·D22의 보내기·수락·거절 방식.

## 사용자 요청 (2026-10-21~22)

DingTalk 문서의 컨셉과 1차 피드백을 대화로 다듬었다.

- **Office를 쓰는 이유:** 실행 중이거나 쉬고 있는 agent와 내 Task의 전체 진행을 CLI가 아니라 화면으로 본다. "내가 사장님이 되어 여러 agent를 돌린다."
- **협업 목표:** 지금은 각자 로컬에서 Office를 돌린다. 목표는 Story → Task 여러 개 → 공유·분배다. 같은 Office를 쓰면 같은 workflow와 Story 템플릿이 적용되고, workflow를 같이 유지보수한다.
- **1차 피드백:**
  1. 수락·취소·거절을 없앤다. Office를 켜면 들어온 Task를 알아서 실행한다. 잘못된 Task라도 일단 작업하고 검증에서 고치는 편이 싸다.
  2. Task를 사람에게 보내지 않는다. PL이 Story를 만들고 Task로 쪼개(관련 repo는 모두 들고) 의존관계 그래프와 함께 Hub에 올린다. 팀원은 Office에서 올라온 Task를 알아서 가져간다. 한 사람이 다 가져가지 않는 장치가 필요하다(토큰, 업무 과중).

## 지금 상태 (조사 근거)

- **kit는 Task 그래프를 이미 만든다.**
  - planning 그래프(planner → review → validate-graph)가 Task와 의존관계를 내고 순환을 거부한다(`.ai-workflow/graph/planning-graph.mjs`).
  - 앞 Task가 모두 끝난 Task만 ready로 고른다(`scheduler.mjs:50`).
  - node 객체는 정해지지 않은 칸도 그대로 담는다(`task-graph.mjs`의 `{ ...node }`). 그래서 `repo`·`files`를 kit 수정 없이 실을 수 있다.
  - 한계: 한 그래프에서 쓰기 node는 한 번에 하나다(`scheduler.mjs:61`, 체크아웃 하나 가정). 지금까지 실제 run은 `implement` 하나가 M/V 전부를 덮는 굵은 그래프였다.
- **Hub:** 팀원·repo·repo 담당자·요청·배정이 있다. "요청당 살아 있는 배정 하나" 고유 인덱스(`src/hub/store.ts:133`)가 동시 수락을 막는다. 연결(`hub_links`)은 (팀원, repo) 단위이고 `last_seen`이 있다.
- **Office:** 프로젝트 하나에 묶여 있다(`src/cli/project.ts:73`). 엔진도 다른 프로젝트의 작업을 거부한다(`src/core/intake.ts:248`, `src/core/handoffs.ts:176`).
- **인도:** 결과를 로컬 폴더에 고정된 사본으로 저장하고 브랜치·PR을 만들지 않는다(`src/core/delivery.ts:92`). 사람 G4가 없으면 인도가 막힌다(`src/core/completion.ts:237`, `G4_REQUIRED`).
- **3줄 요약:** 모델이 아니라 작업 제목·바뀐 파일·검사 결과로 조립한다(`src/runtime/decision-summary.ts:45`). Hub로 보내는 장치가 이미 있다(`src/runtime/hub-snapshot.ts:71`).
- **git 호스팅:** eevee-be origin은 GitHub Enterprise(사내 GitHub Enterprise 호스트)다. 이 Mac에 `gh` 2.102.0이 있다.

## 사용자 결정 (2026-10-21~22 대화)

| 질문 | 선택 |
|---|---|
| Task를 받는 방식 | 보내기·수락·거절 대신, Hub에 올리고 각자 가져간다 |
| 뒤 Task 시작 시점 | 앞 Task가 머지된 뒤. 머지 대상은 Story base 브랜치다 |
| 그래프 저장 | Hub SQLite. 별도 GitHub repo는 만들지 않는다 |
| 브랜치 | 프로젝트 base에서 `feature/story-<N>/base`, 거기서 `feature/story-<N>/task-<M>`. Office 규칙으로 강제한다 |
| Task 머지 | subagent 리뷰와 workflow 검증을 통과하면 Story base에 자동 머지한다. Task별 사람 확인은 없다 |
| main/master 머지 | 사람이 base를 직접 테스트하고 머지한다. 피드백은 다시 Task로 올라온다 |
| G4 | Story 끝에 한 번. Task별 3줄 요약을 Story 단위로 모아 보여 준다 |
| 같은 파일을 만지는 Task | planning에서 순서를 정해 둔다 |
| 피드백 수정 | 같은 Story에 Task를 추가한다(A) |
| kit | 하나로 둔다. 협업용으로 따로 떼지 않는다 |
| 가져가는 기준 | 각자 담당하는 repo |
| repo 여러 개 | 한 사람이 Office 하나에 repo 여러 개를 등록한다(B) |
| Task 실행 시작점 | 구현부터. 질문은 agent가 판단하고 기록하며, base→main 때 본다 |
| push·머지 | VM 밖에서, 각자 PC의 git 로그인으로 |
| 가져간 사람이 사라짐 | 보류 상태로 둔다. 버리지 않는다. PL이 확인 후 처리한다 |
| 재시도 한도 초과 | 담당자와 PL에게 알린다. 담당자가 실패 원인을 보고 메모를 남겨 다시 실행한다 |
| 기존 기능·일정 | 신경 쓰지 않고 이번 구현에 집중한다 |
| 첫 화면 | 프로젝트(팀이 묶은 일) → Story → Task 칸반(B) |
| 한 사람이 다 가져가지 않는 장치 | 각자 Office의 [가져가기 멈춤] 스위치와 "하루 최대 N개" 설정. Hub에 나눠 주기 규칙은 넣지 않는다 |
| 진행 | "설계문서 작성해" (2026-10-22) |

## 용어

| 단어 | 뜻 |
|---|---|
| Hub | 팀이 같이 쓰는 서버. 게시판이며 코드를 실행하지 않는다 |
| Office | 각자 PC에서 돌리는 프로그램. Hub와 통신해 Task를 가져와 실행한다. 한 사람에 하나 |
| 엔진 | Office 안의 부품. repo 하나에 하나 |
| agent | 엔진이 VM 안에서 띄우는 codex·claude. 토큰을 쓰는 것은 이것뿐이다. Task의 repo 하나만 본다 |
| 프로젝트 | 팀이 묶은 일 단위(예: "쿠폰 개편"). repo 목록과 repo별 base 브랜치를 갖는다 |
| Story / Task | 프로젝트 안의 요구사항 / Story를 쪼갠 일 하나. Task는 repo 하나에 속한다 |
| PL | 그 Story를 올린 사람 |
| 담당자 | Task를 가져간 사람 |
| Story base | repo마다 있는 `feature/story-<N>/base`. Task 결과가 자동으로 모이는 곳 |
| 판단 기록 | agent가 질문 대신 스스로 정한 내용(`ASSUMED:` 줄) |

## 결정

### 1. 전체 흐름

1. PL의 Office가 관련 repo를 읽고 kit planning을 돌려 Story와 Task 그래프를 만든다.
2. PL이 한 번 승인하면(Story G1) Hub의 프로젝트에 올리고, repo마다 Story base를 만든다.
3. 팀원의 Office는 한가할 때 자기 담당 repo의 ready Task 하나를 가져간다.
4. Task는 구현 → 리뷰 → 검증을 거쳐 Task 브랜치로 push되고, Story base에 자동 머지된다.
5. 앞 Task가 모두 머지된 Task가 ready가 된다.
6. Task가 모두 머지되면 PL의 Office가 Story 검증을 돌리고, PL이 Story G4를 한다.
7. 사람이 base를 테스트하고 main/master에 직접 머지한다. 피드백은 같은 Story의 새 Task가 된다.

### 2. Hub 저장

- `hub_projects`: id, 이름, 만든 사람. `hub_project_repos`: 프로젝트, repo, base 브랜치 이름.
- `hub_stories`: id, 프로젝트, 번호, 제목, 본문(Story 계약), PL, 그래프 JSON, fingerprint, 상태(`open`·`verifying`·`awaiting_g4`·`done`·`cancelled`).
- `hub_story_tasks`: Story, node id, 번호, repo, 제목, 설명, 만질 파일 목록, 상태(`waiting`·`ready`·`claimed`·`held`·`failed`·`merged`·`cancelled`), 담당자, 시도 횟수, PR 주소, 머지 커밋, 3줄 요약, 판단 기록.
- `hub_task_events`: Task별 진행 기록.
- 번호는 Story와 Task가 Hub 전체에서 하나의 순번을 같이 쓴다(예: story-111, task-112). (내 판단: 사용자가 든 예시를 따름)
- 고유 규칙:
  - Task 하나에 살아 있는 담당자는 한 명이다.
  - 한 사람이 `claimed`·`held`로 가진 Task는 동시에 1개까지다.
- 그래프는 올린 뒤 바뀌지 않는다. 예외는 Task 추가(5장)다. 기존 node는 바꾸지 않고, 새 node와 그 의존관계만 붙인 뒤 fingerprint를 다시 계산한다.
- 모든 팀원이 모든 프로젝트·Story·Task를 본다. 코드와 diff는 Hub에 없고, PR 열람은 GitHub 권한을 따른다. (내 판단)

### 3. PL이 올리기

- PL의 Office에 관련 repo를 모두 등록한다. planning은 그 repo들의 읽기 전용 사본을 보고 돈다. 여러 repo를 읽으므로 토큰이 더 들지만 Story당 한 번이다.
- planning 결과의 Task마다 `repo`, `title`, 혼자 읽어도 되는 설명(할 일·Story M/V 참조·다른 Task와 맞출 인터페이스), `files`(만질 파일 예상), 의존관계, 검증 명령을 담는다.
  - 검증 명령은 지금 Lead 제안의 `verify-N.json`과 같은 형식이다(실행 명령, 시간 제한, Story V 참조).
  - 자동 머지를 막는 장치는 사실상 이 검증뿐이다. 그래서 PL이 Story G1에서 Task 설명과 함께 승인한다. 지금 "Lead 제안 → G1에서 검증 명령까지 승인" 규칙(`src/core/intake.ts`)을 Story 단위로 옮긴 것이다.
- 결정적 검사(이 검사를 통과해야 올릴 수 있다):
  - 순환이 없다(kit).
  - 모든 Task의 repo가 프로젝트에 속한다.
  - `files`가 비어 있지 않다.
  - 같은 repo에서 `files`가 겹치는 두 Task 사이에는 의존 경로가 있다. 없으면 거부하고 planner가 순서를 정해 다시 낸다.
  - kit가 이 검사를 넣기 전까지는 Office와 Hub가 직접 한다.
- PL이 그래프 미리보기(Task 설명·검증 명령 포함)를 보고 승인한다(Story G1). (내 판단: Task별 G1이 없어서 그 자리를 Story 한 번으로 옮김)
- 위험도는 PL이 Story G1에서 Story 단위로 정한다. `high`면 올리기 전에 Story 단위 G3 결정 문서를 PL이 승인한다(AGENTS.md "고위험은 G3 유지"). Task는 `high` Story 안에서도 자동 머지한다. (내 판단)
- 승인하면 PL의 git 로그인으로 repo마다 프로젝트 base에서 `feature/story-<N>/base`를 만들어 push한다. `feature/story-<N>` 자체는 만들지 않는다(git이 같은 이름의 브랜치와 폴더를 함께 못 가짐).
- 마지막 Task "Story 검증"을 자동으로 붙인다. 모든 Task에 의존하고, PL만 가져간다.

### 4. 팀원의 Office

- 한 사람이 Office 하나를 띄우고 repo 여러 개를 등록한다. repo마다 엔진이 따로 있고, 격리와 토큰은 지금처럼 repo 단위다.
- Office 안의 고르기 부분은 모든 repo를 통틀어 실행 중인 Task가 없을 때만, 담당하고 연결된 repo의 ready Task를 Hub에 요청한다. Hub는 한 명에게만 준다.
- ready Task가 여럿이면 오래된 Story부터, 같은 Story 안에서는 번호 순으로 고른다. (내 판단)
- **가져가기 상한 (사용자 결정):** "동시에 1개"는 동시에 도는 수만 막는다. 총량은 각자 조절한다.
  - **[가져가기 멈춤] 스위치:** 켜 두면 새 Task를 가져가지 않는다. 진행 중인 Task는 끝까지 한다.
  - **"하루 최대 N개":** 오늘(그 PC의 날짜 기준) 가져간 Task가 N개가 되면 그날은 더 가져가지 않는다. 다시 실행은 새로 가져가는 것으로 세지 않는다. (세는 방식: 내 판단)
  - Hub는 이 설정을 모른다. 나눠 주기 규칙(덜 맡은 사람 먼저 등)은 넣지 않는다.
  - 상태줄에 "가져가기 멈춤" 또는 "오늘 3/5"가 보인다.
- 켤 때 repo마다 `gh auth status --hostname <호스트>`를 확인한다. 안 되면 그 repo의 Task는 가져가지 않고 로그인 방법을 안내한다. (내 판단)
- Office는 지금처럼 `127.0.0.1`에만 열리고, Hub로 나가는 연결만 쓴다.

### 5. Task 실행 (Story Task 모드)

- **작업 공간:** 최신 `feature/story-<N>/base`를 받아 `feature/story-<N>/task-<M>`을 만들고, 그 사본을 VM에 넣는다. agent는 이 repo만 본다.
- **단계:** 구현(작업 실행기) → 리뷰(리뷰 실행기) → 검증. 기획·설계 단계와 Task별 G1·G4는 없다.
- **agent가 받는 것:** Story 본문, Task 설명, 앞 Task들의 판단 기록. 다시 실행할 때는 직전 실패 기록과 담당자 메모도 받는다. (앞 Task 판단 기록: 내 판단)
- **질문:** agent가 스스로 정하고 `ASSUMED:` 줄로 남긴다. 이 줄들이 판단 기록이 된다.
- **검증을 통과한 뒤 (VM 밖, 내 PC의 git 로그인):**
  1. 검증된 사본을 Task 브랜치에 커밋하고 push한다. 커밋 작성자는 그 사람의 git 설정이다.
  2. `gh`로 Story base를 향한 PR을 연다.
  3. 최신 Story base를 Task 브랜치에 합친다. base가 바뀌었으면 합친 결과로 검증을 다시 돈다.
  4. 충돌하거나 재검증에 실패하면 시도 횟수를 늘리고 구현부터 다시 돈다.
  5. 통과하면 `gh`로 PR을 머지한다(머지 커밋).
- **다시 실행은 같은 Task 브랜치 위에서 한다.** 최신 base를 합친 Task 브랜치 끝에서 구현을 다시 돌리고 새 커밋을 더한다. 브랜치 이름과 PR은 그대로이고 강제 push는 없다. (내 판단: 사용자가 정한 브랜치 이름과 강제 push 금지를 같이 지키는 유일한 방법)
- **`files`는 참고용 예상이다.** 수정 범위를 막지 않는다. 작업 공간 범위는 repo 전체다. 대신 같은 Story·같은 repo에서는 3~5단계("최신 base 합치기 → 재검증 → 머지")를 Hub 잠금으로 한 번에 하나만 한다. 동시에 머지된 두 Task가 합쳐서 깨지는 일을 막기 위해서다. (내 판단)
- **push 허용 범위:** `feature/story-<N>/task-<M>`과 그 Story base로의 PR 머지만 한다. 다른 ref push와 강제 push는 하지 않는다.
- **Hub에 보고:** PR 주소, 머지 커밋, 3줄 요약, 판단 기록. 3줄 요약은 G4 질문이 아니라 Task 완료 시점에 만든다. 판단 기록은 글자만, 길이 제한을 둔다.
- Hub가 `merged`로 바꾸면, 앞 Task가 모두 머지된 Task가 `ready`가 된다.

### 6. 실패와 보류

- **재시도 한도 초과:** Task가 `failed`가 되고 담당자와 PL의 Decisions에 뜬다. 담당자가 실패 원인을 보고 메모를 남기면 구현부터 다시 돈다. 그동안 뒤 Task는 막힌다(kit `blockedNodeIds`).
- **연결 끊김:** 하트비트가 끊기면 Hub가 Task를 `held`로 표시하고 "마지막 연결 N분 전"을 보인다. 자동으로 풀지 않는다.
  - 하트비트가 10분 끊기면 보류로 본다. (내 판단)
  - PL은 보류 Task를 **풀기**(ready로 되돌려 다른 사람이 가져감)하거나 **취소**한다.
  - 원래 담당자가 돌아왔을 때 여전히 그 사람 Task면 이어서 한다. PL이 이미 풀었으면 Hub가 "이제 당신 Task가 아님"을 알리고, 그 Office는 멈추고 로컬 run을 버린다. (내 판단)
- 알림은 각자 Office의 Decisions에 뜬다. 메신저 연동은 하지 않는다. (내 판단)

### 7. Story 마무리

- 모든 Task가 머지되면 "Story 검증"이 ready가 되고 PL의 Office가 가져간다.
- PL의 Office는 repo별 Story base의 읽기 전용 사본으로 Story의 Verify를 돌린다.
- 그 결과로 PL의 Decisions에 Story G4가 뜬다. Story 본문, Task별 3줄 요약, 판단 기록 전부, 검증 결과, PR 주소, Story base 이름을 한 화면에 보인다.
- Story 검증이 실패하면 G4를 열지 않는다. PL의 Decisions에 실패 내용을 알리고, PL이 수정 Task를 추가한다(피드백과 같은 길). 그 Task가 머지되면 Story 검증이 다시 돈다. (내 판단: 이 검증은 코드를 바꾸지 않아서, 그냥 다시 돌리면 결과가 같음)
- PL이 G4에 답하면 Story가 `done`이 된다. base → main/master 머지는 사람이 Office 밖에서 한다. Office는 main/master를 건드리지 않는다.
- 피드백이 있으면 PL이 같은 Story에 Task를 추가한다. 새 Task는 같은 base에서 갈라지고, 머지가 끝나면 Story 검증과 Story G4가 다시 열린다.

### 8. 화면 (lean Office 위에)

- **상단 상태줄:** 모든 화면에서 내 agent 상태(repo · Task · 단계 · 경과 시간), Decisions 수, 보류 수, 가져가기 상태(멈춤 또는 "오늘 3/5")를 보인다. [가져가기 멈춤] 스위치도 여기 있다.
- **프로젝트 목록:** 이름, repo, 진행 중 Story 수, 내 Task 수, 보류 수.
- **Story 목록:** 진행(머지 수/전체).
- **Story 칸반:** 열은 앞 Task 기다림 · 준비 · 진행 · 보류 · base에 머지됨이다. `failed`는 보류 열에 "실패" 표시로 둔다. (내 판단) 카드에는 repo, 제목, 담당자, 단계, 판단 기록 수가 보인다.
- **Task 상세:**
  - 설명, 진행 기록, PR 주소, 3줄 요약, 판단 기록을 보인다.
  - 담당자에게는 실패 원인과 [메모 남기고 다시 실행]이 보인다.
  - PL에게는 보류 Task의 [풀기]·[취소]가 보인다.
- **PL 화면:** 새 Story(planning 실행 → 그래프 미리보기 → 승인 후 올리기), Task 추가, Story G4는 Decisions에서 한다.
- 확인은 화면 안에서 하고, 브라우저 기본 대화상자는 쓰지 않는다(지금 규칙).

### 9. kit 쪽 (kit 담당 세션에 요청. 이 Story는 kit 원본을 고치지 않는다, O2)

- task-graph node의 공식 칸 `repo`·`files`
- validate-graph에 "같은 repo에서 파일이 겹치는데 순서 없는 Task 쌍 거부"
- G4를 Story 끝 한 번에 두는 옵션

kit가 넣기 전까지는 node의 추가 칸과 Office·Hub의 자체 검사로 동작한다. 그래서 이 구현이 kit 변경을 기다리지 않는다.

## 바뀌는 기존 규칙

| 기존 | 바뀜 |
|---|---|
| Domain 불변 조건: "사람의 승인과 같은 candidate의 검증 없이 완료·merge하지 않는다" | Story Task는 같은 candidate의 리뷰·검증 통과로 Story base에 머지한다. 사람 승인은 Story G4와 main/master 머지에서 한다 |
| D2 "기본 인도는 로컬", D11·V8 "자동 병합 금지" | Story Task는 `feature/story-<N>/*` 브랜치에만 push·자동 머지한다. main/master 자동 병합 금지는 그대로다 |
| O1 "회사 데이터 쓰기" 제외 | 팀 repo의 `feature/story-<N>/*` 브랜치 push와 PR은 이 기능의 목적이라 예외로 둔다. main/master, 다른 ref, 강제 push는 계속 제외한다 |
| M3 작업마다 PM → Lead → Engineer → Reviewer | Story Task는 구현부터 시작한다. 기획·설계는 PL의 Story planning에서 한 번 한다 |
| D16·D17·D18·D22 보내기·수락·거절·취소 | 이 결정으로 대체한다. 기존 코드는 당장 지우지 않지만 더 맞추지 않는다 |
| D16 "G4는 맡은 사람" | Story G4는 PL이 한다 |

## 구현 단계 (이 G3 하나로 승인, 단계마다 자동 시험)

1. **Hub:** 프로젝트, Story, Task 그래프 저장과 검사, 가져가기 경쟁, 사람당 1개, 담당 repo만, 보류·풀기·돌아옴 거부, Task 추가, 순번, 새 연결 API.
2. **Office 여러 repo:** 사람당 Office 하나, repo별 엔진, 전체에서 한 번에 하나, `gh` 확인, 가져오기, 가져가기 멈춤·하루 상한.
3. **Story Task 모드:** 구현부터, 판단 기록 수집, Task G4 없이 완료, 브랜치 규칙, push·PR·최신 base 재검증·자동 머지, 완료 시 3줄 요약.
4. **PL:** 여러 repo planning, 올리기 전 검사·Story G1, Story base 만들기, Story 검증·Story G4, Task 추가.
5. **화면:** 상단 상태줄, 프로젝트 → Story → 칸반, Task 상세, 실패·보류 처리.

## 실패 처리

| 상황 | 동작 |
|---|---|
| `gh` 로그인이 안 됨 | 그 repo Task는 가져가지 않고 로그인 방법을 안내한다 |
| 두 사람이 동시에 가져감 | Hub가 한 명만 성공시킨다 |
| 그래프 검사 실패(순환, 겹침 순서 없음, 프로젝트 밖 repo, 빈 `files`) | 올리기를 거부하고 이유를 보인다 |
| push 거부(권한 없음, 보호 브랜치) | Task를 `failed`로 하고 이유와 함께 담당자·PL에게 알린다 |
| 최신 base와 충돌, 재검증 실패 | 시도 횟수를 늘리고 구현부터 다시 돈다 |
| 재시도 한도 초과 | `failed`, 알림, 담당자 메모 후 다시 실행 |
| 하트비트 끊김 | `held`로 표시하고, PL이 풀거나 취소한다 |
| PL이 푼 뒤 원래 담당자가 돌아옴 | Hub가 거부하고, 그 Office는 멈춘 뒤 로컬 run을 버린다 |
| Hub가 끊긴 동안 Task 완료 | 결과를 쌓아 두었다가 다시 보낸다(지금 hub-link 방식) |
| PR은 머지됐는데 Hub 보고 실패 | 같은 PR 주소·머지 커밋으로 다시 보낸다. Hub는 중복을 한 번으로 처리한다 |
| 같은 Story·같은 repo의 두 Task가 동시에 머지 단계에 옴 | Hub 잠금으로 한 Task씩 "최신 base 합치기 → 재검증 → 머지"를 한다 |
| Story 검증 실패 | G4를 열지 않고 PL에게 알린다. PL이 수정 Task를 추가한다 |
| Story 취소 | 진행 중 Task를 멈춘다. 브랜치는 지우지 않는다 |

## 위험과 받아들인 비용

- **사람이 보기 전에 agent 코드가 원격 브랜치에 올라간다.** repo가 브랜치 push마다 CI를 돌리면, agent 코드가 사람 검토 전에 CI에서 실행된다. Story base는 main/master가 아니다.
- **Hub가 Story 계획과 진행의 유일한 원본이 된다.** Fusion PVC 백업이 필요하다.
- **Hub에 새로 올라가는 내용:** Story 본문, Task 설명, 3줄 요약, 판단 기록, PR 주소. 코드, diff 원문, 로그인 정보, 검증 증거 원문은 올라가지 않는다.
- **위쪽 Task의 판단이 틀리면 아래 Task를 다시 해야 한다.** 각자의 구독 토큰을 쓴다. Story G4 전에는 사람이 보지 않는다.
- **Story base가 오래 살수록 main과 멀어진다.** Story는 1~2주 안에 끝나는 크기로 잡는다.
- **planner가 예상한 `files`가 틀릴 수 있다.** 머지 직전 재검증이 안전망이다.

## 구현자에게 맡기는 것

- Hub 표의 정확한 칸 이름과 연결 API 경로·버전 번호
- 여러 repo Office의 데이터 폴더·시작 잠금 구조와, Hub 연결을 repo별로 둘지 사람 하나로 둘지
- Task 실행 때 kit가 읽을 Story·Task 파일을 만드는 방식(Hub Story 본문을 run에 넣는 법)
- 하트비트 주기, 판단 기록 길이 제한, 재시도 한도 값(kit 기본값 우선)
- lean Office의 기존 개인 작업(새 작업)은 그대로 두되 더 다듬지 않는다

## 검증 (V18)

- **자동 시험:**
  - Hub: 저장, 그래프 검사 거부, 가져가기 경쟁, 사람당 1개, 담당 repo만, 보류·풀기·돌아옴 거부, Task 추가, 순번, 중복 보고
  - Office: 여러 repo 등록, repo별 엔진, 한 번에 하나, `gh` 확인, 가져가기 멈춤, 하루 최대 N개(다시 실행은 세지 않음)
  - Story Task 모드: 구현부터, Task G4 없이 완료, 판단 기록 수집, 브랜치 이름 규칙, 허용 밖 ref push 거부, 최신 base 재검증·충돌 시 재실행, 완료 시 3줄 요약
  - PL: Story G1, Story 검증은 PL만, Story G4 모음
  - 화면: 기본 대화상자 없음, 이스케이프
  - git 시험은 로컬 bare repo로 하고, `gh`는 가짜 실행 파일로 대신한다
- **실제 확인:** Office 두 개(PL·팀원)와 시험 repo 두 개(be·fe 역할)로 Story 하나(Task 3개, 의존 1개)를 돌린다. 올리기 → 가져가기 → 자동 머지 → 뒤 Task ready → Story 검증 → Story G4까지 확인한다. 이후 피드백 Task 하나를 추가해 다시 돈다. 다른 사람 PC 확인 전에는 다중 PC 검증 완료로 보고하지 않는다.
