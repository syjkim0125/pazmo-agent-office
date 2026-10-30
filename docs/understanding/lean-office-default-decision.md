# G3 proposal: 새 Office를 기본으로, Claw Empire 삭제 (D23 3단계)

Status: Approved
Understanding gate (G3): user conversation · 2026-10-30 · Check-in: accepted ("A로 해", 설명 페이지 게시 후)
Story: pazmo-agent-office-contract.md (Goal; M1·M2·M3·M7·M9·M10·M13·M14·M15; O2; V1·V7·V8·V11·V12·V15·V16·V17; D23 3단계)
Builds on: lean-office-decision.md (D23), team-story-board-decision.md (D24). 설명 페이지: https://claude.ai/artifact/M6pQbDBvwYCuxLB5dxxqHc

## 요청

D23은 Claw Empire를 없애는 일을 네 단계로 나눴다. 이 문서는 3단계다: 새 Office를 기본으로 바꾸고, Claw Empire(`vendor/claw-empire`)를 지우고, Story의 Goal·M1·M3·M7·O2를 정리한다. 1단계(`--lean`)는 끝났고, 2단계(팀 허브 화면)는 D24(팀 Story 보드)로 바뀌어 진행 중이다.

이 문서는 계획만 한다. 사용자가 G3를 승인하기 전에는 아무것도 지우지 않는다.

## 지금 상태 (조사 근거, main `3926ee2`)

### 엔진 네 개

| 엔진 | 켜는 법 | 화면 | vendor 필요 |
|---|---|---|---|
| claw | `./office` 기본(`src/cli/launcher.ts:327`), `start --claw` | Claw 원본 화면 | 서버·화면·tsx 전부 |
| legacy | `start` 기본(`src/cli/index.ts:459`) | Claw 빌드 화면을 읽기 전용으로 | Claw DB 스키마·seed·빌드 화면(`src/runtime/service.ts:26-27,255`) |
| lean | `--lean` | Tasks·작업 상세·Decisions·Agents | `ws`만 |
| team | `--team` | 없음(D24 5단계) | `ws`만 |

### Claw Empire가 저장소에서 차지하는 것

- `vendor/claw-empire`: 추적 파일 708개(42MB), 설치하면 의존성 540MB다. Pazmo가 고친 vendor 파일은 107개다(호스트 연결, 화면).
- 하위 모듈 gitlink 2개(`.gitmodules`: playwright-mcp, ppt_team_agent).
- 원본 그대로의 가져오기 커밋은 로컬 브랜치 `codex/local-original-claw-v2.0.4`에만 있다(push 금지, D4).
- 출처 기록: `upstream/claw-empire.lock.json`·`upstream/CHANGES.md`, `LICENSING.md`·`THIRD_PARTY_NOTICES.md`의 Claw 항목(Apache-2.0).

### lean·team이 아직 vendor에서 빌려 쓰는 것

1. **`ws`**: VM 실행 중계(`src/runners/exec-relay.ts:6-10`, WebSocket 서버)와 claude 도구 다리(`src/runners/claude-tool-bridge.mjs:8-10`, 클라이언트)가 vendor의 `ws`를 읽는다. 그래서 `./office --lean`·`--team`도 1단계에서 vendor 전체를 `pnpm install`한다(`src/cli/launcher.ts:190-221`).
2. **타입 검사**: `npm run typecheck`가 vendor의 `tsc`를 쓰고, `tsconfig.json`의 `typeRoots`가 vendor `@types`를 가리킨다.
3. **시험**: 시험·스크립트 26개 파일이 Claw DB 모양을 만들려고 vendor의 `applyBaseSchema`(일부는 `applyDefaultSeeds`)를 부른다. 그 파일들에 시험 약 260개가 있다. lean 실행 자체는 자기 스키마(`src/lean/schema.ts`)를 쓰고 vendor 스키마를 부르지 않는다.

