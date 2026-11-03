# 2026-11-03 실행기 준비 안 됨도 시도로 세지 않고 기다린다 (D39)

Story: M16 · V18 · D39(D37의 후속). 근거: D37 리뷰의 후속(`.ai-workflow/runs/U31-review-2.md` 8번), [D37 변경 기록](2026-11-03-runner-account-wait.md)의 "후속 후보".

결정 설명 페이지: https://claude.ai/artifact/FQmjsJozgCNYT81EiKD9n3 (version 4)

- 사용자는 이 페이지를 본 뒤 1-A·2-A·3-A를 골랐다.
- Story 초안(M16 한 문장, D39, V18)을 보여 줬고, 사용자는 "맞아, 진행해"로 승인했다. G1은 `.ai-workflow/approvals/pazmo-agent-office-g1.json`에 묶었다.
- main의 G1 기록은 D37이 들어가기 전 Story(`3329bb…`)에 묶여 있었다(#65가 #66 뒤에 머지됨). 새 기록은 D36·D37·D38이 있는 Story에 D39를 더한 것이다. D37의 문구는 그대로다.

## 무엇이 바뀌었나

- **엔진의 실행기 다시 보기(3-A):** 역할 실행을 시작하기 전에, 엔진이 가진 실행기 목록에서 그 실행기가 준비 안 됨이면 실행기를 한 번 새로 확인한다(`src/runtime/runner-jobs.ts`). 바이너리가 바뀌었을 때 이미 하던 재확인과 같은 자리다. 준비됐으면 그대로 자격 검사와 실행으로 간다. 여전히 준비 안 됨이면 `RUNNER_NOT_READY <실행기>: <안내>`로 거절한다. 예전 형식은 `RUNNER_NOT_READY: <안내>`였고, 그 글을 읽는 코드는 없었다. 준비되고 바뀌지 않은 실행기는 새로 보지 않는다.
- **새로 보기가 실패할 때:** 탐색이 예외로 끝나면 마지막 목록을 그대로 쓴다. 준비 안 됨이라 새로 보던 실행은 프로세스를 띄우기 전에 그 안내로 거절되고 기다림이 된다. 바이너리가 바뀌어 새로 보던 실행은 지금처럼 `UNVERIFIED_CONTROLLER_BINARY`로 거절되고 시도로 센다. 탐색 중 claude의 hook 목록 조회만 실패하면, 같은 바이너리에서 앞서 찾은 hook 막힘을 유지한다(`keptClaudeBlock`, `src/runtime/runner-settings.ts`). 조회 실패는 아무것도 판정하지 않으므로, 그것만으로 hook 때문에 막혀 있던 claude가 풀리면 안 된다(D29).
- **알아보기(1-A):** `runnerNotReady`(`src/runners/runner-account.ts`)가 그 거절을 실행기·종류 `not_ready`·안내 한 줄(최대 300자, 제어 문자 제거)로 읽는다. 다른 거절(`UNVERIFIED_CONTROLLER_BINARY`, `RUNNER_QUALIFICATION_FAILED`, 시간 초과 등)은 읽지 않는다.
- **엔진의 멈춤 읽기:** `storyOutcome`이 Engineer 수령증의 `observation.error`(`ENGINEER_FAILED`)와 리뷰 노드의 `observation.error`를 읽는다. 시작 전에 거절된 리뷰는 실패가 아니라 결과를 모름(`UNKNOWN_RESULT`)으로 끝나서, D37의 `REVIEW_RUNNER_FAILED` 경로로는 보이지 않았다.
- **기다림(1-A·2-A):** D37의 기다림을 그대로 쓴다. 30분마다 같은 시도를 구현부터 다시 하고, 첫 발견부터 6시간이 지나면 `RUNNER_NOT_READY <실행기>: <안내>`로 Hub에 실패 보고한다. 로그는 `<실행기> is not ready (<안내>); not counted as an attempt; running it again at <시각>`이다. 팀 기록의 기다림 종류에 `not_ready`가 더해졌다.

## 찾은 것: 엔진의 실행기 목록 사본

- 팀 Office가 Task를 가져가기 전에 하는 확인(`agents.runnersReady`)은 실행기를 새로 본다. 그런데 엔진의 역할 실행은 `runners.settings.catalog`를 쓰고, 이 사본은 켤 때·CLI 업데이트(바이너리 변경)·단일 Office 화면의 몇 동작에서만 새로 받는다. `submitStoryTask`는 새로 받지 않는다.
- 그래서 엔진이 한 번 로그아웃으로 받은 뒤에는, 사람이 로그인해도 거절이 이어졌다. 로그아웃 상태로 팀 Office를 켠 뒤 로그인하면 가져가기 확인은 준비됨인데 엔진은 거절하는 경우도 같은 원인이다.
- 확인: 지운 임시 시험 하나(`U32-implement-1.md`). 실제 Office와 실제 CLI로는 재현하지 않았다.

## 시험

D37 시험을 본떠 고치기 전에 실패하는 것을 먼저 확인했다(8개 실패, `.ai-workflow/runs/U32-implement-1.md`).

- `tests/runner-jobs.test.mjs`: 거절이 실행기 이름을 앞세우고 `runnerNotReady`가 그 거절을 그대로 읽음, 준비 안 됨이면 한 번 새로 보고 로그인했으면 실행, 여전히 안 되면 새 안내로 거절, 탐색이 실패하면 마지막 목록으로 깔끔하게 거절, 준비되고 바뀌지 않았으면 새로 보지 않음.
- `tests/runner-settings.test.mjs`: hook 목록 조회가 실패한 새로 보기는 같은 바이너리의 hook 막힘을 유지함.
- `tests/lean-office.test.mjs`: 엔진의 목록 사본이 로그아웃인 채 사람이 로그인하면, 실제 `RunnerSettings.refresh()`로 새로 보고 Engineer가 돎.
- `tests/runner-account.test.mjs`: 거절 읽기, 한 줄·300자, 빈 안내, 다른 거절은 읽지 않음.
- `tests/native-story-task.test.mjs`: 구현 거절과 리뷰 거절(`UNKNOWN_RESULT`)에 `runnerAccount`가 붙음, 다른 거절은 붙지 않음.
- `tests/team-executor.test.mjs`: 시도로 세지 않고 기다림, 재시작 뒤에도 이어짐, 안내가 다음 시도의 Engineer 계약에 들어가지 않음, 6시간 뒤 `RUNNER_NOT_READY` 실패 보고와 로그.
- `tests/team-store.test.mjs`: `not_ready` 기다림이 저장·재시작 뒤에도 남고 `claim.waiting`에 나옴.

리뷰에서 더한 시험 중 이미 쓴 코드를 지키는 것은, 코드를 되돌리면 실패하는지 변이로 확인했다. 7개 중 6개가 실패했다(`.ai-workflow/runs/U32-implement-2.md`).
- 잡은 것: 예전 조건(바이너리가 바뀔 때만 새로 봄), 매번 새로 봄, 저장의 `not_ready` 종류 빼기, `waitingOf`가 `not_ready` 숨기기, `storyOutcome`이 실행 오류 무시, 기다림 안내를 다음 Engineer에게 넘기기.
- 못 잡은 것: `src/runtime/live.ts`에서 엔진에 `rediscover`를 잇는 한 줄을 지워도 시험은 통과한다. lean-office 시험의 helper가 그 줄을 복제해 쓰기 때문이다. D39 전부터 있던 빈틈이고, 이 변경은 그 줄을 바꾸지 않았다.

전체 시험·타입 검사·Story 검사의 새 결과는 kit 실행 `.ai-workflow/runs/U32-runner-not-ready-wait.json`의 검증 기록에 있다.

## 확인하지 않은 것과 남은 위험

- 실제로 로그아웃·설치 없음·막힌 CLI로 팀 Office의 Task를 돌려 보지 않았다(실제 확인 2차에서).
- 준비 안 됨이 이어지는 동안 30분마다 한 번씩 CLI 확인(claude·codex를 잠깐 띄움, 걸리는 시간은 재지 않음)과 새 엔진 작업·계약 폴더(`…-r<번째>`)가 생긴다. 6시간이면 최대 12번이다.
- 그 확인은 역할 실행의 240초 감독 시간 안에서 돈다. 확인이 길어지면 실행에 남는 시간이 줄어든다.
- 리뷰 단계에서 거절돼도 다시 할 때는 같은 시도를 구현부터 한다(D37·D39 2-A). 그래서 기다리는 동안 30분마다 Engineer가 다시 돈다.
- 기다림의 `since`는 실행 하나가 통과할 때까지 종류가 바뀌어도 이어진다(D37 동작). 사용 한도로 기다리다 준비 안 됨으로 바뀌어도 6시간은 첫 발견부터 센다.
- 로그인한 뒤 Task가 다시 돌기까지 최대 30분이다(D37과 같은 간격, ASSUMED).
- 단일 Office도 바뀐다. 실행기 목록이 준비 안 됨이라고 하면 거절 전에 한 번 새로 본다. 그 사이 로그인했으면 거절하지 않고 돈다. 작업 실패 표시는 그대로다.
- 이전 버전 Office로 되돌리면 `not_ready` 기다림 기록은 기다림 없음으로 읽히고, 다음 실행에서 다시 찾는다.
- Story(D39) 문구의 한계 두 가지. 문구를 고치려면 새 G1과 새 실행이 필요해서 여기에 적는다.
  - "몇 초 만에 시도 3개"는 코드로 추론한 것이다. 관찰하지 않았다.
  - "켤 때와 CLI가 업데이트됐을 때만 새로 본다"는 팀 Office에서 맞다. 단일 Office에서는 화면의 몇 동작도 목록을 새로 받는다.
