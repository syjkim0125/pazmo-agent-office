# Task: Office에서 보낸 팀 허브 요청 취소하기
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-13-1730-feat-team-hub-office-cancel-plan.md (Task 1–5)

## Outcome
연결된 Office의 Decisions `팀 허브 · …` 항목(2번 "요청 취소")과 Tasks 카드 버튼에서, 사람이 확인창을 거쳐 이 Office에서 보낸 팀 허브 요청을 취소한다.

## Covers — Story M/V IDs
- M10, M4 / V12 (D18)

## Scope
- IN: 허브 연결 API `outgoing-cancel`(범위 검사 + 기존 취소), 게이트웨이 취소·Decisions 2번, 로컬 API(CSRF), 카드 버튼·확인창·오류 문구.
- OUT: 범위 재작성 루프, 취소 사유, 채팅 보낸 요청 목록, 받는 쪽 동작 변경, 알림.

## Constraints
- Office는 `127.0.0.1`만 열고 허브 토큰은 Office 서버에만 둔다. 연결 토큰 권한은 결정 5 범위를 넘지 않는다. `outgoing-answer`는 1번만 받는다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office·허브는 사용자 확인 없이 재시작하지 않는다.

## Verify
- 허브·Office·화면 자동 테스트 X/X, 전체 회귀 X/X, 타입 검사·빌드, 보안 포함 브랜치 리뷰 1회, 이 Mac의 Office 두 개로 Decisions 취소(수락 뒤)와 카드 취소(수락 전) 확인.

## Risk / Dependency
- PR syjkim0125/pazmo-agent-office#18 위에 쌓인 브랜치다. 실제 확인에는 허브와 시험 레포 Office를 다시 띄워야 한다.
