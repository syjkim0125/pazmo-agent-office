# Local Office 실행 안내

현재 원본 Claw Empire의 Office·Tasks·회의·Decisions 화면과 서버를 연결하는 중이다. 별도 activity/Tasks 대체 화면은 제거했다. 키 입력 없이 원본 로컬 세션으로 접속하며 CEO와 직원에게 픽셀 스타일을 적용했다.

**`--claw`는 화면·작업 저장 미리보기이며 모델 호출을 차단한다. `--claw --live`는 Mac에 설치·로그인된 codex 또는 claude CLI와 검증된 전용 VM을 사용하는 실제 역할 실행 경로다. 역할별 실행기·모델은 오피스에서 에이전트를 클릭해 고른다. 새 원본 UI 파일럿은 PM·팀장·Developer·Reviewer와 검사 6개를 마치고 실제 사용자 G4 대기 중이다. 아직 전체 인도 완료로 간주하지 않는다. 화면의 Live 표시는 WebSocket 연결을 뜻한다.**

## 팀원용 한 명령 실행 (Apple Silicon Mac)

Office 저장소의 `main` 브랜치를 받아 Office 저장소 디렉터리에서 실행한다. 최초 준비는 Node **24.19 이상 24.x**, npm/npx, Git·Python 3(Command Line Tools), Homebrew의 `colima`·`docker`, 그리고 Mac에 설치된 codex 또는 Claude Code 중 하나 이상의 로그인(`codex login` 또는 `claude auth login`)이다. 둘 다 있어도 되고 하나만 있어도 된다. 상태는 설정 → CLI 도구에서 확인한다. 고정 0.155.1 codex만 쓰려면 `--codex-runtime pinned`를 붙인다. 필요하면 `brew install node@24 colima docker`를 사용하고 Node 24가 PATH에서 선택되는지 확인한다. Windows·Linux·Intel Mac의 live 실행은 아직 지원하지 않는다.

```sh
# 최초 한 번: Office 설치 폴더와 별도인 기존 Git 프로젝트 선택
./office --project /absolute/path/to/project

# 다음부터: 마지막으로 선택한 프로젝트 실행
./office
```

이 명령은 고정 pnpm 10.30.1과 lockfile로 의존성을 설치하고 필요한 경우 UI를 빌드한다. 해시가 고정된 Codex 실행 파일, 호스트 공유가 없는 `pazmo-office` VM, 고정 Node 이미지를 준비하고 경계 검사를 거쳐 Office를 띄운 후 기본 브라우저를 연다. 첫 실행은 다운로드 시간이 필요하며 단계별 진행을 터미널에 표시한다. 이미 같은 프로젝트의 live Office가 떠 있으면 그대로 재사용한다. 코드 업데이트 적용은 진행 중인 작업이 없는 때 `node bin/pazmo-office.mjs stop --project /absolute/path/to/project` 후 `./office`로 한다.

첫 로그인은 사용자가 Mac에서 직접 한다. 로그인 파일을 VM이나 팀원에게 복사하지 않는다. 기존 VM 설정이 검증된 값과 다르면 덮어쓰지 않고 원인을 알려준다. 처음 실패한 설치는 같은 명령으로 다시 확인할 수 있다. `--data-dir /absolute/path`로 별도 데이터를 선택했다면 이후에도 같은 옵션을 쓰며, 자동 브라우저 열기가 불필요한 진단에서는 `--no-open`을 붙인다.

Tasks의 새 요청은 배정/Run으로 접수할 수 있다. 접수 후에는 Office가 역할과 상태를 관리하므로 같은 요청을 다시 Run하거나 상태를 수동으로 Done으로 바꾸지 않는다. 부모 카드에서 하위 작업과 승인 대기를 확인하고 상단 Decisions에서 답한다. 최종 답변이 부족하면 **이전 답변과 항목별 피드백**이 표시된다. 답을 다시 작성하지 않고 **피드백 확인 후 승인**을 누르면 현재 검증된 결과물을 인도한다. 이전 평가를 합격으로 바꾸거나 모델을 다시 호출하지 않는다.

별도 설치 시험은 [검증 기록](verification/2026-09-29-native-claw-preview.md)을 참조한다. 같은 Mac의 깨끗한 소스·의존성·프로젝트·데이터 시험이며, 새 팀원 기기의 최초 로그인·VM 생성 검증과 실제 사용자 승인 완료를 대신하지 않는다.

## 원본 화면 실행

Office 저장소의 현재 작업 브랜치에서 Node 24.19를 사용한다. UI 빌드가 없다면 먼저 `npm run build:office`를 실행한다.

```sh
node bin/pazmo-office.mjs init --project /absolute/path/to/project --apply
node bin/pazmo-office.mjs start --claw --project /absolute/path/to/project --port 0
node bin/pazmo-office.mjs monitor --project /absolute/path/to/project
```

`monitor`가 반환한 주소를 연다. 사용자에게 Operator 키 복사나 승인 JSON 작성을 요구하지 않는다. 기존 서버가 실행 중이면 `stop --project ...` 이후 시작한다. 다른 runtime이 실행 중일 때 조용히 전환하지 않는다.

원본 데이터는 출력된 `dataDir`의 `claw/claw.sqlite`에 저장된다. 이전 runtime의 DB·검증·승인 기록은 그대로 보존하며 자동 이관하거나 양쪽에서 같은 작업을 완료 처리하지 않는다. 새 원본 화면에 이전 요청이 보이지 않는 것은 데이터 삭제가 아니다.

현재 열어둔 `http://127.0.0.1:49930/`는 `/private/tmp/pazmo-office-visual-preview/project`용 미리보기다. 실제 업무 결과를 보관하는 영구 프로젝트가 아니다.

## 실제 역할 실행

codex 또는 claude 중 하나 이상의 초기 로그인과 검증된 전용 VM 준비가 필요하다. 준비 여부와 설치 과정은 [실행 환경 기록](verification/2026-09-28-runtime-setup.md)을 따른다. 기존 서버를 중지한 뒤 같은 프로젝트로 시작한다.

