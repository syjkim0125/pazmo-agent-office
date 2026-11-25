# Story: Office가 story-qa 형식으로 Story를 짜고 읽는다

## Goal
1. As-is
   - Office가 만드는 Story는 아직 kit 형식이다.
     - 머리에 `Status`·`Owner`·`Understanding gate (G1)/(G4)` 줄이 있다.
     - 본문은 `Goal`·`Domain`·`MUST`·`SHOULD`·`OUT`·`Decisions`(`ASSUMED:`·`OPEN BLOCKING`)·`Verify`(`- V1 [M1].`)다.
   - 이 형식을 만들거나 읽는 곳:
     - 혼자 쓰는 Office의 PM·Lead 기획: `src/runners/planning.ts:813` `renderPlanningStory`, 역할 프롬프트 `assets/roles/pm.md`·`lead.md`, 출력 한도 `planning.ts:507-547`
     - G1 카드: `src/runtime/native-office.ts:740`
     - 허브 웹 기획(PL Office 초안·Task 나누기·G3 설계)
       - `src/runners/team-planning.ts:245`, `:258`, `:295`, `:300`
       - `src/team/planner.ts:383`
       - `src/team/plan-gates.ts:81`
     - 허브 초안 화면: `src/hub/plan-pages.ts:198-341`(kit 제목을 한국어로 바꿈, `ASSUMED:`를 "AI가 정한 것"으로)
     - 결과 승인 칸 QA 목록: `src/hub/story-approve.ts:14`(`## MUST`·`## Verify`를 글에서 읽음)
     - 팀 Task 계약 글: `src/team/story-contract.ts:148`·`:180`
     - 계약 형식 검사: `src/core/contract-shape.ts`(kit 규칙 그대로 옮긴 것)
     - 로컬 올리기: `src/team/upload.ts`
       - kit G1·G3 기록 JSON, `.ai-workflow/verification.json`, `kitStoryRefs`를 읽는다.
       - 안내 `skills/pazmo-hub-upload/SKILL.md`는 `/workflow`로 Story를 쓰라고 한다.
     - `init`이 프로젝트에 까는 `templates/ai-workflow/STORY.md`·`TASK.md`(`src/cli/project.ts:199`). 코드는 이 사본을 읽지 않는다.
   - 이 저장소의 개발은 이미 story-qa(pazmo-story-to-dev 0.2.2)로 한다. Office만 옛 형식을 써서 사람이 두 형식을 읽는다.
2. To-be
   - Office가 쓰는 Story는 story-qa의 Story 틀(`skills/story-qa/assets/STORY.md`)을 따른다.
     - Goal(As-is·To-be·Unchanged), Decisions(갈림길마다 선택지·고른 것·이유), Human decides(없으면 뺌), MUST, OUT, QA 순서다.
     - QA 줄은 `- Q1 [M1] (script). …` 모양이다. 대상은 `[M#]`, `[Unchanged]`, `[not shown]`이고, 실행 방식은 script·agent·person이다.
     - 맨 아래에 `---`, `Status: Draft | Approved`, `Owner:`를 둔다.
   - 위 As-is의 모든 곳이 이 형식을 쓰고 읽는다.
   - 로컬 올리기는 story-qa 형식 Story를 받고, kit 기록 파일을 읽지 않는다.
   - `templates/ai-workflow`를 지운다.
   - 사용자 Mac에 pazmo-story-to-dev 플러그인을 설치한다. 2026-11-24에 설치했다(0.2.2, user scope).
