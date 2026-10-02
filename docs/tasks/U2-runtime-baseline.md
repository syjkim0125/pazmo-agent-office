# Task: 실행을 잠근 Office baseline과 안전한 CLI
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md (U2)

## Outcome
사용자가 로컬 Office를 준비·점검·시작·중지·제거할 수 있고, 실행 보호가 검증되기 전에는 AI 작업을 시작할 수 없다.

## Covers — Story M/V IDs
- M1, M4, M6 / V1, V4, V6

## Scope
- IN: CLI lifecycle, 격리 데이터 경로, loopback Office baseline, 모든 모델 실행 진입점 잠금.

## Constraints
- init/remove는 명시적 apply 전 변경하지 않는다. 기존 사용자 파일과 수정된 관리 파일을 보존한다.
- 설치 스크립트를 먼저 검토한다. 모델 실행·자동 업데이트·실제 사용자 DB migration은 허용하지 않는다.

## Verify
- dry-run 무변경, apply 멱등, 충돌·port/start 실패 복구, 수정 파일 보존, UI/API 실행 잠금을 실제 시험한다.

## Risk / Dependency
- main 8e14344 기준 새 브랜치 codex/office-runtime-baseline. 제품 runtime G3 승인됨; 실제 격리 검증 전 모델 실행은 잠근다.

## Evidence
- 로컬 CLI/preview 검증: docs/verification/2026-09-18-runtime-baseline.md. source-free 패키지 시험과 전체 Story 인도는 미완료.
