# 브라우저 팀 흐름 묶음 3 (PL 기획) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PL이 Hub 웹의 **[새 Story]**에 하고 싶은 일을 글로 적으면, PL Mac의 팀 Office가 프로젝트의 repo들을 읽고 AI(PM)로 묻고 kit 템플릿 초안을 쓴다. PL이 웹에서 답하고 **G1**(높은 위험이면 **G3**도)을 승인하면 AI(Lead)가 repo별 Task로 나누고, M/V 커버리지(D35 P5)를 검사해 Hub에 올리고, repo마다 `feature/story-<N>/base`를 만든 뒤 Story를 연다. 팀원의 Office는 지금처럼 그 Task를 가져간다.

**Architecture:**
- **Hub(정본):** 새 `PlanBoard`(`src/hub/plan-store.ts`)가 기획 하나의 상태 기계와 다시 시작에 필요한 모든 것(글, 위험도, 질문·답, 초안, 고쳐 쓰기 메모, 설계, 승인, 실패, Story id)을 갖는다. 웹(`src/hub/plan-pages.ts`)은 이 기록만 바꾼다. Office는 프로토콜 3 연결의 새 경로 셋(`plan-next`·`plan-heartbeat`·`plan-result`)으로 일을 빌려(lease) 한 단계를 하고, 읽은 revision과 함께 결과를 보낸다. revision이 다르면 409 `STALE`이고 아무것도 바뀌지 않는다.
- **PL의 팀 Office:** 새 `createPlanner`(`src/team/planner.ts`)가 claim tick(30000 ms)마다 Task보다 먼저 기획 일을 묻는다. 모델 실행은 기존 PM/Lead 역할 프로필과 `planningPrompt`에 팀 블록을 더해, repo 엔진 하나의 실행 자리(`planTurn`, verify와 같은 단독 자리)에서 돌린다. 그래서 공유 한-실행 gate가 Task 실행과 기획을 겹치지 않게 한다. 입력은 프로젝트 repo마다 폴더 하나인 읽기 전용 candidate 하나다. 올리기는 기존 `publishStory`·`openStory` 경로를 PL의 연결로 부르고, Story base는 `branch.ts`의 새 보호된 push로 만든다. kit G1·G3 기록은 `<root>/team/plans/<planId>/`에만 남긴다.
- **바뀌지 않는 것:** 단일 Office 기획(`IntakeLedger`·`PlanningCoordinator`·`KitPlanning`·역할 프로필과 `upstream/skills.lock.json`), Story Task 실행(`writeStoryContract`·`submitStoryTask`), 프로토콜 1–4의 기존 경로·필드, 묶음 1·2 동작.

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행), npm 의존성 0, 서버가 만드는 HTML(스크립트 없음), 호스트 git은 `branch.ts`의 `git()`로만.

**Spec:**
- `docs/understanding/hub-web-team-flow-decision.md`(G3 2026-11-04)의 "### PL" 1–4, "## 정한 것과 만드는 사람에게 맡기는 것", 묶음 3 행. Story `docs/understanding/pazmo-agent-office-contract.md`의 D35(P1·P5), D41, M16, V19.
- 컨트롤러 판정 R1–R10(2026-11-05). 아래 판정 표에 이유·틀리면 드는 비용과 함께 옮겼고, 실질을 바꾼 곳은 "판정과 다르게 한 것"에 적었다.

## Global Constraints

- **작업 위치:** worktree `.worktrees/pl-planning`, 브랜치 `feat/pl-planning`(시작 3e23810 = origin/main). 부모 체크아웃으로 `cd`하지 않는다. push는 PR 때만. kit 실행 `.ai-workflow/runs/U38-pl-planning.json`(main에서 U38이 비어 있음을 3e23810에서 확인, 머지 전에 다시 확인). 새 D 번호는 쓰지 않는다(Story 변경 없음).
- **Node 24:** `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:$PATH"`. 시험은 `node --experimental-vm-modules --test <파일>`. 전체 `npm test`는 한 번에 하나만(다른 세션 포함, `pgrep -fl -- "--test"`로 확인). 새 npm 의존성 없음.
- **더하기만 한다:** 아래는 바뀌지 않고 기존 시험이 그대로 통과해야 한다. 각 Task의 "더하기만" 줄이 어떻게 지키는지 말한다.
  - 프로토콜 1·2·3·4의 기존 경로와 필드, `/api/mac/*`, 연결 문자열, CLI(`team *`, `start --team`, `mac *`, `./office`).
  - 링크 API의 `projects`·`publish`·`open`·`cancel`·`claim` 등 기존 Story 경로의 판정과 응답(권한 검사를 더하지 않는다).
  - 단일 Office의 기획과 G1(`IntakeLedger`, `PlanningCoordinator`, `KitPlanning`, `assets/roles/*.md`, `upstream/skills.lock.json`).
  - Story Task 실행: 계약은 늘 `risk: "normal"`(`story-contract.ts:119`), 엔진의 거절(`native-office.ts:1333`)도 그대로.
  - 묶음 1(Mac 연결·하트비트)과 묶음 2(내 할 일·보드·Task 버튼)의 동작. 보드·내 할 일에는 칸을 더하기만 한다.
- **화면:** 쉬운 한국어(묶음 2 문구 규칙). 새 `<script>` 없음(CSP 그대로). 모든 값은 `esc()`. 모든 새 POST는 지금의 Origin·CSRF 검사를 거치고 POST-redirect-GET(303)이다.
- **공개 레포:** 사내 호스트·조직·repo 이름을 커밋하지 않는다. 시험 repo는 `app-be`·`app-fe`, 원격은 `github.example.com/team/<이름>`.
- **원격 쓰기:** 새 쓰기는 `feature/story-<N>/base` 만들기 하나(D41). 강제 push·브랜치 삭제·다른 ref push는 없다.
- **값:**

  | 항목 | 값 |
  |---|---|
  | 하고 싶은 일(글) | 앞뒤 공백 제거 뒤 1자 이상, UTF-8 65536바이트 이하, NUL 없음 |
  | 새 Story·답 POST 읽기 한도 | 1 MiB(`PLAN_FORM_LIMIT`). 그 밖의 POST는 `FORM_LIMIT`(64 KiB) 그대로 |
  | Story 제목 | 앞뒤 공백 제거 뒤 1–200자(`LIMITS.titleMax`) |
  | 질문 | 한 번에 1–3개, id `Q1`–`Q3`, 글·이유 각 1000자 이하. 질문 차례는 기획마다 5번까지(ASSUMED) |
  | 답·고쳐 쓰기 메모 | 앞뒤 공백 제거 뒤 1–4000자 |
  | 초안 글 | UTF-8 32256바이트 이하(= `storyBodyBytes` 32768 − 512, 승인 줄이 들어갈 자리) |
  | 초안 구조(JSON) | 65536바이트 이하 |
  | 설계 글 / 나눈 결과(JSON) | 16384바이트 이하 / 524288바이트 이하 |
  | 실패 이유 | 1–4000자(`LIMITS.failureReasonMax`) |
  | 빌림(lease) | 하트비트 60000 ms, 600000 ms 동안 하트비트가 없으면 끝남. 사람마다 하나 |
  | Office 확인 주기 | claim tick 30000 ms(`CLAIM_MS`)와 같음 |
  | Lead Task 상한 | 작업 Task 1–20개(ASSUMED, Hub는 40), Task마다 검사 1–8개, 파일 1–50개(경로 300자 이하) |
  | 입력 candidate | 모든 repo 합쳐 파일 10000개·100 MiB 이하(`freezeCandidate` 기본값) |
  | 내 할 일 "내가 쓰는 Story" | 끝나지 않은 내 기획, 최근 바뀐 것부터 20개까지 |
  | Hub Story 올리기 키 | `plan:<planId>`(PL·키당 하나, `publishStory`의 기존 멱등) |
  | 기획 폴더(Office) | `<root>/team/plans/<planId>/`(`candidate.json`, `candidates/`, `story.md`, `g1.json`, `design.md`, `g3.json`, `bases.json`) |

- **새 오류 코드:** Hub `STALE` 409(revision·빌림이 맞지 않음), `OPEN_BLOCKING` 409, `PLAN_GONE` 404(연결 경로에서 기획이나 빌림이 이제 없음. 경로가 없는 옛 Hub의 코드 없는 404와 구분한다, F11). Office `SPLIT_REFUSED`, `BASE_EXISTS`, `PLAN_GATE`(승인 확인 실패, F7). 그 밖은 기존 `NOT_FOUND` 404, `FORBIDDEN` 403, `STATE` 409, `NOT_YOURS` 409, `INVALID` 400, `PUSH_REFUSED`. 구현이 더한 Office 안의 코드 `BASES_CHANGED`(`bases.json`을 읽을 수 없음), `HUB_NOT_NOW`(나누기 중 Hub 호출이 지금 안 됨, 같은 빌림으로 다시), `DESIGN_TOO_LONG`(설계가 16384바이트를 넘어 Lead에게 한 번 더)는 PL이 보는 첫 줄에 나오지 않는다. 첫 줄은 늘 쉬운 말이다.
- **kit·검증:** 검증 기록 `docs/verification/2026-11-05-pl-planning.md`와 `docs/STATUS.md`는 kit 노드 증거로 적지 않는다. 검증 기록은 kit 리뷰를 시작하기 전에 끝내고 그 뒤 고치지 않는다. STATUS 항목은 G4와 `graph.mjs delivery` 뒤에 컨트롤러가 쓴다(Task가 쓰지 않는다).

## 판정 (설계가 맡긴 것, R1–R10과 이 계획이 정한 것)

