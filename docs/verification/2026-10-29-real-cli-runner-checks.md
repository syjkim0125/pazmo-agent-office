# 2026-10-29 실제 claude·codex CLI로 리뷰 실행기 오류와 SIGTERM 종료 확인

앞선 변경: PR syjkim0125/pazmo-agent-office#35([리뷰 실행기 오류](2026-10-27-review-runner-failure.md)), PR syjkim0125/pazmo-agent-office#40([claude 멈춤](2026-10-28-claude-stop-integrity.md)). 두 변경의 자동 시험은 가짜 CLI로 흉내만 냈다. 이 기록은 그중 세 가지를 이 Mac의 실제 CLI로 본 결과다. **제품 코드는 바꾸지 않았다.** 제안은 맨 아래에 있다.

## 환경

- main `d7a0af2`(#40 머지 `b84d62d` 포함), Node 24.19.0, 2026-10-29.
- claude 2.1.280: `/opt/homebrew/Caskroom/claude-code@latest/2.1.280/claude`, sha256 `387a5c5d…229d`.
- codex-cli 0.163.0: bun 전역 설치의 native 바이너리, sha256 `88133672…ee31`. Office 기본값(`installed`)이 쓰는 CLI다.
- colima VM `pazmo-office`, qualified exec-server(sha256 `9b7c1c7a…48a9`), node 이미지 `a9f5f7c9…`.
- 스크립트 두 개를 [real-cli-checks/](real-cli-checks/)에 두었다. `npm test`에는 들어가지 않는다(`tests/*.test.mjs`만 돈다).

## 1. claude 리뷰어의 API 오류 → `REVIEW_RUNNER_FAILED`

**결론: 확인됨.** 없는 모델을 고른 실제 claude 리뷰어는 API 404로 exit 1을 냈다. Office는 리뷰를 `unknown`으로 기록했고, 라운드는 `human_required`/`REVIEW_RUNNER_FAILED`로 멈췄다. 엔지니어는 다시 돌지 않았다.

### 경로

[`review-runner-error.test.mjs`](real-cli-checks/review-runner-error.test.mjs)는 아래를 실제로 쓴다.

- `OfficeCoordinator`와 `KitDelivery`. 프로젝트는 `tests/coordinator-fixture.mjs`가 만드는 버려지는 임시 repo다.
- `ContainerVerifier`. 등록 검사가 VM 컨테이너에서 돈다.
- `ContainerReviewer`와 `claudeJob`. Office bridge, exec relay, VM exec-server를 거치고, 사용자의 claude 로그인과 모델 `claude-nonexistent-0`을 쓴다.

엔지니어만 대역이다. 대역은 시험 파일 하나를 쓰고 끝난다.

lean Office 전체로 돌리지 않은 이유: Agents 설정은 CLI가 내놓은 모델 목록에 없는 이름을 `RUNNER_MODEL_UNKNOWN`으로 거부한다(`src/runtime/runner-settings.ts`). 그래서 화면에서는 실제 API 오류를 고를 수 없다.

```bash
node --experimental-vm-modules --test docs/verification/real-cli-checks/review-runner-error.test.mjs
```

### CLI가 내놓는 것

Office 인자에서 MCP bridge만 빼고 직접 돌렸다. 결과는 exit 1, 4.3초였다.

- stdout(stream-json):
  1. `system/init`. `apiKeySource: "none"`, 즉 구독 로그인이다.
  2. `system/commands_changed`.
  3. `assistant` text: "There's an issue with the selected model (claude-nonexistent-0). It may not exist or you may not have access to it. Run --model to pick a different model." 이 이벤트에는 `error: "model_not_found"`가 붙는다.
  4. `result`: `subtype: "success"`, `is_error: true`, `api_error_status: 404`.
- stderr: `[claude-code:unrecognized_model] {"model":"claude-nonexistent-0","query_source":"sdk"}`

`result.subtype`이 `success`라도 `is_error`가 true이므로 `normalizeClaudeStream`은 `turn.failed`를 낸다.

### Office 결과

| 실행 | 전체 | 리뷰 | 라운드 | 두 번째 `run()` | 엔지니어 |
|---|---|---|---|---|---|
| 1 | 12.7초 | 8.1초 | `human_required` / `REVIEW_RUNNER_FAILED` | 같음 | 1회 |
| 2 | 6.7초 | 4.6초 | 같음 | 같음 | 1회 |
| 3 | 7.5초 | 5.4초 | 같음 | 같음 | 1회 |
| 4 (커밋한 스크립트) | 6.5초 | 4.2초 | 같음 | 같음 | 1회 |

- 리뷰 관찰값은 `exitCode: 1`, `signal: null`, `timedOut: false`, `error: null`, `report: null`이었다. 검사 노드는 `pass`, 리뷰 노드는 `unknown`이었다.
- kit 리뷰 노드는 `status: "failed"`, `output.verdict: "needs_changes"`, `evaluation: { passed: false, action: "human", feedback: "Reviewer did not produce a valid closed observation." }`로 남았다. #35 기록의 "바꾸지 않은 기존 동작"과 같다. 실행되지 않은 리뷰를 `needs_changes`로 남기는 문제는 별도 작업(kit-needs-changes 세션)에서 다룬다.
- 부하 메모: 다른 세션이 CPU 부하 시험(load average 125)을 돌릴 때 커밋한 스크립트를 한 번 돌렸다. 이때는 리뷰 전에 `DIFF_FAILED`로 멈췄다. 리뷰어가 돌지 않았으므로(`reviews: []`) 위 표에는 넣지 않았다. 부하가 15 아래로 내려간 뒤 다시 돌린 것이 4번이다.

## 2. codex exec의 API 오류 종료 코드

**결론: exit 1이다.** Office의 규칙(`exitCode !== 0`이면 실행기 실패, `src/core/verification.ts`의 `reviewRunnerFailed`)이 그대로 적용된다. 고칠 것은 없다.

### A. 그냥 `codex exec`

```bash
env -i HOME=<빈 폴더> CODEX_HOME=$HOME/.codex PATH=/usr/bin:/bin LANG=en_US.UTF-8 \
  <codex native> exec --json --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules \
  -s read-only -C <빈 폴더> -m gpt-nonexistent-0 -- "Reply with OK." < /dev/null
```

결과는 exit 1, 5.4초였다. stdout:

```
{"type":"thread.started",...}
{"type":"item.completed","item":{"type":"error","message":"Model metadata for `gpt-nonexistent-0` not found. Defaulting to fallback metadata; ..."}}
{"type":"turn.started"}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-nonexistent-0' model is not supported when using Codex with a ChatGPT account.\",\"code\":\"model_not_found\"}}"}
{"type":"turn.failed","error":{"message":"...같은 내용..."}}
```

stderr는 `Reading additional input from stdin...` 한 줄이다.

### B. Office 인자, 실제 relay, VM, coordinator

```bash
REVIEW_RUNNER=codex node --experimental-vm-modules --test docs/verification/real-cli-checks/review-runner-error.test.mjs
```

- 이 Mac에는 `~/.codex/AGENTS.md`가 있다. 그래서 Office의 `codexJob`은 실행 전에 `CODEX_PERSONAL_INSTRUCTIONS`로 거부한다.
- 스크립트는 `codexJob`의 supervise에서 이 거부만 빼고, 같은 순서로 직접 부른다: `openExecRelay` → `codexRemoteProfile` → `runCodexOnRelay`.
- 모델 목록은 Office의 `codexModels`·`writeCodexCatalog`로 만들고, slug만 `gpt-nonexistent-0`으로 바꿨다. API가 모델에서 요청을 거부하므로, 함께 실렸을 개인 지침은 결과와 관계없다.

| 실행 | codex | 라운드 | 두 번째 `run()` | 엔지니어 |
|---|---|---|---|---|
| 1 | exit 1, 28.6초 | `human_required` / `REVIEW_RUNNER_FAILED` | 같음 | 1회 |
| 2 (커밋한 스크립트, load average 125) | exit 1, 60.0초(리뷰 전체 72.6초) | 같음 | 같음 | 1회 |

stdout은 A와 같은 `error`·`turn.failed`로 끝난다. 첫 error 항목만 다르다. 모델 목록에 slug가 있어서 메타데이터 경고가 없고, 대신 아래 `shell_zsh_fork` 경고가 나온다.

### 함께 본 것

- **`shell_zsh_fork` 경고.** Office가 넘기는 `-c features.shell_zsh_fork=false`에 대해 0.163.0은 매 실행마다 `item.completed` error 항목을 낸다: "`[features].shell_zsh_fork` is deprecated and ignored…". 실행은 그대로 이어진다(제안 P3).
- **네트워크 실패에서는 끝나지 않는다.** A와 같은 명령에 `HTTPS_PROXY`를 닫힌 포트(127.0.0.1:9)로 줬다. codex는 다음 순서로 재시도했고, 300초에 perl `alarm`으로 끊었다(exit 142).
  1. "Reconnecting... 1/5–5/5"
  2. "Falling back from WebSockets to HTTPS transport"
  3. "Reconnecting... waiting for network" 반복

  Office에서는 역할 시간 한도(240초)에 `TIMEOUT`으로 끝나고, 이유는 `UNKNOWN_RESULT`가 될 것이다. 이 부분은 측정하지 않았다. Office는 codex에 `HTTPS_PROXY`를 넘기지 않아서 같은 조건을 Office 경로로 만들 수 없었다.
- pinned 0.155.1 controller는 보지 않았다. 모델이 `gpt-5.5`로 고정이라 없는 모델을 넣을 수 없다.

## 3. claude가 SIGTERM에 끝나는 데 걸리는 시간

**결론: 갱신이 없을 때 0.3–1.7초다.** SessionEnd hook이 있으면 기본 1.5초 한도까지 기다려 최대 1.9초다. hook에 timeout을 주면 그만큼(최대 60초) 늘어난다. SessionEnd hook은 stream-json 이벤트로 나오지 않는다. 갱신 중인 claude는 재 보지 않았다(4번).

[`claude-sigterm.mjs`](real-cli-checks/claude-sigterm.mjs)의 방식:

- claude를 `claudeProfile`의 인자로 띄운다. MCP 설정은 Office bridge 대신 빈 설정이다.
- `runClaude`처럼 detached 프로세스 그룹에 SIGTERM을 보낸다. SIGKILL은 보내지 않는다.
- 끝난 뒤 다음을 본다: 그룹에 남은 프로세스, `.oauth_refresh.lock`, SIGTERM 뒤 stdout·stderr.

```bash
node docs/verification/real-cli-checks/claude-sigterm.mjs fake-api 5
node docs/verification/real-cli-checks/claude-sigterm.mjs real 5 1500
node docs/verification/real-cli-checks/claude-sigterm.mjs real-init 3 200
HOOK_SLEEP=1 node docs/verification/real-cli-checks/claude-sigterm.mjs hook 3
HOOK_SLEEP=8 HOOK_TIMEOUT=4 node docs/verification/real-cli-checks/claude-sigterm.mjs hook 1
```

| 상황 | 로그인 | 횟수 | SIGTERM→종료 | 종료 | SIGTERM 뒤 출력 |
|---|---|---|---|---|---|
| API 응답 대기(가짜 API가 답하지 않음), 요청 도착 1.5초 뒤 | 격리 `CLAUDE_CONFIG_DIR`, 가짜 API 키 | 5 | 305–335ms | 143 | 없음, stderr 없음 |
| 같음(커밋한 스크립트, 부하 높음) | 같음 | 3 | 372–439ms | 143 | 없음 |
| 실제 API로 답하는 중, 첫 `assistant` 1.5초 뒤 | 사용자 로그인, `haiku` | 5 | 1091–1515ms | 143 | 없음, stderr 없음 |
| 실제 API, `init` 0.2초 뒤 | 사용자 로그인, `haiku` | 3 | 779–1677ms | 143 | `system/thinking_tokens` 1–2줄. 1회는 `assistant` 메시지까지 |
| SessionEnd hook 1초(`--settings`) | 격리 | 3 | 1449–1577ms | 143 | 없음 |
| 같음, `--setting-sources ""` 유지 | 격리 | 2 | 1321–1352ms | 143 | 없음 |
| SessionEnd hook 8초, timeout 없음 | 격리 | 2 | 1906–1917ms | 143 | stderr `SessionEnd hook [...] failed: Hook cancelled` |
| SessionEnd hook 8초, `timeout: 4` | 격리 | 1 | 4399ms | 143 | 같은 stderr |

- 모든 실행에서 다음을 확인했다.
  - 종료는 신호가 아니라 code 143이었다.
  - 프로세스 그룹에 남은 프로세스가 없었다.
  - 격리 config에 `.oauth_refresh.lock`이 남지 않았다.
  - 실제 로그인 실행 앞뒤로 `~/.claude/.oauth_refresh.lock`이 없었다.
- SIGTERM 뒤에도 `thinking_tokens`나 `assistant` 줄이 나올 수 있다. #40의 4번(종료 중 hook이 아닌 줄은 무시)이 맞는 처리다.
- **SessionEnd hook:**
  - SIGTERM 뒤 24–117ms에 시작한다. "SIGTERM 종료가 SessionEnd hook을 실행한다"는 #40 리뷰어의 바이너리 읽기와 맞는다.
  - `--include-hook-events`로도 stream에 나오지 않는다. SIGTERM 때도, 정상 종료 때도 그렇다.
    - 정상 종료 비교: 사용자 로그인과 없는 모델로 돌렸다(exit 1).
    - SessionStart hook은 `init` 앞에 `system/hook_started`·`system/hook_response`로 나왔다.
    - SessionEnd hook은 표시 파일에 기록됐지만 stream에는 없었다.
  - CLI는 SessionEnd hook을 기다린 뒤 끝낸다. 바이너리 기준 한도는 이렇다.
    - `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`가 있으면 그 값이다.
    - 없으면 `max(1500, min(가장 긴 hook timeout×1000, 60000))`ms다.
  - `--setting-sources ""`여도 `--settings` 파일의 hook은 돈다.
    - Office는 `--settings`를 넘기지 않으므로, Office 실행에 남는 것은 관리형 hook이다.
    - 이 Mac에는 `/Library/Application Support/ClaudeCode/`가 없다.
    - 관리형 hook으로는 시험하지 않았다(시스템 폴더 쓰기가 필요하다).
- 실제 로그인 실행은 Office가 취소할 때와 같은 일을 한다: 정상 실행 중에 SIGTERM을 받는다. 자격 증명을 고치거나 복사하거나 갱신을 일으키지 않았다.

## 4. 갱신 중인 claude의 SIGTERM — 하지 않음

갱신을 일으키려면 만료된 자격 증명이 필요하다. 사용자의 실제 자격 증명(`~/.claude`, Keychain `Claude Code-credentials`)은 건드리지 않기로 했으므로 **사용자 확인 전에는 돌리지 않았다.**

claude 2.1.280 바이너리에서 확인한 것:

- `CLAUDE_CONFIG_DIR`를 주면 Keychain 서비스 이름은 `Claude Code-credentials-<config 경로 sha256 앞 8자리>`가 된다. 사용자의 항목과 다른 이름이다.
- 평문 저장은 `<config>/.credentials.json`, 잠금은 `<config>/.oauth_refresh.lock`이다.
- `CLAUDE_CODE_CUSTOM_OAUTH_URL`은 승인된 주소만 받는다. 그래서 로컬 가짜 토큰 서버로는 바꿀 수 없다.

안전한 방법(제안, 사용자 확인 필요):

- 격리 `CLAUDE_CONFIG_DIR`의 `.credentials.json`에 **가짜** 토큰을 넣는다. 만료 시각은 과거로 한다.
- 받기만 하고 답하지 않는 로컬 프록시를 `HTTPS_PROXY`로 준다. 갱신 요청이 걸린 채 남는다.
- 그 상태에서 SIGTERM을 보내고 다음을 잰다: 종료 시간, 잠금이 풀리는지, 출력.
- 가짜 토큰은 프록시가 전달하지 않으므로 Anthropic에 닿지 않는다.
- 남는 위험: CLI가 격리 config용 Keychain 항목(`Claude Code-credentials-<hash>`)을 읽거나 만들 수 있다. 사용자의 실제 항목은 아니다. 생겼다면 시험 뒤 지울지 사용자에게 묻는다.
- 쓰지 않을 방법: 실제 로그인이 만료되기를 기다려 관찰하는 것. 시점을 정할 수 없고, 갱신 도중 끊기면 로그아웃될 수 있다.

## 제안 (제품 코드는 바꾸지 않았다)

- **P1. SessionEnd hook은 Office의 hook 감시에 보이지 않는다.**
  - 다음 둘은 stream에 나온 hook 이벤트로만 움직인다.
    - `isHookEvent` → `CLAUDE_HOOK_UNEXPECTED`
    - #40의 "취소 뒤 종료 중 hook 이벤트 → 바로 SIGKILL"
  - 실제 CLI는 SessionEnd를 stream에 내지 않는다. 그래서 관리형 SessionEnd hook은 Office 모르게 호스트에서 돈다. 정상 종료마다 돌고, 취소·시간 초과의 SIGTERM 종료 때도 돈다.
    - hook timeout까지(최대 60초) 돌 수 있다.
    - 단, Office는 SIGTERM 6초 뒤 그룹을 SIGKILL한다.
  - 관리형 hook에서도 같다는 것은 추론이다. 시험은 `--settings` hook으로 했다.
  - 선택지:
    - (a) claude 실행 전에 관리형 설정 파일에 `hooks`가 있으면 claude 실행기를 막는 사전 검사를 둔다.
    - (b) 한계로 문서에만 적는다.
  - `src/runners/claude-controller.ts`의 주석과 [solutions 문서](../solutions/integration-issues/stop-claude-model-discovery-without-sigkill.md)의 "종료 중 hook 이벤트" 설명은 이 측정에 맞게 고쳐야 한다. 이 PR에서는 solutions 문서만 고쳤다.
- **P2. 6초는 갱신이 없는 경우에는 넉넉하다(최대 1.9초).**
  - 갱신 중의 시간은 4번을 해야 안다.
  - 관리형 SessionEnd hook이 timeout을 길게 잡으면, 6초 뒤 SIGKILL이 hook을 끊는다. 그때 CLI가 갱신 잠금을 잡고 있었다면 잠금은 남는다. 잠금 해제와 SessionEnd hook 중 무엇이 먼저인지는 확인하지 않았다.
- **P3. codex 0.163.0의 `shell_zsh_fork` 경고.** 버전에 따라 이 설정을 넣지 않거나 그대로 둔다. stream에 error 항목이 하나 늘 뿐이고 결과는 같으므로 우선순위는 낮다.
- **P4. codex 네트워크 실패.** 실행기 실패(`REVIEW_RUNNER_FAILED`)가 아니라 240초 뒤 `UNKNOWN_RESULT`로 사람에게 넘어간다. 둘 다 사람 확인이므로 바꿀 필요는 없다고 본다.

## 확인하지 못한 것

- 갱신 중인 claude의 SIGTERM 종료 시간과 잠금 해제(4번, 사용자 확인 대기).
- 관리형 SessionEnd hook. 시스템 폴더 `/Library/Application Support/ClaudeCode/`에 써야 한다.
- 취소 시간을 Office bridge·exec relay가 붙은 `claudeJob` 경로로 재지 않았다. 측정은 빈 MCP 설정으로 했다. relay 정리(최대 5초)는 `superviseRemote`의 12초 유예에 따로 들어 있다.
- 10-27의 원래 증상인 안전장치 거절. 같은 exit 1 경로라고 보지만 재현하지 않았다.
- lean·Claw Office 화면의 멈춤 메시지. coordinator 결과까지만 봤다.
- codex의 다른 API 오류(사용량 한도, 로그인 만료)와 pinned 0.155.1.
