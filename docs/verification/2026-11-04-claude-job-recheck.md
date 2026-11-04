# claude 역할 실행마다 실행 직전에 실행기를 새로 확인한다 (D40, U35)

Story: D40 · M16 · V18 · D29 · D39. 근거: U34 리뷰 2차의 Important(`.ai-workflow/runs/U34-review-2.md`)와 [U34 변경 기록](2026-11-04-lean-kept-hook-block.md)의 "확인하지 않은 것과 남은 위험".

결정 설명 페이지: https://claude.ai/artifact/MXXJSafUz1KBrRzPXhr7sD (version 1)

- 페이지는 두 방식을 보였다.
  - A: 엔진 사본이 lean 사본의 탐색을 따른다. Story는 그대로다.
  - B: claude 역할 실행 직전에 늘 다시 확인한다. D40이 필요하다.
- 사용자는 페이지를 본 뒤 "B + D40 승인"이라고 답했다(2026-11-04).
- Story에 D40과 M16 문장을 페이지의 초안대로 넣었다. D40의 "이 설명 페이지"는 링크로 바꿨다.
- ASSUMED(컨트롤러, 초안에 없음): V18에 같은 뜻의 검증 구절을 더했다. "claude 역할 실행마다 실행 직전에 실행기를 새로 확인함(준비됨 사본이어도 그 사이 생긴 hook으로 거절, D40)".
- 새 Story 해시는 `1b507999`이고, G1은 `.ai-workflow/approvals/pazmo-agent-office-g1.json`에 새로 기록했다. 이전 해시는 `b005160e`다.
- kit 실행은 `.ai-workflow/runs/U35-claude-job-recheck.json`(최소 계획)이다. 고위험 신호(돈·인증·동시성·파괴적 이관·민감 데이터)가 없는 한 줄 조건 변경이라 G3는 두지 않았다.

## 무엇이 문제였나

- 엔진은 역할 실행 전에 자기 실행기 목록 사본(`RunnerSettings`)을 본다.
- 사본이 준비됨이고 바이너리가 같으면 다시 탐색하지 않았다(`src/runtime/runner-jobs.ts`). 다시 탐색하는 경우는 준비 안 됨이거나(D39) 바이너리가 바뀐 경우뿐이었다.
- 엔진 사본은 시작할 때, 작업 만들기, agent 저장, 계획 재시도 답에만 새로 받는다.
- 그래서 작업이 도는 사이 claude에 hook이 생기면, 다음 claude 역할 실행은 그대로 시작됐다. 두 경우가 있다.
  - lean의 실행기 화면이 그 hook을 찾아 막힘을 보였다. 그래도 엔진은 실행했다(U34 리뷰 2차의 PROBE4: `error: null`, claude 실행).
  - 아무도 조회하지 않았다. hook을 아는 사본이 없었다.
- D29는 hook이 걸린 claude를 역할 실행에 쓰지 않게 한다. SessionEnd hook은 claude 출력에 나오지 않아, 실행 중 감시로는 막을 수 없기 때문이다.

## 무엇이 바뀌었나

- `roleJobFactory`는 claude를 고른 역할 실행마다, 프로세스를 띄우기 전에 `rediscover`를 부른다. 이 조건 한 줄이 바뀌었다.
  - 그 결과로 D39의 준비 검사를 한다. hook으로 막혔으면 `RUNNER_NOT_READY claude: <hook 안내>`로 거절한다.
  - 거절 문구가 D39와 같아서, 팀 Office는 D39처럼 기다린다(30분마다 다시, 6시간까지).
- 다시 탐색은 lean Office를 거친다(`liveRunnerWiring` → `RunnerSettings.refresh()` → lean `discoverNow()`). 그래서 실행기 화면의 사본도 같은 결과로 바뀐다.
- 조회가 실패한 경우는 D29·U34 그대로다.
  - 모델·hook 목록 조회만 실패하면(`claudeUnlisted`), 앞서 막힌 같은 바이너리는 막힘을 유지한다(`keptClaudeBlock`). 막힘이 없었으면 판단하지 않는다.
  - 탐색 전체가 실패하면 마지막 사본을 쓴다. 준비됨이었으면 그대로 실행하고, 준비 안 됨이었으면 거절한다.