| 판정 | 이유 | 틀리면 드는 비용 |
|---|---|---|
| **R1 기획 기록은 Hub의 `PlanBoard`가 정본이다.** 새 표 `hub_plans`·`hub_plan_events`(`CREATE TABLE IF NOT EXISTS`, `hub_stories`는 손대지 않음). 상태: `queued`(Office 일: 처음, 답 뒤, 고쳐 쓰기 뒤, 다시 시도 뒤) → `questions` → `draft` → 높은 위험이면 `design` → `awaiting_g3` → `splitting` → `open`, 아무 데서나 `failed`·`cancelled`. Office 일이 있는 상태는 `queued`·`design`·`splitting`이고, 빌림이 살아 있으면 화면은 "기획 중"·"설계 중"·"나누는 중"이다. 모든 변경은 revision을 1 올린다 | Hub는 먼저 연락하지 못하고 PL Mac은 꺼질 수 있다. 어느 Mac이든 Hub 기록만으로 이어야 한다. `hub_stories`는 번호·그래프가 NOT NULL이고 CHECK를 바꿀 수 없다 | Office에 상태를 두면 재설치·새 Mac에서 대화가 사라진다. 표를 나중에 다시 짜면 옮기기가 필요하다 |
| **R2 번호는 올릴 때 받는다.** G1(높으면 G3) 뒤 Office가 Lead 나누기 → P5 → `publishStory`(키 `plan:<planId>`, Story는 `draft`) → Story가 쓰는 repo마다 Story base → `openStory` → 결과 `open`. 열기 전 실패는 Hub Story를 `draft`로 두고 기획은 `failed`, 다시 시도는 같은 Story로 이어 간다 | Story base 이름에만 번호가 필요하다. base 없이 열면 팀원 첫 시도가 `fetchTip`에서 실패한다 | 접수 때 번호를 받으면 버린 기획이 번호를 먹는다(보기만 나쁨). base 전에 열면 팀원의 시도가 헛돈다 |
| **R3 전달은 프로토콜 3 연결의 새 경로다.** `POST /api/link/story/plan-next`·`plan-heartbeat`·`plan-result`. PL의 어느 repo 연결로도 사람으로 인증된다. 하트비트 60000 ms, 600000 ms 무소식이면 빌림이 끝난다. 사람마다 빌림 하나. Task claim 자리(`hub_one_open_task`)는 쓰지 않는다 | 연결 문자열 Office도 돼야 하고, Mac 토큰은 묶음 1로 연결한 Mac만 있다 | Mac 토큰 길로 바꾸면 경로를 두 벌 둔다 |
| **R4 PL Office의 기획 운전자는 claim tick에 돈다.** 첫 준비된 레인의 연결로 `plan-next`를 묻는다. live이고 실행기가 준비됐고 열린 Task 기록이 없고 gate가 비었을 때만. 같은 tick에서 기획을 먼저 묻고, 한 단계를 했으면 그 tick의 Task claim(되찾기 포함)은 하지 않는다. 모델 실행은 엔진의 단독 실행 자리(`planTurn`)라 gate가 Task 실행과 겹치지 않게 한다. 단계 동안 Mac 상태는 `working`이다. `team pause`·하루 상한은 기획에 적용하지 않는다(ASSUMED) | 한 사람 한 번에 하나(M16). PL이 웹에서 기다리는 대화형 일이라 먼저 한다 | 겹치면 Task의 git 단계와 기획의 fetch·push가 같은 체크아웃에서 부딪친다 |
| **R5 입력과 역할:** 새 실행기 없이 기존 `ContainerPlanner`(읽기 전용 VM), `planning.ts`의 프롬프트·검사기, 고정된 PM/Lead 역할 프로필을 쓰고 팀 묶음(`packet.team`)을 더한다. 입력은 repo마다 폴더 하나인 candidate 하나(PL Office 자기 체크아웃에서 기준 브랜치 tip을 받아 풀고, 사람의 폴더는 건드리지 않음). 모든 프로젝트 repo가 PL Office에 준비돼 있어야 하고, 없으면 그 repo 이름을 쉬운 말로 적고 실패한다. `IntakeLedger`와 로컬 화면은 쓰지 않는다. PM 출력에 `openBlocking`(0–3개)을 더하고, 비어 있지 않으면 초안 대신 질문 차례가 된다. Lead 출력에 Task마다 `repo`·`files`·`after`, 전체에 repo별 `storyVerify`를 더한다. P5와 Hub 자신의 그래프 검사(`validateGraph`·`validateStoryVerify`)를 올리기 전에 Office에서 돌리고, 거절되면 이유를 넣어 한 번 더 나누고, 또 거절되면 `failed` | 기획의 정본은 Hub, 실행은 PL의 claude(D41). P1은 Office 4단계의 일(D35) | 역할 프로필을 고치면 단일 Office 프롬프트와 잠금 파일이 같이 바뀐다 |
| **R6 승인 기록:** 웹 승인은 `{approvalId(uuid), gate, memberId, at, textHash = 보여 준 글의 sha256}`. 그 기획의 PL만, 그것도 프로젝트 모든 repo의 담당자일 때만. `- OPEN BLOCKING` 줄이 있는 초안은 거절. 나누기 전에 Office가 빌린 기록에서 승인자 = PL, `textHash` = 쓸 초안의 sha256, 구조화된 초안이 그 글로 다시 그려짐을 확인하고, 아니면 `failed`. kit G1은 기존 `kitG1`(`responseRef: hub-approval:<approvalId>`), 높은 위험의 G3도 기획 폴더에만 쓴다. 대상 repo에는 아무것도 커밋하지 않는다 | 설계 "승인 신뢰": PL 본인이 누른 승인을 믿고, Office가 같은 글인지 확인해 기록 | 해시를 묶지 않으면 고친 초안에 옛 승인이 붙는다 |
| **R7 높은 위험:** G1 뒤 `design` 단계에서 Lead가 나누고, Office가 기존 `decision.md` 모양(계획 + Task 목록)으로 설계 글을 써 나눈 결과와 함께 올린다 → `awaiting_g3` → PL이 웹에서 G3 → `splitting`이 저장된 나눈 결과를 그대로 올린다. Story는 `risk: high`. **Task 실행은 바꾸지 않는다:** Story Task 계약은 이미 늘 `normal`이고(`story-contract.ts:119`), 엔진은 계약의 위험도만 거절한다(`native-office.ts:1333`, 그 문구가 "높은 위험 Story는 PL이 열기 전에 G3"). 이 흐름은 G3 뒤에만 열므로 그 전제를 지킨다. Task 9 시험이 고정한다 | 기존 높은 위험의 설계 문서가 Lead 계획이다. G3가 실제로 올라갈 Task 목록에 묶인다 | 실행을 고치면 엔진·계약·시험 셋이 같이 바뀐다 |
| **R8 웹:** 묶음 2처럼 서버 HTML, CSRF, POST-redirect-GET, `Actor = { member }`. `/projects/new`·`POST /projects`(내가 담당인 repo로, 관리자는 아무 repo, 기준 브랜치 기본 `main`, ASSUMED). 보드의 프로젝트마다 기획 중 목록과 **[새 Story]**(모든 repo 담당자에게만). `/plans/<id>`: 쉬운 말 상태, PL Mac·Office 줄, 차례마다 답 폼 하나, 초안과 **[고쳐 써 주세요]**·**[승인]**, 설계와 **[설계 승인]**, **[다시 시도]**, **[취소]**, 열린 뒤 Story 링크. 내 할 일과 보드에 진행 중인 기획 | 설계 PL 1–3 | 문구가 개발자 말이면 비개발자가 못 쓴다 |
| **R9 한도:** 위 값 표. 글 65536바이트, 새 Story POST 1 MiB, 답 4000자·한 차례 3개, 초안 ≤ `storyBodyBytes`(승인 줄 자리 512바이트를 뺌), 설계 16384바이트. `UPSTREAM_BYTES`(`story-contract.ts`)가 기대는 Hub 한도는 바꾸지 않는다 | 붙여 넣은 기획 문서가 들어가야 한다(설계 "기획 입력") | 한도를 넘는 글이 조용히 잘리면 PL의 뜻이 빠진다 |
| **R10 번호·파일:** kit 실행 U38, 계획 이 파일, 검증 기록 `docs/verification/2026-11-05-pl-planning.md` | 병렬 PR 충돌 방지 | — |
| **기획 화면은 모든 팀원이 본다. 행동은 그 기획의 PL만, 취소는 PL과 Hub 관리자(복구용)(ASSUMED).** 승인은 관리자도 못 한다 | 묶음 2 "모든 팀원이 모든 Story를 본다" | 공개 범위가 좁아야 하면 화면 판정 하나만 바꾼다 |
| **질문 차례는 기획마다 5번까지(ASSUMED).** 여섯째가 필요하면 Office가 "AI가 다섯 번 물었는데도 정할 것이 남았습니다. 하고 싶은 일을 더 자세히 적어 새 Story로 시작하세요."로 `failed`, Hub도 여섯째 `questions`를 `INVALID`로 막는다 | 묶음 크기를 묶고(한 차례 최대 약 18 KB), 끝없는 질문을 막는다 | 너무 적으면 PL이 새 Story로 다시 적어야 한다 |
| **초안의 Decisions는 Office가 정해진 대로 쓴다:** PM의 `assumptions`는 `ASSUMED: …`, 답한 질문마다 `PL 답: <질문> → <답>`(한 줄로 접고 500자까지) | D35 P1 "답을 Story Decisions에 적은 뒤에만 올린다"를 모델에 맡기지 않는다 | 모델에 맡기면 답이 빠진 초안이 승인될 수 있다 |
| **입력 candidate는 기획마다 한 번 만들고 그 기획의 모든 단계가 다시 쓴다(ASSUMED).** Story base는 첫 나누기 때 받은 기준 브랜치 tip으로 만들고 그 커밋을 `bases.json`에 한 번 적어 다시 시도에도 쓴다 | PM과 Lead가 같은 나무를 본다. 다시 시도마다 tip이 바뀌면 "이미 다른 커밋에 있음"으로 영원히 막힌다 | 오래 묵은 기획은 Lead가 옛 나무를 본다(묶음 4의 기준 브랜치 합치기가 받는다) |
| **Hub Story 제목은 PL이 적은 기획 제목, 본문은 승인한 초안(`Status: Approved`와 G1 줄을 넣은 것)이다(ASSUMED)** | 보드에 PL의 말이 보인다. kit 해시(`kitStoryHash`)는 진행 줄을 빼므로 같다 | 제목 하나 |
| **설계 다시 쓰기는 없다(ASSUMED).** 설계가 마음에 들지 않으면 취소하고 새 Story로. 승인 뒤 나누기가 실패하면 다시 시도만 있다 | 승인한 초안·설계를 바꾸면 승인이 무의미해진다 | 버튼 하나를 더하면 된다 |
| **기획 경로가 없는 옛 Hub(404)에는 Office가 한 줄만 말하고 300000 ms 뒤 다시 묻는다(ASSUMED)** | Office를 먼저 올려도 Hub를 괴롭히지 않는다 | — |

### 판정과 다르게 한 것

1. **R1 `planning` 상태:** 따로 저장하지 않고 "`queued`(또는 `design`·`splitting`) + 살아 있는 빌림"으로 나타낸다. 빌림이 끝나면 상태를 되돌릴 일이 없다. Hub의 상태 기계는 여전히 하나다.
2. **R2 올리기 키:** "기획 id + revision"이 아니라 `plan:<planId>`다. revision은 다시 시도 때마다 오르므로 그 키로는 다시 시도가 Story를 하나 더 만든다. 승인 뒤에는 초안이 바뀌지 않아, 기획 하나는 Story를 많아야 하나 올린다.
3. **R2 Story base를 만드는 repo:** 프로젝트의 모든 repo가 아니라, 올라간 Story가 `branches`로 이름 대는 repo(작업 Task의 repo + Story 검사의 repo)다. Task 계약과 묶음 4의 머지가 읽는 목록이 이것이다. Task도 검사도 없는 repo의 base에는 아무것도 머지되지 않는다.
4. **R3 경로 이름:** `/api/link/plan/*` 대신 `/api/link/story/plan-next|plan-heartbeat|plan-result`. 프로토콜 3 검사, 본문 읽기(`LINK_LIMIT`), 경로 표를 그대로 쓴다.
5. **R4 시작 조건:** "gate가 비었음"에 더해 "열린 Task 기록이 없음"이다. Task의 git 단계(준비·머지)는 gate 밖에서 같은 체크아웃을 쓴다. PL이 실패한 Task를 쥐고 있으면 기획은 그 Task가 끝나거나 풀릴 때까지 기다리고, 기획 화면이 그 Task를 이름 댄다.
6. **R5 "kit 역할 프롬프트":** 고정된 PM/Lead 역할 프로필 + `planningPrompt`의 팀 블록으로 읽는다. kit 역할 그래프(`KitPlanning`)는 팀 기획에서 돌리지 않는다. 그것은 R5가 빼라고 한 `IntakeLedger`에 묶여 있다.
7. **R7 순서:** "G3 뒤 나누기"가 아니라 "G1 뒤 나누기 → 그 계획과 Task 목록이 설계 → G3 → 저장된 나눈 결과를 올림"이다. 기존 `decision.md`가 Lead 계획이고, G3가 실제로 올라갈 목록을 승인하며, Lead를 두 번 돌리지 않는다.
8. **R9 한도:** 답 폼(`POST /plans/<id>/answer`)도 1 MiB까지 읽는다. 한글 4000자 답 셋은 urlencoded로 약 108 KB라 64 KiB를 넘는다. 초안 한도는 32768이 아니라 32256바이트다. 승인 줄을 넣은 본문이 Story 본문 한도 안에 들어가야 한다.

## Review Focus

1. **붙여 넣은 긴 한글 기획 문서(줄바꿈 포함):** 65536바이트까지 받고 65537바이트는 쉬운 말로 거절하되, 적은 제목·글이 폼에 그대로 돌아온다. 답의 줄바꿈은 Hub에 그대로 두고 모델에 줄 때만 한 줄로 접는다. 초안이 32256바이트를 넘으면 쉬운 말 이유로 `failed`다. Task 1·3·4·6 시험이 고정한다.
2. **PL의 Mac이 기획을 못 하는 때:** 꺼짐, Task를 쥐고 있음, 프로젝트 repo가 아직 그 Mac에 없음(clone 전·gh 로그인 없음), 단계 도중 재시작. 기획 화면이 이유를 말하고, 없는 repo는 이름을 대며 실패하고, 600000 ms 무소식인 빌림은 다시 주어지며, 재시작 뒤 이어 가도 Story는 하나다. Task 1·3·6·8 시험이 고정한다.
3. **두 번 누르기와 낡은 탭:** 답·고쳐 쓰기·승인·다시 시도·취소는 revision을, 승인은 보여 준 글의 해시도 확인한다. 맞지 않으면 아무것도 바꾸지 않고 `/plans/<id>?changed=1`로 돌아가 알린다. Office가 낡은 revision으로 보낸 결과도 409 `STALE`로 버려진다. Task 1·3 시험이 고정한다.
4. **나누기 도중 일부 실패:** 올린 뒤 한 repo의 base push가 실패(다른 커밋에 이미 있음, 권한 없음)하면 기획은 그 repo를 이름 대며 `failed`, Hub Story는 `draft`(가져갈 수 없음)다. 다시 시도는 두 번째 올리기를 하지 않고 적어 둔 커밋을 다시 쓰며, 같은 커밋의 base는 그대로 두고, 모든 base 뒤에만 연다. Task 8·10 시험이 고정한다.
5. **믿을 수 없는 글과 권한:** 프로젝트 이름, 기획 제목·글, 질문·답, 초안, 설계, 실패 이유는 새 화면 어디서나 이스케이프된다. 새 POST는 다른 Origin·CSRF 없음이면 403이다. PL이 아닌 팀원에게는 폼이 없고 POST는 `FORBIDDEN`이다. 담당자에서 빠진 PL의 G1, `OPEN BLOCKING`이 남은 초안의 G1은 거절되고, Office도 승인자·해시가 맞지 않으면 나누지 않는다. Task 1·3·7 시험이 고정한다.

