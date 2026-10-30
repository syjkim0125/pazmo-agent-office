# 2026-10-29 판정 없는 리뷰를 kit에 needs_changes로 남기지 않기

Story: M4 · D26 · D27(ASSUMED). 앞선 변경: PR syjkim0125/pazmo-agent-office#35(머지 `31ba8e6`). 그 검증 기록의 "바꾸지 않은 기존 동작"과 `docs/solutions/integration-issues/classify-review-runner-failure-as-unknown.md`의 "Known leftover"로 남긴 후속이다. 그래프 실행: U23(`U23-kit-review-without-verdict.json`).

## 문제

- `src/runners/kit-delivery.ts`의 `finishReview`는 pass가 아닌 결과를 모두 kit 리뷰어 run에 `verdict: "needs_changes"`로 적었다. 리뷰 실행기가 보고서 없이 끝난 경우도 그랬다. 이때 Office 결과는 `unknown`이고 라운드는 `human_required`/`REVIEW_RUNNER_FAILED`로 멈춘다. 그런데 kit run만 보면 리뷰어가 고칠 것을 요청한 것으로 읽혔다.
- 흐름은 이미 맞았다. 같은 기록이 `passed: false`, `action: "human"`이어서 kit도 사람에게 넘겼다. 틀린 것은 기록 내용이었다.
- 피드백 문구 "Reviewer did not produce a valid closed observation."로는 실행기가 실패한 것인지 알 수 없었다.

## kit가 받는 것 (읽어서 확인)

- `.ai-workflow/graph/roles.mjs:59` `assertRoleOutput`은 리뷰어 출력의 verdict를 pass·needs_changes로 제한한다.
- 하지만 kit CLI `record`는 이 검사를 `evaluation.passed`가 참일 때만 한다(`.ai-workflow/graph/cli.mjs:104`). 나중에 run을 다시 검사할 때도 `completed` 노드만 본다(`.ai-workflow/graph/workflow.mjs:103`).
- 실패 기록에 kit가 요구하는 것은 summary, 비어 있지 않은 feedback, evidence 파일뿐이다(`cli.mjs:102-106`). Office의 `KitRoleRun.record`도 revision 검사는 통과 기록에만 한다(`src/core/kit-role-runs.ts`).
- 그래서 kit 파일을 바꾸지 않고 "판정 없음"을 기록할 수 있다. kit 변경을 사용자에게 물을 일은 생기지 않았다.

## 결정 (D27, ASSUMED)

- 고른 것: Office 결과가 `unknown`이면 kit 출력에서 리뷰어의 주장인 `verdict`와 `reviewedRevision`을 빼고, summary는 "No review verdict for the submitted snapshot."로 적는다. 실패(`passed: false`, `action: "human"`)로 기록한다. kit에서 리뷰어 노드는 `failed`, run 상태는 `human`이다. 어느 후보에 대한 시도였는지는 kit 배정의 `targetRevision`에 이미 있다.
- 고르지 않은 것: `verdict: "unknown"`. kit의 리뷰어 판정 어휘(pass·needs_changes)에 없는 값이다. 지금 kit는 실패 기록의 verdict를 보지 않아서 받아 주지만, 나중에 실패 기록도 검사하면 깨진다. 판정이 없다는 것은 필드가 없다는 것과 노드의 실패·action이 이미 말한다.
- Office의 원래 결과(`"verdict": "unknown"`와 관찰)는 그대로 evidence 파일과 `observation`에 남는다.
- 이 선택이 사용자 뜻과 맞는지는 G4에서 확인한다.

## 바뀐 동작

- `finishReview`: 결과가 `unknown`이면 kit 출력은 summary("No review verdict for the submitted snapshot.")와 `observation`뿐이다. `verdict`와 `reviewedRevision`이 없다. pass→`pass`, fail→`needs_changes`와 그 summary·`reviewedRevision`은 그대로다.
- 라운드 이유가 `REVIEW_RUNNER_FAILED`이면 피드백(kit 노드의 `error`)은 "The review runner ended without a report (REVIEW_RUNNER_FAILED); no review was performed."이다. 다른 unknown은 이전 문구 그대로다.
- 그대로인 것:
  - Office 라운드 상태와 이유, 엔지니어를 다시 돌리지 않는 것, 자동 수정 횟수
  - `verifyCompletion`: 제출 verdict가 pass여야 한다. verdict가 없으면 거부한다. 라운드가 이미 멈춰서 이 경로까지 오지 않는다.
  - kit 파일(`.ai-workflow/`)