- 다시 탐색은 취소를 기다리지 않는다. 그 사이 취소된 실행은 자격 검사 없이 `CANCELLED`로 끝난다(리뷰 1차 Minor 3). 바깥의 `superviseRemote`는 전에도 취소된 실행을 `CANCELLED`로 보고했다(`src/runners/remote-job.ts`). 그래서 달라진 것은 취소된 실행이 자격 검사(저장된 결과가 없으면 CLI를 띄움)를 하지 않는다는 점이다. 준비 안 됨인 codex를 다시 탐색할 때(D39)도 코드로는 같지만, 시험은 claude만 한다(리뷰 2차 Minor 1).
- codex 역할 실행은 그대로다. 준비됨이고 바이너리가 같으면 탐색하지 않는다. codex에는 이미 역할 실행 직전의 `CODEX_PERSONAL_INSTRUCTIONS` 거부가 있다.
- `runner-jobs.ts`와 `live.ts`의 주석을 D40에 맞게 고쳤다.

## 시험

`tests/runner-jobs.test.mjs`(가짜 설치 정보와 가짜 다시 탐색):

1. 준비됨이던 claude의 다시 탐색이 hook 막힘을 보면 `RUNNER_NOT_READY claude: <안내>`로 거절한다. 실행하는 역할 넷(pm·lead·engineer·reviewer) 모두 그렇다. 그 문구는 `runnerNotReady`가 claude로 읽고, 자격 검사·실행·증거 기록은 없다.
2. 다시 탐색해도 준비됨인 claude는 실행된다. 역할 실행마다 탐색을 한 번 한다(두 번 실행에 두 번).
3. 다시 탐색이 실패하면 마지막 준비됨 사본으로 실행한다.
4. (고침) "준비됨이고 바이너리가 같으면 다시 탐색하지 않음(D39)"을 codex로 바꿨다. 탐색은 0번이고 codex가 실행된다.
4a. 다시 탐색하는 동안 취소된 claude 실행은 `CANCELLED`로 끝나고, 자격 검사와 실행은 없다. 다시 탐색이 준비됨을 보든 막힘을 보든 같다.

`tests/lean-office.test.mjs`(손으로 만든 목록, 엔진의 실제 settings와 `liveRunnerWiring`):

5. 엔진 사본은 claude를 준비됨으로 본다. 작업이 도는 사이 SessionEnd hook이 생기고 실행기 화면만 그것을 본다. 그 뒤 claude Engineer 실행은 hook 안내로 거절되고, claude는 시작되지 않는다(PROBE4).
6. 5와 같은데 아무도 조회하지 않은 경우다. 결과도 같다.
7. 엔진 사본이 준비됨이면, codex Engineer 실행은 탐색하지 않고 claude Reviewer 실행은 한 번 탐색한다.

고치기 전(RED, 이 변경의 시험만 넣은 상태):

- `tests/runner-jobs.test.mjs`는 17/20이었다. 1–3이 실패했다. 1은 `null`과 거절 문구가 달랐고, 2는 탐색 0과 2, 3은 0과 1이 달랐다.
- `tests/lean-office.test.mjs`는 51/54였다. 5·6은 `error: null`이 나와 claude가 실행됐고, 7은 탐색 횟수가 3과 4로 달랐다.

- 4a는 리뷰 1차 뒤에 더했다. 고치기 전에 준비됨 경우는 자격 검사를 한 번 했고(0이어야 함), 막힘 경우는 `RUNNER_NOT_READY claude: remove the hook`이었다(`CANCELLED`이어야 함).

고친 뒤: 두 파일 21/21, 54/54.

변이(그 줄만 바꿈, 매번 원래대로 되돌림). 처음 넷은 두 파일(74개)로, 리뷰 1차 뒤의 둘은 75개로 돌렸다.