---

### Task 1: Hub 저장소 — 기획 기록(`PlanBoard`)과 상태 기계

**Files:**
- Create: `src/hub/plan-protocol.ts`, `src/hub/plan-store.ts`
- Modify: `src/hub/story-store.ts`(`createProject`·`cancelStory`의 첫 인자 `Actor`, `createProject`의 `ownedOnly`, 새 `storyByKey`·`ownsProject`)
- Modify: `tests/hub-story-fixture.mjs`(`setup()`이 `plans = new PlanBoard(db, board, () => now)`도 돌려줌)
- Test: `tests/hub-plan-store.test.mjs`

**Interfaces:**
- Consumes: `HubStore`의 `hub_members`·`hub_repo_owners`, `StoryBoard`(같은 db, 먼저 만든다).
- Produces(`src/hub/plan-protocol.ts`, `src/hub` 밖을 import하지 않는 순수 코드):
  - `export const PLAN_LIMITS = { titleMax: 200, intentBytes: 65536, answerMax: 4000, noteMax: 4000, questionsPerRound: 3, roundsMax: 5, questionTextMax: 1000, draftBytes: 32256, draftStoryBytes: 65536, designBytes: 16384, splitBytes: 524288, failureMax: 4000, workTasksMax: 20, leaseMs: 600_000 } as const`
  - `export type PlanState = "queued" | "questions" | "draft" | "design" | "awaiting_g3" | "splitting" | "open" | "failed" | "cancelled"`
  - `export type PlanQuestion = { id: string; text: string; reason: string; blocking: boolean }`
  - `export type PlanRound = { questions: PlanQuestion[]; answers: { id: string; answer: string }[] | null }`
  - `export type PlanApproval = { approvalId: string; gate: "G1" | "G3"; memberId: string; at: number; textHash: string }`
  - `export type PlanResult = { kind: "questions"; questions: PlanQuestion[] } | { kind: "draft"; text: string; story: unknown } | { kind: "design"; text: string; split: unknown } | { kind: "open"; storyId: string } | { kind: "failed"; reason: string }`
  - `export type PlanRecord = { id: string; projectId: string; plMemberId: string; title: string; intent: string; risk: "normal" | "high"; state: "queued" | "design" | "splitting"; rounds: PlanRound[]; draft: { text: string; story: unknown } | null; rewrite: { note: string; previous: string } | null; design: string | null; split: unknown | null; g1: PlanApproval | null; g3: PlanApproval | null; repos: { id: string; name: string; baseBranch: string }[]; published: { storyId: string; number: number; state: StoryState } | null }`
  - `export type PlanLease = { leaseId: string; revision: number; plan: PlanRecord }`
  - `planTextHash(text: string): string`(UTF-8 sha256 hex), `hasOpenBlocking(text: string): boolean`(`/^[-*]\s+OPEN\s+BLOCKING\b/im`, `readContract`와 같은 식), `planStoryKey(planId: string): string`(`plan:<planId>`)
- Produces(`src/hub/story-store.ts`):
  - `createProject(a: Actor, name, repos, o: { ownedOnly?: boolean } = {})`: `ownedOnly`이면 관리자가 아닌 사람의 담당이 아닌 repo는 `FORBIDDEN`("내가 담당자인 레포만 넣을 수 있습니다.")
  - `cancelStory(a: Actor, storyId)`(규칙 그대로), `storyByKey(memberId: string, key: string): { id: string; number: number; state: StoryState } | null`, `ownsProject(memberId: string, projectId: string): boolean`(repo가 하나 이상이고 모두 담당)
- Produces(`src/hub/plan-store.ts`):
  - `export type PlanActions = { answer: boolean; rewrite: boolean; approve: "yes" | "open-blocking" | "not-owner" | "no"; retry: boolean; cancel: boolean }`(승인은 `draft`의 G1, `awaiting_g3`의 G3)
  - `export type PlanView = { id; project: { id; name }; pl: { id; name }; title; intent; risk; state: PlanState; revision: number; rounds: PlanRound[]; draft: { text: string; hash: string } | null; rewrite: { note: string } | null; design: { text: string; hash: string } | null; g1: PlanApproval | null; g3: PlanApproval | null; failure: { reason: string; from: "queued" | "design" | "splitting" } | null; story: { id: string; number: number } | null; leased: boolean; heartbeatAt: number | null; createdAt: number; updatedAt: number; isPl: boolean; actions: PlanActions }`
  - `export type PlanCard = { id: string; title: string; project: { id: string; name: string }; pl: { id: string; name: string }; state: PlanState; leased: boolean; updatedAt: number }`
  - `new PlanBoard(db: DatabaseSync, board: StoryBoard, now: () => number = Date.now)`
  - 웹: `createPlan(member: Member, input: { projectId: string; title: string; intent: string; risk: string }): { planId: string }`, `plan(a: Actor, planId: string): PlanView`, `myPlans(memberId: string): PlanCard[]`, `projectPlans(projectId: string): PlanCard[]`, `answer(member, planId, revision: number, answers: Record<string, string>): { ok: true }`, `rewrite(member, planId, revision, note: string): { ok: true }`, `approve(member, planId, gate: "G1" | "G3", revision, textHash: string): { approvalId: string }`, `retry(member, planId, revision): { ok: true }`, `cancel(a: Actor, planId, revision): { ok: true }`
  - 연결: `next(l: Link): PlanLease | null`, `heartbeat(l: Link, planId: string, leaseId: string): { ok: true }`, `result(l: Link, planId: string, leaseId: string, revision: number, r: PlanResult): { ok: true; revision: number }`

- 표(그대로 쓴다):

  ```sql
  CREATE TABLE IF NOT EXISTS hub_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES hub_projects(id),pl_member_id TEXT NOT NULL REFERENCES hub_members(id),title TEXT NOT NULL,intent TEXT NOT NULL,risk TEXT NOT NULL CHECK(risk IN ('normal','high')),state TEXT NOT NULL CHECK(state IN ('queued','questions','draft','design','awaiting_g3','splitting','open','failed','cancelled')),revision INTEGER NOT NULL,rounds TEXT NOT NULL,draft TEXT,rewrite TEXT,design TEXT,split TEXT,g1 TEXT,g3 TEXT,failure TEXT,story_id TEXT REFERENCES hub_stories(id),lease_id TEXT,leased_at INTEGER,heartbeat_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS hub_one_plan_lease ON hub_plans(pl_member_id) WHERE lease_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS hub_plan_events(id INTEGER PRIMARY KEY AUTOINCREMENT,plan_id TEXT NOT NULL REFERENCES hub_plans(id),member_id TEXT REFERENCES hub_members(id),kind TEXT NOT NULL,detail TEXT,at INTEGER NOT NULL);
  ```

- 규칙(위에서부터 판정, 모두 한 트랜잭션, 성공하면 revision +1·이벤트 한 줄):

  | 행동 | 누가 | 상태 | 결과 |
  |---|---|---|---|
  | `createPlan` | 프로젝트 모든 repo 담당자(관리자도 예외 없음) | — | `queued`, revision 1, `rounds` `[]` |
  | `answer` | PL | `questions` | 마지막 차례의 질문마다 답 하나 → `queued` |
  | `rewrite` | PL | `draft` | `rewrite = {note, previous: 초안}`, 초안 비움 → `queued` |
  | `approve` G1 | PL이고 지금 모든 repo 담당자 | `draft`, 해시 = `planTextHash(초안)`, `OPEN BLOCKING` 없음 | `g1` 기록 → 보통 `splitting`, 높음 `design` |
  | `approve` G3 | 같음 | `awaiting_g3`, 해시 = `planTextHash(설계)` | `g3` 기록 → `splitting` |
  | `retry` | PL | `failed` | `failure.from`으로, `failure` 비움, 승인 유지 |
  | `cancel` | PL·관리자 | 끝나지 않은 아무 상태 | `cancelled`, 빌림 비움. `storyByKey(PL, plan:<id>)`가 끝나지 않았으면 `board.cancelStory`로 함께 취소 |
  | `next` | 연결의 사람 = PL | `queued`·`design`·`splitting` | 살아 있는 내 빌림이 있으면 그것(같은 id). 없으면 내 끝난 빌림을 비우고 가장 오래된(`created_at`) 기획에 새 빌림. revision은 그대로 |
  | `heartbeat` | 빌림의 주인 | 빌림 id가 같음 | `heartbeat_at` = 지금(revision 그대로). id가 다르면 `NOT_YOURS`, 상태가 빌릴 수 없으면 `STATE` |
  | `result` | 빌림의 주인 | 빌림 id·revision·출발 상태가 맞음 | `questions`·`draft`는 `queued`에서, `design`은 `design`에서, `open`은 `splitting`에서, `failed`는 셋 모두에서. 빌림 비움. 안 맞으면 `STALE` |

- [ ] **Step 1: 실패하는 시험.**
  - "createPlan stores a queued plan at revision 1 for a member who owns every project repo; a member missing one repo and an admin who owns none are FORBIDDEN"
  - "createPlan limits: title 1–200 after trim; intent nonblank, 65536 UTF-8 bytes of Korean accepted and 65537 INVALID with '하고 싶은 일은 64KB(한글 약 2만 자)까지 적을 수 있습니다.'; risk other than normal|high INVALID" **[Review Focus 1]**
  - "next leases the member's oldest queued, design or splitting plan with a new lease id and the current revision; another member's link gets null"
  - "one lease per member: next again while it is live returns the same lease id; after 600000 ms without a heartbeat next gives a new lease id and the old lease's heartbeat is NOT_YOURS" **[Review Focus 2]**
  - "result with an old revision or another lease id is STALE and changes nothing; result questions of a cancelled plan is STALE" **[Review Focus 3]**
  - "result questions (1–3, ids Q1–Q3, text and reason 1–1000 chars, blocking boolean) appends a round and moves queued → questions; a sixth round is INVALID"
  - "answer: the PL answers every question of the last round once, each trimmed 1–4000 chars (4001 INVALID), a missing or extra id INVALID, an old revision STALE; the plan goes back to queued"
  - "result draft stores text (32256 bytes ok, 32257 INVALID) and story (an object, JSON ≤ 65536 bytes) and moves to draft; rewrite keeps {note, previous} and goes back to queued"
  - "approve G1 records {approvalId uuid, gate G1, memberId, at, textHash = sha256 of the draft}; normal goes to splitting and high to design; a hash of other text STALE; a '- OPEN BLOCKING' line OPEN_BLOCKING; another member FORBIDDEN; a PL removed from one project repo FORBIDDEN" **[Review Focus 5]**
  - "result design stores text (≤ 16384 bytes) and split (object, JSON ≤ 524288 bytes) and moves to awaiting_g3; approve G3 binds sha256 of the design and moves to splitting"
  - "a splitting lease carries published null, then the Story this PL published with key plan:<planId> as {storyId, number, state}"
  - "result open needs that published Story in state open; it records the story id and moves to open; another Story id is INVALID"
  - "result failed keeps {reason, from}; retry by the PL goes back to from with revision + 1 and keeps g1 and g3"
  - "cancel by the PL or an admin ends any unfinished plan, clears the lease and cancels the published draft Story; a second cancel STATE; another member FORBIDDEN"
  - "plan(a) shows the plan to every member; actions are all false for others; approve says open-blocking or not-owner by the same checks approve runs"
  - "myPlans lists the member's unfinished plans newest first, at most 20; projectPlans lists a project's unfinished plans oldest first"
  - "createProject with ownedOnly refuses a repo the member does not own (FORBIDDEN) unless admin; without it (the link route) nothing changes"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-plan-store.test.mjs`
- [ ] **Step 3: 구현.** `PlanBoard` 생성자가 표를 만든다(`StoryBoard` 뒤). 오류 문구: `FORBIDDEN`(만들기) "프로젝트의 모든 레포 담당자만 새 Story를 만들 수 있습니다." / `FORBIDDEN`(행동) "이 Story를 쓰는 PL만 할 수 있습니다." / `FORBIDDEN`(담당자 빠짐) "프로젝트의 모든 레포 담당자여야 승인할 수 있습니다. 관리자에게 담당자 등록을 요청하세요." / `STALE` "그사이 기획이 바뀌었습니다. 화면을 새로 고쳐 확인하세요." / `OPEN_BLOCKING` "막는 결정이 남은 초안은 승인할 수 없습니다. 고칠 점을 적어 다시 쓰게 하세요." / `STATE` "지금 할 수 있는 일이 아닙니다. 화면을 새로 고쳐 확인하세요." / 답 `INVALID` "답은 질문마다 1~4000자로 적어 주세요."
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-story-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: keep a PL's Story plan on the Hub as one state machine with leases and approvals`