- Office 안에서 kit 리뷰 노드의 출력을 읽는 곳은 `verifyCompletion`뿐이고, 역할이 완료된 제출만 본다(`src/`와 `vendor/claw-empire`를 grep으로 확인, 독립 리뷰도 같은 결론).

## 시험

| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `tests/coordinator.test.mjs` "a kit Reviewer result without a verdict is recorded to kit as no review". 두 경우를 돈다: 실행기 실패(`reviewRunnerFailures: 1` → `REVIEW_RUNNER_FAILED`), 시간 초과(새 픽스처 옵션 `reviewTimeouts: 1` → `UNKNOWN_RESULT`). 실제 kit CLI가 기록한 run 파일을 읽는다. | 실패: 첫 시도 때 `actual: 'needs_changes', expected: undefined`, 리뷰 반영 때 `reviewedRevision`이 후보 digest로 남아 실패 | 통과 |

- 이 시험은 두 경우 모두 리뷰어 노드가 `failed`, `action`이 `human`이고, `verdict`와 `reviewedRevision`이 없으며, summary가 "No review verdict"로 시작하는지 본다. `error`에는 실행기 실패일 때만 `REVIEW_RUNNER_FAILED`가 있다.
- 관련 3개 파일(coordinator·kit-role-runs·verification): 제품 코드를 되돌리면 48/49(새 시험만 실패), 다시 적용하면 49/49. 첫 시도와 리뷰 반영 뒤 모두 같았다.

## 리뷰 (독립, 보고만, 두 번)

1차 판정은 Approve이고 Critical·Important는 없었다. 리뷰어는 실제 kit `status`·`reset`을 기록된 run 파일에 돌려 네 경우(실행기 실패, 보고서 형식 오류, 시간 초과, 통과)를 확인했다. 앞의 셋은 `human`, 통과는 `role-complete`였고 아무것도 throw하지 않았다.

- Minor 1(반영): unknown 기록의 summary("Independent readonly review of the submitted snapshot.")와 `reviewedRevision`이 리뷰한 것처럼 읽혔다. 이제 둘 다 빠지거나 "No review verdict"로 바뀐다.
- Minor 2(반영 안 함): 피드백 문구를 `round.reason` 대신 관찰(`reviewRunnerFailed`)로 고르자는 제안. `round.reason`은 사용자가 화면에서 보는 이유와 같은 값이고, 리뷰어도 멈춘 라운드에서 이 값이 바뀌지 않음을 확인했다(취소만 바꾸는데 그때는 kit 기록 전에 guard가 막는다).
- Minor 3(반영): `UNKNOWN_RESULT` 쪽 시험이 없었다. 시간 초과 경우를 같은 시험에 넣었다.

2차(반영분) 판정도 Approve였다. 실제 kit `status`로 두 기록 모두 `human`, throw 없음을 다시 확인했다. `reviewedRevision`을 빼도 Office `KitRoleRun.record`(통과 기록만 확인)와 kit `record`·`taskInput`에 문제가 없다.

- Minor(반영 안 함): 실제 `runContainer`는 시간 초과 때 `error: "TIMEOUT"`도 넣는데(`src/runners/container-verifier.ts`), 픽스처는 `error`를 null로 둔다. 분류는 `timedOut`만으로 unknown이고 `reviewRunnerFailed`는 시간 초과를 빼므로 결과(`UNKNOWN_RESULT`)는 같다. 고치려면 그래프의 구현·리뷰를 세 번째로 다시 돌려야 해서(kit 시도 한도 3) 기록만 남긴다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` (origin/main `b84d62d`에 이 변경, 리뷰 반영 뒤) | 960/960, exit 0 (끝날 때 load average 24) |
| 같은 검사, 첫 시도(리뷰 전) | 960/960, exit 0 |
| 관련 3개 파일, 제품 코드 되돌림 / 적용 | 48/49 / 49/49 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

## 아직 하지 않은 것

- 실제 실행기 오류로 이 경로를 거친 실제 확인(#35와 같은 한계, 안전장치 거절은 마음대로 재현할 수 없다).
- 2026-10-30 #42를 합친 코드에서 없는 모델로 확인했다([실제 CLI 확인](2026-10-29-real-cli-runner-checks.md)). 실제 claude 리뷰어가 exit 1로 끝났고, kit 리뷰 노드는 `verdict` 없이 `failed`, `action: "human"`, 피드백 "The review runner ended without a report (REVIEW_RUNNER_FAILED); no review was performed."로 남았다. 안전장치 거절 자체는 여전히 재현하지 않았다.
- kit 쪽에 "리뷰 안 됨" 판정을 정식으로 두는 것(kit 원본 변경, O2 범위 밖).
- **G4:** 사용자 답변으로만 기록한다.
