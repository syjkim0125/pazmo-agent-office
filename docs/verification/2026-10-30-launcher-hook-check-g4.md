# 2026-10-30 `./office` 시작 1단계에서 hook이 있는 claude 막기 G4

Story: M3 · M4 · D30. 검증 기록: [2026-10-30-launcher-hook-check.md](2026-10-30-launcher-hook-check.md). PR syjkim0125/pazmo-agent-office#50. kit graph: `.ai-workflow/runs/U25-launcher-hook-check-replan-2.json`(#50의 마지막 Story 기준 상태 `g4`). 그 뒤 Story에 D31·D32가 더해졌다. #50의 코드는 #53의 run(`U27-pinned-codex-gate-replan-2.json`)에서 main과 합친 상태로 다시 검증했다.

## 질문과 답 (2026-10-30)

사용자는 #53을 맡긴 세션에서 이렇게 지시했다.

> 너가 알려주고 승인해 그리고 커밋푸시피알머지까지해

#53은 #50 위에 쌓여 있다. 그래서 컨트롤러가 "#53을 main에 넣으려면 #50도 G4 승인과 머지가 필요하다"며 범위를 물었다. 사용자는 "#50·#53 둘 다"를 골랐다. 그래서 컨트롤러가 #50의 답을 쓰고(D13 방식), 지시대로 승인으로 기록한다. 사용자는 이 #50 답을 기록 전에 보지 않았다(#47·#51 G4와 같은 형태).

1. 동작:
   - `./office` 시작 1단계(Claw·lean·팀 Office)는 claude만으로 Office를 켤 수 있을 때 claude에게 hook 목록을 묻는다. 그때는 쓸 수 있는 codex가 없고, `--codex-runtime pinned`가 아니며, claude가 설치·로그인된 경우다. 판단은 Office와 같다(`blockHookedClaude`, D29).
   - hook이 있거나 목록을 알려 주지 않으면 의존성 설치·VM 준비 전에 멈춘다.
   - 쓸 수 있는 실행기가 없고 로그인된 CLI가 막혔으면, 1단계와 `createLiveRuntime` 모두 `LOGIN_REQUIRED`가 아니라 `RUNNER_BLOCKED`로 CLI별 안내를 앞세운다. 막힌 CLI가 로그아웃이거나 막힌 것이 없으면 `LOGIN_REQUIRED`다.
   - pinned 부분은 D32(#53)가 바꿨다.
   - 비용: claude만 쓰는 사용자는 1단계에서 claude를 한 번 더 띄운다. 한가할 때 1.3–1.4초이고, 조회만 최악 22초다. 그동안 진행 줄이 없다.
2. 규칙과 실패 경로:
   - 규칙: Office가 쓰지 않을 claude로 설치·VM 작업을 시작하지 않는다. 1단계와 Office가 같은 판단을 쓴다.
   - 조회 자체가 실패하면 판단하지 않는다(D29). 1단계는 통과하고, Office를 켤 때 다시 묻는다.
   - 막힌 claude의 SessionStart·SessionEnd hook은 1단계 조회 때 한 번 돈다(D29와 같은 한계). 그 뒤 Office를 켜지 않으므로 `./office` 한 번에 도는 횟수는 전과 같다.
3. 증거와 한계:
   - 새 시험 9개의 RED/GREEN을 봤다. 그중 4개는 빠진 시험을 메운 것이라 처음부터 통과했다.
   - 돌연변이 13개 중 12개를 잡았다. 남은 하나는 시험용 `extraDirs` 경계다.
   - 전체 시험 1114/1114(`44f478c`)였다. 독립 리뷰 2회는 Changes needed에서 고친 뒤 Approve가 됐다.
   - 실제 `up`(Claw·lean)을 가짜 hook claude로 돌려 1단계에서 멈추는 것을 봤다. 이 Mac의 실제 claude 2.1.280은 hook이 없어 막히지 않았다.
   - 확인하지 못한 것: 관리형 hook이 실제로 걸린 Mac, `up` 전체의 자동 시험.

선택: 승인 후 머지(#53과 함께 main으로). 사용자가 머지까지 맡겼다.

## 평가

Story, diff, 시험과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. 조회 조건, 같은 판단, 멈추는 시점, `RUNNER_BLOCKED`와 `LOGIN_REQUIRED`의 구분, 비용이 `launcher.ts`의 `startupRunners`·`assertRunnerLogin`, `runner-settings.ts`, `live.ts`, 시험, D30과 같다. pinned 문장은 D32가 바꾼 대로다. 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 조회 실패 때 판단하지 않는 점, hook이 한 번 도는 한계가 코드·리뷰 기록·D29·D30과 맞다. 사용자가 쓴 답은 아니다. |
| 증거 범위 | 충분하다. 가짜 native CLI 시험·돌연변이·전체 시험·실제 `up`·리뷰를 들었고, 관리형 hook Mac과 `up` 자동 시험이 없다는 것을 구분했다. |
| 선택 | 승인 후 머지. |

남는 한계: 사용자는 세 질문에 답하지 않았다. #50의 답은 보기 전에 머지까지 지시했다. 이 기록은 사용자의 이해를 보여 주지 않는다. 사용자가 변경을 받아들이고 머지를 맡겼다는 사실만 보여 준다. 이 답이 G4다.