더하기만: 새 표·새 클래스. `StoryBoard`는 타입을 `Actor`로 넓히고(링크도 그 모양) 기본값이 없는 선택 인자만 더한다.

### Task 2: Hub 기획 연결 경로와 Office 클라이언트

**Files:**
- Modify: `src/hub/link-api.ts`(경로 셋, `linkApi(store, board, plans?: PlanBoard)`), `src/hub/server.ts`(`HubServerConfig.plans?: PlanBoard`), `src/hub/run.ts`(`new PlanBoard(db, board)` 연결), `tests/hub-fixture.mjs`(`startTestHub`가 `plans`를 만들어 돌려줌)
- Create: `src/team/plan-link.ts`
- Test: `tests/hub-plan-link.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `PlanBoard.next|heartbeat|result`, `PlanLease`, `PlanResult`.
- Produces(경로, 프로토콜 3, 본문 `LINK_LIMIT`, `plans`가 없는 Hub는 404 `NOT_FOUND`):

  | 경로 | 본문 | 200 응답 |
  |---|---|---|
  | `POST /api/link/story/plan-next` | `{}` | `{ lease: PlanLease \| null }` |
  | `POST /api/link/story/plan-heartbeat` | `{ planId, leaseId }` | `{ ok: true }` |
  | `POST /api/link/story/plan-result` | `{ planId, leaseId, revision, result: PlanResult }` | `{ ok: true, revision }` |

- Produces(`src/team/plan-link.ts`):
  - `export type PlanLink = { repoId: string; next(): Promise<PlanLease | null>; heartbeat(planId: string, leaseId: string): Promise<void>; result(planId: string, leaseId: string, revision: number, r: PlanResult): Promise<void>; publish(input: { projectId: string; title: string; body: string; risk: "normal" | "high"; key: string; graph: GraphInput; storyVerify: { repoId: string; checks: VerifyCheck[] }[] }): Promise<{ storyId: string; number: number; already: boolean }>; open(storyId: string): Promise<void>; story(storyId: string): Promise<StoryView> }`
  - `planLink(cfg: HubLinkConfig, call: typeof hubCall = hubCall): PlanLink`(`publish`·`open`·`story`는 기존 `/api/link/story/publish|open|story`)
  - `planFailure(e: unknown): "stale" | "not-yours" | "state" | "gone" | "relink" | "retry"`(409 `STALE`, 409 `NOT_YOURS`, 409 `STATE`, 404 `NOT_FOUND`, 401·인증서, 그 밖)

- [ ] **Step 1: 실패하는 시험.**
  - "plan-next, plan-heartbeat and plan-result work over protocol 3 through the PL's link of either project repo; protocol 2 is 426 PROTOCOL_MISMATCH"
  - "planLink.next is null without work and a lease with the plan's repos otherwise; a reply without leaseId, revision or plan is HUB_BAD_RESPONSE"
  - "a stale result is planFailure stale; a replaced lease's heartbeat is not-yours; a cancelled plan's heartbeat is state"
  - "a Hub started without plans answers 404 for the three routes and planFailure says gone"
  - "planLink.publish with key plan:<planId>, open and story reach the existing story routes: a second publish answers already true with the same Story"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-plan-link.test.mjs`
- [ ] **Step 3: 구현.** 경로는 `storyRoute`의 `switch`에 더한다(`str`·`num`으로 타입 검사, `result`의 내용 검사는 저장소). 응답 모양이 틀리면 `story-link.ts`처럼 `HUB_BAD_RESPONSE`.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-link.test.mjs tests/hub-link-api.test.mjs tests/hub-story-link-api.test.mjs tests/hub-story-*.test.mjs tests/team-story-link.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: let a PL's Office lease Story plan work and post results over its Hub link`

더하기만: `ROUTES`에 세 줄을 더하고 `linkApi`의 셋째 인자는 선택이다. 기존 경로·응답·프로토콜 검사는 그대로다.

### Task 3: Hub 웹 — 프로젝트 만들기, 새 Story, 기획 화면과 버튼

**Files:**
- Create: `src/hub/plan-pages.ts`
- Modify: `src/hub/server.ts`(GET·POST 경로, 본문 한도 선택), `src/hub/story-pages.ts`(`home`·`workBoard`에 선택 칸), `src/hub/pages.ts`(머리글 Mac 이름 함수를 `export const macBadgeLabel`로)
- Test: `tests/hub-plan-pages.test.mjs`(`startTestHub`, `enter()`로 쿠키·CSRF)

**Interfaces:**
- Consumes: Task 1의 `PlanBoard`·`PlanView`·`PlanCard`, `StoryBoard.ownsProject`·`createProject(…, { ownedOnly: true })`·`projects`·`openTaskOfMember`, `HubStore.macBadge`·`repos`.
- Produces(`src/hub/plan-pages.ts`):
  - `planStateLabel(state: PlanState, leased: boolean): string`: queued "기획 대기"/"기획 중", questions "질문", draft "초안", design "설계 대기"/"설계 중", awaiting_g3 "설계 승인 대기", splitting "나누기 대기"/"나누는 중", open "열림", failed "멈춤", cancelled "취소됨"
  - `planStateText(v: PlanView): string`(아래 문구)
  - `newProjectPage(me: Member, csrf: string, repos: { id: string; name: string }[], chrome: Chrome, o?: { error?: string }): string`
  - `newStoryPage(me: Member, csrf: string, project: ProjectView, chrome: Chrome, o?: { error?: string; values?: { title: string; intent: string; risk: string } }): string`
  - `planPage(me: Member, csrf: string, v: PlanView, o: { plMac: MacBadge; plOpenTask: OpenTaskRef | null; changed: boolean }, chrome: Chrome): string`
- Produces(`src/hub/story-pages.ts`, 선택 인자만): `home(me, csrf, w, o: { macNudge; wait; plans?: PlanCard[] }, chrome)`, `workBoard(me, rows: { project; stories; plans?: PlanCard[]; canPlan?: boolean }[], chrome, o?: { canCreateProject?: boolean })`
- 경로(`board`와 `plans`가 있을 때만, 없으면 404):

  | 경로 | 본문 | 하는 일 | 다음 |
  |---|---|---|---|
  | `GET /projects/new` | — | 내가 담당인 repo(관리자는 모두), 기준 브랜치 칸 기본 `main` | — |
  | `POST /projects` | `name`, `repo`(여러 개), `base-<repoId>` | `createProject({member: me}, …, { ownedOnly: true })` | `/board` |
  | `GET /projects/<uuid>/new-story` | — | `ownsProject`가 아니면 403 화면 | — |
  | `POST /projects/<uuid>/plans` | `title`, `intent`, `risk`(`normal`\|`high`), 읽기 1 MiB | `createPlan`. `INVALID`면 400과 함께 적은 값을 넣은 폼을 다시 | `/plans/<id>` |
  | `GET /plans/<uuid>` | `changed=1`이면 알림 | 기획 화면 | — |
  | `POST /plans/<uuid>/answer` | `revision`, `answer-Q1..Q3`, 읽기 1 MiB | `answer` | `/plans/<id>` |
  | `POST /plans/<uuid>/rewrite` | `revision`, `note` | `rewrite` | `/plans/<id>` |
  | `POST /plans/<uuid>/approve` | `revision`, `gate`(`G1`\|`G3`), `hash` | `approve` | `/plans/<id>` |
  | `POST /plans/<uuid>/retry` | `revision` | `retry` | `/plans/<id>` |
  | `POST /plans/<uuid>/cancel` | `revision`, `confirm`=`yes`(없으면 `INVALID` "취소하려면 '정말 취소합니다'를 체크하세요.") | `cancel` | `/plans/<id>` |

  `STALE`이면 오류 화면 대신 `/plans/<id>?changed=1`로 보낸다(알림 "그사이 기획이 바뀌어 새 화면을 보여 드립니다. 확인한 뒤 다시 누르세요.").
- 화면 내용:
  - **보드:** 맨 위 [새 프로젝트](`/projects/new`). 프로젝트마다 "기획 중" 목록(제목 링크·상태·PL, 있을 때만)과 `canPlan`이면 [새 Story]. 빈 보드 문구는 "아직 프로젝트가 없습니다. [새 프로젝트]로 레포를 묶은 뒤 [새 Story]로 시작하세요."
  - **내 할 일:** `plans`가 있으면 "내가 쓰는 Story" 칸(제목·상태·프로젝트).
  - **새 Story:** 제목, "하고 싶은 일" 큰 글 칸(평소 말로, 기획 문서를 붙여 넣어도 됨, 64KB까지), 위험도 보통/높음과 한 줄 설명("높음이면 Task로 나누기 전에 AI가 쓴 설계를 한 번 더 승인합니다.").
  - **기획 화면:** 제목·프로젝트·PL·위험도·상태 알약과 `planStateText`, "새로 고침". 빌림이 없고 일을 기다리면 PL Mac 줄: Task를 쥐고 있음 "PL의 Office가 Task #N(레포)을 맡고 있어, 그 Task가 끝나면 이어서 기획합니다." / 꺼짐 "PL의 Mac이 꺼져 있습니다(마지막 확인 N분 전). 켜지면 이어서 합니다." / 그 밖 "PL의 Mac: <macBadgeLabel>". 하고 싶은 일(`<details>` 안 `<pre>`). 지난 차례의 질문·답(읽기만). 지금 차례(PL)는 폼 하나: 질문마다 글·이유, 막는 결정이면 "막는 결정" 알약, `<textarea name="answer-Qn" maxlength="4000" required>`. 초안 `<pre>`와(PL) [승인](숨은 `revision`·`gate=G1`·`hash`, "승인하면 AI가 Task로 나눠 바로 올리고 엽니다." 높은 위험이면 "승인하면 AI가 Task를 나누고 설계를 보여 드립니다."), `approve`가 `open-blocking`이면 그 이유, `not-owner`면 담당자 안내, [고쳐 써 주세요](메모 4000자). 설계 `<pre>`와 [설계 승인]("승인하면 이 Task 목록을 그대로 올리고 엽니다."). 실패면 이유 첫 줄 `<b>`, 나머지는 "자세한 이유" `<pre>`, [다시 시도]. 열렸으면 "Story #N 보기" 링크. 승인 기록 "G1 승인: 이름 · 시각". [취소](체크 "정말 취소합니다", "취소하면 이 기획을 멈춥니다. 이미 올라간 Story가 있으면 함께 취소됩니다.").
  - **`planStateText`:** queued·design·splitting 빌림 없음 "PL의 Mac이 가져가기를 기다립니다(보통 1분 안)." / queued 빌림 "AI가 기획하고 있습니다." / design 빌림 "AI가 Task를 나누고 설계를 쓰고 있습니다." / splitting 빌림 "AI가 Task로 나누고 올리는 중입니다." / questions PL "AI가 묻습니다. 답하면 이어서 씁니다." 남 "PL의 답을 기다립니다." / draft PL "Story 초안이 나왔습니다. 읽고 승인하거나, 고칠 점을 적어 다시 쓰게 하세요." 남 "PL의 승인을 기다립니다." / awaiting_g3 PL "설계를 읽고 승인하면 Task를 올리고 엽니다." 남 "PL의 설계 승인을 기다립니다." / open "Story #N이 열렸습니다." / failed "멈췄습니다." / cancelled "취소됐습니다."