```sh
node bin/pazmo-office.mjs stop --project /absolute/path/to/project
node bin/pazmo-office.mjs start --claw --live --project /absolute/path/to/project --port 0
node bin/pazmo-office.mjs monitor --project /absolute/path/to/project
```

캐릭터의 대화하기에서 업무지시를 보내거나 기존 Tasks에서 프로젝트를 선택해 배정한다. 현재 한 서버는 시작할 때 지정한 프로젝트만 실행한다. Office가 PM → 팀장 → 구현·리뷰·검증을 연결하며, 질문과 승인은 기존 Decisions에서 처리한다. 최종 승인은 실제 사용자 답변과 검증된 변경본에 연결된다. 결과는 로컬 인도 디렉터리에 저장하며 원본 프로젝트나 main을 자동 덮어쓰지 않는다.

kit 4.1.0이 각 역할의 전이를 소유하고, Office는 원본 Claw DB의 작업에 기존 승인·검증 기록을 연결한다. 실제 실행은 한 번에 한 작업을 진행한다. 취소는 해당 작업의 중지로 처리하며, 실행 종료가 불확실한 실패·재시작은 자동 재실행하지 않는다.

계획 응답의 형식 오류로 멈추고 프로세스 종료가 확인되면 기존 Decisions에 `계획 재개`가 나타난다. 원인을 확인한 뒤 재개 요청을 제출하면 기존 범위 승인과 실패 기록을 보존하며 해당 역할만 이어간다. 이 재개는 요청 전체에서 최대 두 번이며, 범위 승인이나 최종 승인을 대신하지 않는다.

옵션 없는 `start`와 기존 `bridge` 쓰기 명령은 이전 runtime 호환용이다. 원본 서버에서는 기존 채팅·작업·Decisions API를 사용하며 private API는 조회만 허용한다. 서로 다른 runtime에서 같은 작업을 독립적으로 완료 처리하지 않는다.

### Office 캐릭터

Office 화면에는 실제로 일을 맡는 역할 캐릭터만 보인다: **PM / 리드 / 개발 / 리뷰**(영어 화면은 PM / Lead / Engineer / Reviewer). 결정은 [office-role-characters-decision.md](understanding/office-role-characters-decision.md)이다.

- 역할 캐릭터는 Office 서버가 그 역할에 실제로 쓰는 캐릭터다(`GET /api/office-roles`). 실제 Office는 PM=Clio, 리드=Sage, 개발=Aria, 리뷰=Hawk이고, 원본 이름은 캐릭터 상세에 작게 남는다. PM 캐릭터가 없는 DB에서는 한 캐릭터가 `PM · 리드`처럼 보인다.
- 장면, 사이드바, 상세, 채팅, 작업 보드, 보고서, 상태 패널, 대시보드, Decisions가 같은 이름을 쓴다. 남은 캐릭터의 그림은 숨기기 전과 같다.
- 역할을 맡지 않은 원본 캐릭터(디자인·DevSecOps·운영 등)와 빈 부서 방은 그리지 않는다. 그 캐릭터가 작업 중이면 보인다.
- 표시만 바뀐다. DB의 캐릭터는 지우거나 이름을 바꾸지 않으므로, 이 기능을 빼면 예전처럼 모두 보인다. 캐릭터 추가·삭제는 지금처럼 막혀 있다.
- 역할 API가 없는 미리보기(옵션 없는 `start`)나 옛 서버, 역할 id를 하나도 못 찾은 경우에는 모두 보인다.
- 캐릭터 이름 편집은 지금처럼 막혀 있다. 나중에 이름 편집을 열 때는 역할 이름이 저장되지 않게 해야 한다.

## 팀 허브 (1단계 시험)

초대받은 팀원이 한 곳에서 레포 목록을 보고 요청을 올리게 하는 사내망 게시판이다. 허브는 AI를 실행하지 않는다. 요청은 레포 담당자가 수락해 **자기 PC의 Office와 자기 로그인**으로 실행한다. 내 구독이나 회사 API 키를 공유하지 않는다. 결정은 [team-hub-decision.md](understanding/team-hub-decision.md), 검증은 [검증 기록](verification/2026-10-12-team-hub.md)이다. **한 Mac 확인만 마쳤고 다른 사람 PC와 회사 IT 정책 확인은 남아 있다.**

### 팀원의 가장 짧은 순서

1. 관리자에게 받은 **초대 링크**를 연다. 사내망 허브라면 먼저 아래 "인증서를 한 번 신뢰하기"를 한다(OpenShift 허브는 필요 없다).
2. 합류하면 허브의 **내 Office 연결** 화면이 열린다. **연결 문자열 만들기 → 복사**를 누른다.
3. 그 레포를 클론해 둔 자기 PC에서 live Office를 켜고, 상단의 **팀 허브** 버튼을 눌러 붙여넣은 뒤 **연결**을 누른다. 경로나 터미널 명령은 필요 없다.
   - 허브는 Office의 git origin으로 레포를 찾는다. 허브에 없는 레포면 내 이름을 담당자로 해서 자동 등록한다. 다른 사람이 담당자인 레포면 거부되고, 그 사람이나 관리자가 나를 담당자로 추가하면 같은 문자열로 다시 연결할 수 있다(10분 안).
4. 이제 Office의 작업 카드나 채팅에서 **팀 허브로 보내기**로 다른 레포 담당자에게 일을 보낸다.

결정은 [team-hub-onboarding-decision.md](understanding/team-hub-onboarding-decision.md)이다.

### OpenShift에 허브 띄우기

노트북 IP가 바뀌어도 끊기지 않게 허브를 OpenShift 프로젝트에 상시로 띄울 수 있다. 라우터가 공인 인증서로 TLS를 처리하므로 **CA 신뢰와 지문이 필요 없다.** 결정은 [team-hub-openshift-decision.md](understanding/team-hub-openshift-decision.md)이다.