### Claw(또는 legacy)에서만 도는 것

| 기능 | 어디서 | lean에서 |
|---|---|---|
| Claw 서버·화면, tsx 변환, 시작 대기 120초, 화면 빌드 | `src/runtime/claw-service.ts`, `src/cli/lifecycle.ts:96-116,229-235`, launcher 화면 빌드 | 없음 |
| legacy 미리보기, operator API·페이지 | `src/runtime/service.ts`, `operator.ts`, `operator-page.ts`, `observation.ts` | 없음 |
| 채팅 bridge와 operator CLI(`bridge`, `contract`, `intake-*`, `approval-*`, `verification`, `delivery`, `deliver`, `contracts`, operator key) | `src/cli/bridge.ts`, `src/cli/index.ts` | `UNSUPPORTED`(`src/cli/lifecycle.ts:436`) |
| Office의 허브 요청: 보내기·취소·받은 요청 Inbox·수락된 요청 실행(D16–D18·D22) | Claw 화면 + `claw-service.ts:51-61`만 허브 연결을 켬 | 허브 연결을 켜지 않음 |
| 역할 캐릭터(M13), 픽셀 사무실(M7), 캐릭터 채팅 | Claw 화면 | 없음 |
| `doctor`의 `uiBuilt` | `src/cli/index.ts:446` | 의미 없음 |

허브 서버(`src/hub`, Fusion 배포)는 vendor를 쓰지 않는다. 허브 웹의 요청 게시판은 그대로 남는다.

## 팀 Story 보드(D24) 3–5단계가 엔진에서 필요한 것

| 단계 | 쓰는 것 |
|---|---|
| 3 Story Task 모드 | repo별 lean 엔진(`createLeanOffice` → `createNativeOffice`), `src/core` 장부(intake·handoffs·completion·delivery), VM 중계(`ws`), agent별 실행기(`chooseRunner`). `native-office.ts`와 `src/core`를 고친다 |
| 4 PL planning | `src/runners/kit-planning.ts`·`planning-coordinator.ts`. 이 시험들도 지금 vendor 스키마를 부른다 |
| 5 화면 | `src/lean/web`(빌드 없는 HTML). vendor와 무관 |

어느 단계도 Claw 화면, legacy, tsx, 채팅 bridge를 쓰지 않는다. 그래서 삭제가 보드를 막지 않으려면 네 가지만 지키면 된다.

1. `ws`를 계속 읽을 수 있어야 한다.
2. 엔진 시험이 vendor 없이 같은 범위로 계속 돌아야 한다.
3. 3단계에서는 `native-office.ts`와 `src/core`를 리팩터링하지 않는다. D24 3단계가 고칠 곳이라 충돌한다.
4. `src/runtime/hub-link.ts`를 남긴다. 팀 Office가 `readLinkConfig`를 쓴다(`src/team/office.ts:8`).

## 사용자에게 보이는 변화 (삭제가 끝난 뒤)

| 지금 | 3단계 뒤 |
|---|---|
| `./office` → Claw Office | `./office` → 새 Office(Tasks·작업 상세·Decisions·Agents) |
| `./office --lean` | 같은 동작. 옵션은 받아들이고 아무 일도 하지 않는다 |
| `--claw` | "Claw Office는 지웠습니다. 새 Office는 `./office`로 켭니다" 오류 |
| `start`(옵션 없음) → legacy 미리보기 | `start` → 새 Office |
| 채팅 bridge·operator CLI | 없다. 작업·답·승인은 Office 화면에서 한다 |
| Office에서 허브 요청 보내기·받기·취소 | 없다. 허브 웹 게시판은 남는다. 팀 협업은 D24 보드가 대신한다 |
| Claw 데이터 `<dataDir>/claw/` | 남는다. 읽지도 지우지도 않는다 |
| `up` 1단계: vendor 설치 540MB, 화면 빌드 | 루트 의존성 설치(`ws` 하나) |
| claw 시작 120초 대기, 부하에서 흔들리던 claw 시험 2개 | 없다 |