| 변이 | 결과 | 실패한 시험 |
|---|---|---|
| claude 조건을 뺌(고치기 전) | 68/74 | 1, 2, 3, 5, 6, 7 |
| 늘 다시 탐색(codex도) | 72/74 | 4, 7 |
| 탐색이 실패하면 거절 | 72/74 | 3, 기존 "바이너리가 바뀌고 탐색 실패" |
| 일부 claude(모델 haiku)만 다시 탐색 | 71/74 | 5, 6, 7 |
| pm·lead는 다시 탐색하지 않음 | 74/75 | 1 (리뷰 1차에서는 살아남음) |
| 다시 탐색 뒤의 취소 확인을 뺌 | 74/75 | 4a |

- 리뷰어가 따로 돌린 변이 넷(reviewer만 건너뜀, engineer만 건너뜀, 탐색 결과 무시, 작업당 한 번)도 모두 잡혔다(`.ai-workflow/runs/U35-review-1.md`).
- 관련 시험 파일 10개는 222/222이다: runner-jobs, lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office, live-runtime, runner-account.
- 타입 검사는 exit 0이다.
- 전체 시험·타입 검사·Story 검사의 결과는 kit 실행의 검증 기록에 있다: 커밋 전 트리는 `.ai-workflow/runs/U35-verify-1.md`, 커밋된 트리는 `.ai-workflow/runs/U35-committed-verify-1.md`.

## 리뷰

- 리뷰어는 한 명이다(독립 subagent, 읽기 전용). 한 줄 조건과 시험·문서의 작은 변경이라 그렇게 정했다.
- **1차**(`.ai-workflow/runs/U35-review-1.md`): 머지 가능이었다. Critical·Important 0, Minor 6.
  - 리뷰어는 모든 claude 역할 실행(pm·lead·engineer·reviewer, G4 평가, 팀 Story Task)이 `roleJobFactory`를 거치고, 고정 codex 경로와 D39 경로는 그대로임을 코드로 확인했다.
  - 고친 것: 다시 탐색 중 취소(→ `CANCELLED`, 시험 4a), pm·lead를 시험이 지키지 않음(→ 시험 1을 역할 넷으로), STATUS의 시험 개수.
  - 남은 것에 적은 것: 진행 중인 탐색을 함께 씀, 팀 Office의 탐색 재사용, 취소가 바로 듣지 않음.
  - G1이 사용자가 보지 않은 V18 구절(ASSUMED)에 묶임 → G4에서 보인다.
- **2차**(`.ai-workflow/runs/U35-review-2.md`, 1차 수정분만): 머지 가능이었다. Minor 2: 시험 빈틈 하나(문서에 밝힘)와 문서 문구 하나다.
  - 리뷰어는 취소 확인이 맞고, 팀 Office의 `CANCELLED`·`RUNNER_NOT_READY` 처리에 영향이 없다고 봤다.
  - codex 쪽 취소 확인은 시험하지 않음, 취소가 늦는 시간의 한도 → 이 기록과 STATUS의 문구를 고쳤다.
- 문서는 kit의 코드 스냅샷에 들어간다. 그래서 2차의 문구 수정 뒤에 문서만 본 3차를 했다(`.ai-workflow/runs/U35-review-3.md`). 머지 가능이었다(Minor 2: 아직 없던 기록 파일을 가리킴, 2차 요약 문구 하나 → 고침).
- 1–3차와 첫 검증은 커밋하기 전의 트리에서 했다. kit의 스냅샷에는 git HEAD도 들어가서, 커밋하면 그 실행(`.ai-workflow/runs/U35-claude-job-recheck.json`)은 낡는다. 그래서 커밋된 트리로 두 번째 kit 실행(`.ai-workflow/runs/U35-claude-job-recheck-committed.json`)을 하고, 리뷰(`U35-committed-review-1.md`)와 검증을 다시 한다. 커밋된 내용은 3차가 본 트리와 문서 몇 줄만 다르다: 위 2차 요약 문구, 검증 기록을 가리키는 줄(이 기록의 "시험" 끝과 STATUS), 이 단락. `src/`와 `tests/`는 같다.