- 매니페스트는 OpenShift Template `deploy/openshift/pazmo-hub.json`이다. 이 레포가 공개라서 클러스터 호스트와 빌더 이미지는 매개변수이고, 실제 값은 git이 무시하는 `deploy/openshift/local.env`에 둔다.

```sh
# local.env 예: HUB_HOST=pazmo-hub-<프로젝트>.<apps 도메인>, BUILDER_IMAGE=<Node 24 S2I 빌더 이미지>
oc login …                      # 사용자가 직접
oc project <프로젝트>
oc process -f deploy/openshift/pazmo-hub.json --param-file=deploy/openshift/local.env | oc apply -f -
npm run hub:bundle              # dist/hub-bundle 생성
oc start-build pazmo-hub --from-dir dist/hub-bundle --follow
oc logs deploy/pazmo-hub | head -1   # 첫 줄 JSON의 adminInvite가 관리자 입장 링크
```

- 파드는 1개(Recreate)이고 데이터는 PVC `/data`의 SQLite다. 다시 배포하거나 파드가 재시작돼도 팀원·레포·요청은 남는다.
- 로그인 정보와 토큰은 다루지 않는다. 위 명령은 사용자가 실행한다.

### 허브 시작

허브를 여는 사람의 Mac에서 **직접 연 터미널**로 실행한다. 포그라운드 명령이며 Ctrl-C로 멈춘다. 세션 도구나 `nohup`으로 띄운 백그라운드 허브는 시간 제한에 죽는다. 계속 켜 두려면 launchd 서비스로 감싼다.

```sh
node bin/pazmo-office.mjs hub --host <사내망 IPv4> [--name <이름>] [--port 8443] [--data-dir /absolute/path]
```

- `--host`는 이 Mac의 사설 IPv4(10/8, 172.16/12, 192.168/16)여야 한다. Office와 달리 사내망에 열리며 HTTP는 없다.
- **`--name`을 쓰면 다시 시작할 때마다 같은 값을 줘야 한다.** 다르면 `HUB_CA_NAME_CHANGED`로 멈춘다(허브 인증서 디렉터리를 지우고 모두 다시 신뢰해야 한다).
- 첫 줄에 JSON이 출력된다: `url`, `fingerprint`(CA 지문), `trust`, 팀원이 아직 한 명도 없을 때만 `adminInvite`(관리자 입장 링크, 1회용, 72시간). **관리자가 한 번 입장하면 이후에는 출력되지 않는다.** 입장 전에 다시 시작하면 새 관리자 링크가 나오고 이전 링크는 무효가 된다.
- 데이터는 `<데이터 루트>/team-hub/`에 있다. 기본 데이터 루트는 `~/.local/share/pazmo-agent-office`다. Office의 프로젝트 데이터와 분리되어 있다.
- **IP는 고정이어야 한다.** 노트북에서 Wi-Fi가 바뀌어 IP가 바뀌면 허브에 닿지 않고, 쿠키가 호스트별이라 브라우저 로그인도 사라진다. 다시 시작하면 서버 인증서만 새 IP로 다시 발급되고 CA는 유지되어 다시 신뢰하지 않아도 된다. 팀원은 새 주소에서 관리자에게 새 기기 링크를 받는다.
- macOS 방화벽 허용과 잠자기 방지는 사용자가 직접 설정한다. 회사 IT·보안 정책상 허용되는지도 먼저 확인한다.

### 인증서를 한 번 신뢰하기 (초대 링크보다 먼저)

허브는 자체 CA로 HTTPS를 연다. 각 팀원은 **초대 링크를 열기 전에** 한 번 신뢰한다.

1. `<url>/trust`에서 CA 파일을 받고, 화면의 지문을 관리자가 따로 전달한 지문과 대조한다. 다르면 신뢰하지 않는다.
2. 터미널에서 신뢰를 추가한다(경로는 받은 파일 또는 허브 데이터 디렉터리의 `team-hub/tls/ca.pem`).

```sh
security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db <ca.pem 경로>
```

키체인 접근에서 직접 추가해 "항상 신뢰"로 바꿔도 된다. 이 CA는 사설 IP 대역과 허브 이름에만 유효하도록 제한되어 있다.

**신뢰 전에 브라우저 경고를 넘겨 초대 링크를 열면 안 된다.** 초대가 소비되는데 Chrome이 Secure 쿠키를 버려 들어가지 못한다. 이 경우 관리자가 새 기기 링크를 발급해야 한다.

### 초대와 팀원 관리

- 관리자가 허브의 **팀원·초대**에서 받을 사람 이름으로 초대 링크를 만든다. 링크는 1회용, 72시간 유효이며 서버에는 해시만 저장된다. 링크와 함께 CA 지문을 따로 전달한다.
- 링크를 열면 그 브라우저가 등록된다(HttpOnly·Secure·SameSite=Strict 쿠키, 30일, 쓸 때마다 연장). 메신저나 메일 앱에서 열었다면 페이지를 한 번 새로 고친다.
- 같은 사람의 다른 브라우저는 관리자가 **새 기기 링크**를 만든다. 관리자는 팀원이나 브라우저를 회수할 수 있고, 다음 요청부터 거부된다.

### 레포 등록과 담당자

- **레포** 화면에서 이름과 git origin 주소로 등록한다. Office를 처음 연결할 때 허브에 없는 레포는 자동 등록된다. 등록한 사람이 첫 담당자다. 담당자나 관리자가 담당자를 더하거나 뺀다(마지막 담당자는 뺄 수 없다).
- 요청은 누구나 올린다. **수락·거절과 그 레포의 Office 연결은 담당자만** 한다. 수락·거절은 허브 웹이나 담당자 Office의 Inbox에서 한다. 허브는 정규화한 origin 주소로 레포와 Office를 묶는다.

### Office 연결

