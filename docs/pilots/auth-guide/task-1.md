# Task: README_ko 인증 경계 문구 추가
Readiness: Implementation-ready
Story: docs/pilots/auth-guide/story.md
Plan source: docs/pilots/auth-guide/plan.md

## Outcome
README_ko.md에 Operator 키와 Codex 구독 로그인의 차이, Mac controller와 전용 VM 실행 경계를 짧게 보강하고 docs/LOCAL-PREVIEW.md의 작업 관리 또는 Operator 안내로 연결한다.

## Covers — Story M/V IDs
- M1, M2, M3, M4, M5, M6 / V1, V2, V3, V4, V5

## Scope
- IN: README_ko.md의 기존 읽기 전용 미리보기 톤과 현재 상태 안내 주변에 짧은 한국어 문단 또는 문장만 추가하며, LOCAL-PREVIEW 내용을 길게 복제하거나 새 문서를 만들지 않는다.

## Constraints
- README_ko.md 외 파일 수정, 배포, 계정 변경, 사용자 승인 생성, 모델 실행 기능 구현, 승인 UI 구현, VM 구조 구현, 공개 모델 실행 또는 전체 실제 사용 검증 완료처럼 읽히는 표현은 금지하며 Office baseline diff로 단일 파일 변경을 확인해야 한다.

## Verify
- Registered checks: V1, V2, V3, V4, V5; see verify-1.json.
