# Story: 사람이 허용한 특정 플러그인만 Office의 claude 실행기를 통과한다

## Goal
1. As-is
   - Office는 claude 실행기가 시작할 때 내장(`@builtin`)이 아닌 플러그인을 하나라도 불러오면 실행을 끊는다(`CLAUDE_PLUGIN_UNEXPECTED`, `src/runners/claude-profile.ts:82-89`).
   - 회사(claude.ai 조직)가 원격 관리 설정으로 켠 플러그인은 Office의 `--setting-sources ""`로도 꺼지지 않는다.
     - 이 Mac에서는 2026-11-23부터 조직 플러그인 하나가 그렇게 켜졌다.
     - 그 뒤 Office의 claude 실행이 기획 첫 단계에서 매번 끊긴다(3단계 Q3에서 발견).
     - Office와 같은 인자로 띄운 claude의 init 세 번 모두에 그 플러그인이 있었다.
   - 그 플러그인에는 skill과 설명 파일만 있다. Office 실행기에서는 쓸 길이 막혀 있다(`--tools ""`, `--disable-slash-commands`).
2. To-be
   - 사람이 그 Mac에서 허용한 특정 플러그인만 이 검사를 통과한다.
     - 허용 목록은 Mac마다 Office 데이터 폴더의 파일에 있다.
     - 사람은 CLI 명령으로 플러그인을 넣고 빼고 본다.
     - 저장소에는 어떤 플러그인 이름도 적지 않는다(공개 저장소).
   - 허용하지 않은 플러그인이 있으면 지금처럼 끊는다. 이유에 플러그인 이름과 허용 명령을 적어, 사람이 바로 판단할 수 있게 한다.
   - 허용한 플러그인이라도 실행에 끼어들 수 있는 것을 담고 있으면 끊는다. 허용할 때는 skill 전용이었다가 나중에 업데이트로 바뀐 경우를 막는다.
     - 끼어들 수 있는 것: hook, MCP 서버, 에이전트, 명령, 출력 스타일, 설정, 실행 파일.
   - 허용한 플러그인 이름은 그 실행의 기록에 남는다.
3. Unchanged
   - init의 나머지 검사: Office의 네 도구, MCP는 `office` 하나, skill·slash 명령 없음, 구독 로그인만 허용.
   - 실행 중 hook 이벤트가 오면 끊는 것.
   - 허용 목록이 비어 있으면 지금과 똑같이 동작한다.
   - codex 실행기의 규칙.

## Decisions
- D1. 허용 목록을 어디에 두나
  - Options: 저장소 코드 / Office 설정 화면 / Mac의 Office 데이터 폴더 파일과 CLI
  - Pick: 데이터 폴더 파일과 CLI.
    - 공개 저장소에 회사 플러그인 이름을 적을 수 없다.
    - 데이터 폴더 맨 위(`--data-dir`, 기본 `~/.local/share/pazmo-agent-office`)에 두면, 그 Mac의 혼자 쓰는 Office와 팀 Office가 같은 목록을 쓴다.
- D2. 플러그인을 어떻게 가리키나
  - Pick: init에 나오는 `source` 그대로("이름@마켓플레이스")다. 정확히 같을 때만 허용한다(와일드카드 없음).
- D3. 허용한 플러그인의 내용 검사
  - Pick: 허용한 플러그인도 설치 폴더를 본다.
    - 폴더는 `~/.claude/plugins/installed_plugins.json`의 설치 경로로 찾는다.
    - 통과하는 것: skill(`skills/`), 설명 파일(`.claude-plugin/plugin.json`의 설명 필드, `README*`, `LICENSE*`), 캐시 표시 `.in_use/`.
    - 그 밖의 것이 있거나 폴더를 찾지 못하면 끊는다.
- D4. CLI
  - `pazmo-office runner plugins [--data-dir PATH]`: 목록을 보인다.
  - `runner allow-plugin <source>`, `runner disallow-plugin <source>`: 넣고 뺀다.
  - 켜져 있는 Office는 다음 실행부터 새 목록을 쓴다.
- Copies: live 실행(`claude-controller.ts`)과 자격 점검(`qualification-fixtures.ts`)은 같은 init 검사 함수를 쓴다. 둘 다 같은 목록을 따른다.

## Human decides
- 없음. 사람이 특정 플러그인만 통과시키라고 정했다(2026-11-24). 어떤 플러그인을 허용할지는 각 Mac에서 사람이 CLI로 정한다.

## MUST
- M1. 허용 목록 파일과 CLI(D1, D2, D4).
  - 잘못된 이름은 거절한다. `@builtin`은 원래 통과하므로 넣을 필요가 없다.
  - 같은 이름을 두 번 넣어도 하나로 남는다.
- M2. init에 내장이 아닌 플러그인이 있을 때
  - 모두 목록에 있고 D3 검사를 통과하면 실행을 이어 간다.
  - 아니면 `CLAUDE_PLUGIN_UNEXPECTED`로 끊는다. 이유에 플러그인 이름, 걸린 까닭(목록에 없음 / 담은 것), 허용 명령을 적는다.
- M3. 허용한 플러그인 이름을 그 실행의 기록에 남긴다.
- M4. 끊은 이유가 기획 화면 메시지와 작업 메시지에 나온다.

## OUT
- O1. 내용만 보고 자동으로 허용하기: 사람이 정한 대로, 목록에 넣은 것만 통과한다.
- O2. codex의 `~/.codex/AGENTS.md` 규칙.
- O3. 조직 관리 설정을 읽거나 바꾸기.
- O4. 플러그인의 skill을 Office 역할이 쓰게 하기.

## QA
Environment: local (docs/qa.md)
Script: qa/office-org-managed-plugins.sh
- Q1 [M1] (script). 임시 데이터 폴더 · `runner allow-plugin a@m`을 두 번, `runner plugins`, `runner disallow-plugin a@m`, 잘못된 이름 · 실행 → 목록에 하나만 있다가 빠지고, 잘못된 이름은 거절된다.
- Q2 [M2] (script). 이 Mac · Office와 같은 인자와 환경으로 시스템 임시 폴더에서 claude를 띄워 init만 읽는다 →
  - 허용 목록이 비어 있으면 조직 플러그인 때문에 `CLAUDE_PLUGIN_UNEXPECTED`가 나고, 이유에 그 이름과 허용 명령이 있다.
  - 그 이름을 허용하면 플러그인 검사를 통과한다.
- Q3 [M2] (script). 시험 폴더의 가짜 허용 플러그인 · `hooks/`, `.mcp.json`, `agents/`, `commands/`, `plugin.json`의 `hooks` 키 각각 → 목록에 있어도 끊긴다.
- Q4 [Unchanged] (script). 기존 init 검사 시험(`tests/claude-profile.test.mjs`)과 빈 목록 → 그대로 통과한다.
- Q5 [M3, M4] (agent). 3단계 Q3의 live Office, 조직 플러그인을 허용한 뒤 · 같은 작업의 기획 재시도 → PM이 끊기지 않고 진행하고, 실행 기록에 허용한 플러그인 이름이 남는다.
- Q6 [not shown] (script). 목록에 없는 내장 밖 플러그인 → 지금처럼 끊긴다.

---
Status: Approved
Owner: JongKun Kim
