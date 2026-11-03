# 2026-11-03 실행기 계정 문제는 시도로 세지 않고 기다린다 (D37)

Story: M16 · V18 · D37. 근거: [실제 확인 1차](2026-11-03-team-story-task-mode-real-check.md)의 찾은 것 1·2.

결정 설명 페이지: https://claude.ai/artifact/FQmjsJozgCNYT81EiKD9n3

- 사용자는 이 페이지를 본 뒤 1-A·2-A·3-A를 골랐다.
- Story 초안을 "D36"으로 보여 줬고, 사용자는 "맞아, 진행해"로 승인했다.
- 같은 날 kit 5 올리기 작업(커밋 전)이 D36·U30을 써서 D37·U31로 옮겼다. 번호와 아래 ASSUMED 줄 말고는 같다.

## 무엇이 바뀌었나

- **알아보기(1-A):**
  - claude: 정규화한 출력(`normalizeClaudeStream`)이 실패한 턴(`turn.failed`)에 세 가지를 남긴다.
    - claude의 마지막 답이 스스로 만든 거절이면 그 오류 종류와 글. 거절 뒤에 claude가 다른 답을 이어 갔으면 남기지 않는다.
    - 거절된 한도의 리셋 시각. 정수 ms로 올림한다.
  - `runnerAccountProblem`은 그중 `rate_limit`→`limit`, `billing_error`→`billing`, `authentication_failed`→`login`만 계정 문제로 본다.
  - codex: 실패 이벤트의 문구로 본다. 실패한 턴의 `error.message`를 보고, 그것이 없으면 뒤에 아무것도 없는 마지막 `error` 이벤트를 본다. 확인 순서는 사용 한도·429(`limit`) → 크레딧·Quota·Plus 필요(`billing`) → 토큰 갱신 실패·401(`login`)이다.
  - 끝난 턴(`turn.completed`)이 있거나, 모델의 메시지에만 그 말이 있으면 계정 문제가 아니다.
- **엔진:** `storyOutcome`이 멈춘 Story Task에 `runnerAccount`를 붙인다. 구현이 멈췄으면(`ENGINEER_FAILED`) Engineer 실행 출력을, 리뷰 실행기가 실패했으면(`REVIEW_RUNNER_FAILED`) 리뷰 실행 출력을 읽는다.
- **실행기(2-A):** 그런 멈춤은 `failAttempt` 대신 `waitForRunner`로 간다.
  - 시도 수와 직전 실패는 그대로다. 기록은 `claimed`에 `runnerWait`(실행기·종류·메시지·시작·다음 시각·거절된 실행 수)를 남긴다.
  - 다음 시각은 리셋 시각이다. 리셋 시각이 지났거나 없으면 30분 뒤다. 어느 쪽이든 첫 발견부터 6시간을 넘기지 않는다.
  - 그 시각 전에는 아무것도 돌리지 않는다. 다시 하는 실행은 계약 폴더를 따로 둔다(`…-a<시도>-r<번째>`). 거절된 실행의 폴더는 남는다.
  - 다시 한 실행이 계정 문제 없이 끝나거나, 시도로 센 실패(시간 초과 포함)가 나면 기다림이 지워진다. 다음 시도의 계정 문제는 새 6시간을 연다.
  - 첫 발견부터 6시간이 지나 다시 계정 문제면 실패를 보고한다. 이유는 `RUNNER_LIMIT`·`RUNNER_BILLING`·`RUNNER_LOGIN` 중 하나에 실행기 이름과 메시지를 붙인 것이다.
- **보이기(3-A):**
  - `status --team`과 `team status`의 `claim.waiting`
  - 발견마다 Office 로그 한 줄
  - Hub 실패 이유
  - 기다리는 동안 하트비트는 `build`로 간다. Hub·프로토콜은 바꾸지 않았다.
- **팀 기록:** `team_claims.runner_wait_json` 열을 더했다. 예전 파일은 열 때 그 열을 얻는다. 읽을 수 없는 값은 기다림 없음으로 읽는다.

## 신호의 근거

- **실제 확인 1차의 Story 엔진 DB**(`pazmo_handoffs.receipt_json`, 2026-11-02):
  - 실패한 Engineer 실행 두 개의 출력은 `turn.started` → `agent_message`("You've hit your org's monthly spend limit · run /usage-credits … · your weekly limit resets 4am (Asia/Seoul)") → `turn.failed`, exit 1, `closed: true`였다.
  - 정규화가 오류 종류를 버렸기 때문에 글자 말고는 신호가 없었다.