- [ ] **Step 1: 실패하는 시험.**
  - "the board shows 새 프로젝트, each project's plans in progress, and 새 Story only to a member who owns every project repo"
  - "/projects/new lists only my repos (an admin sees all) with base branch main; POST /projects makes the project and goes to /board; a repo I do not own is a FORBIDDEN page"
  - "/projects/<id>/new-story is a 403 page for a member missing a project repo, and so is POST /projects/<id>/plans"
  - "POST /projects/<id>/plans makes a queued plan and goes to /plans/<id>; home lists it under 내가 쓰는 Story"
  - "a 65536-byte Korean intent with line breaks (about 196 KB urlencoded) is accepted and kept exactly; 65537 bytes comes back as the form with the typed title and intent and the plain message; a body over 1 MiB is 413" **[Review Focus 1]**
  - "the plan page states each state in plain words (waiting for the PL's Mac, planning while leased, questions, draft, design, awaiting G3, splitting, open with the Story link, failed with its reason, cancelled)"
  - "a waiting plan says the PL's Mac is off with its last beat, or names the Task the PL's Office holds" **[Review Focus 2]**
  - "questions show one form per round with a 4000-character box per question and 막는 결정 on blocking ones; three 4000-character Korean answers (about 108 KB urlencoded) are accepted" **[Review Focus 1]**
  - "the draft shows its text with 승인 (hidden revision and hash) and 고쳐 써 주세요; a draft with OPEN BLOCKING shows why there is no 승인"
  - "승인 moves the plan on; a second click or an older tab redirects to /plans/<id>?changed=1 with the notice and changes nothing" **[Review Focus 3]**
  - "고쳐 써 주세요 keeps FORM_LIMIT: a 70 KB body is 413"
  - "설계 승인, 다시 시도 and 취소 work for the PL; 취소 without 정말 취소합니다 is an INVALID page and the plan stays"
  - "a member who is not the PL sees no form, and every plan POST from them is a FORBIDDEN page" **[Review Focus 5]**
  - "every new POST is 403 from another origin or without the CSRF token; project name, plan title, intent, questions, answers, draft, design and failure reason are escaped on the board, home and plan pages; the new pages load no script" — `<img src=x onerror=…>`를 각 글에 넣고 원문이 없음을 본다. **[Review Focus 5]**
  - "a hub without plans answers 404 for the new pages and draws the board and home as before"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-plan-pages.test.mjs`
- [ ] **Step 3: 구현.** `server.ts`는 본문을 읽기 전에 경로로 한도를 고른다: `/^\/projects\/<uuid>\/plans$/`와 `/^\/plans\/<uuid>\/answer$/`만 `PLAN_FORM_LIMIT = 1024 * 1024`, 그 밖은 `FORM_LIMIT`. 다른 Origin은 지금처럼 본문을 읽기 전에 막는다. `revision`은 정수가 아니면 `INVALID`.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: let a PL make a project, start a Story and answer, approve or retry its plan on the Hub web`

더하기만: 새 경로와 새 화면 모듈. 보드·내 할 일은 `plans`가 있을 때만 칸이 붙고, 기존 경로·문구·시험은 그대로다(빈 보드 문구만 `plans`가 있는 Hub에서 바뀜).

### Task 4: Office 기획 입력 — 여러 repo의 읽기 전용 나무와 팀 묶음

**Files:**
- Modify: `src/team/branch.ts`(`fetchBaseTip`, `listTree`, `extractTree`, `GitOptions`에 `indexFile`·`maxBytes`)
- Create: `src/team/plan-tree.ts`, `src/runners/team-planning.ts`(`repoFolders`·`dialogueOf`·`decidedOf`만, Task 5가 더함)
- Modify: `src/runners/planning.ts`(`Input.team`, `teamPlanningPacket`, `planningPrompt`의 팀 블록, `teamPlanningLimits`)
- Create: `tests/plan-fixture.mjs`(PM·Lead 가짜 출력 `turn(packet, body)`: `planning-coordinator.test.mjs`의 stdout 모양)
- Test: `tests/team-branch.test.mjs`(추가), `tests/team-plan-tree.test.mjs`, `tests/team-planning.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `PlanRound`·`PlanRecord`.
- Produces(`src/team/branch.ts`):
  - `fetchBaseTip(checkout: string, baseBranch: string, env: GitEnv): Promise<string>`: 기존 `fetchTip`과 같이 FETCH_HEAD로만 받는다. `checkBase`에 걸리면 `GIT_FAILED`.
  - `listTree(checkout: string, sha: string, env: GitEnv): Promise<{ path: string; size: number; link: boolean }[]>`: `ls-tree -r -z -l`, gitlink(`160000`) 뺌, `maxBytes` 16 MiB.
  - `extractTree(checkout: string, sha: string, target: string, env: GitEnv): Promise<void>`: 비어 있지 않은 `target`은 `GIT_FAILED`. 기획 폴더 안 임시 index(`GIT_INDEX_FILE`)로 `read-tree <sha>` → `checkout-index -a -f --prefix=<target>/`, 끝나면 임시 index를 지운다. 체크아웃의 index·HEAD·작업 폴더는 바뀌지 않는다.
- Produces(`src/runners/team-planning.ts`):
  - `export type TeamRepoFolder = { folder: string; repoId: string; name: string; baseBranch: string }`
  - `repoFolders(repos: { id: string; name: string; baseBranch: string }[]): TeamRepoFolder[]`: 이름이 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/`이고 겹치지 않으면 그 이름, 아니면 `repo-<repoId 앞 8자>`
  - `dialogueOf(rounds: PlanRound[]): PlanningDialogue[]`: 답이 있는 차례만, `blocking`은 빼고, 답은 공백류를 한 칸으로 접어 한 줄로
  - `decidedOf(rounds: PlanRound[]): { question: string; answer: string }[]`
- Produces(`src/team/plan-tree.ts`):
  - `export type PlanTreeRepo = TeamRepoFolder & { checkout: string }`
  - `planTree(dir: string, repos: PlanTreeRepo[], git: { fetchBaseTip(checkout: string, baseBranch: string): Promise<string>; listTree(checkout: string, sha: string): Promise<{ path: string; size: number; link: boolean }[]>; extractTree(checkout: string, sha: string, target: string): Promise<void> }): Promise<Candidate>`: `<dir>/candidate.json`이 있고 `verifyCandidate`를 통과하면 그것. 없으면 repo마다 tip → 목록(`protectedPath` 뺌, 앞에 `<folder>/`) → 합계가 10000개·100 MiB를 넘으면 `CANDIDATE_LIMIT`(풀기 전) → `<dir>/tree/<folder>`에 풀기 → `freezeCandidate(<dir>/tree, 목록, <dir>/candidates)` → `candidate.json`(0600) → `<dir>/tree` 지움.
- Produces(`src/runners/planning.ts`):
  - `Input.team?: { version: 1; repos: { folder: string; baseBranch: string }[]; rewrite: { previous: string; note: string } | null; retry: string | null }`
  - `export type PlanningStory = ReturnType<typeof parseStory>`, `export type PlanningDialogue = Dialogue`(지금의 비공개 타입)
  - `teamPlanningPacket(input: { planId: string; intent: string; risk: "normal" | "high"; role: "pm" | "lead"; repos: { folder: string; baseBranch: string }[]; dialogue: PlanningDialogue[]; story: PlanningStory | null; rewrite: { previous: string; note: string } | null; retry: string | null }): PlanningPacket`: planId uuid, intent 1–65536바이트·NUL 없음, repos 1–20, 메모·이유는 한 줄로 접음. 결과는 기존 `seal`. `planning.ts`는 `team-planning.ts`를 import하지 않는다(순환 없음).
  - `teamPlanningLimits(role: "pm" | "lead"): string`, `planningPrompt`는 `packet.team`이 있으면 `planningLimits` 대신 팀 블록 + `teamPlanningLimits`를 넣는다. 팀 블록이 반드시 말하는 것: repo마다 `/candidate/tree/<folder>`와 기준 브랜치, PM은 story에 `openBlocking: [{text, reason}]`(0–3, PL이 G1 전에 정해야 할 막는 결정)과 질문 차례 5번, Lead는 Task마다 `repo`(폴더 하나)·`files`(그 repo 안 상대 경로 1–50)·`after`(먼저 머지돼야 할 Task 번호), `workspace` 없음, 전체에 `storyVerify: [{repo, checks}]`, Task 1–20·검사 1–8, 같은 repo에서 같은 파일을 만지는 Task는 `after`로 순서를 둠, `retry`가 있으면 "앞 나누기가 이 이유로 거절됐다: …".

- [ ] **Step 1: 실패하는 시험.**
  - branch: "fetchBaseTip returns the origin's base branch tip into FETCH_HEAD only and adds no remote-tracking ref; a name with '..' is GIT_FAILED before git runs"
  - branch: "listTree lists blobs and symlinks with sizes and leaves out gitlinks"
  - branch: "extractTree writes the tree of a commit into an empty folder through a private index; the checkout's index, HEAD and status stay the same; a folder with files is GIT_FAILED"
  - plan-tree: "planTree makes one candidate with app-be/ and app-fe/ at their base branch tips (main and develop), leaves out .env, .git and .pazmo-office, and the person's repo folders do not change"
  - plan-tree: "a second planTree returns the saved candidate without git; a total over 10000 files is CANDIDATE_LIMIT before anything is extracted"
  - team-planning: "repoFolders keeps safe unique names and uses repo-<8 chars of the id> for an unsafe or repeated one"
  - team-planning: "teamPlanningPacket seals a PM packet with the plan id, the intent (65536 bytes ok, 65537 PLANNING_INVALID), the folders and base branches, and each answer folded to one line" **[Review Focus 1]**
  - team-planning: "a Lead packet carries the approved story and the retry reason"
  - team-planning: "a team prompt names /candidate/tree/app-be with main and /candidate/tree/app-fe with develop, openBlocking for PM, repo, files, after, storyVerify and the caps 1–20 tasks, 1–8 checks, 1–50 files for Lead; a packet from beginPlanning gives the same prompt as before"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-branch.test.mjs tests/team-plan-tree.test.mjs tests/team-planning.test.mjs`
- [ ] **Step 3: 구현.** 시험 원격은 `gitOrigins(t, ["app-be", "app-fe"])`, 체크아웃은 clone 뒤 `ensureCheckout(repo, <dataDir>/story-checkout)`. `app-fe`에는 `develop` 브랜치를 만든다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/planning*.test.mjs tests/candidates.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: build one readonly planning tree over a project's repos and a team planning packet`

더하기만: `branch.ts`는 새 함수와 기본값 없는 선택만(기존 env 시험 그대로). 팀 블록은 `packet.team`이 있을 때만이라 단일 Office의 묶음·프롬프트·역할 프로필은 같다.

### Task 5: Office 기획 출력 — PM의 막는 결정, Lead의 여러 repo 나누기, P5

**Files:**
- Modify: `src/runners/planning.ts`(검사 앞부분을 `reportOf`로 빼고 `acceptPlanning`이 그것을 씀, 아래 도우미 export, `renderPlanningStory(story, extraDecisions: string[] = [])`)
- Modify: `src/runners/team-planning.ts`
- Test: `tests/team-planning.test.mjs`(추가), `tests/planning.test.mjs`·`tests/planning-coordinator.test.mjs`(그대로 통과)

**Interfaces:**
- Consumes: Task 4의 `teamPlanningPacket`·`TeamRepoFolder`·`decidedOf`, `src/hub/story-protocol.ts`의 `validateGraph`·`validateStoryVerify`·`StoryGraphError`·`GraphInput`·`VerifyCheck`.
- Produces(`src/runners/planning.ts`): `reportOf(packet, observation: { closed: boolean; result: CommandResult }, markers: string[]): Record<string, unknown>`(닫힘·시간 초과·실행기 실패·종료 코드·`terminalReport`·version·inputDigest 검사), `questionsOf(value: unknown): { id: string; text: string; reason: string }[]`, `parseStory(value: unknown, extraKeys: readonly string[] = []): PlanningStory`, `coverageOf(story: PlanningStory, tasks: { must: number[]; verify: number[] }[], at: string): void`(Task마다 MUST가 그 Task의 Verify로 덮임, 전체로 모든 M·V가 덮임), `validate = { object, text, list, refs }`
- Produces(`src/runners/team-planning.ts`):
  - `export type TeamSplit = { plan: string; graph: GraphInput; storyVerify: { repoId: string; checks: VerifyCheck[] }[] }`
  - `export class SplitRefused extends OfficeError`(code `SPLIT_REFUSED`, 메시지 = Hub 검사의 문구)
  - `acceptTeamPm(packet, observation): { kind: "questions"; questions: { id: string; text: string; reason: string }[] } | { kind: "story"; story: PlanningStory; openBlocking: { text: string; reason: string }[] }`
  - `acceptTeamLead(packet, observation, repos: TeamRepoFolder[]): TeamSplit`: 키는 정확히 `version, inputDigest, plan, tasks, storyVerify`. Task 키 `title, outcome, scope, constraints, must, verify, checks, repo, files, after`. 노드 id는 Task 순서대로 `t1`…`tN`(Hub의 Task 번호 순서가 됨), `after`의 번호 `a`마다 간선 `{from: "t<a>", to: 자기}`. `spec`은 `renderTaskSpec`. 그 뒤 `validateGraph(graph, { projectRepoIds })`·`validateStoryVerify`, `StoryGraphError`는 `SplitRefused`.
  - `renderTeamStory(story: PlanningStory, decided: { question: string; answer: string }[]): string` = `renderPlanningStory(story, decided.map(…"PL 답: <질문> → <답>", 500자까지))`
  - `renderTaskSpec(task, story): string`(`Outcome:`·`Scope:`·`Constraints:`·`Covers: M1, M2 / V1` 네 줄)
  - `renderTeamDesign(split: TeamSplit, repos: TeamRepoFolder[]): string`: `# Decision requiring human G3`, 계획, `## Task 목록`(노드마다 `- t<n> · <folder> · <title>(앞: t<a>…)`, 제목은 `split.graph.nodes`에서), `Understanding gate (G3): pending`
  - `approvedStory(draft: string, g1: PlanApproval): string`: `Status: Draft` → `Status: Approved`, G1 줄 → `Understanding gate (G1): hub-approval:<approvalId> · <YYYY-MM-DD> · Check-in: accepted`

