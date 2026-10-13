# Story: Lead 제안서가 사용자 repo 루트를 어지럽히지 않는다
Status: Delivered
Owner: JongKun Kim
Understanding gate (G1): docs/understanding/office-plan-placement-g1.md · 2026-10-13 · Check-in: accepted
Understanding gate (G4): docs/understanding/office-plan-placement-diff.md · 2026-10-13 · Check-in: accepted
G4: PASS — 제안서가 루트 대신 .pazmo-office/plans에 생기고 다른 점 경로는 계속 거부되며, 게시 실패 시 문서는 보존되고 작업은 등록되지 않는다고 재진술했다. 실제 Office 게시 흐름은 미확인이라는 증거 경계도 말했다.

## Goal
지금은 Lead 제안을 게시할 때마다 사용자 프로젝트 맨 위에 office-plan-XXXX 폴더가 생겨
git에 untracked로 쌓이고, 다음 계획·엔지니어 작업 트리에도 섞여 들어간다. 바꾼 뒤에는
제안서가 Office 전용 폴더(.pazmo-office/plans/) 안에 생겨 루트와 작업 트리가 깨끗하다.
승인된 문서의 지문 대조, 덮어쓰기 금지, 실패 시 보존은 지금과 똑같이 유지한다.
테스트로 위치·스냅샷 제외·기존 작업 호환을 확인한다.

근거(2026-10-13 코드 확인): 제안서는 승인·배정마다 digest 대조로 다시 읽히는 정본이다
(`src/core/contracts.ts` `contractMatches()`). kit `check.mjs`는 project root 안이면 점 폴더도
허용하지만, Office의 `contracts.ts` `read()`가 `.`으로 시작하는 경로 조각을 모두 거부한다.
판단 자료: https://claude.ai/artifact/Upev2K4aYmQax5HRhKtSxa

## Domain
- Terms: 제안서 폴더 = Lead 제안 게시 1회당 만들어지는 story/plan/decision/task-N/verify-N 묶음
- Invariant: 등록된 작업의 문서는 승인된 바이트와 같아야 하며 Office가 자동 삭제하지 않는다

## MUST
- M1. 새 게시는 .pazmo-office/plans/<고유id>/ 아래에만 문서를 만들고 프로젝트 루트에는 아무것도 만들지 않는다.
- M2. 계약 경로 검사는 .pazmo-office/plans/ 아래만 예외로 허용하고, 그 밖의 점 경로(.git, .env, .pazmo-office의 다른 하위 경로 등)는 지금처럼 거부한다.
- M3. 이미 office-plan-* 경로로 등록된 작업은 그대로 승인·배정·검증된다.
- M4. 새 제안서는 계획 스냅샷과 엔지니어 작업 트리에 들어가지 않는다.
- M5. 실패한 게시는 지금처럼 문서를 보존하고 승인되지 않은 작업으로 취급하지 않으며, 재시도 시 기존 폴더를 덮어쓰거나 재사용하지 않는다.

## SHOULD
- S1. 실패 메시지에 보존된 폴더의 전체 상대 경로(.pazmo-office/plans/…)를 보여 준다.

## OUT
- O1. 기존 office-plan-* 폴더의 이동·삭제(작업 종료 후 사람이 정리)
- O2. .pazmo-office/ 자체를 git에서 숨기는 처리(설치 manifest와 엮여 있어 별도 결정)
- O3. .git/info/exclude 수정, vendor kit 수정, 실행 중인 Office 변경

## Decisions
- D1. 2026-10-13 사용자 승인: 위치는 .pazmo-office/plans/ (선택지 A). B(.git/info/exclude)는 Office의 .git 보호 원칙과 충돌하고 작업 트리 혼입을 막지 못해, C(프로젝트 밖)는 kit이 root 밖 경로를 거부해 제외.
- ASSUMED: 폴더 이름은 지금처럼 mkdtemp 무작위 접미사 방식을 유지한다.

## Verify
- V1 [M1]. 게시 → 루트에 office-plan-* 없음, .pazmo-office/plans/<id>/에 문서 생성, task의 Story:/Plan source: 줄이 새 경로를 가리킴
- V2 [M2]. .git/x, .env, .pazmo-office/role-runs/x 경로로 계약 등록 → UNSAFE_PATH
- V3 [M3]. 기존 office-plan-* 경로로 등록된 작업 → contractMatches true, 배정 정상
- V4 [M4]. 게시 후 planningSnapshot·freezeWorkspace(include ".") 결과에 plans 문서 없음
- V5 [M5]. 등록 실패를 주입 → 문서 보존, 작업 0건, 재시도 시 새 폴더 생성
