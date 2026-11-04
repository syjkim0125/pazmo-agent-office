# 브라우저 팀 흐름 묶음 1 (Mac 연결) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원이 Hub 웹의 설치 명령 한 줄과 "이 Mac 허용" 한 번으로 자기 Mac을 **사람 단위**로 Hub에 연결한다. 그러면 Office가 담당 repo를 스스로 clone·등록·연결하고, Mac 로그인 때 저절로 켜지며, Hub 웹 머리글에 "내 Mac" 상태가 보인다. 담당 repo가 바뀌면 켜져 있는 Office가 열린 Task가 없을 때 스스로 맞추고 다시 켠다.

**Architecture:**
- **Hub(사람 단위 연결):** 기기 흐름(device flow)이다. Office가 `POST /api/mac/start`로 코드를 받고, 사람이 웹 `/mac/approve`에서 허용하면, Office가 `POST /api/mac/token`으로 Mac 토큰을 한 번 받는다. Mac 토큰(`hub_macs`)은 `/api/mac/*`만 부르고, repo마다는 지금의 (사람, repo) 연결(`hub_links`)을 새로 받아 쓴다. 그래서 팀 Office의 Story 경로는 바뀌지 않는다. `hub_links.mac_id`로 그 Mac이 받은 연결을 알고, Mac을 해제하면 함께 끊는다.
- **Hub 웹·설치기:** 서버가 만드는 HTML(`pages.ts`)에 `/mac`, 허용 화면, 머리글 상태, 첫 방문 안내를 더한다. `GET /install.sh`는 OpenShift 모드에서만 Hub 주소를 채운 POSIX sh를 준다.
- **Office:** 새 모듈 넷과 CLI 하나를 더한다.
  - `src/team/mac.ts`: `mac-link.json`, 기기 흐름, Mac API 호출
  - `src/team/mac-sync.ts`: 담당 repo clone·등록·repo별 연결
  - `src/team/launch-agent.ts`: LaunchAgent
  - `src/team/mac-watch.ts`: 접속 상태 하트비트와 스스로 다시 켜기
  - CLI `src/cli/mac.ts`: `mac connect|status|disconnect|restart`
- **기존 흐름과의 관계:** `up --team`은 Mac 연결이 있고 팀 Office가 꺼져 있으면 켜기 전에 repo를 맞춘다. LaunchAgent와 스스로 다시 켜기는 이 경로 하나로 켠다. 연결 문자열·`team add`·`hub-link`·`start --team` 흐름은 그대로 둔다(더하기만 함).

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행), npm 의존성 0. 호스트 `git`·`gh`·`launchctl`·`open`은 `runCommand`(`src/runners/command.ts`)로만 부른다. 설치기는 POSIX sh다.

**Spec:**
- `docs/understanding/hub-web-team-flow-decision.md`(G3 2026-11-04)의 "팀원" 흐름 1·2·7, "나눠서 만들기"의 묶음 1. Story D41 / V19(M16·M4).
- 컨트롤러가 정한 묶음 1 결정(2026-11-04). 그 내용은 아래 Global Constraints, 판정 표, 각 Task에 빠짐없이 옮겨 적었다. 끝의 "결정 → Task" 표에서 각 결정이 어느 Task에 있는지 볼 수 있다.

## Global Constraints

- **작업 위치:** worktree `.worktrees/hub-web-flow`, 브랜치 `feat/hub-web-flow`. 부모 체크아웃으로 `cd`하지 않는다. push는 사용자 요청 시에만 한다. kit graph 실행 파일의 U 번호는 만들 때 main을 확인해 정한다(병렬 PR 충돌 방지).
- **Node 24:** `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:$PATH"`.
  - 전체 `npm test`를 동시에 두 개 돌리지 않는다.
  - 새 npm 의존성은 없다.
  - kit 5 검증은 `.ai-workflow/verification.json`(시험 3조각, 타입 검사, Story 검사)으로 돈다.
- **더하기만 한다:** 프로토콜 1·2·3, `/api/link/*`, 연결 문자열, `hub-link`, `team add|remove`, `start --team`, 기존 시험은 그대로 통과해야 한다. `NO_REPOS`는 Mac 연결이 없을 때 지금처럼 난다.
- **공개 레포:** 사내 호스트·조직·repo 이름을 커밋하지 않는다. 시험 원격은 `github.example.com/...`, 시험 공개 Hub 주소는 `https://pazmo-hub.apps.example.com`이다.
- **비밀:**
  - Hub는 기기 코드·사용자 코드·Mac 토큰·연결 토큰의 sha256만 저장한다.
  - Office의 토큰 파일은 0600이다.
  - 토큰·비밀은 URL, 로그, 명령줄 인자, CLI 출력, 오류 메시지에 넣지 않는다. 허용 URL에는 사용자 코드만 들어간다(로그인한 세션 없이는 아무것도 못 한다).
- **호스트 명령 환경:**

  | 명령 | env | 비고 |
  |---|---|---|
  | git clone·config | `{HOME, PATH, LANG:"C", GIT_TERMINAL_PROMPT:"0"}` + 있으면 `SSH_AUTH_SOCK`. `-c core.hooksPath=/dev/null` | `branch.ts`의 `git()`와 같다. clone 시간 제한 600000 ms |
  | gh | `ghStatus`(`src/team/gh.ts`) 그대로 | `gh auth status --hostname <host>`만 부른다 |
  | launchctl | `/bin/launchctl`, `{PATH:"/usr/bin:/bin", HOME, LANG:"C"}`, 30000 ms | 주입 가능(`LaunchRun`) |
  | open | `/usr/bin/open <허용 URL>` | 주입 가능 |

- **값:**

  | 항목 | 값 |
  |---|---|
  | 기기 코드·Mac 토큰 | 43자 base64url(`store.ts`의 `secret()`) |
  | 사용자 코드 | `ABCD-1234`. 글자 넷은 `BCDFGHJKLMNPQRSTVWXZ`, 숫자 넷은 `0-9`. 입력은 대문자로 바꾸고 공백·하이픈을 빼서 읽는다 |
  | 코드 수명 | 600000 ms(`expiresIn: 600`), 한 번만 쓴다 |
  | Office 확인 주기 | 3000 ms |
  | 살아 있는 대기 코드 상한 | 100개. 넘으면 `429 RATE_LIMITED` |
  | `POST /api/mac/start` 제한 | 클라이언트 키마다 600000 ms에 10번 |
  | 허용·거절 시도 제한 | 사람마다 600000 ms에 10번 |
  | 하트비트 | 60000 ms(`BEAT_MS`), 켜질 때 한 번 바로 |
  | 꺼짐 판정 | 마지막 하트비트가 180000 ms보다 오래됨, 또는 아직 없음 |
  | 담당 repo 확인 | 300000 ms(`RECHECK_MS`) |
  | 다시 켜기 대기 상한 | 600000 ms |
  | Mac 이름 | 1–60자, 제어 문자 없음. 기본은 `os.hostname()`에서 `.local`을 뺀 것 |
  | 하트비트 `detail` | 200자 이하, 제어 문자 없음 |
  | Mac API 프로토콜 | 헤더 `x-pazmo-hub-protocol: 4`(`HUB_MAC_PROTOCOL`) |
  | 파일 | `<dataRoot>/team/mac-link.json`(0600), `<dataRoot>/repos/<이름>/`, `~/Library/LaunchAgents/com.pazmo.office.plist`(0644), `<dataRoot>/team/launchd.log` |

- **오류 코드:**
  - Hub(`HubError`): `MAC_CODE_INVALID` 410, `MAC_CODE_USED` 409, `RATE_LIMITED` 429, `NOT_OWNER` 403, `UNAUTHORIZED` 401, `INVALID` 400, `PROTOCOL_MISMATCH` 426.
  - Office(`OfficeError`): `MAC_DENIED`, `MAC_CODE_EXPIRED`, `HUB_TOO_OLD`, `MAC_LINK_INVALID`, `MAC_LINK_PERMISSIONS`, `CLONE_DIR_TAKEN`, `LAUNCHD_FAILED`. 기존 `TASK_ACTIVE`·`PLATFORM`·`GIT_FAILED`도 쓴다.
  - Hub 메시지와 Office가 사람에게 보이는 줄은 쉬운 한국어로 쓰고, 다시 할 명령을 함께 적는다. 내부 오류 메시지는 영어다(지금 규칙).
- **시험:**
  - Hub는 `startTestHub`(TLS, `tests/hub-fixture.mjs`)를 쓴다. OpenShift 모드 화면은 `hub-openshift-server.test.mjs`의 `proxyHub`처럼 HTTP로 띄운다.
  - Office 쪽 Hub 호출은 `call`을 주입한다. 시험 CA를 넣은 `hubCall`이다.
  - git origin은 임시 폴더의 로컬 bare repo다. 시험 HOME의 `.gitconfig`에 `url."file://<bare>".insteadOf = https://github.example.com/team/<이름>.git`을 둔다. 그러면 `https://<원격>.git` clone이 bare로 간다.
  - `gh`는 가짜 실행 파일이나 주입한 `gh` 함수다. `launchctl`·`open`은 주입한 runner가 인자를 기록한다.

## 판정 (결정 파일과 설계가 열어 둔 것, 이 계획에서 정함)

