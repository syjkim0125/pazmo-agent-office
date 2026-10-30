# 2026-10-30 `--codex-runtime pinned` 시작 검사를 1단계와 Office에서 같게

Story: M3 · M4 · D30 · D32. 근거: [PR #50 변경 기록](2026-10-30-launcher-hook-check.md)의 리뷰 후속 두 가지(pinned 관문 불일치, 두 단계 안내). kit graph: `.ai-workflow/runs/U27-pinned-codex-gate-replan-2.json`(main을 합친 뒤, 최종). `U27-pinned-codex-gate-replan.json`은 합치기 전 Story 기준으로 `g4`까지 갔다. 처음 연 `U27-pinned-codex-gate.json`에는 구현 1회차와 시작한 리뷰가 남아 있다. 1차 리뷰 반영 때 D32에 "D30의 pinned 문장을 바꿈"을 적어 Story 지문이 바뀌었으므로 새 run을 열었다. 사용자 선택 설명: https://claude.ai/artifact/WWm4WRXZqeb7MnVKSrW9F1

## 왜 바꿨나

- `--codex-runtime pinned`는 codex 역할을 고정 0.155.1 컨트롤러로 돌리고, `CODEX_HOME`을 Mac codex 로그인 폴더(`~/.codex`)로 준다.
- 고정 0.155.1도 그 폴더의 `AGENTS.md`·`AGENTS.override.md`를 모델 요청에 넣는다. 2026-10-06 가짜 모델 실험 결과다([기록](2026-10-06-cli-runner-selection.md), [해결 문서](../solutions/security-issues/codex-home-agents-md-leaks-into-isolated-runs.md)). 고정 실행 파일의 SHA(`CONTROLLER_SHA256`)는 2026-09-22(`e98de40`) 뒤로 바뀌지 않았다.
- 새지는 않았다. `codexJob`이 pinned를 포함한 모든 codex 실행을 시작 직전에 `CODEX_PERSONAL_INSTRUCTIONS`로 거부한다(`src/runners/codex-controller.ts:94`). 문제는 멈추는 시점이었다.
  - `./office` 1단계는 탐색이 찾은 codex의 `blocked`만 봤다. 설치된 codex가 없으면 탐색은 `blocked`를 채우지 않으므로, `auth.json`이 있으면 `AGENTS.md`가 있어도 1단계를 통과했다(고치기 전 함수로 확인, 아래).
  - Office를 켜는 `createLiveRuntime`은 pinned면 `auth.json`만 봤다(`f2bd735`부터). 그래서 막힌 codex로 의존성 설치·VM 준비를 마치고 Office를 켠 뒤, codex 역할 작업마다 실패했다.
  - 1단계는 pinned면 codex 로그인만 봤지만, Office는 로그인된 claude가 있으면 pinned도 켰다.
- 사용자가 B(시작 검사를 앞당겨 1단계와 Office를 같게)를 골랐다(2026-10-30). A(1단계를 Office에 맞춰 늦춤)는 고르지 않았다.

## 바뀐 동작

- `pinnedCodexProblem(authHome)`(`src/runtime/runner-settings.ts`) 하나가 pinned 시작을 판단한다. `./office` 1단계(`assertRunnerLogin`)와 실행기 모드의 Office 시작(`createLiveRuntime`)이 같이 쓴다.
  - `authHome/auth.json`이 있고 `AGENTS.md`·`AGENTS.override.md`가 없으면 통과한다. 파일은 있는지만 보고 열지 않는다.
  - 설치된 codex가 있든 없든 같은 폴더를 본다. 로그인된 claude는 pinned 시작 조건이 아니다.
  - 로그인이 없으면 `LOGIN_REQUIRED`: "고정 codex(--codex-runtime pinned)는 이 Mac의 codex 로그인(…/auth.json)을 씁니다. 터미널에서 codex login을 실행하세요(codex가 없으면 npm i -g @openai/codex로 먼저 설치)." 파일도 있으면 옮기라는 안내가 뒤에 붙는다. 예전의 "codex 또는 claude 중 하나를" 문구와 "claude: 준비됨"은 나오지 않는다.
  - 로그인은 있는데 파일이 있으면 `RUNNER_BLOCKED`: "고정 codex(--codex-runtime pinned)가 쓰는 codex 로그인 폴더에 개인 지침 파일이 있습니다. …/AGENTS.md가 있으면 codex가 이 개인 지침을 Office 역할 실행에 섞으니 그 파일을 다른 곳으로 옮기세요."
  - 1단계는 뒤에 "그런 뒤 다시 실행해주세요. 로그인 정보는 VM에 복사하지 않습니다.", Office는 "그런 뒤 다시 시작하세요."를 붙인다.
  - 경로는 `CODEX_PERSONAL_INSTRUCTIONS`처럼 절대 경로로 보인다(탐색 안내는 `~/.codex/…`).
  - 1단계가 넘기는 로그인 폴더는 `runnerLoginOptions(codexRuntime, homedir())`가 정한다(`~/.codex`, Office가 `CODEX_HOME`으로 주는 폴더와 같음).
- pinned가 아닐 때의 1단계·Office 판단은 그대로다.
- 그대로 둔 것: 역할 실행 직전의 `CODEX_PERSONAL_INSTRUCTIONS` 거부(시작 뒤에 생긴 파일도 잡음), pinned 역할 작업(`roleJobFactory`), 실행기 없는 기존 모드(`createLiveRuntime`의 `!runners` 경로).
- 두 단계 안내(ASSUMED): 로그아웃된 CLI가 막혔으면 막힘 안내 뒤에 "그 CLI를 쓰려면 로그인도 하라"는 안내를 붙인다(`blockedHint`, `src/runners/runner-discovery.ts`). 안내의 다른 길(다른 CLI 고르기)을 택하면 필요 없으므로 조건으로 쓴다(1차 리뷰 Minor 2).
  - codex: `~/.codex/AGENTS.md`로 막혔고 로그아웃이면 "… 옮기거나 claude를 고르세요. codex를 쓰려면 터미널에서 codex login도 실행하세요."
  - claude: Office의 `loadRunnerCatalog`는 로그아웃된 claude에도 hook을 묻는다. hook으로 막혔고 로그아웃이면 "… codex를 고르세요. claude를 쓰려면 터미널에서 claude auth login도 실행하세요." (1단계는 로그인된 claude에만 hook을 물으므로 1단계 claude 안내에는 붙지 않는다.)
  - 로그인된 막힌 CLI의 안내는 그대로다. 이 안내는 화면의 CLI 상태에도 쓰인다.
- `docs/LOCAL-PREVIEW.md`의 pinned 문장에 시작 조건을 적었다. 해결 문서(`docs/solutions/security-issues/codex-home-agents-md-leaks-into-isolated-runs.md`)에 pinned 시작 검사를 더했다.

## 시험

| 시험 | 고치기 전(`2062c17`) | 고친 뒤 |
|---|---|---|
| `tests/launcher.test.mjs` "the pinned codex runtime needs the Mac codex login, and a ready claude does not stand in" | 실패 | 통과 |
| `tests/launcher.test.mjs` "the pinned runtime checks the codex login folder itself, with no codex installed" (`AGENTS.md`, `AGENTS.override.md`) | 실패 | 통과 |
| `tests/launcher.test.mjs` "a blocked codex does not count…", "a blocked CLI that is also logged out…", "under the pinned runtime a blocked codex…" (pinned 부분을 로그인 폴더로 바꿈) | 실패 | 통과 |
| `tests/launcher.test.mjs` "a logged-out codex blocked by AGENTS.md keeps its login cue next to a hooked claude" (가짜 native CLI) | 실패: 안내에 `codex login` 없음 | 통과 |
| `tests/live-runtime.test.mjs` "the pinned runtime starts only with the Mac codex login and no personal codex instructions, whatever claude's state" | 실패: 로그인된 claude로 관문 통과 | 통과 |
| `tests/runner-settings.test.mjs` "a logged-out claude blocked by a hook keeps its login cue" (가짜 native CLI) | 실패: 안내에 `claude auth login` 없음 | 통과 |
| `tests/runner-discovery.test.mjs`·`runner-settings.test.mjs`: 로그인된 막힌 CLI 안내에 로그인 문구가 없음 | 처음부터 통과 | 통과 |

1차 리뷰 반영(구현 2회차, `9216ed4`)에서 고치기 전(`5e480ae`)에 실패를 본 시험:

| 시험 | 고치기 전(`5e480ae`) | 고친 뒤 |
|---|---|---|
| "the pinned runtime checks the codex login folder itself…"(머리말이 로그인 폴더를 말함, "codex가 막혀" 없음) | 실패: "…가 쓸 codex가 막혀 있습니다" | 통과 |
| "step 1 judges the pinned runtime on the Mac codex login folder, other runtimes on the CLIs" (`runnerLoginOptions`) | 실패: 빈 helper가 `{}` | 통과 |
| "a logged-out codex blocked by AGENTS.md keeps its login cue…"("codex를 쓰려면 … codex login도") | 실패: "터미널에서 codex login을 실행하세요." | 통과 |
| "a logged-out claude blocked by a hook keeps its login cue"("claude를 쓰려면 … claude auth login도") | 실패: "터미널에서 claude auth login을 실행하세요." | 통과 |

- RED는 새 시험을 고치기 전 코드에 돌려 봤다(62개 중 15개 실패). 위 6개 동작 시험은 기대한 이유로 실패했다. 나머지 9개는 `assertRunnerLogin`의 두 번째 인자(`codexAuth`)를 없앤 것 때문에 실패했다(pinned가 아니면 인자 없이 부른다).
- pinned 시험은 임시 폴더를 로그인 폴더로 쓰고 시험이 끝나면 지운다. 실제 `~/.codex`는 보지 않는다.
- 돌연변이(구현 1회차) 7개를 모두 잡았다: 개인 지침 파일 무시, 로그인 없음 무시, 1단계 pinned가 일반 규칙으로 빠짐, Office pinned 관문 건너뜀, 로그인 안내를 붙이지 않음, 로그인된 CLI에도 붙임, pinned 막힘을 `LOGIN_REQUIRED`로. 리뷰어도 따로 6개를 만들어 모두 잡혔다(아래).
- **자동 시험이 없는 것:** `prepareMachine`이 `runnerLoginOptions(...)`의 결과를 `assertRunnerLogin`에 넘기는 한 줄이다. 이 줄을 `{}`로 바꿔도 시험은 실패하지 않는다(고치기 전 `codexAuth` 연결도 같았다). `up` CLI 시험으로 막으려 했지만, 이 Mac처럼 탐색 기본 폴더(`/opt/homebrew/bin`)에 실제 claude가 있으면 연결이 깨졌을 때 시험이 실제 의존성 설치·VM 시작으로 넘어갈 수 있어 만들지 않았다. 아래 실제 `up`으로 봤다.

## 실제 확인

- 실제 `up --codex-runtime pinned` CLI를 `5e480ae`와 `9216ed4`에서 한 번씩 돌렸다. 조건: 임시 HOME(그 안의 `.codex`), PATH `/usr/bin:/bin`, 임시 git repo와 data dir, 60초 한도. 설치된 codex는 찾지 못한다. 탐색 기본 폴더 `/opt/homebrew/bin`에는 이 Mac의 실제 claude 2.1.280이 있어 `--version`·`auth status`가 불렸을 수 있다(pinned는 claude를 판단에 쓰지 않고 hook도 묻지 않는다).
  - `auth.json`+`AGENTS.md`, Claw: exit 1, `RUNNER_BLOCKED`(`9216ed4`: 1.7초, "…쓰는 codex 로그인 폴더에 개인 지침 파일이 있습니다…"). lean: exit 1, `RUNNER_BLOCKED`(1.4초).
  - `AGENTS.override.md`만(로그인 없음), Claw: exit 1, `LOGIN_REQUIRED`, 고정 codex 로그인 문구와 파일 옮기기 안내(1.1초).
  - 셋 다 `[1/4]` 줄이 없고, data dir·`qualified-runtime`·임시 HOME의 `.colima`가 생기지 않았다.
  - `auth.json`만 있는 경우(1단계 통과)는 실제 의존성 설치·고정 codex 다운로드·VM 시작으로 넘어가므로 돌리지 않았다.
- 고치기 전 함수(PR #50 worktree `2062c17`의 `assertRunnerLogin`)는 pinned·`auth.json` 있음·설치된 codex 없음에서 통과했다. pinned·로그인 없음·claude 준비됨에서는 "최초 준비: codex 또는 claude 중 하나를 … claude: 준비됨"이었다.
- 이 Mac의 실제 `~/.codex`(파일 있는지만 확인): `pinnedCodexProblem`이 `RUNNER_BLOCKED`(`~/.codex/AGENTS.md`). 그래서 이 Mac에서 `./office --codex-runtime pinned`는 그 파일을 옮기기 전까지 1단계에서 멈춘다. 이 Mac에는 설치된 codex(`~/.bun/bin/codex`)가 있어, 탐색이 그것을 찾으면 고치기 전에도 1단계에서 멈췄다(이번에 실제 CLI 탐색은 돌리지 않았다).
- `office start --codex-runtime pinned`의 실제 실행은 하지 않았다. `createLiveRuntime` 관문은 위 시험으로 봤다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| 관련 7개 파일(launcher·live-runtime·runner-settings·runner-discovery·lean-office·runner-jobs·codex-controller), `5e480ae` | 125/125, exit 0 |
| 관련 9개 파일(위 7개 + cli·team-lifecycle), `9216ed4` | 148/148, exit 0, 건너뜀 0 |
| root `npm test`, 구현 1회차 `5e480ae` (2026-10-30 14:41–14:43, load average 11–19, 다른 전체 시험 없이) | 1118/1118, exit 0 (PR #50의 1114 + 새 시험 4) |
| root `npm test`, 최종 `9216ed4` (14:58–15:01, load average 10–22, 다른 전체 시험 없이) | 1119/1119, exit 0 (`runnerLoginOptions` 시험 +1) |
| root `npm test`, main(#48·#49·#51·#52·#54)을 합친 `33c321b` (15:51–15:53, load average 7–24, 다른 전체 시험 없이, vendor 설치·`build:office` 다시 함) | 1121/1121, exit 0 |
| 관련 10개 파일(위 9개 + runner-models), `33c321b` | 164/164, exit 0 |
| `npm run typecheck` (`5e480ae`, `9216ed4`) | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` (`9216ed4`) | exit 0 |

- `9216ed4` 뒤 커밋은 문서·kit 기록만 바꾼다. 시험은 문서를 읽지 않는다.

## 리뷰 (독립, 보고만)

1회차(`5e480ae`) 판정은 Approve였고 Critical·Important는 없었다. 기록: `.ai-workflow/runs/U27-review-1.md`.

- 리뷰어가 돌린 것: launcher·live-runtime·runner-settings·runner-discovery 62/62, runner-jobs·codex-controller·cli·team-lifecycle·lean-office 85/85, 타입 검사 exit 0, Story 검사기 exit 0, 따로 만든 돌연변이 6/6 잡힘(체크아웃은 바꾸지 않음).
- 확인된 것: 실행기 모드의 모든 pinned 시작(Claw native, lean, `start --live`)이 `createLiveRuntime`에 runners와 함께 온다(팀 엔진은 잠긴 채 열려 live 실행이 없다). 1단계와 Office가 `codexJob`이 보는 것과 같은 `~/.codex`를 존재만으로 본다. pinned가 아닐 때의 판단·문구는 `2062c17`과 같다(로그아웃된 막힌 CLI의 ASSUMED 안내만 다름). 화면은 안내 문구를 보여 주기만 하고 문구로 판단하지 않는다. import 순환이 없다. 시험은 실제 `~/.codex`를 읽지 않는다.
- **Minor(고침):** 설치된 codex가 없을 때 틀린 pinned 머리말("…가 쓸 codex가 막혀"), 다른 CLI를 고르면 필요 없는 로그인 안내를 꼭 해야 할 일처럼 쓴 문구, `prepareMachine` 연결의 시험 없음(`runnerLoginOptions`로 빼서 시험, 호출 한 줄은 남음), 문서(D32가 D30의 pinned 문장을 바꾼다고 적기, STATUS, 해결 문서).
- **Minor(후속으로 둠):** pinned에서도 1단계가 CLI 탐색을 돌리지만 결과를 쓰지 않는다.

2회차(같은 리뷰어, `9216ed4`) 판정은 Approve였고 Critical·Important는 없었다. 기록: `.ai-workflow/runs/U27-review-2.md`.

- 리뷰어가 돌린 것: 같은 4개 파일 63/63(`runnerLoginOptions` 시험 하나 늘어남), 관련 5개 파일 85/85, 타입 검사 exit 0, Story 검사기 exit 0.
- **Minor(고침, 문서):** STATUS의 PR #50 항목이 pinned 불일치를 아직 결정할 일로 적음, 해결 문서가 예전 Office 동작을 "`auth.json`만"으로 줄여 씀(쓸 수 있는 CLI만 있어도 켜졌음).

## 아직 하지 않은 것

- pinned에서도 1단계는 `discoverRunners`를 돌린다(`codex --version`·`codex login status`·`claude auth status`). pinned 판단에는 그 결과를 쓰지 않는다(1차 리뷰 Minor 5, 이 변경 전과 같은 비용이라 그대로 둠).
- 실행기 없는 기존 모드(`createLiveRuntime`의 `!runners`)는 시작 때 개인 지침 파일을 보지 않는다. 실행 직전 `codexJob` 거부만 있다(이 변경 전과 같음).
- pinned에서 시작 뒤 `AGENTS.md`가 생기면 codex 역할 작업마다 `CODEX_PERSONAL_INSTRUCTIONS`로 실패한다(새지 않음, 이 변경 전과 같음).
- 이 변경은 PR #50 위에 있다. main(#48·#49·#51·#52·#54)을 합칠 때 문서 세 곳(Story의 D30·D31·D32 줄, STATUS, 모델 목록 조회 해결 문서)이 충돌해 풀었다. main은 이 변경의 src·tests 파일을 건드리지 않았다.
- **G4:** 사용자 답변으로만 기록한다.