## 확인하지 않은 것과 남은 위험

- **실제 claude로 재현하지 않았다.** 가짜 목록과 가짜 다시 탐색으로만 확인했다. 비용(claude 조회 약 1–2초)도 이번에 새로 재지 않았고, D30에서 잰 값을 썼다.
- **탐색과 실행 사이의 틈.** 다시 탐색이 끝난 뒤 claude 프로세스를 띄우기 전, 자격 검사 동안 생긴 hook은 보지 못한다. 실행 도중 생긴 hook도 마찬가지로 실행 중 감시가 맡는다. 지금과 같고, SessionEnd hook은 막지 못한다.
- **조회 실패.** 직전 사본에 막힘이 없었는데 실행 직전 조회가 실패하면, hook 걸린 claude도 시작될 수 있다(D29: 조회 실패는 판단하지 않음, 이 변경 전과 같음).
- **진행 중인 탐색을 함께 씀(lean Office).** lean Office는 이미 도는 탐색이 있으면 새로 시작하지 않고 그 결과를 함께 쓴다(`discoverNow()`). 그래서 hook이 생기기 직전에 시작된 탐색(예: 실행기 화면의 탐색)에 claude 역할 실행이 끼면, 그 실행은 hook 전의 결과로 시작될 수 있다. 틈은 탐색 한 번(약 1–2초)이다. 리뷰 1차가 임시 시험으로 확인했다(`error: null`, claude 실행). 시험에 넣지 않았다.
- **팀 Office의 탐색 재사용.** 팀 Office는 repo들이 탐색을 함께 쓰고, 5초(`DISCOVERY_TTL_MS`) 안의 결과를 다시 쓴다. Office를 켜는 동안(`hold`)에는 켤 때의 탐색을 나이와 상관없이 다시 쓰고, 그때 이어 도는 실행도 그렇다. 그래서 팀 Office의 "새로 확인"은 몇 초 전, 또는 켤 때의 결과일 수 있고, 그때는 조회 비용도 들지 않는다. 코드로만 확인했고 시험하지 않았다.
- **취소가 바로 듣지 않음.** 다시 탐색은 취소 신호를 받지 않는다. 그래서 취소·멈춤은 탐색이 끝날 때까지 기다린다. 탐색은 차례로 돈다: 버전·로그인 확인(각 10초 제한), codex 모델 목록(15초), claude 목록(15초, 멈추는 데 최대 3+12+2초). 취소 뒤 `superviseRemote`는 18초만 기다린다. 그 안에 탐색이 끝나지 않으면(CLI가 멈춘 경우) 결과가 `closed:false`가 되어 깨끗한 취소가 아니라 `PROCESS_LIVENESS_UNKNOWN`으로 끝난다. claude는 시작되지 않는다. 이 기다림은 전에는 준비 안 됨일 때만 있었고, 이제 claude 역할 실행마다 있을 수 있다(리뷰 2차 Minor 2). 시험하지 않았다.
- **hook이 도는 횟수.** hook이 있으면 claude 역할 실행을 시도할 때마다 조회 한 번에 SessionStart·SessionEnd hook이 한 번 돈다(빈 임시 폴더, 프롬프트·도구 없음, D29와 같음). 팀 Office가 D39로 기다리면 처음 시도와 30분마다의 다시 시도로 6시간 동안 13번쯤 돈다. D39에서 막힌 claude가 거절 직전에 다시 탐색할 때와 같다.
- **codex의 사본.** codex 역할 실행은 여전히 엔진 사본이 준비됨이면 다시 탐색하지 않는다. 그 사이 생긴 codex 개인 지침 파일은 역할 실행 직전의 `CODEX_PERSONAL_INSTRUCTIONS` 거부가 맡는다.