3. Unchanged
   - 사람이 보는 흐름은 그대로다.
     - Office: Tasks·Decisions(G1·G3·G4·질문), PM 질문 3번 제한.
     - 허브: 기획·G1·G3·결과 승인·dev PR, 팀 Task의 Story base 머지.
   - Story 해시 계산법(`src/core/story-hash.ts`)은 그대로다. 이미 허브에 올린 Story의 키(`upload:<hash>`)가 바뀌지 않는다.
   - 이미 허브에 있는 옛 형식 Story는 지금처럼 보인다. 결과 승인 QA 목록에도 MUST·Verify가 나온다.
   - 이미 등록된 계약으로 도는 작업(혼자 쓰는 Office의 작업, 팀 Task)은 그대로 돈다.
   - VM 격리, 실행기(codex·claude), 예산·횟수 제한, 검사 실행.

## Decisions
- D1. QA 시나리오와 등록 검사(VM에서 도는 argv)의 관계
  - Options: (a) Q마다 검사를 둔다. 지금의 V와 같다. / (b) script Q만 검사를 두고, agent·person Q는 결과 승인 칸 목록으로만 보낸다.
  - Pick: (a)
    - 지금 엔진 규칙은 "덮은 V마다 검사"(`src/core/contracts.ts:231`)와 Lead의 덮임 검사(`planning.ts` `coverageOf`)다. V를 Q로 바꾸기만 하면 엔진 동작이 그대로다.
    - (b)는 검사 없는 Task를 허용해야 해서 엔진을 바꾼다. agent·person을 AI가 돌리는 5단계 "QA 시작"에서 다룬다.
    - 실행 방식 표시는 이번에는 Story 글과 결과 승인 QA 목록에 보이기만 한다.
- D2. 승인 기록을 Story 글의 어디에 둘지
  - Options: (a) 맨 아래 `Status:` 줄에 둔다. 예: `Status: Approved (G1 hub-approval:<id> · 2026-11-24)` / (b) 새 줄 `Approved:`를 더하고 해시 계산에서도 뺀다.
  - Pick: (a)
    - `hashStory`는 `Status:`로 시작하는 줄을 이미 뺀다(`story-hash.ts:11`). 그래서 초안과 승인본의 해시가 같고 계산법도 그대로다.
    - (b)는 해시 계산을 바꾼다. 따로 배포되는 허브(`story-store.ts:984`가 해시를 다시 계산함)와 Office의 버전이 다르면 올리기가 거절된다.
  - `G4: PASS`·`Understanding gate (G4)` 줄은 쓰지 않는다. G4는 Office 원장과 허브 결과 승인 기록에 남는다.
- D3. 검사 id 모양
  - Options: (a) Story와 검사 모두 `Q<n>`. 허브는 `V<n>`과 `Q<n>`을 둘 다 받는다. / (b) Story는 Q, 허브로 보내는 검사 id는 `V<n>` 그대로.
  - Pick: (a)
    - (b)는 허브 화면과 Task spec(`Covers: … / V1`)에서 Story에 없는 번호가 보인다.
    - 허브는 지금 `V\d{1,3}`만 받는다(`src/hub/story-protocol.ts:30`). 그래서 배포 순서가 생긴다(Human decides).
- D4. PM이 무엇을 내놓는지
  - Pick
    - PM JSON을 Story 틀에 맞춘다: `asIs`·`toBe`·`unchanged`, `decisions[{fork, options, pick, because}]`, `copies`, `must`, `out`, `qa[{refs, how, scenario}]`.
    - `domain`·`should`·`assumptions`를 뺀다. AI가 정한 것은 Decisions의 Pick이 대신한다.
    - Office 검사는 지금 MUST 덮임을 지키듯 story-qa 규칙도 지킨다. MUST마다 Q가 있고, `[Unchanged]` Q와 `[not shown]` Q가 하나 이상 있어야 한다.
  - 팀 기획에서 PL이 답한 질문(지금은 Decisions의 `PL 답:` 줄, `team-planning.ts:247`)은 Human decides에 `<질문> → <답>`으로 간다.
  - 허브 초안 화면의 "AI가 정한 것" 칸은 Decisions의 Pick을 보여 준다.
