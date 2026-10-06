# 사용자 설치 codex·claude 실행기와 역할별 모델 선택 — 검증 기록

Scope: U8, Story M3/M4, V3/V4/V9, D15.
- G3: [cli-runner-selection-decision.md](../understanding/cli-runner-selection-decision.md) (2026-10-02 승인).
- Plan: [2026-10-02-1747 plan](../plans/2026-10-02-1747-feat-cli-runner-selection-plan.md).

이 기록은 G4나 전체 Story 완료를 주장하지 않는다. 커밋 전 작업 트리 기준이다.

## 무엇이 바뀌었나

- **실행기 탐색:**
  - PATH와 알려진 위치(`~/.bun/bin`, `/opt/homebrew/bin` 등)에서 codex·claude를 찾는다.
  - npm/bun JS 런처는 실행하지 않고 네이티브 Mach-O 바이너리로 해석한다.
  - 로그인 여부는 `codex login status`(stderr 출력)와 `claude auth status`로만 확인한다.
  - Office 서비스 프로세스는 HOME/PATH가 격리되어 있다. 그래서 신뢰된 시작 단계가 사용자 home·PATH를 `LiveConfig.userHome/searchPath`로 넘긴다.
- **모델 목록:**
  - codex: `codex debug models --bundled`. 네트워크·계정·사용자 설정 없이 얻는다.
  - claude: SDK `initialize` 응답. 모델 턴 없이 얻는다.
- **(바이너리 SHA, 모델, executor SHA)별 로그인 없는 검사:**
  - 가짜 로컬 모델 서버가 실제 VM 컨테이너의 도구 실행을 확인한다. 통과 기록만 0600으로 캐시한다.
  - 실행 직전 SHA를 다시 확인한다.
- **claude 실행:**
  - 내장 도구 없음(`--tools ""`). Office MCP 도구 다리 하나만 쓴다. 다리는 같은 exec relay로만 전달한다.
  - 사용자 설정 소스를 쓰지 않는다(`--setting-sources ""`, `--strict-mcp-config`).
  - 매 실행 `system/init`를 검사한다(도구·MCP·`@builtin` 이외 플러그인·스킬·훅, live에서는 `apiKeySource:none`).
  - 출력은 기존 단일 turn 형식으로 바꾼다.
- **선택·저장:**
  - 역할 에이전트의 `cli_provider/cli_model/cli_reasoning_level`에 저장한다. 사용자가 고른 역할만 기록(`pazmo_runner_choices`)해 재시작 후 유지한다.
  - 고르지 않은 역할은 로그인된 실행기(codex 우선)를 기본값으로 쓴다.
  - G4 평가는 Reviewer 선택을 따른다. 실행마다 `pazmo_runner_runs`에 runner·버전·SHA·모델을 남긴다.
- **화면:**
  - 에이전트 상세의 CLI 편집에서 Office가 실행할 수 있는 codex·claude만 보인다. 모델·effort 목록은 각 CLI에서 받아 쓴다. 저장 거부 이유를 보여 준다.
  - 설정 → CLI 탭: 설치·로그인 상태, 미준비 시 안내 문구를 보여 준다.
- **시작 조건:** codex 또는 claude 중 하나만 로그인되어 있어도 시작한다. `--codex-runtime pinned`이면 기존 고정 0.155.1 경로를 쓴다.

## 실험으로 드러나 반영한 사실

