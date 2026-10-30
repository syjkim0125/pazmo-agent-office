# 2026-10-30 모델 목록 조회 claude의 멈춤 유예 12초, lean 시작 대기 30초

Story: M3 · M4 · D31. 근거: [실제 CLI 확인](2026-10-29-real-cli-runner-checks.md)의 4번, [#45 변경 기록](2026-10-30-claude-stop-grace-hooks.md)의 "아직 하지 않은 것". 설명 페이지: "OAuth 갱신 잠금 사고" 6부. kit graph: `.ai-workflow/runs/U26-discovery-stop-grace.json`.

## 왜 바꿨나

- Office는 claude의 모델 목록을 물은 뒤(`claudeModels`) 그 claude를 이렇게 멈췄다: 입력 닫기 → 3초 → 그룹 SIGTERM → **2초** → SIGKILL → 2초(#34).
- 실제 claude 2.1.280은 갱신 중에 SIGTERM을 받으면 갱신을 최대 2초 기다리고 나가며, 나갈 때 갱신 잠금(`~/.claude/.oauth_refresh.lock`)을 푼다. SIGTERM부터 끝까지 부하 시험이 막 끝난 때 0.55–2.53초, 바쁠 때 최대 9.1초가 걸렸다(완전히 한가한 Mac은 재지 않았다). 2초 유예는 CLI가 스스로 기다리는 시간과 같거나 짧다.
- lean Office에서 조회는 작업 만들기·계획 "다시 시도" 답·agent 실행기 저장 바로 앞에서 캐시 없이 돈다. 2026-10-23 사고(조회 claude의 SIGKILL로 잠금이 남아 계획 claude가 로그인 실패)가 난 자리다. #45(D28)는 역할 실행만 12초로 늘렸다.
- 사용자 선택(2026-10-30, 6부의 (a)): 조회도 12초, lean 시작 대기 15초 → 30초.

## 바뀐 동작

- 조회 claude의 멈춤: 입력 닫기 → 3초 → SIGTERM → **12초** → SIGKILL → 2초. 멈춤 최악 7초 → 17초. 세 값은 `CLAUDE_STOP_MS`(`src/runners/runner-models.ts`, 고정 객체)에 있다.
  - 보통 claude는 입력을 닫으면 0.3초에 끝나므로 그대로다.
  - 더 기다리는 것은 입력을 닫고 5초 뒤에도 살아 있는 claude가 있을 때뿐이다. 그때 조회를 기다리는 요청이 최대 10초 더 기다린다.
    - lean: 작업 만들기, 계획 재개 답, agent 실행기 저장, agent 대화상자의 실행기 목록.
    - Claw: 실행기 상태 새로고침(`/api/cli-status?refresh`), agent 저장 때 고른 실행기를 쓸 수 없어 다시 조회하는 경우. 역할 작업의 재조회(`runner-jobs.ts`)는 HTTP 요청 밖에서 돈다.
    - bridge·operator CLI(10초 fetch 한도)는 조회를 동기로 부르는 경로가 없다(리뷰어 확인).
  - 15초 안에 답하지 않는 claude는 그 뒤 같은 멈춤을 거치므로 조회 하나가 최대 32초(이전 22초)다.
- lean Office 시작 대기(`STARTUP_MS.lean`, `src/cli/lifecycle.ts`): **15초 → 30초**. live lean Office는 첫 조회를 마친 뒤에야 준비를 알린다(`lean-service.ts` → `createLeanOffice` → `createNativeOffice`의 `runners.settings.refresh()`).
  - 30초는 답한 claude의 멈춤 최악 17초보다 13초 길다. 15초를 다 쓰고도 답하지 않는 claude(조회만 최대 32초)까지는 덮지 않는다. 그 시작은 지금처럼 "Office startup timed out"으로 끝나고, 서비스가 SIGTERM을 받아 나가면 조회 claude(자기 프로세스 그룹)는 입력 끝을 받고 스스로 끝난다. 잠금은 남지 않는다.
  - 서비스가 죽거나 오류로 답하면 지금처럼 바로 끝나므로, 늦어지는 것은 답도 안 하고 죽지도 않는 서비스뿐이다.
- `tests/team-registry.test.mjs`의 CLI 실행 한도는 30초에서 `STARTUP_MS.lean + 30000`으로 바꿨다. 한도가 시작 대기와 같으면 느린 `start --lean`을 시험이 먼저 죽여 `start.lock`이 남는다(리뷰 지적).
- 그대로인 것: claw 시작 대기 120초, legacy·team 15초(team은 저장소 엔진이 잠긴 채 열려 조회하지 않는다), 조회의 15초 응답 한도, 역할 실행의 12초·18초(D28), 오류 코드.
- 고르지 않은 안: 모델 목록을 먼저 돌려주고 claude는 뒤에서 멈추기. 바로 뒤 계획 claude가 아직 갱신 중인 조회 claude와 겹친다. 계획 claude는 잠금을 5번(1–2초 간격) 다시 보고 최대 7.5초쯤 더 기다린 뒤 포기하는데(10-23 관측 10–11초), 바쁠 때 갱신 claude는 조회 입력을 닫은 뒤 최대 12.1초(3초 + 9.1초)까지 걸릴 수 있다.

## 시험

`tests/runner-models.test.mjs` (가짜 claude는 잠금을 잡고, 기본 TERM 처리기가 잠금을 풀고 나간다):

- 새 시험 "a claude that takes 9 s to release the lock after SIGTERM still releases it": 입력 끝을 무시하고, SIGTERM을 받으면 시험이 허락할 때(SIGTERM 뒤 11.999초)까지 기다렸다가 잠금을 풀고 나간다.
- 바꾼 시험 "a claude that ignores SIGTERM too is killed once its 12 s grace runs out": SIGTERM 뒤 11.999초에 아직 살아서 ping에 답하고, 12초에 SIGKILL된다. 예전 시험(같은 경우를 실제 시간으로 기다림)을 바꿨다. 실제 시간으로는 이제 15초가 넘게 걸리기 때문이다.
- 두 시험은 조회의 시계(`setTimeout`)를 `t.mock.timers`로 돌린다. 가짜가 입력 끝과 SIGTERM을 본 뒤에만 시계를 움직이므로 바쁜 Mac의 영향을 훨씬 덜 받는다. 가짜가 그 지점까지 가는 것은 실제 시간으로 기다리고, 시험마다 15초 한도가 있다.
- `refreshingClaude`는 TERM 처리기를 바꿀 수 있고, 시험이 끝나면 남은 가짜를 그룹째 죽인다.

`tests/lean-lifecycle.test.mjs`:

- 새 시험 "the lean start wait is 10 s longer than a discovery claude's slowest stop": `STARTUP_MS.lean ≥ CLAUDE_STOP_MS 합 + 10초`. 두 상수가 따로 바뀌지 않게 묶는 시험이다. 30초가 시작 전체에 충분하다는 증명은 아니다(27초에서도 통과한다).

RED (고치기 전):

- 9초 시험: `the lock was released` 실패(true !== false). 2초 뒤 SIGKILL로 잠금이 남았다.
- SIGTERM 무시 시험: `it still runs 1 ms before the grace runs out` 실패('ended'). 2초에 이미 죽었다.
- 시작 대기 시험: 15000 < 7000 + 10000으로 실패.

GREEN: runner-models 16/16, 시작 대기 시험 1/1, runner-settings 18/18, 타입 검사 exit 0.

돌연변이(값을 바꿔 시험이 잡는지): SIGTERM 유예 11999 → 두 시험 실패, 12001 → SIGTERM 무시 시험 실패(15초 한도), 2000 → 두 시험 실패, lean 26999 → 시작 대기 시험 실패. 4/4 잡음, 값은 되돌렸다. 리뷰어도 따로 복사본에서 같은 결과를 냈다(12000 통과, lean 27000 통과).

## 자동 검증

- 전체 `npm test`: **1106/1106** exit 0. 리뷰 1차를 고친 뒤 11:10–11:12(load average 10–20, 다른 전체 시험 없이)에 돌렸다. 코드·시험 파일은 11:07에 마지막으로 바뀌었다. 고치기 전 같은 값으로 돌린 10:47–10:50도 1106/1106이었다. main의 1104에 새 시험 2개가 더해졌다.
- 타입 검사 exit 0, Story 검사기 exit 0(11:16).
- kit graph `U26-discovery-stop-grace.json`: implement(2회) → workflow-review(2회) → workflow-verify, `status`의 action은 `g4`다.

## 리뷰 (독립, 보고만)

1차(새 리뷰어, 코드와 D31만 받음): **Changes needed.** 제품 코드는 D31대로 맞고, 문서와 시험 표현을 고치라는 지적이었다. 기록: `.ai-workflow/runs/U26-review-1.md`.

- Important 1: 30초와 시작 대기 시험은 15초 동안 답하지 않는 claude(조회만 최대 32초)를 덮지 않는다. → 시험 이름을 증명하는 것으로 바꾸고, `lifecycle.ts` 주석과 이 기록에 그 경우와 안전한 실패를 적었다. 값(30초)은 사용자 선택이라 그대로 두고 사용자에게 묻는다.
- Important 2: solutions 문서가 `runCommand`는 claude를 끝내지 않는다고 적었지만, 조회 1단계의 `claude --version`·`claude auth status`는 `runCommand`가 10초 시간 초과 때 SIGKILL한다. → 문장을 고치고 후속으로 남겼다.
- Minor: team-registry 실행 한도(고침), "한가할 때" 표현(고침), 7.5초 표현(고침), Claw의 동기 조회(이 기록에 적음; D31 본문은 그대로), claw 시작 문서의 위치·줄 번호·"unmerged"(고침), "흔들리지 않는다" 과장(고침), `CLAUDE_STOP_MS` 고정(고침), lean 종료 한도 10초(아래 "확인하지 못한 것"에 적음).
- 고치지 않은 것: 역할 실행(`claude-controller.ts`)과 같은 12초를 상수 하나로 묶기(경계 파일이 바뀌면 실행기 자격 검사가 다시 돈다), 이미 실패한 시험의 처리되지 않은 거부.

2차(같은 리뷰어, 고친 것만): **Ready.** 기록: `.ai-workflow/runs/U26-review-2.md`.

- "시작이 시간 초과로 끝나도 조회 claude는 입력 끝을 받고 스스로 끝난다"를 확인했다. lifecycle은 서비스에만 SIGTERM을 보내고, 서비스는 10초 안에 나가며, 따로 띄운(detached) claude는 SIGKILL을 받지 않는다. Node의 stdio 파이프로 띄운 자식은 부모가 `process.exit`하면 다른 자식이 살아 있어도 입력 끝을 받았다. 실제 claude 2.1.280(`--version`, 빈 HOME, stdout을 읽는 쪽을 먼저 닫음)은 `{code: 0, signal: null}`로 끝났고 `/bin/echo`는 SIGPIPE로 죽었다. 그래서 claude가 종료 처리 없이 SIGPIPE로 죽지는 않는다.
- Minor: solutions 문서의 코드 조각(고침), STATUS에 32초 경우와 사용자 질문(고침), 시험 이름의 "10 s longer"가 실제로는 "적어도"(고치지 않음, 시험 파일이 기록된 구현 증거이고 실패 메시지에 값이 나온다), 30초를 두는 것은 32초 경우를 알고 덮지 않는 결정이므로 사용자 답을 D31이나 새 결정으로 남길 것(사용자에게 물음).

## 확인하지 못한 것

- 갱신 중인 실제 claude가 입력이 닫히는 것만으로 끝내기를 시작하는지, 시작한다면 얼마나 걸리는지. 4번 측정은 모두 SIGTERM부터 쟀다. 이 변경은 SIGTERM부터 12초를 주므로 어느 쪽이든 측정 최대(9.1초)를 넘긴다.
- 갱신이 걸린 동안 실제 claude가 `initialize`에 답하는지. 답하지 않으면 조회는 15초를 기다린 뒤 멈춘다(위의 32초 경우).
- 실제 claude로 새로 재지 않았다. 근거는 4번 측정과 가짜 claude 시험이다.
- 바쁠 때의 실제 lean 시작 시간. 시작에는 조회 1단계(명령 4개, 각 10초 한도), codex 모델 목록(15초 한도), claude 조회, 그 뒤 git·docker 확인이 이어진다.
- 조회 1단계의 `claude auth status`가 로그인을 갱신하거나 잠금을 잡는지. 잡는다면 10초 시간 초과의 SIGKILL이 잠금을 남길 수 있다(후속).
- lean 서비스의 종료 한도는 10초다. 시작 중 조회가 도는 동안 서비스가 SIGTERM을 받으면 조회의 마지막 SIGKILL 전에 나갈 수 있다. 실제 claude는 입력 끝을 받고 스스로 끝나지만, SIGTERM까지 무시하는 CLI는 남는다. 그 구간이 2초에서 12초로 늘었다.
- 실제 토큰 서버가 느리게 답하는 갱신(4번과 같음).
