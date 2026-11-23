# Story: Office가 kit 실행기 없이 작업을 기획하고 구현·리뷰·검증한다

## Goal
1. As-is
   - Office는 작업마다 kit 그래프(`.ai-workflow/bin/graph.mjs`)를 함께 돌린다.
     - 혼자 쓰는 Office의 작업: PM·Lead가 kit 기획 그래프로 돈다(`src/runners/kit-planning.ts`).
     - 구현이 있는 모든 작업: 구현·검사·리뷰가 kit 전달 그래프로 돈다(`src/runners/kit-delivery.ts`). 팀 Story Task도 같다(`src/runtime/live.ts:651`이 늘 `KitDelivery`를 넘긴다).
     - 계약 등록은 kit의 `check.mjs`로 형식을 검사한다(`src/core/contracts.ts:145-160`).
   - 하지만 횟수 제한, 낡은 후보 감지, 검사 결과를 후보·회차에 묶기, 리뷰 판정, G1·G3·G4 승인은 이미 Office 자기 기록(Verification·Handoff·Execution·Approval·Completion 원장)이 지킨다.
   - kit은 같은 일을 한 번 더 기록하며 느리고 무겁다. 그래서 2단계에서 남긴 kit 실행기를 지울 수 없다.
2. To-be
   - Office는 kit 그래프 없이 자기 원장만으로 같은 흐름을 돈다.
     - 기획: PM 질문 → Story → G1 → Lead 계획.
     - 전달: 구현 → 검사(VM) → 다른 실행기로 리뷰 → G4.
     - 팀 Story Task: 구현 → 검사 → 리뷰 → Story base 머지.
   - `.ai-workflow/bin`과 `.ai-workflow/graph`를 지운다.
   - kit에서 가져다 쓰던 순수 함수는 Office 코드로 옮긴다(Story 해시, G1·G3 기록 모양, Story 형식 검사). Story 해시는 바이트 단위로 같아서, 이미 허브에 올라간 Story의 올리기 키가 그대로다.
3. Unchanged
   - 사람이 보는 흐름: Office의 Tasks·Decisions(G1·G3·G4·질문), 허브의 기획·G1·G3·결과 승인·dev PR, 팀 Task의 Story base 머지.
   - **Office에서 Story를 짜는 부분**: PL의 팀 Story 기획(질문·초안·설계·Task 나누기·웹 G1·G3)과 로컬 올리기(`team upload`). kit 그래프는 원래 쓰지 않으며, Story 글 형식(Goal·MUST·Verify 등)도 그대로다.
   - Story 형식과 `templates/ai-workflow/STORY.md`·`TASK.md`는 4단계에서 바꾼다.
   - VM 격리, 실행기(codex·claude), 예산·횟수 제한, 검사 명령.

## Decisions
- D1. 혼자 쓰는 Office의 기획에서 질문
  - Options: Office 자체 기획 길을 그대로 씀(PM만 묻고 최대 3번) / Lead도 묻게 새로 만듦
  - Pick: Office 자체 길(`intake.accept`, `src/runners/planning.ts:588-591`)을 쓴다.
    - kit 경로에서만 Lead가 물을 수 있었고, kit 경로는 Office의 3번 제한을 꺼 두었다(`planning.ts:591`, `:763`).
    - 그래서 kit을 걷으면 PM만 묻고 3번 제한이 다시 켜진다. Lead 질문은 사라진다.
- D2. 기획을 이어 할 때 같은 단계를 두 번 돌리지 않는 보장
  - Options: Office intake 이벤트로 지킴 / 새로 만듦
  - Pick: Office의 intake 이벤트와 실행 임대로 지킨다(`intake.ts`, `budgets.ts`).
    - kit run 파일이 하던 "한 번 낸 기획 결과를 다시 돌리지 않음"(`kit-planning.ts:62-66`, `:215-218`)은 Office 자체 길에 이미 있는 대화 상태로 대신한다.
    - 시험으로 확인한다.
- D3. G4 증거
  - Pick: kit 영수증(`kitReceipt`)을 G4 증거에서 뺀다(`src/core/completion.ts:151`, `:175`, `:368`, `:389`).
  - 남는 증거는 Office의 검사·리뷰 원장이고, 이것이 원래 판정 근거다.
- D4. 계약 형식 검사
  - Pick: `check.mjs`의 `checkArtifact`가 하던 Story·Task 모양 검사를 Office 코드로 옮긴다. 규칙은 지금과 같게 둔다(4단계에서 양식과 함께 바꾼다).
