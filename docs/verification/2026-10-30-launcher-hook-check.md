# 2026-10-30 `./office` 시작 1단계에서 hook이 있는 claude 막기

Story: M3 · M4 · D29 · D30. 근거: [#45 변경 기록](2026-10-30-claude-stop-grace-hooks.md)의 리뷰 후속("`./office` 시작 1단계는 hook을 묻지 않는다"). kit graph: `.ai-workflow/runs/U25-launcher-hook-check-replan-2.json`.

- 처음 연 run `U25-launcher-hook-check.json`에는 구현 1회차와 1차 리뷰가 남아 있다. 1차 리뷰 반영 때 D30 문구를 고쳐 Story 지문이 바뀌었다.
- 두 번째 run `U25-launcher-hook-check-replan.json`에는 구현 2회차와 2차 리뷰(Approve)가 남아 있다. 2차 리뷰의 Minor로 D30의 괄호 위치를 고쳐 지문이 다시 바뀌었다.
- 그래서 그래프 규칙대로 새 run을 열고, 같은 증거와 문서 수정으로 구현·리뷰·검증을 다시 기록했다.

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
- 로그인되지 않은 claude에는 묻지 않는다. 그 claude로는 어차피 시작할 수 없고, 로그인한 뒤의 다음 `./office`에서 묻는다.
- claude만 쓰는 사용자는 1단계에서 claude를 한 번 더 띄운다. 이 Mac에서 한가할 때 1.3–1.4초였다. 바쁠 때는 더 걸릴 수 있다. 조회 한도는 15초이고, 끝낼 때 stdin 닫기 → 3초 → SIGTERM → 2초 → SIGKILL → 2초를 더 기다릴 수 있다(조회만 최악 22초). 이 동안 화면에는 `[1/4]` 전이라 진행 줄이 없다. hook이 있으면 여기서 멈춘다. 없으면 Office를 켤 때 전처럼 한 번 더 묻는다.
- 쓸 수 있는 실행기가 없고, **설치·로그인되었지만 막힌** CLI가 있으면 `LOGIN_REQUIRED`가 아니라 `RUNNER_BLOCKED`로 멈춘다. 막힘만 고치면 되는 경우다.
  - 1단계: "Office 역할을 실행할 수 있는 codex·claude가 없습니다. 아래 CLI별 안내대로 고친 뒤 다시 실행해주세요. codex: … claude: … 로그인 정보는 VM에 복사하지 않습니다."
  - `--codex-runtime pinned`에서 Mac codex 로그인(`~/.codex/auth.json`)이 있는데 codex가 막혔으면: "고정 codex(--codex-runtime pinned)가 쓸 codex가 막혀 있습니다. codex 안내대로 고친 뒤 다시 실행해주세요. codex: … claude: … …". 고정 codex 실행에는 claude가 쓰이지 않으므로 "codex·claude가 없다"고 하지 않는다.
  - Office를 켜는 단계(`createLiveRuntime`, 예: `start --live`): "Office 역할을 실행할 수 있는 codex·claude가 없습니다. 아래 CLI별 안내대로 고친 뒤 다시 시작하세요. codex: … claude: …"
  - 로그인된 codex의 `AGENTS.md` 막힘도 이제 `RUNNER_BLOCKED`다.
- 막힌 CLI가 로그인도 안 되어 있으면 `LOGIN_REQUIRED`와 "설치하고 로그인한 뒤" 문구 그대로다. 그 CLI의 안내(막힘)는 뒤에 함께 나온다. 막힘만 고치고 다시 실행하면 로그인 오류를 또 만나게 되므로 로그인을 앞세운다(1차 리뷰 지적). codex `inspect()`와 `loadRunnerCatalog`는 로그인과 상관없이 막힘을 적고 안내를 막힘 안내로 바꾸기 때문이다.
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

1차 리뷰 반영(구현 2회차)에서 더한 시험:

| 시험 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `tests/launcher.test.mjs` "a blocked CLI that is also logged out still asks for its login" (pinned 포함) | 실패: `RUNNER_BLOCKED`, 문구에 `codex login`이 없음 | 통과 |
| `tests/launcher.test.mjs` "under the pinned runtime a blocked codex is reported as the pinned codex's block" | 실패: "codex·claude가 없습니다 … claude: 준비됨" | 통과 |
| `tests/live-runtime.test.mjs` "runner mode still asks for the login when the blocked CLI is also logged out" | 실패: `RUNNER_BLOCKED`, "설치·로그인" 없음 | 통과 |
| `tests/launcher.test.mjs` "a logged-out claude is not started for its hooks, and the start asks for its login" | 처음부터 통과(빠진 시험을 메움) | 통과 |
| `tests/launcher.test.mjs` "a blocked codex leaves claude alone to start Office, so step 1 lists its hooks" | 처음부터 통과(빠진 시험을 메움) | 통과 |

- RED는 `startupRunners`를 지금 동작 그대로(`discoverRunners`만) 먼저 뽑아 둔 상태에서 봤다. 내보내기가 없을 때는 시험 파일 전체가 import 오류로 끝났다.
- launcher 시험은 PATH에 가짜 native codex와 claude를 두고, 실제 `discoverRunners`·`claudeModels`를 거친다. `extraDirs: []`로 실제 CLI가 있는 폴더(`/opt/homebrew/bin` 등)는 찾지 않는다. 가짜 CLI는 `tests/runner-fixture.mjs`의 `fakeRunners`로 옮겨 runner-settings 시험과 같이 쓴다. 각 CLI를 로그아웃으로 둘 수 있고, claude가 조회로 몇 번 떴는지 세며, 시험이 끝나면 임시 폴더를 지운다. 옮긴 뒤 runner-settings는 18/18 그대로다.
- 돌연변이(구현 2회차 기준) 13개 중 12개를 잡았다.
  - 잡음: 항상 claude에 묻기, pinned에도 묻기, 로그아웃 claude에도 묻기, hook 판단 빼기, 조회 실패를 오류로 두기, 1단계 코드를 `LOGIN_REQUIRED`로, 로그아웃된 막힘도 `RUNNER_BLOCKED`로(1단계·pinned·`createLiveRuntime` 각각), pinned 문구를 일반 문구로, 1단계 문구를 옛 문구로, `createLiveRuntime` 코드를 `LOGIN_REQUIRED`로
  - 남음: `extraDirs`를 넘기지 않기. 시험이 실제 CLI 폴더를 보지 않게 하는 시험용 경계이고, 이 Mac에서는 가짜 CLI가 PATH 앞에서 먼저 잡혀 결과가 같다.
- **자동 시험이 없는 것:** `prepareMachine`이 `startupRunners`를 의존성 설치 전에 부르는 연결이다. `up` 전체를 도는 자동 시험은 만들지 않았다. 이 연결이 빠지면 시험이 실제 의존성 설치, 고정 codex 다운로드, VM 시작까지 가기 때문이다. 아래 실제 확인으로 봤다.

## 실제 확인

- 실제 `up` CLI를 Claw와 `--lean`으로 한 번씩 돌렸다(60초 한도).
  - 조건: 빈 HOME, PATH는 가짜 bin(hook이 있는 claude, 로그아웃 codex)과 `/usr/bin:/bin`, 임시 git repo와 data dir.
  - 결과: 둘 다 exit 1, `RUNNER_BLOCKED`. `[1/4]` 줄이 없고, claude 조회는 각 1회였다. `up` 프로세스 전체(시작부터 끝까지, 가짜 CLI) 시간은 Claw 1.3초, lean 0.2초였다.
  - 이 확인은 구현 1회차(`2d1fbba`)에서 했다. 2회차는 로그인된 막힘의 경로를 바꾸지 않았다(이 확인의 claude는 로그인됨).
  - data dir, `qualified-runtime`, 가짜 HOME의 `.colima`는 생기지 않았다.
  - 팀 Office(`up --team`)는 같은 `prepareMachine`을 거치지만 돌리지 않았다.
- 이 Mac의 실제 claude 2.1.280(로그인됨) 앞에 가짜 로그아웃 codex를 두고 `startupRunners`를 돌렸다.
  - hook 목록 `[]`, 막히지 않음("준비됨"), 모델 5개. 전체 3.4초.
  - 나눠 재면(3회, load average 8–18) 발견 0.5–1.4초, hook 조회 1.27–1.43초.
  - 앞뒤로 `~/.claude/.oauth_refresh.lock`은 없었다.
- 관리형 hook이 실제로 걸린 Mac에서의 확인은 여전히 없다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test`, 구현 1회차 `2d1fbba` (2026-10-30 10:42–10:44, load average 9–17) | 1109/1109, exit 0 |
| root `npm test`, 구현 2회차 `2e8a816` (10:59–11:02, load average 27–34) | 1114/1114, exit 0 |
| 영향 파일 `launcher`·`runner-settings`·`runner-models` + `live-runtime`의 "runner mode" 시험(2회차) | 49/49, 3/3 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

- `2e8a816` 뒤 커밋은 문서·kit 기록만 바꿨다. 시험은 문서를 읽지 않는다(`tests/`에서 `docs/` 참조 없음).

## 리뷰 (독립, 보고만)

1회차(`2d1fbba`) 판정은 Changes needed였고 Critical은 없었다. 기록: `.ai-workflow/runs/U25-review-1.md`.

- 리뷰어가 돌린 것: launcher·runner-settings·runner-models 45/45(두 번), live-runtime "runner mode refuses startup" 2/2, 타입 검사 exit 0, 가짜 CLI로만 한 탐색(실제 claude·codex·`up`은 돌리지 않음).
- 확인된 것: `prepareMachine`의 연결(Claw·lean·팀 모두 설치·VM 전), `blockHookedClaude`·`usable` 추출의 동작 보존, pinned가 아닌 모든 조합에서 1단계와 Office 판단의 일치(D29의 조회 실패는 설계대로 예외), import 순환 없음.
- **Important 1(고침):** 막힌 CLI가 로그인도 안 되어 있을 때 `RUNNER_BLOCKED`가 로그인 안내를 잃었다. 막힘만 고친 사용자는 다음 실행에서 `LOGIN_REQUIRED`를 만난다. 이제 로그인된 막힘만 `RUNNER_BLOCKED`다.
- **Important 2(고침):** 로그아웃 claude와, 막힌 codex 옆 hook claude의 1단계 시험이 없었다.
- **Minor(고침):** pinned에서 "codex·claude가 없습니다" 뒤에 "claude: 준비됨"이 나오는 모순(pinned 문구로 바꿈), `fakeRunners`의 임시 폴더, `extraDirs` 경계, 문서의 빈칸, 한가할 때의 수치라는 점, lean 시간이 무엇을 잰 것인지.
- **Minor(후속으로 둠):**
  - pinned 관문 자체: 런처는 pinned에서도 막힌 codex를 거부하지만, `createLiveRuntime`(pinned와 `auth.json`이면 통과)과 고정 codex 역할 실행(`runner-jobs.ts`)은 `blocked`를 보지 않는다. #45 이전(`f2bd735`)부터의 불일치다. 런처를 풀지(안전장치 완화) Office를 조일지는 결정이 필요하다.
  - 조회 동안의 진행 줄: 넣지 않고 위 "바뀐 동작"에 최악 시간을 적었다.

2회차(같은 리뷰어, `2e8a816`) 판정은 Approve였고 Critical·Important는 없었다. 기록: `.ai-workflow/runs/U25-review-2.md`.

- 리뷰어가 돌린 것: launcher·runner-settings·runner-models 49/49, live-runtime "runner mode" 3/3, 타입 검사 exit 0, 가짜 CLI 탐색.
- 확인된 것: 로그인된 막힘만 `RUNNER_BLOCKED`(1단계·`createLiveRuntime`·pinned), 새 시험이 그 조건을 빼면 실패함, 임시 폴더 정리, 운영 경로는 `extraDirs`를 넘기지 않음.
- **Minor(고침):** 최악 시간 계산(24초 → 22초), D30의 괄호 위치(`createLiveRuntime`에는 pinned 막힘 규칙이 없음), 문서 빈칸.
- **Minor(후속으로 둠):** 아래 "아직 하지 않은 것"의 두 단계 안내와 pinned의 옛 문구.

## 아직 하지 않은 것

- 관리형 설정(회사 IT)의 hook이 실제로 걸린 Mac에서의 확인.
- claude만 쓰는 사용자는 `./office`마다 claude를 한 번 더 띄운다(1단계, Office 시작). 1단계 결과는 다른 프로세스인 Office에 넘기지 않는다.
- 모델 목록 조회 자체의 멈춤(stdin 닫기 → 3초 → SIGTERM → 2초 → SIGKILL)은 바쁠 때 갱신 잠금을 남길 수 있다(#45 후속, 그대로). claude만 쓰는 사용자에게는 1단계 조회가 그 기회를 한 번 더한다.
- 로그인되지 않은 claude에는 1단계에서 hook을 묻지 않는다. 로그인한 뒤의 다음 `./office`에서 묻는다.
- pinned 관문의 불일치(위 리뷰 후속): 결정 필요.
- 1단계 조회 동안 진행 줄이 없다(한가할 때 1.3–1.4초, 조회만 최악 22초).
- 두 단계 안내(2차 리뷰): codex가 로그아웃되었고 `AGENTS.md`로 막혔으며 claude는 로그인되었지만 hook이 있으면 `RUNNER_BLOCKED`다. claude만 고치면 시작할 수 있다. 그러나 codex 쪽을 고치는 사용자는 다음 실행에서 `RUNNER_BLOCKED`를 다시 만나고, 그때야 `codex login` 안내를 본다. codex 안내 문구(`inspect()`)는 화면에도 쓰여서 이번에는 바꾸지 않았다.
- pinned의 옛 문구(2차 리뷰, 이 변경 전부터): pinned인데 `~/.codex/auth.json`이 없으면 "codex 또는 claude 중 하나를" 문구와 "claude: 준비됨"이 같이 나온다. pinned 관문 결정과 함께 다룬다.
- `unsupported`(버전을 읽을 수 없는 설치본)뿐일 때는 그대로 `LOGIN_REQUIRED`와 "설치하고 로그인한 뒤" 문구다.
- **G4:** 사용자 답변으로만 기록한다.