- codex 0.160.0은 새 `goals` 도구(`get_goal/create_goal/update_goal`)를 노출한다. 검증된 도구 표면 밖이라 `features.goals=false`로 끈다(0.155.1도 같은 키를 안다).
- codex 0.160.0은 원격 명령 환경에 `CODEX_VERSION`을 넣는다. 비밀이 아니다. 검사는 인증·키·토큰류 이름만 거부한다.
- claude는 macOS 키체인 계정을 `USER`로 찾는다. `USER`가 없으면 로그인돼 있어도 `loggedIn:false`가 나온다.
- claude `--safe-mode`는 `--mcp-config` 서버까지 끈다(사용하지 않음). `--bare`는 구독 로그인을 읽지 않는다(사용하지 않음).
- claude(haiku)는 JSON만 요청해도 ```json 코드 블록으로 감싼다. 메시지 전체가 정확히 한 개의 json 블록일 때만 풀고, 앞뒤에 글이 있으면 기존처럼 거부한다.
- 업스트림 Claw의 agent PATCH는 추론 단계를 codex에만 허용했다. claude effort를 허용하도록 한 줄 바꿨다.
- 업스트림 시드는 Reviewer를 `claude`로 둔다. 이 값이 사용자 선택으로 오인되지 않게 선택 기록 테이블을 추가했다.
- 기존 `scripts/probe-codex-remote.py`는 고정 기준선에서도 `exec-server EOF`로 실패하는 낡은 진단이다. 검사는 현재 live 경로로 새로 구현했다.

## 자동 검사

| 검사 | 결과 |
| - | - |
| root `npm test` (Node 24.19.0) | **451/451** (기준선 367/367 + 신규·확장 84) |
| root 타입 검사 | exit 0 |
| vendor `tsc -b` | exit 0 |
| vendor vitest | **98/100**. 실패 2건(`ReportHistory`, `TaskReportPopup` sprite avatar)은 깨끗한 HEAD 별도 worktree에서도 같은 2건이 실패해 이번 변경과 무관하다. 별도 작업으로 등록했다. |
| vendor UI 빌드 | 성공(실행 중인 61772 인스턴스가 쓰는 `dist`를 건드리지 않도록 별도 출력 경로로 빌드) |
| Story checker / Task checker | exit 0 / exit 0 |

## 리뷰 반영 (report-only 리뷰 → 수정)

리뷰에서 Critical은 없었고 Important 6건이 나왔다. 아래는 모두 테스트를 먼저 쓰고 실패를 확인한 뒤 고쳤다.
- **훅 감지:** claude는 `--include-hook-events` 없이는 훅 이벤트를 스트림에 내보내지 않는다. 플래그를 추가했고, 가짜 claude도 플래그가 있을 때만 훅 이벤트를 내보내게 바꿨다.
- **한국어 깨짐:** 출력·입력 조각 경계에서 멀티바이트 문자가 깨졌다(controller stdout, 다리 stdin, `run_command` 출력). 문자 단위로 이어 붙여 해석하도록 고쳤다.
- **검사와 취소:**
  - 처음 쓸 때 검사가 취소 신호를 받는다.
  - 검사 중 오류는 `closed:true` 거부로 처리한다.
  - 현재 선택은 시작과 저장 직후 백그라운드에서 미리 검사한다.
- **업데이트·로그인 반영:**
  - 바이너리가 바뀌면 다시 찾아 다시 검사한다.
  - 시작 후의 로그인은 저장할 때 반영한다.
  - 상태 새로고침(`refresh=1`)이 실제로 다시 찾는다.
- **검사 기록 키:** Office 경계 코드의 digest를 포함했다. 읽을 수 없는 기록은 다시 검사한다.
- **codex 개인 지침:** 아래 별도 절.
- **minor:** 가짜 설정의 MCP를 `.claude.json`에 심었고, live claude는 `DISABLE_AUTOUPDATER=1`로 돈다. 남긴 차이는 [결정 기록](../understanding/cli-runner-selection-decision.md#리뷰-후-알려진-차이)에 적었다.

## codex 개인 지침 파일 (사용자 결정 2026-10-06)

- **확인 방법:** 가짜 로컬 모델 실험에서 codex 0.160.0과 고정 0.155.1 모두 `$CODEX_HOME/AGENTS.md`·`AGENTS.override.md`를 요청에 넣었다. `--ignore-user-config`·`project_doc_max_bytes=0`·`instructions` 등으로 막히지 않았다.
- **이 PC:** `~/.codex/AGENTS.md`(2.3KB)가 있다.
- **결정:** 이 파일이 있으면 codex 역할 실행을 막는다(모든 codex 경로가 `codexJob`을 지난다).
- **실제 확인:**
  - 탐색 결과는 `codex ready loggedIn=true blocked=~/.codex/AGENTS.md`이고, 안내 문구가 나온다.
  - 제품 경로의 codex 실행은 모델 호출 없이 `RUNNER_NOT_READY: ~/.codex/AGENTS.md가 있으면 …`으로 거부됐다. 증거 행도 남지 않았다.
- **증거 한계:** 아래 codex 실제 구독 실행(gpt-5.5)과 9/22 이후 고정 경로의 기존 실제 실행에는 이 개인 지침이 모델 입력에 포함됐을 수 있다.

## 실제 VM 검사 (로그인·모델 호출 없음)

`scripts/qualify-runners.mjs`로 일회용 읽기 전용 컨테이너에서 실행했다.

| 실행기 | 버전 | 모델 | 결과 |
| - | - | - | - |
| codex | 0.160.0 (`112fae7a…1b4b`) | gpt-5.5 | **7/7** (최종 코드 재실행 포함) |
| codex | 0.160.0 | gpt-6.1-sol | **7/7** |
| codex | 0.160.0 | gpt-5.6-terra | **7/7** |
| claude | 2.1.280 (`387a5c5d…229d`) | haiku | **7/7** (최종 코드 재실행 포함) |

- 검사 항목: turn 완료, 노출 도구 허용 목록(claude는 정확히 Office 4개), 원격 명령이 VM에서 실행(`Linux`, `/candidate/tree`, 네트워크 없음, capability 0, 비밀 환경 없음), 원격 패치(codex)·읽기 전용 강제와 다리 경유 읽기(claude), `local` 환경 거부(codex), 호스트 쓰기 없음, 사용자 설정 미혼입(함정 CODEX_HOME/CLAUDE_CONFIG_DIR의 훅·스킬·CLAUDE.md·MCP).
- 의미: codex 0.160.0 컨트롤러 ↔ 고정 executor 0.154.0 호환을 위 모델들에서 확인했다. 다른 모델·버전은 처음 쓸 때 같은 검사를 다시 거친다.

## 실제 구독 실행 (V9)

제품 경로(roleJobFactory → 검사 → live job → 읽기 전용 VM)로 실행기마다 1회 모델을 호출했다. 사용자 로그인을 사용했고 API 키는 쓰지 않았다.

| 실행기 | 모델 | 결과 |
| - | - | - |
| codex 0.160.0 | gpt-5.5 (low) | exit 0, VM에서 README 첫 줄을 읽어 보고서 파싱 일치 (42s). 개인 지침 차단 이전 실행이다. 지금은 이 PC에서 차단된다. |
| claude 2.1.280 | haiku (low) | exit 0, 같은 확인 일치. 리뷰 반영 후 최종 코드로 다시 실행해도 일치했다(7s). `apiKeySource:none` |

- 증거 행(`pazmo_runner_runs` 형식)에 runner·버전·SHA·모델·reasoning이 기록됐다.
- 범위 한계: 이것은 역할 그래프 전체(PM→Lead→Engineer→Reviewer→G4)나 사용자 G4가 아니다. 실행기 연결을 확인한 것이다.

## 화면 확인 (별도 미리보기 인스턴스)

- 61772 인스턴스는 재시작·중지하지 않았다. 별도 임시 worktree·데이터·Git 프로젝트로 `start --claw --live`를 포트 58514에 띄웠고, 확인 후 종료·삭제했다.
- 설정 → CLI: Codex CLI 0.160.0·Claude Code 2.1.280 설치됨·인증됨, 모델 목록 codex 8개·claude 5개(각 CLI 출처).
- 에이전트 상세(Hawk, Reviewer): 실행기 선택지가 Claude Code·Codex CLI 둘뿐이었다. claude → Sonnet → effort `low`로 저장해 표시가 "Claude Code · sonnet (low)"가 됐다. 이 확인 중 업스트림 PATCH 거부(`cli_reasoning_requires_codex_provider`)를 발견해 고쳤다.
- 재시작 후 Hawk는 claude/sonnet/low를 유지했다. 고르지 않은 PM(Clio)·Lead(Sage)·Developer(Aria)는 codex 기본값이었다. 시드의 claude 값은 기본값으로 정리됐다.

## 남은 일·한계

- 작업별 실행기 선택, 다른 사람에게 배포·상용 제공(Anthropic Commercial Terms·OpenAI 확인 필요), VM executor 버전 변경은 범위 밖이다.
- 업스트림 "CLI 사용량" 패널은 토큰 파일을 직접 읽는 방식이다. Office 관리 모드에서는 자격증명 파일을 읽지 않고 모든 CLI에 `office_managed`를 반환하며, 패널은 "Office에서는 사용량을 표시하지 않음"으로 표시한다(`aac796d`, `tests/claw-cli-usage.test.mjs`). Office에서 사용량 수치는 제공하지 않는다.
- 설정 탭의 "메인 모델" 전역 저장은 기존처럼 Office 관리 모드에서 막혀 있다. 역할별 선택은 에이전트 상세에서 한다.
- claude 문서상 `--bare`가 `-p` 기본값이 될 예정이다. 그때 구독 실행은 `apiKeySource` 검사·인증 실패로 잠기고, API 키로 자동 전환하지 않는다.