## 결정할 것: 순서 (G3 질문)

세 안 모두 끝 상태는 같다. 다른 것은 순서와 Claw를 언제까지 되돌아갈 길로 두느냐다.

### A안. 한 번에

PR 하나로 기본 전환과 삭제를 함께 한다.

- **비용:** 파일 700개 이상 삭제와 시험 약 35개 파일 수정을 한 번에 리뷰한다. 머지 뒤 문제가 나면 되돌리기가 전부 아니면 전무다. 중간에 Claw로 돌아갈 길이 없다.
- **얻는 것:** 가장 빨리 끝난다. G4가 한 번이다.

### B안. 세 걸음, 연달아 (추천)

PR 세 개를 순서대로 머지한다.

1. **분리(동작 불변):** `ws`·TypeScript를 루트 의존성으로 옮기고, 엔진 시험을 vendor 스키마 대신 lean 스키마로 돌린다. Claw는 그대로 돈다.
2. **기본 전환:** `./office`의 기본을 새 Office로 바꾼다. `--claw`는 "곧 지웁니다" 안내와 함께 계속 동작한다.
3. **삭제:** eevee-be에서 `./office`(옵션 없음)로 작업 한 번을 끝까지 돌려 본 뒤, vendor·claw·legacy·채팅 bridge·문서를 지우고 Story를 고친다.

- **비용:** 리뷰와 G4가 세 번이다. 2와 3 사이 며칠 동안 Claw를 계속 맞춰야 한다.
- **얻는 것:** 걸음마다 따로 되돌릴 수 있다. 1이 끝나면 D24 3단계는 vendor 없이 시작할 수 있다. 3 전에 새 Office를 기본으로 실제로 써 본다.

### C안. 전환은 지금, 삭제는 팀 보드 뒤

B안의 1·2는 지금 하고, 3(삭제)은 D24 5단계(화면)까지 끝나 팀 보드를 실제로 쓸 수 있을 때 한다.

- **비용:** 그동안(몇 주) vendor 설치 540MB, claw 120초 대기, claw 시험을 유지한다. D24 3단계가 `native-office.ts`를 고칠 때마다 Claw 쪽 시험도 통과시켜야 한다(두 화면 유지).
- **얻는 것:** 보드가 될 때까지 `--claw`로 옛 허브 요청 흐름, 채팅, Claw 화면을 쓸 수 있다. 지금 Fusion 허브의 요청 흐름을 실제로 쓰는 팀원이 있으면 이 안이 맞다.

### 추천 이유

D24에서 사용자는 보내기·수락·거절을 보드로 대체하고 "기존 기능과 일정은 맞추지 않는다"고 정했다. 그러니 옛 요청 흐름을 몇 주 더 지킬 이유는 약하다(C안의 이득). 반대로 A안은 되돌리기 단위가 너무 크다. B안은 1단계만으로도 D24 3단계의 걸림돌(vendor 스키마 시험, vendor `ws`)을 먼저 치운다.

## 함께 정하는 것 (기본값, 바꾸려면 말해 주세요)

