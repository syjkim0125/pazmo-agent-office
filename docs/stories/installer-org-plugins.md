# Story: 설치 한 줄이 회사 플러그인을 찾아 허용할지 묻고, 막혔을 때 나오는 허용 명령은 그대로 실행된다

## Goal
1. As-is:
   - 조직이 켠 claude 플러그인이 있는 Mac에서는 팀원이 설치 한 줄(`/install.sh`)을 끝내도 Office의 claude 역할이 첫 실행에서 `CLAUDE_PLUGIN_UNEXPECTED`로 멈춘다.
   - 멈춘 이유가 알려 주는 명령은 `pazmo-office runner allow-plugin …`이다. 그런데 설치기는 `pazmo-office`를 PATH에 넣지 않는다(`src/hub/installer.ts:130`은 `node ~/.pazmo/office/bin/pazmo-office.mjs`로 부른다). 그래서 팀원이 그 명령을 그대로 치면 "command not found"가 난다.
2. To-be:
   - 설치 한 줄이 "내 Mac 연결" 바로 앞에서 이 Mac의 claude가 싣는 내장 밖 플러그인을 찾는다. 허용할 수 있는 것은 하나씩 "Office에서 허용할까요?"라고 터미널에서 묻는다. 막힐 수밖에 없는 것(hook·MCP·agent·command)은 이유를 보인다.
   - Office가 보이는 허용 명령은 그 Office의 node와 스크립트 경로를 그대로 담아, 복사해 붙이면 실행된다.
3. Unchanged:
   - 허용 목록의 뜻은 그대로다. 사람이 넣은 것만 통과하고, 내용 검사(hook·MCP 서버·agent·command 거절)도 그대로다. Office가 스스로 허용하는 일은 없다.
   - `runner plugins`(옵션 없이), `allow-plugin`, `disallow-plugin`의 입력과 출력은 그대로다.
   - 설치기의 다른 단계와 순서, `mac connect`, 로그인 때 자동 실행(LaunchAgent)도 그대로다. 터미널이 없는 실행에서는 아무것도 묻지 않는다.

## Decisions
- D1. 어디서 묻나
  - Options: 설치기의 새 단계 / `mac connect` 안
  - Pick: 설치기의 새 단계("회사 플러그인 확인", "Claude 로그인" 다음, "내 Mac 연결" 앞). `mac connect`는 LaunchAgent와 다시 켜기에서도 불리고, 설치기만 처음부터 터미널(`<"$TTY"`)을 받기 때문이다(`src/hub/installer.ts:127`, `130`). 같은 확인은 새 옵션 `runner plugins --review`로 누구나 다시 돌릴 수 있다.
- D2. 실행되는 허용 명령
  - Options: 명령에 그 Office의 node와 `bin/pazmo-office.mjs` 절대 경로를 담기 / 설치기가 `pazmo-office`를 PATH에 넣기
  - Pick: 절대 경로를 담는다. PATH에 넣으려면 사용자의 셸 설정이나 Homebrew 폴더를 바꿔야 하고, 체크아웃에서 돌리는 Office(`./office`)와 설치본이 같은 이름을 다툰다. 지금 문구는 `src/runners/claude-plugins.ts:244`이다.
- D3. 허용할 수 없는 플러그인(hook 등)이 있을 때 설치를 멈추나
  - Options: 이유를 보이고 설치는 이어 간다 / 설치를 멈춘다
  - Pick: 이어 간다. Mac 연결과 codex 역할은 그대로 쓸 수 있고, 그 플러그인은 조직 관리자가 정할 일이다. 대신 "이 Mac에서는 Office의 claude 역할이 멈춥니다"를 분명히 보인다.
- D4. 그냥 Enter를 누르면
  - Pick: 허용하지 않는다(`[y/N]`). 허용은 사람이 고른 것만이라는 앞 Story(`docs/stories/office-org-managed-plugins.md`)의 원칙을 따른다.
  - 머지 뒤 바꿈(2026-11-26, 사용자 요청 "엔터쳐도 허용되게 할 순 없어?"): `[Y/n]`, Enter도 허용한다. 묻는 것은 조직이 켠 skill만 든 플러그인뿐이고, Enter를 누른 팀원의 Office가 이유도 없이 멈췄다. 닫힌 터미널(Ctrl-D)은 여전히 허용하지 않는다.
- Copies: 설치기는 `src/hub/installer.ts` 하나다. 허용 명령 문구는 `allowCommand` 한 곳에서 나와 기획·작업 화면의 멈춘 이유와 `--review`가 함께 쓴다. 문서는 `docs/LOCAL-PREVIEW.md`(설치기 단계 목록)와 `docs/qa.md`(플러그인 줄)를 고친다.

## MUST
- M1. `runner plugins --review [--data-dir PATH]`
  1. Office가 쓰는 claude를 Office와 같은 인자로 init 이벤트까지만 띄워(모델 응답 전에 끝냄) 내장 밖 플러그인을 찾는다.
  2. 플러그인마다 이미 허용됨, 허용할 수 없음(이유), 허용 목록에 없음 중 하나를 보인다.
  3. 터미널이면 "허용 목록에 없음"인 것만 하나씩 `[y/N]`으로 묻고, y면 목록에 넣는다.
  4. 터미널이 아니면 묻지 않고 목록도 바꾸지 않는다. 대신 실행되는 허용 명령을 보인다.
  5. claude가 없거나, 로그인이 안 돼 있거나, 30초 안에 init이 없으면 그렇다고만 말하고 아무것도 바꾸지 않는다. 이때도 exit 0이라 설치기는 이어 간다.