허브의 **내 Office 연결**(초대로 합류한 직후 열리는 화면, 메뉴에도 있다)에서 **연결 문자열 만들기**를 누르고 복사한다. 문자열은 팀원 단위이고 10분 동안 한 번만 쓸 수 있다. 형식은 `https://<허브>/connect#c=<코드>`이고, 사내망 허브는 `&fp=<CA 지문>`이 붙는다. 이 주소를 브라우저로 열면 "Office에 붙여넣으세요" 안내만 나온다.

- **화면에서:** 그 레포의 live Office 상단 **팀 허브** 버튼 → 붙여넣기 → **연결**. 점 색은 연결됨 초록, 안 됨 회색, 옛 허브 호박색이다. 연결되면 `허브 · 내 이름 · 레포`가 보인다. **연결 해제**는 화면 안에서 한 번 확인한다. 이미 연결된 Office에 새 문자열을 붙이면 "기존 연결(<옛 허브>)을 <새 허브> 연결로 바꿉니다. 진행 중인 보낸 요청은 먼저 정리하세요."를 확인한 뒤 바꾸고, 실패하면 기존 연결이 그대로 남는다.
- **터미널에서**(같은 동작):

```sh
# `pazmo-office`는 `node bin/pazmo-office.mjs`와 같다
pazmo-office hub-link --project <레포 로컬 경로> --connect "<연결 문자열>"
pazmo-office hub-unlink --project <레포 로컬 경로>
```

  예전 형식 `--hub <허브 url> --code <코드> [--fingerprint <CA 지문>]`과 레포 화면의 레포 단위 코드도 계속 동작한다.
- 레포는 Office 프로젝트의 `git origin`으로 정해진다. 허브에 없으면 origin 끝 이름(겹치면 `-2`)으로 등록되고 내가 담당자가 되며, 창에 "허브에 새 레포 …로 등록했습니다."가 나온다. 평소 Office에 `--data-dir`를 줬다면 터미널 명령에도 같은 값을 쓴다.
  - **origin을 확인하고 붙인다.** ssh 별칭(`git@github-work:…`)이나 포크·미러 origin은 다른 레포로 보여 `-2` 같은 새 레포가 생긴다. 다른 팀원들이 원래 레포로 보낸 일은 이 Office에 오지 않는다. 관계없는 프로젝트의 Office에 붙이면 그 origin 주소가 허브 팀원 모두에게 보인다.
  - **잘못 등록됐을 때:** 지금은 허브에서 레포를 지울 수 없다. 관리자가 레포 화면에서 맞는 담당자를 더하고 잘못 붙은 담당자를 뺀다. 남은 레포는 쓰지 않으면 된다.
- 지문이 있으면 그 지문의 인증서 한 개만 신뢰하고, 없으면(OpenShift) 공인 인증서를 시스템 신뢰로 검증한다. 토큰은 Office 데이터 디렉터리에 0600으로 저장되고 브라우저로 가지 않는다. 연결과 해제에는 Office 화면의 세션 쓰기 토큰이 필요하다. 토큰은 그 팀원·그 레포의 요청 조회, 진행 올리기, 답변·취소 받기와, 아래 "Office에서 보내기"의 레포 목록·요청 생성·보낸 요청 조회·요청자 답변·취소, "받은 요청"의 대기 요청 보기·수락·거절만 할 수 있다.
- 연결은 **live Office(`start --live`)**에서만 동작하고 5초마다 허브를 조회한다. live가 아니면 창에 "실행 모드(live)에서만 팀 허브에 연결할 수 있습니다."가 나온다.
- 상단 점의 초록은 "연결 설정이 있음"이다. 허브에서 연결이 해제되거나 담당자에서 빠지면 동기화가 실패해도 점은 초록으로 남는다. 이때는 허브의 레포 화면을 확인하고 다시 연결한다.
- `hub-unlink`나 창의 **연결 해제**는 이 Office의 설정만 지운다. 허브 쪽 연결 기록까지 끊으려면 허브의 레포 화면에서 연결 해제를 한다.
- Office는 계속 `127.0.0.1`에만 열린다. 허브가 Office로 들어오지 않고, 연결은 사람이 붙여넣고 누를 때만 일어난다.
- 허브를 다른 Office(다른 PC·다른 데이터 디렉터리)로 옮길 때는 **먼저 진행 중인 일을 반납하거나 취소**한다. 다시 짝을 맺으면 이전 연결이 회수되고, 이전 Office에 남은 로컬 작업은 허브가 알 수 없어 계속 돈다. 남으면 맡은 사람이 직접 취소한다.

### 누가 무엇에 답하나

| 결정 | 답하는 사람 | 어디서 |
| - | - | - |
| PM 질문, 요청 범위(G1), 계획 재개 | **요청자** | 허브 요청 상세, 또는 Office에서 보낸 요청이면 그 Office의 Decisions(승인 또는 요청 취소) |
| 작업 G1, G3, G4와 인도 | **맡은 사람** | 자기 Office 화면 |

- 맡은 사람의 Office는 요청자의 질문·G1에 "요청자가 팀 허브에서 답합니다"를 보여 주고 직접 답하지 못하게 한다. 허브 답변은 답변 원문, 답한 팀원과 시각, 허브 요청 ID와 함께 기록되고 출처는 `hub:<memberId>`다.
- 질문이 바뀌었으면 Office가 옛 답을 거부하고 허브는 "질문이 바뀌었어요"를 보여 준다.
- G4와 인도는 허브에서 끝낼 수 없다. 허브 답변을 위조해도 인도에는 맡은 사람의 로컬 G4가 필요하다.
- 요청자는 요청을 취소할 수 있고, 맡은 사람은 반납할 수 있다. 허브가 꺼져도 수락된 작업은 Office에서 계속되고, 허브가 켜지면 최신 상태를 다시 올린다.

### Office에서 보내기 (2단계)

연결된 live Office에서 다른 레포 담당자에게 일을 보낸다. 결정은 [team-hub-office-send-decision.md](understanding/team-hub-office-send-decision.md), 검증은 [검증 기록](verification/2026-10-13-team-hub-office-send.md)이다.

