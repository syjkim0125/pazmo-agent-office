# G4 이해 확인 기록: 제안서 폴더 위치

- 날짜: 2026-10-13
- 사람: JongKun Kim (현재 대화의 사용자)
- Story: `docs/understanding/office-plan-placement-contract.md`
- Graph: `.ai-workflow/runs/office-plan-placement.json`. `status`가 `action: g4`를 반환했고 implement, workflow-review, workflow-verify 노드가 완료된 상태다.

## 공개한 증거 (해설 없이)

- 검증: 전체 `npm test` 552/552 exit 0, typecheck exit 0, `check.mjs story`와 `gate G1` 모두 exit 0 (Node v24.19.0)
- 리뷰: 1차 Critical 0 / Important 1 / Minor 4. 반영 후 2차에서 해결을 확인했고 Ready to merge 판정을 받았다.
  - `.ai-workflow/runs/office-plan-placement-review-1.md`, `-review-2.md`
- 변경 규모: `src/core/contracts.ts` +8/-2, `src/core/intake.ts` +7/-5, 테스트 2개 파일
- 원본 diff: `read()`에 `PLAN_ROOT` 접두사 예외를 추가했다. 게시 폴더 생성은 `mkdtempSync(<project>/office-plan-)`에서 `.pazmo-office/plans/plan-` 아래로 바뀌었다.

## 질문

"이 변경 뒤에 사용자가 겪는 일이 어떻게 달라질까요? 꼭 지켜야 할 규칙과 실패했을 때의 동작은 무엇인가요? 어떤 테스트가 그걸 확인했고, 아직 확인하지 못한 것은 무엇인가요?"

## 사람의 답 1

"루트 대신 .pazmo-office/plans에 생기고 다른 점 경로는 계속 거부"

평가:
- 맞음: 행동 변화(M1)와 불변 조건(M2)
- 빠짐: 실패 시 동작(M5)과 증거의 경계
- 틀림/위험: 없음

빠진 두 부분만 설명하고 다시 말해 달라고 요청했다.

## 사람의 재진술

"실패하면 문서는 보존되고 작업은 등록 안 됨, 실제 Office 게시는 미확인"

평가: 실패 경로(M5: 문서 보존, 작업 0건)와 증거의 경계(실제 Office 게시 흐름은 확인하지 않음)를 정확히 말했다. 첫 답과 합치면 행동, 불변 조건 하나, 실패 경로, 증거의 경계를 모두 갖췄다.

## 경계

G4는 구현을 이해했다는 확인이다. 커밋, 푸시, PR, 머지를 승인한 것은 아니다.
