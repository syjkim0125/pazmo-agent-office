# 2026-11-03 kit 4.1.0 → 5.0.3, Office 역할 run v3 (D36) G4

Story: D36 · M3 · M4 · M8 · V3 · V4 · V8. PR syjkim0125/pazmo-agent-office#65, head `7628011`. kit run: `.ai-workflow/runs/U30-kit5-upgrade-merge-2.json`(상태 `g4`, snapshot `e78f5219806c…`). 결정: [kit5-upgrade-decision.md](../../docs/understanding/kit5-upgrade-decision.md). 검증 기록: [2026-11-03-kit5-upgrade.md](../../docs/verification/2026-11-03-kit5-upgrade.md).

## 질문과 답

컨트롤러는 먼저 설명 페이지("kit 5 업그레이드 결정", 4판, https://claude.ai/artifact/TgVDwL5CSjBtqysv59AWFX)를 보였다. 그 페이지에는 다음이 있다.

- 사람이 겪는 변화
- 검사가 지나가는 길
- 지키는 규칙 넷
- 실패할 때의 동작 표
- 확인한 것과 못 본 것
- 받아들인 한계(M1 문장 변경 포함)
- G4 세 질문
- 선택지 셋(① 승인 후 머지, ② 실제 Office로 한 번 돌린 뒤 머지, ③ 고칠 것 요청)과 각각의 그다음 일·위험·되돌리기

사용자는 세 질문에 직접 답하지 않고 선택지를 골랐다.

> ① 승인 후 머지

아래는 세 질문에 대해 설명 페이지가 보인 내용이다. 사용자가 쓴 답이 아니다.

1. 동작
   - Office 작업의 바깥 흐름은 같다.
   - kit 기록은 v3이고, 개발자·리뷰어 기록은 작업별 kit 폴더에 쌓인다.
   - 사람이 자기 repo를 고치거나 커밋해도 리뷰가 무효가 되지 않는다.
   - kit 4로 시작한 작업은 `KIT_UPGRADE_REQUIRED`로 멈춘다. 취소하고 다시 만든다.
   - 이 repo에서는 Story를 고칠 때마다 G1을 다시 받는다. 검증은 kit가 직접 돌리고, G4 뒤에는 `graph delivery`로 확인한다.
2. 규칙과 실패 경로
   - 규칙
     - agent가 만든 코드는 VM에서만 실행된다. kit가 호스트에서 실행하는 것은 중계뿐이다.
     - 중계는 같은 candidate·round·검사의 VM 결과가 통과했을 때만 성공한다.
     - kit 기록은 검토한 candidate에 묶인다(바뀌면 `stale`).
     - kit 4 파일은 고치지 않는다.
   - 실패 경로
     - 결과가 없거나 다른 candidate거나 실패한 결과면 통과 기록을 거부한다. 그 round는 고치기나 사람 확인으로 간다.
     - kit 4 작업은 멈춘다.
     - 실행과 기록 사이에 꺼지면 사람 확인으로 간다.
     - 중계를 바꾸는 업데이트는 `KIT_SOURCE_CHANGED`로 멈춘다.
3. 증거와 한계
   - main(#64까지)을 합친 상태에서 kit `graph verify`: 1287/1287, 타입 검사 exit 0, Story 검사 exit 0.
   - 독립 리뷰 3회(Important 4건 중 3건 Fixed, 1건 Partly), 돌연변이 3개를 잡았다.
   - 확인하지 못한 것
     - 실제 VM·claude/codex로 돌린 v3 run
     - 경로 대소문자·`:` 시험
     - kit 4 round가 실제로 있는 이전 시험

선택: ① 승인 후 머지.

## 평가

| 항목 | 평가 |
| - | - |
| 동작 | 페이지 내용은 `src/core/kit-role-runs.ts`(`kitWorkspace`·`kitCandidate`·`kitObservation`·`#invoke` 환경), `src/runners/kit-delivery.ts`(`#point`·`finishSelfCheck`·`assertCurrent`), `src/runners/coordinator.ts`, D36과 같다. 다만 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 규칙과 실패 경로는 `tests/kit-role-runs.test.mjs`(중계 거부 다섯 경우, 리뷰어 바인딩, 같은 검사 두 번째 실행 거부), `tests/coordinator.test.mjs`(kit 폴더·실행 기록, 같은 V 검사 둘, kit 4 멈춤과 두 번째 실행, kit 4 완료 기록 유지), `tests/planning-coordinator.test.mjs`(계획 단계 kit 4)와 리뷰 기록에 맞다. |
| 증거 범위 | 자동 검사와 리뷰까지다. 실제 Office 실행은 하지 않았다고 따로 적었다. |
| 선택 | 승인 후 머지. |

남는 한계: 사용자는 세 질문에 직접 답하지 않았다. 설명 페이지를 본 뒤 ①을 골랐다. 이 기록은 사용자가 그 내용을 보고 머지를 맡겼다는 사실을 보여 준다. 사용자가 스스로 설명할 수 있다는 증거는 아니다.

이 G4는 `7628011`(merge-2 run의 snapshot)에 묶인다. 이 기록 뒤에 main(#66, D37)을 합치는 merge는 충돌 해결(Story·STATUS)과 #66의 이미 승인된 변경이다. 그 상태는 전체 시험으로 따로 확인하고 STATUS에 적는다.
