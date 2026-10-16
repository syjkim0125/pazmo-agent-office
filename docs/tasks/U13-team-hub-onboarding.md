# Task: 팀 허브 합류·Office 연결을 붙여넣기 한 번으로 (A)
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-15-1400-feat-team-hub-onboarding-plan.md (Task 1–5)

## Outcome
초대받은 팀원이 허브 시작 화면에서 연결 문자열을 복사해 자기 Office 상단 "팀 허브" 창에 붙여넣으면, 경로 입력이나 터미널 없이 연결된다. 레포는 Office의 git origin으로 찾아 없으면 그 팀원을 담당자로 자동 등록한다.

## Covers — Story M/V IDs
- M12, M4 / V14 (D20)

## Scope
- IN: 허브 팀원 단위 연결 코드·origin 짝 맺기·자동 등록, `/start`·`/connect` 화면, Office 연결 문자열 해석·로컬 API link/unlink(CSRF)·상단 버튼·연결 창, CLI `--connect`, 사용 안내.
- OUT: 웹페이지가 Office를 직접 부르는 원클릭 연결, SSO, 팀원 YAML, 특정 사람 지정 보내기, B(캐릭터 정리), C(공개 npm 설치).

## Constraints
- Office는 `127.0.0.1`만 열고 허브는 Office로 접속하지 않는다. 연결은 사람이 붙여넣고 누를 때만 일어난다. 토큰은 Office 데이터 디렉터리에 0600으로만 둔다.
- 기존 레포 단위 코드와 `hub-link --hub/--code/--fingerprint`는 그대로 동작한다. 브라우저 기본 대화상자는 쓰지 않는다.
- 커밋·푸시는 요청 시에만. 실행 중인 Office·허브는 사용자 확인 없이 재시작하지 않는다.

## Verify
- 허브·Office·화면 자동 테스트 X/X, 전체 회귀 X/X(root·vendor), 타입 검사, 빌드, 보안 포함 브랜치 리뷰 1회.
- 실제 확인은 B 다음 Fusion 허브에서: 테스트 팀원 합류 → 문자열 붙여넣기 연결(자동 등록) → 보내기·수락·취소.

## Risk / Dependency
- U12(Fusion 허브)가 같은 브랜치에 커밋되지 않은 상태다. Fusion 재배포와 로그인은 사용자가 한다.