1. **legacy 엔진·채팅 bridge·operator CLI도 지운다.** ASSUMED. legacy는 vendor 스키마와 Claw 빌드 화면 없이는 돌지 않는다. bridge와 operator CLI는 legacy·claw에서만 동작한다. 새 Office에 operator API를 붙여 채팅 조작을 살리는 일은 새 기능이라 이 범위 밖이다(원하면 별도 G3). 같이 고칠 것: `AGENTS.md`의 "Chat-controlled Office" 절, `docs/CHAT-CONTROL.md`, Story M2.
2. **엔진 코드는 정리하지 않는다.** ASSUMED. `native-office.ts`의 Claw용 API(채팅, `hub*`, `officeRoles`, `handle`→`operator.ts`, 방송), `runner-settings.ts`의 역할별 실행기 경로, `hub-link.ts`·`hub-outgoing.ts`의 옛 요청 흐름은 쓰는 곳이 없어지지만 남긴다. vendor를 부르지 않으므로 지울 필요가 없고, 지우면 D24 3단계와 충돌한다. D24 3단계가 머지된 뒤 별도 정리 작업으로 지운다.
3. **`ws`는 루트 의존성으로 둔다.** ASSUMED. 루트 `package.json`에 `ws` 8.19.0(지금 vendor가 쓰는 버전), 개발 의존성에 `typescript` 5.9.3·`@types/node` 24.10.13·`@types/ws` 8.18.1을 넣고 `package-lock.json`을 만든다. `up`은 `npm ci --omit=dev`를 한다. 4단계(npm 설치)와도 맞는다. 대안: `ws` 소스 복사(라이선스 고지 추가), 직접 만든 WebSocket 서버(VM 중계는 보안 경계라 새 프로토콜 코드를 쓰지 않음).
4. **옵션 호환.** ASSUMED. `--lean`은 계속 받아들인다(문서·습관 호환). `--claw`는 2걸음째에 안내와 함께 동작하고, 삭제 뒤에는 이유와 새 명령을 알려 주는 오류다.
5. **Story 정리 범위를 넓힌다.** D23은 Goal·M1·M3·M7·O2만 꼽았다. 조사해 보니 M2(채팅 host), M9·M10·M14(Office의 허브 요청 화면), M13(역할 캐릭터)도 Claw 화면에만 있다. 아래 수정안대로 고친다.
6. **출처 기록은 이력으로 남긴다.** ASSUMED. `upstream/claw-empire.lock.json`·`CHANGES.md`는 지우지 않고 "삭제된 커밋"을 적는다. `THIRD_PARTY_NOTICES.md`·`LICENSING.md`의 Claw 항목은 "이전 버전에 포함됐다"로 고친다. `package.json`의 `MIT AND Apache-2.0`은 그대로다(`assets/codex`가 Apache-2.0). README의 Claw 원본 화면 그림은 뺀다.
7. **오래된 해결 문서.** 삭제 뒤 `docs/solutions`의 `claw-startup-wait-is-cpu-bound-under-load.md`, `fresh-worktree-tests-fail-without-office-ui-build.md`, `claw-cli-usage-panel-reads-cli-login-credentials-under-office.md`를 `/ce-compound-refresh`로 정리한다.

## 무엇이 되돌릴 수 없나

- **git 안에서는 되돌릴 수 있다.** 삭제는 보통 커밋이고 `git revert`로 돌아온다. 이력 재작성과 강제 push는 하지 않는다. 원본 그대로의 가져오기는 로컬 브랜치 `codex/local-original-claw-v2.0.4`에 남는다.
- **사용자 데이터는 건드리지 않는다.** `claw/`, `lean/`, `team/`, 허브 DB 모두 그대로다.
- **실제로 되돌리기 어려워지는 것:**
  - D24 3단계가 삭제 뒤의 코드 위에 쌓이면, Claw를 다시 살릴 때 그 변경을 Claw에 다시 맞춰야 한다. 시간이 갈수록 비싸진다.
  - 옛 Claw 작업·결정 기록은 화면으로 볼 수 없다. 파일은 남아 있어 옛 버전을 꺼내면 볼 수 있다.
  - 허브에서 이미 수락돼 어떤 Office가 맡고 있는 요청은 그 Office가 더 이상 받지 않는다. 그래서 삭제 전에 확인한다(아래 사전 확인).

## 절대 일어나면 안 되는 것