- D5. Office 안의 Task 글(엔진 계약용)
  - Pick: Task 모양은 그대로 둔다. Outcome·Covers·Scope·Constraints·검사이고, V만 Q로 바꾼다. 제목은 `Covers — Story M/Q IDs`다.
  - story-qa에는 Task 틀이 없다. Task 글은 Office 엔진만 읽는다(`contracts.ts:163-188`).
- D6. 프로젝트에 까는 템플릿 사본
  - Pick: `init`이 `.pazmo-office/STORY.md`·`TASK.md`를 더 만들지 않는다.
    - 코드는 이 사본을 읽지 않는다. `git grep`으로 보면 쓰는 곳은 `project.ts:199-203`뿐이다.
    - 저장소 문서는 skill을 가리키기만 한다는 규칙(`AGENTS.md`)과도 맞는다.
  - 이미 깔린 사본은 `remove`가 지금처럼 manifest로 처리한다.
- D7. Office 플러그인 허용 목록
  - Pick: pazmo-story-to-dev를 넣지 않는다.
  - Office의 claude는 `--setting-sources ""`(`src/runners/claude-profile.ts:48`)로 돈다. 2026-11-24에 같은 플래그로 띄운 claude의 init 기록을 봤다. 실린 플러그인은 조직 관리 플러그인 하나와 기본 플러그인뿐이었고, 이 플러그인은 없었다.
  - Office 역할은 story-qa skill이 아니라 Office 자체 프롬프트로 돈다.
- Copies
  - Story를 만드는 곳: 혼자 쓰는 Office의 PM, 팀 PL Office의 PM, 팀 Task 계약 글, 로컬 올리기(사람이 씀).
  - Story를 읽는 곳: 계약 형식 검사, G1 카드, 허브 초안 화면, 결과 승인 QA 목록, 올리기 검사.
  - G3 설계 글의 kit 줄(`# Decision requiring human G3`, `Understanding gate (G3): pending`): `planning.ts:905`, `team-planning.ts:295`.
  - 모두 바꾼다. 허브의 두 읽는 곳(초안 화면, 결과 승인)은 옛 형식도 계속 읽는다(Unchanged).

## Human decides
- H1. 업그레이드 때 진행 중인 옛 형식 기획(저장된 데이터)
  - 해당하는 기획: G1 전 초안이 있는 혼자 쓰는 Office의 기획, 허브 웹 기획의 초안·설계.
  - 새 코드는 저장된 PM 결과로 Story를 다시 그려 승인과 맞춰 본다(`src/core/intake.ts:413`, `plan-gates.ts:81`). 그래서 옛 결과는 맞지 않는다.
  - (가) "옛 Story 형식으로 만든 기획입니다. 취소하고 다시 만드세요"로 멈춘다. 3단계와 같은 방식이고 데이터는 지우지 않는다.
  - (나) 옛 그리기 코드를 남겨 옛 기획은 옛 형식으로 끝까지 간다.
  - 추천은 (가)다. (나)는 kit 형식 코드가 계속 남는다.
  - 고름: (가). 사용자가 2026-11-24에 "맞아, 모두 (가)로 진행"이라고 답했다.
- H2. 로컬 올리기(`team upload`)가 무엇을 승인으로 볼지
  - 지금은 kit G1 기록 JSON(G3면 설계 파일 지문까지)이 Story 해시를 묶는다. story-qa는 채팅에서 승인하고 기록 파일을 남기지 않는다.
  - (가) Story 맨 아래 `Status: Approved`를 승인으로 본다. PL이 자기 Mac에서 직접 명령을 돌린다. G3 확인은 없다. story-qa에는 G3가 없고, Task 파일의 risk는 표시로만 올라간다.
  - (나) 올린 Story는 허브에 초안으로 들어가고, PL이 허브 웹에서 G1(high면 G3도)을 누른 뒤 열린다. 허브를 고쳐야 한다.
  - 추천은 (가)다. kit 기록도 로컬 파일이었으므로 묶는 힘은 비슷하다. 다만 high risk의 설계 승인 확인이 사라진다.
  - 고름: (가).
