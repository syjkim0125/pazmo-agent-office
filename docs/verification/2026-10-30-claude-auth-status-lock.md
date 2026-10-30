# 2026-10-30 러너 탐색의 `claude auth status`와 OAuth 갱신 잠금

러너 탐색(`discoverRunners` → `inspect()`, `src/runners/runner-discovery.ts`)은 `claude --version`과 `claude auth status`를 실행한다. 두 명령 모두 `runCommand`(`src/runners/command.ts`)로 10초 한도 안에서 돌고, 한도를 넘으면 프로세스 그룹이 바로 SIGKILL된다. 역할 실행(D28)과 모델 목록 조회(#34, D31)는 SIGTERM을 먼저 보내지만 이 두 명령은 그렇지 않다.

이 기록은 두 명령이 `<config>/.oauth_refresh.lock`을 잡는지, 잡는다면 SIGKILL 뒤 잠금이 남는지를 claude 2.1.280에서 본 결과다. 잠금이 남으면 [2026-10-23 사고](../solutions/integration-issues/stop-claude-model-discovery-without-sigkill.md)와 같아진다. **제품 코드는 바꾸지 않았다.**

## 결론

- **`claude --version`은 잠금과 무관하다.** 초기화 전에 버전만 찍고 끝나는 빠른 경로를 탄다. 104ms에 끝났고 네트워크 요청은 없었다.
- **`claude auth status`는 잠금을 잡는다.**
  - 조건: 저장된 토큰이 만료 5분 전 안쪽일 때.
  - 시작 0.2–0.8초에 잠금을 잡고 갱신 요청을 보낸다.
  - 시험한 구독 유형 네 가지(team, enterprise, 기록 없음, pro)가 모두 그랬다.
- **갱신이 멈춰도 기다리지 않는다.**
  - 잠금을 잡고 44–164ms 뒤에 exit 0으로 끝났다. 전체 시간은 0.25–0.84초였다.
  - 끝날 때 잠금은 지워졌다(17회 중 17회).
- **잠금을 잡고 있을 때 SIGKILL을 받으면 잠금이 남는다**(8회 중 8회).
- **그래서 탐색의 10초 SIGKILL이 잠금을 남길 조건은 좁다.**
  - `auth status`가 10초 넘게 돌아야 한다.
  - 시간 초과가 하필 잠금을 잡은 마지막 0.2초 안쪽에 와야 한다.
  - 이번 측정(load average 7–9)에서는 한 번도 1초를 넘지 않았다.

## 환경

- origin/main `f568734`, Node 24.19.0, 2026-10-30.
- claude 2.1.280: `/opt/homebrew/Caskroom/claude-code@latest/2.1.280/claude`, sha256 `387a5c5d…229d`. [10-29 기록](2026-10-29-real-cli-runner-checks.md)과 같은 바이너리다.
- load average(1분)는 7.4–8.8이었다. 부하를 일부러 만들지 않았다.

## 바이너리에서 본 것

- **preAction 훅은 `auth` 하위 명령에서도 돈다.**
  - `auth`일 때는 시작 시 강제 갱신 분기와 보안 대화상자 분기를 건너뛴다.
  - 하지만 아래 두 조회는 기다리지 않고 시작한다.
    - 원격 관리 설정 조회(`Hdt` → `Se`). 요청 전에 갱신 함수(`ni` → `cHe`)를 부른다.
    - 정책 한도 조회(`qgr` → `ii` → `ni`). 요청 전에 `cHe`를 부른다. 대상은 team, enterprise, 구독 기록 없음뿐이다. pro와 max는 `prosumer_oauth`로 빠진다.
- **`cHe` → `ed`가 잠금을 잡는다.**
  - 토큰이 만료 5분 전 안쪽이 아니면(`aD`: `now + 300000 >= expiresAt`가 거짓이면) `not_needed`로 끝나고 잠금을 잡지 않는다.
  - 그 안쪽이면 `<config>/.oauth_refresh.lock`을 잡는다(`rdo`, proper-lockfile, stale 60초).
  - 그다음 `platform.claude.com`에 갱신 POST를 보낸다(timeout 30초).
- **`authStatus`는 갱신을 기다리지 않는다.**
  - 저장된 값만 읽어 JSON을 찍고 `process.exit`한다.
  - SIGTERM 종료 때 갱신을 최대 2초 기다리는 처리(`waitForHeldOAuthRefresh`)는 이 경로에 없다.
  - 잠금은 종료 핸들러가 지운다.
- **pro가 잠금을 잡은 경로는 원격 관리 설정 조회로 본다.** 정책 한도 조회는 pro를 빼기 때문이다. 다만 로그로 확인하지는 못했다. `--debug-file`에는 프로세스가 끝날 때까지 갱신 줄이 쓰이지 않았다.

## 방법

[`claude-auth-status-lock.mjs`](real-cli-checks/claude-auth-status-lock.mjs)를 쓴다. `npm test`에는 들어가지 않는다. 10-29 기록 4번과 같은 격리 방식이다.

- 격리 `CLAUDE_CONFIG_DIR`와 HOME을 쓴다. `.credentials.json`에는 한 시간 전에 만료된 **가짜** OAuth 토큰을 넣는다. 구독 유형은 `SUBSCRIPTION`으로 고른다.
- `HTTPS_PROXY`(대소문자 둘 다)는 받기만 하고 답하지 않는 로컬 프록시로 둔다. 그래서 갱신은 멈춘 채로 남고, 가짜 토큰은 이 Mac 밖으로 나가지 않는다.
- 환경은 `runnerEnv`(HOME, USER, PATH, LANG)에 위의 격리 값만 더했다.
- 시나리오는 셋이다.
  - `status`: Office의 실제 `runCommand`를 쓴다. 옵션은 탐색과 같다(10초, 64KiB).
  - `version`: 같은 방식으로 `--version`을 돌린다.
  - `kill-on-lock`: `runCommand`처럼 띄운다. 잠금이 생기고 `KILL_DELAY_MS` 뒤에 그룹을 SIGKILL한다. 이 SIGKILL은 시간 초과를 흉내 낸 것이다.
- 끝난 뒤 다음을 본다.
  - 잠금(10ms마다 확인, 종료 0.3초 뒤 다시 확인)
  - 출력 JSON
  - 프록시가 받은 요청
  - 가짜 토큰 파일이 그대로인지
  - 격리 config용 Keychain 항목. 이름만 확인한다.
- 사용자의 `~/.claude`와 Keychain 항목은 읽지도 쓰지도 않았다. 2026-10-30 사용자 확인("진행") 뒤에 했다.

```bash
SUBSCRIPTION=team node docs/verification/real-cli-checks/claude-auth-status-lock.mjs status 3
node docs/verification/real-cli-checks/claude-auth-status-lock.mjs version 1
KILL_DELAY_MS=50 node docs/verification/real-cli-checks/claude-auth-status-lock.mjs kill-on-lock 2
```

## 결과

`auth status`를 `runCommand`로 돌린 결과다. 모두 exit 0이었고 시간 초과는 없었다. 프록시 요청은 매번 `CONNECT platform.claude.com:443` 한 번이었다.

| 구독 유형 | 횟수 | 전체 | 잠금이 생긴 때 | 잠금을 잡은 뒤 종료까지 | 끝난 뒤 잠금 |
|---|---|---|---|---|---|
| team | 6 | 250–809ms | 207–711ms | 44–164ms | 0/6 |
| enterprise | 3 | 331–840ms | 280–773ms | 51–96ms | 0/3 |
| 기록 없음 | 3 | 278–367ms | 230–303ms | 48–76ms | 0/3 |
| pro | 5 | 267–551ms | 219–492ms | 49–77ms | 0/5 |

- 출력은 모두 `loggedIn: true`, `authMethod: "claude.ai"`였다. 만료된 토큰이어도 로그인으로 보고된다.
- team 6회 중 1회와 pro 5회 중 2회는 `--debug-file`을 붙여 돌렸다. 이 옵션은 스크립트에서 뺐다.

잠금이 생기면 SIGKILL을 보낸 결과(`kill-on-lock`)다.

| 구독 유형 | 잠금 뒤 SIGKILL까지 | 횟수 | 끝난 뒤 잠금 |
|---|---|---|---|
| team | 1–2ms | 4 | **4/4 남음** |
| pro | 1ms | 2 | **2/2 남음** |
| team | 51–52ms | 2 | **2/2 남음** |

`--version`은 1회 돌렸다. 104ms에 exit 0이었고, 잠금도 프록시 요청도 없었다.

모든 실행에서 다음을 확인했다.

- 가짜 토큰 파일은 그대로였다.
- 격리 config용 Keychain 항목(`Claude Code-credentials-<8자리>`)은 실행 전후 모두 없었다.
- SIGKILL 뒤 그룹에 남은 프로세스가 없었다.
- 사용자의 `~/.claude/.oauth_refresh.lock`은 측정 전후 모두 없었다.

## 제안 (제품 코드는 바꾸지 않았다)

선택지:

- **(a) 그대로 두고 이 기록만 남긴다.**
  - 측정 17회가 모두 0.84초 안에 끝났다. 잠금은 마지막 44–164ms 동안만 잡혔다.
  - 10초 한도는 측정 최대값의 12배다.
  - 비용은 없다.
- **(b) 탐색의 claude 명령만 시간 초과 때 SIGTERM을 먼저 보낸다.**
  - 방법: `runCommand`에 선택 옵션을 둔다(SIGTERM → 유예 → SIGKILL).
  - 효과: SIGTERM을 받은 claude는 갱신을 최대 2초 기다린 뒤 스스로 끝나고 잠금을 지운다(10-29 기록 4번).
  - 비용 1: 멈춘 claude 하나마다 탐색이 유예만큼 길어진다.
    - D28·D31과 같은 12초로 두면 명령 하나가 최대 22초가 된다. lean 시작 한도(30초, D31)를 다시 계산해야 한다.
    - 3초로 두면 한가할 때의 SIGTERM 종료(0.3–2.5초)만 덮는다. 부하가 높을 때의 종료(최대 9.1초)에는 모자란다.
  - 비용 2: 제품 변경이므로 Story 결정, TDD, 리뷰, G4가 필요하다.
- **(c) 10초 한도를 늘린다.** 시간 초과 순간에 잠금을 잡고 있으면 남는다는 점은 그대로다. 고장 난 claude에서 탐색만 길어진다. 권하지 않는다.

추천: (a). 잠금이 남으려면 `auth status`가 10초 넘게 돌면서 마지막 0.2초 안쪽에 시간 초과가 걸려야 한다. 이번에는 그런 실행이 한 번도 없었다.

→ 2026-10-30 사용자 선택 (a). 10초 SIGKILL은 그대로 두고 이 기록만 남긴다.

## 확인하지 못한 것

- **실제 토큰 서버.** 가짜 토큰과 답하지 않는 프록시로만 했다.
  - `auth status`는 갱신 응답을 기다리지 않고 끝난다.
  - 실제 네트워크에서는 요청이 서버에 닿고 응답이 오기 전에 끝날 수 있다. 그러면 서버가 바꾼 새 토큰은 저장되지 않는다.
  - 이때 서버가 이전 refresh 토큰을 바로 무효로 하는지는 모른다. 실제 자격 증명이 필요해서 하지 않았다.
- **높은 부하에서 `auth status`가 걸리는 시간.**
- **10초를 넘게 만드는 원인이 잠금을 잡은 뒤에 생기는지.**
  - 예: Keychain 접근 대기.
  - 코드상 갱신은 토큰을 읽은 뒤에 잠금을 잡는다. 그리고 잠금을 잡은 뒤 자격 증명을 한 번 더 읽는다.
- **사용자의 실제 구독 유형과 저장된 토큰의 만료 상태.** 읽지 않았다.
- **잠금이 남는 실제 사례.** 탐색의 `auth status`가 잠금을 남긴 사례는 아직 없다. 10-23 사고의 잠금은 모델 목록 조회의 SIGKILL 때문이었다.