- D5. 사용자에게 보이는 글
  - Pick: `KIT_*` 오류 코드와 "kit workflow로…" 같은 문구 가운데 이번에 사라지는 경로의 것은 지운다.
  - 로컬 올리기의 kit 문구와 `skills/pazmo-hub-upload`는 Story 양식과 함께 4단계에서 바꾼다.
- Copies
  - 혼자 쓰는 Office: 접수 길 네 곳이 모두 kit 표시를 켠다(`native-office.ts:1165`, `:1199`, `:699`, `operator.ts:204`).
  - 팀 Story Task: `native-office.ts:1329-1359`.
  - 둘 다 바꾼다.

## Human decides
- 진행 중인 kit 작업(저장된 데이터)을 업그레이드할 때 어떻게 할지. kit 기록(`pazmo_kit_assignments`·`pazmo_kit_receipts`)이 있는 작업이 남아 있을 수 있다.
  - (가) 그런 작업은 "kit 시절에 시작한 작업입니다. 취소하고 다시 만드세요"로 멈춘다. D36의 kit 4→5 때와 같은 방식이다.
  - (나) 자동으로 Office 원장만 쓰는 작업으로 이어 준다.
  - 추천은 (가)다. (나)는 kit이 들고 있던 진행 상태를 옮겨야 해서 크고 위험하다.
- 직접 확인에서 사람이 할 일:
  - Office 화면에서 G1·G4를 직접 누르는 것. 에이전트는 Decision을 대신 승인하지 않는다.
  - 테스트 레포(be)에 Story base·Task 브랜치를 쓰는 것을 허락하는 것.

## MUST
- M1. 혼자 쓰는 Office의 작업이 kit 그래프 없이 기획한다.
  1. PM이 질문한다(최대 3번).
  2. Story가 Decisions의 G1 카드로 온다.
  3. G1 뒤에 Lead가 계획한다.
  4. 계약을 등록한다.
- M2. 구현이 있는 작업(혼자 쓰는 Office와 팀 Story Task 모두)이 kit 그래프 없이 구현 → VM 검사 → 다른 실행기로 리뷰를 돈다.
  1. 고칠 것이 있으면 다시 구현한다. 회차 제한(3번)은 그대로다.
  2. 혼자 쓰는 Office는 G4 카드로, 팀 Task는 Story base 머지로 끝난다.
- M3. `.ai-workflow/bin`·`.ai-workflow/graph`, `src/runners/kit-delivery.ts`·`kit-planning.ts`·`kit-check-relay.mjs`, `src/core/kit-role-runs.ts`를 지운다. `src`와 `tests`는 `.ai-workflow/`를 읽지 않는다.
- M4. Story 해시와 G1·G3 기록 모양은 Office 모듈로 옮기고 결과는 같다. 같은 Story 글이면 같은 해시가 나온다.
- M5. 진행 중인 kit 작업은 Human decides에서 고른 대로 처리한다.
- M7. kit 흔적을 지운다(승인 뒤 사용자 요청 "kit흔적은 그냥 다 지우는거 어때?", 2026-11-20). 범위는 사용자가 고른 세 답("4단계에서", "남기고 읽기만", "기록은 둔다")을 따른다.
  1. 코드의 `kit` 이름(함수·파일·모듈·타입), `KIT_*` 오류 코드, "kit" 프롬프트 문구를 없앤다.
     - Story 해시는 이름만 바꾸고 계산은 그대로다(M4).
     - 사라지는 경로의 코드는 지우고, 남는 경로의 코드는 Office 이름을 붙인다(예: `INTEGRITY` 대신 해당 오류).
  2. PL 기획이 기획 폴더에 쓰지만 아무도 읽지 않는 kit 형식 기록(`g1.json`, `g3.json`)을 더 쓰지 않는다(`plan-gates.ts` `writeGateRecords`).
  3. `upstream/kit.lock.json`을 지운다. `upstream/ai-workflow-kit.lock.json`에는 템플릿 출처만 남긴다(템플릿은 4단계까지 남음).
  4. 예외로 kit 글자가 남는 곳:
     - kit 시절 작업을 알아보고 멈추는 한 곳(Human decides (가)). `pazmo_kit_*` 표를 읽는다.
     - 4단계 몫(O1): `templates/ai-workflow`, 로컬 올리기, upload skill.
     - 지난 기록 문서.
