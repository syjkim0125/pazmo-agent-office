# Task: 팀 허브를 Fusion(OpenShift) eevee 프로젝트에 상시로 띄우기
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-14-1500-feat-team-hub-fusion-plan.md (Task 1–5)

## Outcome
허브를 Fusion eevee 프로젝트에 프록시 뒤 모드(라우터 TLS, 파드 1개, PVC)로 띄우고, 각 Office가 공인 인증서를 시스템 신뢰로 검증해 지문 없이 연결한다. 사내망 허브 모드는 그대로 둔다.

## Covers — Story M/V IDs
- M11, M4 / V13 (D19)

## Scope
- IN: 허브 Fusion 모드(공개 주소, HTTP 수신, Host·Origin, `/healthz`, 대기 시간), `hub-link` 시스템 신뢰, 허브 전용 진입점·묶음, `deploy/fusion/` 매니페스트, 사용 안내, eevee 실제 배포.
- OUT: 파드 여러 개·다른 DB, SSO, 자동 백업, 사내망 밖 공개, 별도 네임스페이스, Git 소스 빌드, 사내망 허브 데이터 이전.

## Constraints
- 각 Office는 `127.0.0.1`만 열고 허브는 Office로 접속하지 않는다. `oc login`과 빌드 명령은 사용자가 실행하고 로그인 정보는 다루지 않는다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office·허브는 사용자 확인 없이 재시작하지 않는다.

## Verify
- 허브·연결·묶음 자동 테스트 X/X, 전체 회귀 X/X, 타입 검사, 보안 포함 브랜치 리뷰 1회, eevee 배포 후 관리자 입장·지문 없는 연결 두 개·보내기→수락→취소·파드 재시작 후 이어짐 확인.

## Risk / Dependency
- Fusion 로그인과 배포 권한은 사용자에게 있다. 사내망 밖·VPN 접속과 Fusion의 외부 접근 정책은 확인하지 않았다.
