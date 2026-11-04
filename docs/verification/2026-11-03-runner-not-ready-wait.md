# 2026-11-03 실행기 준비 안 됨도 시도로 세지 않고 기다린다 (D39)

Story: M16 · V18 · D39(D37의 후속). 근거: D37 리뷰의 후속(`.ai-workflow/runs/U31-review-2.md` 8번), [D37 변경 기록](2026-11-03-runner-account-wait.md)의 "후속 후보".

결정 설명 페이지: https://claude.ai/artifact/FQmjsJozgCNYT81EiKD9n3 (version 4)

- 사용자는 이 페이지를 본 뒤 1-A·2-A·3-A를 골랐다.
- Story 초안(M16 한 문장, D39, V18)을 보여 줬고, 사용자는 "맞아, 진행해"로 승인했다. G1은 `.ai-workflow/approvals/pazmo-agent-office-g1.json`에 묶었다.
- main의 G1 기록은 D37이 들어가기 전 Story(`3329bb…`)에 묶여 있었다(#65가 #66 뒤에 머지됨). 새 기록은 D36·D37·D38이 있는 Story에 D39를 더한 것이다. D37의 문구는 그대로다.

## 무엇이 바뀌었나

- **엔진의 실행기 다시 보기(3-A):** 역할 실행을 시작하기 전에, 엔진이 가진 실행기 목록에서 그 실행기가 준비 안 됨이면 실행기를 한 번 새로 확인한다(`src/runtime/runner-jobs.ts`). 바이너리가 바뀌었을 때 이미 하던 재확인과 같은 자리다. 준비됐으면 그대로 자격 검사와 실행으로 간다. 여전히 준비 안 됨이면 `RUNNER_NOT_READY <실행기>: <안내>`로 거절한다. 예전 형식은 `RUNNER_NOT_READY: <안내>`였고, 그 글을 읽는 코드는 없었다. 준비되고 바뀌지 않은 실행기는 새로 보지 않는다.
- **새로 보기가 실패할 때:** 탐색이 예외로 끝나면 마지막 목록을 그대로 쓴다. 준비 안 됨이라 새로 보던 실행은 역할의 실행기 프로세스를 띄우기 전에 그 안내로 거절되고 기다림이 된다. 바이너리가 바뀌어 새로 보던 실행은 지금처럼 `UNVERIFIED_CONTROLLER_BINARY`로 거절되고 시도로 센다. 탐색 중 claude의 모델·hook 목록 조회만 실패하면, 같은 바이너리에서 앞서 찾은 hook 막힘을 유지한다(`keptClaudeBlock`, `src/runtime/runner-settings.ts`). 조회 실패는 아무것도 판정하지 않으므로, 그것만으로 hook 때문에 막혀 있던 claude가 풀리면 안 된다(D29). 조회 실패는 목록에 `claudeUnlisted`로 표시하고, 유지한 막힘의 안내는 지금의 로그인 상태로 다시 만든다(아래 "후속").
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
- 못 잡은 것: `src/runtime/live.ts`에서 엔진에 `rediscover`를 잇는 한 줄을 지워도 시험은 통과한다. lean-office 시험의 helper가 그 줄을 복제해 쓰기 때문이다. D39 전부터 있던 빈틈이고, 이 변경은 그 줄을 바꾸지 않았다. → 후속에서 고쳤다(아래).

전체 시험·타입 검사·Story 검사의 새 결과는 kit 실행 `.ai-workflow/runs/U32-runner-not-ready-wait.json`의 검증 기록에 있다.

## 후속: 마지막 리뷰의 Minor 5건 (2026-11-03)

D39 마지막 리뷰([U32-review-2.md](../../.ai-workflow/runs/U32-review-2.md))가 남긴 Minor 5건을 머지 뒤 따로 고쳤다. D39의 동작과 Story는 그대로다. Story 해시 `b005160e`가 G1 기록과 같아 G1을 다시 받지 않았다. kit 실행은 `.ai-workflow/runs/U33-d39-minor-followups.json`(최소 계획)이다.

1. **답은 왔는데 쓸 모델이 없는 조회:**
   - 전에는 "claude 모델 목록이 빔"을 조회 실패로 봤다. 그래서 답은 왔는데 쓸 수 있는 모델 항목이 없으면, hook이 없어도 앞선 hook 막힘이 재시작 때까지 남았다.
   - 이제 `loadRunnerCatalog`가 조회 실패를 목록에 `claudeUnlisted`로 표시하고, `keptClaudeBlock`은 그 표시만 본다.
2. **유지한 막힘의 안내:**
   - 전에는 앞선 탐색의 안내를 그대로 썼다. 그 사이 로그아웃했으면 로그인 안내가 빠졌고, 로그인했으면 낡은 로그인 안내가 남았다(D30·D32의 `blockedHint`).
   - 이제 막힘을 지금의 설치 정보로 다시 만든다(`hookBlock`). 문구는 `blockHookedClaude`와 같다.
3. **`rediscover` 연결:** `rediscover`를 `choice`·`installs`와 함께 `liveRunnerWiring(runners).factory`로 옮겼다. `live.ts`와 lean-office 시험의 helper가 둘 다 그것을 펼쳐 쓴다.
4. **시험 빈틈:** 바이너리가 바뀌었는데 다시 보기가 실패한 경우의 시험을 더했다. 결과는 `UNVERIFIED_CONTROLLER_BINARY`, `closed:true`다. `runnerNotReady`가 기다림으로 읽지 않고, 자격 검사·역할 실행·실행 기록이 없다.
5. **주석:** "어떤 프로세스도 띄우기 전에"를 "역할의 실행기 프로세스를 띄우기 전에"로 고쳤다(`runner-jobs.ts` 두 곳, `runner-account.ts`, 학습 문서, 이 기록의 "새로 보기가 실패할 때"). 거절 전 탐색이 CLI를 잠깐 띄운다는 것도 적었다.

시험:
- 1·2는 고치기 전에 실패했다. 2는 두 방향(로그인 → 로그아웃, 로그아웃 → 로그인)이 따로 실패했다.
- 2의 시험은 막힘 두 종류(hook 이름, "hook 목록 없음")를 모두 본다. 유지한 안내가 새 조회의 안내와 글자까지 같은지 확인한다. "hook 목록 없음" 안내도 이제 글자까지 확인한다. 리뷰에서 "늘 hook 이름 문구를 씀" 변이가 통과해서 더했다.
- 기존 D39 시험(조회 실패는 막힘을 유지)은 실패 표시를 쓰도록 고쳤다. 안내는 이제 막힘으로 다시 만든 문구를 본다.
- 4는 이미 있던 동작이라 지금 코드에서 통과한다. 그래서 변이로 확인했다. 다음 두 변이는 같은 파일의 다른 시험 16개가 모두 통과하는데 이 시험만 실패했다.
  - 실패한 다시 보기를 준비 안 됨으로 보기: 기다림이 된다.
  - 실패하면 바이너리 검사를 건너뛰기: 검증 안 된 바이너리가 돈다.
- 3의 변이:
  - `liveRunnerWiring`에서 `rediscover`를 빼거나, 다시 보지 않고 옛 목록을 돌려주게 하면 live-runtime 시험과 lean-office D39 시험이 실패한다.
  - `live.ts`에서 펼치는 줄을 지우면 타입 검사가 실패한다.
- `keptClaudeBlock` 변이 5개를 시험이 모두 잡았다: 실패 표시 무시, 표시 안 함, 옛 안내 유지, 바이너리 비교 빼기, 옛 로그인으로 안내 만들기.
- 관련 시험 파일 11개는 238/238, 타입 검사는 exit 0이다. 바꾼 모듈을 쓰는 시험 파일은 이보다 많다(리뷰어가 import를 따라가 25개를 셌다). 나머지는 전체 시험이 덮는다. 전체 시험의 결과는 U33 실행의 검증 기록에 있다.
- kit 검증 1차에서 새 시험 하나가 시험 조각 안에서만 실패했다(431/432). 원인은 시험 helper였다. 이미 실행한 가짜 claude 실행 파일을 같은 자리에 덮어써서, macOS가 다음 `--version` 실행을 가끔 SIGKILL로 죽였다. 그러면 claude가 지원 안 되는 설치본으로 보이고 시험의 전제가 깨진다. helper가 이제 가짜가 실행하는 스크립트(`claude.sh`)만 바꾼다. 같은 부하 재현에서 60번 중 4번 실패하던 것이 0번이 됐다. [학습 문서](../solutions/test-failures/rewrite-a-fake-cli-script-not-its-executed-binary.md)

남은 것:
- `createLiveRuntime`의 `roleJobFactory` 호출에서 `rediscover`를 빠뜨리거나 덮어쓰는 변경은 시험도 타입 검사도 잡지 못한다. 예를 들어 펼치지 않고 `choice`·`installs`만 넘기거나, 펼친 뒤 `rediscover: undefined`를 적는 경우다. `rediscover`가 선택 항목이라서다. `createLiveRuntime`의 역할 실행은 VM이 있어야 돌아서 시험하지 않았다.
- lean Office는 자기 목록 사본(`src/lean/office.ts`의 `catalog`)을 읽는데, 거기에는 `keptClaudeBlock`이 적용되지 않는다. 이 사본을 읽는 곳은 세 군데다: 실행기 화면, agent 저장 검사(`LeanAgents`의 만들기·고치기, 모델을 고르지 않은 경우), 기본 실행기 고르기(`chooseRunner`·`ensureDefault`의 `defaultRunnerChoice`). 그래서 조회가 실패하면 그곳에서는 claude가 막히지 않은 것으로 보일 수 있다. 엔진의 역할 실행은 여전히 거절된다. 리뷰어가 코드로 찾았고 돌려 보지는 않았다. 이 변경 전부터 있던 것이라 따로 다룬다. → U34에서 고쳤다. 그때 엔진도 늘 거절하지는 않았음을 찾았다. 엔진 사본이 hook을 찾은 조회를 못 봤으면, D39의 다시 탐색에서 조회가 실패할 때 hook 걸린 claude가 시작됐다([변경 기록](2026-11-04-lean-kept-hook-block.md)).
- 실제 claude로는 "답은 왔는데 모델 없음"이나, 조회 실패 중 로그인 변경을 재현하지 않았다. 가짜 CLI로만 확인했다.

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