- 사용자 데이터(`claw/`, `lean/`, `team/`, 허브)의 삭제·이동·변환
- `codex/local-original-claw-v2.0.4`의 push나 삭제, 이력 재작성, 강제 push
- lean·team 엔진 동작의 변화: 결정·격리·검증·인도 규칙, `127.0.0.1` 경계, M4의 잘못된 완료 차단
- 엔진 시험이 말없이 줄어드는 것. 지우는 시험은 하나씩 이유(Claw·legacy·bridge 전용)를 적는다. 엔진과 무관한 경계 시험은 lean으로 옮긴다(아래)

## 순서 (B안 기준)

### 1걸음 — 분리 (동작 불변)

1. 루트 의존성(`ws`, TypeScript, 타입)과 `package-lock.json`. `typecheck` 스크립트와 `tsconfig.json`의 `typeRoots`를 루트로.
2. `exec-relay.ts`와 `claude-tool-bridge.mjs`가 루트의 `ws`를 읽는다.
3. 시험용 스키마: lean 스키마를 메모리 DB에도 적용할 수 있게 하고(예: `applyLeanSchema(db, project)`), vendor 스키마를 부르는 시험 파일 19개 중 17개와 `coordinator-fixture.mjs`를 옮긴다. 남는 둘은 Claw 전용 `agent-runner-patch`와 legacy의 `lifecycle`이며 3걸음에서 다룬다. Claw seed(부서·역할 agent)에 기대던 단언은 lean 모양(부서 없는 agent)에 맞게 고치고, 고친 단언은 리뷰에 따로 보인다. `claude-tool-bridge` 시험의 `ws` 경로도 바꾼다. `scripts/`의 시험·탐침 스크립트 6개도 옮기거나, 쓰지 않으면 지운다.
4. `up --lean`·`--team`의 1단계가 vendor 대신 루트 의존성을 설치한다. claw는 지금처럼 vendor를 설치한다.

### 2걸음 — 기본 전환

1. `./office`의 기본 엔진을 lean으로. `--lean`은 받아들이고, `--claw`는 안내와 함께 동작한다.
2. `start`의 기본(legacy)은 3걸음까지 그대로 둔다. 사람이 쓰는 명령은 `./office`이고, legacy를 지우는 일은 3걸음이다.
3. README(영·한)·`docs/LOCAL-PREVIEW.md`의 "기본은 Claw Office" 문구를 고친다.

### 3걸음 — 삭제

사전 확인(사용자):

- eevee-be의 Claw Office에 진행 중이거나 결정 대기 중인 작업이 없다.
- Fusion 허브에 수락돼 진행 중인 요청이 없다. 있으면 끝내거나 취소한다.

그다음:

1. `vendor/claw-empire`, `.gitmodules`, `build:office` 스크립트를 지운다.
2. `claw-service.ts`, legacy(`service.ts`, `operator-page.ts`, `observation.ts`), `bridge.ts`, operator CLI 명령, `lifecycle.ts`의 claw·legacy 항목(`SERVICE`, `STARTUP_MS`, tsx 로더), `vendorInstalled`, launcher의 화면 빌드, `doctor`의 `uiBuilt`를 지운다. `start` 기본은 lean이 된다.
3. 시험:
   - 지운다(Claw·legacy·bridge 전용): `claw-lifecycle`, `claw-host`, `claw-host-hub`, `claw-host-runners`, `claw-cli-usage`, `agent-runner-patch`, `oauth-client-defaults`, `chat-bridge`, `lifecycle`의 operator CLI 시험
   - lean으로 옮긴다(엔진과 무관한 경계): `lifecycle`의 포트 충돌, 남의 SQLite 거부·보존, 시작 중 stop 거부, 인증 안 된 상태 파일이 남의 프로세스를 멈추지 않음, 재시작 시 같은 데이터 재사용
   - 고친다: `launcher`, `lean-lifecycle`(다른 엔진 거부), `lean-schema`, `team-lifecycle`, `team-registry`, `live-runtime`
