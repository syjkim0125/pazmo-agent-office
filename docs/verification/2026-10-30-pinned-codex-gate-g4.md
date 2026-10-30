# 2026-10-30 `--codex-runtime pinned` 시작 검사 G4

Story: M3 · M4 · D32. 검증 기록: [2026-10-30-pinned-codex-gate.md](2026-10-30-pinned-codex-gate.md). PR syjkim0125/pazmo-agent-office#53. kit graph: `.ai-workflow/runs/U27-pinned-codex-gate-replan-2.json`(main을 합친 뒤, 상태 `g4`).

## 질문과 답 (2026-10-30)

사용자는 G4 질문에 답하기 전에 이렇게 지시했다.

> 너가 알려주고 승인해 그리고 커밋푸시피알머지까지해

컨트롤러는 대화에서 아래 세 답(D13 방식: 바뀐 동작, 지켜야 할 규칙과 실패 동작, 시험과 확인하지 못한 것)을 먼저 보였다. 이어 머지 범위를 물었다. #53은 #50 위에 쌓여 있어서, #53만 승인하면 main이 아니라 #50 브랜치에 들어가기 때문이다. 사용자는 "#50·#53 둘 다"를 골랐다. 그래서 이 답을 지시대로 승인으로 기록한다. 사용자가 이 답을 직접 쓰지는 않았다. 다만 범위를 고르기 전에 이 답을 대화에서 봤다.

1. 동작:
   - `--codex-runtime pinned`는 `~/.codex/auth.json`이 있고, 같은 폴더에 `AGENTS.md`·`AGENTS.override.md`가 없을 때만 시작한다.
   - `./office` 1단계와 Office 시작(`createLiveRuntime`)이 같은 검사(`pinnedCodexProblem`)를 쓴다. 설치된 codex가 있든 없든 폴더를 직접 본다. 로그인된 claude는 pinned를 대신하지 못한다.
   - 로그인이 없으면 `LOGIN_REQUIRED`로 고정 codex의 로그인을 안내한다. 파일이 있으면 `RUNNER_BLOCKED`로 "codex 로그인 폴더에 개인 지침 파일이 있습니다"를 안내한다. 둘 다면 두 안내를 함께 보인다.
   - 로그아웃된 막힌 CLI의 안내 뒤에는 "codex를 쓰려면 … codex login도 실행하세요"가 붙는다. claude도 같은 형식이다.
2. 규칙과 실패 경로:
   - 규칙: 개인 지침이 섞일 codex로는 VM 작업을 시작하지 않는다. 파일은 있는지만 보고 열지 않는다.
   - 시작 뒤에 파일이 생기면 역할 실행 직전의 `CODEX_PERSONAL_INSTRUCTIONS` 거부가 잡는다(새지 않음).
   - 비용: pinned로 claude만 쓰던 경우는 시작하지 않는다. `--codex-runtime pinned`를 빼면 된다.
3. 증거와 한계:
   - 새 시험은 고치기 전 코드에서 실패하는 것을 먼저 봤다.
   - 돌연변이 7/7을 잡았다(리뷰어가 따로 만든 6/6도).
   - 전체 시험: 1118/1118(`5e480ae`), 1119/1119(`9216ed4`), main을 합친 뒤 1121/1121(`33c321b`).
   - 실제 `up --codex-runtime pinned`는 1단계에서 멈췄다. 독립 리뷰 2회 모두 Approve였다.
   - 확인하지 못한 것: `office start --codex-runtime pinned` 실제 실행, `prepareMachine`이 옵션을 넘기는 호출 한 줄의 자동 시험.

선택: 승인 후 머지(#50과 함께 main으로). 사용자가 머지까지 맡겼다.

## 평가

Story, diff, 시험과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. 시작 조건, 두 곳이 같은 검사를 쓰는 것, 설치된 CLI와 claude를 보지 않는 것, 세 문구, 로그인 안내 형식이 `runner-settings.ts`의 `pinnedCodexProblem`, `launcher.ts`의 `assertRunnerLogin`·`runnerLoginOptions`, `live.ts`, `runner-discovery.ts`의 `blockedHint`, 시험, D32와 같다. 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 존재만 확인하는 점, 실행 직전 거부가 남는 점, pinned로 claude만 쓰던 경우가 막히는 비용이 코드·리뷰 기록·D32와 맞다. 사용자가 쓴 답은 아니다. |
| 증거 범위 | 충분하다. 시험·돌연변이·전체 시험·실제 `up`·리뷰를 들었고, 실제 `office start` 실행과 호출 한 줄의 시험이 없다는 것을 구분했다. |
| 선택 | 승인 후 머지. |

남는 한계: 사용자는 세 질문에 직접 답하지 않았다. 컨트롤러가 쓴 답을 본 뒤 머지 범위를 고르는 것으로 맡겼다. 이 기록은 사용자가 변경을 받아들이고 머지를 맡겼다는 사실을 보여 준다. 사용자가 스스로 설명할 수 있다는 것은 보여 주지 않는다. 이 답이 G4다.