- **보내기:** Tasks 카드나 채팅창의 **팀 허브로 보내기**를 누른다. 대상 레포, 내용(UTF-8 16384바이트까지), 위험도를 고른다. 허브에는 내 이름으로 요청이 생기고, 출처는 `<레포> Office의 작업 '<제목>'` 또는 `<레포> Office 채팅`으로 남는다. 모델은 부르지 않는다. 연결당 시간당 30건까지다.
- **같은 창에서 다시 보내기:** 응답을 못 받아 다시 눌러도 같은 요청을 돌려준다. 창을 새로 열면 새 요청이다.
- **상태:** 카드에 `↗ <레포> · <상태>`가 붙고 5초마다 갱신된다. 완료되면 4줄 요약을 보여 준다. 원래 작업은 멈추지 않는다. 상대 레포의 변경(diff)은 받지 않고 내 쪽에 자동으로 반영하지도 않는다.
- **답하기:** 상대 PM의 질문, 범위 승인(G1), 계획 재개가 내 Office **Decisions**에 `팀 허브 · <레포> · …`로 뜬다. 1번은 승인(답변 제출)이고 2번은 **요청 취소**다(요청자가 자기 요청을 닫는 것). 범위를 고쳐 다시 올리게 하는 흐름은 없다. 상대 담당자가 맡지 않고 닫은 경우는 카드에 **"거절됨 · 사유"**로 따로 보인다(아래 "받은 요청"). 상대의 작업 G1·G3·G4와 인도는 맡은 사람의 일이라 보이지 않는다.
- **보낸 요청 취소:** Decisions의 2번이나, 카드의 `↗ <레포> · <상태>` 옆 ✕로 취소한다. ✕는 대기·맡음·실행 중·답변 대기일 때만 보인다. 두 곳 모두 화면 안에서 "되돌릴 수 없어요…"를 한 번 확인한다. 허브 요청 화면에서 취소한 것과 같아서, 맡은 사람의 Office는 5초 안에 작업을 멈춘다. 이미 끝난 요청이면 "이미 끝난 요청이에요."가 나온다. 허브가 옛 버전이면 "허브를 업데이트해야 취소할 수 있습니다"가 나온다. 이 Office에서 내가 보낸 요청만 취소할 수 있다. 채팅으로 보낸 요청은 카드가 없으므로 Decisions 항목이나 허브에서 취소한다. 결정은 [team-hub-office-cancel-decision.md](understanding/team-hub-office-cancel-decision.md), 검증은 [검증 기록](verification/2026-10-14-team-hub-office-cancel.md)이다.
- **버튼이 비활성화될 때:** 연결이 없거나 live가 아니면 버튼이 없다. 허브가 옛 버전이면 비활성화되고 "허브를 업데이트해야 합니다"가 나온다. **새 Office를 연결하기 전에 허브를 먼저 업데이트한다.** 새 허브는 옛 Office와 함께 쓸 수 있다.
- 허브 토큰은 Office 서버에만 있고 브라우저로 가지 않는다. 보내기, 답하기, 취소에는 Office 화면의 세션 쓰기 토큰이 필요하다.
- Office 화면의 확인과 알림은 브라우저 기본 대화상자가 아니라 화면 안 확인창·알림이다. 앱의 내장 브라우저처럼 기본 대화상자를 막는 브라우저에서도 동작한다.

### 받은 요청: Office에서 수락·거절

내 레포로 들어온 대기 중 요청은 연결된 live Office의 **Tasks Inbox 열 맨 위 "받은 팀 허브 요청"** 묶음에 5초 안에 뜬다. **허브를 먼저 업데이트한다**: 옛 허브면 묶음에 "허브를 업데이트해야 받은 요청을 볼 수 있습니다."가 계속 보인다. 허브는 시작할 때 새 칸을 자동으로 더하고(`ALTER TABLE ADD COLUMN`), 이전 허브로 되돌려도 안전하다(거절은 "취소됨"으로만 보인다). 결정은 [team-hub-office-inbox-decision.md](understanding/team-hub-office-inbox-decision.md)이다.

- 카드에는 요청자, 보낸 레포, 내용 앞부분, 위험도(높으면 "위험 높음")와 **[수락] [거절]**이 있다. 아직 작업이 아니라 작업 목록에는 들어가지 않는다.
- **수락:** 허브에서 수락되고(같은 사람이 두 번 눌러도 한 번만 맡는다), 다음 동기화(5초)에 지금처럼 Inbox에 작업으로 생겨 PM이 시작한다. 다른 담당자가 먼저 맡았으면 "이미 다른 담당자가 맡았습니다."가 나온다. 허브 웹의 **내가 맡기**와 같은 동작이며 허브 웹 수락도 그대로 쓸 수 있다.
- **거절:** 카드 안 확인 칸에 사유(선택, 500자까지)를 쓰고 거절한다. 요청은 닫히고(같은 레포의 다른 담당자도 더는 맡을 수 없다), 요청자의 Office 카드와 허브 요청 화면에 **"거절됨 · 사유"**가 보인다. 허브 웹 요청 화면에도 담당자용 [거절]이 있다. 거절된 요청은 다시 열 수 없으니 필요하면 요청자가 새로 보낸다.
- 허브가 옛 버전이면 "허브를 업데이트해야 받은 요청을 볼 수 있습니다."가 나온다. 보내기·취소는 계속 된다.
- 수락·거절(POST)은 사람이 눌러야만 일어나고, 세션 쓰기 토큰(CSRF)이 필요하다. 목록 조회는 다른 허브 조회처럼 로컬 세션만 필요하다.
- 연결 토큰은 그 팀원·그 레포의 대기 요청 본문 보기·수락·**되돌릴 수 없는 거절**까지 넓어졌다. 보이는 범위는 그 팀원이 허브 웹에서 보던 것과 같다. Office 데이터 디렉터리(토큰 파일)가 새어 나갔다고 의심되면 허브의 레포 화면에서 그 연결을 해제(회수)한다.