| 판정 | 이유 |
|---|---|
| **Mac API는 `/api/mac/*`, 프로토콜 헤더는 `"4"`다.** 다른 값이나 없음은 426 `PROTOCOL_MISMATCH`, `expected:"4"`다 | "`/api/link/*`와 같은 헤더 규칙". 1·2·3과 겹치지 않는 새 번호로, Mac 경로가 없는 옛 Hub와 구분한다 |
| **Hub에 요청 제한기를 새로 둔다(메모리, 고정 창).** `/api/mac/start`는 클라이언트 키마다 10번/600000 ms다. 키는 TLS 모드에서 소켓 주소, OpenShift 모드에서 `x-forwarded-for`의 **마지막** 값이다. 대기 코드는 Hub 전체에서 100개까지다. 웹 허용·거절은 사람마다 10번/600000 ms다 | 결정은 "다른 인증 없는 POST처럼"이라 했지만 지금 Hub에는 IP 제한이 없다. 라우터가 덧붙이는 마지막 값만 클라이언트가 위조할 수 없다. 사용자 코드 추측은 로그인한 사람만 할 수 있고 시도 수로 막는다 |
| **한 사람의 Mac 연결은 하나만 살아 있다.** 새 Mac이 토큰을 받는 순간 그 사람의 이전 Mac과 그 Mac이 받은 repo 연결을 해제한다. `/mac`은 이것을 알려 준다 | 연결은 (사람, repo)마다 하나다(`#issueLink`가 앞 연결을 끊음). 두 Mac이 같은 repo 연결을 서로 끊는 일을 막는다. Hub도 한 사람에게 Task를 하나만 준다 |
| **Mac 토큰은 허용 뒤 첫 확인 때 만들어 한 번만 준다.** 이미 준 코드로 다시 확인하면 `expired`다. 응답을 잃으면 연결을 다시 한다 | Hub는 해시만 저장해서 허용 때 만든 토큰을 나중에 다시 줄 수 없다 |
| **`GET /api/mac/repos`의 각 항목에 `linked`를 더한다(이 Mac이 받은 살아 있는 연결이 있음).** `POST /api/mac/revoke`(자기 해제)도 더한다 | 두 번째 실행에서 이미 맞는 연결을 다시 받지 않기 위해서다(멱등). `mac disconnect`가 Hub 토큰을 끊는 데 쓴다 |
| **`hub_links`에 `mac_id` 열을 더한다.** `link()`는 Mac이 해제된 연결도 거부한다 | "해제한 Mac의 토큰과 그 Mac이 받은 repo 연결이 멈춘다". 해제 때 `revoked_at`을 쓰는 것과 별개로 읽을 때도 막는다 |
| **머리글 이름:** 일하는 중(`working`), 대기 중(`idle`), 쉬는 중(한도)(`limited`), 잠김(`locked`), 꺼짐(N분 전)(마지막 하트비트가 180000 ms보다 오래됨), 꺼짐(아직 연락 없음), 연결된 Mac 없음 | 결정의 네 이름에 `idle` 이름이 없다. 하트비트 세 번을 놓치면 꺼짐이다 |
| **Mac API는 두 모드에서 다 동작한다.** `/install.sh`와 `/mac`의 설치 명령은 OpenShift 모드(`kind:"proxy"`)에서만 준다. LAN 모드의 `/mac`은 지금의 `/start` 흐름을 쓰라고 말한다 | 설치기는 공인 인증서 Hub만 대상이다. 시험은 TLS Hub와 시험 CA로 API를 그대로 쓴다 |
| **clone 주소는 `https://<remote>.git`이다.** Hub의 `remote`(host/path)를 쓴다. 인증은 그 사람의 git 설정(gh credential helper)이다 | Hub는 정규화한 host/path만 갖는다. 설치기는 `gh auth login --git-protocol https`로 로그인한다 |
| **clone 위치는 `<dataRoot>/repos/<이름>`이다.** 이름에서 `[A-Za-z0-9._-]` 밖의 글자는 `-`로 바꾸고, 앞의 `.`를 빼고, 80자까지만 쓴다. 담당 repo 목록에 같은 이름이 둘이면 `<이름>-<repoId 앞 8자>`다. `<dataRoot>/repos/.<이름>.<uuid>.partial`에 clone한 뒤 이름을 바꾼다. 실패하면 그 폴더를 지운다. 전체 맞추기를 시작할 때 남은 `.*.partial`도 지운다 | Hub는 repo 이름이 같아도 받는다(`addRepo`). 중간에 끊긴 clone이 다음 실행에서 "있는 폴더"로 오인되면 안 된다 |
| **이미 있는 폴더는 `git config --get remote.origin.url`을 정규화해 본다.** 같은 repo면 그대로 쓰고, 다르면 `CLONE_DIR_TAKEN`으로 건너뛰며 손대지 않는다 | `remote get-url`은 insteadOf를 펼친다. 설정 원문으로 판정해야 사람마다 같은 결과가 나온다 |
| **사람이 자기 폴더로 이미 등록한 repo(같은 remote)는 clone하지 않고 그 등록을 쓴다.** 그 폴더의 `hub-link.json`에 `macId`가 없으면(연결 문자열로 만든 것) 건드리지 않는다. `HubLinkConfig`에 `macId?: string`을 더한다 | "사용자가 등록한 자기 repo 폴더를 Office가 바꾸지 않는다". Mac이 쓴 연결 파일만 Mac이 고친다 |
| **연결 파일을 새로 받는 조건:** 파일이 없음. 또는 파일에 `macId`가 있는데, 그것이 이 Mac 것이 아니거나 Hub가 `linked:false`라 함 | 해제 뒤 다시 연결하거나 담당자가 빠졌다 다시 들면 연결이 죽어 있다. 살아 있는 연결은 다시 받지 않는다(멱등) |
| **gh 로그인이 없는 Git 호스트는 `mac connect`가 터미널에 붙어 있을 때(표준 입력이 TTY) 그 자리에서 `gh auth login --hostname <host> --web --git-protocol https`를 띄운다(표준 입출력 물려줌).** 로그인이 끝나면 다시 확인하고 이어 간다. 터미널이 없으면(LaunchAgent, 켜진 Office) 로그인을 띄우지 않고 그 호스트의 repo를 건너뛰며, 같은 명령을 `problem`으로 남긴다. 로그인을 띄웠는데도 안 되면 건너뛰고 같은 명령을 남긴다 (컨트롤러 수정 2026-11-04) | 회사 repo는 github.com이 아닌 호스트에 있을 수 있다. 설치기는 github.com만 로그인하므로, 안내만 하면 팀원이 터미널 명령을 한 번 더 쳐야 한다(설계의 실패 조건). 설치기가 `mac connect`를 TTY로 실행하므로 여기서 띄울 수 있다 |
| **clone 전에 그 호스트마다 한 번 `gh auth setup-git --hostname <host>`를 부른다(full에서 clone할 repo가 있을 때만).** 실패하면 그 호스트의 repo는 `problem`에 `gh auth setup-git --hostname <host>`를 남긴다. clone이 자격 문제("terminal prompts disabled", "Authentication failed")로 실패해도 같은 명령을 남긴다 (컨트롤러 수정 2026-11-04) | `https://` clone은 gh의 git 자격 도우미가 있어야 한다. `gh auth login`에서 "Git 인증" 질문에 아니오를 했거나 예전에 토큰으로만 로그인한 사람도 터미널 명령 없이 clone되게 한다. `setup-git`은 같은 값을 다시 써서 여러 번 불러도 같다 |
| **Mac 연결이 있으면 등록된 repo가 0개여도 팀 Office가 켜진다.** 이때는 하트비트와 담당 repo 확인만 한다. `createTeamOffice`, `startTeam`, `upTeam`의 `NO_REPOS`는 Mac 연결이 없을 때만 난다 | 담당 repo가 아직 없는 사람도 "내 Mac"이 켜짐으로 보여야 한다. 그래야 repo가 생기면 5분 안에 스스로 맞춘다 |
| **`up --team`은 Mac 연결이 있고 팀 Office가 꺼져 있으면, 켜기 전에 repo 전체 맞추기(`syncBeforeUp`)를 한다.** 그 실패(Hub에 닿지 않음 등)는 로그 한 줄만 남기고 켜기를 막지 않는다 | LaunchAgent와 스스로 다시 켜기가 "`up`과 같은 켜기 경로"를 쓴다. 로그인 직후에는 VPN이 아직 없을 수 있다 |
| **스스로 다시 켜기:** 팀 서비스는 가져가기를 멈춘다(`holding`). 그리고 그 사람의 PATH·HOME·ssh agent로 `node bin/pazmo-office.mjs mac restart --data-dir <root>`를 분리 실행한다. `mac restart` = `stopTeam` → `up --team --no-open`이다. 600000 ms 안에 멈추지 않으면 대기를 풀고 다음 확인에서 다시 한다 | 레지스트리는 팀 Office가 꺼져 있을 때만 바뀐다(`TEAM_RUNNING`). 자기 자식 프로세스로는 자기를 멈추고 다시 켤 수 없다. 결정 시점과 멈춤 사이에 Task를 가져가지 않아야 한다 |
| **연결만 바뀐 것(등록된 repo의 연결이 죽음)은 켜진 Office가 그 자리에서 새로 받는다.** 다시 켜지 않는다 | 연결 파일은 레지스트리가 아니다. 팀 Office는 준비 안 된 repo의 연결 파일을 5분마다 다시 읽는다(`recheck`) |
| **`limited`는 열린 기록이 실행기 계정·준비를 기다릴 때(`waitingOf`)와, live인데 실행기가 준비되지 않았을 때다.** `detail`은 실행기 이름과 이유다 | D37·D39 기다림. 실행기 로그인이 풀린 사람도 "쉬는 중"으로 보이고 이유가 붙는다 |
| **LaunchAgent:** `ProgramArguments`는 `[node, <packageRoot>/bin/pazmo-office.mjs, up, --team, --no-open, --data-dir, <root>]`이다. `AbandonProcessGroup` true다. PATH는 `<node 폴더>:/opt/homebrew/bin:<HOME>/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, `LANG` `en_US.UTF-8`이다. `mac connect`를 실행한 환경에 `NODE_EXTRA_CA_CERTS`가 있으면(절대 경로일 때만) 그 값도 넣는다(컨트롤러 수정: 사내 인증서 허브로 하는 로컬 실제 확인용). node는 `/opt/homebrew/opt/node@24/bin/node`가 지금 node와 같은 실행 파일이면 그 경로, 아니면 `process.execPath`다. 설치는 `bootout`(실패 무시) 다음 `bootstrap`이다 | `up`은 분리된 서비스를 띄우고 끝난다. launchd가 그 뒤 남은 것을 정리하지 않게 한다. `brew upgrade`가 Cellar 경로를 바꿔도 동작해야 한다. 다시 연결해도 같은 이름으로 다시 올린다 |
| **`mac connect`는 Office가 켜지기를 기다리지 않는다.** 로그 위치와 "몇 분 뒤 허브의 '내 Mac'에서 확인"을 말한다. 기존 `mac-link.json`이 같은 Hub이고 토큰이 살아 있으면 다시 짝짓지 않는다 | 처음 `up`은 VM·이미지 준비로 몇 분 걸린다. 다시 실행해도 아무것도 바뀌지 않아야 한다 |
| **`mac disconnect`는 먼저 팀 Office를 멈춘다(`TASK_ACTIVE`면 아무것도 바꾸지 않고 거절).** 그다음 LaunchAgent 내리기 → Hub 해제 → Mac이 쓴 repo 연결 파일과 `mac-link.json` 삭제 순서다. Hub에 닿지 않으면 로컬은 정리하고 `hubRevoked:false`와 "웹 /mac에서 해제"를 말한다. 레지스트리와 clone은 남는다 | 결정: "clone은 남는다". 끊긴 Mac의 Office가 계속 돌며 401만 쌓지 않게 한다 |
| **설치기:** 전체를 `main() { … }; main "$@"`로 감싼다. 대화가 필요한 명령(`gh auth login`, `claude auth login`, `mac connect`)은 `/dev/tty`에서 읽는다. 열 수 없으면 `/dev/null`이다. Homebrew 위치는 `PAZMO_BREW_PREFIX`(기본 `/opt/homebrew`)다. 설치는 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`다. 응답은 `text/plain; charset=utf-8`이다 | `curl \| sh`에서는 표준 입력이 스크립트라 대화 명령이 스크립트를 먹는다. 내려받다 끊긴 스크립트는 아무것도 실행하지 않아야 한다. 시험이 실제 Homebrew를 건드리지 않아야 한다. launcher의 `prepareDependencies`와 같은 플래그다 |
| **Office 저장소·ref는 Hub 시작 때 검사한다(`installerConfig`).** 컨테이너(`main.ts`)는 `PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF` env를 읽는다. CLI `hub --public-url`은 기본값을 쓴다 | 스크립트에 작은따옴표로 넣는 값이라, 넣기 전에 형식을 막는다 |
| **새 Mac 행의 `last_seen`은 비어 있다(꺼짐(아직 연락 없음)).** 첫 하트비트에서 실제 상태가 된다 | Office가 켜지기 전에 "대기 중"으로 보이면 사실이 아니다 |

