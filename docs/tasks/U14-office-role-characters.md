# Task: Office 캐릭터를 역할 중심으로 정리 (B)
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-15-1700-feat-office-role-characters-plan.md (Task 1–3)

## Outcome
Office 화면에는 PM·Lead·Engineer·Reviewer를 맡는 캐릭터와 지금 일하는 캐릭터만 보이고, 역할 캐릭터는 역할 이름으로 보인다. 캐릭터가 없는 부서 방은 그리지 않는다. DB 에이전트 행은 바꾸지 않고, 새 DB는 PM 캐릭터를 갖는다.

## Covers — Story M/V IDs
- M13, M4 / V15 (D21)

## Scope
- IN: 읽기 전용 역할 API, 새 DB `pazmo-pm` 시드, 화면 필터·역할 이름·원래 이름 표시, 사용 안내.
- OUT: 에이전트 추가 허용, 숨긴 캐릭터 다시 보기, DB 이름 변경·행 삭제, 옛 DB에 PM 추가, 캐릭터 그림 교체.

## Constraints
- 호스트의 에이전트·부서 생성·삭제 차단은 그대로 둔다. Office는 `127.0.0.1`만 연다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office는 사용자 확인 없이 재시작하지 않는다.

## Verify
- 역할 API·시드·화면 필터 자동 테스트 X/X, 전체 회귀 X/X(root·vendor), 타입 검사, 빌드, B 범위 리뷰 1회.
- app-be Office 실제 화면 확인은 A 실제 확인과 함께 한다.

## Risk / Dependency
- 사용자가 결정을 G4로 미뤘다(D21). G4에서 결정 1–6이 뜻과 다르면 화면 필터만 바꾸면 된다.