- M6. 문서를 실제와 맞춘다.
  - `README`, `CONCEPTS.md`, `docs/LOCAL-PREVIEW.md`의 "kit이 역할 전이를 소유한다" 같은 문장.
  - `THIRD_PARTY_NOTICES.md`·`LICENSING.md`의 kit 실행기 줄.
  - `upstream/kit.lock.json`.

## OUT
- O1. Story 양식과 `templates/ai-workflow`, 로컬 올리기의 kit 기록 파일 읽기, `skills/pazmo-hub-upload`의 `/workflow` 안내: 4단계.
- O2. Office의 G1·G3·G4 Decision 자체를 줄이거나 바꾸기: 요청 밖이다. 사람이 보는 흐름은 그대로다.
- O3. story-qa 플러그인 설치: Office 역할 실행은 Office 자체 프롬프트를 쓴다. PL이 Story를 쓰는 길이 바뀌는 4단계에서 설치한다.
- O4. "QA 시작": 5단계.
- O5. SQLite의 `pazmo_kit_*` 표 지우기: 남겨 두고 읽지 않는다. 이미 있는 데이터를 지우지 않는다.

## QA
Environment: local (docs/qa.md)
- Q1 [M3]. 이 저장소 · `git ls-files .ai-workflow`, `git grep -n "\.ai-workflow/\|kit-role-runs\|KitDelivery\|KitPlanning" -- src tests` → 앞의 것은 아무것도 나오지 않는다. 뒤의 것은 O1 몫(로컬 올리기가 PL 프로젝트의 `.ai-workflow/approvals`·`verification.json`을 읽는 `src/team/upload.ts`와 그 시험)만 나온다.
  - 승인 뒤 고침(2026-11-23): 승인 때 문구는 "둘 다 아무것도 나오지 않는다"였는데 O1과 맞지 않았다. 로컬 올리기는 4단계까지 PL 프로젝트의 kit 기록 경로를 읽는다. 목적(Office가 kit 실행기를 부르지 않음)은 그대로이고, 보고에서 사람에게 다시 보인다.
- Q2 [M1, M2]. 이 저장소 · Node 24 · `npm test`, `npm run typecheck` → 모두 통과한다. 기획·전달·팀 Task 시험이 kit 없는 길로 돈다.
- Q3 [M1, M2]. 혼자 쓰는 live Office · 작은 테스트 git 프로젝트, codex 또는 claude 로그인 · Tasks에서 "README에 한 줄 추가" 같은 작업을 만든다 → 다음이 kit 없이 돈다:
  - PM 질문(있으면 사람이 답함)
  - G1 카드(사람이 승인)
  - Lead 계획
  - 구현
  - VM 검사
  - 리뷰
  - G4 카드(사람이 승인)
  - 화면과 로그에 kit 오류가 없다.
- Q4 [M2]. 확인용 허브 사본 + 사본 PL·팀원 Office(live), be 테스트 레포 · 작은 Story 하나를 열고 Task를 Office가 가져간다 → 구현 → 검사 → 리뷰 → Story base 머지까지 kit 없이 돈다. 테스트 레포에 쓰는 일은 사람이 허락한 때만 한다.
- Q5 [M4, Unchanged]. Story 글 하나(이 저장소의 시험 Story 고정본) · 옮긴 해시 함수와 지운 kit의 `storyContract` 결과(`git show b6407d7` 시점) → 같은 값이다.
- Q6 [Unchanged]. 허브 웹 기획(질문 → 초안 → G1 → 설계 → Task 나누기)과 `team upload --guide` → 시험이 그대로 통과하고 화면 문구가 그대로다.
- Q7 [M5]. kit 기록이 있는 진행 중 작업을 가진 데이터 폴더 사본 · 새 코드로 Office를 켠다 → Human decides에서 고른 대로 된다. (가)면 그 작업이 이유와 함께 멈추고, 다른 작업은 돈다.
- Q9 [M7]. 이 저장소 · `git grep -ni "kit" -- src tests scripts upstream` → 남은 것은 M7의 예외(kit 시절 작업 멈춤 한 곳과 그 시험, 4단계 몫인 로컬 올리기·템플릿·upload skill 관련)뿐이다.
- Q8 [not shown]. Office 화면, 혼자 쓰는 Office의 CLI 오류 · 이번에 사라지는 경로 → "kit" 글자나 `KIT_*` 코드가 보이지 않는다.

---
Status: Approved
Owner: JongKun Kim
