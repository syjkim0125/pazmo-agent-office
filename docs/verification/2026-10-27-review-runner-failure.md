# 2026-10-27 리뷰 실행기 오류를 리뷰 fail로 세지 않기

Story: M4 · D26. 발견: [lean Office 1단계 실제 확인](2026-10-21-lean-office-phase1.md)의 "실제 확인에서 찾은 것" 2번. 설명 페이지: "리뷰 실행기 오류 분류".

번호 메모: 머지 때 #37이 먼저 D25와 U19를 써서, 이 변경의 결정은 D26, 그래프 실행은 U20(`U20-review-runner-failure.json`)으로 바꿨다. U20 안의 기록 문장은 바꾸기 전 이름(D25, U19)을 그대로 담고 있다.

## 증상 (2026-10-27 app-be)

`claude · sonnet` 리뷰어의 출력은 agent 메시지 하나("API Error: … safeguards flagged this message … [cyber]")와 `turn.failed`였고, exit 1로 끝났으며 보고서는 없었다. Office는 이것을 리뷰 fail로 기록했다. 그래서 구현부터 다시 돌렸고 자동 수정 2회 중 1회를 썼다. 두 번째 리뷰는 통과했다.

## 원인

- `src/core/verification.ts`의 `classify()`가 검사와 리뷰에 같은 규칙을 썼다: 정상 종료에 exit≠0이면 `"fail"`. 이 규칙은 2026-09-21 처음 런타임을 만들 때부터 있었다.
- 검사는 exit 코드가 곧 판정이다. 리뷰는 판정이 JSON 보고서에만 있고, `ContainerReviewer`(`src/runners/container-verifier.ts`)는 exit 0일 때만 보고서를 읽는다. 그래서 exit≠0 리뷰는 판정이 없는데도 fail이 됐다. codex 리뷰어도 API 오류면 exit≠0으로 끝나므로 같은 일이 생긴다.
- fail이 되면 라운드는 `fix_required`/`CHECK_FAILED`가 된다. coordinator가 엔지니어를 다시 돌리고, kit는 "Office review/verification requires changes" 피드백을 보낸다. 세 번째에는 `FIX_BUDGET_EXHAUSTED`(수정 횟수 소진)라는 실제와 다른 이유로 멈춘다.
- 같은 종류의 문제를 계획 단계는 #12(`runnerFailure`)에서 이미 고쳤고, 엔지니어 실행기 실패는 원래 사람 확인으로 멈춘다. 리뷰만 아직 고쳐지지 않았었다.

## 결정 (D26, 사용자 선택 1안)

선택지와 비용은 설명 페이지에 있다: 1안 unknown과 새 이유, 2안 unknown에 기존 이유, 3안 리뷰만 자동 재실행(큰 변경, G3), 4안 그대로 둠. 사용자는 1안을 골랐다. 처음에는 PR #32에 넣기로 했지만, PR #32의 G4가 먼저 기록되고 머지됐다. G4 답 2번이 그 시점의 fail 동작을 적고 있으므로, 이 변경은 main에서 별도 PR과 자체 G4로 간다.

## 바뀐 동작

- 정상 종료(시간 초과·신호·오류 없음)한 리뷰가 exit≠0이면 판정은 `unknown`이다. 라운드는 `human_required`, 이유 `REVIEW_RUNNER_FAILED`로 멈춘다. 다른 unknown은 그대로 `UNKNOWN_RESULT`다.
- 엔지니어를 다시 돌리지 않고 자동 수정 횟수를 쓰지 않는다. `begin()`은 `HUMAN_REQUIRED`로 거부한다. 자동 재실행은 없다.
- 등록 검사의 exit≠0은 그대로 `fail`이다(자동 수정 2회 규칙 유지).
- kit 쪽은 바꾸지 않았다. 리뷰가 unknown이면 kit는 원래 있던 경로로 사람 확인(`action: "human"`)을 기록한다.
- 화면: lean Office는 "하위 작업이 멈췄습니다: REVIEW_RUNNER_FAILED (작업 제목). 자동으로 다시 실행하지 않습니다."를 보인다. Claw Office는 리뷰 검증 메시지에 `"verdict": "unknown"`을 보이고, 작업은 대기(pending)로 남는다.
- 복구: 작성 당시에는 취소한 뒤 새로 만들어야 했다. 머지 때 들어온 #37 이후 lean Office는 [다시 실행]으로 새 작업을 만들 수 있다. Claw Office는 아직 취소 후 새로 만들기다.
- 같은 라운드에서 등록 검사가 먼저 실패하고 그다음 리뷰 실행기가 실패하면, 라운드는 `CHECK_FAILED`가 아니라 `REVIEW_RUNNER_FAILED`로 멈춘다. 다른 unknown과 같은 처리이고(사람에게 넘김), 실패한 검사 결과는 라운드에 그대로 남는다.
- 이유 고르기: unknown이 하나라도 기록되면 라운드가 닫힌다. `record()`는 `BEGIN IMMEDIATE` 트랜잭션 안에서 상태가 "checking"인지 확인한다. 그래서 라운드의 첫 unknown은 언제나 방금 기록한 결과이고, 이유는 그 결과로 고른다. 동시에 기록되는 검사·리뷰도 이 순서를 바꾸지 못한다(독립 리뷰에서 확인).

