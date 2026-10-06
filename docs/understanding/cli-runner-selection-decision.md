# G3 proposal: 사용자 설치 codex·claude CLI를 구독 로그인으로 사용하고 역할별로 선택한다

Status: Approved
Understanding gate (G3): user conversation · 2026-10-02 · Check-in: accepted
Story: pazmo-agent-office-contract.md (M3/M4; V3/V4/V9)
Prior approved decisions: remote-controller-auth-decision.md, native-runner-isolation-decision.md

## 사용자 요청 (2026-10-02)

Office를 설치한 사용자가 이미 설치·로그인한 `codex`와 `claude` CLI를 그 구독 플랜 그대로 쓴다. 별도 API 키를 요구하지 않는다. 둘 중 하나만 있어도 동작하고, 없으면 무엇을 설치·로그인할지 화면에 안내한다. 역할별로 실행기와 모델을 클릭으로 고르고 재시작 후에도 유지한다. 모델 목록은 설치된 CLI에서 가져온다. 기존 격리 경계(읽기 전용 `/candidate/tree`, 네트워크 없는 컨테이너, 원본·main 자동 반영 금지, G1/G4)를 약화하지 않는다.

## 승인된 방향 (사용자 선택, 2026-10-02)

설명 페이지(https://claude.ai/artifact/YDJeToc8v9v7WG5v3tgFkK)를 본 뒤 사용자가 세 질문에 답했다.

- claude 범위: **"내 로그인·원본 claude"**. 설치된 claude 바이너리를 수정 없이 실행한다. Office는 토큰을 읽거나 저장하거나 대신 로그인하지 않는다.
- 바이너리 신뢰: **"처음 쓸 때 검사·바뀌면 재검사"**. 발견한 바이너리의 SHA-256이 Office의 로그인 없는 경계 검사를 통과해야 실행한다. SHA가 바뀌면 다시 검사한다. 기존 고정 런타임은 선택지로 남긴다.
- 선택 단위: **"이번엔 역할별만"**. PM·Lead·Developer·Reviewer마다 실행기·모델을 고른다. 작업별 덮어쓰기는 후속이다.

## 결정

1. **두뇌는 Mac, 손발은 VM.** 모델 호출은 Mac의 사용자 CLI 프로세스가 하고, 모델이 요청한 파일·명령 도구는 모두 기존 전용 VM의 일회용 컨테이너(`exec-server`, 네트워크 없음, 인증 정보 없음)에서만 실행한다.
   - codex는 지금처럼 `CODEX_EXEC_SERVER_URL`을 쓴다.
   - claude는 내장 도구를 전부 끈다(`--tools ""`). 대신 Office가 소유한 stdio MCP 서버("도구 다리") 하나만 준다. 다리는 같은 exec relay를 거쳐 같은 exec-server 메서드(fs/*, process/*)로만 전달하며, 호스트 파일시스템은 읽지도 쓰지도 않는다.
2. **로그인은 제자리.** codex는 `~/.codex/auth.json`(`CODEX_HOME=~/.codex`), claude는 macOS 키체인에 로그인 정보를 둔다. Office는 이 파일·항목을 복사하거나 내용을 읽지 않는다. 상태는 각 CLI의 공식 명령으로만 확인한다: `codex login status`, `claude auth status`(JSON `loggedIn`). VM·컨테이너·다른 사용자에게 전달하지 않는다.
3. **사용자 개인 설정은 격리 실행에 섞지 않는다.**
   - codex: `--ignore-user-config --ignore-rules --strict-config`를 유지하고 `suppress_unstable_features_warning=true`를 추가한다. 검사 단계에서 임시 `CODEX_HOME`의 함정 `config.toml`(호스트 파일을 쓰는 MCP 서버·훅)이 실행되지 않음을 확인한다.
   - claude: `--strict-mcp-config --mcp-config <Office 다리> --setting-sources "" --disable-slash-commands --no-session-persistence --permission-mode dontAsk --permission-prompts none --allowedTools mcp__office__*`를 쓰고, cwd는 빈 staging 디렉터리로 둔다. `--safe-mode`는 쓰지 않는다(Office MCP까지 꺼짐 — 실험 E2). `--bare`는 구독 로그인을 읽지 않으므로 쓰지 않는다.
   - claude는 실행마다 첫 `system/init` 이벤트에서 tools(Office 다리 도구만), mcp_servers(`office` 하나), `@builtin` 이외 plugins·skills·slash_commands(0개), hook 이벤트(0개)를 검사한다. 하나라도 다르면 첫 모델 턴 전에 프로세스 그룹을 종료하고 실패로 기록한다.
4. **신뢰 기준: 고정 SHA → 로컬 검사 기록.**
   - Office는 PATH와 알려진 설치 위치에서 CLI를 찾는다. JS 런처(예: bun/npm `codex.js`)는 실행하지 않고, 런처가 가리키는 네이티브 바이너리를 직접 해석한다.
   - 네이티브 바이너리를 찾을 수 없는 설치 형태(예: JS만 있는 패키지)는 "지원하지 않는 설치 형태"로 표시하고 공식 네이티브 설치 방법을 안내한다(ASSUMED).
   - 그 바이너리의 SHA-256·버전으로 검사한다. **로그인 없이 로컬 가짜 모델 서버**로 실제 VM 컨테이너 경로를 확인한다: 도구가 원격에서 실행되는지, 호스트에 쓰지 않는지, `local` 환경 요청이 거부되는지, 사용자 설정이 로딩되지 않는지. claude는 `ANTHROPIC_BASE_URL`을 가짜 서버로 두고 이 검사에서만 가짜 키를 쓴다.
   - 통과 기록은 데이터 디렉터리의 `runner-qualification/<runner>-<sha>.json`에 남긴다(검사 목록, executor SHA, 모델 목록 스냅샷).
   - 실행 직전에 SHA를 다시 계산해 기록과 다르면 실행하지 않고 재검사를 요구한다. VM 쪽 executor(Linux codex 0.154.0)는 고정 SHA를 유지한다.
5. **모델 목록은 CLI가 출처다.**
   - codex: 검사를 통과한 바이너리의 `codex debug models` 중 `visibility=list`. 그 스냅샷을 `model_catalog_json`으로 전달해, 검사한 목록과 실행 목록을 일치시킨다.
   - claude: `-p --input-format stream-json`의 `initialize` 제어 응답 `models[]`. 모델 호출과 로그인 없이 얻는다(실험 E4). 모델별 effort 단계도 이 응답을 쓴다.
6. **같은 역할 계약.** 역할 프로필·프롬프트·응답 JSON 스키마·마커 검사는 실행기와 무관하게 같다. claude 결과(stream-json)는 작업 경계에서 기존 정규 이벤트 형태로 바꾼다(`turn.started` → 각 `agent_message` → `turn.completed`). 그래서 `terminalReport`와 하위 소비자는 바뀌지 않는다. 최종 메시지는 하나여야 하고 오류·중복이면 null이다.
7. **화면·저장.**
   - 원본 claw-empire의 에이전트 상세 CLI·모델 칸과 설정 → CLI 탭을 Office 관리 모드에서 다시 연다.
   - 선택은 `claw.sqlite`의 `agents.cli_provider/cli_model/cli_reasoning_level`(PM·Lead·Developer·Reviewer 역할 에이전트)에 저장한다.
   - live 시작마다 `codex`로 덮어쓰던 코드는 "지원되지 않는 값일 때만 기본값"으로 바꾼다.
   - 쓰기는 역할 에이전트의 그 세 필드만 허용하고, 서버가 검사 기록의 모델 목록으로 검증한다. 설정 → CLI 탭은 설치됨·로그인됨·검사 통과를 표시하고, 없으면 설치·로그인 명령을 안내한다.
   - G4 평가는 Reviewer 설정을 따른다(ASSUMED). 바뀐 선택은 다음 실행부터 적용된다. 실행마다 runner·버전·SHA·모델을 증거에 기록한다.
8. **실패 시 대체 없음.** 미설치·미로그인·검사 실패·SHA 변경·`system/init` 불일치·구독 인증 실패이면 해당 역할 실행을 잠그고 이유를 보여 준다. 다른 실행기, 고정 런타임, API 키로 자동 전환하지 않는다(Story O2 유지).

## 불변 조건과 예시

예: Developer를 claude·sonnet으로 고른다. 모델이 `/candidate/tree/src/a.ts` 수정을 요청하면 다리가 VM 컨테이너의 exec-server `fs/writeFile`로 보낸다.

다음은 모두 실패해야 한다:
- 모델이 Mac의 `~/.ssh`, `~/.codex/auth.json`, Office DB를 읽으려 함. 다리에 호스트 접근 경로가 없다.
- 모델이 Bash·WebFetch를 쓰려 함. `--tools ""` 때문에 도구 목록에 없다.
- 사용자의 `~/.claude` 훅·MCP·플러그인이 실행됨. `system/init` 검사가 막는다.

후보 완료에는 여전히 같은 후보의 검사·리뷰와 사람의 G4가 필요하다.

## 약관 근거 (공식 문서, 2026-10-02 열람)

- **Anthropic — https://code.claude.com/docs/en/legal-and-compliance**
  - "Authentication and credential use": OAuth는 구독자의 Claude Code·Anthropic 네이티브 앱 일반 사용용이다. 제3자 개발자가 자기 앱에서 Claude.ai 로그인을 제공하거나, 구독 자격으로 사용자 대신 요청을 보내거나, 자격·세션 토큰을 수집·저장·중개하는 것은 허용하지 않는다. 다만 최종 사용자가 수정되지 않은 Claude Code 바이너리에 자기 구독으로 로그인하는 것은 막지 않는다고 명시한다.
  - "Can customers offer Claude Code in their products?": 제품 안에서 Claude Code를 실행하려면 Commercial Terms 동의, 바이너리 무수정, 내장 인증 방법 제거·제한 금지, 각 최종 사용자의 자기 자격 인증이 조건이다.
  - "Acceptable use": Pro/Max 한도는 평범한 개인 사용을 가정한다.
- **Anthropic — https://code.claude.com/docs/en/headless**: `--bare`는 구독 로그인·키체인을 읽지 않는다. 향후 `-p` 기본값이 될 예정이라고 공지한다.
- **OpenAI — https://learn.chatgpt.com/docs/non-interactive-mode**: `codex exec`는 저장된 CLI 로그인을 기본으로 재사용한다. 자동화에는 API 키를 권장하며, ChatGPT 경로는 자기 Codex 계정으로 실행해야 할 때 쓰라고 한다. `auth.json`은 비밀번호처럼 다루고 공유하지 않는다.
- **OpenAI — https://learn.chatgpt.com/docs/auth**: CLI는 로컬 작업에서 두 로그인 방식을 모두 지원한다.

판단: 이 설계는 "사용자가 자기 PC에서 수정 안 된 CLI를 자기 로그인으로 실행"하는 범위다. Office는 로그인 흐름을 제공하거나 토큰을 중개하지 않는다.

**미확인:** Office를 다른 사람에게 배포·상용 제공하는 경우는 Anthropic Commercial Terms 동의(필요하면 sales 문의)와 OpenAI 측 확인이 필요하다. 배포는 이번 범위가 아니다(Story O1). 화면에 이 조건을 표시한다.

## 실험 증거 (2026-10-02, 버리는 코드)

- **E1.** `claude auth status` → `loggedIn:false`. 이 Mac의 claude CLI는 현재 로그인되어 있지 않다. 헤드리스 실행은 "OAuth session expired"로 실패했다. (이후 사용자가 로그인함 — E7)
- **E2.** `--safe-mode`는 `--mcp-config`로 넘긴 서버까지 비활성화했다(`mcp_servers:[]`).
- **E3.** E2에서 `--safe-mode`를 빼고 위 플래그로 실행한 결과:
  - `tools:["mcp__office__echo"]`, `mcp_servers:[office connected]`
  - 사용자 plugins 0개(builtin 3개만), skills·slash_commands 0개, hook 이벤트 0개.
- **E4.** claude `initialize` 응답에서 models 5개와 effort 단계를 얻었다. 로그인과 모델 호출은 없었다.
- **E5.** 사용자 codex: bun 런처 → 네이티브 `codex-cli 0.160.0` (`112fae7a…1b4b`). `codex debug models`는 10개 중 `list` 8개, `codex login status`는 "Logged in using ChatGPT"였다.
- **E7.** 사용자가 `claude auth login`을 한 뒤(`authMethod: claude.ai`, team 플랜) 결정 3의 플래그로 haiku를 1회 실행했다(2턴, CLI 추정 비용 $0.019).
  - `apiKeySource: none`
  - 도구는 Office MCP 하나만 있었고 호출 결과는 `ECHO:hi`였다.
  - `~/.claude/CLAUDE.md` 고유 문구 3개를 물었더니 모델이 모두 "없음"이라고 자기 보고했다. 모델 자기 보고라 약한 증거이므로 실행마다 `system/init` 기계 검사를 유지한다.
  - plugins는 4개였고 모두 `source`가 `@builtin`이다. 그래서 init 검사 규칙은 "`@builtin`이 아닌 plugin이 하나라도 있으면 거부"로 정한다.
- **E6.** 기존 `scripts/probe-codex-remote.py`는 고정 0.154.0 기준선에서도 "exec-server EOF"로 실패한다. 현재 live 경로와 맞지 않는 낡은 진단이다. 검사는 현재 `dockerClient().openExecutor` 경로로 새로 구현한다. codex 0.160.0 ↔ executor 0.154.0 호환성은 **미확인**이다.

## 대안과 복구

- 고정 런타임만 유지하고 모델만 고르기: 사용자가 택하지 않았다. 고정 런타임 경로는 남겨 사용자가 명시적으로 고를 수 있다.
- claude를 API 키(`--bare`)로만 쓰기: 요구와 맞지 않는다.
- 복구: 역할 설정을 codex·고정 런타임으로 되돌리면 이전 동작과 같다. 검사 기록은 데이터 디렉터리에만 있고 삭제해도 다음 실행 전 재검사된다. 호스트 로그인이나 전역 CLI 설정은 바꾸지 않는다.

## 추가 결정 (2026-10-06): codex 개인 지침 파일

리뷰와 실제 검사에서 다음을 확인했다.
- codex(0.160.0과 고정 0.155.1 모두)는 `--ignore-user-config`와 `project_doc_max_bytes=0`이 있어도 `$CODEX_HOME/AGENTS.md`·`AGENTS.override.md`를 사용자 지침으로 모델에 넣는다.
- 결정 2에 따라 `CODEX_HOME`은 로그인 폴더 `~/.codex`로 유지해야 하므로 이 파일을 피할 수 없다. 끄는 설정은 찾지 못했다.
- 9/22부터 쓰던 고정 경로도 같았다. 이 Mac에는 `~/.codex/AGENTS.md`가 있어 기존 codex 실제 실행에도 그 내용이 들어갔을 수 있다.

설명 페이지(https://claude.ai/artifact/DB86BjzYzfCNRL3iGgCmSX)를 본 뒤 사용자는 **"파일 있으면 codex 잠금"**을 골랐다.
- `codexJob`: 이 파일 중 하나라도 있으면 설치본·고정·기존 모드 모두 실행 전에 `CODEX_PERSONAL_INSTRUCTIONS`로 거부한다. 존재 여부만 확인하고 내용은 읽지 않는다.
- 탐색·화면·시작: codex를 `blocked`로 표시하고 "파일을 옮기거나 claude를 고르세요"라고 안내한다. 고르지 않은 역할은 로그인된 claude를 기본값으로 쓴다.
- 이 PC에서는 사용자가 파일을 옮기기 전까지 Office에서 codex를 쓸 수 없다. 대안이던 "허용하고 기록"과 "전용 폴더 + 로그인 링크"는 고르지 않았다.

## 리뷰 후 알려진 차이

계획과 다른 점으로, 이번 범위에서 고치지 않고 남긴다.
- 화면은 실행기별 "검사 통과" 상태를 표시하지 않는다. 검사 실패는 실행 결과의 오류 코드로 보인다.
- 실행 증거는 실행 직전에 기록하며 결과(성공/실패)는 담지 않는다. 고정 경로는 증거를 남기지 않는다.
- 사용자 선택 표시는 Office 검증 통과 직후 기록한다. 그 뒤 업스트림 저장이 실패해도 표시가 남는다. 다음 시작 때 기존 값이 codex/claude이면 그대로 유지된다.
- 처음 쓸 때 검사는 시작·저장 직후 백그라운드에서 미리 돈다. 그 전에 실행되면 역할 실행 안에서 돌며 시간 예산을 함께 쓴다.

## 사람의 결정

사용자는 세 질문에 권장안을 골랐다. 그 뒤 로그인(E7)과 이 문서 검토를 마치고 "진행해"라고 답했다. 이 답이 구현 승인이다. 인증 비밀은 이 기록에 포함하지 않는다.

## 승인 범위

- **승인하는 것:** 위 방향의 구현·검증, 그리고 경계 검사 통과 후 사용자 구독으로 실제 역할 실행을 시험하는 것.
- **승인하지 않는 것:** 격리가 이미 통과했다는 판정, 배포·상용 제공, 작업별 선택, VM executor 버전 변경, 작업 단위 G1/G4·인도 검사 대체.