- H3. 배포 순서(D3)
  - 회사 허브를 먼저 이 버전으로 다시 배포해야 한다. 그 뒤에 PL Mac의 Office가 Q 검사 id로 기획·올리기를 한다.
  - 거꾸로 하면 옛 허브가 "검사 id가 V가 아님"으로 거절한다.
  - 배포는 사용자가 `oc login --web`을 한 뒤 에이전트가 한다. D3을 (b)로 바꾸면 순서는 필요 없다.
  - 고름: (가) 허브를 먼저 배포한다.
- 직접 확인에서 사람이 할 일
  - Office 화면과 허브 웹의 G1·G4·결과 승인을 사람이 누른다.
  - 테스트 레포(be·fe)에 Story base·Task 브랜치를 쓰는 것을 그때마다 허락한다.

## MUST
- M1. 혼자 쓰는 Office의 기획이 story-qa 형식 Story를 만든다.
  1. PM 결과로 그린 `story.md`가 Goal(As-is·To-be·Unchanged)·Decisions·(Human decides)·MUST·OUT·QA 순서이고, 맨 아래에 `Status: Draft`·`Owner:`가 있다.
  2. G1 카드가 영어 제목 Goal·MUST·OUT·QA로 보인다. Goal 안은 지금·바뀐 뒤·그대로이고, QA 줄에는 실행 방식이 있다. Decisions·Human decides는 카드 아래 원문에 있다.
     - 승인 뒤 고침(2026-11-24, Q3 중 사용자 요청 "제목이 영어고 내용은 한국어로 해. Goal, Must, Not, QA 이렇게"): 승인 때 문구는 "그 형식의 말(지금·바뀐 뒤·그대로, 정한 것, 꼭 할 것, 하지 않을 것, QA와 실행 방식)"이었다. 사용자가 제목 이름은 Goal·MUST·OUT·QA, 바꿀 화면은 G1 카드만 골랐다.
  3. Lead의 Task가 Q 번호를 덮고, 덮은 Q마다 검사가 있다. 계약이 등록된다.
  4. kit 형식(Domain·SHOULD·Verify·gate 줄)으로 쓴 Story는 계약 등록에서 이유와 함께 거절된다.
- M2. 허브 웹 기획이 같은 형식으로 돈다.
  1. PL Office 초안과 PL 답이 Human decides에 들어간다.
  2. G1 뒤 승인본의 `Status:` 줄에 웹 승인이 적힌다.
  3. Task 나누기의 covers·검사 id가 Q다. G3 설계 글에 kit 줄이 없다.
  4. 허브 초안 화면은 새 제목을 한국어로 보여 준다. 개수 줄은 "꼭 할 것 n · 하지 않을 것 n · QA n"이다.
- M3. 결과 승인 칸 QA 목록
  1. 새 형식 Story는 MUST와 Q 줄을 실행 방식과 함께 보여 준다.
  2. 옛 형식 Story는 지금처럼 MUST와 Verify를 보여 준다.
- M4. 로컬 올리기가 story-qa 형식 Story를 받는다.
  1. H2에서 고른 승인 확인을 한다. covers·검사 id는 M·Q다.
  2. `.ai-workflow/` 아래 파일을 읽지 않는다.
  3. kit 형식 Story는 "story-qa 형식으로 다시 쓰세요"라는 이유로 거절한다.
  4. `skills/pazmo-hub-upload/SKILL.md`와 `team upload --guide`는 `/story-qa`(pazmo-story-to-dev)를 가리킨다. 단계는 옮겨 적지 않는다.
