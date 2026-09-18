# Task: 고정 소스와 출처 기준점 보존
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md (U1)

## Outcome
원본 소스와 라이선스를 보존하고 이후 구현과 비교할 수 있는 기준 commit 및 실제 상태 문서를 제공한다.

## Covers — Story M/V IDs
- M1 / V1 (source import 범위)

## Scope
- IN: 고정 tree, gitlink, 라이선스, workflow 도구, 출처·계획·검증 문서.

## Constraints
- 기존 사용자 파일을 보존한다. runtime·submodule·설치 lifecycle은 실행하지 않는다.

## Verify
- 원본 tree·mode·gitlink·LICENSE·template blob·doctor 및 Story/G1 검사 결과를 기록한다.

## Risk / Dependency
- 제품 runtime 및 격리는 증명하지 않는다. V1의 재사용 가능한 import 명령과 실패 주입 검증은 후속 CLI 구현에 남긴다.