4. 문서: README(영·한), `docs/LOCAL-PREVIEW.md`, `docs/CHAT-CONTROL.md`(폐기 안내만 남김), `AGENTS.md`의 "Chat-controlled Office" 절, `CONCEPTS.md`, `LICENSING.md`, `THIRD_PARTY_NOTICES.md`, `upstream/` 메모, `docs/STATUS.md`
5. Story 수정(아래)과 D30

## Story 수정안 (A안: 같은 PR에서 적용)

| 항목 | 지금 | 바꿈 |
|---|---|---|
| Goal | Claw-Empire의 UI·서버를 기본으로 쓰고, 채팅으로 일을 맡긴다 | 새 최소 Office(Tasks·작업 상세·Decisions·Agents)에서 일을 만들고 결정한다. kit가 역할별 절차, Office가 큐·격리·승인 기록을 맡는다. 나머지 문장(실패·미검증은 완료 아님, 실제·모의 증거 구분)은 유지 |
| M1 | Claw 원본을 보존해 가져온다 | Claw 원본은 git 이력, 로컬 원본 브랜치, `upstream/` 출처 기록으로만 남는다. 현재 트리와 배포물에는 Claw 코드·gitlink·빌드 단계가 없다. 사용자 데이터(옛 `claw/` 포함)는 지우거나 옮기지 않는다 |
| M2 | 신뢰된 채팅 host에서 요청·답·승인을 전달 | 사람이 Office 화면에서 작업을 만들고 질문에 답하고 승인·취소한다. Jira 없는 Story→G1→실행→검토→G4→인도와 키 입력 없음은 유지 |
| M3 | PM·Lead·Engineer·Reviewer 역할 운영, Designer·DevOps 조건부 | 사람이 만든 agent가 작업을 맡는다. 기획·설계·구현은 agent의 작업 실행기, 리뷰는 리뷰 실행기로 돈다. 공식 CLI 구독 로그인, 단일 큐, 자동 수정 2회 제한, 역할별 권한은 유지 |
| M7, M9, M10, M13, M14 | 픽셀 화면, Office의 허브 요청 보내기·취소·받기, 역할 캐릭터 | 폐기. 번호는 다시 쓰지 않는다 |
| M8 (승인 뒤 찾음) | 수락한 요청을 자기 Office에서 실행, G4·인도도 자기 Office | 허브 쪽(초대, 팀원·레포·담당자, 요청 게시판, 허브는 실행·로그인·인도물이 없음, Office의 `127.0.0.1` 경계)만 남긴다. Office가 허브 요청을 받아 실행하던 부분은 claw 엔진만 했으므로 빠진다. 허브 일의 실행은 M16 |
| M12 (승인 뒤 찾음) | Office 상단 팀 허브 창에 붙여넣어 터미널 없이 연결 | 연결 문자열(팀원 단위 일회용)·origin으로 레포 찾기·자동 등록·담당자 아님 거부는 남기고, 연결은 `hub-link --connect`로 한다. 상단 창은 Claw 화면에만 있었다 |
| M15 | `--lean` 옵션으로 켠다 | `./office`의 기본 Office다(`--lean`은 호환용) |
| O2 | 다른 Office 재선정 … 별도 작업 관리 UI 추가 제외 | "다른 Office 재선정"을 뺀다. kit 원본 변경, API 키 자동 대체, 요청하지 않은 기능 추가 제외는 유지 |
| V1 | 가져오기 SHA·tree·gitlink 비교 | `git ls-files vendor`가 비고 `.gitmodules`가 없으며, 로컬 원본 브랜치가 남고, 사용자 데이터가 그대로인 것을 확인 |
| V7, V11, V12, V15, V16 | 위 폐기 항목의 검증 | 폐기 |
| V9, V10, V14 (승인 뒤 찾음) | 역할별 선택, Office 실행이 낀 허브 흐름, Office 연결 창 | agent별 선택, 허브 쪽 시험과 남은 엔진 코드 시험, `hub-link --connect` |
| V8 | 원본 TaskBoard·서버·WebSocket 사용 | 새 Office의 Tasks·Decisions, 키 입력 없는 로컬 세션, kit 역할 run 연결, 검증된 VM 실행, 사용자 승인 뒤 인도 |
| V17 | `up --lean`으로 실제 확인 | `./office`(옵션 없음)로 실제 확인 |
| D30 | 없음 | 이 결정(선택한 안, 폐기한 M/V, 남긴 엔진 코드, 사전 확인) |