- M5. 허브가 Q 검사 id를 받는다. V 검사 id로 이미 저장된 Story·Task는 그대로 돈다.
- M6. 진행 중인 옛 형식 기획은 H1에서 고른 대로 처리한다.
- M7. kit 형식 흔적을 지운다.
  1. `templates/ai-workflow/`를 지우고, `init`이 템플릿 사본을 만들지 않는다.
  2. `upstream/ai-workflow-kit.lock.json`과 고지 문서(`THIRD_PARTY_NOTICES.md`·`LICENSING.md`)의 템플릿 줄을 정리한다.
  3. `src`·`tests`·`skills`·`assets`에서 "kit"이 남는 곳은 3단계의 (가) 멈춤 한 곳과 `pazmo_kit_*` 표 읽기뿐이다.
- M9. PM·Lead가 쓰는 글(Story 내용, 계획, Task의 결과·범위·제약)은 요청한 사람의 말로 쓴다. 한국어 요청이면 한국어다. 제목과 표식(`## Goal` 같은 절 이름, As-is·To-be·Unchanged, Options·Pick, M·Q 번호, script·agent·person)은 영어 그대로다.
  - 승인 뒤 더함(2026-11-24, Q3에서 한국어 요청에 영어 Story와 계획이 나옴. 사용자 요청 "내용은 한국어로 해").
- M8. 문서를 실제와 맞춘다: `AGENTS.md`의 템플릿 줄, `README`·`CONCEPTS.md`의 Story 형식 설명, `docs/STATUS.md`. 형식은 skill을 가리킨다.

## OUT
- O1. agent·person QA 시나리오를 AI가 돌리기("QA 시작"): 5단계.
- O2. (가) 멈춤 코드와 `pazmo_kit_*` 표 지우기: 정리 단계.
- O3. 저장된 옛 형식 Story를 새 형식으로 바꿔 쓰기: 지우거나 고치지 않고 읽기만 한다.
- O4. Office G1·G3·G4 자체를 줄이거나 바꾸기: 요청 밖이다.
- O5. Office 역할 실행에 story-qa skill을 싣기: Office는 자체 프롬프트로 돈다(D7).
- O6. 회사 허브 배포 자체: 이 변경을 머지한 뒤 H3 순서에 따라 따로 한다.

## QA
Environment: local (docs/qa.md)
Script: qa/story-format-story-qa.sh
- Q1 [M1] (script). 이 저장소 · PM 결과 고정본 · `renderPlanningStory` 출력 → `## Goal`, `## Decisions`, `## MUST`, `## OUT`, `## QA`가 이 순서로 있다. `- Q1 [M1] (script).` 모양 줄이 있고, 마지막 줄들이 `---`, `Status: Draft`, `Owner:`다. `## Verify`·`## Domain`·`Understanding gate`는 없다.
- Q2 [M1] (script). 이 저장소 · 새 형식 Story·Task 고정본과 kit 형식 Story 고정본 · 계약 형식 검사(`storyShapeErrors`) → 새 형식은 오류 없음. kit 형식은 `QA` 절이 없다는 오류가 나온다.
- Q3 [M1] (person: G1·G4는 사람이 누름. 나머지는 agent). 혼자 쓰는 live Office · 작은 테스트 git 프로젝트 · "README에 한 줄 추가" 작업 → 다음이 이어진다.
  - G1 카드가 새 형식 말로 보인다.
  - Lead 계획과 Q 검사.
  - 구현 → VM 검사 → 리뷰 → G4.
- Q4 [M2] (person: PL이 웹에서 답·G1을 누르고 테스트 레포 쓰기를 허락함. 나머지는 agent). 확인용 허브 사본 + 사본 PL Office(live) · 작은 Story 기획 → 다음을 확인한다.
  - 초안 화면에 "지금·바뀐 뒤·그대로 / 정한 것 / 꼭 할 것 / 하지 않을 것 / QA" 제목과 개수 줄이 보인다.
  - G1 뒤 Story 글의 `Status:` 줄에 웹 승인이 있다.
  - Task 화면의 검사 id가 Q다.
  - 승인 뒤 고침(2026-11-25): 사본 확인 환경이 다른 세션의 정리로 멈춘 뒤, 사용자가 "사내 fusion에 올려서 실제로 동작하는지" 보자고 했다. 그래서 머지하고 회사 허브를 다시 배포한 뒤(H3) 회사 허브와 이 Mac의 PL Office로 확인한다("그 순서로 진행").