- **claude 2.1.280 설치본**(`/opt/homebrew/Caskroom/claude-code@latest/2.1.280/claude`):
  - stream 출력의 assistant 이벤트에 `error: g.error`가 맨 위로 붙는다.
  - API 거절을 답으로 바꾸는 곳은 `error: "rate_limit"`(사용 한도, 크레딧 필요, 429 과부하), `"billing_error"`, `"authentication_failed"`, `"invalid_request"`, `"server_error"` 등을 쓴다.
  - `rate_limit_event`는 `rate_limit_info: { status, resetsAt, rateLimitType, … }`를 낸다.
  - 한도 문구는 20가지가 넘는다(조직·팀·채널·월·주·fast 한도).
- **codex 0.155.1**(고정 실행 파일):
  - exec 이벤트는 `thread.started`·`turn.started`·`turn.completed`·`turn.failed`(`TurnFailedEvent`)·`item.*`·`error`(`ThreadErrorEvent`, `message`)다.
  - 확인한 계정 문구:
    - "Usage limit reached. You've reached your usage limit. …"
    - "You're out of credits. … Add credits to continue using Codex."
    - "Quota exceeded. Check your plan and billing details."
    - "To use Codex with your ChatGPT plan, upgrade to Plus: …"
    - "Your access token could not be refreshed because your refresh token has expired/was already used/was revoked. Please log out and sign in again."
  - "Selected model is at capacity"는 계정 문제로 보지 않는다.

## 자동 시험

RED는 모두 고치기 전에 봤다. node는 repo가 정한 24.19.0이다. PATH의 22.3은 `.ts`를 읽지 못해 쓰지 않았다.

| 시험 | RED(고치기 전, 실패/전체) | GREEN |
|---|---|---|
| `tests/runner-account.test.mjs` (새 6개) | 1/6(옛 정규화로는 claude 한도가 `null`); 모듈 없이는 불러오기 실패(`ERR_MODULE_NOT_FOUND`) | 16/16 (`claude-profile` 포함) |
| `tests/native-story-task.test.mjs` "runner's account" | 1/18(`runnerAccount` 없음) | 18/18 |
| `tests/team-store.test.mjs`, `tests/team-scheduler.test.mjs` (기다림 저장 1개, 기존 기대값 4곳에 `runnerWait: null`) | 10/95 | 95/95 |
| `tests/team-executor.test.mjs` (새 4개) | 4/57(한도도 시도로 셈, `team-story-contract` 포함) | 57/57 |
| `tests/team-office.test.mjs`, `tests/team-lifecycle.test.mjs` (`waiting`) | 2/35 | 35/35 |
| 리뷰 뒤 보강(runner-account 3개 수정·추가, team-executor 2개 추가) | 5/56(리셋 시각 ms·올림, 이어 간 거절, codex 무료 요금제 문구, 복구된 codex 알림, 시간 초과 뒤 남은 기다림) | 56/56 (`claude-profile` 포함) |

`-r1` 폴더 잔여물 교체 시험은 처음부터 통과했다(빠져 있던 시험을 채운 것).

## 단순화와 리뷰

- **단순화**(`ce-simplify-code`, 재사용·품질·효율 리뷰어 3개): 8건을 반영했다. 동작이 같은 것만 고쳤다.
  - 중첩 삼항을 풀었다.
  - 분류기의 변수 이름을 고쳤다.
  - 실행기·종류 목록을 한 곳에 두었다.
  - `RunnerWaiting` 타입에 이름을 붙였다.
  - 이중 부정 조건을 풀었다.
  - 초/ms 판정에 이유를 적었다.
  - Engineer 출력을 `json_extract`로 `ENGINEER_FAILED`일 때만 읽게 했다.
  - 하는 일만 되풀이하는 주석을 지웠다.
- **리뷰**(`ce-code-review mode:agent`, 리뷰어 8개: 정확성·적대적·시험·유지보수·repo 규칙·신뢰성·과거 학습·agent 접근성):
  - P2 1건, 다섯 리뷰어 일치(적대적은 재현까지 함): 기다림 뒤 다시 한 실행이 90분 시간 초과로 끝나면 기다림이 남았다. 그러면 다음 시도가 `-a2-r1` 폴더로 돌고, 그 시도의 첫 거절이 지난 6시간을 이어받아 바로 실패 보고될 수 있었다. → `failAttempt`가 기다림을 지운다. 시험을 추가했다.
  - P2: 정수가 아닌 리셋 시각이 기록 검사에 걸려 실패 보고될 수 있었다. → 올림 처리했다. 시험을 추가했다.
  - P3: codex 무료 요금제의 한도 문구("… Upgrade to Plus …")가 결제로 분류됐다. → 한도를 먼저 본다. 시험을 추가했다.
  - P3: codex가 넘어간 재연결 알림이, 출력이 잘리면 한도로 읽힐 수 있었다. → 뒤에 아무것도 없는 `error` 이벤트만 본다. 시험을 추가했다.
  - 잔여 위험으로 지적: claude가 이어 간 거절이 남았다. → 마지막 답만 본다. 시험을 추가했다.
  - P2(repo 규칙): 결정·실행 번호 충돌(D36·U30). → D37·U31로 옮겼다.
  - 반영하지 않음:
    - `handoffs.list`로 읽기. `get()`이 unknown lease를 바꿔 읽어 같은 동작이 아니다.
    - 30분 고정 대신 점점 늘리기. 사용자 선택 2-A를 바꾸는 일이라 ASSUMED로 적었다.