## 검증 계획

걸음마다:

- 전체 root 시험 N/N(한 번에 하나만 돌림), 타입 검사 exit 0, Story 검사기 exit 0
- 보고만 하는 독립 리뷰 1회, G4

1걸음:

- vendor 의존성을 설치하지 않은 새 worktree에서 루트 `npm ci`만으로 lean·team·엔진 시험과 타입 검사가 통과한다.
- 옮긴 시험의 개수가 옮기기 전과 같다.
- `up --lean`이 vendor 설치 없이 켜진다.

2걸음:

- launcher 시험: 옵션 없으면 lean, `--lean` 같음, `--claw` 안내 후 동작
- eevee-be 실제 확인: `./office`(옵션 없음)가 기존 lean 데이터로 열리고, `claw/` 파일의 해시가 그대로다.

3걸음:

- `git ls-files vendor`가 0개, `.gitmodules`가 없다.
- `git grep -i claw -- src tests bin scripts package.json tsconfig.json`에 의도한 것(`--claw` 오류 안내)만 남는다.
- 지운 시험 목록과 이유, lean으로 옮긴 경계 시험의 통과
- `npm pack --dry-run` 파일 목록에 vendor가 없다.
- eevee-be 실제 확인: 새로 받은 checkout에서 `./office --project`로 작업 하나를 기획→G1→구현→리뷰(다른 실행기)→G4→인도까지 돌리고(V17), `claw/` 해시가 그대로다.
- 사전 확인 두 개(진행 중 Claw 작업 없음, 허브 진행 중 요청 없음)의 기록

그래프: G3 승인 뒤 `ce-plan`으로 구현 계획을 쓰고, 걸음마다 kit 그래프 run(`.ai-workflow/runs/U25-…`)을 만든다.

## 사람의 결정

2026-10-30 사용자는 설명 페이지와 G3 질문(A·B·C, 기본값 1–5)을 받은 뒤 "A로 해"라고 답했다. 이 답이 G3 승인이다.

- **A안(한 번에)을 골랐다.** "순서"의 1–3걸음을 PR 하나에서 한다. 2걸음의 `--claw` 안내 기간은 없고, `--claw`는 바로 안내 오류가 된다.
- "함께 정하는 것" 1–7은 바꾸지 않았다(질문에는 1–5를 적었고 6–7은 이 문서에 있다).
- 3걸음의 사전 확인 두 개(eevee-be의 진행 중 Claw 작업, Fusion 허브의 진행 중 요청)는 머지 전 G4에서 사용자에게 묻는다.
- 승인 뒤 구현 준비 중 M8·M12와 V9·V10·V14도 Claw 화면이나 claw 엔진에 기댄다는 것을 찾았다. 승인한 동작(Office의 허브 요청 보내기·받기 사라짐, Claw 화면 삭제)에서 나온 문구 정리라 위 Story 수정안에 더하고 D30에 ASSUMED로 적는다. G4에서 함께 확인한다.

## 승인 범위

- **승인하는 것:** A안, "함께 정하는 것" 1–7, Story 수정안, 검증 계획
- **승인하지 않는 것:** 4단계(npm 설치), 새 Office의 operator API·채팅 조작, 엔진 코드 정리(D24 3단계 뒤 별도), 사용자 데이터 정리·이관, main 머지(걸음마다 사용자가 한다)
