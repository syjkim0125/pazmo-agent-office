# Task: 새 최소 Office 1단계 (Tasks·작업 상세·Decisions·Agents)
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-20-1500-feat-lean-office-phase1-plan.md (Task 1–7)

## Outcome
`start --lean` / `up --lean`으로 Claw Empire 없이 새 최소 Office를 켠다. 화면은 Tasks·작업 상세·Decisions·Agents이고, agent는 작업 일꾼으로 작업 실행기와 리뷰 실행기를 따로 가진다. 엔진(결정·격리·검증·인도)은 그대로 쓴다.

## Covers — Story M/V IDs
- M15, M4 / V17 (D23)

## Scope
- IN: 작업별 실행기 고르기(엔진 연결점), lean 저장·agent, 작업·보드·상세·결정·취소, 의존성 없는 HTTP 서버·세션·CSRF, 진입점·`--lean` CLI, 화면 4개, 사용 안내.
- OUT: 팀 허브 화면(2단계), Claw 삭제·기본 전환(3단계), npm 설치(4단계), 채팅, 하위 작업 화면, 회의, 대시보드, 픽셀 사무실, 동시 실행, 데이터 옮기기.

## Constraints
- 새 코드는 vendor를 import하지 않고 npm 의존성이 없다. Office는 `127.0.0.1`만 연다. 기존 Claw 엔진 동작과 데이터는 바꾸지 않는다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office는 사용자 확인 없이 재시작하지 않는다.

## Verify
- 엔진·저장·파사드·서버·수명주기·화면 자동 시험 X/X, 전체 회귀 X/X(root·vendor), 타입 검사, 보안 포함 브랜치 리뷰 1회.
- eevee-be `up --lean` 실제 확인: 작업 하나를 G1→구현→다른 실행기 리뷰→G4→인도까지, agent 추가·변경·삭제.

## Risk / Dependency
- 엔진의 실행기 연결점 변경이 Claw 엔진 동작을 바꾸지 않아야 한다(기존 시험으로 확인).
