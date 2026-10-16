# Task: 받은 팀 허브 요청을 Office Inbox에서 수락·거절
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-16-1100-feat-team-hub-office-inbox-plan.md (Task 1–6)

## Outcome
담당자는 자기 레포로 들어온 대기 중 팀 허브 요청을 Office Tasks Inbox의 받은 요청 카드에서 수락하거나 사유와 함께 거절한다. 거절은 요청을 닫고 요청자의 Office와 허브에 거절과 사유를 보인다. 다른 허브로 교체할 때 이전 허브 작업은 확인 후 취소한다.

## Covers — Story M/V IDs
- M14, M4 / V16 (D22)

## Scope
- IN: 허브 incoming·수락·거절 연결 API와 거절 저장, 허브 웹 거절, Office 게이트웨이·로컬 API·Inbox 카드·보낸 쪽 거절 칩, 교체 시 이전 작업 취소, 초대 링크 안내, 사용 안내.
- OUT: Office 반납, 자동 수락, 특정 담당자 지정 보내기, 거절 뒤 다시 열기, 알림, 레포 삭제, C(공개 npm).

## Constraints
- 수락·거절은 사람이 눌러야만 일어난다. Office는 `127.0.0.1`만 열고 허브는 Office로 접속하지 않는다. 허브 토큰은 Office 서버에만 둔다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office·허브는 사용자 확인 없이 재시작·재배포하지 않는다.

## Verify
- 허브·Office·화면 자동 시험 X/X, 전체 회귀 X/X(root·vendor), 타입 검사, 빌드, 보안 포함 브랜치 리뷰 1회.
- Fusion 실제 확인: eevee-be → 시험 Office 두 건을 Office Inbox에서 하나 수락·하나 거절하고 요청자 쪽 거절 표시를 본다.

## Risk / Dependency
- 실제 확인에는 허브 재배포와 Office 재시작이 필요하다(사용자 확인 후).