- M2. 설치기
  1. "Claude 로그인" 다음, "내 Mac 연결" 앞에 "회사 플러그인 확인" 단계가 있고, 터미널 입력으로 `runner plugins --review`를 부른다.
  2. 내장 밖 플러그인이 없으면 한 줄로 지나간다.
- M3. 실행되는 허용 명령
  1. 멈춘 이유와 `--review`가 보이는 허용 명령은 `'<node 경로>' '<Office>/bin/pazmo-office.mjs' runner allow-plugin <이름>`(다른 데이터 폴더면 `--data-dir '<폴더>'`) 꼴이다.
  2. 그대로 셸에 붙이면 그 데이터 폴더의 목록에 들어간다.
  3. 승인 뒤 고침(2026-11-24, 리뷰):
     - 멈춘 이유도 `--review`와 같은 판정을 쓴다. 목록에 없더라도 hook·MCP·agent·command가 있거나 설치 폴더를 찾지 못하면, 허용 명령 대신 이유만 보인다(허용해도 다시 막히기 때문).
     - 명령 속 경로는 사람의 홈을 `~`로 줄인다. 팀 기획 실패 이유는 공유 허브에 올라가므로 계정 이름을 싣지 않는다.
     - 명령이 1200자를 넘으면 명령을 자르지 않고 "그 밖의 N개는 `… runner plugins --review`"로 끝낸다. 화면이 보이는 멈춘 이유는 1600자까지다.
     - `--review`는 claude를 SIGTERM으로 먼저 멈춘다(로그인 잠금이 풀리게). Ctrl-C에도 claude와 임시 폴더를 정리한다.
- M4. 문서: `docs/LOCAL-PREVIEW.md`의 설치기 단계와 `docs/qa.md`의 플러그인 줄이 새 단계와 명령을 말한다.

## OUT
- O1. 묻지 않고 자동으로 허용하기: 앞 Story에서 사람이 정한 대로, 목록에 넣는 것은 사람이다.
- O2. `pazmo-office`를 PATH에 넣기: D2.
- O3. codex의 `~/.codex/AGENTS.md`로 막히는 문제: 따로 다룬다(앞 Story O2와 같음).
- O4. 사내 OpenShift 허브와 실제 팀원 Mac으로 설치 한 줄 전체를 돌리기: 허브 재배포가 먼저라 이번에는 못 한다. 아래 Q로 대신한다.

## QA
Environment: local (docs/qa.md)
Script: qa/installer-org-plugins.sh
- Q1 [M1, M3] (script). 이 Mac(조직 플러그인 있음) · 빈 임시 데이터 폴더 · 터미널 없이 `runner plugins --review --data-dir <폴더>` → 그 플러그인을 "허용 목록에 없음"으로 보이고, 묻지 않고, 목록은 비어 있다. 보인 허용 명령을 그대로 `sh -c`로 돌리면 목록에 들어간다.
- Q2 [M1] (script). 같은 Mac · 새 빈 데이터 폴더 · 가짜 터미널(`script`)로 `--review`에 `y`를 준다 → 목록에 그 플러그인이 들어간다. 다시 돌리면 "이미 허용됨"이고 묻지 않는다. `n`이나 Enter만 주면 목록은 비어 있다.
- Q3 [M1] (script: 시험 `tests/claude-plugins-review.test.mjs`). 가짜 claude가 hook 플러그인과 skill만 있는 플러그인을 init에 싣는다 · 터미널 입력 `y` → hook 플러그인은 묻지 않고 이유를 보이며, skill만 있는 것만 묻고 넣는다. claude가 없거나 init이 없으면 아무것도 바꾸지 않고 exit 0이다.
- Q4 [M2] (script). `installScript({…})`로 만든 설치기 · 내용 검사와 `sh -n` → "Claude 로그인" 다음, "내 Mac 연결" 앞에 "회사 플러그인 확인"이 있고 `<"$TTY"`로 `runner plugins --review`를 부르며, 문법 오류가 없다.
- Q5 [M3] (script). 시험의 멈춘 이유(`pluginVerdict`)에 다른 데이터 폴더를 주어 만든 허용 명령 · 그대로 `sh -c`로 실행 → 그 폴더의 목록에 들어간다.
  - 승인 뒤 고침: M3.3 때문에, 설치 기록이 없는 플러그인에는 허용 명령이 나오지 않는다. 그래서 Q5는 skill만 있는 플러그인을 Claude Code처럼 등록한 가짜 HOME으로 만든다.
- Q6 [Unchanged] (script). `tests/claude-plugins.test.mjs`, `tests/claude-profile.test.mjs`, 설치기 시험, 그리고 옵션 없는 `runner plugins` 출력 → 그대로 통과하고, 출력 모양도 같다.
- Q7 [not shown] (script). 내장 밖 플러그인이 없는 가짜 claude · `--review` → "확인할 플러그인이 없습니다" 한 줄뿐이고, 묻지 않으며 목록 파일도 만들지 않는다.

---
Status: Approved
Owner: JongKun Kim