- [ ] **Step 1: 실패하는 시험.**
  - "acceptTeamPm returns Q1–Q3 questions as acceptPlanning does, and a ready story with openBlocking of 0–3 {text, reason}; a fourth item, a missing openBlocking key or a line break in an item is PLANNING_INVALID"
  - "acceptTeamLead turns tasks into the Hub graph: ids t1..tN in task order, repoId from the folder, files, checks as verify, edges from after, a four-line spec; storyVerify by repo id"
  - "P5: a Story MUST or Verify no task covers, or a task MUST its own verify does not cover, is PLANNING_INVALID naming M<n> or V<n>"
  - "caps: 21 tasks, 9 checks in a task, 0 or 51 files, an unknown folder, an after naming itself or out of range, no storyVerify are PLANNING_INVALID"
  - "the Hub's own checks run here: two app-be tasks touching src/a.ts without an after path are SPLIT_REFUSED with the GRAPH_OVERLAP message; a cycle through after is SPLIT_REFUSED GRAPH_CYCLE"
  - "renderTeamStory writes Goal, Domain, MUST, SHOULD, OUT, Decisions and Verify with ASSUMED lines and one 'PL 답:' line per answered question (500 characters at most), and hasOpenBlocking is false for it"
  - "renderTeamDesign has the plan, the Task list with repo and 앞 Task and 'Understanding gate (G3): pending'; approvedStory has Status: Approved and the hub-approval G1 line and the same kitStoryHash as the draft"
  - "acceptPlanning and renderPlanningStory give the same results as before for single-Office packets" — 기존 시험이 그대로 통과함을 이 Task의 확인 명령에 넣는다.
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-planning.test.mjs`
- [ ] **Step 3: 구현.** 가짜 출력은 `tests/plan-fixture.mjs`의 `turn(packet, body)`. Lead 검사 상한은 `PLAN_LIMITS.workTasksMax`(20)와 `LIMITS.checksPerList`(8)·`filesPerTask`(50).
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/planning.test.mjs tests/planning-coordinator.test.mjs tests/intake.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: read a team PM's blocking decisions and a team Lead's repo split with M/V coverage`

더하기만: `acceptPlanning`은 앞부분을 함수로 뺄 뿐 판정이 같다. `renderPlanningStory`의 새 인자는 기본값 `[]`.

### Task 6: Office 기획 운전자 — 빌림·하트비트·결과, 한-실행 gate, PM 단계

**Files:**
- Modify: `src/runtime/live.ts`(`Runners.planTurn`, `LiveRuntime.planTurn`, `createLiveRuntime`의 `planTurn`), `src/runtime/native-office.ts`(`planTurn`), `src/lean/office.ts`(`LeanOffice.planTurn`)
- Create: `src/team/planner.ts`
- Modify: `src/team/office.ts`(`TeamConfig.planLinkOf`·`planGit`, 연결)
- Modify: `tests/plan-fixture.mjs`(가짜 `PlanLink`, `planTurn`이 있는 가짜 런타임)
- Test: `tests/native-story-task.test.mjs`(추가), `tests/team-planner.test.mjs`, `tests/team-office.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 2의 `PlanLink`·`planFailure`, Task 4의 `planTree`·`teamPlanningPacket`·`repoFolders`·`dialogueOf`·`decidedOf`, Task 5의 `acceptTeamPm`·`renderTeamStory`, `runnerNotReady`·`runnerAccountProblem`(`src/runners/runner-account.ts`).
- Produces:
  - `LiveRuntime.planTurn(packet: PlanningPacket, candidate: Candidate, signal?: AbortSignal): Promise<{ closed: boolean; result: CommandResult }>`: `verify`와 같은 단독 자리(`#verifying`)를 쓴다. 다른 실행·verify 중이면 `BUSY`, 도는 동안 `status().verifying`이 true(그래서 `busy()`가 센다), 끝나면 `onSettled`, 신호가 끊기면 `CANCELLED`. `createLiveRuntime`의 `planTurn`은 `planningPrompt(packet, candidate)` → `roleJob(packet.role, packet.requestId, prompt)`(없으면 `job(prompt)`) → `new ContainerPlanner(client.run).run(candidate, job, () => {}, signal)`.
  - NativeOffice·LeanOffice `planTurn(packet, candidate, signal?)`: live가 아니면 `EXECUTION_LOCKED`, `othersActive()`면 `BUSY`, Lean은 `beginStop` 뒤 `STOPPING`.
  - `src/team/planner.ts`:
    - `export type PlanLane = { project: string; checkout: string; repoId: string; link: PlanLink }`
    - `export type PlanGit = Parameters<typeof planTree>[2] & { pushStoryBase(checkout: string, storyBase: string, sha: string): Promise<"created" | "exists"> }`(앞 셋은 Task 4 `planTree`의 `git` 인자, `pushStoryBase`는 Task 8), `planGitOps(env: GitEnv): PlanGit`(`branch.ts` 함수에 `env`를 묶음, `branchOps`와 같은 방식)
    - `export type PlannerConfig = { root: string; lanes: () => PlanLane[]; engineOf: (project: string) => Pick<LeanOffice, "planTurn">; canStart: () => boolean; git: PlanGit; beatMs?: number; recheckMs?: number; log: (line: string) => void; now?: () => number }`
    - `export type PlannerTick = { ran: false; why: "busy" | "no-lane" | "none" | "hub-too-old" } | { ran: true; planId: string; posted: PlanResult["kind"] | null }`
    - `createPlanner(c: PlannerConfig): { tick(): Promise<PlannerTick>; active(): boolean; stop(): void }`
- 단계 표 `STEPS: Record<PlanRecord["state"], Step>`: 이 Task는 `queued`(PM)를 넣고, Task 8이 `splitting`, Task 9가 `design`을 넣는다.
- PM 단계: 기획의 repo마다 같은 `repoId`의 레인이 없으면 결과 `failed` "레포 <이름>을(를) PL의 Mac에서 쓸 수 없습니다(연결 없음 또는 gh 로그인 필요). 내 Mac 화면에서 확인한 뒤 다시 시도하세요." → `planTree(<root>/team/plans/<planId>, …)` → `teamPlanningPacket(role "pm", dialogue = dialogueOf(rounds), rewrite)` → 빌린 레인 엔진의 `planTurn` → `acceptTeamPm`: 질문이면 `questions`(`blocking:false`), `openBlocking`이 있으면 Q1..Qn `questions`(`blocking:true`), 둘 다 답한 차례가 이미 5번이면 `failed`(판정 표 문구), 깨끗한 story면 `renderTeamStory(story, decidedOf(rounds))`가 32256바이트를 넘으면 `failed` "Story 초안이 너무 깁니다(32KB 넘음). 하고 싶은 일을 줄이거나 나눠 새 Story로 시작하세요.", 아니면 `draft {text, story}`.
- 실패 이유(첫 줄 쉬운 말, 둘째 줄부터 자세히): 실행기 준비 안 됨·계정 문제 "PL Mac의 AI 실행기(<runner>)를 쓸 수 없습니다: 사용 한도/결제/로그인/준비 안 됨. 해결한 뒤 다시 시도하세요." / `PLANNING_INVALID` "AI의 답을 읽지 못했습니다. 다시 시도하세요." + detail / `CANDIDATE_LIMIT` "레포가 커서 기획 입력(파일 1만 개·100MB)을 넘습니다." / `GIT_FAILED` "PL Mac에서 레포를 받지 못했습니다." + 원인 줄.
- 운전 규칙: `tick()`은 단계 중이면 `busy`, `canStart()`가 거짓이면 `busy`, 레인이 없으면 `no-lane`. 첫 레인의 `next()`가 null이면 `none`, 404(`gone`)이면 한 줄 말하고 `recheckMs`(300000 ms) 동안 `hub-too-old`. 빌리면 그 단계를 끝까지 하고 기다린다. 하트비트는 `beatMs`(60000 ms)마다, `not-yours`·`state`면 단계를 끊고(신호) 아무것도 보내지 않는다. 결과 보내기가 `retry`로 실패하면 그 결과를 기억해 두고, 다음 tick의 `next()`가 같은 빌림 id·revision을 주면 모델을 다시 돌리지 않고 그것을 보낸다. `stale`이면 버린다. `planTurn`의 `BUSY`는 결과 없이 다음 tick에 다시.
- `office.ts` 연결:
  - `planLinkOf?: (dataDir: string) => PlanLink | null`(기본: `readLinkConfig` → `planLink`), `planGit?: PlanGit`(기본 `planGitOps(hostEnv)`). 레인의 연결을 읽는 곳(시작, `recheck`)에서 함께 읽어 `where` 옆 지도에 둔다.
  - live일 때만 `createPlanner`. `canStart = () => live && runnersReady && teamStore.openClaim() === null && !gate.busy() && !watch.holding() && !stopped`.
  - claim tick: `runnersBeforeTick()`(기획이 따를 수 있을 때도 확인) → `planner.tick()`이 `ran: true`면 그 tick을 끝낸다 → 아니면 `scheduler.tick()`.
  - `presenceOf()`: `planner.active()`면 `working`. 다시 켜기 판단(`idle`)은 `planner.active()`면 거짓. `beginStop`·`close`는 `planner.stop()`.

- [ ] **Step 1: 실패하는 시험.**
  - native: "planTurn reaches the live planning turn; another engine's run makes it BUSY; a locked engine is EXECUTION_LOCKED; after beginStop the lean engine says STOPPING"
  - native: "LiveRuntime.planTurn is a run of its own: BUSY while a run or verify is active, status().verifying true while it runs, onSettled after it, CANCELLED when its signal aborts"
  - planner: "a queued lease runs one PM turn on the leased lane's engine over the plan tree and posts questions with the lease id and revision"
  - planner: "a story with openBlocking posts Q1..Qn questions marked blocking; a clean story posts draft whose text is renderTeamStory with a PL 답 line per answered question; answers reach the packet folded to one line" **[Review Focus 1]**
  - planner: "a project repo with no ready lane posts failed naming that repo and runs no turn" **[Review Focus 2]**
  - planner: "a sixth question round, a draft over 32256 bytes, a runner refusal (RUNNER_NOT_READY claude) and an unreadable answer each post failed with its plain first line" **[Review Focus 1]**
  - planner: "the heartbeat goes every beatMs; a NOT_YOURS heartbeat aborts the turn's signal and posts nothing"
  - planner: "a result that failed to send is sent on the next tick for the same lease without a second turn; a stale result is dropped" **[Review Focus 2]**
  - planner: "a Hub without plan routes is said once and asked again after recheckMs"
  - office: "a live Office leases a queued plan on the claim tick before claiming, runs it on the first ready lane's engine and claims no Task in that tick"
  - office: "no plan is leased while a Task record is open, while an engine runs, while the runners are not ready, or when the Office is locked" **[Review Focus 2]**
  - office: "presence is working during a planning step and the Mac restart waits for it"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/native-story-task.test.mjs tests/team-planner.test.mjs tests/team-office.test.mjs`
- [ ] **Step 3: 구현.** 가짜 런타임의 `planTurn`은 `tests/plan-fixture.mjs`가 단계마다 준 응답을 돌려주고, 도는 동안 `state.verifying`을 켠다. 기획 폴더 경로는 planId가 uuid인지 확인한 뒤에만 만든다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/team-*.test.mjs tests/live-runtime.test.mjs tests/lean-office.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: run a Hub plan's PM step on the PL's team Office inside its one-run gate`

더하기만: `planTurn`은 새 메서드다. 기획 운전자는 live일 때만 생기고, 기획 일이 없으면 claim tick은 지금과 같은 `scheduler.tick()`이다. `RepoLane`·스케줄러·실행기는 바뀌지 않는다.

### Task 7: G1·G3 확인과 kit 기록

