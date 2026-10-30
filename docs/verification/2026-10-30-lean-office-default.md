# 검증 기록: 새 Office 기본 전환과 Claw Empire 삭제 (D30)

- 결정: [lean-office-default-decision.md](../understanding/lean-office-default-decision.md) (G3 2026-10-30, A안 "A로 해")
- 계획: [2026-10-30-1500-feat-lean-office-default-plan.md](../plans/2026-10-30-1500-feat-lean-office-default-plan.md)
- Story: D30, M1·M2·M3·M8·M12·M15, V1·V8·V9·V10·V14·V17
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

남긴 것(결정 2): `native-office.ts`의 Claw용 API, `operator.ts`, `runner-settings.ts`의 역할별 경로, `hub-link.ts`·`hub-outgoing.ts`의 옛 요청 흐름과 그 시험. D24 3단계 뒤 별도로 정리한다.

## 자동 검사

| 검사 | 결과 |
|---|---|
| 기준선 `3926ee2`(vendor 설치·빌드, 이 worktree) 전체 시험 | **1104/1104** exit 0, 122.6초 |
| vendor를 지운 이 worktree(`68a1f32`) 전체 시험 | **1070/1070** exit 0, 74.2초 |
| 메인 checkout 밖 새 사본(`45078a1`, `npm ci`만, vendor 없음) 전체 시험 | **1070/1070** exit 0, 77.1초. 다른 세션의 시험 프로세스가 같이 돌던 부하 상태 |
| 단순화 뒤(`948afc7`) 관련 시험 15개 파일 | **244/244** exit 0 |
| main 병합 뒤(`91d9a27`) 전체 시험 | **1070/1070** exit 0, 112.2초. 파일별 시험 수는 병합 전과 같음(#48이 바꾼 파일 이름 2개만 다름) |
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