**다른 허브로 연결을 바꿀 때:** 이전 허브에서 받아 진행 중인 작업이 있으면 교체 확인 칸에 "이전 허브에서 받은 진행 중 작업 N건이 취소됩니다."가 나온다. 새 연결이 성공한 뒤에만 이 Office에서 그 작업들을 취소하고 "이전 허브 작업 N건을 취소했습니다."를 보여 준다. 같은 허브에 다시 연결하거나 연결이 실패하면 취소하지 않는다.

- **이전 허브에는 알리지 않는다.** 이전 허브의 요청은 "맡음"과 마지막 진행 상태로 남고 요청자는 계속 기다린다. 바꾸기 전에 허브 웹에서 반납하거나 요청자에게 알린다. 나중에 그 허브로 다시 연결하면 이 Office는 그 작업들을 "취소됨"으로 올려 요청이 닫힌다(거절이 아니며 사유도 없다).
- **같은 허브라도 주소가 다르면**(IP·호스트 이름·포트) 다른 허브로 보고 취소한다. 확인 칸 경고를 보고 판단한다.
- **연결 해제 뒤 다른 허브에 연결하면 이전 작업을 취소하지 않는다.** 해제 확인 칸에 "이 Office에는 허브에서 받은 진행 중 작업 N건이 남습니다."가 나오면, 필요한 작업은 Tasks에서 직접 취소한다.

### 내 PC에서 나가는 것

연결된 Office는 요청마다 허브에 **진행 스냅샷**을 올린다. 허브에 저장되고 허브에 들어온 모든 팀원이 볼 수 있다.

- **나가는 것:** 제목, 상태와 진행 메시지, 질문·범위(G1) 결정 내용, **역할 대화**, 변경 내용(diff, 512 KiB에서 잘림), 최종 보고 요약 4줄, 역할별 실행기·버전·모델. diff와 대화에는 코드와 파일 이름이 그대로 들어간다.
- **나가지 않는 것:** codex·claude 로그인 정보, 레포 전체, 인도물 파일, 실행 환경(VM), G4 검증 증거 원문. 허브에는 이를 읽을 수단이 없다.
- 허브 쪽 저장: 팀원, 등록한 브라우저, 초대·연결 코드·세션·토큰(해시만), 레포, 요청, 스냅샷, 답변. 허브 데이터는 허브를 연 Mac에 있다.

### 알려진 한계

- 사내망 허브는 고정 사설 IPv4에서만 연다. 호스트 이름이나 IP 변경 자동 대응은 없다. IP가 자주 바뀌면 OpenShift 허브를 쓴다.
- 허브 CA는 회전하지 않는다. 만료 30일 전이면 `HUB_CA_EXPIRING`으로 멈추며, TLS 디렉터리를 지우고 모두 다시 신뢰한다.
- Lead가 다른 레포 요청을 초안으로 만드는 기능, 에이전트 간 질문, 알림, 자동 배정은 후속이다.
- 팀원을 회수해도 그 사람이 맡은 열린 요청은 열려 있다. 요청자가 취소하거나 관리자가 정리한다.
- 요청 본문은 UTF-8 16384바이트(한글 약 5400자)까지다.

## 새 Office (1단계, 시험)

Claw Empire 없이 화면 네 개(Tasks·작업 상세·Decisions·Agents)만 있는 새 Office다. 기본은 지금처럼 Claw Office이고, 새 Office는 `--lean`을 붙일 때만 켜진다. 실행 엔진(결정·격리 실행·검증·인도)은 Claw Office와 같다. 결정은 [lean-office-decision.md](understanding/lean-office-decision.md)다.

```sh
# Claw Office가 같은 프로젝트에 켜져 있으면 먼저 멈춘다
node bin/pazmo-office.mjs stop --project /absolute/path/to/project

./office --lean --project /absolute/path/to/project
```

- **켜기:** `up --lean`은 VM 준비, 로그인 확인, 의존성 설치를 지금과 똑같이 한다. Claw 화면 빌드만 하지 않는다. 실행 엔진이 원본 Claw Empire 폴더의 패키지 하나(`ws`)를 쓰기 때문에 의존성 설치는 필요하다.
  - 같은 프로젝트에 Claw Office가 켜져 있으면 `ENGINE_MISMATCH`("Stop the current Office before changing its runtime.")로 거부한다. 켜져 있는 Office는 건드리지 않는다.
  - 화면 미리보기만 하려면 `start --lean`을 쓴다. 이때 모델 호출은 막혀 있다. 의존성이 아직 없으면 `NOT_INSTALLED`로 멈추므로 `./office --lean`을 한 번 먼저 실행한다.
- **데이터:**
  - 새 Office는 데이터 디렉터리의 `lean/office.sqlite`를 쓴다.
  - Claw 데이터(`claw/`)는 읽지도 지우지도 않는다. 기존 작업은 옮기지 않으므로 새 Office는 빈 보드로 시작한다.
- **접속:** `monitor`가 주는 `http://127.0.0.1:<포트>/`를 연다. 같은 PC의 브라우저면 키 입력 없이 세션이 생긴다.
- **Agent:** agent는 작업을 맡는 일꾼이다. 기획·설계·구현은 **작업 실행기**로, 리뷰와 G4 평가는 **리뷰 실행기**로 돈다.
  - live로 처음 켜면 준비된 CLI로 "기본 agent"가 생긴다. codex를 쓸 수 있으면 codex, 아니면 claude다.
  - Agents 화면에서 추가, 이름 변경, 실행기 두 개의 변경(CLI·모델·effort), 삭제를 한다. CLI 목록은 대화상자를 열 때 새로 확인하며, 방금 로그인한 CLI는 최대 5초 늦게 보인다.
  - 진행 중인 작업이 있는 agent와 마지막 agent는 지울 수 없다.
