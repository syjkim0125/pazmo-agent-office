# 2026-10-29 실제 claude·codex CLI로 리뷰 실행기 오류와 SIGTERM 종료 확인

앞선 변경: PR syjkim0125/pazmo-agent-office#35([리뷰 실행기 오류](2026-10-27-review-runner-failure.md)), PR syjkim0125/pazmo-agent-office#40([claude 멈춤](2026-10-28-claude-stop-integrity.md)). 두 변경의 자동 시험은 가짜 CLI로 흉내만 냈다. 이 기록은 그중 세 가지와, 사용자 확인 뒤 한 갱신 중 SIGTERM(4번)을 이 Mac의 실제 CLI로 본 결과다. **제품 코드는 바꾸지 않았다.** 제안은 맨 아래에 있다.

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
| 5 (#42를 합친 코드, load average 130) | 38.9초 | 17.5초 | 같음 | 같음 | 1회 |

- 리뷰 관찰값은 `exitCode: 1`, `signal: null`, `timedOut: false`, `error: null`, `report: null`이었다. 검사 노드는 `pass`, 리뷰 노드는 `unknown`이었다.
- kit 리뷰 노드(main `d7a0af2`)는 `status: "failed"`, `output.verdict: "needs_changes"`, `evaluation: { passed: false, action: "human", feedback: "Reviewer did not produce a valid closed observation." }`로 남았다. #35 기록의 "바꾸지 않은 기존 동작"과 같다.
- 이 문제를 고친 PR syjkim0125/pazmo-agent-office#42가 그사이 머지됐다. 그것을 합친 코드로 2026-10-30에 한 번 더 돌렸다(5번 실행, load average 130, 전체 38.9초, 리뷰 17.5초). 라운드는 그대로 `REVIEW_RUNNER_FAILED`였다. kit 리뷰 노드는 `verdict` 없이 `status: "failed"`로 남았고, 평가는 `{ passed: false, action: "human", feedback: "The review runner ended without a report (REVIEW_RUNNER_FAILED); no review was performed." }`였다.
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

**결론: 갱신이 없을 때 0.3–1.7초다.** SessionEnd hook이 있으면 기본 1.5초 한도까지 기다려 최대 1.9초다. hook에 timeout을 주면 그만큼(최대 60초) 늘어난다. SessionEnd hook은 stream-json 이벤트로 나오지 않는다. 갱신 중인 claude는 4번에 있다.

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

## 4. 갱신 중인 claude의 SIGTERM

**결론: 한가할 때는 2.5초 안에 끝나지만, 부하가 높으면 6초를 넘는다.** Office와 같이 6초 뒤 SIGKILL하면 **잠금이 남았다**(load average 90–102에서 3회 중 2회).

- CLI는 SIGTERM 뒤 진행 중인 갱신을 **최대 2초만** 기다리고, 끝나지 않았으면 기다리지 않고 나간다.
- 스스로 나가면 잠금은 언제나 풀렸다.
- 늦어지는 것은 2초 대기 뒤 실제로 나가기까지의 시간이다. `--debug-file` 실행에서 이 시간은 0.6초에서 6.0초까지였고, 부하가 높을수록 길었다.

사용자 확인(2026-10-29 "진행", 2026-10-30 "다시 시도해 주세요") 뒤 가짜 자격 증명으로 했다. 사용자의 실제 자격 증명(`~/.claude`, Keychain `Claude Code-credentials`)은 쓰지도 읽지도 않았다.

### 방법

[`claude-sigterm.mjs`](real-cli-checks/claude-sigterm.mjs)의 `refresh` 시나리오:

- 격리 `CLAUDE_CONFIG_DIR`의 `.credentials.json`에 **가짜** OAuth 토큰을 넣는다. 만료 시각은 한 시간 전이다.
- `HTTPS_PROXY`(대소문자 둘 다)를 받기만 하고 답하지 않는 로컬 프록시로 준다. 갱신 요청(`CONNECT platform.claude.com:443`)이 그 자리에 걸린다. 가짜 토큰은 이 Mac 밖으로 나가지 않는다.
- `<config>/.oauth_refresh.lock`이 생기면 정한 시간 뒤 프로세스 그룹에 SIGTERM을 보낸다.
- 끝난 뒤 다음을 본다: 종료 시간, 잠금, 그룹에 남은 프로세스, 가짜 토큰 파일, 격리 config용 Keychain 항목. Keychain은 `security find-generic-password -s`로 이름만 확인한다.
- `SIGTERM_DEBUG=1`이면 `--debug-file`을 더해 종료·갱신 줄을 모은다.
- `KILL_AFTER_MS=6000`이면 `runClaude`처럼 SIGTERM 6초 뒤 그룹에 SIGKILL을 보낸다. 격리 시나리오에만 쓴다. 사용자 로그인 시나리오(`real`)에는 SIGKILL을 보내지 않는다.

```bash
node docs/verification/real-cli-checks/claude-sigterm.mjs refresh 3 1000
SIGTERM_DEBUG=1 node docs/verification/real-cli-checks/claude-sigterm.mjs refresh 3 0
KILL_AFTER_MS=6000 node docs/verification/real-cli-checks/claude-sigterm.mjs refresh 3 0
```

부하: 측정하는 동안 다른 세션이 CPU 16스레드 부하 시험과 전체 시험을 돌렸다(이 Mac은 12코어). load average는 각 배치의 시작·끝 값이다. 부하를 일부러 만들지는 않았다.

claude 2.1.280 바이너리에서 확인한 것:

- `CLAUDE_CONFIG_DIR`를 주면 Keychain 서비스 이름은 `Claude Code-credentials-<config 경로 sha256 앞 8자리>`가 된다. 사용자의 항목과 다른 이름이다.
- 평문 저장은 `<config>/.credentials.json`, 잠금은 `<config>/.oauth_refresh.lock`이다.
- 갱신은 `https://platform.claude.com/v1/oauth/token`으로 가는 POST이고 timeout은 30초다.
- `CLAUDE_CODE_CUSTOM_OAUTH_URL`은 승인된 주소만 받는다. 그래서 로컬 가짜 토큰 서버 대신 답하지 않는 프록시를 썼다.

### 결과

SIGKILL 없이(CLI가 스스로 나갈 때까지 기다림):

| 잠금이 생기고 SIGTERM까지 | load average | 횟수 | SIGTERM→종료 | 6초 넘음 |
|---|---|---|---|---|
| 1.0초 (첫 시험) | 기록 안 함(직후 129) | 1 | 4267ms | 0 |
| 1.0초 | 103–134 | 3 | 4167–4898ms | 0 |
| 8.0초 | 103–134 | 3 | 2552–3010ms | 0 |
| 1.0초, `--debug-file` | 117 | 1 | 4184ms | 0 |
| 0초, `--debug-file` | 75–130 | 3 | 5726, 6832, **9119**ms | 2 |
| 1.0초, `--debug-file` | 135–172 | 3 | 4236, 5261, **7823**ms | 1 |
| 8.0초, `--debug-file` | 171 | 3 | 2978–4302ms | 0 |

Office와 같이 SIGTERM 6초 뒤 그룹 SIGKILL(`KILL_AFTER_MS=6000`):

| 잠금이 생기고 SIGTERM까지 | load average | 횟수 | SIGTERM→종료 | SIGKILL됨 | 잠금 남음 |
|---|---|---|---|---|---|
| 0초 | 부하 시험이 막 끝남(1분 평균 165–174, 잠금이 0.3–1.1초에 생김) | 5 | 546–706ms | 0 | 0 |
| 1.0초 | 같음(1분 평균 124–165) | 5 | 2517–2528ms | 0 | 0 |
| 0초 | 90–102 | 3 | 2912ms, 6010ms, 6027ms | **2** | **2** |
| 1.0초 | 102–103 | 3 | 2747–4354ms | 0 | 0 |
| 8.0초 | 103–116 | 3 | 2924–4991ms | 0 | 0 |

모든 실행에서 다음을 확인했다.

- CLI가 스스로 나간 실행은 모두 exit code 143이었고, 끝난 뒤 `.oauth_refresh.lock`이 남지 않았다. 잠금이 남은 것은 SIGKILL된 2회뿐이다.
- 8초 실행에서는 잠금 mtime이 2번 바뀌었다(보유자가 살아 있을 때 5초마다 갱신된다).
- 가짜 토큰 파일은 그대로였다. 격리 config용 Keychain 항목은 실행 전후 모두 없었다.
- stdout은 비어 있었다. 갱신은 `init`보다 먼저 일어난다. stderr도 비어 있었다.
- 사용자의 `~/.claude/.oauth_refresh.lock`은 측정 전후 모두 없었다.
- 부하가 높을 때 CLI가 띄운 `xcodebuild -license check`가 CLI 종료 직후에도 그룹에 남아 있는 일이 자주 있었다. Office는 CLI가 끝나면 그룹을 SIGKILL하므로(#40의 2번) 이 경우를 처리한다.
- 프록시에는 `CONNECT platform.claude.com:443`이 먼저 오고, 4–5초 뒤 `CONNECT api.anthropic.com:443`이 몇 번 왔다. 둘 다 답하지 않았다.

`--debug-file` 로그 한 예(SIGTERM 기준 시각, load average 117):

```
3248ms  [DEBUG] OAuth refresh still in flight after 2000ms; exiting without waiting further
4012ms  [DEBUG] Graceful shutdown initiated, skipping further initialization
4019ms  [DEBUG] GrowthBook: pre-init OAuth refresh failed (timeout)
(4184ms에 exit 143)
```

- "최대 2초 기다린 뒤 나간다"는 #40 리뷰어의 바이너리 읽기와 맞는다.
- `--debug-file` 실행 10회에서 "still in flight after 2000ms" 줄은 SIGTERM 뒤 2.1–4.6초에 찍혔다. 실제 종료는 그 뒤 0.6–6.0초가 더 걸렸다. 가장 느린 것은 9.1초였다.
- SIGTERM이 잠금이 생긴 직후(0초)에 오면 가장 오래 걸렸다. CLI가 아직 시작 중이기 때문으로 보인다("skipping further initialization").
- 갱신이 끝나지 않은 채 나가므로, 서버가 이미 토큰을 바꿨는데 응답을 받기 전이었다면 새 토큰은 저장되지 않는다. 이것은 CLI의 동작이고 Office의 유예 시간으로는 바뀌지 않는다.

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
- **P2. 부하가 높으면 6초 유예로는 갱신 잠금이 남는다(결정 필요).**
  - 갱신이 걸린 claude는 한가할 때 2.5초 안에 끝났다.
  - load average 75–172에서는 16회 중 3회가 6초를 넘었다(SIGKILL 없음, 최대 9.1초).
  - Office와 같은 6초 SIGKILL을 걸면 load average 90–102에서 3회 중 2회 잠금이 남았다.
  - 잠금이 남으면 2026-10-23 사고와 같다. 뒤에 오는 claude가 로그인 갱신에 실패한다. 잠금은 다른 claude가 60초 지난 잠금을 넘겨받을 때까지 남는다.
  - 선택지:
    - (a) 유예를 늘린다. 예: `runClaude` 12초, `superviseRemote` 18초. 측정 최대 9.1초에 여유를 둔 값이다. 비용은 SIGTERM을 무시하는 CLI가 그만큼 늦게 죽는 것뿐이다. 한가할 때 정상 claude는 지금처럼 0.3–2.5초에 끝난다.
    - (b) 6초를 두고, SIGKILL 뒤 잠금을 지우는 정리를 넣는다. 그 잠금이 이 프로세스의 것인지 Office가 알 수 없어서, 다른 살아 있는 claude의 잠금을 지울 수 있다. 권하지 않는다.
    - (c) 그대로 둔다. 이 측정의 부하(다른 세션의 CPU 부하 시험)는 평소보다 훨씬 높다. 평소의 동시 시험 부하(load average 24–33)는 재지 않았다.
  - 추천: (a). 바꾸려면 #40과 같은 범위의 제품 변경이다(시험 2개의 시간 한도도 같이 바뀐다).
  - 관리형 SessionEnd hook이 timeout을 길게 잡으면, 6초 뒤 SIGKILL이 hook을 끊는다. 그때 CLI가 갱신 잠금을 잡고 있었다면 잠금은 남는다. 잠금 해제와 SessionEnd hook 중 무엇이 먼저인지는 확인하지 않았다.
- **P3. codex 0.163.0의 `shell_zsh_fork` 경고.** 버전에 따라 이 설정을 넣지 않거나 그대로 둔다. stream에 error 항목이 하나 늘 뿐이고 결과는 같으므로 우선순위는 낮다.
- **P4. codex 네트워크 실패.** 실행기 실패(`REVIEW_RUNNER_FAILED`)가 아니라 240초 뒤 `UNKNOWN_RESULT`로 사람에게 넘어간다. 둘 다 사람 확인이므로 바꿀 필요는 없다고 본다.

## 확인하지 못한 것

- 갱신 중 SIGTERM은 가짜 토큰과 답하지 않는 프록시로만 했다. 실제 토큰 서버가 느리게 답하는 경우, 갱신이 서버에서 끝났지만 응답을 받기 전인 경우는 보지 않았다.
- 평소 부하(load average 24–33)와 완전히 한가한 상태에서의 갱신 중 SIGTERM. 측정 내내 다른 세션의 부하 시험이 돌았다.
- 갱신과 SessionEnd hook이 함께 있을 때의 종료 시간과 순서.
- 관리형 SessionEnd hook. 시스템 폴더 `/Library/Application Support/ClaudeCode/`에 써야 한다.
- 취소 시간을 Office bridge·exec relay가 붙은 `claudeJob` 경로로 재지 않았다. 측정은 빈 MCP 설정으로 했다. relay 정리(최대 5초)는 `superviseRemote`의 12초 유예에 따로 들어 있다.
- 10-27의 원래 증상인 안전장치 거절. 같은 exit 1 경로라고 보지만 재현하지 않았다.
- lean·Claw Office 화면의 멈춤 메시지. coordinator 결과까지만 봤다.
- codex의 다른 API 오류(사용량 한도, 로그인 만료)와 pinned 0.155.1.