- Q5 [M3] (script). 이 저장소 · 새 형식 본문과 옛 kit 형식 본문 · `approvalPlan` → 새 형식은 `Q1 [M1] (script) …` 줄이 QA 목록에 있다. 옛 형식은 지금과 같은 `V1 … — 이 장면 그대로인지` 줄이 나온다.
- Q6 [M4] (script). 이 저장소 · 고정 프로젝트 · `checkUpload`와 `team upload --guide` → 결과는 다음과 같다.
  - 새 형식 + `Status: Approved`는 통과한다(H2 (가)일 때).
  - `Status: Draft`는 `UPLOAD_G1`로 거절된다.
  - kit 형식은 `UPLOAD_STORY`와 "story-qa"가 든 문구로 거절된다.
  - `--guide` 출력에 `/story-qa`가 있고 `/workflow`가 없다.
- Q7 [M5] (script). 이 저장소 · `validateGraph`·`validateStoryVerify` → `Q1` 검사 id를 받는다. `V1`도 받는다. `X1`은 거절한다.
- Q8 [M6] (script). 이 저장소 · 옛 PM 결과가 저장된 기획(혼자·팀) 시험 → H1에서 고른 대로 된다. (가)면 이유 문구와 함께 멈추고, 다른 기획은 돈다.
- Q9 [Unchanged] (script). 이 저장소 · 3단계 Q5의 시험 Story 고정본 · `hashStory` → 3단계 때와 같은 값이다. 새 형식 초안과 그 승인본(`Status:` 줄만 다름)의 해시가 같다.
- Q10 [Unchanged] (script: 명령 `npm test`, `npm run typecheck`). 이 저장소 · Node 24 → 모두 통과한다. 옛 형식 Story의 허브 화면 시험(`tests/hub-plan-*.test.mjs` 등)도 그대로 통과한다.
- Q11 [M7] (script). 이 저장소 · `git ls-files templates/ai-workflow`, scratch 프로젝트에 `init --apply`, `git grep -ni "kit" -- src tests skills assets` → 결과는 다음과 같다.
  - 첫째는 아무것도 나오지 않는다.
  - `.pazmo-office/`에 `STORY.md`·`TASK.md`가 없다.
  - 셋째는 (가) 멈춤 한 곳과 `pazmo_kit_*` 표 읽기, 그 시험만 나온다.
- Q13 [M9] (script). 이 저장소 · `assets/roles/planning-common.md`와 PM·Lead 프롬프트(`planningPrompt`) → "Write every text value in the language of the person's request" 문장이 있다. 제목·표식은 영어로 둔다는 문장도 있다.
  - 승인 뒤 더함(2026-11-24, M9와 함께).
- Q14 [M1, M9] (person: 작업 만들기·G1·G4는 사람이 누름. 나머지는 agent). Q3과 같은 live Office · 한국어로 작업을 만든다 → G1 카드 제목이 Goal·MUST·OUT·QA이고, 카드와 원문 Story·계획의 내용이 한국어다.
  - 승인 뒤 더함(2026-11-24, M1.2 고침과 M9).
- Q12 [not shown] (agent: Q3·Q4를 돌리며 본다). Office G1 카드, 허브 초안·결과 승인 화면 · 새 형식 Story → `Understanding gate`, `G4: PASS`, `ASSUMED`, `OPEN BLOCKING`, `Domain`, `SHOULD`, `Verify` 글자가 보이지 않는다.

---
Status: Approved (2026-11-24, "맞아, 모두 (가)로 진행")
Owner: JongKun Kim