- **작업:** [새 작업]에서 제목, 내용, 맡을 agent, 위험도를 고른다.
  - 그 agent의 실행기를 지금 쓸 수 없으면 "agent 실행기를 확인하세요."가 나오고 작업은 만들어지지 않는다.
  - 한 번에 한 작업만 돌고 나머지는 "대기"에 있다. 시작하지 못한 작업은 작업 상세의 진행 기록에 "작업을 시작하지 못했습니다: <코드>"가 남는다.
- **보드:** 열은 대기·진행·결정 대기·완료·취소다. 카드에는 제목, agent, 단계(기획·설계·구현·리뷰·최종 승인), 높은 위험 표시가 보인다. 작업이나 그 하위 작업에 답할 결정이 있으면 "결정 대기"로 간다.
  - 엔진이 더 진행하지 않는 작업(실행 오류, 사람 확인이 필요한 검증, 재시작 후 다시 돌리지 않는 단계)에는 **"멈춤"** 표시가 붙는다. 작업 상세 위쪽에 이유가 나온다. 진행 기록을 보고 다시 실행하거나 취소한다.
  - **다시 실행:** 멈춘 작업 상세의 [다시 실행]을 누르면 새 작업 창이 제목·내용·agent·위험도가 채워진 채 열린다. 고쳐서 확인하면 새 작업을 만들고, 그다음 멈춘 작업을 취소한다(되돌릴 수 없다). 결정은 [lean-rerun-decision.md](understanding/lean-rerun-decision.md)다.
    - 새 작업은 기획부터 다시 하므로 G1 승인도 다시 한다. 엔진의 다른 규칙과 대기열은 그대로다.
    - 새 작업을 만들지 못하면 멈춘 작업은 그대로 남는다. 새 작업은 만들었는데 멈춘 작업을 취소하지 못하면 "이전 작업 화면에서 취소하세요"가 나온다.
    - 한 작업은 한 번만 다시 실행된다. 두 작업의 상세에는 서로를 잇는 링크("이전 작업", "다시 실행한 작업")가 보인다.
- **작업 상세:** 내용, 진행 기록, 이 작업의 결정, 결과 요약(G4의 변경 사항 3줄, 인도 뒤에도 남음), 변경 내용(diff), 단계별 실행기·모델·버전, 인도 위치, [작업 취소](멈춘 작업에는 [다시 실행]도)가 있다. Decisions 화면의 작업 링크는 하위 작업이 아니라 처음 만든 작업으로 간다.
- **결정:** Decisions 화면이나 작업 상세에서 답한다.
  - 1번은 메모가 필요하다. 2번은 취소다. G4에 피드백이 있으면 3번 "피드백 확인 후 승인"이 나온다.
  - G1·G3·G4 승인은 10분이 지나면 새로 발급된다. "결정이 갱신되었습니다. 다시 답해 주세요."가 나오면 다시 답한다. 질문과 계획 재개는 만료되지 않는다.
  - 메모를 쓰는 동안에는 화면을 새로 고치지 않고 아래에 "새 내용이 있습니다"를 보인다.
- **멈추기:** `stop`. 진행 중인 작업이 있으면 `TASK_ACTIVE`로 거부한다. 멈추는 중의 쓰기 요청은 "Office를 멈추는 중입니다."로 거부한다.
- **보안:**
  - `127.0.0.1`에만 열린다. Host·Origin·세션 쿠키(포트별)·CSRF 검사를 거친다.
  - 세션은 같은 PC의 루프백 연결이면 누구에게나 준다. Claw Office와 같은 수준이며, 결정 문서의 "일회용 주소"는 1단계에서 이 방식으로 대신했다. 같은 Mac을 다른 사용자와 함께 쓰면 그 사용자도 결정에 답할 수 있다.
  - 화면은 같은 출처의 파일만 불러오고(CSP), 데이터는 글자로만 넣는다.
  - 실행기 목록에는 CLI 설치 경로를 싣지 않는다.
- **이번 단계에 없는 것:** 팀 허브 화면, 채팅, 하위 작업 화면, 회의, 대시보드, 픽셀 사무실, 동시 실행, 기존 데이터 옮기기.
  - 허브 연결 파일은 남아 있지만 새 Office에서는 쓰이지 않는다.
  - 채팅 연동 명령(`bridge`, `contract`, `intake-*`, `operator-key`)은 새 Office에서 `UNSUPPORTED`다.
- **알려진 한계:**
  - Lead의 질문과 하위 작업의 계약 승인은 "설계" 단계로 보인다.
  - 한 번 시작한 작업은 다음 단계 순서를 기다리는 동안에도 "진행"에 있다.
  - 하위 작업이 취소되면 요청이 "리뷰"에 머물 수 있다. 이때는 작업 상세에서 직접 취소한다.
  - 영어 화면에서도 엔진이 쓴 결정 내용은 한국어로 보인다.

## 팀 Office (2단계, 시험)

팀 Story 보드에서 한 사람이 Office 하나에 repo 여러 개를 등록해 켜는 단계다. 팀 Office는 repo마다 lean 엔진을 하나씩 두지만, **2단계 팀 Office는 repo 엔진을 실행하지 않는다(3단계에서 Story Task 모드와 함께 켬).** 가져가기 멈춤·하루 상한에 걸리지 않으면, repo마다 Hub 연결과 `gh` 로그인을 확인한 뒤 담당 repo의 ready Task 하나를 가져와 기록하고 하트비트를 보낸다. **가져온 Task를 아직 실행하지 않는다(3단계).** 그래서 팀이 쓰는 단계가 아니라 시험 단계다. 화면도 없다(5단계). 결정은 [team-story-board-decision.md](understanding/team-story-board-decision.md), 검증은 [2단계 검증 기록](verification/2026-10-29-team-story-office-repos.md)이다.