- **수정 재확인:** 독립 리뷰어 하나가 고친 결과를 다시 봤다. 결과는 kit 실행 증거 `.ai-workflow/runs/U31-review-1.md`에 있다.

## 확인하지 않은 것과 남은 위험

- 한도에 걸린 실제 계정으로 다시 돌려 보지 않았다. 지금 이 Mac에 그런 계정이 없다. 위 근거는 실제 확인 1차의 출력과 설치본의 코드·문자열이다.
- claude가 `-p` stream에서 거절 전에 `status: "rejected"`인 `rate_limit_event`를 내는지, `resetsAt`이 초 단위인지는 실제로 보지 않았다. 없으면 30분 뒤에 다시 한다.
- codex의 계정 문구가 실제 실패 이벤트에 그대로 실리는지는 실제로 보지 않았다. 설치본 문자열과 이벤트 이름으로만 판단했다. codex 모양의 출력을 엔진(`storyOutcome`)까지 통과시키는 시험은 없다. 엔진 시험은 claude 출력만 쓴다.
- **후속 후보(D37 밖):** 기다리는 동안 Office의 실행기 탐색이 그 실행기를 로그아웃·막힘으로 보면, 다시 하는 실행이 시작 전에 `RUNNER_NOT_READY`로 거부된다. 그러면 출력이 비어 시도로 센다. 승인한 신호(1-A) 밖이라 넣지 않았다.
- 리뷰 단계에서만 막힌 경우에도 다시 할 때 Engineer부터 다시 돈다(2-A). 6시간 동안 작업 실행기 사용량을 쓸 수 있다.
- 사람이 다시 로그인하거나 크레딧을 넣어도 기다림을 당길 방법이 없다(`team rerun`은 `failed`에서만). 최대 30분, 또는 리셋 시각까지 기다린다.
- 기다리는 동안 PL에게는 Hub에서 진행 중(`build`)으로만 보인다(3-A).
- 실패 보고 뒤 `team status`에는 그 이유가 남지 않는다. 다른 실패 종류도 같은 기존 동작이다. Hub와 Office 로그에는 남는다.
- 가져가기 전에 한도를 미리 알지 않는다(ASSUMED, D37). 한도에 걸린 계정은 Task 하나를 가져간 뒤 첫 실행에서 알고, 그 뒤 기다린다.

## 최종 확인

모든 수정 뒤 새로 돌렸다(node 24.19.0, base `226cbf1`에서 19개 파일 +801 −42, 커밋 전).

- 전체 `npm test`: **1292/1292**, 실패 0, exit 0
  - 2026-11-03T05:12Z에 시작했다. 같은 Mac의 다른 세션 시험이 끝난 뒤다.
  - 시작한 뒤 `src/`·`tests/`는 바뀌지 않았다.
  - 새 시험은 16개다(runner-account 8, team-executor 6, native-story-task 1, team-store 1).
  - 기대 모양을 고친 곳은 team-store 4곳, team-scheduler 도우미 1곳, team-office 2곳, team-lifecycle 1곳이다.
- 타입 검사(`npm run typecheck`): exit 0
- Story 검사기(`check.mjs story`): exit 0
- G1 검사(`check.mjs gate G1`): exit 0
- kit 실행 `.ai-workflow/runs/U31-runner-account-wait.json`
  - implement 2회: 1회 → 리뷰 1회차 `fix` → 2회
  - workflow-review 2회
  - workflow-verify 1회
  - 상태 `g4`다. G4(사람의 이해 확인)는 머지 전에 한다.
- main(#60–#64, D38과 따옴표 경로 요약 수정)을 합친 `e0c7bbb`에서 다시 돌렸다.
  - 전체 `npm test`: **1294/1294**, exit 0. #62가 시험 2개를 더했다.
  - 타입 검사·Story 검사기·G1 검사: exit 0.
  - 충돌은 Story(D37 다음 D38)와 STATUS뿐이었고 양쪽을 다 살렸다.
  - kit 실행 `U31-runner-account-wait-merge.json`이 이어서 `g4`다.
