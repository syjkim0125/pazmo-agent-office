# Task: 사내망 팀 허브 1단계
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-08-0924-feat-team-hub-plan.md (Task 0–8)

## Outcome
초대받은 팀원이 내 Mac의 사내망 허브에서 레포 목록·요청 게시판·진행/diff/보고서를 함께 보고, 레포 담당자가 수락한 요청은 그 사람의 PC Office와 로그인으로 실행된다.

## Covers — Story M/V IDs
- M8, M4 / V10 (D16)

## Scope
- IN: 허브 HTTPS·자체 CA, 초대·세션·회수, 레포·담당자, 요청·수락·반납·취소, 요청자 질문·G1 답변 전달, Office 나가는 연결·스냅샷, CLI.
- OUT: 연계 요청, 에이전트 간 Q&A, 허브 실행·API 키, 알림, SSO, 사내 서버 배포, Office 다중 사용자화.

## Constraints
- Office는 `127.0.0.1` 바인딩과 격리·G4·인도를 그대로 유지하고, 허브는 로그인·레포 전체·인도물을 갖지 않는다.
- 사용 중인 eevee-be Office는 사용자 확인 없이 재시작하지 않는다. 커밋·푸시는 요청 시에만 한다.

## Verify
- 허브·연결·Office 입구 자동 테스트 X/X, 전체 회귀 X/X, 타입 검사, 보안 리뷰 1회, 실제 허브+Office 1대 요청→G1→G4→보고서 확인.

## Risk / Dependency
- 회사 IT 정책 허용 여부와 다른 사람 PC 시험은 사용자 확인이 필요하다.
- macOS 기본 openssl(LibreSSL)의 `-addext`에 의존한다.