```sh
# `pazmo-office`는 `node bin/pazmo-office.mjs`와 같다
# 1. repo 등록 (repo마다; 그 repo의 단일 Office가 켜져 있으면 먼저 멈춘다)
pazmo-office team add --project <repo 로컬 경로>

# 2. repo마다 Hub 연결 (연결 문자열은 Hub의 "내 Office 연결"에서 만든다)
pazmo-office hub-link --project <repo 로컬 경로> --connect "<연결 문자열>"

# 3. repo의 Git 호스트마다 gh 로그인 (예: github.com과 회사 GitHub Enterprise)
gh auth login --hostname <Git 호스트>

# 4. 팀 Office 켜기 (VM·실행기·의존성 준비는 ./office --lean과 같다)
./office --team

# 5. 상태 보기
pazmo-office status --team
```

- **상태(`status --team`):** repo마다 `state`와 `gh` 결과가 나온다.
  - `state`는 `ready`, `no-link`(Hub 연결 없음), `gh`(로그인 안 됨), `relink`(Hub가 연결을 거절함, 다시 연결), `hub-too-old`(Hub가 Story 경로를 모름) 중 하나다.
  - 그 밖에 `paused`, `dailyCap`, `today`(오늘 새로 가져온 수), `claim`(지금 가진 Task의 Story·Task 번호와 제목, repo), `busy`(실행 중인 엔진이 있는지. 2단계는 엔진을 실행하지 않으므로 늘 `false`)가 나온다.
  - `execution`은 `--live`(또는 `./office --team`)로 켰는지만 나타낸다. 2단계에서는 어느 쪽이든 repo 엔진이 잠겨 있다.
  - ready가 아닌 repo는 5분마다 다시 확인한다. 연결하거나 로그인한 뒤 재시작할 필요는 없다.
- **가져가기 설정**(팀 Office가 꺼져 있어도 된다):

```sh
pazmo-office team pause      # 새 Task를 가져가지 않는다 (가진 Task의 하트비트는 계속)
pazmo-office team resume
pazmo-office team cap 3      # 하루 상한 1–100 (기본 5, 그 PC의 자정에 풀린다)
pazmo-office team cap off    # 상한 없음
pazmo-office team status     # 설정과 열린 기록 (Office가 꺼져 있어도 된다)
```

- **멈추기:** `pazmo-office stop --team`.
- **가진 Task:** 2단계는 가져온 Task를 끝내지 않는다. 그래서 한 번 가져오면 그 기록이 닫힐 때까지 새 Task를 가져가지 않는다. 켜져 있는 팀 Office는 60초마다 하트비트를 보내 그 Task가 보류되지 않으므로, PL은 풀 수 없고 취소만 할 수 있다. PL이 Hub에서 그 Task를 취소하면 켜져 있는 팀 Office가 다음 하트비트에서 기록을 닫는다. Hub가 그 Task를 모른다고 답하면(`NOT_FOUND`, Hub를 새로 만들었거나 repo를 다른 Hub에 다시 연결함) 기록을 닫고, Hub가 아직 이 사람의 claim이라고 하면 다음 가져가기에서 다시 받는다. Hub가 모른다고 답한 Task가 Hub의 다른 repo에 이 사람의 claim으로 남아 있으면(예: origin을 바꿔 다시 연결함), 그 Task를 PL이 풀거나 취소할 때까지 팀 Office는 아무 Task도 가져가지 않는다. Hub는 열린 Task가 있는 사람에게 새 Task를 주지 않는다. 지금은 `status --team`에 이유가 나오지 않는다(`claim`이 `null`).
- **repo 바꾸기:** `team add`·`team remove`는 팀 Office를 멈춘 뒤에 한다. 켜지는 중에도 거부한다(`TEAM_RUNNING`). 지금 가진 Task의 repo는 폴더가 남아 있는 한 그 기록이 닫힐 때까지 뺄 수 없다(`OPEN_CLAIM`).
- **repo 폴더를 옮기거나 지웠을 때:** `start --team`·`./office --team`이 `REPO_MISSING`으로 멈추고 그 경로와 `pazmo-office team remove --project <경로>`를 알려 준다. 폴더를 제자리에 돌려놓거나, 그 명령으로 뺀다. 폴더가 없는 repo는 가진 Task가 있어도 빠지고, 그 로컬 기록은 버린다(`REPO_REMOVED`). Hub의 그 Task는 하트비트가 끊겨 10분 뒤 보류되고, 그다음은 PL이 정한다. **그동안 팀 Office는 다른 repo의 Task도 가져가지 않는다.** Hub에는 그 Task가 아직 이 사람의 claim으로 남아 있기 때문이다. 빼기 전에 PL에게 그 Task를 취소해 달라고 하면 바로 풀린다.
- **repo에 남은 lean 작업:** 등록 전에 그 repo의 단일 lean Office에서 하던 작업은 손대지 않고 그대로 기다린다. 팀 Office는 그것을 시작하지도 보여 주지도 않는다. 그 repo를 `team remove`하고 단일 Office로 켜면 다시 보인다.
- **데이터:** 팀 Office 자신의 데이터는 데이터 디렉터리의 `team/`이다. repo 엔진은 그 repo의 기존 lean 데이터를 그대로 쓴다. 등록된 repo는 단일 Office(`--lean`·`--claw`)로 켤 수 없다(`IN_TEAM_OFFICE`).
- **실행 잠금:** 2단계 팀 Office는 `start --team`, `start --team --live`, `./office --team` 어느 것으로 켜도 repo 엔진을 잠근 채 연다. 가져가기·`gh` 확인·하트비트는 그래도 돈다.
- **없는 것:** 가져온 Task 실행(3단계), PL의 Story 올리기(4단계), 화면(`monitor --team`은 `UNSUPPORTED`, 5단계)

## 검증

[원본 서버 연결 기록](verification/2026-09-29-native-claw-preview.md)에 실제 HTTP/DB/WebSocket·브라우저 검사와 미검증 모델 흐름을 구분했다. 기존 [실행 환경 기록](verification/2026-09-28-runtime-setup.md)과 README pilot 증거는 보존한다.