## 시험

| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `tests/verification.test.mjs` "a review runner that exits non-zero has no verdict and stops without spending a fix" (관찰된 출력 그대로) | 실패: `actual 'fail', expected 'unknown'` | 통과 |
| `tests/coordinator.test.mjs` "a kit Reviewer runner failure stops for a person instead of rebuilding the candidate" | 실패: `actual 'awaiting_g4', expected 'human_required'`(엔지니어를 다시 돌려 두 번째 리뷰가 통과, 10-27과 같은 흐름) | 통과 |

- 기존 시험 하나를 바꿨다. `tests/budgets.test.mjs` "one initial implementation and at most one fix per failed round survive reconstruction"는 리뷰에도 exit 1을 줘서 실패한 라운드를 만들고 있었다. 고친 뒤에는 이 리뷰가 unknown이 되어 시험이 실패했다(929 중 1건). 이 시험이 지키는 규칙(실패한 라운드마다 수정 하나)은 그대로 두고, 실패를 등록 검사 쪽에서 내도록 픽스처를 바꿨다.
- 자동 검증은 아래 "자동 검증"에 있다.

## 리뷰 (독립, 보고만)

판정은 Approve이고 Critical은 없었다. unknown은 awaiting_g4에 갈 수 없다. `record()`는 모든 노드가 pass일 때만 그 상태로 옮기고, `#subject`는 그 밖에는 null이며, `requestChanges`와 인도는 둘 다 awaiting_g4를 요구한다. 그래서 M4는 그대로다.

- Important 1건: `tests/budgets.test.mjs`를 같은 변경에 넣어야 한다는 지적. 리뷰를 맡길 때 이미 고쳐 두었고, 같은 커밋에 들어간다.
- Minor:
  - `nodes.some(...unknown)` 대신 `verdict === "unknown"`을 쓰자는 제안. 받아들이지 않았다. 동작은 같지만, 불변 조건이 깨져도 멈춤만은 일어나도록 지금 형태를 남겼다.
  - 새 coordinator 시험의 중복 단언은 지웠다. 메시지가 실제로 검사하는 것과 달랐다.
  - 검사 실패 뒤 리뷰 실행기가 실패할 때의 이유는 "바뀐 동작"에 적었다.
- 바꾸지 않은 기존 동작: kit `finishReview`는 리뷰가 unknown이면, 실행되지 않은 리뷰도 `verdict: "needs_changes"`와 `action: "human"`으로 기록한다. 원래 다른 unknown에도 그랬으므로 후속 후보로 남긴다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` (main `68be1dc`에 이 변경, 리뷰 반영 뒤) | 927/929. 실패 2건(`tests/claw-lifecycle.test.mjs`, `tests/lean-lifecycle.test.mjs`)은 모두 Office 시작 시간 초과였다. 그때 기계 부하는 load average 24–33이었다(다른 세션 셋이 시험을 같이 돌림). 두 파일만 다시 돌리면 15/15 통과한다. |
| 같은 변경, 앞선 전체 실행 (`codex/lean-office` `1e7883e` 기준, 리뷰 전) | 929/929 |
| 관련 3개 파일 (verification·coordinator·budgets), main 기준 | 제품 코드를 되돌리면 56/58(새 시험 2개만 실패), 다시 적용하면 58/58 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

## 아직 하지 않은 것

- 실제 실행기 오류로 이 경로를 거친 실제 확인. 안전장치 거절은 마음대로 재현할 수 없다.
- codex 리뷰어의 API 오류 출력 확인(종료 코드가 0이 아님은 확인하지 않았다).
- 2026-10-29 위 두 가지를 없는 모델로 확인했다([실제 CLI 확인](2026-10-29-real-cli-runner-checks.md)). claude·codex 모두 API 오류에 exit 1로 끝났고 `REVIEW_RUNNER_FAILED`로 멈췄다. 안전장치 거절 자체는 여전히 재현하지 않았다.
- Claw Office의 멈춘 작업 다시 돌리기(lean은 #37), 리뷰만 자동 재실행(선택하지 않은 3안).
- **G4:** 사용자 답변으로만 기록한다.
