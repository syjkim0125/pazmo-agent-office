# Task: 사용자 설치 codex·claude 실행기와 역할별 모델 선택
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-10-02-1747-feat-cli-runner-selection-plan.md (Task 1–12)

## Outcome
사용자 PC에 설치·로그인된 codex 또는 claude를 구독 로그인 그대로 역할별로 실행한다. 실행기·모델 선택은 화면에서 저장되고 재시작 후에도 유지된다.

## Covers — Story M/V IDs
- M3, M4 / V3, V4, V9 (D15)

## Scope
- IN: CLI 탐색·로그인 상태, CLI 모델 목록, (SHA, 모델)별 로그인 없는 검사, claude MCP 도구 다리, 역할별 선택 저장·검증, 실행 증거, 시작 조건.
- OUT: 작업별 선택, VM executor 버전 변경, 배포·상용 제공, API 키 경로.

## Constraints
- 로그인 정보는 복사·읽기 금지이며 다른 실행기나 API 키로 자동 전환하지 않는다. 기존 VM·승인 경계를 유지한다.
- 다른 세션의 host.ts·native-office.ts·runners 변경과 충돌하지 않게 최소 수정한다. 61772 인스턴스는 건드리지 않는다.

## Verify
- 단위·통합 테스트 X/X, 타입 검사, UI 빌드, 실제 VM fixture 검사 X/X, 실행기별 실제 구독 실행 1회, 화면 저장·재시작 확인.

## Risk / Dependency
- codex 0.160.0 ↔ executor 0.154.0 호환은 미확인이다. 실패하면 설치본 codex는 잠그고 고정 런타임을 명시적으로 선택하게 한다.
- `--bare`가 `-p` 기본값이 되면 claude 구독 실행은 잠긴다.