## Review Focus

1. **로그인하지 않은 사람이 허용 URL을 엶:** 401 화면이 "이 브라우저에서 초대 링크(또는 새 기기 링크)를 먼저 연 뒤 이 주소를 다시 열라"고 말하고, 새로 고침도 안내한다. 코드는 그대로 `pending`이라 로그인한 뒤 같은 URL로 허용된다. Task 4 시험이 고정한다.
2. **같은 코드를 두 번 허용하거나 만료 뒤 허용:** 두 번째 허용(같은 사람이든 다른 사람이든)은 409 `MAC_CODE_USED`이고 아무것도 바꾸지 않는다. 토큰은 처음 허용한 사람의 것으로 한 번만 나간다. 만료 뒤에는 410 `MAC_CODE_INVALID`이고 Office 확인은 `expired` → `MAC_CODE_EXPIRED`와 다시 할 명령이다. Task 1(저장소)·Task 4(웹)·Task 5(Office) 시험이 고정한다.
3. **clone이 중간에 실패한 repo:** 최종 경로에 폴더가 남지 않는다. 등록·연결하지 않는다. 다른 repo는 끝까지 처리하고, 그 repo는 쉬운 말 이유와 함께 보고된다. 다음 실행이 그 repo를 새로 clone한다. Task 6 시험이 고정한다.
4. **해제한 Mac이 repo 연결을 아직 갖고 있음:** Hub는 그 Mac 토큰과 그 Mac이 받은 모든 repo 연결을 401로 거부한다(Story `claim` 포함). 같은 사람이 연결 문자열로 만든 다른 repo 연결은 계속 된다. Office 하트비트는 401에서 로그 한 줄만 남기고 Mac 호출을 멈춘다. 다시 연결하면 죽은 연결을 모두 새로 받는다. Task 1·2(Hub)·Task 9(Office) 시험이 고정한다.
5. **Task가 열린 채 Office가 스스로 다시 켜짐:** 열린 기록이 있거나 엔진이 돌면 다시 켜지 않는다. 기다린다는 로그는 한 줄이다. 기록이 닫힌 뒤의 확인에서 한 번만 다시 켠다. 다시 켜기로 정한 뒤 멈출 때까지 새 Task를 가져가지 않는다. 600000 ms 안에 멈추지 않았으면 대기를 푼다. Task 9 시험이 고정한다.

---

### Task 1: Hub 저장소 — Mac 기기 흐름과 사람 단위 토큰

**Files:**
- Modify: `src/hub/store.ts`(SCHEMA, `#migrate`, `revokeMember`, `#issueLink`, `link`, `members`, 새 메서드)
- Modify: `tests/hub-fixture.mjs`(`startTestHub(t, { now, storeNow })`. `storeNow`를 `new HubStore(db, storeNow)`에 넘긴다)
- Test: `tests/hub-store-mac.test.mjs`

**Interfaces:**
- Produces(`src/hub/store.ts`):
  - `export const MAC_CODE_TTL = 600_000; export const MAC_OFFLINE_MS = 180_000; export const MAC_PENDING_LIMIT = 100;`
  - `export type MacState = "working" | "idle" | "limited" | "locked"`
  - `export type MacAuth = { id: string; member: Member }`
  - `export type MacView = { id: string; name: string; state: MacState | "off"; detail: string | null; lastSeen: number | null; createdAt: number }`
  - `export type MacBadge = { state: MacState | "off" | "none"; lastSeen: number | null }`
  - `export type MacRepo = { repoId: string; name: string; remote: string; linked: boolean }`
  - `export type MacPoll = { state: "pending" } | { state: "approved"; macToken: string; macId: string; member: { id: string; name: string } } | { state: "denied" } | { state: "expired" }`
  - `HubStore.startMac(name: string): { deviceCode: string; userCode: string; expiresIn: number }`
  - `HubStore.macCode(userCode: string): { name: string; createdAt: number; state: "pending" | "approved" | "denied" } | null`: 모르는 코드·만료·이미 준 코드는 null이다.
  - `HubStore.approveMac(by: Member, userCode: string): void`, `HubStore.denyMac(by: Member, userCode: string): void`
  - `HubStore.pollMac(deviceCode: string): MacPoll`
  - `HubStore.mac(raw: string): MacAuth | null`: 해제된 Mac, 회수된 팀원은 null이다.
  - `HubStore.macRepos(m: MacAuth): MacRepo[]`: 그 사람이 담당인 repo만, 이름순이다.
  - `HubStore.macLink(m: MacAuth, repoId: string): { token: string; member: { id: string; name: string }; repoId: string; repoName: string }`
  - `HubStore.macHeartbeat(m: MacAuth, state: string, detail: string | null): { ok: true }`
  - `HubStore.revokeMac(by: Member, macId: string): { memberId: string }`, `HubStore.revokeOwnMac(m: MacAuth): { ok: true }`
  - `HubStore.macs(memberId: string): MacView[]`(살아 있는 것만, 새것부터), `HubStore.macBadge(memberId: string): MacBadge`(가장 새 Mac)
  - `MemberView`에 `macs: MacView[]`를 더한다.

