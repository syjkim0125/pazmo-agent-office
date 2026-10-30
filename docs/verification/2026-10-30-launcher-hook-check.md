# 2026-10-30 `./office` 시작 1단계에서 hook이 있는 claude 막기

Story: M3 · M4 · D29 · D30. 근거: [#45 변경 기록](2026-10-30-claude-stop-grace-hooks.md)의 리뷰 후속("`./office` 시작 1단계는 hook을 묻지 않는다"). kit graph: `.ai-workflow/runs/U25-launcher-hook-check.json`.

## 왜 바꿨나

- #45(D29) 뒤로 hook이 있는 claude는 `loadRunnerCatalog`에서 막힌다. 그런데 `./office`의 1단계는 `discoverRunners`만 써서 hook을 묻지 않았다.
- 그래서 claude만 쓰는 사용자에게 관리형 hook이 있으면 1단계를 통과했다. 의존성 설치, 고정 codex 확인, VM 준비, VM 경계 검사를 모두 기다린 뒤에야 Office를 켜는 단계(`createLiveRuntime`)에서 멈췄다.
- 그때 오류는 `LOGIN_REQUIRED`였고, 문구는 "codex 또는 claude 중 하나를 설치·로그인한 뒤 다시 시작하세요"로 시작했다. claude는 이미 설치·로그인되어 있으므로 틀린 안내다. 실제 이유(hook)는 뒤에 붙은 claude 안내에만 있었다.
- codex `~/.codex/AGENTS.md` 막힘은 1단계에서 잡혔지만, 같은 "설치하고 로그인한 뒤" 문구와 `LOGIN_REQUIRED`였다.

## 바뀐 동작

- 1단계(`startupRunners`, Claw·lean·팀 Office 공통)는 `discoverRunners` 뒤에, **claude만으로 Office를 켤 수 있을 때만** claude에게 hook 목록을 묻는다. 다음을 모두 만족하는 경우다.
  - 쓸 수 있는 codex가 없다(없음, 로그인 안 됨, 막힘).
  - `--codex-runtime pinned`가 아니다.
  - claude가 설치·로그인되어 있다.
- 묻는 방법과 판단은 Office와 같다. `claudeModels`로 묻고, `loadRunnerCatalog`에서 뽑아낸 `blockHookedClaude`로 판단한다. 같은 hook 종류는 한 번만 적고, 안내 문구도 같다. 조회 자체가 실패하면 판단하지 않는다(D29).
- codex를 쓸 수 있는 사용자는 1단계에서 claude를 띄우지 않는다(추가 비용 없음). claude의 막힘은 지금처럼 Office 화면에서 보인다.
- claude만 쓰는 사용자는 1단계에서 claude를 한 번 더 띄운다(이 Mac에서 1.3–1.4초). hook이 있으면 여기서 멈춘다. 없으면 Office를 켤 때 전처럼 한 번 더 묻는다.
- 쓸 수 있는 실행기가 없고 막힌 CLI가 하나라도 있으면 `LOGIN_REQUIRED`가 아니라 `RUNNER_BLOCKED`로 멈춘다.
  - 1단계: "Office 역할을 실행할 수 있는 codex·claude가 없습니다. 아래 CLI별 안내대로 고친 뒤 다시 실행해주세요. codex: … claude: … 로그인 정보는 VM에 복사하지 않습니다."
  - Office를 켜는 단계(`createLiveRuntime`, 예: `start --live`): "… 아래 CLI별 안내대로 고친 뒤 다시 시작하세요. codex: … claude: …"
  - codex `AGENTS.md` 막힘도 이제 `RUNNER_BLOCKED`다.
- 막힌 CLI가 없으면 `LOGIN_REQUIRED`와 그 문구는 그대로다.
- 막힌 claude의 SessionStart·SessionEnd hook은 1단계 조회 때 한 번 돈다(D29의 한계와 같음). 그 뒤 Office를 켜지 않으므로, `./office` 한 번에 도는 횟수는 전과 같은 한 번이다.

## 시험

| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `tests/launcher.test.mjs` "a blocked codex does not count as a usable runner at startup" (기존 시험, 기대를 `RUNNER_BLOCKED`로 바꿈) | 실패: `LOGIN_REQUIRED`, "최초 준비: codex 또는 claude 중 하나를 설치하고 로그인한 뒤 …" | 통과 |
| `tests/launcher.test.mjs` "a claude-only start stops at step 1 when its claude would run a hook" | 실패: `blocked`가 `undefined` | 통과 |
| `tests/launcher.test.mjs` "a claude-only start with a hook-free claude passes step 1 after one listing" | 실패: claude 조회 0회 | 통과 |
| `tests/launcher.test.mjs` "step 1 never starts claude for its hooks when codex can start Office" (pinned 포함) | 처음부터 통과(비용 경계를 고정) | 통과 |
| `tests/launcher.test.mjs` "a hook listing that fails decides nothing at step 1" | 처음부터 통과(D29의 "판단하지 않음"을 고정) | 통과 |
| `tests/live-runtime.test.mjs` "runner mode refuses startup as blocked, not as a missing login, when the only logged-in CLI is blocked" | 실패: `LOGIN_REQUIRED`, "codex 또는 claude 중 하나를 설치·로그인한 뒤 다시 시작하세요. …" | 통과 |

- RED는 `startupRunners`를 지금 동작 그대로(`discoverRunners`만) 먼저 뽑아 둔 상태에서 봤다. 내보내기가 없을 때는 시험 파일 전체가 import 오류로 끝났다.
- launcher 시험은 PATH에 가짜 native codex(로그아웃)와 claude를 두고, 실제 `discoverRunners`·`claudeModels`를 거친다. 가짜 CLI는 `tests/runner-fixture.mjs`의 `fakeRunners`로 옮겨 runner-settings 시험과 같이 쓴다. claude가 조회로 몇 번 떴는지도 센다. 옮긴 뒤 runner-settings는 18/18 그대로다.
- 돌연변이 7개를 모두 잡았다.
  - 항상 claude에 묻기
  - pinned에도 묻기
  - hook 판단 빼기
  - 조회 실패를 오류로 두기
  - 1단계 코드를 `LOGIN_REQUIRED`로 되돌리기
  - 1단계 문구를 옛 문구로 되돌리기
  - `createLiveRuntime` 코드를 `LOGIN_REQUIRED`로 되돌리기
- **자동 시험이 없는 것:** `prepareMachine`이 `startupRunners`를 의존성 설치 전에 부르는 연결이다. `up` 전체를 도는 자동 시험은 만들지 않았다. 이 연결이 빠지면 시험이 실제 의존성 설치, 고정 codex 다운로드, VM 시작까지 가기 때문이다. 아래 실제 확인으로 봤다.

## 실제 확인

- 실제 `up` CLI를 Claw와 `--lean`으로 한 번씩 돌렸다(60초 한도).
  - 조건: 빈 HOME, PATH는 가짜 bin(hook이 있는 claude, 로그아웃 codex)과 `/usr/bin:/bin`, 임시 git repo와 data dir.
  - 결과: 둘 다 exit 1, `RUNNER_BLOCKED`. `[1/4]` 줄이 없고, claude 조회는 각 1회였다. Claw 1.3초, lean 0.2초.
  - data dir, `qualified-runtime`, 가짜 HOME의 `.colima`는 생기지 않았다.
  - 팀 Office(`up --team`)는 같은 `prepareMachine`을 거치지만 돌리지 않았다.
- 이 Mac의 실제 claude 2.1.280(로그인됨) 앞에 가짜 로그아웃 codex를 두고 `startupRunners`를 돌렸다.
  - hook 목록 `[]`, 막히지 않음("준비됨"), 모델 5개. 전체 3.4초.
  - 나눠 재면(3회, load average 8–18) 발견 0.5–1.4초, hook 조회 1.27–1.43초.
  - 앞뒤로 `~/.claude/.oauth_refresh.lock`은 없었다.
- 관리형 hook이 실제로 걸린 Mac에서의 확인은 여전히 없다.

## 자동 검증

(최종 실행 뒤 채움)

## 리뷰 (독립, 보고만)

(리뷰 뒤 채움)

## 아직 하지 않은 것

- 관리형 설정(회사 IT)의 hook이 실제로 걸린 Mac에서의 확인.
- claude만 쓰는 사용자는 `./office`마다 claude를 한 번 더 띄운다(1단계, Office 시작). 1단계 결과는 다른 프로세스인 Office에 넘기지 않는다.
- 모델 목록 조회 자체의 멈춤(stdin 닫기 → 3초 → SIGTERM → 2초 → SIGKILL)은 바쁠 때 갱신 잠금을 남길 수 있다(#45 후속, 그대로). claude만 쓰는 사용자에게는 1단계 조회가 그 기회를 한 번 더한다.
- 로그인되지 않은 claude에는 1단계에서 hook을 묻지 않는다. 로그인한 뒤의 다음 `./office`에서 묻는다.
- `unsupported`(버전을 읽을 수 없는 설치본)뿐일 때는 그대로 `LOGIN_REQUIRED`와 "설치하고 로그인한 뒤" 문구다.
- **G4:** 사용자 답변으로만 기록한다.