**Files:**
- Create: `src/team/plan-gates.ts`
- Modify: `src/core/kit-role-runs.ts`(`kitG1`의 넷째 인자, 새 `kitG3`)
- Test: `tests/team-plan-gates.test.mjs`, `tests/kit-role-runs.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 1의 `PlanRecord`·`PlanApproval`·`planTextHash`·`hasOpenBlocking`, Task 5의 `parseStory`·`renderTeamStory`·`renderTeamDesign`·`approvedStory`·`TeamSplit`, Task 4의 `decidedOf`·`repoFolders`, 기존 `writeOnce`·`kitStoryHash`.
- Produces:
  - `kitG1(view: string, challengeId: string, record: Record<string, unknown>, source: "office-approval" | "hub-approval" = "office-approval"): string`
  - `kitG3(design: string, storyView: string, approvalId: string, record: Record<string, unknown>): string` = `{...record, gate: "G3", designHash: digest(design), storyHash: kitStoryHash(storyView), responseRef: "hub-approval:<approvalId>"}`
  - `export class PlanGateError extends OfficeError`(code `PLAN_GATE`, 메시지는 쉬운 한국어)
  - `checkApprovals(plan: PlanRecord, o: { needSplit: boolean }): { g1: PlanApproval; g3: PlanApproval | null; story: PlanningStory; split: TeamSplit | null }`: G1이 있고 `memberId === plMemberId`이고 `textHash === planTextHash(draft.text)`, `hasOpenBlocking` 거짓, `parseStory(draft.story)` 뒤 `renderTeamStory(story, decidedOf(rounds)) === draft.text`. 높은 위험이고 `needSplit`이면 G3가 같은 사람·`planTextHash(design)`, 저장된 split을 다시 검사하고 `renderTeamDesign(split, …) === design`.
  - `writeGateRecords(dir: string, plan: PlanRecord, a: { g1: PlanApproval; g3: PlanApproval | null }): { storyView: string }`: `story.md`(= `approvedStory`), `g1.json`(= `kitG1(storyView, g1.approvalId, { planId, memberId, at, textHash }, "hub-approval")`), G3가 있으면 `design.md`·`g3.json`. 모두 `writeOnce`.
- 쉬운 말 이유: G1 없음·사람 다름 "Story 승인 기록이 이 기획의 PL 것이 아닙니다." / 해시·글 다름 "승인한 초안과 지금 초안이 다릅니다. 취소하고 새 Story로 시작하세요." / 막는 결정 "막는 결정이 남은 초안입니다." / G3 "설계 승인 기록이 맞지 않습니다."

- [ ] **Step 1: 실패하는 시험.**
  - "checkApprovals passes a G1 by the plan's PL whose hash is the draft's and whose story renders to the draft text"
  - "it refuses with a plain reason: no G1, a G1 by another member, a hash of other text, an OPEN BLOCKING line, a story that renders to other text; for high risk with a split: no G3, a G3 by another member, a design hash or split that does not match" **[Review Focus 5]**
  - "writeGateRecords writes story.md with Status: Approved, g1.json with gate G1, responseRef hub-approval:<id> and storyHash = kitStoryHash(draft), and for high risk design.md and g3.json; writing again with the same content passes and other content is KIT_SOURCE_CHANGED"
  - kit: "kitG1 keeps office-approval:<id> by default and writes hub-approval:<id> when asked; kitG3 binds the design hash and the story hash"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-plan-gates.test.mjs tests/kit-role-runs.test.mjs`
- [ ] **Step 3: 구현.** 기록은 기획 폴더에만 쓰고 대상 repo·체크아웃에는 쓰지 않는다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/planning-coordinator.test.mjs`(kit 역할 모드가 `kitG1`을 씀)를 더한다.
- [ ] **Step 5: 커밋.** `feat: check a plan's web approvals against the text the Office uses and record kit G1 and G3`

더하기만: `kitG1`의 새 인자는 기본값이 지금 값이라 `KitPlanning`의 기록이 같다.

### Task 8: 나누기 — Lead, 올리기, Story base 보호된 push, 열기

**Files:**
- Modify: `src/team/branch.ts`(`pushStoryBase`)
- Modify: `src/team/planner.ts`(`splitting` 단계, `planGitOps`에 `pushStoryBase`)
- Test: `tests/team-branch.test.mjs`(추가), `tests/team-planner.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 7의 `checkApprovals`·`writeGateRecords`, Task 5의 `acceptTeamLead`·`SplitRefused`, Task 2의 `PlanLink.publish|open|story`, `PLAN_LIMITS`·`planStoryKey`.
- Produces(`src/team/branch.ts`): `pushStoryBase(checkout: string, storyBase: string, sha: string, env: GitEnv): Promise<"created" | "exists">`
  - `storyBase`가 `/^feature\/story-\d+\/base$/`가 아니거나 `sha`가 전체 커밋 id가 아니면 git 없이 `PUSH_REFUSED`.
  - `ls-remote --heads origin refs/heads/<base>`: 같은 커밋이면 `"exists"`, 다른 커밋이면 `BASE_EXISTS`("레포에 <base>가 이미 다른 커밋으로 있습니다. 그 브랜치를 확인한 뒤 다시 시도하세요."), 없으면 `git push origin <sha>:refs/heads/<base>`(`pushTaskBranch`와 같은 설정 덮어쓰기, `+`·`--force` 없음) → `"created"`. push가 거절되면 다시 `ls-remote`로 같은 판정.
  - 주석 "The only write to a remote"를 두 쓰기로 고친다(D41).
- 나누기 단계(보통 위험):
  1. `checkApprovals(plan, { needSplit: false })` → `writeGateRecords`. 실패하면 Lead도 올리기도 없이 `failed`(그 이유).
  2. `plan.published`가 있으면 3을 건너뛴다. 없으면 Lead: `teamPlanningPacket(role "lead", story, retry: null)` → `planTurn` → `acceptTeamLead`. `PLANNING_INVALID`·`SPLIT_REFUSED`면 그 이유를 `retry`에 넣어 한 번 더, 또 거절이면 `failed` "AI가 Task를 두 번 나눴지만 검사를 통과하지 못했습니다." + 이유.
  3. `link.publish({ projectId, title: plan.title, body: storyView, risk: plan.risk, key: planStoryKey(plan.id), graph, storyVerify })`. Hub의 400 `GRAPH_*`도 2의 거절처럼 한 번 더 나눈다.
  4. `link.story(storyId)`의 `branches`마다: `bases.json`에 그 repo 커밋이 없으면 `fetchBaseTip(checkout, baseBranch)`를 적고(쓰기 한 번), 적은 커밋으로 `pushStoryBase`. 하나라도 실패하면 `failed`(repo 이름 + 이유), `open`은 부르지 않는다.
  5. `link.open(storyId)`(409 `STATE`인데 `story()`가 `open`이면 연 것으로 친다) → 결과 `open {storyId}`.

- [ ] **Step 1: 실패하는 시험.**
  - branch: "pushStoryBase creates feature/story-<N>/base at the commit and the bare origin shows it; the same commit already there is exists; another commit there is BASE_EXISTS and nothing is pushed"
  - branch: "pushStoryBase refuses main, a task branch, a plus sign and a short sha with PUSH_REFUSED before git runs; the person's push.followTags sends no tag along"
  - planner: "a splitting lease checks the gates, writes the records, runs one Lead turn, publishes with key plan:<planId>, the plan's title, the approved story as body and risk normal, makes every Story repo's base at its recorded base branch tip, opens and posts open"
  - planner: "every base is pushed before open; a failing base posts failed naming the repo and open is never called; the Hub Story stays draft" **[Review Focus 4]**
  - planner: "a P5 failure, a SPLIT_REFUSED graph or a publish answered 400 GRAPH_OVERLAP runs the Lead once more with the reason in the packet's retry; a second refusal posts failed"
  - planner: "a retry (or an Office restarted mid-split) sees published on the lease: no Lead turn, the same Story (already true), the recorded commits reused even after main moved, a base already at that commit kept, and an open answered STATE on an open Story counts as opened" **[Review Focus 2, 4]**
  - planner: "a gate failure posts failed before any Lead turn or publish"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-branch.test.mjs tests/team-planner.test.mjs`
- [ ] **Step 3: 구현.** `bases.json`은 `{ [repoId]: sha }`, 0600, 처음 한 번 쓰고 그 뒤 읽기만 한다(같은 repo의 새 커밋을 덮어쓰지 않음).
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/team-*.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: split an approved plan into repo Tasks, publish it, make each Story base and open the Story`

더하기만: `pushTaskBranch`의 거절 규칙(`feature/story-1/base` 포함)과 기존 push 시험은 그대로다. 올리기·열기는 기존 Hub 경로를 PL의 연결로 부른다.

### Task 9: 높은 위험 — 설계와 G3, 저장된 나누기 올리기

**Files:**
- Modify: `src/team/planner.ts`(`design` 단계, `splitting`의 높은 위험 갈래)
- Modify: `tests/team-fixture.mjs`(`hubWithStory(t, { risk = "normal" } = {})`)
- Test: `tests/team-planner.test.mjs`(추가), `tests/team-executor.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 8의 나누기 2–5, Task 7의 `checkApprovals(plan, { needSplit })`, Task 5의 `renderTeamDesign`.
- 설계 단계(`design`): `checkApprovals(plan, { needSplit: false })` → Lead(Task 8의 2와 같은 한 번 더 규칙) → `renderTeamDesign`이 16384바이트를 넘으면 `failed` "설계가 너무 깁니다(16KB 넘음)." → 결과 `design {text, split}`. 아무것도 올리지 않는다.
- 높은 위험의 나누기: `checkApprovals(plan, { needSplit: true })`(G3 포함) → `writeGateRecords`(G3 포함) → Lead 없이 저장된 split으로 Task 8의 3–5(`risk: "high"`).
- R7: Task 실행 코드는 바꾸지 않는다. 아래 시험이 고정한다.

- [ ] **Step 1: 실패하는 시험.**
  - planner: "a design lease checks G1, runs the Lead turn and posts design with the decision.md text and the split; nothing is published and no base is made"
  - planner: "after G3 a splitting lease publishes the stored split with risk high and no Lead turn, makes the bases and opens; g3.json is written"
  - planner: "a stored split that no longer passes the graph checks, or a G3 that does not bind the design, posts failed"
  - executor: "a Task of a high-risk Story (opened after its G3) is written as a normal-risk contract and submitted" — `world(t)`가 `hubWithStory(t, { risk: "high" })`로 만든 Story에서 claim한 Task가 `story.risk === "high"`이고, `w.engine.submits[0].input.risk === "normal"`이며 엔진 제출이 일어남을 본다.
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-planner.test.mjs tests/team-executor.test.mjs`
- [ ] **Step 3: 구현.** 실행기 시험이 실패하면 R7 판정의 근거(계약은 늘 normal)가 틀린 것이다. 고치지 말고 멈춰 컨트롤러에 알린다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/native-story-task.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: show a high-risk plan's design for G3 and publish exactly the split it approved`

더하기만: 실행기·계약·엔진은 바뀌지 않는다(시험만 더함).

### Task 10: 실제 Hub와 팀 Office로 [새 Story]부터 가져갈 수 있는 Task까지

**Files:**
- Test: `tests/hub-plan-office.test.mjs`(`startTestHub`, `gitOrigins(t, ["app-be", "app-fe"])`, `createTeamOffice` + `tests/plan-fixture.mjs`의 가짜 런타임, 팀원 A는 `createClaimScheduler` + `storyLink` — `tests/hub-web-office.test.mjs`의 짜임)
- Modify(시험이 빈틈을 찾았을 때만): Task 1–9의 파일

**Interfaces:**
- Consumes: 모든 Task. PL의 팀 Office는 `--live` 가짜 설정, 실제 `branchOps`·`planGitOps`(HOME은 origins의 HOME), `claimMs` 50, `beatMs` 1000, `linkOf`·`planLinkOf`는 실제 토큰의 `storyLink`·`planLink`, `ghOf`는 늘 OK, 등록한 repo는 origins에서 clone한 폴더. 웹 행동은 실제 POST(쿠키·CSRF)다.

- [ ] **Step 1: 시험.**
  - "from 새 Story to a claimable Task: the web makes the project and the plan; the PL's Office asks one question; the web answer brings a draft; G1 on the web splits, publishes, makes feature/story-<N>/base on both origins at main's and develop's commits and opens; teammate A's lane claims a Task whose Story base is on its origin; g1.json cites hub-approval:<approvalId>"
  - "a high-risk plan stops at 설계 승인, opens only after G3, keeps risk high on the Hub, and A's lane claims its Task"
  - "a base push the app-fe origin refuses (its pre-receive hook) leaves the plan failed and the Story draft with no claimable Task; after the hook is gone 다시 시도 opens the same Story number" **[Review Focus 4]**
- [ ] **Step 2: 실행.** `node --experimental-vm-modules --test tests/hub-plan-office.test.mjs`. 기대: 처음부터 통과. 실패하면 원인을 판정 표의 근거와 함께 고치고 그 고침을 이 Task 커밋에 넣는다.
- [ ] **Step 3: 커밋.** `test: carry a Story from the Hub web through the PL's team Office to a Task a teammate can claim`

