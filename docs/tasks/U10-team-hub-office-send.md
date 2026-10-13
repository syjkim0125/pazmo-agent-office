# Task: Office에서 다른 레포 담당자에게 일 보내기 (팀 허브 2단계 A·B·C)
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-13-1200-feat-team-hub-office-send-plan.md (Task 0–5)

## Outcome
연결된 Office의 Tasks 카드·채팅에서 사람이 다른 레포로 팀 허브 요청을 보내고, 보낸 요청 상태를 카드에서 보며, 상대 PM의 질문·G1에 자기 Office Decisions에서 답한다.

## Covers — Story M/V IDs
- M9, M4 / V11 (D17)

## Scope
- IN: 허브 프로토콜 2(1과 공존)·레포 목록·연결로 요청 생성(창 키, 시간당 30건)·보낸 요청 조회·요청자 답변, Office 게이트웨이·보낸 기록·Decisions 합류·로컬 API(CSRF), 보내기 창·카드 표시·채팅 버튼.
- OUT: Lead 초안(D), 에이전트 간 Q&A, Office에서 보낸 요청 취소·수락, 다른 레포 diff 수신, 1단계 후속(IP 고정 등).

## Constraints
- Office는 `127.0.0.1`만 열고 허브 토큰은 Office 서버에만 둔다. 연결 토큰 권한은 결정 4 범위를 넘지 않는다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office·허브는 사용자 확인 없이 재시작하지 않는다.

## Verify
- 허브·Office·화면 자동 테스트 X/X, 전체 회귀 X/X, 타입 검사·빌드, 보안 포함 브랜치 리뷰 1회, 이 Mac의 Office 두 개로 보내기→수락→보낸 쪽 Decisions에서 G1 답하기→카드 완료 확인.

## Risk / Dependency
- 받는 쪽 시험용 레포가 필요하다(사용자 선택). 옛 허브와 섞여 쓰일 때 보내기만 막힌다.
