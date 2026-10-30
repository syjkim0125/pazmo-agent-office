# 2026-10-29 부하에서만 실패하던 시험 고치기

Story: M6(`start`) · M3 · M4(claude 역할 멈춤). 앞선 기록: [리뷰 실행기 오류](2026-10-27-review-runner-failure.md)의 927/929, [claude 멈춤 후속](2026-10-28-claude-stop-integrity.md)의 955/956과 "시험 10의 부하 민감성". kit graph: `.ai-workflow/runs/load-flaky-tests.json`. 정리한 배움: [claw 시작](../solutions/test-failures/claw-startup-wait-is-cpu-bound-under-load.md), [멈춤 시험의 시계](../solutions/test-failures/mock-the-controller-clock-in-stop-tests.md).

## 1. Office 시작 시간 초과 (`Office startup timed out.`)

### 증상

다른 세션의 전체 시험이 같이 돌 때(load average 24–33) 두 시험이 가끔 실패했다. 지난 세션 기록에서 실패한 시험을 모으면 늘 이 둘이다.

- `tests/claw-lifecycle.test.mjs` "native Claw persists Tasks …"
- `tests/lean-lifecycle.test.mjs` "up refuses a running Office of another engine …"(안에서 `start --claw`)

둘 다 **claw 엔진**을 켠다. 시험 전체에서 claw를 실제로 켜는 시험은 이 둘뿐이다.

### 원인

`start`는 서비스의 ready 메시지를 15초 기다렸다(`src/cli/lifecycle.ts`). 이 대기에는 node 시작, 모듈 읽기, 설정을 받은 뒤의 시작이 모두 들어간다. 단계별로 재 보았다(측정 스크립트는 저장소 밖 scratchpad).

| 엔진 | 유휴 | CPU 과부하 |
|---|---|---|
| claw | 1.0–1.9초 | 12–36스레드 부하만(load 40–140): 7.5–33.2초, 8회 중 5회가 15초 초과. 16스레드 부하 + lean-lifecycle 반복 + 스왑 21GB 사용 중(load 47–175): 17.8–51.2초, 12회 중 2회는 60초 안에 끝나지 않음 |
| lean | 0.2–1.3초 | 0.2–2.9초 |
| legacy | — | 1.5–2.0초 |

- claw의 시간은 거의 다 설정을 받은 뒤다. `claw-service.ts`가 vendor 서버(`server-main.ts`)를 import하면서 tsx가 TypeScript 모듈 **220개**를 변환한다. esbuild(별도 프로세스), 훅 스레드, 메인 스레드가 함께 CPU를 쓴다. lean은 Node 내장 타입 제거로 55개만 읽는다.
- 새 데이터 디렉터리는 tsx 변환 캐시가 비어 있다. 서비스의 TMPDIR이 Office 전용 `dataDir/tmp`이기 때문이다. 시험의 첫 시작은 늘 처음부터 변환한다.
- 기계: RAM 18GB에 스왑 22.5GB 중 21GB를 쓰고 있었다. 부하가 크면 캐시가 찬 두 번째 시작도 60초를 넘긴 적이 있다. CPU뿐 아니라 페이지 교체도 시간을 늘린다.
- 확인하고 기각한 것:
  - IPC 메시지 유실: 리스너가 생길 때까지 Node가 버퍼에 둔다.
  - vendor auto-update가 시작마다 동기로 실행하는 `git --version`·`pnpm --version`: 부하에서도 0.06–0.65초라 주원인이 아니다.

### 고친 것

- `src/cli/lifecycle.ts`: 시작 대기를 엔진별로 둔다(`STARTUP_MS`, export). **claw만 120초**, legacy·lean·team은 15초 그대로다. 서비스가 죽거나 오류로 답하면 대기는 바로 끝난다. 120초를 다 기다리는 것은 답도 없고 끝나지도 않는 서비스뿐이다.
  - 처음에는 60초로 했다. 같은 부하에서 유효한 4회 중 1회가 실패했다(claw 두 번째 시작이 60초 초과). 그래서 위 12회를 재고, 끝난 시작 중 최악값(51.2초)의 2배를 넘는 120초로 올렸다.
- `tests/lean-lifecycle.test.mjs`: CLI 호출의 spawnSync 한도를 `STARTUP_MS.claw + 60000`(180초)으로 둔다. claw 대기보다 짧으면 느린 시작 중에 CLI가 죽는다. 그러면 시작 잠금이 남고, 상태 파일에 없는 Office가 남는다.
- 변환 자체를 없애는 방법(vendor 서버 미리 빌드, tsx 캐시를 Office 밖에 두기)은 하지 않았다. 배포 형태와 격리 설계를 바꾸는 일이라 이 범위를 넘는다.

### 부하에서 다시 돌린 결과

같은 16스레드 부하에서 두 파일(시험 15개)을 반복했다.

