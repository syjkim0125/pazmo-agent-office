# 2026-10-15 Office 캐릭터 역할 중심 정리 (B) 검증

Story: M13 · V15 · D21. 결정: [office-role-characters-decision.md](../understanding/office-role-characters-decision.md). 계획: [2026-10-15-1700-feat-office-role-characters-plan.md](../plans/2026-10-15-1700-feat-office-role-characters-plan.md).

사용자는 2026-10-15 "결정은 안 하고 일단 다 승인으로 넘어가, G4 질문은 마지막에 한 번에"라고 지시했다. 결정 1–6은 기본값으로 진행했고, G4에서 함께 확인한다.

## 구현 범위

- **서버:**
  - 읽기 전용 `GET /api/office-roles`가 `{ roles: { pm, lead, engineer, reviewer } }`를 돌려준다. Office 런타임의 `agent(role)`을 그대로 쓴다.
  - 브리지가 없으면 404이고, 쓰기는 기존 차단으로 423이다.
  - service 엔진 새 DB에 `pazmo-pm`을 넣는다.
- **화면:**
  - `applyOfficeRoles`(순수 함수)를 App 한 곳에서 적용한다. 보이는 캐릭터는 역할 캐릭터와 작업 중인 캐릭터뿐이고, 캐릭터가 없는 부서는 그리지 않는다.
  - 역할 이름(PM/리드/개발/리뷰)을 다음 화면에서 쓴다: 장면, 사이드바, 상세(원래 이름 표시), 채팅(`displayAgent`), 작업 보드, 보고서 팝업·목록, 상태 패널, 대시보드, Decisions.
  - 캐릭터 그림 번호는 거르기 전 전체 목록 기준으로 고정한다.
  - `useOfficeRoles`:
    - 첫 성공 전에는 null이라 거르지 않는다.
    - 실패하면 마지막 값을 유지한다.
    - 값이 같으면 다시 그리지 않는다.
    - `roles`가 없는 응답은 무시한다.
  - 역할 id를 하나도 못 찾으면 거르지 않는다.
- **DB:** 에이전트 행은 지우거나 이름을 바꾸지 않는다. 표시 이름은 서버로 저장되는 경로가 없다. 호스트가 이름 편집 PATCH를 `RUNNER_FIELD_UNSUPPORTED`로 막는다.

## 구현 중 판정

- **실제 Office는 claw 엔진이다.** 새로 만들어도 원본 14명이고, 역할은 PM=Clio, 리드=Sage, 개발=Aria, 리뷰=Hawk다. 그래서 결정 4(`pazmo-pm`)는 service 엔진(읽기 전용 미리보기) DB에만 해당한다. 결정 문서·Story·사용 안내를 이 사실에 맞게 고쳤다. 유지 여부는 G4에서 확인한다.

## 자동 검증 (2026-10-15)

| 검사 | 결과 |
|---|---|
| root `npm test` | 680/680. 6번 실행 중 첫 번째만 679/680이었다. 그 출력을 남기지 않아 어떤 테스트였는지는 모른다. 이어서 5번 연속 680/680이었다. 간헐 실패가 남아 있을 수 있다. |
| root `npm run typecheck` | exit 0 |
| vendor vitest | 208/210. 실패 2건은 이전부터 실패하던 sprite-avatar다. |
| vendor tsc app / node | exit 0 / exit 0 |
| `npm run build:office` | exit 0 |
| Story·Task 검사 | exit 0 |

## 리뷰

- **Task 1:** 승인
- **Task 2:** Important 1건을 고쳤다. Decisions에서 연 채팅 머리글에 원래 이름이 보이던 문제다.
- **B 전체 리뷰: Ready with fixes.** Important 3건을 한 번의 수정으로 고쳤고, 재검토 결과 Approved다.
  - 보고서와 상태 패널에 원래 이름이 보이던 문제
  - 남은 캐릭터의 그림이 바뀌던 문제
  - 문서가 claw 엔진 판정과 어긋나던 문제
- **남긴 것:**
  - Decisions의 workflow 항목 이름은 서버 값을 쓴다. 관리 Office는 "Office"다.
  - 대시보드의 부서별 실적은 서버 전체 값이다.
  - 나중에 이름 편집을 열 때는 역할 이름이 저장되지 않게 막아야 한다.
  - Office 이전 기록에 비관리 작업의 `current_task_id`가 남은 캐릭터는 계속 보일 수 있다. eevee-be 실제 확인 때 함께 본다.

## eevee-be 실제 화면 (2026-10-15)

- 사용자 허락을 받고 eevee-be Office(claw 엔진, 127.0.0.1:60368)를 B 브랜치 빌드로 다시 시작했다. 실행 상태는 `ready`다.
- 영어 화면, 밝은 테마에서 본 것:
  - 방 3개: Planning에 PM·Lead, Development에 Engineer, QA/QC에 Reviewer
  - 디자인·DevSecOps·운영 방과 나머지 10명은 보이지 않았다.
  - 상단 버튼이 "Team hub · connected"로 보인다. 기존 Fusion 연결이 유지된다.
- 어두운 테마와 한국어 화면, 캐릭터 상세의 원래 이름은 아직 보지 않았다.

## 아직 하지 않은 것 (G4 전)

- **남은 실제 확인:** 어두운 테마, 한국어 이름(PM/리드/개발/리뷰), 캐릭터 상세의 원래 이름
- **G4:** 사용자 답변으로만 기록한다.
