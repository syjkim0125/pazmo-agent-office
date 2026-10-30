# 검증 기록: 새 Office 기본 전환과 Claw Empire 삭제 (D33)

- 결정: [lean-office-default-decision.md](../understanding/lean-office-default-decision.md) (G3 2026-10-30, A안 "A로 해")
- 계획: [2026-10-30-1500-feat-lean-office-default-plan.md](../plans/2026-10-30-1500-feat-lean-office-default-plan.md)
- Story: D33, M1·M2·M3·M8·M12·M15, V1·V8·V9·V10·V14·V17
- 브랜치: `codex/lean-phase3-g3` (origin/main `3926ee2` 위)

## 바뀐 것

| 커밋 | 내용 |
|---|---|
| `ee12b05` | `ws`·TypeScript를 루트 의존성으로(`ws` 8.19.0, `typescript` 5.9.3, `@types/node` 24.10.13, `@types/ws` 8.18.1, `package-lock.json`) |
| `64ef668` | 엔진 시험과 스크립트 6개를 lean 스키마(`applyLeanSchema`)로. Claw 전용 엔진 경로 시험은 `tests/role-agents-fixture.mjs` |
| `0a2f602` | lean이 기본, claw·legacy 엔진·채팅 bridge·operator CLI 삭제, `--claw`는 `CLAW_REMOVED`, 옛 상태 파일은 읽고 멈춤, `up`은 재사용 판단 전에 의존성 설치 |
| `68a1f32` | `vendor/claw-empire`(추적 파일 708개, gitlink 2개), `.gitmodules`, `build:office`, Claw 전용 시험 삭제, `/vendor/` 무시 |
| `45078a1` | README(영·한), LOCAL-PREVIEW, CHAT-CONTROL(폐기 안내), AGENTS.md, CONCEPTS, LICENSING, THIRD_PARTY_NOTICES, `upstream/` |
| `948afc7` | 단순화 리뷰 반영: `ws` static import, `Engine` 타입 재사용, 의존성 설치를 거부 판단 뒤로(새로 켤 때는 준비물·로그인 확인 뒤), 읽지 않는 `operatorToken` 칸 삭제 |
| `91d9a27` | origin/main(#48 내부 이름 별칭, #49) 병합. 이 브랜치의 새 문서도 별칭으로 |
| `3bfb30a` | 독립 리뷰 반영(아래 "독립 리뷰") |
| `73b15ed` | origin/main(#51, D31: live lean 시작 대기 30초) 병합. `STARTUP_MS`는 lean 30초·team 15초만 남김 |
| `491c668` | origin/main(#52 `claude auth status` 잠금 기록, #54 Pazmo 원본 라이선스 PolyForm Shield 1.0.0) 병합. LICENSING·README(영·한)는 #54의 새 라이선스와 이 브랜치의 Claw 삭제 문구를 둘 다 살림, `package-lock.json`의 license도 `SEE LICENSE IN LICENSING.md`로 |
| `a6f4929` | origin/main(#55 README를 팀 Story 보드 중심으로 다시 씀) 병합. #55의 구조를 그대로 두고 Claw 삭제 내용(상태 표의 기본 전환·허브 화면 삭제, `./office` 실행, "Claw 버전에서 업데이트" 절차, 라이선스 문단)을 다시 넣음 |
| (#53 병합 커밋) | origin/main(#50·#53: `./office` 1단계 hook 검사 D30, pinned codex 시작 조건 D32) 병합. 결정 번호와 kit unit이 겹쳐 이 브랜치의 결정을 D33, unit을 U28로 바꿈(아래 "번호 바꿈") |

남긴 것(결정 2): `native-office.ts`의 Claw용 API, `operator.ts`, `runner-settings.ts`의 역할별 경로, `hub-link.ts`·`hub-outgoing.ts`의 옛 요청 흐름과 그 시험. D24 3단계 뒤 별도로 정리한다.

## 자동 검사

| 검사 | 결과 |
|---|---|
| 기준선 `3926ee2`(vendor 설치·빌드, 이 worktree) 전체 시험 | **1104/1104** exit 0, 122.6초 |
| vendor를 지운 이 worktree(`68a1f32`) 전체 시험 | **1070/1070** exit 0, 74.2초 |
| 메인 checkout 밖 새 사본(`45078a1`, `npm ci`만, vendor 없음) 전체 시험 | **1070/1070** exit 0, 77.1초. 다른 세션의 시험 프로세스가 같이 돌던 부하 상태 |
| 단순화 뒤(`948afc7`) 관련 시험 15개 파일 | **244/244** exit 0 |
| main 병합 뒤(`91d9a27`) 전체 시험 | **1070/1070** exit 0, 112.2초. 파일별 시험 수는 병합 전과 같음(#48이 바꾼 파일 이름 2개만 다름) |
| 리뷰 반영 뒤(`3bfb30a`) 전체 시험 | **1072/1072** exit 0, 117.6초(다른 세션의 전체 시험과 같이 돎). 새 시험 2개: lockfile 없는 설치(`launcher`), 켜진 Office 재사용 전 의존성 단계(`lifecycle`) |
| #51 병합 뒤(`73b15ed`) 전체 시험 | **1074/1074** exit 0, 73.5초. #51의 시험 2개가 더해짐. main(`610169e`, 1106) 대비 −32 = Claw·legacy·bridge 전용 37개 삭제 + 새 시험 5개. 타입 검사 exit 0, Story 검사기 exit 0 |
| #52·#54 병합 뒤 전체 시험 | **1074/1074** exit 0, 96.2초. #52는 문서·실측 스크립트만, #54는 `role-profiles` 시험 내용만 바꿔 시험 수가 같음. 타입 검사 exit 0, Story 검사기 exit 0(Story 변경 없음, kit 그래프 run은 그대로 `g4`) |
| #55 병합 뒤 전체 시험 | **1074/1074** exit 0, 123.1초. #55는 README만 바꿈. 타입 검사 exit 0, Story 검사기 exit 0 |
| #53 병합 뒤 전체 시험 | **1089/1089** exit 0, 74.3초(다른 세션의 시험 프로세스 하나와 같이 돎). main(`cfa323c`, 1121) 대비 −32로 앞과 같은 차이이며, #50·#53의 새 시험 15개가 모두 돈다. 타입 검사 exit 0, Story 검사기 exit 0 |
| 타입 검사(루트 `tsc`) | exit 0 (이 worktree, 새 사본, 병합 뒤) |
| Story 검사기 | exit 0 |
| `git ls-files vendor` | 0개, `.gitmodules` 없음 |
| `npm pack --dry-run` | 550개 파일, `vendor/`·`node_modules` 0개 |
| 로컬 원본 브랜치 `codex/local-original-claw-v2.0.4` | 그대로(`bc5120d`) |

### 시험 수 대조 (junit 시험 단위, 기준선 1086 → 1052)

node 기준 1104 → 1070, junit 기준 1086 → 1052로 둘 다 34개 줄었다. 파일별 차이는 아래가 전부다.

| 파일 | 기준선 → 지금 | 이유 |
|---|---|---|
| `agent-runner-patch` | 1 → 삭제 | Claw agent CRUD 경로 패치(vendor) |
| `chat-bridge` | 4 → 삭제 | `bridge` CLI와 legacy operator API |
| `claw-cli-usage` | 2 → 삭제 | Claw CLI 사용량 화면 경로(vendor) |
| `claw-host`, `claw-host-hub`, `claw-host-runners` | 2·1·1 → 삭제 | Claw 호스트 연결(`vendor/.../pazmo/host.ts`) |
| `claw-lifecycle` | 1 → 삭제 | claw 엔진 시작 |
| `oauth-client-defaults` | 3 → 삭제 | vendor OAuth 기본값 소스 검사 |
| `lifecycle` | 27 → 7 | legacy 서비스·operator CLI 시험 12개와 legacy DB 이전 시험의 버전별 실행 9개(21개) 삭제. 엔진과 무관한 경계 6개(시작·상태·정지와 데이터 보존, 포트 충돌, 재시작 데이터 재사용, 남의 SQLite 거부, 시작 중 stop, 인증 안 된 상태 파일)는 lean으로 옮김. 옛 버전 Office를 보이고 거부하고 멈추는 시험 1개 새로 |
| `lean-schema` | 15 → 16 | 메모리 DB 스키마가 파일 스키마와 같은지(외래 키 포함) |
| `delivery` | 17 → 17 | operator CLI 재시작 시험 1개를 엔진 재시작 복구 시험 1개로 바꿈 |

다른 파일은 모두 기준선과 같은 수로 통과했다. lean 스키마로 옮긴 17개 파일과 `coordinator-fixture.mjs`를 쓰는 파일도 같다.

### 재시작 복구 시험의 돌연변이 확인

`delivery.test.mjs`의 "opening the Office engine recovers what a restart interrupted"는 lean·team Office가 엔진을 여는 방식(`createNativeOffice`)으로 돌던 계획 lease, 검사 중 round, 출력 폴더가 사라진 인도를 연다. `native-office.ts`에서 아래 호출을 하나씩 지우면 모두 실패하고, 지우지 않으면 통과했다.

| 지운 호출 | 결과 |
|---|---|
| `verification.recoverInterrupted()` | 실패 |
| `execution.recoverInterrupted()` | 실패 |
| `completion.reconcileDeliveries()` | 실패(저장된 행을 직접 읽어 확인) |
| 없음 | 통과 |

## 번호 바꿈 (#53 병합, 2026-10-30)

main의 #50·#53이 먼저 D30(`./office` 1단계 hook 검사)·D32와 kit unit U25를 썼다. 이 브랜치도 D30과 U25를 쓰고 있었다.

- 결정: 이 브랜치의 결정은 **D33**이다. main 쪽에 D30이 없던 파일의 D30을 모두 D33으로 바꿨다. main의 D30이 있는 파일(`launcher.ts`, `tests/launcher.test.mjs`, main의 검증 기록 셋, 해결 문서 하나)은 그대로 뒀다. 이 브랜치의 커밋 메시지와 앞 두 kit run 증거(내용 고정)에 적힌 D30은 D33을 가리킨다.
- kit run: 이 브랜치의 run 파일을 U28로 옮겼다. 이름이 겹친 `U25-implement-result.json`·`U25-review-1.md`는 main 것을 그 자리에 두고, 이 브랜치 것은 `a6f4929`에서 꺼내 `U28-implement-result.json`·`U28-review-1.md`로 살렸다. run JSON과 결과 JSON은 경로 문자열만 바꿨다. 옮긴 두 run의 증거 해시 6개는 모두 그대로 맞는다.
- main의 1단계 hook 검사(`startupRunners`)는 `prepare()`(의존성 설치)보다 먼저 돈다. 이 검사가 띄우는 claude는 MCP 없이(`--strict-mcp-config`, 도구 없음) 돌아 `ws`가 필요한 `claude-tool-bridge.mjs`를 띄우지 않는다. launcher에서 닿는 모듈에는 `node:` 밖의 정적 import가 없어, `ws` 없이도 launcher가 로드된다.
- Story가 바뀌어(main의 D30·D32, 이 브랜치의 D33) 새 run `U28-lean-office-default-replan.json`을 만들었다. 앞 run 둘은 증거로 둔다.

## 업데이트 확인 (vendor를 설치·빌드했던 checkout)

옛 main(`3926ee2`) 사본에서 vendor를 설치(`node_modules` 540MB)하고 화면을 빌드한 뒤 이 브랜치(`45078a1`)로 옮겼다.

- `git status --porcelain`이 비어 있었다. 남은 `vendor/`는 무시된다(`!! vendor/`).
- 루트 의존성 없이 `start`: `NOT_INSTALLED` "Office 의존성이 설치되지 않았습니다. ./office 로 설치하세요(업데이트 뒤 첫 실행은 npm 레지스트리 접속이 필요합니다)."
- `npm ci --omit=dev --prefer-offline`: 패키지 1개(`ws`)만 설치.
- 그 뒤 옵션 없는 `start`는 lean으로 켜지고 `status`·`stop`이 동작했다.
- 데이터 폴더의 `claw/`(가짜 `claw.sqlite`와 로그)는 `start`·`stop` 뒤 해시와 수정 시각이 같았다. `lean/`만 새로 생겼다.
- (`45078a1` 기준) 켜진 lean Office(잠긴 미리보기)와 루트 `node_modules`가 없는 상태에서 `up --no-open`은 `ws`를 먼저 설치한 뒤 `RUNNING`으로 거부했다. 단순화 리뷰가 거부될 요청에 설치하는 낭비를 지적해 `948afc7`에서 순서를 바꿨고, 아래처럼 다시 확인했다.

### 켜진 Office를 다시 쓸 때 (`91d9a27`, 루트 `node_modules` 없는 새 사본)

`/__pazmo/status`에 답하는 가짜 제어 서버와 lean 상태 파일로 켜진 Office를 흉내 내고 `up --no-open`을 실행했다(`scratchpad/check-up-reuse.mjs`, 저장소 밖 스크립트).

| 켜진 Office | `up` | `ws` |
|---|---|---|
| 실행 가능(`execution: ready`) | exit 0, 그 Office를 다시 씀(로컬 세션 주소), 정지 호출 없음 | 설치함 |
| 잠긴 미리보기(`execution: locked`) | `RUNNING`으로 거부, 정지 호출 없음 | 설치하지 않음 |

## `claw` 문자열이 남은 곳

`git grep -i claw -- src tests bin scripts package.json tsconfig.json`의 남은 줄은 모두 아래 넷 중 하나다. vendor 경로나 import는 없다.

| 분류 | 위치 |
|---|---|
| `--claw` 거부(`CLAW_REMOVED`)와 그 시험 | `src/cli/index.ts`, `tests/lean-lifecycle.test.mjs`, `tests/team-lifecycle.test.mjs` |
| 옛 상태 파일(`claw`·`legacy`)과 `claw/` 데이터 보존 | `src/cli/lifecycle.ts`, `src/runtime/lean-service.ts`, `tests/lifecycle.test.mjs`, `tests/launcher.test.mjs`, `tests/lean-lifecycle.test.mjs`, `tests/lean-schema.test.mjs` |
| 남긴 엔진 코드(결정 2) | `src/runtime/native-office.ts`, `live.ts`, `runner-settings.ts`, `src/core/runner-evidence.ts`, `tests/live-runtime.test.mjs`, `tests/native-office.test.mjs`, `tests/role-agents-fixture.mjs`, `tests/runner-qualification.test.mjs` |
| 이 PR이 고치지 않은 기존 주석 | `src/lean/office.ts`, `src/lean/server.ts`, `src/lean/schema.ts`(머리 주석), `tests/store.test.mjs` |

## 예상된 동작 (회귀 아님)

- `exec-relay.ts`·`claude-tool-bridge.mjs`가 `BOUNDARY_DIGEST`에 들어가므로, 업데이트 뒤 첫 역할 실행 전에 실행기 자격 검사가 한 번 다시 돈다.
- `node:sqlite`의 `DatabaseSync`는 기본으로 `foreign_keys=1`이다. 메모리 DB 시험도 외래 키를 검사한다.

## 확인하지 못한 것

- **app-be 실제 확인(V17)**: `./office`(옵션 없음)로 작업 하나를 기획→G1→구현→리뷰(다른 실행기)→G4→인도까지 돌리는 확인은 하지 않았다. 사용자 Office와 실제 구독 실행이 필요하다.
- `up`의 VM·실행기 준비 단계 전체는 이번에 돌리지 않았다(위 확인은 재사용 판단에서 멈춤).
- 사전 확인 두 개(app-be Claw Office의 진행 중 작업, OpenShift 허브의 진행 중 요청)는 사용자에게 묻는다.
- 다른 사람 PC, 네트워크가 없는 PC에서의 첫 실행.

## 독립 리뷰 (2026-10-30, `ce-code-review mode:agent`, 보고만)

리뷰어: correctness, security, adversarial(세션 모델), testing, maintainability, project-standards, reliability, agent-native, learnings. Codex 교차 모델 adversarial: 지적 0건. security: 지적 0건.

| # | 지적 | 처리 |
|---|---|---|
| 1 | P2 · 켜진 Office를 다시 쓰기 전 의존성 단계에 자동 시험이 없음(testing·adversarial 75, 다른 리뷰어 넷의 testing gap) | `up(options, prepare)` 주입점과 `reuseOrStart` 하나로 묶음. 새 시험: 다시 쓰면 한 번, 거부·실패면 안 쓰고 안 멈춤. 돌연변이 2개(단계 삭제, 두 번 실행) 모두 실패로 잡음 |
| 2 | P2 · 재시작 시험이 "정상 인도는 그대로"를 확인하지 않음(adversarial 75) | 같은 시험에서 온전한 인도로 엔진을 한 번 열어 delivered·done을 확인한 뒤 출력 폴더를 지우고 다시 연다 |
| 3 | P2 · kit 그래프 run이 최종 Story와 다름(project-standards 75) | 기록이 없던 run을 지우고 새로 만든다(아래 그래프) |

낮은 우선순위로 같이 고친 것: `npm ci --ignore-scripts`, lockfile 없는 설치의 가드, 설치할 때만 `[1/4]` 안내, 지운 명령의 `COMMAND_REMOVED`, `NOT_INSTALLED`의 `npm ci --omit=dev` 안내, `doctor`·옛 operator 파일 정리 단언, `ws` static import(시험·탐침), lean 주석의 Claw 언급, AGENTS.md "Agents and Office"(agent는 사람 대신 Decisions에 답하지 않는다), README의 한 checkout 여러 Office 안내, 이력 문서 안내, `upstream/`의 마지막 소스 커밋.

기록만 한 위험:

- `npm ci`는 받기 전에 `node_modules`를 지운다. 나중에 `ws` lock을 올릴 때 레지스트리 접속이 없으면 다시 쓰는 Office가 `ws` 없이 남는다(이번 업데이트는 루트에 원래 `node_modules`가 없어 해당 없음).
- 한 checkout에서 `up` 두 개가 동시에 설치하면 경쟁한다(잠금 없음).
- `dependenciesInstalled()`는 CJS 해석(상위 폴더·`NODE_PATH`)이라 서비스의 ESM import와 드물게 어긋날 수 있다.
- "3초 안에 켜짐"은 lean만 잰 값이고 team(repo 수만큼 엔진)은 재지 않았다.
- 허브 웹은 아직 요청 "내가 맡기"를 보인다. 수락해도 실행하는 Office가 없다(후속).
- 채팅 조작 재개(새 Office의 operator API)는 별도 G3이며, 그때 사람만 답하는 게이트를 API 호출자와 구분할 방법을 정해야 한다.

### 정리할 오래된 해결 문서 (머지 뒤 `/ce-compound-refresh`)

`test-failures/fresh-worktree-tests-fail-without-office-ui-build.md`(이제 `npm ci`와 `NOT_INSTALLED`), `test-failures/claw-startup-wait-is-cpu-bound-under-load.md`(측정 방법은 남김), `test-failures/node-test-after-hook-order-orphans-detached-office.md`(`pgrep` 패턴), `security-issues/claw-cli-usage-panel-reads-cli-login-credentials-under-office.md`, `integration-issues/decode-route-ids-before-prefix-dispatch.md`, `integration-issues/report-changed-hub-certificate-on-cert-signature-failure.md`, `integration-issues/report-planning-runner-failure-separately.md`, `integration-issues/classify-review-runner-failure-as-unknown.md`, `ui-bugs/match-light-theme-remapped-classes.md`, `ui-bugs/use-in-page-dialogs-not-native-confirm.md`(검사 대상을 `src/lean/web`으로), `ui-bugs/preserve-intake-drafts-and-server-state.md`(채팅 부분만), `architecture-patterns/pin-bounded-role-instructions.md`, 그리고 이 문서들을 가리키는 `workflow-issues/redeploy-team-hub-to-openshift-from-fresh-bundle.md`, `test-failures/mock-the-controller-clock-in-stop-tests.md`의 링크.