더하기만: 시험만 더한다.

### Task 11: 문서와 검증 기록

**Files:**
- Modify: `docs/LOCAL-PREVIEW.md`(팀 허브 절, "### 팀원 웹" 뒤에 "### PL 기획(새 Story)")
- Create: `docs/verification/2026-11-05-pl-planning.md`

- [ ] **Step 1: 사용 안내.** 새 프로젝트(내가 담당인 레포, 기준 브랜치), [새 Story](모든 레포 담당자만, 글 64KB까지, 위험도), 질문과 답(한 번에 3개, 5번까지, 막는 결정), 초안·고쳐 써 주세요·승인(G1), 높은 위험의 설계 승인(G3), 그 뒤 자동으로 Task 나누기·올리기·Story base·열기, 멈춤·다시 시도·취소, PL Mac이 해야 하는 일(켜져 있음, `--live`, 모든 레포 연결, 열린 Task가 없을 때), kit 기록 위치(`<root>/team/plans/<planId>/`), 한계(입력은 기획 시작 때의 나무, 실패한 base push 뒤 남는 브랜치, 설계 다시 쓰기 없음, 화면 저절로 새로 고침 없음).
- [ ] **Step 2: 검증 기록 뼈대.** 절: 만든 것(Task·커밋 표), 판정 적용(이 계획의 판정 표와 "판정과 다르게 한 것", 구현 중 바뀐 것), 자동 검사(X/X), 확인하지 않은 범위(실제 claude로 PM·Lead를 돌린 기획 품질, 큰 실제 repo의 입력 크기), **실제 확인 계획**(중간점검: 사내 OpenShift 허브 재배포 + 두 사람의 Mac. PL이 웹에서 새 Story → 질문·답 → G1 → 두 repo에 base → 팀원 Mac이 Task를 가져감, 높은 위험 G3 한 번, base push 실패 뒤 다시 시도 한 번). "실제 확인 전에는 PL에게 쓰라고 안내하지 않는다"를 적는다. **이 기록은 kit 리뷰를 시작하기 전에 끝내고, 그 뒤에는 고치지 않는다**(늦은 내용은 STATUS에 쓴다).
- [ ] **Step 3: 통과 확인.** 전체 `npm test` X/X(한 번에 하나), `npm run typecheck` exit 0, `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` exit 0, kit 시험 세 조각(`node scripts/kit-test-shard.mjs <i> 3`) 각각 300 s 안. `.ai-workflow/verification.json`은 세 조각이 이미 `V19`를 덮으므로 바꾸지 않는다.
- [ ] **Step 4: 커밋.** `docs: record the PL planning bundle`

STATUS 맨 위 항목은 G4 기록과 `graph.mjs delivery` 뒤에 컨트롤러가 전달 커밋에서 쓴다(kit 스냅샷이 STATUS를 덮는다). 검증 기록과 STATUS는 kit 노드 증거로 적지 않는다.

---

## 결정 → Task

| 설계·판정 | 어디서 |
|---|---|
| PL 1: 프로젝트에서 [새 Story], 평소 말로 | Task 1(`createPlan`), Task 3 |
| PL 2: PL Mac Office가 기획, 질문은 웹, 나갔다 와도 이어짐 | Task 1(정본·빌림), Task 2, Task 3, Task 6 |
| PL 3: kit 템플릿 초안, `OPEN BLOCKING`은 승인 전 답(D35 P1), 고쳐 쓰기·G1 | Task 1, Task 3, Task 5(`openBlocking`, Decisions), Task 6 |
| PL 4: repo·할 일·파일·검증·순서로 나누기, P5, 바로 올리고 열기, Story base | Task 5, Task 8, Task 10 |
| 위험도: 높음이면 설계 + G3 | Task 1, Task 3, Task 9(R7) |
| G1 기록: Hub 승인 id를 근거로 kit G1 | Task 1(`PlanApproval`), Task 7 |
| 승인 신뢰: 승인자가 PL인지, 같은 글인지 확인 | Task 1, Task 7 |
| 기획 입력은 글만, 한도를 늘림 | Task 1, Task 3(R9) |
| repo 권한: PL은 모든 repo 담당자 | Task 1(`ownsProject`·만들기·승인), Task 3 |
| 지키는 것: Hub는 먼저 연락하지 않음, 웹은 Hub 상태만 바꿈 | Task 2, Task 3, Task 6 |
| 원격 쓰기에 Story base 만들기를 더함(강제 push·삭제 없음) | Task 8 |
| 위험: PL Mac 의존이 웹에 보임 | Task 3(PL Mac 줄) |
| 여러 repo 기획 입력, 큐의 모양과 주기(맡긴 것) | Task 4, Task 6, 판정 R3·R4·R5 |
| 더하기만, CLI 흐름 유지 | Global Constraints, 각 Task의 "더하기만" |

## 이 계획 밖

- Story 검증·결과 화면·G4·main 머지·[고칠 것 추가](묶음 4). 열린 Story의 보드 취소 버튼도 묶음 4에서 정한다(기획 취소는 아직 열리지 않은 Story만 함께 취소).
- 파일 첨부와 링크를 따라가 읽기, Task 목록을 올리기 전에 고치는 화면(설계의 non-goal), 설계 다시 쓰기, 알림, 화면 저절로 새로 고침.
- 링크 API `publishStory`에 PL의 repo 담당자 검사 더하기(기존 동작 유지, 웹 기획은 만들기·승인에서 검사).
- Mac 토큰 길의 기획 전달, 실제 claude로 돌린 기획 품질 평가.
- 사내 OpenShift 허브 재배포와 두 사람 Mac 실제 확인은 네 묶음 뒤 중간점검에서 한다.

## 구현 중 바뀐 것

Task 1–11을 만들면서 사전 점검 판정(F1–F14: 구현 전에 컨트롤러가 계획과 Task들을 맞춰 보고 정한 것), Task 중 컨트롤러 판정(`Ruling`), 리뷰 수정으로 위 계획이 코드와 달라진 곳이다. 위 행과 줄은 고쳐 쓰지 않았다(Global Constraints의 새 오류 코드 줄만 고쳤다). 이유와 틀리면 드는 비용, 사람에게 보이는 결과는 [검증 기록](../verification/2026-11-05-pl-planning.md)의 "판정 적용"과 "사람에게 보이는 한계"에 있다.

- **Task 1:** 취소는 `open`이 아닌 끝나지 않은 상태에서만 되고, 함께 취소하는 Story는 아직 `draft`일 때만이다. 열린 기획은 진행 중 목록에서 빠진다(F4·F5). `myPlans`는 최근 바뀐 것부터(F9). 하고 싶은 일·답·메모는 CRLF·CR을 LF로 바꾼 뒤 센다(F13). 연결 경로의 모르는 기획·끝난 빌림은 404 `PLAN_GONE`(F11). `result open`은 Story가 이미 검증 중·G4 대기·완료여도 받는다. `next`는 돌려주는 살아 있는 빌림의 하트비트를 새로 적는다. 관리자가 아닌 사람의 취소 거절 문구는 "이 Story를 쓰는 PL이나 허브 관리자만 취소할 수 있습니다.", 여섯째 질문 거절은 "질문 차례는 5번까지입니다."다.
- **Task 2:** `storyRoute`가 `PlanBoard`를 받고, 시험 Hub는 `plans:false`로 기획 경로 없이 뜬다(F10). `planFailure`는 여덟 가지다: 위의 여섯에 `hub-too-old`(코드 없는 404, 기대 프로토콜 1·2의 426)와 `retry-split`(올리기의 400 `GRAPH_*`)을 더했다(F11). 기획 경로의 답만 나누고, 올리기·열기·Story 읽기의 404는 기획 실패다.
- **Task 3:** 기획이 있는 Hub의 빈 보드 문구가 바뀐다(F8). 취소 문구는 "취소하면 이 기획을 멈춥니다. 이미 올라간 Story가 아직 열리지 않았으면 함께 취소됩니다."다(F4). 새 프로젝트는 기획이 있는 Hub의 모든 팀원에게 보인다.
- **Task 4:** `planTree`는 넷째 인자 `log`를 받는다. `validPath`가 거절하는 경로, repo 하나 안에서 대소문자·NFC로 겹치는 경로(위 폴더 포함), repo 밖을 가리키는 링크는 빼고 개수를 한 줄로 말한다. `<dir>/candidates`를 먼저 만들고, repo 폴더 이름은 대소문자를 무시하고 겹침을 본다(F12, 리뷰 수정 `3d862fa`). 풀기는 `core.symlinks=true`이고, 얼리기 오류에는 코드와 repo 이름이 붙는다. `fetchBaseTip`은 `fetchTip`을 다시 쓴다(F6).
- **Task 5:** `questionsOf`·`coverageOf`를 빼서 기존 `acceptPlanning`·`proposal`도 그것을 쓴다(F3). 그래서 단일 Office `proposal`은 결함이 여럿인 답에서 첫째로 이름 대는 결함이 달라질 수 있다. `acceptTeamPm`은 질문 차례를 세지 않고(Office가 센다), 그린 초안에 `OPEN BLOCKING` 줄이 생기는 Story를 거절한다. `SplitRefused`에 `graphCode`가 있다.
- **Task 6:** `PlanGit`은 Task 6이 쓰는 셋만이다(F2). `TeamConfig`의 기획 타이머와 시험의 가짜 런타임을 채웠다(F14). 실행기 실패 문구는 해당하는 말 하나만 보인다. `CANDIDATE_CHANGED`·`UNSAFE_PATH`·그 밖의 오류에도 쉬운 첫 줄이 있다. Hub가 끝내 거절한 결과(400) 대신 쉬운 말 `failed`를 한 번 보내고(Hub가 받으면 기획은 멈춤), 5xx는 3번까지 다시 보낸다. 그 `failed`마저 거절되거나 다시 보내기가 다 실패해 결과를 버리면 600000 ms 동안 기획 일을 묻지 않는다(리뷰 수정 `cb5afe1`). 가져가기 전 실행기 확인은 기획이 따를 수 있을 때도 한다.
- **Task 7:** `kitG3`는 `designHash` 옆에 `decisionHash`(= 설계 해시)와 `storyHash`도 적는다(kit 자신의 G3 확인 모양, `2f1e100`). 저장된 나누기의 다시 검사는 P5를 다시 돌리지 않는다. 승인 기록은 uuid id·유한한 시각·문자열 해시여야 하고, 기록은 폴더 이름이 그 planId인 곳에만 쓴다.
- **Task 8:** base 커밋은 판정 표의 "첫 나누기 때"를 첫 나누기 단계에서 Story를 올린 직후(base를 만들기 바로 전)로 읽어 그때 받아 `bases.json`에 적는다. 그래서 기획 입력의 끝보다 새 커밋일 수 있다. 다시 시도 때 `published`가 있으면 Lead와 올리기를 건너뛴다(F1, 시험은 두 번째 올리기가 없음을 고정). 올리기 직전·열기 직전 하트비트로 확인하고, 올린 뒤 취소됐으면 Office가 그 draft Story를 취소한다. 주기 하트비트가 끊은 뒤에도 아무것도 쓰지 않는다(F5, `PlanLink.cancel`은 기존 취소 경로). Hub가 지금 안 되면 같은 빌림으로 3번까지 더 하고 Lead 나누기는 그 빌림 동안 메모리에 둔다. 열기의 `STATE`는 Story가 열림·검증 중·G4 대기·완료면 연 것이다. 올린 Story가 취소된 기획의 다시 시도는 base 전에 멈춘다. Hub가 돌려준 브랜치 이름이 `feature/story-<그 번호>/base`인지 본다. `pushStoryBase`는 push 도우미를 `pushTaskBranch`와 함께 쓰되 자기 ref 검사를 따로 둔다(F6).
- **Task 9:** 저장된 높은 위험 나누기를 Hub가 400 `GRAPH_*`로 거절하면 다시 나누지 않고 "취소하고 새 Story로"라고 멈춘다. 나누기 도우미를 모듈로 옮기는 것은 허용됐지만 하지 않았다. `world()`가 `risk`를 넘긴다(F14).
- **Task 10:** PL 팀 Office의 가져가기를 멈춰(`team pause`) 두고 시험한다. PL이 Task를 먼저 가져가지 않게 하는 것이고, "멈춤은 기획을 막지 않는다"(R4)도 끝에서 끝으로 고정한다. `app-fe` origin에 `develop` 브랜치를 만든다(F14).
- **Task 11:** LOCAL-PREVIEW의 새 절 밖 두 줄("팀원 웹" 알려진 한계의 "묶음 3은 아직 웹에 없다", "팀 Office"의 "없는 것: PL의 Story 올리기")을 이 묶음에 맞게 고쳤다.
