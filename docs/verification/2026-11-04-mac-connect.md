# 검증 기록: 브라우저 팀 흐름 묶음 1 (이 Mac 연결)

Story: M16 · M4 · V19 · D41. 결정은 [hub-web-team-flow-decision.md](../understanding/hub-web-team-flow-decision.md)(G3 2026-11-04)의 "팀원" 흐름 1·2·7과 "나눠서 만들기"의 묶음 1이다. 계획은 [2026-11-04-1500-feat-mac-connect-plan.md](../plans/2026-11-04-1500-feat-mac-connect-plan.md), kit 실행은 `.ai-workflow/runs/U36-mac-connect.json`이다. 사용 안내는 [LOCAL-PREVIEW.md의 "이 Mac 연결"](../LOCAL-PREVIEW.md#이-mac-연결-openshift-허브)이다.

이 묶음은 팀원이 Hub 웹의 설치 명령 한 줄과 "이 Mac 허용" 한 번으로 자기 Mac을 **사람 단위**로 연결하는 데까지다. 연결하면 Office가 담당 repo를 스스로 clone·등록·연결하고, Mac 로그인 때 저절로 켜지고, 허브 머리글에 "내 Mac" 상태가 보이고, 담당 repo가 바뀌면 열린 Task가 없을 때 스스로 맞추고 다시 켠다. 팀원 웹(내 할 일·보드·Task 상세), PL 기획, Story 마무리는 묶음 2–4다.

**자동 시험만 마쳤다. 실제 Mac(`launchctl`, 재로그인, Homebrew 설치)과 사내 OpenShift 허브로는 돌려 보지 않았다(아래 "실제 확인 계획").** 그래서 실제 확인 전에는 팀원에게 쓰라고 안내하지 않는다. 머지는 G4 질문 관문 뒤에 정한다.

## 만든 것

기준 커밋은 설정 커밋 `e1e7f64`(kit 검증의 V19)다. 아래 시험 수는 그 Task 때 구현자가 보고한 그 Task의 시험 묶음이다. 전체 결과는 "자동 검사"에 따로 적는다.

| Task | 커밋 | 내용 | 그 Task의 시험 |
|---|---|---|---|
| 1 Hub 저장소 | `0e0151b` | 기기 흐름(대기 코드 10분·한 번·해시만), 사람 단위 Mac 토큰(`hub_macs`), 한 사람 한 Mac, `hub_links.mac_id`, 해제 때 그 Mac의 repo 연결도 멈춤, 머리글 상태 | 21/21 |
| 2 Hub Mac API | `df84ff8`, `9f1ca6b` | `/api/mac/*`(프로토콜 4)와 요청 제한기. 수정: 본문을 읽은 뒤 Mac 인증을 다시 확인 | 19/19 |
| 3 설치기 | `25f990e`, `b37bb90` | OpenShift 허브의 `GET /install.sh`(POSIX sh)와 `PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF` 검사. 수정: main 시험이 허브 종료를 기다림 | 22/22 |
| 4 Hub 웹 | `9c402ec`, `076922d` | `/mac`, 허용·거절 화면, 로그인 안 한 사람 안내, 머리글 "내 Mac", 첫 방문 안내. 수정: 없는 코드를 여는 GET도 사람별 제한에 센다 | 17/17 |
| 5 Office 클라이언트 | `55929d9` | `mac-link.json`(0600)과 기기 흐름(`pairMac`)·Mac API 호출 | 27/27 |
| 6 repo 맞추기 | `87f4a3d` | 담당 repo clone·등록·repo별 연결(`syncMacRepos`, full·links-only) | 18/18 |
| 7 LaunchAgent | `05e4e3f`, `fe1a80e` | 로그인 때 `up --team --no-open`. 수정: `enable`과 `bootstrap` 3번 시도 | 23/23 |
| 8 CLI | `92b9ea0` | `mac connect|status|disconnect|restart`, `up --team`의 켜기 전 맞추기, Mac 연결이 있으면 repo 0개로도 켜짐 | 56/56 |
| 9 접속 상태·다시 켜기 | `ca51b9b`, `5e258b0` | 60초 하트비트와 상태 다섯 가지, 5분마다 담당 repo 확인, 스스로 다시 켜기. 수정: 사라지는 node 경로, 사내 CA, 한 시간 재시도 | 59/59 |
| 10 문서 | (이 커밋) | 사용 안내, STATUS, 이 기록, 계획의 "구현 중 바뀐 것" | — |

- 리뷰는 Task마다 한 번씩 했고, Task 2·3·4·7·9가 한 번씩 수정을 거쳤다. 나머지 넷(1·5·6·8)은 수정 없이 통과했다.
- 만들지 않은 것: `.ai-workflow/verification.json`의 V19와 kit-checks 경계 줄은 Task 10이 아니라 설정 커밋 `e1e7f64`에서 했다. 새 npm 의존성은 없다.
- 더하기만 했다. 프로토콜 1·2·3, `/api/link/*`, 연결 문자열, `hub-link`, `team add|remove`, `start --team`은 그대로다.

## 판정 적용

계획의 "판정" 표를 그대로 구현했다. 구현 중 컨트롤러가 정한 판정(`Ruling`)과 리뷰가 찾은 것은 해당 행의 오른쪽 칸에 적었다. 오른쪽 칸이 "—"인 행은 계획 그대로다.

| 계획의 판정 | 적용 | 구현 중 바뀐 것 |
|---|---|---|
| Mac API는 `/api/mac/*`, 프로토콜 헤더 `"4"`, 다른 값은 426 `PROTOCOL_MISMATCH` | Task 2. TLS·OpenShift 두 모드에서 같다 | **리뷰(Task 2):** `/api/mac/link`·`/heartbeat`가 본문을 읽는 동안 그 Mac이 해제될 수 있어서, 읽은 뒤 Mac 인증을 다시 확인한다(`9f1ca6b`). **판정(Task 2):** `link-api.ts`와 겹치는 도우미(`str`·`parse`·`invalid`·`ROUTES`)는 `mac-api.ts`에 그대로 중복해 둔다. 이 묶음이 기존 파일을 건드리지 않게 하려는 것이고, 공용 `body.ts`로 합칠지는 마지막 리뷰가 가린다 |
| 요청 제한기(메모리, 고정 창): `/api/mac/start` 클라이언트마다 10번/600000 ms, 대기 코드 100개, 허용·거절 사람마다 10번/600000 ms. 클라이언트 키는 OpenShift에서 `x-forwarded-for`의 마지막 값 | Task 2·4. `createRateLimit` | **판정(Task 4 리뷰): `GET /mac/approve`로 없는 코드를 여는 것(`macCode`가 null이라 410)도 같은 사람별 제한에 센다.** 계획은 POST만 셌는데, 그러면 GET이 코드를 무제한으로 맞혀 볼 수 있는 통로가 된다. 제한은 조회보다 먼저 본다(소비하지 않는 `full(key)`을 더했다). 살아 있거나 이미 결정한 코드를 여는 것은 세지 않는다. 10번을 넘으면 허용·거절 화면과 같은 429 문구가 나온다(`076922d`). 이 판정은 코드 추측을 시도 수로 막는다는 계획의 이유에 기댄 것이다. 틀렸다면 링크를 10개 잘못 연 팀원이 잠깐 429를 보는 비용뿐이다 |
| 한 사람의 Mac 연결은 하나만 살아 있다 | Task 1. 새 Mac이 토큰을 받는 순간 앞 Mac과 그 Mac이 받은 repo 연결이 해제된다 | — (허용 화면 문구는 "허용하면 해제된다"인데 실제 해제는 토큰을 받는 때다. 문구 다듬기는 마지막 리뷰의 것) |
| Mac 토큰은 허용 뒤 첫 확인 때 한 번만 준다. `GET /api/mac/repos`에 `linked`, `POST /api/mac/revoke`. `hub_links.mac_id`와 해제된 Mac의 연결 거부. 새 Mac 행의 `last_seen`은 비어 있다 | Task 1·2 | — |
| 머리글 이름: 일하는 중·대기 중·쉬는 중(한도)·잠김·꺼짐(N분 전)·꺼짐(아직 연락 없음)·연결된 Mac 없음 | Task 1·4. 180000 ms 넘게 소식이 없으면 꺼짐 | — |
| Mac API는 두 모드에서 다 동작하고, `/install.sh`와 `/mac`의 설치 명령은 OpenShift 모드에서만 준다 | Task 3·4. LAN 모드의 `/mac`은 지금의 `/start` 흐름을 쓰라고 말한다 | — |
| clone 주소 `https://<remote>.git`, 위치 `<dataRoot>/repos/<이름>`(이름 정리·겹침·`.partial`), 있는 폴더는 origin으로 판정, 자기 폴더로 등록한 repo는 그대로 쓰고 `macId` 없는 연결 파일은 건드리지 않음, 연결 파일을 새로 받는 조건 | Task 6 | **구현이 더한 것:** 대소문자만 다른 이름도 같은 이름으로 본다(macOS 폴더가 구분하지 않는다). **계약(Task 6):** `problem`은 `<이름>: <무엇>` 한 줄 전체, `pending.add`는 repo 이름, `pending.remove`와 `removed`는 프로젝트 경로이고, 담당이 아니게 된 clone의 제거는 repo별 처리보다 먼저 한다 |
| gh 로그인이 없는 호스트: 터미널에 붙어 있으면(표준 입력이 TTY) 그 자리에서 `gh auth login --hostname <host> --web --git-protocol https`, 아니면 건너뛰고 같은 명령을 안내 | Task 6·8. 기본 `ghLogin`은 `mac connect`에서만 TTY일 때 쓰고(`ttyGhLogin`), `mac restart`·`up --team`의 켜기 전 맞추기·켜진 Office에는 넘기지 않는다 | **판정(Task 8 리뷰가 받아들임):** gh의 표준 출력은 터미널의 표준 오류로 보내서 `mac connect`의 표준 출력에는 JSON 결과 하나만 남는다 |
| clone 전에 호스트마다 한 번 `gh auth setup-git --hostname <host>`. 실패하거나 clone이 자격 문제로 실패하면 그 명령을 안내 | Task 6. clone할 repo가 있을 때만 부른다 | — |
| Mac 연결이 있으면 등록된 repo가 0개여도 팀 Office가 켜진다(`NO_REPOS`는 Mac 연결이 없을 때만) | Task 8·9. `createTeamOffice`·`startTeam`·`upTeam` 세 곳 | **판정(Task 8):** 연결 파일이 깨졌는데 repo가 0개이면 `NO_REPOS`가 아니라 `MAC_LINK_PERMISSIONS`·`MAC_LINK_INVALID`가 난다(안내가 더 정확하다) |
| `up --team`은 Mac 연결이 있고 팀 Office가 꺼져 있으면 켜기 전에 담당 repo를 맞춘다(`syncBeforeUp`). 실패는 로그 한 줄만 | Task 8 | — |
| **스스로 다시 켜기:** 가져가기를 멈추고 `mac restart`를 분리 실행한다. 600000 ms 안에 멈추지 않으면 대기를 풀고 다음 확인에서 다시 한다 | Task 9. 열린 기록이나 엔진이 있으면 한 줄만 말하고 기다리며, 닫힌 뒤의 확인에서 한 번 켠다 | **판정 4개(Task 9, 모두 계획 밖에서 더했다).** (1) **다시 켜기 되풀이 방지:** `links-only`의 `pending.add`에는 전체 맞추기도 못 하는 repo(`CLONE_DIR_TAKEN`, gh 로그인 없음, `setup-git` 실패, 상한)가 들어 있어서 다시 켠 Office가 같은 집합을 또 찾으면 다시 켜기를 되풀이한다. 그래서 다시 켜기로 정한 집합을 `<root>/team/mac-restart.json`(0600)에 기억해, 같은 집합이면 다시 켜지 않고 로그를 한 번만 남기고, 다른 집합이면 다시 켜고, 빈 집합이면 지운다. 틀렸다면, 집합은 그대로인데 나중에 고칠 수 있게 된 repo는 다시 켜기가 한 번 빠진다(다음 로그인 때 전체 맞추기가 고친다). (2) **한 시간 재시도((1)을 고침):** 기억한 지 3600000 ms가 지난 집합은 다시 켠다. (1)이 잠깐의 실패와 영구 실패를 구분하지 못해, 로그인 때까지 막히는 것은 설계 실패이기 때문이다. 영구히 못 고치는 집합은 한 시간에 한 번 한가한 Office를 다시 켜는 비용이 든다(`5e258b0`). (3) **node:** 다시 켜기는 `process.execPath`가 있는 동안 그것으로, `brew upgrade`가 지운 뒤에는 Homebrew의 안정 경로 node로 켠다. 계획대로면 업그레이드 뒤 다시 켜기가 늘 실패하고, 그동안 가져가기 멈춤이 시간의 3분의 2쯤을 차지한다고 리뷰가 찾았다. 만료 로그 줄은 `launchd.log`를 가리킨다(`5e258b0`). (4) **잠긴 Office:** `--live` 없이 켠 팀 Office도 Mac 연결이 있으면 `up --team`으로 다시 켜져 live로 돌아온다. Mac 연결이 있는 Office는 LaunchAgent의 `up`으로 켜지고 잠긴 모드는 개발자 경로다. 개발자의 잠긴 Office가 repo 변경 뒤 live가 되는 비용이 있다 |
| 연결만 바뀐 것은 켜진 Office가 그 자리에서 새로 받는다. 다시 켜지 않는다 | Task 9. 준비 안 된 repo의 연결을 5분마다 다시 읽는다 | — |
| `limited`는 열린 기록이 실행기 계정·준비를 기다릴 때와, live인데 실행기가 준비되지 않았을 때 | Task 9 `presenceOf` | — |
| **LaunchAgent:** `ProgramArguments`, `AbandonProcessGroup`, PATH·LANG, 절대 경로일 때의 `NODE_EXTRA_CA_CERTS`, `bootout`(실패 무시) 다음 `bootstrap`, node는 안정 경로 | Task 7·8 | **판정(Task 7 리뷰): `bootout` 뒤에 `enable`(실패 무시)을 하고 `bootstrap`을 500 ms·1500 ms 간격으로 3번까지 시도한다.** `mac connect`를 다시 실행하면 `bootout` 직후의 `bootstrap`이 launchd가 옛 일을 내리는 동안 `Bootstrap failed: 5`로 실패할 수 있어서다. 이것은 Apple 문서가 아니라 커뮤니티 보고에 기댄 것이라 실제 확인 전에는 맞는지 모른다. 모두 실패하면 `LAUNCHD_FAILED`와 마지막 시도의 첫 stderr 줄이 나온다. 실패한 설치는 최대 2초가 더 든다(`fe1a80e`) |
| **`NODE_EXTRA_CA_CERTS`:** 계획은 LaunchAgent에만 넣는다고 했다(사내 인증서 허브로 하는 로컬 실제 확인용) | Task 7·8. `mac connect`를 실행한 환경에 있으면(절대 경로일 때만) plist에 넣는다 | **판정(Task 9): 팀 서비스를 띄우는 환경(`serviceEnv`)과 `mac restart` 분리 실행의 환경에도 같은 값을 넘긴다.** 서비스 환경은 최소 환경이라, 자체 CA 허브에 연결한 Mac이 시스템 신뢰만 쓰면 하트비트가 실패하기 때문이다. 사람이 자기 환경에서 준 CA만 신뢰 목록에 더해진다(`5e258b0`) |
| `mac connect`는 Office가 켜지기를 기다리지 않고, 살아 있는 연결이면 다시 짝짓지 않는다 | Task 8. 진행 줄은 `[1/3]`–`[3/3]` | **판정(Task 8 리뷰가 받아들임):** 다시 실행하면 안내 줄은 이미 연결됐다고 말하고 `--name`은 무시된다. 다시 하라는 줄은 `curl -fsSL '<허브>/install.sh' \| sh`(주소를 작은따옴표로 감쌈)다 |
| `mac disconnect`: 팀 Office를 멈추고(`TASK_ACTIVE`면 거절) → LaunchAgent 내림 → Hub 해제 → Mac이 쓴 연결 파일과 `mac-link.json` 삭제. 허브에 닿지 않으면 로컬만 정리 | Task 8 | **판정(Task 8 리뷰가 받아들임):** 연결 파일이 없으면 자동 실행만 내린다. 해제할 때 허브가 이미 401이면(웹에서 해제함) `hubRevoked: true`다. `status`는 문제를 `problem`에, `disconnect`는 `note`에 적는다 |
| **설치기:** 전체를 `main` 함수로 감싸고, 대화 명령은 `/dev/tty`에서 읽으며, `PAZMO_BREW_PREFIX`, `npm ci --omit=dev --ignore-scripts` | Task 3 | **판정(Task 3): 마지막 단계(`mac connect`)도 `exec`가 아니라 `run_step`으로 돌린다.** 계획 자신의 규칙(모든 단계는 `run_step`을 거치고, 실패한 단계 이름과 다시 할 명령은 거기서만 나온다)을 지키려는 것이다. `mac connect`가 도는 동안 `sh` 프로세스 하나가 더 남아 있는 비용이 있다 |
| Office 저장소·ref는 Hub 시작 때 검사한다(`installerConfig`) | Task 3 | — |
| (Task 5 → 8 이월) | Task 5·8 | `pairMac`의 시작 단계 실패(`ECONNREFUSED`, `HUB_BAD_RESPONSE_503`, `--fingerprint`를 말하는 TLS 문구)는 날것으로 던져지므로 CLI가 쉬운 한국어와 다시 할 명령으로 감싼다(`hubFailure`). 허브가 보낸 문구는 `printable`을 거쳐 출력한다(`printable`은 C1 제어 문자도 뺀다). 새 `OfficeError` `HUB_URL_INVALID`. `readMacLink`는 쓸 수 없는 파일을 null이 아니라 `MAC_LINK_PERMISSIONS`·`MAC_LINK_INVALID`로 던진다. `mac` 명령들, 팀 Office의 하트비트·확인, 켜기 전 맞추기(`syncBeforeUp`)는 그 오류를 잡아 말하고, repo가 0개인지 보는 `upTeam`·`startTeam`·팀 Office 만들기의 검사는 일부러 잡지 않아 그대로 던진다(위 "Mac 연결이 있으면 … 0개여도" 행) |
| kit 검증 설정 | 설정 커밋 `e1e7f64` | **판정:** 시험 세 조각과 타입 검사의 `covers`에 `V19`를 더하는 일을 Task 10에서 설정 단계로 옮겼다. kit `init`이 V19 없이는 실행을 만들어 주지 않았다. 틀려도 비용이 없다(Task 10이 그 단계를 건너뛸 뿐) |

## 자동 검사

| 검사 | 결과 |
|---|---|
| 전체 `npm test`(kit 시험 세 조각) | (전체 검사 뒤 채움) |
| `npm run typecheck` | (전체 검사 뒤 채움) |
| Story 검사 `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | (전체 검사 뒤 채움) |
| 마지막 리뷰(브랜치 전체) | (마지막 리뷰 뒤 채움) |

Task별 리뷰와 그 시험 수는 "만든 것"에 있다. main을 합친 뒤의 Story 해시·G1과 U 번호 확인, G4 기록은 위 검사 뒤에 한다.

## 확인하지 않은 범위

자동 시험은 가짜 `launchctl`·`open`·`gh`, 로컬 bare repo, 로컬 Hub(TLS와 HTTP 프록시 흉내)를 쓴다. 다음은 시험으로 증명하지 않았다.

- **실제 Mac:** 실제 `launchctl`에서 plist가 로드되는지, 재로그인 뒤 `up --team`이 도는지, `bootout` 직후 `bootstrap`의 재시도와 `enable`이 필요한지(커뮤니티 보고에 기댄 판정), 실제 `/usr/bin/open`이 허용 주소를 여는지. `bootstrap`이 멈추면 한 번에 30초씩 3번과 대기 2초까지 걸릴 수 있다.
- **실제 설치:** 실제 Homebrew의 `brew install`(`node@24`·`git`·`gh`·`colima`·`docker`)과 `--cask claude-code`, 이 설치가 관리자 암호를 묻는지(허브 `/mac` 화면은 "관리자 암호는 필요 없습니다"라고 쓰는데 근거가 없고, 마지막 리뷰가 문구를 가린다), 실제 `gh auth login`·`claude auth login`, 터미널이 없을 때(`/dev/null`)의 거동.
- **실제 OpenShift 허브:** 라우터의 `x-forwarded-for`. 라우터 앞에 회사 로드밸런서가 더 있으면 마지막 값이 모두 로드밸런서 하나로 보여서 팀 전체가 `/api/mac/start`를 10분에 10번 나눠 쓴다. 배포 전에 확인한다. 허브 컨테이너의 `PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF`(지금 OpenShift Template `deploy/openshift/pazmo-hub.json`에는 두 값의 매개변수가 없다).
- **실제 git·gh:** 회사 GitHub Enterprise와 github.com 두 호스트, `gh auth setup-git` 뒤의 `https` clone, 사내 프록시·자체 인증서, 큰 repo의 clone 시간(600000 ms 제한).
- **여러 사람:** 두 사람의 Mac 두 대, 두 번째 Mac을 허용할 때 앞 Mac의 Office가 겪는 일(401 한 줄, 허브 호출 중단).
- 팀원 웹(내 할 일·보드·Task 상세·자동으로 일하기), PL 기획, Story 마무리(묶음 2–4). LAN 허브의 설치 한 줄(하지 않기로 했다). `.dmg`, 비밀번호·SSO, Windows·Linux·Intel Mac.

**사람에게 보이는 한계(리뷰가 미룬 것 중에서).** 고치지 않았고, 마지막 리뷰가 가린다.

- **허브가 잠깐 응답하지 않을 때 `mac connect`를 다시 실행하면 다시 짝짓는다.** 이미 있는 연결을 확인하는 `repos()`가 5xx·시간 초과로 실패해도 연결을 못 쓰는 것으로 보고 새로 짝짓고, 한 사람에 Mac 하나 규칙이 앞 연결을 해제한다. 돌고 있던 Office의 Story 연결이 끊길 수 있다. 정상일 때 다시 실행하면 재사용한다(Task 8, 계획의 글자 그대로).
- 설치기는 Rosetta로 연 터미널(`uname -m`이 `x86_64`)을 Intel로 보고 거절한다(Task 3). 설치기의 "Office 새 버전 받기"는 받기와 체크아웃이 같은 단계 이름이고, `PAZMO_OFFICE_REPO`를 바꿔도 이미 받은 Mac은 옛 origin에서 계속 받는다.
- 허용 화면을 연 뒤에 허브가 닫혀 있으면 `mac connect`는 조용히 기다리다 코드가 만료되면 "코드가 만료됐습니다"로 끝난다. 중간 안내가 없다(Task 5). 새 허용 주소가 허브 주소와 같은 곳인지는 확인하지 않는다.
- 허브 `/mac/approve`를 열기만 하는 GET이 429일 때 문구가 "허용과 거절을 너무 많이 시도했습니다"다(Task 4).
- **repo 맞추기:** (1) 사람의 `git`이 `insteadOf`로 원격을 다른 호스트 별칭으로 바꿔 두면, 등록된 원격이 허브의 원격과 달라서 전체 맞추기마다 그 clone을 빼고 다시 등록하고 연결을 새로 받는다(Task 6). (2) 두 터미널에서 동시에 전체 맞추기를 돌리면 막는 잠금이 없다. (3) clone이 실패하면 안내 줄에 git의 영어 문구가 그대로 나온다. (4) gh 로그인 확인은 등록된 repo의 연결 갱신보다 앞이라, VPN이 없어 `gh auth status`가 실패하면 로그인한 사람도 "gh 로그인이 필요합니다"로 그 repo의 연결 갱신이 건너뛰어진다. (5) 디스크 쓰기 실패나 중단으로 이 Mac의 `macId`가 든 죽은 토큰이 남고 허브가 `linked: true`라고 하면 다시 받지 않는다(드문 경로).
- **켜기 전 맞추기:** `up --team`의 켜기 전 맞추기가 TLS 문제로 실패하면 안내 문구가 `--fingerprint`를 쓰라고 한다. OpenShift 허브에는 해당이 없다(Task 8).
- **CLI 말:** `--name`은 이미 연결된 Mac에서는 조용히 무시된다. `mac status`는 허브가 4xx(426 포함)로 답해도 "닿지 않음"으로 보인다. 로컬 오류(EACCES 등)가 "허브에 닿지 않습니다"로 보일 수 있다. `mac-link.json`이 없을 때 `mac disconnect`는 `macId`가 든 repo 연결 파일을 남기고, 연결 파일 지우기에 실패하면 삼키고도 지웠다고 말한다.
- **허브 상태 표시:** `쉬는 중(한도)`와 `일하는 중`은 캐시한 실행기 준비 상태를 쓴다. 가져가기 멈춤·상한·다시 켜기 대기 중에는 낡을 수 있고, 실행기가 준비 안 됐을 때 두 실행기 이름이 다 붙는다. 다시 받은 repo 연결은 준비 안 된 repo에 5분(한 번의 다시 확인) 늦게 닿는다(Task 9).

## 실제 확인 계획

사용자 확인 뒤에 한다. 공유 허브, app-be(실제 데이터 폴더와 OpenShift 허브 연결이 있음), 회사 repo에는 쓰지 않는다. 그런 것이 필요하면 따로 묻는다. 실제 `launchctl`은 이 Mac의 진짜 `~/Library/LaunchAgents/com.pazmo.office.plist`를 쓰므로, 이미 이 Mac에 Mac 연결이 있으면 먼저 `mac status`로 확인하고 덮어써도 되는지 묻는다.

### 이번 묶음: 로컬 LAN 허브 + `NODE_EXTRA_CA_CERTS`

LAN(자체 인증서) 허브에는 설치 한 줄이 없어서 설치기는 여기서 돌리지 못한다. `mac connect --hub`를 직접 부른다. 설치기는 중간점검에서 본다.

1. **준비.**
   - 이 Mac에서 로컬 허브를 새로 띄운다(`pazmo-office hub --host 127.0.0.1 --port <포트>`).
   - 허브의 CA 파일 경로를 `NODE_EXTRA_CA_CERTS`(절대 경로)로 준다.
   - 관리자와 팀원 A를 만들고, GitHub에 시험 repo 두 개를 두어 A를 담당자로 한다(허브에서 한 개는 먼저 담당자, 한 개는 나중에 추가).
   - 시험용 `--data-dir`를 쓴다. 이 Mac의 `gh`·`claude` 로그인은 그대로 쓴다.
2. **연결.** `NODE_EXTRA_CA_CERTS=<CA 경로> pazmo-office mac connect --hub https://127.0.0.1:<포트> --data-dir <시험 폴더>`.
   - 터미널에 허용 주소와 코드가 나오고 브라우저가 열린다. 허용 화면의 코드·Mac 이름이 터미널과 같다.
   - 로그인하지 않은 브라우저로 열면 안내 화면이 나오고, 입장한 뒤 같은 주소로 허용된다(코드는 10분 유지).
   - 허용하면 3초 안에 이어지고, `[1/3]`–`[3/3]` 줄이 나온 뒤 끝난다.
   - `mac-link.json`은 0600이다. 출력과 plist와 `launchd.log`에 토큰이 없다. plist에 `NODE_EXTRA_CA_CERTS`가 있다.
   - `launchctl print gui/<uid>/com.pazmo.office`가 loaded이고, 담당 repo 하나가 `<시험 폴더>/repos/<이름>`에 clone되어 등록·연결됐다.
   - 같은 명령을 다시 실행하면 다시 짝짓지 않고 아무것도 새로 만들지 않는다.
3. **재로그인 자동 실행.** 로그아웃했다 다시 로그인한다(또는 재부팅한다). `launchd.log`에 켜기 줄이 있고, 팀 Office가 running이고, 허브 "내 Mac"이 몇 분 안에 대기 중이 된다.
4. **상태 다섯 가지.** 허브 머리글과 `/mac` 표에서 본다.
   - 대기 중: 켜져 있고 할 일이 없을 때.
   - 일하는 중: 시험 Story의 Task가 돌 때.
   - 쉬는 중(한도): `claude auth logout`(또는 계정 한도) 뒤. 실행기 이름과 이유가 붙는지.
   - 잠김: `stop --team` 뒤 `start --team`(`--live` 없음).
   - 꺼짐: Office를 멈추고 180초가 지난 뒤. N분 전 표시, 새로 만든 Mac은 "아직 연락 없음".
5. **해제.**
   - 웹 `/mac`에서 해제한다. Office 로그에 해제 줄이 한 번 나오고 허브 호출을 멈추는지, 그 Mac이 받은 repo 연결의 토큰이 401이 되는지, 연결 문자열로 만든 연결은 그대로인지.
   - 설치 명령(`mac connect`)을 다시 실행하면 새로 짝짓고 죽은 연결을 모두 새로 받는지.
   - `mac disconnect`: Task가 없을 때 자동 실행과 연결 파일이 지워지고 clone·등록은 남는지, Task가 실행 중이면 `TASK_ACTIVE`로 아무것도 바뀌지 않는지, 허브를 끈 채로 하면 `hubRevoked: false`와 안내가 나오는지.
   - 같은 사람의 두 번째 연결(다른 `--data-dir`, 다른 이름)이 앞 연결을 해제하는지(두 번째 Mac 대신).
6. **담당자 추가 뒤 5분 안에 스스로 다시 켜기.**
   - 허브에서 A를 두 번째 repo의 담당자로 더한다. 열린 Task가 없으면 5분 안에 로그에 "담당 repo가 바뀌었습니다"가 나오고, Office가 다시 켜져 그 repo가 clone·등록·연결된다.
   - 열린 Task가 있을 때는 한 줄만 말하고 기다리다가 Task가 닫힌 뒤의 확인에서 한 번 다시 켜는지, 다시 켠다고 정한 뒤에는 새 Task를 가져가지 않는지.
   - 일부러 맞추지 못하는 repo(해당 호스트의 gh 로그아웃)를 담당으로 더한다. 다시 켜기를 되풀이하지 않고 로그가 한 번 나오는지, 고친 뒤 한 시간 안에 사람이 `mac restart`하면 맞춰지는지.
   - 다시 켜는 node가 `brew upgrade` 뒤에도 있는지(가능하면 `process.execPath`가 없는 상태를 흉내 낸다).

### 중간점검(네 묶음 뒤): 사내 OpenShift 허브와 두 사람의 Mac

사내 OpenShift에 허브를 새 버전으로 다시 띄운 뒤, 두 사람의 Mac으로 **깨끗한 Mac에서 설치 한 줄**을 처음부터 끝까지 한다. 위 이번 묶음의 확인을 같은 방식으로 다시 하고, 다음을 더 본다.

- 설치 한 줄 전체: Homebrew만 있는 Mac, Homebrew 설치가 관리자 암호를 묻는지, GitHub와 Claude 로그인, 허용 화면, Rosetta 터미널의 거절.
- 회사 GitHub Enterprise repo의 gh 로그인·`setup-git`·clone, 사내 프록시와 인증서.
- 라우터 앞의 로드밸런서와 `x-forwarded-for`(10번/10분이 팀 전체에 걸리는지), `PAZMO_OFFICE_REPO`·`PAZMO_OFFICE_REF`.
- 한 사람 한 Mac: 같은 사람이 Mac 두 대에서 연결하면 앞 Mac이 해제되는지. 다른 사람의 두 Mac이 서로 해제하지 않는지.
- 로그인 때 자동 실행: VPN이 아직 없는 로그인 직후의 맞추기 실패와 그 뒤 복구.