- [ ] **Step 1: 실패하는 시험(시계 주입).**
  - "startMac stores only hashes": `hub_mac_codes`·`hub_macs`의 모든 행을 문자열로 덤프한다. 그 안에 원래 기기 코드·사용자 코드·Mac 토큰이 없다. 사용자 코드는 `/^[BCDFGHJKLMNPQRSTVWXZ]{4}-\d{4}$/`, 기기 코드는 `/^[A-Za-z0-9_-]{43}$/`, `expiresIn`은 600이다.
  - "pollMac answers pending, then approved with the token exactly once, then expired": 허용 뒤 첫 확인만 `macToken`(43자)·`macId`·`member`를 준다. 두 번째 확인은 `{state:"expired"}`다. `mac(token)`은 그 사람이다.
  - "a second approve is MAC_CODE_USED and changes nothing, by the same or another member": 토큰의 `member.id`는 처음 허용한 사람이다.
  - "after 600000 ms approve is MAC_CODE_INVALID and poll says expired"
  - "deny makes poll answer denied; a denied code cannot be approved (MAC_CODE_USED)"
  - "a user code is read without its hyphen and in lower case; a malformed one is MAC_CODE_INVALID"
  - "startMac refuses a blank, 61-character or control-character name with INVALID; the 101st live code is RATE_LIMITED"
  - "a member's second Mac revokes the first Mac and the links it minted"
  - "macRepos lists only owned repos; linked is true only for a live link this Mac minted"
  - "macLink revokes the member's earlier link to the repo, marks the new one with the Mac, is NOT_OWNER for a repo not owned and NOT_FOUND for an unknown one"
  - "revokeMac revokes the Mac and every link it minted; link() refuses them; the same member's connection-string link to another repo still works" **[Review Focus 4]**
  - "a member revokes only their own Mac (FORBIDDEN otherwise); an admin revokes anyone's"
  - "revokeMember revokes the member's Macs"
  - "macHeartbeat refuses an unknown state and a 201-character detail (INVALID); macBadge is none, then the newest Mac's state, then off after 180000 ms without a heartbeat; a new Mac is off with lastSeen null"
  - "an old hub.sqlite gains hub_links.mac_id and its links keep working": 이 버전 전 스키마로 만든 파일을 연다.
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-store-mac.test.mjs`
- [ ] **Step 3: 구현.** 표는 이대로다.

  ```sql
  CREATE TABLE IF NOT EXISTS hub_mac_codes(device_hash TEXT PRIMARY KEY,user_hash TEXT NOT NULL,name TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,member_id TEXT REFERENCES hub_members(id),decision TEXT CHECK(decision IN ('approved','denied')),decided_at INTEGER,delivered_at INTEGER);
  CREATE INDEX IF NOT EXISTS hub_mac_codes_user ON hub_mac_codes(user_hash);
  CREATE TABLE IF NOT EXISTS hub_macs(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_seen INTEGER,state TEXT NOT NULL DEFAULT 'idle' CHECK(state IN ('working','idle','limited','locked')),detail TEXT,revoked_at INTEGER);
  ```

  - `#migrate`는 `hub_links`에 `mac_id TEXT`가 없으면 `ALTER TABLE`로 더한다.
  - 사용자 코드는 `randomInt`로 만든다. 살아 있는(만료 전, 아직 안 준) 코드와 해시가 같으면 다시 만든다.
  - `startMac`은 하루 지난 코드 행을 지운다.
  - 토큰을 주는 `pollMac`은 한 트랜잭션에서 다음을 한다: 이전 Mac과 그 연결 해제 → `hub_macs` 행 추가(`last_seen` NULL) → `delivered_at` 기록.
  - `approveMac`·`denyMac`의 판정 순서: 모르는 코드 → `MAC_CODE_INVALID`. 이미 결정된 코드(전달 여부와 관계없이) → `MAC_CODE_USED`. 결정 없이 만료된 코드 → `MAC_CODE_INVALID`.
  - `link()`는 `LEFT JOIN hub_macs`로 `mac_id`가 있는 연결의 Mac이 살아 있는지 본다.
  - `#issueLink(memberId, repoId, macId: string | null = null)`.
  - 오류 문구:
    - `MAC_CODE_INVALID`: "코드가 만료됐거나 이미 쓰였습니다. Mac 터미널에서 설치 명령을 다시 실행하세요."
    - `MAC_CODE_USED`: "이미 허용하거나 거절한 코드입니다."
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-store*.test.mjs tests/hub-link.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: pair a Mac to a member on the Hub with a one-time device code`

### Task 2: Hub Mac API (`/api/mac/*`)

**Files:**
- Create: `src/hub/mac-api.ts`, `src/hub/rate-limit.ts`
- Modify: `src/hub/protocol.ts`(`export const HUB_MAC_PROTOCOL = "4"`), `src/hub/server.ts`(`/api/mac/` 연결, 오류를 JSON으로, `clientKey`)
- Test: `tests/hub-mac-api.test.mjs`

**Interfaces:**
- Consumes: Task 1 저장소 메서드.
- Produces:
  - `createRateLimit(limit: number, windowMs: number, now?: () => number): { take(key: string): boolean }`: 고정 창이다. 키는 10000개까지 두고, 넘으면 창이 끝난 키부터 버린다.
  - `macApi(store: HubStore, o: { base: () => string; clientKey: (req: IncomingMessage) => string; startLimit: ReturnType<typeof createRateLimit> }): LinkHandler`
  - `server.ts`의 `clientKey`: TLS는 `req.socket.remoteAddress`다. proxy는 `x-forwarded-for`를 쉼표로 나눈 마지막 값이고, 없으면 소켓 주소다.
  - 경로(본문은 JSON, `FORM_LIMIT`):

    | 경로 | 인증 | 요청 | 200 응답 |
    |---|---|---|---|
    | `POST /api/mac/start` | 없음, 제한 | `{name}` | `{deviceCode, userCode, approveUrl:"<base>/mac/approve?code=<userCode>", expiresIn:600}` |
    | `POST /api/mac/token` | 없음 | `{deviceCode}` | `MacPoll` |
    | `GET /api/mac/repos` | Bearer Mac 토큰 | — | `{repos: MacRepo[]}` |
    | `POST /api/mac/link` | Bearer | `{repoId}` | `{token, member:{id,name}, repoId, repoName}` |
    | `POST /api/mac/heartbeat` | Bearer | `{state, detail?: string \| null}` | `{ok:true}` |
    | `POST /api/mac/revoke` | Bearer | `{}` | `{ok:true}` |

  - 401은 `{error:"UNAUTHORIZED", message:"이 Mac 연결이 해제됐습니다. 허브의 /mac에서 설치 명령을 다시 실행하세요."}`다.

- [ ] **Step 1: 실패하는 시험.**
  - "Mac routes need protocol 4: none, 2 or 3 is 426 PROTOCOL_MISMATCH with expected 4"
  - "an unknown Mac route is 404 and a wrong method 405, as JSON"
  - "start returns the codes, an approve URL on this hub without the device code, and expiresIn 600": `approveUrl`에 `deviceCode`가 없다.
  - "start refuses a bad name with 400 INVALID and a non-string body with 400"
  - "the 11th start from one client in 600000 ms is 429 RATE_LIMITED, a spoofed first X-Forwarded-For entry does not escape it, and another client is not limited": proxy 모드 Hub, `x-forwarded-for: "9.9.9.9, 10.0.0.1"`과 `"1.1.1.1, 10.0.0.1"`은 같은 키다.
  - "the device flow over HTTP: pending, approved with the token once, then expired": 허용은 저장소로 한다.
  - "a Mac token lists owned repos with linked flags and mints a link the Story claim accepts": 받은 토큰으로 `POST /api/link/story/claim`(프로토콜 3)이 200이다.
  - "link is NOT_OWNER and NOT_FOUND as JSON; heartbeat with state sleeping is 400 INVALID"
  - "after the web revokes the Mac, its token and every link it minted are 401, and the member's connection-string link still claims" **[Review Focus 4]**
  - "/api/mac/revoke revokes the calling Mac; the next call is 401"
  - "Mac API answers never set a cookie or return HTML, also on a 500": 응답의 `set-cookie`가 없고 `content-type`은 JSON이다.
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-mac-api.test.mjs`
- [ ] **Step 3: 구현.**
  - `link-api.ts`처럼 타입이 틀린 값은 바꾸지 않고 거부한다(`str`, `parse`). 그 도우미는 `mac-api.ts`에 같은 모양으로 둔다(link-api는 고치지 않는다).
  - 제한기는 `startHubServer`마다 하나다.
  - `handle`에서 `/api/mac/`은 `/api/link/` 다음, 브라우저 경로보다 앞에서 처리한다. `onRequest`의 `api` 판정에 `/api/mac/`을 더한다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-server.test.mjs tests/hub-openshift-server.test.mjs tests/hub-link-api.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: add the Hub's member-level Mac API with a start limit`

### Task 3: 설치기 `GET /install.sh`

**Files:**
- Create: `src/hub/installer.ts`
- Modify: `src/hub/server.ts`(`HubServerConfig.installer?: { officeRepo: string; officeRef: string }`, 경로), `src/hub/run.ts`(proxy 입력에 `officeRepo?`·`officeRef?`, `installerConfig`로 검사해 서버에 넘김), `src/hub/main.ts`(`PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF`)
- Test: `tests/hub-installer.test.mjs`

**Interfaces:**
- Produces:
  - `export const DEFAULT_OFFICE_REPO = "https://github.com/syjkim0125/pazmo-agent-office.git"; export const DEFAULT_OFFICE_REF = "main";`
  - `installerConfig(o: { officeRepo?: string; officeRef?: string }): { officeRepo: string; officeRef: string }`
    - repo는 `^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._-]+)+$`, ref는 `^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$`이고 `..`이 없다. 아니면 `ARGUMENT`.
  - `installScript(o: { hub: string; officeRepo: string; officeRef: string }): string`
  - `GET /install.sh`: 세션 없이, Host 검사 뒤 연다. `c.installer`가 있을 때만 200 `text/plain; charset=utf-8`이고, 없으면(LAN 모드) 404다.
- **스크립트 단계(`set -eu`, 순서대로, 메시지는 쉬운 한국어):**

  | 단계 | 동작 |
  |---|---|
  | 0 | `TTY=/dev/tty`; `(exec </dev/tty) 2>/dev/null \|\| TTY=/dev/null`. `BREW="${PAZMO_BREW_PREFIX:-/opt/homebrew}"`. `OFFICE="$HOME/.pazmo/office"` |
  | 1 | `uname -s`가 `Darwin`이 아니거나 `uname -m`이 `arm64`가 아니면 "Apple Silicon Mac에서만 설치할 수 있습니다"를 말하고 exit 1 |
  | 2 | `"$BREW/bin/brew"`가 없으면 `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`를 보여 주고 "설치한 뒤 이 명령을 다시 실행하세요"를 말한 뒤 exit 1. 우리 스크립트는 sudo를 쓰지 않는다 |
  | 3 | `PATH="$BREW/opt/node@24/bin:$BREW/bin:$PATH"`. `node@24 git gh colima docker` 중 `brew list --versions <f>`가 실패하는 것만 모아 `brew install <모은 것>` |
  | 4 | `command -v claude`가 없으면 `brew install --cask claude-code` |
  | 5 | `$OFFICE/.git`이 있으면 `git -C "$OFFICE" fetch --depth 1 origin '<ref>'`와 `git -C "$OFFICE" checkout --detach FETCH_HEAD`. 없으면 `git clone --depth 1 --branch '<ref>' '<repo>' "$OFFICE"`. 그 뒤 `cd "$OFFICE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund` |
  | 6 | `gh auth status --hostname github.com`이 실패하면 `gh auth login --hostname github.com --web --git-protocol https <"$TTY"` |
  | 7 | `claude auth status` 출력에 `"loggedIn": true`가 없으면 `claude auth login <"$TTY"` |
  | 8 | `exec "$BREW/opt/node@24/bin/node" "$OFFICE/bin/pazmo-office.mjs" mac connect --hub '<hub>' <"$TTY"` |

  - 모든 단계는 `run_step "<단계 이름>" <명령…>`으로 부른다. 실패하면 단계 이름과 다시 할 명령(`curl -fsSL '<hub>/install.sh' | sh`)을 stderr에 쓰고 exit 1이다.
  - 전체가 `main() { … }` 안에 있고, 마지막 줄은 `main "$@"`다.

- [ ] **Step 1: 실패하는 시험(가짜 실행 파일).** 설치기 시험은 `$PREFIX/bin/{brew,git,gh,colima,docker,claude,npm}`, `$PREFIX/opt/node@24/bin/node`, PATH 앞의 `uname`을 하나의 `#!/bin/sh` 가짜로 만든다. 가짜는 인자를 기록하고 env(`FAKE_ARCH`, `FAKE_HAVE`, `FAKE_GH_OK`, `FAKE_CLAUDE_OK`, `FAKE_FAIL`)대로 답한다. `PAZMO_BREW_PREFIX=$PREFIX`, `HOME=<임시>`, `PATH=<uname 가짜>:/usr/bin:/bin`이다.
  - "install.sh is served in OpenShift mode as text/plain with this hub's origin, and is 404 in self-CA mode"
  - "the script passes sh -n and its last line is main \"$@\""
  - "on an Intel Mac it stops with exit 1 and runs no brew"
  - "without Homebrew it prints the official install command and stops with exit 1"
  - "only missing formulae are installed, and claude-code only when claude is missing": `FAKE_HAVE="git node@24 docker"` → `brew install gh colima` 한 줄.
  - "a fresh Mac clones the Office at the served ref; an existing one fetches and checks out FETCH_HEAD; npm ci --omit=dev runs in it"
  - "gh auth login and claude auth login run only when logged out"
  - "it ends with node@24 running mac connect --hub <origin>"
  - "a failed step names the step and the rerun command and exits 1"
  - "installerConfig refuses an http repo, a quote, a ref with .. or a space (ARGUMENT); main serves PAZMO_OFFICE_REPO and PAZMO_OFFICE_REF"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-installer.test.mjs`
- [ ] **Step 3: 구현.** 값은 모두 작은따옴표 안에 넣는다. `installerConfig`와 `parsePublicUrl`이 따옴표를 이미 막았다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-openshift-run.test.mjs tests/hub-main-signals.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: serve a one-line Mac installer from an OpenShift Hub`

### Task 4: Hub 웹 — "이 Mac 연결", 허용, 머리글 "내 Mac"

**Files:**
- Modify: `src/hub/pages.ts`(`Chrome`, `layout`, 모든 페이지 함수의 마지막 인자, 새 페이지), `src/hub/server.ts`(경로, `chrome`, 허용 시도 제한)
- Test: `tests/hub-mac-pages.test.mjs`

**Interfaces:**
- Consumes: Task 1 `macs`·`macBadge`·`macCode`·`approveMac`·`denyMac`·`revokeMac`, Task 3 `c.installer`.
- Produces:
  - `export type Chrome = { trust?: boolean; mac?: MacBadge | null }`. 페이지 함수의 마지막 인자 `trust = true`를 `chrome: Chrome = {}`로 바꾼다. 서버는 로그인한 화면마다 `{ trust, mac: store.macBadge(me.id) }`를 넘긴다.
  - `layout`의 nav 끝에 `<a class="pill" href="/mac">내 Mac: <이름></a>`이 붙는다. 상태가 `none`이면 `연결된 Mac 없음`이다.
  - `page.mac(me, csrf, o: { macs: MacView[]; install: string | null; approved: boolean }, chrome)`
    - `install`이 있으면 `<pre id="copy-value">curl -fsSL <base>/install.sh | sh</pre>`, 복사 버튼, `/copy.js`, 하는 일 안내(설치할 것, 브라우저 로그인, 코드 허용, 담당 repo clone, 로그인 때 자동 실행, 이전 Mac 연결은 해제됨)를 보인다.
    - `install`이 없으면(LAN 모드) "이 허브는 사내 인증서를 써서 설치 한 줄을 쓸 수 없습니다. 지금처럼 '내 Office 연결'(/start)로 repo마다 연결하세요"를 보인다.
    - 내 Mac 표: 이름, 상태, 마지막 확인, [해제]. 꺼짐이면 "Mac에서 설치 명령을 다시 실행하면 켜집니다"를 함께 보인다.
  - `page.macApprove(me, csrf, code: string, info: { name: string; createdAt: number }, chrome)`: Mac 이름, 코드, 요청 시각, "터미널의 코드와 같고 지금 내 앞의 Mac일 때만 허용"을 보인다. [이 Mac 허용]·[거절] 폼(CSRF)이 있다.
  - `page.macCodeGone(me, chrome)`(410), `page.macSignedOut()`(401)
  - 경로:

    | 경로 | 동작 |
    |---|---|
    | `GET /mac` | 내 Mac 화면. `?approved=1`이면 "허용했습니다. 터미널로 돌아가세요" |
    | `GET /mac/approve?code=` | 로그인 안 함 → 401 `macSignedOut`. `macCode`가 null → 410 `macCodeGone`. 이미 결정됨 → 409 오류 화면. 아니면 `macApprove` |
    | `POST /mac/approve`, `POST /mac/deny` | 폼 `code`. 사람마다 10번/600000 ms(넘으면 429). 허용 → `/mac?approved=1`, 거절 → `/mac` |
    | `POST /macs/<id>/revoke` | `revokeMac`. 관리자가 남의 Mac을 해제했으면 `/members`, 아니면 `/mac`로 간다 |
    | `GET /start` | 설치기가 있고 `macBadge`가 `none`이면 맨 위에 "이 Mac 연결 — 처음 한 번, 명령 한 줄" 안내와 `/mac` 링크를 보인다 |
    | `GET /members`(관리자) | 팀원마다 Mac 이름·상태와 [Mac 해제]를 보인다 |

- [ ] **Step 1: 실패하는 시험.**
  - "an approve link opened without signing in is 401, says to open the invite or device link first and to refresh, and leaves the code pending; after entering, the same URL approves it" **[Review Focus 1]**
  - "approving binds the Mac to the signed-in member; a second approve is 409 and the token still names the first member; an approve after 600000 ms is 410" **[Review Focus 2]**: `startTestHub(t, { storeNow })`
  - "deny makes the Office's poll answer denied"
  - "approve and deny need this hub's Origin and the CSRF token"
  - "the 11th approve attempt by one member in 600000 ms is 429"
  - "the header names my newest Mac's state: 일하는 중, 대기 중, 쉬는 중(한도), 잠김, 꺼짐(, and 연결된 Mac 없음 with a link to /mac"
  - "/mac in OpenShift mode shows curl -fsSL <origin>/install.sh | sh with a copy button and loads copy.js; in self-CA mode it shows the /start note and no command"
  - "/start nudges a member without a Mac to /mac in OpenShift mode only"
  - "a member revokes their own Mac; another member's revoke is 403; an admin revokes from /members"
  - "a Mac name with <script> is escaped on the approve page, /mac and /members"
  - 기존 "other pages load no script" 시험은 그대로 통과한다(`/`, `/repos`, 요청 화면).
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-mac-pages.test.mjs`
- [ ] **Step 3: 구현.**
  - `/mac/approve`의 로그인 안 함 분기는 세션 확인 바로 뒤, 일반 `signedOut`보다 앞이다.
  - 상태 이름은 `pages.ts`의 `MAC_LABEL`에 둔다. 꺼짐 시각은 지금의 `ago()`를 쓴다.
  - 허용 시도 제한은 Task 2의 `createRateLimit`을 사람 id로 쓴다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/hub-server.test.mjs tests/hub-start-page.test.mjs tests/hub-decline-page.test.mjs tests/hub-openshift-server.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: let a member allow a Mac and see its state on the Hub`

### Task 5: Office의 Mac 연결 클라이언트 (`src/team/mac.ts`)

**Files:**
- Create: `src/team/mac.ts`
- Test: `tests/team-mac.test.mjs`

**Interfaces:**
- Consumes: Task 2 경로, `hubCall`(`src/runtime/hub-link.ts`), `teamDir`(`src/team/registry.ts`), `import type { MacRepo, MacState, MacPoll }`(`src/hub/store.ts`).
- Produces:
  - `export const MAC_POLL_MS = 3000`
  - `export type MacLinkFile = { version: 1; hub: string; macId: string; macToken: string; memberId: string; memberName: string; name: string }`
  - `macLinkPath(root: string): string`(`<root>/team/mac-link.json`), `readMacLink(root): MacLinkFile | null`, `writeMacLink(root, value): void`(임시 파일 → rename, 0600, 폴더 0700), `removeMacLink(root): void`
  - `export type MacCall = (target: { hub: string; token?: string }, method: "GET" | "POST", path: string, body?: unknown) => Promise<unknown>`
  - `export const macCall: MacCall`: `hubCall({hub, caPem:null, fingerprint:null, token}, …, HUB_MAC_PROTOCOL)`, 시스템 신뢰다.
  - `defaultMacName(): string`
  - `pairMac(o: { hub: string; name: string; open: (url: string) => Promise<void>; say: (line: string) => void; call?: MacCall; sleep?: (ms: number) => Promise<void>; now?: () => number; pollMs?: number }): Promise<{ macId: string; macToken: string; member: { id: string; name: string } }>`
  - `export type MacClient = { repos(): Promise<MacRepo[]>; link(repoId: string): Promise<{ token: string; member: { id: string; name: string }; repoId: string; repoName: string }>; heartbeat(state: MacState, detail: string | null): Promise<void>; revoke(): Promise<void> }`
  - `macClient(file: MacLinkFile, call?: MacCall): MacClient`

- [ ] **Step 1: 실패하는 시험.** 실제 Hub는 `startTestHub`이고, `call`은 시험 CA를 넣은 `hubCall`이다.
  - "pairMac prints the user code, opens the approve URL, and returns the token once the web approves": `open`이 불리면 시험이 웹으로 허용한다. `say`에 코드와 URL이 있다.
  - "an open that fails only tells the person to open the URL themselves"
  - "pairMac stops with MAC_DENIED on deny and MAC_CODE_EXPIRED when expiresIn passes, both naming the rerun command" **[Review Focus 2]**: 가짜 `call`·`now`
  - "pairMac keeps polling through a network error and a 503 until approved"
  - "a Hub without the Mac routes (426, or a 401 HTML page) is HUB_TOO_OLD"
  - "pairMac refuses an http hub, a path, a query or user info"
  - "nothing pairMac says or throws contains the device code or the token"
  - "mac-link.json is written 0600 under <root>/team; a group-readable one is MAC_LINK_PERMISSIONS; a corrupt one is MAC_LINK_INVALID without its content"
  - "macClient refuses a reply of the wrong shape with HUB_BAD_RESPONSE and sends protocol 4 with the Bearer token"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-mac.test.mjs`
- [ ] **Step 3: 구현.**
  - 응답 검사는 `story-link.ts`의 `isObject`·`badResponse` 패턴이다.
  - 확인 실패 중 다음은 기다렸다 다시 묻는다: 연결 오류, 5xx, `HUB_TIMEOUT`. 다음은 `HUB_TOO_OLD`다: 426, 404, JSON이 아닌 응답(`HUB_BAD_RESPONSE_*`).
  - 사람에게 보이는 줄은 두 줄이다: "브라우저에서 이 Mac을 허용해 주세요: <url>", "코드: <userCode> (10분 안에)".
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: pair this Mac with the Hub from the Office`

### Task 6: 담당 repo clone·등록·연결 (`src/team/mac-sync.ts`)

**Files:**
- Create: `src/team/mac-sync.ts`
- Modify: `src/team/branch.ts`(`cloneRepo`, `originUrl` export), `src/runtime/hub-link.ts`(`HubLinkConfig.macId?: string`)
- Modify: `tests/git-fixture.mjs`(`gitOrigins(t, names)`: 이름마다 bare origin, insteadOf가 든 HOME, `remote(name)` = `github.example.com/team/<name>`)
- Test: `tests/team-mac-sync.test.mjs`

**Interfaces:**
- Consumes: Task 5 `MacClient`·`readMacLink`, `addTeamRepo`·`removeTeamRepo`·`readTeam`·`teamRunning`(registry), `locate`, `readLinkConfig`·`writeLinkConfig`·`removeLinkConfig`, `ghStatus`·`remoteHost`(gh.ts), `normalizeRemote`.
- Produces:
  - `cloneRepo(url: string, target: string, env: GitEnv): Promise<void>`: `git clone --no-recurse-submodules -- <url> <target>`, 600000 ms.
  - `originUrl(dir: string, env: GitEnv): Promise<string | null>`: `git -C <dir> config --get remote.origin.url`. 종료 코드 1이면 null이다.
  - `reposDir(root: string): string`, `cloneDirFor(root: string, repo: MacRepo, all: MacRepo[]): string`
  - `export type MacSyncDeps = { root: string; hub: string; macId: string; member: { id: string; name: string }; client: Pick<MacClient, "repos" | "link">; git: GitEnv; gh?: (host: string) => Promise<GhResult>; ghLogin?: ((host: string) => Promise<void>) | null; setupGit?: (host: string) => Promise<boolean>; say: (line: string) => void }`
    - `ghLogin`: 터미널이 있을 때만 CLI가 넘긴다(기본 null = 띄우지 않음). `setupGit` 기본은 `gh auth setup-git --hostname <host>`를 `ghStatus`와 같은 env로 부르고 exit 0이면 true다.
  - `export type MacRepoResult = { repoId: string; name: string; project: string | null; cloned: boolean; registered: boolean; linked: boolean; problem: string | null }`
  - `export type MacSyncResult = { repos: MacRepoResult[]; removed: string[]; pending: { add: string[]; remove: string[] } }`
  - `syncMacRepos(d: MacSyncDeps, mode: "full" | "links-only"): Promise<MacSyncResult>`
  - `syncBeforeUp(root: string, o?: { client?: MacClient; git?: GitEnv; gh?: (host: string) => Promise<GhResult>; say?: (line: string) => void }): Promise<void>`: Mac 연결이 없거나 `teamRunning(root)`면 아무것도 하지 않는다. 아니면 `full`이다. 어떤 실패도 던지지 않고 `say`로 한 줄만 남긴다.
- **규칙(담당 repo마다, Hub 목록 순서):**

  | 단계 | full | links-only(켜진 Office) |
  |---|---|---|
  | gh | 호스트마다 한 번 `gh(host)`. 안 됨 → `ghLogin`이 있으면 띄우고 다시 `gh(host)`. 그래도 안 됨 → `problem`=안내, 이 repo는 끝. clone할 repo가 있는 호스트는 그 전에 한 번 `setupGit(host)`(false → `problem`=`gh auth setup-git` 안내, 그 호스트의 clone은 끝) | 묻지 않는다 |
  | 폴더 | 같은 remote로 등록된 repo가 있으면 그것. 없으면 `cloneDirFor`: 있는 폴더는 `originUrl` 판정(같음 → 씀, 다름 → `CLONE_DIR_TAKEN`). 없으면 `.partial`에 clone → rename | 등록된 것만. 등록 안 됨 → `pending.add` |
  | 등록 | 없으면 `addTeamRepo`. 실패 → `problem` | 하지 않는다 |
  | 연결 | 판정 표의 "새로 받는 조건"이면 `client.link` → `writeLinkConfig({hub, caPem:null, fingerprint:null, token, memberId, memberName, repoId, repoName, macId})` | 같다 |
  | 빼기 | `reposDir` 안의 등록된 repo 중 담당이 아닌 것을 `removeTeamRepo`(`OPEN_CLAIM`이면 `problem`, 남김)한다. 그 연결 파일에 `macId`가 있으면 지운다. 폴더는 남긴다 | `pending.remove` |

- [ ] **Step 1: 실패하는 시험(bare origin 둘, 실제 Hub, 가짜 gh).**
  - "a full sync clones each owned repo into <root>/repos/<name>, registers it and writes a 0600 hub-link.json with macId; a second run clones, registers and mints nothing": 둘째 실행 뒤 Hub의 살아 있는 연결 id가 같고, git `clone` 실행이 없다.
  - "a clone that fails half-way leaves no folder at the final path or .partial, is neither registered nor linked, the other repo is, and the next run clones it" **[Review Focus 3]**: `run` 주입이 실제 clone 뒤 exit 128을 돌려준다.
  - "a .partial left by a killed run is removed at the start of a full sync"
  - "a repo the person registered from their own folder is not cloned, and its hub-link.json without macId is left byte for byte"
  - "a host without a gh login skips its repos and says gh auth login --hostname <host> --web --git-protocol https when no ghLogin is given"
  - "with ghLogin, a host without a gh login gets one login prompt and its repos are cloned once gh says logged in; a login that does not help skips them with the same command"
  - "setup-git runs once per host before the first clone, not when nothing needs cloning, and a failed setup-git skips that host's clones with gh auth setup-git --hostname <host>"
  - "a folder at the clone path whose origin is another repo is CLONE_DIR_TAKEN and untouched"
  - "two owned repos named app get app-<id8> folders"
  - "a Mac-cloned repo no longer owned is unregistered and its Mac link file removed; its folder stays; with the team Office's open claim on it, it stays registered with a problem"
  - "links-only mints a link for a registered repo whose Mac link died, changes no registry, and reports repos to add and remove in pending"
  - "a clone refused for credentials says gh auth setup-git --hostname <host>"
  - "clone runs git with exactly HOME, PATH, LANG, GIT_TERMINAL_PROMPT (and SSH_AUTH_SOCK) and core.hooksPath=/dev/null"
  - "syncBeforeUp does nothing without a Mac link or while the team Office runs, and an unreachable Hub only logs"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-mac-sync.test.mjs`
- [ ] **Step 3: 구현.**
  - clone 주소는 `https://<remote>.git`이다.
  - clone `cwd`는 `reposDir`(0700으로 만든다)다.
  - 한 repo의 실패는 다음 repo를 막지 않는다.
  - `say` 한 줄 형식: `<repo 이름>: <무엇>`(예: "app-be: clone했습니다", "app-fe: gh 로그인이 필요합니다 — gh auth login --hostname …").
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/team-branch.test.mjs tests/team-registry.test.mjs tests/hub-link.test.mjs`를 더한다.
- [ ] **Step 5: 커밋.** `feat: clone, register and link the repos a member owns`

### Task 7: LaunchAgent (`src/team/launch-agent.ts`)

**Files:**
- Create: `src/team/launch-agent.ts`
- Test: `tests/team-launch-agent.test.mjs`

**Interfaces:**
- Produces:
  - `export const LAUNCH_LABEL = "com.pazmo.office"; export const STABLE_NODE = "/opt/homebrew/opt/node@24/bin/node";`
  - `export type LaunchRun = (exe: string, args: string[]) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>`, 기본 `launchRun`
  - `launchAgentPath(home: string): string`(`<home>/Library/LaunchAgents/com.pazmo.office.plist`)
  - `stableNodePath(execPath: string, stable = STABLE_NODE): string`: `realpath(stable) === realpath(execPath)`이면 `stable`, 아니면 `execPath`다.
  - `launchAgentPlist(o: { node: string; cli: string; root: string; home: string; extraCa?: string }): string`
  - `installLaunchAgent(o: { home: string; uid: number; node: string; cli: string; root: string; extraCa?: string; run?: LaunchRun }): Promise<void>`
  - `removeLaunchAgent(o: { home: string; uid: number; run?: LaunchRun }): Promise<void>`
  - `launchAgentState(o: { home: string; uid: number; run?: LaunchRun }): Promise<"loaded" | "installed" | "missing">`
- **plist 키:** `Label` `com.pazmo.office`, `ProgramArguments` `[node, cli, "up", "--team", "--no-open", "--data-dir", root]`, `EnvironmentVariables` `{PATH, LANG:"en_US.UTF-8"}`(PATH는 판정 표), `RunAtLoad` true, `KeepAlive` false, `AbandonProcessGroup` true, `StandardOutPath`·`StandardErrorPath` `<root>/team/launchd.log`.

- [ ] **Step 1: 실패하는 시험(가짜 `run`).**
  - "the plist parses (plutil) to exactly the keys above, with no token anywhere": macOS의 `/usr/bin/plutil -convert json -o -`로 읽어 `deepEqual`한다.
  - "paths with &, < and > are XML-escaped"
  - "extraCa adds NODE_EXTRA_CA_CERTS to EnvironmentVariables and is absent otherwise"
  - "install writes the file 0644, then runs bootout gui/<uid>/com.pazmo.office (its failure ignored) and bootstrap gui/<uid> <plist>"
  - "a failed bootstrap is LAUNCHD_FAILED with launchctl's first stderr line"
  - "remove boots out and deletes the file; removing twice is harmless"
  - "state is loaded when launchctl print succeeds, installed when only the file exists, else missing"
  - "stableNodePath keeps the opt path only when it resolves to the running node"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-launch-agent.test.mjs`
- [ ] **Step 3: 구현.** 파일은 임시 파일로 쓴 뒤 rename한다. `LaunchAgents` 폴더가 없으면 0755로 만든다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: start the team Office at Mac login with a LaunchAgent`

### Task 8: CLI `mac connect|status|disconnect|restart`와 켜기 경로

**Files:**
- Create: `src/cli/mac.ts`
- Modify: `src/cli/index.ts`(`mac` 명령과 동작, `--hub`·`--name` 허용, 도움말), `src/cli/launcher.ts`(`upTeam`: `syncBeforeUp`, `NO_REPOS` 조건), `src/cli/lifecycle.ts`(`startTeam`의 `NO_REPOS` 조건), `src/team/office.ts`(`NO_REPOS` 조건)
- Test: `tests/team-mac-cli.test.mjs`, `tests/team-lifecycle.test.mjs`, `tests/team-office.test.mjs`

**Interfaces:**
- Consumes: Task 5·6·7 전부, `stopTeam`·`statusTeam`(lifecycle), `up`(launcher), `teamRunning`.
- Produces:
  - `export const MAC_ACTIONS: readonly string[] = ["connect", "status", "disconnect", "restart"]`
  - `export type MacCliDeps = { call?: MacCall; open?: (url: string) => Promise<void>; launch?: LaunchRun; gh?: (host: string) => Promise<GhResult>; ghLogin?: ((host: string) => Promise<void>) | null; setupGit?: (host: string) => Promise<boolean>; git?: GitEnv; home?: string; uid?: number; node?: string; say?: (line: string) => void; sleep?: (ms: number) => Promise<void>; now?: () => number; teamRunning?: (root: string) => boolean; stopTeam?: (root: string) => Promise<unknown>; upTeam?: (root: string) => Promise<unknown>; statusTeam?: (root: string) => Promise<{ status: string }> }`
  - `macCommand(action: string, options: { hub?: string; name?: string; dataDir?: string }, deps?: MacCliDeps): Promise<unknown>`
  - CLI: `pazmo-office mac connect --hub <https 허브> [--name <Mac 이름>] [--data-dir PATH]`, `pazmo-office mac status|disconnect|restart [--data-dir PATH]`. `connect`·`restart`는 Apple Silicon macOS가 아니면 `PLATFORM`이다(판정은 `index.ts`에서, `macCommand` 밖).
  - 결과(stdout JSON, 토큰 없음):
    - connect: `{ connected: true, member, mac, repos: MacRepoResult[], problems: string[], launchAgent: "loaded", log: "<root>/team/launchd.log", note }`
    - status: `{ connected: boolean, hub?, member?, mac?, hubState?: "ok" | "revoked" | "unreachable", repos: { name; project; registered; linked }[], launchAgent, team }`
    - disconnect: `{ disconnected: true, hubRevoked: boolean, clonesKept: "<root>/repos" }`
    - restart: `up`의 결과
- **connect 순서:**
  1. 기존 링크 재사용 판정(같은 Hub이고 `repos()` 성공 → 재사용, 아니면 `pairMac`)
  2. `writeMacLink`
  3. 팀 Office가 꺼져 있으면 `syncMacRepos(full)`, 켜져 있으면 "켜진 Office가 5분 안에 맞춥니다"
  4. `installLaunchAgent`
  5. 결과. 문제가 있으면 줄마다 다시 할 명령(`curl -fsSL <hub>/install.sh | sh`)을 붙인다.
- **disconnect 순서:** `stopTeam`(`TASK_ACTIVE`면 그대로 던짐) → `removeLaunchAgent` → `client.revoke()`(실패 → `hubRevoked:false`) → 등록된 repo 중 `macId`가 이 Mac인 연결 파일 삭제 → `removeMacLink`. 연결이 없을 때 다시 부르면 `{disconnected:true, hubRevoked:false}`다.
- **restart:** `stopTeam` → `upTeam`(기본 `up({ engine:"team", open:false, dataDir:root })`)

- [ ] **Step 1: 실패하는 시험.**
  - "mac connect pairs, writes mac-link.json 0600, clones and registers owned repos, installs and loads the LaunchAgent, and no output or plist holds the token": 실제 Hub, bare origin, 가짜 launch·open·gh. `open`이 불리면 웹으로 허용한다.
  - "mac connect again with a live link does not pair, clone, register or mint anything and reloads the agent"
  - "mac connect while the team Office runs changes no registry and says the Office will do it"
  - "the default ghLogin is a prompt only when stdin is a TTY, and mac restart never passes one"
  - "after a web revoke, mac connect pairs again and re-mints every Mac link; the old per-repo tokens stay 401" **[Review Focus 4]**
  - "mac status shows member, repos, links, agent and team; a revoked Mac shows hubState revoked; an unreachable Hub shows unreachable"
  - "mac disconnect stops the team Office, removes the agent, revokes on the Hub, removes Mac link files and mac-link.json, and keeps clones and the registry"
  - "mac disconnect with a Task running is TASK_ACTIVE and changes nothing"
  - "mac disconnect with the Hub down cleans up locally with hubRevoked false and says to revoke on /mac"
  - "mac restart stops the team Office before up; a TASK_ACTIVE stop runs no up"
  - CLI(실제 `bin/pazmo-office.mjs`): "mac needs connect, status, disconnect or restart; --hub and --name only with mac connect (and their old commands); the help names mac"
  - `team-lifecycle`: "with a Mac link and no repo, start --team runs with no repos; without one it is still NO_REPOS"
  - `team-office`: "with no registered repo but a Mac link, the team Office opens with no lanes and claims nothing"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-mac-cli.test.mjs tests/team-lifecycle.test.mjs tests/team-office.test.mjs`
- [ ] **Step 3: 구현.**
  - `upTeam`은 `readTeam` 전에 `await syncBeforeUp(root)`를 부른다.
  - `index.ts`는 `mac`의 동작을 `team`처럼 플래그 앞에서 읽는다. `mac`은 `--project`를 받지 않는다(`ARGUMENT`). `--hub`는 `hub-link`와 `mac connect`, `--name`은 `hub`와 `mac connect`에서만 받는다.
  - `NO_REPOS`의 세 곳은 모두 `repos.length === 0 && !readMacLink(root)`다.
  - 기본 `open`은 `runCommand("/usr/bin/open", [url])`, 기본 `node`는 `stableNodePath(process.execPath)`, 기본 `uid`는 `process.getuid()`다.
  - 기본 `ghLogin`은 `process.stdin.isTTY`일 때만 `spawn("gh", ["auth","login","--hostname",host,"--web","--git-protocol","https"], { stdio: "inherit" })`를 기다리는 함수이고, 아니면 null이다. `restart`와 `upTeam`의 `syncBeforeUp`에는 넘기지 않는다.
  - 기본 LaunchAgent의 `NODE_EXTRA_CA_CERTS`는 `process.env.NODE_EXTRA_CA_CERTS`가 절대 경로일 때만이다(Task 7 `installLaunchAgent`에 `extraCa?: string` 인자를 더한다).
  - 진행 줄은 stderr에 한국어로 쓴다(`up`의 `[1/4]`처럼). 짝짓기 → repo 맞추기 → 자동 실행 등록.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: connect, inspect and disconnect this Mac from the Office CLI`

### Task 9: 접속 상태 하트비트와 담당 repo 변경 때 스스로 다시 켜기

**Files:**
- Create: `src/team/mac-watch.ts`
- Modify: `src/team/office.ts`(TeamConfig, `presenceOf`, `canExecute`, 타이머, 켤 때 한 번 하트비트)
- Test: `tests/team-mac-watch.test.mjs`, `tests/team-office.test.mjs`

**Interfaces:**
- Consumes: Task 5 `readMacLink`·`macClient`, Task 6 `syncMacRepos(…, "links-only")`, Task 8 `mac restart`.
- Produces:
  - `export const RESTART_HOLD_MS = 600_000; export const RESTART_RETRY_MS = 3_600_000`
  - `export type Presence = { state: MacState; detail: string | null }`
  - `createMacWatch(d: { linkOf: () => MacLinkFile | null; clientFor: (file: MacLinkFile) => Pick<MacClient, "heartbeat" | "repos" | "link">; presence: () => Presence; idle: () => boolean; sync: (file: MacLinkFile, client: Pick<MacClient, "repos" | "link">) => Promise<{ add: string[]; remove: string[] }>; restart: () => void; log: (line: string) => void; now?: () => number; root?: string }): { beat(): Promise<void>; check(): Promise<void>; holding(): boolean }`
    - `beat`: 링크 없음 → 아무것도 하지 않음. 있으면 `heartbeat(presence())`. 401이면 그 `macId`를 해제됨으로 기억하고 로그 한 줄, 그 뒤 그 `macId`로는 부르지 않는다(파일이 다른 `macId`가 되면 다시 부른다).
    - `check`: 해제됨이나 대기 중이면 아무것도 하지 않음. `sync` 결과에 add·remove가 없으면 끝. 있고 `idle()`이 아니면 "repo 변경이 열린 Task를 기다림" 로그를 바뀔 때만 남긴다. `idle()`이면 대기를 잡고, 로그를 남기고, `restart()`를 한 번 부른다.
      - 다시 켜기로 정한 `{add, remove}`(정렬한 집합)와 그 시각을 `restart()` 전에 `<root>/team/mac-restart.json`(0600, `root`가 없으면 메모리만)에 기억한다. `links-only`의 `pending.add`에는 전체 맞추기도 못 하는 repo(`CLONE_DIR_TAKEN`, gh 로그인 없음 등)가 들어 있어서, 다시 켠 Office가 같은 집합을 또 찾으면 다시 켜기를 되풀이하게 되기 때문이다.
      - 같은 집합이고 기억한 지 `RESTART_RETRY_MS`(3600000 ms)가 안 됐으면 다시 켜지 않고 로그를 한 번만 남긴다(이유는 `launchd.log`). 한 시간이 지나면 한 번 더 켠다(맞추지 못한 이유가 잠깐의 것이었을 수 있다). 다른 집합이면 다시 켜고, 빈 집합이면 기억을 지운다.
      - 대기(600000 ms)가 끝났는데도 이 Office가 그대로면 기억을 지우고 다음 확인에서 다시 켠다. 기억을 쓰지 못하면 다시 켜지 않는다.
    - `holding`: 대기를 잡은 지 600000 ms 안이면 true다.
  - `spawnMacRestart(root: string, host: { pathEnv: string; home: string; sshAuthSock?: string }, spawnFn?: typeof spawn, o?: { execPath?: string; stableNode?: string; env?: NodeJS.ProcessEnv }): void`(`o`는 시험용)
    - `restartNode() [<packageRoot>/bin/pazmo-office.mjs, "mac", "restart", "--data-dir", root]`, `detached:true`. `restartNode()`는 `process.execPath`가 있는 동안 그것(또는 같은 실행 파일이면 Homebrew의 안정 경로 `STABLE_NODE`)이고, `brew upgrade`가 지웠으면 `STABLE_NODE`다.
    - env `{PATH, HOME, LANG:"en_US.UTF-8"}` + `SSH_AUTH_SOCK` + `NODE_EXTRA_CA_CERTS`(이 프로세스 값이 절대 경로일 때만)
    - stdout·stderr는 `<root>/team/launchd.log`에 이어 쓴다. `unref()`
  - TeamConfig에 다음을 더한다(모두 시험용 주입이고, 기본값으로 실제 동작한다).
    - `macLinkOf?: () => MacLinkFile | null`: 기본 `readMacLink(root)`. 오류는 로그를 남기고 null이다.
    - `macClientFor?: (file: MacLinkFile) => MacClient`: 기본 `macClient(file)`
    - `macSync?: (file: MacLinkFile, client: Pick<MacClient, "repos" | "link">) => Promise<{ add: string[]; remove: string[] }>`: 기본은 `syncMacRepos({ root, hub: file.hub, macId: file.macId, member: { id: file.memberId, name: file.memberName }, client, git: hostEnv, say: log }, "links-only")`의 `pending`
    - `restartSelf?: () => void`: 기본 `spawnMacRestart(root, hostEnv)`
  - office.ts의 `presenceOf(): Presence`. 위에서부터 처음 맞는 것이다.
    1. live가 아님 → `locked`
    2. 열린 기록의 `waitingOf`가 있음 → `limited`, detail `<runner>: <kind>`
    3. live인데 실행기 준비 안 됨 → `limited`, detail은 준비 안 된 repo의 실행기
    4. `gate.busy()`이거나 열린 기록이 `failed`가 아님 → `working`
    5. 그 밖 → `idle`
  - `canExecute`와 `claimCouldFollow`에 `!watch.holding()`을 더한다. `idle()` = `openClaim() === null && !gate.busy()`.
  - 타이머: `every(beatMs, "presence", beat)`, `every(recheckMs, "mac repo check", check)`. 켤 때 `void watch.beat()` 한 번.

- [ ] **Step 1: 실패하는 시험.**
  - watch: "beat sends the presence state and detail when a Mac link exists and nothing without one"
  - watch: "a 401 heartbeat logs once and stops Mac calls until the link file names another macId" **[Review Focus 4]**
  - watch: "a repo to add with nothing open holds claims and calls restart once, even over several checks" **[Review Focus 5]**
  - watch: "with an open claim or a busy engine, check waits, logs once, and restarts at the first check after it closes" **[Review Focus 5]**
  - watch: "the hold ends after 600000 ms if this Office was never stopped, and the next check tries again" **[Review Focus 5]**
  - watch: "a change that sync fixed in place (no add or remove) needs no restart"
  - watch: "spawnMacRestart runs mac restart --data-dir <root> detached with the person's PATH, HOME and ssh agent, logs to launchd.log, and its argv and env hold no token"
  - office: "presence is locked without --live, limited while the open record waits on its runner or the runners are not ready, working while an engine runs or a record moves, else idle"
  - office: "while a restart is held the Office claims nothing" **[Review Focus 5]**
  - office: "a team Office with a Mac link beats presence at start and every 60000 ms, and checks the repo set every 300000 ms"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-mac-watch.test.mjs tests/team-office.test.mjs`
- [ ] **Step 3: 구현.** 해제됨·기다림 로그는 바뀔 때만 남긴다. 하트비트의 다른 실패(네트워크)는 `every`의 로그 규칙을 따르고 다음 주기에 다시 한다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/team-*.test.mjs` 전체를 더한다.
- [ ] **Step 5: 커밋.** `feat: report this Mac's state to the Hub and restart for a changed repo set`

### Task 10: 문서와 검증 설정

**Files:**
- Modify: `docs/LOCAL-PREVIEW.md`(팀 허브 절에 "### 이 Mac 연결 (OpenShift 허브)", 팀 Office 절에 Mac 연결과의 관계)
- Modify: `docs/STATUS.md`(맨 위 새 항목), `.ai-workflow/verification.json`(시험 세 조각의 `covers`에 `V19`)
- Create: `docs/verification/2026-11-04-mac-connect.md`

- [ ] **Step 1: 사용 안내.** 다음을 쓴다.
  - 설치 한 줄과 하는 일. OpenShift 허브 전용이고, LAN 허브는 지금 흐름이다.
  - 허용 화면에서 확인할 것(코드·Mac 이름).
  - 한 사람 한 Mac(새 Mac이 앞 Mac을 해제)
  - clone 위치와 "자기 폴더로 등록한 repo는 그대로"
  - gh 로그인·`gh auth setup-git` 안내
  - LaunchAgent 위치·로그, 꺼짐일 때 설치 명령 다시 실행
  - `mac status|disconnect|restart`
  - Hub 운영자: `PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF`
- [ ] **Step 2: STATUS 항목.** 묶음 1의 범위, Task별 커밋, 자동 검사 X/X, 남은 것(실제 확인, 묶음 2–4)을 쓴다.
- [ ] **Step 3: 검증 기록 뼈대.** 다음 절을 둔다.
  - 만든 것(Task·커밋 표)
  - 판정 적용(이 계획의 판정 표)
  - 자동 검사(빈칸)
  - 확인하지 않은 범위
  - 실제 확인 계획
    - 이번 묶음: 로컬 LAN 허브 + `NODE_EXTRA_CA_CERTS`로 `mac connect`, 실제 `launchctl`·재로그인 자동 실행, 상태 다섯 가지, 해제, 담당자 추가 뒤 5분 안에 스스로 다시 켜기
    - 중간점검(네 묶음 뒤): 사내 OpenShift 허브와 두 사람의 Mac으로 깨끗한 Mac 설치 한 줄
  - "실제 확인 전에는 팀원에게 쓰라고 안내하지 않는다"를 적는다.
- [ ] **Step 4: 통과 확인.**
  - 전체 `npm test`를 X/X로 확인한다.
  - `npm run typecheck`가 exit 0이다.
  - `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`가 exit 0이다.
- [ ] **Step 5: 커밋.** `docs: record the Mac connect bundle`

---

## 결정 → Task

| 결정(컨트롤러 2026-11-04) | 어디서 |
|---|---|
| 1 기기 흐름: start·token·3초 확인·10분·한 번·해시만·허용 화면·거절·로그인 안 함 화면·제한 | Task 1·2·4·5, 판정 표 |
| 2 사람 단위 토큰 API: repos·link(`hub_links`)·heartbeat·해제 시 연결도 멈춤 | Task 1·2, 판정 표(`linked`, `revoke`, `mac_id`) |
| 3 Office: `mac-link.json` 0600, clone·`team add`·repo 연결, gh 안내, LaunchAgent, disconnect, repo 변경과 다시 켜기 | Task 5·6·7·8·9 |
| 4 접속 상태 60초, working·limited·locked·idle | Task 9, 머리글은 Task 4 |
| 5 웹 `/mac`, 머리글, 첫 방문 안내, Korean·CSP·copy.js | Task 4 |
| 6 설치기 전부 | Task 3 |
| 7 범위 밖 | 아래 "이 계획 밖" |
| 지키는 것(Node 24, 공개 레포, 비밀, 시험, kit 검증, 계획 위치) | Global Constraints, Task 10 |

## 이 계획 밖

- 팀원 웹(내 할 일, 보드, Task 상세, 자동으로 일하기 스위치, 작업하기, 다시 시도)은 묶음 2, PL 기획은 묶음 3, Story 마무리는 묶음 4다.
- `.dmg` 앱, 비밀번호·SSO, Windows·Linux·Intel Mac은 하지 않는다.
- LAN(사내 자체 인증서) 허브의 설치 한 줄은 하지 않는다(지금의 `/start` 흐름).
- 사내 OpenShift 허브 재배포와 두 사람 Mac 실제 확인은 네 묶음 뒤 중간점검에서 한다.

## 구현 중 바뀐 것

Task 1–9를 만들면서 컨트롤러가 정한 판정(`Ruling`)과 리뷰가 찾은 것으로 위 계획이 코드와 달라졌다. 위 Task 본문은 처음 계획 그대로 두고, Task 9의 인터페이스(스스로 다시 켜기의 기억과 한 시간 재시도, `spawnMacRestart`의 node와 환경)만 코드에 맞게 고쳤다. 바뀐 것의 전부와 이유, 영향은 [검증 기록](../verification/2026-11-04-mac-connect.md)의 "판정 적용"에 있다. 큰 것은 다음과 같다.

- `GET /mac/approve`로 없는 코드를 여는 것도 허용·거절과 같은 사람별 제한에 센다(Task 4, 판정 표의 요청 제한기).
- LaunchAgent는 `bootout` 뒤에 `enable`을 하고 `bootstrap`을 500·1500 ms 간격으로 3번까지 시도한다(Task 7).
- `NODE_EXTRA_CA_CERTS`(절대 경로일 때만)가 LaunchAgent뿐 아니라 팀 서비스와 스스로 다시 켜기의 환경에도 들어간다(Task 9).
- 스스로 다시 켜기는 `process.execPath`가 `brew upgrade`로 사라졌으면 Homebrew의 안정 경로 node로 켜고, 다시 켜도 맞추지 못한 같은 집합은 한 시간에 한 번만 다시 켠다(`mac-restart.json`, Task 9).
- 설치기의 마지막 단계(`mac connect`)도 `run_step`을 거친다(Task 3).
- `.ai-workflow/verification.json`의 `V19`와 kit-checks 경계 줄은 Task 10이 아니라 설정 커밋 `e1e7f64`에서 했다.