| | 결과 |
|---|---|
| 고치기 전 (15초) | 3회 중 1회만 통과. 실패 3건: claw-lifecycle 1건, "up refuses" 2건. 모두 `Office startup timed out.` |
| 60초 | 유효한 4회 중 3회 통과. 1회는 claw 두 번째 시작이 60초를 넘음. 1회는 실행 중 Mac이 잠들어(뚜껑 닫힘, `pmset` 19:31 Clamshell Sleep) 결과에서 뺐다 |
| **120초 (최종)** | **5회 중 5회 통과(75/75)**. load 83–165. claw 시험 하나가 35–115초 걸렸다. 실행 중 잠든 기록 없음 |

## 2. `tests/claude-controller.test.mjs`의 시간 단언

### 시간에 기대던 곳

| 시험 | 기대던 시간 | 부하에서 생기는 일 |
|---|---|---|
| "a claude timed out while it refreshes the login releases the lock" | 시작부터 1.5초 뒤 시간 초과 | fake가 `trap`을 걸고 잠금을 잡기 전에 시간 초과가 오면 `fx.pid()`가 ENOENT. **36스레드 부하에서 4회 중 3회 실패(RED)**. #36 리뷰의 "시험 10"이다. |
| "a claude that ignores SIGTERM is still killed soon after a cancel" | 취소부터 끝까지 8초 미만(6초 유예 + 2초 여유) | 여유 2초를 넘으면 실패 |
| "a claude that takes over 2 s to release the lock …" | 실제 `sleep 2.5`와 실제 6초 유예 | 여유 3.5초 |
| "a hook the claude starts while shutting down …" | hook이 1.5초 뒤 표시 파일을 씀 | Office가 1.5초 안에 hook 줄을 처리하지 못하면 실패 |
| "a failed boundary check (3가지)" | fake가 init 1.5초 뒤 계속, 시험은 2초 뒤 표시 확인 | 위와 같은 경쟁. 반대로 fake가 느리면 틀린 코드도 통과 |
| helper가 사라졌는지 보는 두 시험 | SIGKILL된 고아가 1초 안에 사라짐 | launchd가 늦게 거두면 실패 |

여유가 5.7초 이상인 시험("cancelled while it refreshes", "a line the claude prints while shutting down")은 실제 6초 유예를 그대로 쓴다.

### 바꾼 방법

- 컨트롤러의 시간 초과와 6초 유예는 `setTimeout`이다. 위 시험들은 `t.mock.timers`로 이것을 **컨트롤러의 시계**로 두고 시험이 직접 돌린다. fake claude의 진행은 진짜 시계로 표시 파일을 기다려 확인한다.
  - 시간 초과: fake가 잠금을 잡은 **뒤에** `tick(1500)`.
  - SIGTERM 무시: TERM을 받았다는 표시를 확인한다. `tick(5999)` 뒤 ping에 답하는지(살아 있음) 보고, `tick(1)`에서 SIGKILL로 끝나는지 본다. 6초 유예와 SIGKILL 대체 경로를 정확히 증명한다.
  - 2초 넘게 걸리는 종료: TERM을 받은 fake는 시험이 허락할 때까지 기다린다. `tick(5999)` 뒤에 허락하면, SIGKILL 없이 스스로 끝나고 잠금을 푼다.
  - 종료 중 hook: hook은 죽을 때까지 돈다. 시계가 멈춰 있어 유예는 끝날 수 없으므로, SIGKILL로 끝났다면 hook 줄 때문에 바로 죽인 것이다.
- 경계 검사: fake(`tests/fixtures/fake-claude.mjs`)가 init 뒤 정해진 시간 후 계속하던 것을 멈춰질 때까지 기다리게 바꿨다. 시험은 2초 sleep 대신 SIGKILL로 끝났는지 본다.
- helper 두 시험: 사라지기를 기다리는 상한만 1초에서 10초로 늘렸다. 죽지 않은 helper는 계속 실패한다.
- 실패 경로에서 멈추지 않게 했다(독립 리뷰 두 번의 지적 반영):
  - 잠금 시험은 모두 시험 한도를 둔다. 기본 15초이고, helper가 거둬지기를 최대 10초 기다리는 두 시험은 30초다. 36스레드 부하에서 이 시험들은 최대 3.7초였다.
  - `refreshingClaude(t, …)`가 시험이 끝날 때 fake의 프로세스 그룹을 죽인다.
  - 표시 파일과 종료 기다리기는 시험 신호(`t.signal`)로 멈춘다.
  - pid 파일이 비어 있으면 그룹을 죽이지 않는다. 0이면 `kill(-0)`이 시험 프로세스 자신의 그룹을 죽였다(리뷰 반영 중에 발견).
  - claude를 아예 띄우지 못하게 한 돌연변이(pid 파일이 생기지 않음): 예전에는 파일이 끝나지 않았다. 이제는 150초 만에 20개 시험이 모두 실패로 끝난다.
- 파일 실행 시간은 약 42초에서 약 8초로 줄었다(진짜 6초 대기가 없음).

### 돌연변이로 확인한 것

`src/runners/claude-controller.ts`를 잠깐 바꿔(커밋하지 않음, 바이트 단위로 되돌림 확인) 바뀐 시험이 회귀를 잡는지 봤다. 7가지 모두 잡혔고, 매번 파일이 끝까지 돌아 남은 fake 프로세스가 0개였다.

| 바꾼 것 | 잡은 시험 |
|---|---|
| 유예 6초 → 3초 | "takes over 2 s", "ignores SIGTERM" |
| 유예 6초 → 9초 | "ignores SIGTERM"(15초 시험 한도) |
| 시간 초과에 SIGTERM 없음 | "timed out while it refreshes"(15초 시험 한도). 리뷰 반영 전에는 파일이 멈췄다 |
| 취소에 SIGTERM 없음 | "cancelled while", "takes over 2 s", "ignores SIGTERM", "hook …" 등. 리뷰 반영 전에는 파일이 끝나지 않았다 |
| 시간 초과도 바로 SIGKILL | "timed out while it refreshes" |
| 종료 중 hook 무시 | "a hook … killed at once"(15초 시험 한도) |
| 경계 검사 멈춤에도 SIGTERM 먼저 | 경계 검사 3개, "no SIGTERM to shut down on" 3개 |

### 부하에서 다시 돌린 결과

| | 결과 |
|---|---|
| 고치기 전, 16스레드 (load 41–57) | 5회 모두 통과(이 부하로는 재현 안 됨) |
| 고치기 전, 36스레드 (load 47–80) | **4회 중 1회만 통과**. 실패 3건 모두 "timed out while it refreshes"의 ENOENT |
| 고친 뒤 `cfb14c4`, 36스레드 (load 18–141) | 6회 중 6회 통과(120/120) |
| **최종 `10a5642`, 36스레드 (load 13–176)** | **6회 중 6회 통과(120/120)** |

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` (최종 `10a5642`, 2026-10-30 09:32, 다른 시험 없음) | **1092/1092** exit 0, 80초 |
| root `npm test` (`cfb14c4`, 2026-10-30 09:13) | 1092/1092 exit 0, 124초 |
| `tests/claude-controller.test.mjs` (`10a5642`) | 20/20, 3번 반복 |
| lifecycle 두 파일 (`cfb14c4`, 부하 없음. 이후 이 두 파일과 `lifecycle.ts`는 바뀌지 않음) | 15/15 |
| `npm run typecheck` (`10a5642`) | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

## 리뷰 (독립, 보고만)

같은 리뷰어가 세 번 봤다. 기록: `.ai-workflow/runs/load-flaky-tests-review-1.md`, `-review-2.md`.

1. `b8649d5`: 고친 뒤 머지 가능(With fixes). Important 1건: 시계를 얼린 두 시험에 시험 한도와 프로세스 그룹 정리가 없었다. "시간 초과에 SIGTERM 없음", "취소에 SIGTERM 없음" 돌연변이에서 파일이 멈췄다. Minor는 `reached()` 상한, `lifecycle.ts` 주석("매 시작마다"는 틀림, team 누락), spawnSync 한도가 주석으로만 묶임, 멈춘 claw 시작 동안 `up`이 조용함이었다. → `cfb14c4`에서 고쳤다. 마지막 것은 후속으로 남겼다.
2. `cfb14c4`: 고친 뒤 머지 가능. pid 보호와 `t.signal` 사용은 맞다고 확인했다. Important 1건: mock을 쓰지 않는 잠금 시험 셋은 fake가 pid를 못 쓰면 끝나지 않는다. → `10a5642`에서 고쳤다.
3. `10a5642`: **머지 가능(Ready to merge — Yes)**. 막지 않는 후속 둘(둘 다 이 브랜치 이전부터): "a cancel after the claude itself exited"가 비어 있는 pid 파일을 읽을 수 있는 마이크로초 경쟁, fake의 pid 경로가 `$HOME` 아래라는 점.

## 아직 하지 않은 것

- claw 시작을 빠르게 하는 일(vendor 서버 미리 빌드). 120초는 끝난 시작 중 최악값의 2배를 넘지만, 측정 범위보다 센 부하에서는 여전히 넘을 수 있다.
- 120초 동안 멈춘 claw 시작은 `up`이 아무것도 출력하지 않고, `status`는 unknown, `stop`은 거부한다(리뷰 Minor). 15초 뒤 "아직 시작 중" 안내는 후속 후보다.
- 리뷰가 남긴 후속: "a cancel after the claude itself exited"의 빈 pid 읽기 경쟁, fake pid를 `$HOME` 밖 고정 경로에 쓰기, helper 정리의 `kill(0)` 위험(낮음).
- 실패 기록이 없어 손대지 않은 한도: `control()`의 1.5초 HTTP 한도, claw 시험의 "No native task update" 3초, `assertOfficesExited`의 5초, `tests/remote-job.test.mjs`의 7초/12초 시험.
- 실제 전체 시험 두 벌을 동시에 돌리는 확인은 하지 않았다(한 번에 하나 규칙). 부하 루프로 대신했다.
- **G4:** 사용자 답변으로만 기록한다.
