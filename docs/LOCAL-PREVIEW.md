# Local Office 실행 안내

`./office`는 Pazmo의 최소 Office(Tasks·작업 상세·Decisions·Agents)를 켠다. 출발점이던 Claw Empire의 화면·서버, 채팅 bridge, 옵션 없는 `start`의 옛 미리보기는 2026-10-30에 지웠다(D33, [결정](understanding/lean-office-default-decision.md)). 예전 버전에서 업데이트하는 순서는 [README](../README_ko.md#claw-버전에서-업데이트)에 있다.

## 팀원용 한 명령 실행 (Apple Silicon Mac)

Office 저장소의 `main` 브랜치를 받아 Office 저장소 디렉터리에서 실행한다. 최초 준비는 Node **24.19 이상 24.x**, npm/npx, Git·Python 3(Command Line Tools), Homebrew의 `colima`·`docker`, 그리고 Mac에 설치된 codex 또는 Claude Code 중 하나 이상의 로그인(`codex login` 또는 `claude auth login`)이다. 둘 다 있어도 되고 하나만 있어도 된다. `~/.codex/AGENTS.md`가 있는 codex와 hook이 걸린 claude는 쓰지 않는다. 쓸 수 있는 CLI가 없고 로그인된 CLI가 막혀 있으면 `./office`가 첫 단계에서 `RUNNER_BLOCKED`로 멈추고 CLI별 고칠 방법을 보인다. 상태는 Agents 화면에서 실행기를 고를 때 보인다. 고정 0.155.1 codex만 쓰려면 `--codex-runtime pinned`를 붙인다. 이때는 설치된 CLI와 상관없이 Mac codex 로그인(`~/.codex/auth.json`)이 있고 `~/.codex/AGENTS.md`·`AGENTS.override.md`가 없어야 시작한다. 필요하면 `brew install node@24 colima docker`를 사용하고 Node 24가 PATH에서 선택되는지 확인한다. Windows·Linux·Intel Mac의 live 실행은 아직 지원하지 않는다.

```sh
# 최초 한 번: Office 설치 폴더와 별도인 기존 Git 프로젝트 선택
./office --project /absolute/path/to/project

# 다음부터: 마지막으로 선택한 프로젝트 실행
./office
```

이 명령은 루트 의존성(`ws`)이 없거나 lock과 다른 버전일 때만 `npm ci --omit=dev`로 설치한다(npm 레지스트리 접속 필요). 이미 켜진 Office를 다시 쓸 때도 먼저 이 확인을 한다. 해시가 고정된 Codex 실행 파일, 호스트 공유가 없는 `pazmo-office` VM, 고정 Node 이미지를 준비하고 경계 검사를 거쳐 Office를 띄운 후 기본 브라우저를 연다. 첫 실행은 다운로드 시간이 필요하며 단계별 진행을 터미널에 표시한다. 이미 같은 프로젝트의 live Office가 떠 있으면 그대로 재사용한다. 코드 업데이트 적용은 진행 중인 작업이 없는 때 `node bin/pazmo-office.mjs stop --project /absolute/path/to/project` 후 `./office`로 한다.

첫 로그인은 사용자가 Mac에서 직접 한다. 로그인 파일을 VM이나 팀원에게 복사하지 않는다. 기존 VM 설정이 검증된 값과 다르면 덮어쓰지 않고 원인을 알려준다. 처음 실패한 설치는 같은 명령으로 다시 확인할 수 있다. `--data-dir /absolute/path`로 별도 데이터를 선택했다면 이후에도 같은 옵션을 쓰며, 자동 브라우저 열기가 불필요한 진단에서는 `--no-open`을 붙인다.

작업은 Tasks의 [새 작업]으로 만들고, 질문과 승인은 Decisions에서 답한다. 자세한 동작은 아래 [새 Office](#새-office)에 있다.

## 실행 모드

- `./office`(= `up`)는 실제 역할 실행(live)으로 켠다. 사용자가 설치·로그인한 codex 또는 claude CLI와 검증된 전용 VM을 쓴다. 준비 여부와 설치 과정은 [실행 환경 기록](verification/2026-09-28-runtime-setup.md)을 따른다.
- `node bin/pazmo-office.mjs start --project /absolute/path/to/project --port 0`은 화면 미리보기다. 모델 호출은 막혀 있다. `start --live`는 고정 실행 파일 두 개(`--controller`·`--executor`)를 직접 줄 때 쓴다.
- `--lean`은 예전 명령과 호환을 위해 받아들이며 같은 Office를 켠다. `--claw`는 `CLAW_REMOVED`로 거부한다.
- 한 Office는 시작할 때 지정한 프로젝트만 실행하고, 한 번에 한 작업을 진행한다. 결과는 로컬 인도 디렉터리에 저장하며 원본 프로젝트나 main을 자동 덮어쓰지 않는다. kit 5.0.3이 각 역할의 전이를 소유한다. kit 4로 시작한 작업은 `KIT_UPGRADE_REQUIRED`로 멈추므로, 취소하고 다시 만든다(D36).
- 예전 버전이 켠 Claw Office가 아직 켜져 있으면 `status`가 보여 주고, `start`·`up`·`monitor`는 `ENGINE_MISMATCH`로 거부한다. `node bin/pazmo-office.mjs stop --project …`로 멈춘 뒤 다시 켠다.

## 팀 허브

초대받은 팀원이 레포 목록과 담당자를 함께 관리하는 서버다. 팀 일은 팀 Story 보드(아래 [팀 Office](#팀-office-3단계-시험))로 Hub에서 나눠 가진다. 허브는 AI를 실행하지 않는다. 결정은 [team-hub-decision.md](understanding/team-hub-decision.md)와 [team-story-board-decision.md](understanding/team-story-board-decision.md)이다. **한 Mac 확인만 마쳤고 다른 사람 PC와 회사 IT 정책 확인은 남아 있다.** OpenShift 허브의 "이 Mac 연결"([아래](#이-mac-연결-openshift-허브))은 자동 시험만 마쳤고 실제 Mac으로는 아직 확인하지 않았다.

Office에서 허브 요청을 보내고 받던 화면(상단 팀 허브 버튼, 보내기, 받은 요청 수락·거절, 보낸 요청 취소)은 Claw Office와 함께 지웠다(D33). 허브 웹의 요청 게시판은 남아 있지만 수락한 요청을 실행하는 Office가 없다.

### 팀원의 가장 짧은 순서

OpenShift 허브라면 아래 [이 Mac 연결](#이-mac-연결-openshift-허브)이 이 순서를 대신한다(설치 한 줄과 웹 허용 한 번). 이 순서는 LAN(자체 인증서) 허브와, repo마다 직접 연결하는 방법이다.

1. 관리자에게 받은 **초대 링크**를 연다. 사내망 허브라면 먼저 아래 "인증서를 한 번 신뢰하기"를 한다(OpenShift 허브는 필요 없다).
2. 합류하면 허브의 **내 Office 연결** 화면이 열린다. **연결 문자열 만들기 → 복사**를 누른다.
3. 그 레포를 클론해 둔 자기 PC에서 `pazmo-office hub-link --project <레포 경로> --connect "<연결 문자열>"`을 실행한다.
   - 허브는 Office의 git origin으로 레포를 찾는다. 허브에 없는 레포면 내 이름을 담당자로 해서 자동 등록한다. 다른 사람이 담당자인 레포면 거부되고, 그 사람이나 관리자가 나를 담당자로 추가하면 같은 문자열로 다시 연결할 수 있다(10분 안).
4. 그 레포를 [팀 Office](#팀-office-3단계-시험)에 등록한다.

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

- `--host`는 이 Mac의 사설 IPv4(10/8, 172.16/12, 192.168/16)여야 한다. Office와 달리 사내망에 열리며 HTTP는 없다. 루프백(127/8)도 받지만 이 Mac에서만 닿으므로 혼자 하는 시험용이다([로컬 Hub로 하는 실제 확인](solutions/workflow-issues/run-a-team-stage-real-check-on-a-local-hub.md)).
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
- 요청은 누구나 올린다. **수락·거절과 그 레포의 Office 연결은 담당자만** 한다. 수락·거절은 허브 웹에서 한다. 허브는 정규화한 origin 주소로 레포와 Office를 묶는다.

### 이 Mac 연결 (OpenShift 허브)

팀원이 설치 명령 한 줄과 웹의 "이 Mac 허용" 한 번으로 자기 Mac을 **사람 단위**로 허브에 연결하는 흐름이다. 연결하면 Office가 내가 담당하는 repo를 스스로 clone·등록·연결하고, Mac에 로그인할 때마다 저절로 켜지고, 허브 머리글에 내 Mac의 상태가 보인다. 결정은 [hub-web-team-flow-decision.md](understanding/hub-web-team-flow-decision.md)(D41·V19)이고, 구현 판정과 검증은 [Mac 연결 검증 기록](verification/2026-11-04-mac-connect.md)이다.

**자동 시험만 마쳤다. 실제 Mac과 사내 OpenShift 허브로는 돌려 보지 않았으므로, 팀원에게 쓰라고 안내하지 않는다.**

**대상과 준비**

- Apple Silicon Mac과 OpenShift 허브(공인 인증서)다. LAN(자체 인증서) 허브에는 설치 한 줄이 없다(`/install.sh`는 404이고, `/mac` 화면이 위의 "팀원의 가장 짧은 순서"와 아래 "Office 연결"을 쓰라고 안내한다).
- Homebrew가 먼저 있어야 한다. 설치기는 Homebrew를 설치하지 않고, 없으면 설치 명령을 보여 주고 멈춘다.
- 터미널에서 실행한다. 설치기는 로그인 같은 질문을 터미널에서 받는다.

**한 줄**

허브 웹의 **이 Mac 연결**(머리글의 "내 Mac"을 누르면 열리는 `/mac`)에서 명령을 복사해 Mac 터미널에 붙여넣는다. 연결된 Mac이 없는 팀원의 "내 Office 연결" 화면(초대로 들어오면 처음 열리는 화면) 위에는 `/mac`으로 가라는 안내만 나온다. 명령은 `/mac`에서 복사한다.

```sh
curl -fsSL https://<허브 주소>/install.sh | sh
```

설치기는 단계마다 이름을 보이고, 이미 된 것은 건너뛴다. 멈출 때 나오는 말은 이렇다. Apple Silicon Mac이 아니면 그 사실만 말하고 멈춘다(단계 이름도 다시 실행할 명령도 없다). Homebrew가 없으면 Homebrew 설치 명령과 다시 실행할 명령을 보이고 멈춘다(단계 이름은 없다). 그 밖의 단계(프로그램 설치, Claude Code 설치, Office 받기와 준비, GitHub 로그인, Claude 로그인, 내 Mac 연결)에서 멈추면 그 단계 이름과 다시 실행할 같은 명령이 나온다. 하는 일은 이 순서다.

1. Apple Silicon Mac인지, Homebrew가 있는지 본다. Rosetta로 연 터미널도 Apple Silicon Mac이면 받는다(Homebrew는 `arch -arm64`로 부른다). Intel Mac은 거절한다.
2. `node@24`, `git`, `gh`, `colima`, `docker` 중 없는 것을 `brew install`로 설치하고, `claude`가 없으면 Claude Code를 설치한다.
3. Office를 `~/.pazmo/office`에 받고(이미 있으면 새 버전으로) 의존성을 설치한다.
4. GitHub 로그인이 없으면 브라우저로 로그인하고, Claude 로그인이 없으면 로그인한다.
5. `mac connect --hub <허브 주소>`를 실행한다.

**허용 화면에서 확인할 것**

`mac connect`는 터미널에 허용 주소와 코드(`ABCD-1234` 꼴, 10분 안에)를 보이고 브라우저를 연다. 브라우저가 열리지 않으면 터미널에 나온 주소를 직접 연다. 허용 화면에서 다음을 본다.

- 화면의 **코드**가 터미널의 코드와 같은지.
- **Mac 이름**이 지금 쓰는 이 Mac인지(기본은 이 Mac의 이름에서 `.local`을 뺀 것. `--name`으로 바꾼다).
- 지금 내 앞의 Mac이 맞는지.

맞으면 **이 Mac 허용**, 아니면 **거절**을 누른다. 코드는 한 번만 쓸 수 있다. 터미널은 3초마다 허용 여부를 묻다가 허용되면 이어 간다. 이 브라우저로 허브에 아직 들어오지 않았다면 안내 화면이 나온다. 초대 링크(이미 팀원이면 새 기기 링크)를 먼저 열어 들어온 뒤 같은 주소를 다시 열면 된다. 그동안 코드는 그대로 10분 유지된다.

**연결 뒤**

`mac connect`는 세 단계를 보이고 끝난다: 허브와 짝짓기, 담당 repo 맞추기, 로그인할 때 Office 자동 실행 등록. Office가 켜지기를 기다리지 않는다. 처음 켜기는 VM과 이미지를 준비하느라 몇 분 걸리므로, 몇 분 뒤 허브의 **내 Mac**에서 상태를 본다. 같은 명령을 다시 실행해도 된다. 허브가 이 Mac의 연결을 해제했다고 답할 때만 다시 짝짓고, 그 밖에는 담당 repo와 자동 실행만 다시 맞춘다. 허브에 닿지 않으면 아무것도 바꾸지 않고 다시 할 명령을 말한다.

**한 사람에 Mac 하나**

연결된 Mac은 한 사람에 하나다. 새 Mac을 허용하면(Mac이 토큰을 받는 순간) 그 사람의 이전 Mac과, 그 Mac이 받은 repo 연결이 해제된다. 허용 화면이 이것을 미리 알려 주고, 이전 Mac이 맡은 Task가 있으면 그것도 알린다(그 Task는 PL이 풀어 줘야 한다). 해제된 Mac의 Office는 허브에서 거절당하면 로그 한 줄만 남기고 허브 호출을 멈추고, 그 Mac에서 설치 명령을 다시 실행하면 새로 연결된다. 허용 뒤 터미널이 응답을 받지 못하면(토큰은 한 번만 준다) 설치 명령을 다시 실행한다.

**담당 repo를 받는 곳**

- 위치는 `<데이터 루트>/repos/<이름>`이다. 기본 데이터 루트는 `~/.local/share/pazmo-agent-office`다. 허브 repo 이름에서 영문·숫자·`.`·`_`·`-` 밖의 글자는 `-`로 바꾸고 앞의 `.`는 뺀다(80자까지). 담당 repo 둘의 이름이 같으면 뒤에 repo id 앞 8자를 붙인다.
- clone 주소는 `https://<허브가 아는 git 원격>.git`이고 인증은 내 git 설정(gh의 credential helper)이다. 중간에 끊긴 clone은 최종 이름의 폴더를 남기지 않는다(`.partial`로 받은 뒤 이름을 바꾸고, 남은 것은 다음 실행에서 지운다).
- 그 자리에 이미 폴더가 있으면 origin이 같은 repo일 때만 쓰고, 다르면 `CLONE_DIR_TAKEN`으로 건너뛰며 손대지 않는다.
- **연결 문자열로 만든 연결이 이긴다.** 같은 repo를 다른 곳에서 연결 문자열로 연결해 두었으면 허브가 이 Mac의 연결을 거절하고, 로그에 이유와 방법이 한 번 나온다. 이 Mac에서 쓰려면 허브의 레포 화면(`/repos`)에서 그 연결을 해제한다. 켜진 Office가 5분 안에 다시 연결한다. Mac이 받은 연결은 레포 화면에서 하나씩 해제할 수 없다. Mac 연결은 그 Mac을 해제할 때(`/mac`, 관리자는 팀원·초대 화면), 그 사람을 담당자에서 빼거나 팀원에서 해제할 때, 새 Mac을 허용할 때, 그리고 그 사람이 같은 repo를 다른 곳에서 연결 문자열로 연결할 때 끝난다. 마지막 경우 Mac은 그 연결이 해제될 때까지 다시 연결하지 않는다. 그래서 Mac에서 Task가 도는 중에 같은 repo를 `hub-link`로 연결하면 그 Task는 멈춤으로 보이고 PL이 풀어 줘야 한다.
- **자기 폴더로 이미 등록한 repo는 그대로 쓴다.** 같은 원격의 repo를 `team add`로 등록해 두었으면 clone하지 않고 그 등록을 쓴다. 연결 문자열로 만든 그 폴더의 연결 파일(`hub-link.json`)은 Mac이 건드리지 않는다. Mac이 만든 연결 파일에만 `macId`가 있고, 그것만 Mac이 새로 받거나 지운다.
- 담당이 아니게 된 repo 중 Mac이 clone한 것은 팀 Office 등록만 빼고 폴더는 남긴다. 그 repo에 열린 Task가 있으면 끝난 뒤의 다음 맞추기에서 뺀다. 자기 폴더로 등록한 repo는 담당이 아니게 되어도 그대로다.

**gh 로그인과 git 인증**

- repo가 github.com이 아닌 Git 호스트(회사 GitHub Enterprise 등)에 있고 그 호스트의 gh 로그인이 없으면, `mac connect`가 터미널에서 돌 때 그 자리에서 `gh auth login --hostname <호스트> --web --git-protocol https`를 띄우고 끝나면 이어 간다.
- 터미널이 없을 때(로그인 때 자동 실행, 켜진 Office)는 로그인을 띄우지 않는다. 그 호스트의 repo는 건너뛰고 같은 명령을 안내한다.
- clone 전에 호스트마다 한 번 `gh auth setup-git --hostname <호스트>`를 불러 gh를 git의 자격 도우미로 맞춘다. 실패하거나, clone이 자격 문제로 실패하면 repo 이름과 함께 그 명령을 안내한다. 한 repo의 실패가 다른 repo를 막지 않는다.

**자동 실행(LaunchAgent)**

- 파일은 `~/Library/LaunchAgents/com.pazmo.office.plist`다. Mac에 로그인할 때와 그 뒤 30분마다(`StartInterval`) `up --team --no-open`을 돌린다(토큰은 들어 있지 않다). 이미 켜진 Office에는 상태만 보고 끝난다. 로그는 `<데이터 루트>/team/launchd.log`다.
- Node는 Homebrew의 `/opt/homebrew/opt/node@24/bin/node`다(지금 쓰는 node와 같은 실행 파일일 때). 그래서 `brew upgrade`를 해도 경로가 깨지지 않는다.
- 켜기 전에 담당 repo를 한 번 맞춘다. 로그인 직후 VPN이 아직 없어 허브에 닿지 않으면 로그 한 줄만 남기고, 이미 등록된 repo로 켠다.
- 로그인 때 켜기가 실패해도(VPN·colima·실행기 로그인) 30분마다 다시 시도한다(`StartInterval`). 켜진 Office에는 아무것도 하지 않는다. 그래서 `stop --team`으로 끈 Office도 30분 안에 다시 켜진다. 계속 끄려면 `mac disconnect`다.
- 재부팅이나 강제 종료 뒤 남은 실행 상태와 시작 잠금은, 그 프로세스가 없거나 다른 부팅에서 남은 것이면 다음 `up`·`status`·`stop`이 정리한다. 그래도 남으면 오류 줄이 지울 파일을 알려 준다.
- 꺼짐으로 보이면(아래 상태) Mac에서 설치 명령을 다시 실행한다. 자동 실행 파일과 연결을 다시 맞추고, 이미 같은 자동 실행이 등록돼 있으면 내리지 않고 켜기만 다시 요청한다.
- 담당 repo가 하나도 없어도 Mac 연결이 있으면 Office는 켜진다. 상태만 보내고 담당 repo를 5분마다 본다.

**허브에서 보이는 것**

머리글 "내 Mac: …"과 `/mac`의 표(관리자는 팀원·초대에도)에 마지막으로 연락한 Mac이 다음 중 하나로 보인다. Office가 60초마다 상태를 보내고, 180초를 넘게 소식이 없으면 꺼짐이다.

| 보이는 말 | 뜻 |
|---|---|
| 일하는 중 | 실행 중인 엔진이 있거나 열린 Task 기록이 진행 중이다 |
| 대기 중 | 켜져 있고 지금 하는 일이 없다 |
| 쉬는 중(한도) | 열린 Task가 실행기 계정(한도·결제·로그인)을 기다리거나, 실행기(codex·claude)가 준비되지 않았다. 실행기 이름과 이유가 붙는다 |
| 잠김 | `--live` 없이 켜서 가져가지 않는다 |
| 꺼짐(N분 전) / 꺼짐(아직 연락 없음) | 마지막 소식이 180초보다 오래됐거나, Office가 아직 한 번도 연락하지 않았다 |
| 연결된 Mac 없음 | 이 사람의 연결된 Mac이 없다 |

웹의 **해제**(`/mac`, 관리자는 팀원·초대의 "Mac 해제")는 그 Mac의 허브 접근과 그 Mac이 받은 repo 연결을 함께 끊는다. 연결 문자열로 만든 연결은 그대로다.

**담당 repo가 바뀌면**

켜진 Office가 5분마다 허브에 담당 repo를 묻는다. 허브에서 담당자로 추가되거나 빠지면 이렇게 맞춘다.

- 연결만 죽은 repo(해제 뒤 다시 연결, 담당자가 빠졌다 다시 듦)는 켜진 Office가 그 자리에서 새로 받는다. 다시 켜지 않는다.
- 팀 Office 등록을 바꿔야 하면(담당 repo가 새로 생기거나 빠짐) Office를 다시 켜야 한다. 열린 Task와 실행 중인 엔진이 없을 때만 다시 켠다. 있으면 로그 한 줄로 기다리고, 끝난 다음 확인에서 한 번 다시 켠다. 다시 켜기로 정한 뒤 멈출 때까지는 새 Task를 가져가지 않는다. 10분 안에 멈추지 않으면 다시 가져가기 시작한다. 같은 변경은 한 시간 뒤에 다시 시도하고, 담당 repo가 또 바뀌면 바로 다시 시도한다.
- 다시 켜도 맞추지 못한 repo(clone 실패, gh 로그인 없음 등)가 있어 같은 변경이 그대로면, 다시 켜기를 반복하지 않고 1시간에 한 번만 다시 시도한다. 이유는 `launchd.log`의 맞추기 줄에 있다.

**명령**

`pazmo-office`는 `node bin/pazmo-office.mjs`와 같다. `--data-dir PATH`로 다른 데이터 루트를 쓸 수 있다. `connect`와 `restart`는 Apple Silicon macOS에서만 실행된다.

```sh
pazmo-office mac connect --hub https://<허브 주소> [--name <Mac 이름>]   # 설치기가 부르는 명령
pazmo-office mac status        # 연결·허브 상태(ok·revoked·unreachable)·담당 repo(등록·연결)·자동 실행·팀 Office
pazmo-office mac disconnect    # 이 Mac 연결 끊기
pazmo-office mac restart       # 팀 Office를 멈추고 up --team으로 다시 켜기
```

- `mac status`는 JSON을 낸다. 허브에 닿지 않으면 `hubState`가 `unreachable`이고, 허브가 이 Mac을 해제했으면 `revoked`다.
- `mac disconnect`는 팀 Office를 먼저 멈추고(Task가 실행 중이면 `TASK_ACTIVE`로 거절하고 아무것도 바꾸지 않는다), 자동 실행을 내리고, 허브에서 이 Mac을 해제하고, Mac이 만든 repo 연결 파일과 `mac-link.json`을 지운다. 팀 Office 등록과 clone한 폴더는 남는다. 허브에 닿지 않으면 이 Mac 쪽만 정리하고 `hubRevoked: false`와 "허브의 /mac에서 해제하라"는 안내를 낸다.
- `mac restart`는 `TASK_ACTIVE`이면 멈추지 않고 다시 켜지도 않는다. 담당 repo가 바뀌어 스스로 다시 켤 때도 같은 명령을 쓴다.
- 비밀: Mac 토큰은 `<데이터 루트>/team/mac-link.json`(0600)에만 있다. 허브에는 해시만 있고, 토큰은 로그·명령줄·출력에 나오지 않는다. 허용 주소에는 코드만 들어 있다.

**허브 운영자**

- 설치기는 OpenShift 모드의 허브만 준다. 설치기가 받는 Office 저장소와 브랜치는 허브 컨테이너의 환경 변수 `PAZMO_OFFICE_REPO`(기본: 이 Office의 공개 저장소, `https://…` 주소)와 `PAZMO_OFFICE_REF`(기본 `main`, 브랜치나 태그 이름)다. 형식이 틀리면 허브가 시작할 때 멈춘다(`hub --public-url`로 직접 띄운 허브는 기본값만 쓴다). 지금의 OpenShift Template(`deploy/openshift/pazmo-hub.json`)에는 이 두 값의 매개변수가 없다. 바꾸려면 Deployment의 환경 변수에 직접 더한다.
- 기기 코드를 받는 `POST /api/mac/start`는 로그인 없이 부를 수 있어서, 클라이언트마다 10분에 10번으로 제한한다. 클라이언트는 OpenShift 라우터가 덧붙인 `x-forwarded-for`의 **마지막** 값으로 구분한다. 라우터 앞에 회사 로드밸런서가 더 있으면 모두가 같은 값으로 보여 팀 전체가 10분에 10번을 나눠 쓴다. 배포 전에 확인한다.
- 개발·시험용으로 LAN(자체 인증서) 허브에 `mac connect --hub`를 직접 부르는 방법은 [검증 기록](verification/2026-11-04-mac-connect.md)의 "실제 확인 계획"에 있다(아직 해 보지 않았다). 자체 CA는 `NODE_EXTRA_CA_CERTS`(절대 경로)로 주고, 이 값은 자동 실행과 팀 Office, 스스로 다시 켜기의 환경에도 넘어간다. 팀원이 쓰는 흐름이 아니다.

**알려진 한계**

- Apple Silicon Mac과 Homebrew만 된다(Windows·Linux·Intel Mac 없음). 비밀번호·SSO 로그인과 터미널 없는 앱(.dmg)도 없다.
- 한 사람에 Mac 하나다. 두 번째 Mac을 쓰려면 사람이 다르거나, 첫 Mac이 해제되는 것을 받아들여야 한다.
- `stop --team`으로 끈 Office도 자동 실행이 30분 안에 다시 켠다. 계속 끄려면 `mac disconnect`다.
- `mac disconnect`는 Task가 실행 중이면 거절한다. Task가 끝난 뒤 다시 한다.
- 사람이 `gh`와 git 로그인을 한 Git 호스트의 repo만 clone된다. 로그인이 없는 호스트의 repo는 건너뛰고 안내만 한다.

### 팀원 웹

팀원이 터미널 없이 Hub 웹에서 자기 일을 보는 화면이다. 첫 화면 **내 할 일**, 프로젝트 → Story → Task를 보는 **보드**, 한 Task의 **상세**가 있다. 웹에서 누른 것은 Hub의 상태만 바꾼다. 각자 Mac의 Office가 지금 방식(가져가기·되찾기)으로 그 상태를 가져간다. Hub는 Mac에 먼저 연락하지 않는다. 결정은 [hub-web-team-flow-decision.md](understanding/hub-web-team-flow-decision.md)(D41, 묶음 2)이고, 판정과 검증은 [팀원 웹 검증 기록](verification/2026-11-05-teammate-web.md)이다.

**자동 시험만 마쳤다. 실제 Mac과 사내 OpenShift 허브로는 돌려 보지 않았으므로, 팀원에게 쓰라고 안내하지 않는다.**

**내 할 일 (`/`)**

로그인하면 처음 열리는 화면이다. 칸은 이렇다.

- **지금 맡은 일:** 내가 맡은 열린 Task 하나. 상태가 단계로 보인다(시작 중 → 진행 중(구현·리뷰·검증) → 머지 중). 카드에 "마지막 소식 N분 전"이 있고, Mac이 아직 가져가지 않은 claim(단계가 없음)이면 대신 "내 Mac이 가져가기를 기다립니다(보통 1분 안)."이다. 실패했으면 쉬운 말 한 문장과 "자세히·다시 시도" 링크가 붙는다. 원문인 "자세한 이유"는 Task 상세에만 있다.
- **받을 수 있는 일:** 내가 담당인 repo의 진행 중 Story에서 "할 일"인 Task. 50개까지, Story 만든 순서 → Task 번호 순이다.
- **내 Story에서 멈춘 일:** 내가 PL인 Story에서 멈춤이나 실패인 Task. 있을 때만 보인다.
- **끝낸 일:** 내가 마지막으로 머지 보고한 Task. 20개까지, 최근 것부터.

내 Mac이 사용 한도·결제·로그인 문제나 실행기 준비 안 됨으로 쉬는 중이면 "AI 사용 한도라 쉬는 중입니다. 약 N분 뒤 다시 시도합니다." 같은 문장이 나온다. 맡은 일이 진행 중(시작 중·진행 중·멈춤(Mac 소식 없음))이면 그 카드 안에, 아니면(맡은 일이 없거나 실패) 스위치 바로 아래에 한 번 나온다. 실행기가 준비 안 됨이면 할 일도 말한다: "Mac 터미널에서 claude를 실행해 설치와 로그인을 확인하세요." 시각은 지금부터의 상대 시간이다(Hub와 사람의 시간대가 달라도 맞다). Mac이 꺼져 있으면 이 문장은 나오지 않는다.

**보드 (`/board`)와 Task 상세 (`/tasks/<id>`)**

모든 팀원이 모든 프로젝트·Story·Task를 본다. 프로젝트 → Story(진행 상황, 멈춘 수) → Task 순으로 들어간다. Task 상세에는 3줄 요약, 판단 기록, PR 링크, 멈춘 이유(쉬운 말 한 문장과 "자세한 이유" 원문), 마지막 소식이 있다. 멈춤(Mac 소식 없음)은 맡은 사람의 Mac이 꺼져 있으면 마지막 확인 시각을, 켜져 있으면 "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다."를 말한다. 버튼은 그것을 할 수 있는 사람에게만 보이고, 서버가 같은 규칙으로 다시 막는다.

**자동으로 일하기**

- 내 할 일 맨 위의 **끄기 / 켜기** 스위치다. 기본은 켜짐이다.
- 끄면 **새 일을 받지 않는다.** 이미 맡은 Task는 끝까지 하고, 끝난 뒤에 새 일이 오지 않는다. 다시 켜면 다음에 Mac이 가져갈 때 받는다.
- 꺼 둔 동안은 모든 화면 머리글에 "자동으로 일하기 꺼짐"이 붙는다(누르면 내 할 일).
- 끄는 것은 **자동으로 받는 것만** 막는다. 직접 고른 일, 다시 시도, PL의 Story 검증에는 영향이 없다.
- Mac의 `team pause`와 하루 상한은 **자동으로 받는 일에만** 적용된다. 사람이 직접 고른 작업하기와 다시 시도는 Mac의 `team pause`와 하루 상한을 따르지 않고(사람이 고른 일이다), 하루 상한에 세지 않는다(ASSUMED).

**작업하기**

스위치를 껐을 때 받을 수 있는 일 옆에 **작업하기**가 나온다. 누르면 그 Task가 내 것이 되고, 내 Mac의 Office가 1–2분 안에 가져간다. 아래 경우에는 버튼 대신 이유가 나오거나 서버가 거절한다.

- **내 Mac이 지금 그 repo의 일을 가져가고 있지 않다.** Hub는 내 Office가 최근 3분 안에 그 repo의 연결을 쓴 경우만 "가져갈 수 있다"로 친다(일하는 Office는 맡은 일이 없을 때 30초마다 준비된 repo마다 Hub를 읽는다). Mac이 꺼짐·잠김이거나, 그 repo가 이 Mac에 연결되지 않았거나, Office에서 그 repo가 준비 안 됨(gh 로그인 등)이면 버튼 대신 "내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제)."가 나오고(누르면 `/mac`), 서버도 "내 Mac이 지금 이 레포의 일을 가져갈 수 없습니다. …"로 거절한다.
- 이미 맡은 Task가 있다: 하나를 끝낸 뒤 고른다. 이것을 위의 연결보다 먼저 본다(일하는 동안 Office는 그 Task의 repo만 읽어 다른 repo의 연결이 낡기 때문이다). 그래서 맡은 일이 있는 동안 다른 repo의 Task에는 아무 말도 나오지 않는다.
- 그 사이 다른 사람이 먼저 골랐거나 상태가 바뀌었다: 거절하고 아무것도 바꾸지 않는다. 같은 버튼을 두 번 눌러 첫 번째가 이미 됐으면 둘째도 Task 상세로 간다.

**다시 시도 (메모)**

내가 맡은 Task가 실패했으면 Task 상세에 메모 칸과 **다시 시도**가 나온다. 메모는 선택이고 2000자까지다(줄바꿈은 한 글자로 센다). Mac이 1–2분 안에 새 시도로 가져가고, AI는 마지막 실패 이유와 내 메모를 보고 처음부터 다시 한다.

- 작업하기와 같은 규칙으로, 내 Mac이 지금 그 repo의 일을 가져가고 있어야 한다. 아니면 폼 대신 "내 Mac이 지금 이 레포의 일을 가져갈 수 없어 다시 시도할 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요."가 나온다.
- 남의 Task는 다시 시도할 수 없다. Story 검증 Task는 PL의 Office가 다시 한다.
- 화면을 연 뒤 Task가 실패가 아니게 됐거나 PL이 풀었으면 "실패한 Task만 다시 시도할 수 있습니다. 화면을 새로 고쳐 확인하세요."가 나온다. 두 번 눌러 첫 번째가 이미 됐으면 둘째도 Task 상세로 가고, 메모는 첫 번째 것이 남는다.

**풀기와 취소 (PL·관리자)**

그 Story의 PL이나 관리자에게 Task 상세에 버튼이 나온다. 각 버튼이 하는 일을 한 줄로 말해 준다.

- **풀기:** 멈춤(Mac 소식 없음)이나 실패한 Task를 다시 "할 일"로 돌린다. 그 repo 담당자 누구든 처음부터 다시 받는다. 머지 잠금을 쥔 Task면 "머지 중이었을 수 있습니다."가 붙는다. 풀어도 그 사람의 늦은 머지 보고는 받는다.
- **취소:** 끝나지 않은 작업 Task를 하지 않기로 한다. 뒤 Task는 이것 없이 진행한다. 되돌릴 수 없어서 "정말 취소합니다"를 체크해야 눌린다.
- **머지 잠금을 쥔 Task는 웹에서 취소할 수 없다.** 이미 Story base에 머지됐을 수 있고, 취소는 되돌릴 수 없으며 늦은 머지 보고를 받지 않기 때문이다. 버튼 대신 "머지 잠금을 쥐고 있어 지금은 취소할 수 없습니다. 머지됐을 수 있으니 먼저 풀기를 하세요."가 나온다. 먼저 풀고, 그래도 하지 않기로 했으면 그 뒤에 취소한다.

**요청 게시판이 옮겼다**

요청 게시판은 `/`에서 **`/requests`**(`/requests?view=mine|repos`)로 옮겼다. 메뉴는 내 할 일 · 보드 · 레포 · 팀원·초대(관리자) · 요청 게시판 · 내 Office 연결 · 인증서다. Story 보드 없이 띄운 Hub는 지금처럼 `/`가 요청 게시판이다.

**알려진 한계**

- **화면이 저절로 새로 고쳐지지 않는다.** 내 할 일·보드·Story·Task 상세에 "새로 고침" 링크가 있다. "마지막 소식 N분 전"은 Task 상세와 내 할 일의 맡은 일 카드에만 있다. 메모를 쓰는 중에 화면이 바뀌어 글이 사라지지 않게 한 것이다.
- **여러 repo를 맡은 사람의 repo 사이 순서는 그 사람 Mac의 등록 순서다**(ASSUMED). repo 하나 안에서는 Story 만든 순 → Task 번호 순이다.
- **작업하기를 누른 직후(3분 안) Mac이 꺼지면** 그 Task는 10분 뒤 "멈춤(Mac 소식 없음)"으로 보이고, PL이 풀어야 한다. Office를 다시 켰는데 어떤 repo가 gh 등으로 준비 안 됨이 된 경우도, 다시 켠 뒤 3분 안에는 그 repo의 작업하기가 받아들여져 같은 일이 생긴다.
- **잠깐 잘못 거절될 수 있다.** 맡은 일이 막 끝났거나(머지 뒤 30초까지), Office가 Hub에서 사라진 기록을 막 버렸거나, Office를 켠 직후 남은 기록을 마무리하는 동안에는 작업하기가 "가져갈 수 없습니다"로 거절될 수 있다. 잠시 뒤 다시 누르면 된다.
- **gh 로그인이 풀린 repo의 실패한 Task도 다시 시도는 받아들여진다**(실패한 Task를 확인하는 Office의 읽기가 그 연결을 쓰기 때문이다). 새 시도는 Office에서 gh가 다시 될 때까지 기다리고, 그동안 10분이 넘으면 멈춤으로 보인다.
- **AI 실행기 하나가 준비 안 됨인 동안 직접 고른 다른 repo의 Task는 돈다.** 그동안 머리글은 "쉬는 중"이다.
- **Office가 스스로 다시 켜지는 몇 초 사이에 작업하기를 누르면** 다시 켜기가 그 Task가 끝날 때까지 미뤄질 수 있다.
- **취소는 풀기 뒤에도 늦은 머지 보고를 받지 않는다.** 머지됐을 수 있는 Task는 풀기만 하고 결과를 본 뒤에 정한다.
- **웹에서 다시 시도한 뒤 터미널에서 보낸 `team rerun --memo`의 메모는 쓰이지 않는다**(웹 것이 먼저다). 반대로 터미널에서 먼저 다시 시도했으면 웹의 다시 시도는 Task 상세로 가고 웹 메모는 저장되지 않는다.
- **연결 문자열로 붙인 Office(Mac 없음)가 잠김(`--live` 없이)으로 돌면** Hub는 그것을 모른다. 그 repo에는 작업하기 버튼이 나오고, Office는 고른 Task를 가져가 하트비트만 보내며 돌리지 않는다. 멈춤으로 보이지 않아 풀기도 나오지 않으므로, `--live`로 다시 켜거나 PL이 취소한다.
- **보드의 멈춤 수에는 실패한 Story 검증이 들어가지 않는다**(묶음 4).
- 맡은 사람이 자기 Task를 반납하는 버튼, 알림은 없다.
- PL의 웹 Story 작성·G1·Task 나누기(묶음 3), Story 검증·G4·머지(묶음 4)는 아직 웹에 없다.
- 작은 어색함은 검증 기록의 "사람에게 보이는 한계"에 있다.

### Office 연결

허브의 **내 Office 연결**(초대로 합류한 직후 열리는 화면, 메뉴에도 있다)에서 **연결 문자열 만들기**를 누르고 복사한다. 문자열은 팀원 단위이고 10분 동안 한 번만 쓸 수 있다. 연결은 터미널에서 한다(Office 화면의 연결 창은 Claw와 함께 지웠다).

```sh
# `pazmo-office`는 `node bin/pazmo-office.mjs`와 같다
pazmo-office hub-link --project <레포 로컬 경로> --connect "<연결 문자열>"
pazmo-office hub-unlink --project <레포 로컬 경로>
```

- 예전 형식 `--hub <허브 url> --code <코드> [--fingerprint <CA 지문>]`과 레포 화면의 레포 단위 코드도 계속 동작한다.
- 레포는 Office 프로젝트의 `git origin`으로 정해진다. 허브에 없으면 origin 끝 이름(겹치면 `-2`)으로 등록되고 내가 담당자가 된다.
  - **origin을 확인하고 붙인다.** ssh 별칭(`git@github-work:…`)이나 포크·미러 origin은 다른 레포로 보여 `-2` 같은 새 레포가 생긴다.
  - **잘못 등록됐을 때:** 지금은 허브에서 레포를 지울 수 없다. 관리자가 레포 화면에서 맞는 담당자를 더하고 잘못 붙은 담당자를 뺀다. 남은 레포는 쓰지 않으면 된다.
- 지문이 있으면 그 지문의 인증서 한 개만 신뢰하고, 없으면(OpenShift) 공인 인증서를 시스템 신뢰로 검증한다. 토큰은 Office 데이터 디렉터리에 0600으로 저장되고 브라우저로 가지 않는다.
- 이 연결은 [팀 Office](#팀-office-3단계-시험)가 repo마다 쓴다. 단일 Office는 허브에 연결하지 않는다.
- `hub-unlink`는 이 Office의 설정만 지운다. 허브 쪽 연결 기록까지 끊으려면 허브의 레포 화면에서 연결 해제를 한다.
- Office는 계속 `127.0.0.1`에만 열린다. 허브가 Office로 들어오지 않고, 연결은 사람이 명령을 실행할 때만 일어난다.

### 알려진 한계

- 사내망 허브는 고정 사설 IPv4에서만 연다. 호스트 이름이나 IP 변경 자동 대응은 없다. IP가 자주 바뀌면 OpenShift 허브를 쓴다.
- 허브 CA는 회전하지 않는다. 만료 30일 전이면 `HUB_CA_EXPIRING`으로 멈추며, TLS 디렉터리를 지우고 모두 다시 신뢰한다.

## 새 Office

`./office`가 켜는 Office다. 화면은 Tasks·작업 상세·Decisions·Agents 네 개다. 실행 엔진(결정·격리 실행·검증·인도)은 예전 Claw Office와 같다. 결정은 [lean-office-decision.md](understanding/lean-office-decision.md)(1단계)와 [lean-office-default-decision.md](understanding/lean-office-default-decision.md)(기본 전환·Claw 삭제)다.

```sh
./office --project /absolute/path/to/project
```

- **켜기:** `./office`는 의존성 확인, 로그인 확인, VM 준비를 하고 Office를 연다.
  - 예전 버전이 켠 Claw Office가 같은 프로젝트에 켜져 있으면 `ENGINE_MISMATCH`("Stop the current Office before changing its runtime.")로 거부한다. 켜져 있는 Office는 건드리지 않는다. `stop`으로 멈춘 뒤 다시 켠다.
  - 화면 미리보기만 하려면 `start`를 쓴다. 이때 모델 호출은 막혀 있다. 의존성이 아직 없으면 `NOT_INSTALLED`로 멈추므로 `./office`를 한 번 먼저 실행한다.
- **데이터:**
  - 새 Office는 데이터 디렉터리의 `lean/office.sqlite`를 쓴다.
  - 예전 Claw 데이터(`claw/`)는 읽지도 지우지도 않는다. 예전 작업은 옮기지 않는다.
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
  - 세션은 같은 PC의 루프백 연결이면 누구에게나 준다. 예전 Claw Office와 같은 수준이며, 결정 문서의 "일회용 주소"는 1단계에서 이 방식으로 대신했다. 같은 Mac을 다른 사용자와 함께 쓰면 그 사용자도 결정에 답할 수 있다.
  - 화면은 같은 출처의 파일만 불러오고(CSP), 데이터는 글자로만 넣는다.
  - 실행기 목록에는 CLI 설치 경로를 싣지 않는다.
- **없는 것:** 채팅, 하위 작업 화면, 회의, 대시보드, 픽셀 사무실, 동시 실행, 예전 Claw 데이터 옮기기, Office에서 허브 요청 보내기·받기(팀 Story 보드가 대신한다).
  - 채팅 연동 명령(`bridge`, `contract`, `intake-*`, `approval-*`, `operator-key`)은 legacy 엔진과 함께 지웠다.
- **알려진 한계:**
  - Lead의 질문과 하위 작업의 계약 승인은 "설계" 단계로 보인다.
  - 한 번 시작한 작업은 다음 단계 순서를 기다리는 동안에도 "진행"에 있다.
  - 하위 작업이 취소되면 요청이 "리뷰"에 머물 수 있다. 이때는 작업 상세에서 직접 취소한다.
  - 영어 화면에서도 엔진이 쓴 결정 내용은 한국어로 보인다.

## 팀 Office (3단계, 시험)

팀 Story 보드에서 한 사람이 Office 하나에 repo 여러 개를 등록해 켜고, 담당 repo의 Story Task를 가져와 실제로 돌리는 단계다. 가져온 Task는 VM에서 구현 → 리뷰 → 검증을 돈다. 통과하면 VM 밖에서 그 사람의 git·`gh` 로그인으로 다음을 차례로 한다: Task 브랜치에 커밋·push → Story base로 PR → Hub 머지 잠금 → 최신 Story base 합치기(바뀌었으면 검증 명령만 다시) → PR 머지 → Hub에 PR 주소·머지 커밋·3줄 요약·판단 기록 보고. **실제 확인 1차(정상 흐름, 로컬 Hub·GitHub 시험 repo 두 개·VM)는 2026-11-02–03에 했고, 이 단계는 PR syjkim0125/pazmo-agent-office#59로 main에 들어왔다. 2차(충돌·재검증 실패, 단계 사이 끄고 켜기, ssh push·커밋 서명, 최종 리뷰 수정의 실제 확인)는 아직이다.** 그래서 팀이 쓰는 단계가 아니라 시험 단계다. 화면도 없다(5단계). 결정은 [team-story-board-decision.md](understanding/team-story-board-decision.md), 검증은 [3단계 검증 기록](verification/2026-11-02-team-story-task-mode.md), [실제 확인 1차 기록](verification/2026-11-03-team-story-task-mode-real-check.md)과 [2단계 검증 기록](verification/2026-10-29-team-story-office-repos.md)이다.

```sh
# `pazmo-office`는 `node bin/pazmo-office.mjs`와 같다
# 1. repo 등록 (repo마다; 그 repo의 단일 Office가 켜져 있으면 먼저 멈춘다)
pazmo-office team add --project <repo 로컬 경로>

# 2. repo마다 Hub 연결 (연결 문자열은 Hub의 "내 Office 연결"에서 만든다)
pazmo-office hub-link --project <repo 로컬 경로> --connect "<연결 문자열>"

# 3. repo의 Git 호스트마다 gh 로그인 (예: github.com과 회사 GitHub Enterprise)
gh auth login --hostname <Git 호스트>

# 4. 팀 Office 켜기 (VM·실행기·의존성 준비는 ./office와 같다. 켜지면 가져가고 실행한다)
./office --team
#    VM과 실행기가 이미 준비된 Mac이면: pazmo-office start --team --live

# 5. 상태 보기
pazmo-office status --team
```

- **켜기 전에 (repo마다):**
  - GitHub repo 설정에서 머지 커밋(Allow merge commits)을 허용한다. Office는 PR을 머지 커밋으로만 머지한다(`gh pr merge --merge`). 막혀 있으면 모든 Task가 머지 단계에서 세 번 연속 실패해 실패로 보고된다.
  - 자기 폴더(등록한 repo 폴더와 그 밖의 worktree)에서 `feature/story-<N>/task-<M>` 브랜치를 체크아웃하지 않는다. 그 브랜치가 다른 곳에 체크아웃돼 있으면 git이 Office 체크아웃의 `checkout -B`를 거부하고, 세 번 연속이면 Task가 실패로 보고된다.
- **켜는 법:** Task를 가져가고 실행하려면 `./office --team`(`up --team`)이나 `start --team --live`로 켠다. `--live` 없이 켠 `start --team`은 실행이 잠긴다.
  - 잠긴 팀 Office는 아무것도 가져가지 않고, 등록된 repo에 git 명령을 하나도 돌리지 않는다.
  - 열린 기록이 있으면 진행하지 않는다. 하트비트(실패한 Task는 Task 읽기)만 보낸다. 단, 단계가 `verified`·`merging`인 기록은 하트비트도 보내지 않고 버리지도 않는다. 머지된 PR이 아직 보고되지 않았을 수 있어서다(그동안 PL이 풀었으면 하트비트가 기록을 버려 그 머지가 보고되지 않는다). 하트비트가 끊긴 그 Task는 Hub에서 10분 뒤 보류로 보인다. `--live`로 다시 켜면 바로 기록의 단계부터 이어서 한다. 그 첫 구동이 끝나기 전에는 하트비트가 `NOT_YOURS`를 받아도 `verified`·`merging` 기록을 버리지 않는다(PL이 푼 뒤에도 머지된 PR을 늦게 보고할 수 있게). 하트비트는 첫 구동을 기다리지 않는다.
- **켜기가 실패할 때:** `--live`로 켤 때 등록된 repo 하나라도 체크아웃을 만들지 못하면(커밋이 하나도 없는 repo, 그 사람의 PATH에 git이 없음) 팀 Office 전체가 켜지지 않는다. CLI는 `{"code":"FAILED","error":"The Story checkout of <repo 경로> could not be made: …"}`를 낸다. 팀 Office 안의 오류 코드는 `GIT_FAILED`지만 켜기 경로가 메시지만 넘겨서 코드는 `FAILED`로 보인다. 그 repo에 첫 커밋을 하거나 `team remove`로 뺀 뒤 다시 켠다.
- **가져가는 조건:** `--live`로 켬, 모든 repo 엔진의 실행기(codex·claude) 준비, 열린 기록 없음, 실행 중인 엔진 없음, 가져가기 멈춤·하루 상한에 걸리지 않음. 실행기는 켤 때 한 번 확인하고, 준비돼 있으면 5분마다, 준비되지 않았으면 가져가기(30초)마다 다시 확인한다. 가져갈 수 없는 동안(열린 기록, 멈춤, 상한, 실행 중, 준비된 repo 없음)은 확인하지 않는다(확인할 때마다 codex·claude CLI가 실행된다). 준비되지 않았으면 그 상태가 바뀔 때마다 Office 로그에 그 repo와 엔진 agent의 실행기를 한 줄로 남긴다(`team: not claiming: the runners of <repo> (work codex, review codex) are not ready …`). 엔진 agent는 처음 켤 때 그때 준비된 CLI로 정해지고 바뀌지 않는다(지금은 바꿀 화면이 없다). 그 줄에 나온 CLI에 로그인한다.
- **체크아웃과 사용자 폴더:** Task는 등록한 repo 폴더가 아니라 **Office 전용 체크아웃**에서 돈다.
  - 위치는 repo의 Office 데이터 폴더(`<데이터 루트>/<repo id>/`, 기본 데이터 루트는 `~/.local/share/pazmo-agent-office`)의 `story-checkout/`이다. `--live`로 켤 때 그 repo의 `git worktree`(detached)로 한 번 만든다. Story 엔진 데이터는 같은 폴더의 `story/`다.
  - 등록한 repo 폴더의 작업 트리·HEAD·체크아웃된 브랜치·커밋 안 한 변경은 바뀌지 않는다. 바뀌는 것은 repo `.git`의 worktree 등록(`git worktree list`에 보인다)과 로컬 브랜치 `feature/story-<N>/task-<M>`이 생기는 것뿐이다.
  - 체크아웃은 Office 것이다. Task를 시작할 때마다 초기화한다(`reset --hard`, `clean`). 거기서 손으로 고치지 않는다. Office는 이름이 `story-checkout`이고 등록한 repo 폴더가 아닌 linked worktree만 초기화한다(그 밖의 폴더는 아무것도 바꾸지 않고 `GIT_FAILED`).
  - 시도를 시작할 때 Office 체크아웃에서 `git checkout -B feature/story-<N>/task-<M> <시작점>`을 한다. 시작점은 원격 Task 브랜치 끝(없으면 Story base)이다. 그래서 같은 이름의 **로컬** 브랜치는 그 시작점으로 강제로 옮겨진다. 이 브랜치 ref는 repo `.git`에 있어 자기 폴더의 `git branch`에도 보이고, 거기에 push하지 않은 커밋이 있었으면 그 커밋은 브랜치에서 빠진다(reflog에만 남는다). 그 밖의 로컬 브랜치, 자기 폴더의 작업 트리·HEAD·체크아웃된 브랜치·커밋 안 한 변경은 건드리지 않는다.
- **허용되는 push:** `git push origin <sha>:refs/heads/feature/story-<N>/task-<M>` 하나뿐이다(강제 push 없음). 그 Task 브랜치에서 Story base(`feature/story-<N>/base`)로 가는 PR을 열고 머지한다(머지 커밋). main·master·다른 ref·강제 push·브랜치 삭제는 하지 않는다.
  - push는 그 사람의 git 설정·credential helper·ssh agent로, PR은 그 사람의 `gh` 로그인으로 한다. Office 프로세스의 `GH_TOKEN`·`GITHUB_TOKEN`은 넘기지 않는다. 훅은 끈다.
  - PR 제목·본문(Hub Task 제목, 3줄 요약, `ASSUMED:` 줄)의 `@이름`은 알림이 가지 않게 `@` 뒤에 보이지 않는 문자(U+200D)를 넣는다. `dev@example.com` 같은 주소는 그대로다. Hub에 보고하는 판단 기록은 쓴 그대로다.
  - PR은 Office가 push하고 검증한 head에서만 머지한다. 머지 단계에서 Task 브랜치 끝이 그 head와 다르면(PR의 "Commit suggestion" 반영, 봇, 팀원의 커밋) 머지하지 않고 그 시도를 실패로 센다. 다음 시도는 그 커밋이 있는 Task 브랜치에서 구현·검증한다.
  - PL이 Task를 취소하거나 풀면 머지하지 않는다. base를 합친 뒤의 재검증 중에 취소해도, PR 머지 바로 전에 Hub 머지 잠금을 다시 물어 거절되면 머지하지 않는다.
- **커밋 서명:** 커밋은 그 사람의 git 설정을 따른다(작성자 포함). `commit.gpgsign = true`인데 서명 agent(gpg-agent, ssh 서명 키)를 쓸 수 없으면 커밋이 서명 오류로 실패한다. 세 번 연속 실패하면 Task를 그 이유로 실패 보고한다. 켜기 전에 그 repo에서 서명이 되는지 확인하거나 서명을 끈다.
- **실패와 다시 실행:**
  - 한 Task는 최대 3번 시도한다. 엔진 안의 자동 수정 라운드는 세지 않는다. 엔진이 멈춤, 최신 base와 충돌, base를 합친 뒤 검증 실패가 한 번씩 센다. 90분 넘게 끝나지 않는 실행도 한 번으로 센다. 다음 시도는 직전 실패 이유를 받아 구현부터 다시 한다. 충돌은 충돌 표시를 남긴 채 다음 시도가 푼다.
  - 엔진이 충돌 표시를 그대로 둔 채 검증을 마친 시도도 한 번으로 센다. 다음 시도가 그 파일 목록을 받아 푼다.
  - 한 단계(push 거부, `gh` 오류 등)가 세 번 연속 실패해도 Task를 실패로 보고한다. GitHub가 PR을 머지됨으로 보이는데 머지 커밋을 아직 주지 않으면 실패로 세지 않고 다음 구동에 다시 본다.
  - 사람이 Task의 PR을 머지하지 않고 닫으면, 그것을 멈춤으로 본다. Office는 새 PR을 열지 않고 Task를 바로 실패로 보고한다(시도로 세지 않음, 이유 `PR #<N> was closed on GitHub; reopen it, then run team rerun`). PR을 다시 열고 `team rerun`하면 그 PR로 이어 간다. 그만두려면 PL이 취소한다. GitHub가 브랜치 삭제 때문에 닫은 PR도 같다.
  - 실행기 계정 문제(D37)로 구현·리뷰가 멈추면 시도로 세지 않고 기다린다. 계정 문제는 사용 한도·결제(크레딧)·로그인 만료다. claude는 실패 답에 스스로 붙이는 오류 종류(`rate_limit`·`billing_error`·`authentication_failed`)로, codex는 실패 이벤트 문구("usage limit", "Quota exceeded", 토큰 갱신 실패 등)로 알아본다. claude의 `rate_limit`에는 잠깐의 과부하도 들어간다.
    - 같은 시도를 claude가 알려 준 리셋 시각에, 없으면 30분 뒤에 구현부터 다시 한다. 다시 하는 실행은 계약 폴더를 따로 둔다(`…-a<시도>-r<번째>`).
    - 첫 발견부터 6시간이 지나도 계정 문제면 그 이유로 실패를 보고한다. 이유는 `RUNNER_LIMIT`·`RUNNER_BILLING`·`RUNNER_LOGIN` 중 하나에 실행기 이름과 그 실행기의 메시지 한 줄을 붙인 것이다(예: `RUNNER_LIMIT claude: You've hit your org's monthly spend limit …`).
    - 기다리는 동안 새 Task는 가져가지 않고, Hub에는 하트비트를 그대로 보낸다(PL에게는 진행 중으로 보인다). 기다림은 기록에 남아 Office를 껐다 켜도 이어진다. 로그에는 발견할 때마다 한 줄 남는다(`claude account problem (usage limit: …); not counted as an attempt; running it again at <시각>`).
    - 한도는 첫 실행에서야 안다. 가져가기 전 확인은 로그인만 본다.
  - 실행기가 준비 안 됨이라 엔진이 실행 전에 거절해도 같게 기다린다(D39). 준비 안 됨은 로그아웃, 설치 없음, 지원하지 않는 설치본, 개인 설정으로 막힘(`~/.codex/AGENTS.md`, claude의 hook)이다.
    - 엔진은 거절하기 직전에 실행기를 한 번 새로 확인한다. 그 사이 로그인했거나 고쳤으면 그대로 돈다(Office를 로그아웃 상태로 켠 뒤 로그인한 경우도 같다).
    - 30분마다 다시 하고, 첫 발견부터 6시간이 지나면 실행기 이름과 할 일 안내로 실패를 보고한다(예: `RUNNER_NOT_READY claude: 터미널에서 claude auth login을 실행하세요.`). 로그에는 `claude is not ready (…); not counted as an attempt; running it again at <시각>`이 남는다.
  - 실패로 보고한 Task는 기록이 `failed`로 남고, Hub에서도 이 사람의 열린 Task다(그동안 뒤 Task는 막힌다). 원인을 보고 메모와 함께 다시 실행한다:

```sh
pazmo-office team status                                      # claim.phase가 failed인지 본다 (꺼져 있어도 된다)
pazmo-office team rerun --memo "v2 엔드포인트로 바꿔서 다시"   # 메모는 2000자까지. 꺼져 있어도 된다
```

  - `team rerun`은 요청만 기록하고 `{"requested":true}`를 낸다. `--live`(또는 `./office --team`)로 켜져 있거나 다음에 그렇게 켜지는 팀 Office가 Hub에 다시 실행을 요청하고, 새 claim으로 구현부터 다시 한다. `--live` 없이 켠 팀 Office는 요청을 그대로 둔다. 시도 수는 0부터 다시 센다. 하루 상한에는 세지 않는다. 실패한 기록이 없으면 `NO_FAILED_CLAIM`이다.
- **상태(`status --team`):**
  - repo마다 `state`와 `gh` 결과가 나온다. `state`는 `ready`, `no-link`(Hub 연결 없음), `gh`(로그인 안 됨), `relink`(Hub가 연결을 거절함, 다시 연결), `hub-too-old`(Hub가 Story 경로를 모름) 중 하나다. ready가 아닌 repo는 5분마다 다시 확인한다. 연결하거나 로그인한 뒤 재시작할 필요는 없다.
  - `execution`: `--live`(또는 `./office --team`)로 켰으면 `ready`, 아니면 `locked`다.
  - `claim`: 지금 가진 Task의 Story·Task 번호, 제목, repo, 그리고 `phase`와 `attempts`다. `phase`는 `claimed`(시도 준비), `building`(VM에서 구현·리뷰·검증), `verified`(push와 PR 끝), `merging`(머지 잠금·base 합치기·머지), `reporting`(Hub에 보고 중), `failed`(실패로 보고함, `team rerun`을 기다림) 중 하나다. `attempts`는 이 claim에서 실패한 시도 수다. `waiting`은 시도가 실행기 계정 문제나 준비 안 됨을 기다리는 동안(`phase`가 `claimed`)에만 `runner`·`kind`(`limit`·`billing`·`login`·`not_ready`)·`message`(실행기의 말 한 줄, `not_ready`는 Office의 실행기 안내)·`since`·`retryAt`(ISO 시각)을 보이고, 그 밖에는 `null`이다. `team status`도 같다.
  - `blockedBy`: **마지막으로 Hub에 가져가기를 물었을 때** 줄 Task가 없던 이유인 이 사람의 열린 Task(`storyNumber`, `taskNumber`, `repoName`, `state`는 `claimed` 또는 `failed`)다. 그 답에 열린 Task가 없었거나 Hub가 Task를 줬으면 `null`이다. 가져가기를 묻지 않는 동안(열린 기록, 멈춤, 상한, 실행 중, 실행 잠김)에는 마지막 값이 그대로 남는다. 바뀔 때마다 Office 로그에도 한 줄 남는다(`team: blocked by story-<N> task-<M> (…)`). 2단계 실제 확인의 찾은 것 1(가져가지 않는 이유가 안 보임)을 이것으로 보인다. Hub가 보고를 끝내 거절한 claim은 가져가기를 묻지 않는 동안에도 여기에 나온다. 그때 `repoName`은 다음 가져가기 답이 채울 때까지 `null`이다.
  - 그 밖에 `paused`, `dailyCap`, `today`(오늘 새로 가져온 수), `busy`(실행 중인 엔진이 있는지)가 나온다.
- **가져가기 설정**(팀 Office가 꺼져 있어도 된다):

```sh
pazmo-office team pause      # 새 Task를 가져가지 않는다 (가진 Task는 끝까지 한다)
pazmo-office team resume
pazmo-office team cap 3      # 하루 상한 1–100 (기본 5, 그 PC의 자정에 풀린다)
pazmo-office team cap off    # 상한 없음
pazmo-office team status     # 설정과 열린 기록(단계·시도 수 포함)
```

- **멈추기:** `pazmo-office stop --team`. 엔진이 실행 중이면(구현·리뷰·검증, base를 합친 뒤의 검증) `TASK_ACTIVE`로 거부한다. 끝나기를 기다렸다가 다시 한다. push·PR·머지·보고 사이에서는 멈춰도 된다. 다음에 `--live`로 켜면 바로 기록의 단계부터 이어서 하고, 같은 PR을 두 번 열거나 두 번 머지하지 않는다.
- **가진 Task:** 켜져 있는 팀 Office는 60초마다 하트비트를 보내므로 그 Task는 보류되지 않는다.
  - PL이 Hub에서 취소하면(실패한 Task는 풀기도) 켜져 있는 팀 Office가 다음 하트비트(실패한 Task는 다음 Task 읽기)에서 기록을 닫고 엔진 실행을 멈춘다. 체크아웃과 브랜치는 남긴다.
  - PR은 머지했는데 보고 전에 PL이 풀었으면, 그 머지를 Hub에 늦게라도 보고한다. Hub가 끊긴 동안 끝난 보고는 기록에 남겨 두었다가 다시 보낸다.
  - Hub가 보고를 끝내 거절하면(`HUB_REFUSED_REPORT`, 로그에 PR 주소와 Hub의 이유가 나온다) 기록을 닫고 그 claim을 다시 가져오지 않는다. 같은 작업을 다시 돌려도 또 거절되기 때문이다. 그 Task는 `blockedBy`에 나오고, 하트비트가 없어 Hub에서 10분 뒤 보류로 보인다. PL이 풀거나 취소한다. PR 주소는 Hub가 받는 모양(`https://`, 계정 정보·공백·따옴표·꺾쇠 없음)으로만 보고한다. GitHub가 준 주소가 그렇지 않으면 `https://<host>/<owner>/<repo>/pull/<N>`으로 보고한다.
  - Hub가 그 Task를 모른다고 답하면(`NOT_FOUND`, Hub를 새로 만들었거나 repo를 다른 Hub에 다시 연결함) 기록을 닫고, Hub가 아직 이 사람의 claim이라고 하면 다음 가져가기에서 다시 받는다.
  - Hub는 열린 Task가 있는 사람에게 새 Task를 주지 않는다. 그 Task가 무엇인지는 `blockedBy`에 나온다.
- **repo 바꾸기:** `team add`·`team remove`는 팀 Office를 멈춘 뒤에 한다. 켜지는 중에도 거부한다(`TEAM_RUNNING`). 지금 가진 Task의 repo는 폴더가 남아 있는 한 그 기록이 닫힐 때까지(머지·보고, 또는 PL의 취소) 뺄 수 없다(`OPEN_CLAIM`).
- **repo 폴더를 옮기거나 지웠을 때:** `start --team`·`./office --team`이 `REPO_MISSING`으로 멈추고 그 경로와 `pazmo-office team remove --project <경로>`를 알려 준다. 폴더를 제자리에 돌려놓거나, 그 명령으로 뺀다. 폴더가 없는 repo는 가진 Task가 있어도 빠지고, 그 로컬 기록은 버린다(`REPO_REMOVED`). Hub의 그 Task는 하트비트가 끊겨 10분 뒤 보류되고, 그다음은 PL이 정한다. **그동안 팀 Office는 다른 repo의 Task도 가져가지 않는다.** Hub에는 그 Task가 아직 이 사람의 claim으로 남아 있기 때문이다. 빼기 전에 PL에게 그 Task를 취소해 달라고 하면 바로 풀린다.
- **repo에 남은 lean 작업:** 팀 Office는 repo의 기존 lean 데이터(`lean/`)를 열지 않는다. 등록 전에 그 repo의 단일 lean Office에서 하던 작업은 손대지 않고 그대로 기다린다. 그 repo를 `team remove`하고 단일 Office로 켜면 다시 보인다.
- **데이터:** 팀 Office 자신의 데이터는 데이터 루트의 `team/`이다(기록 `team.sqlite`, 로그 `office.log`). repo마다 Office 데이터 폴더에 `story/`(Story 엔진)와 `story-checkout/`(체크아웃)이 생긴다. 등록된 repo는 단일 Office로 켤 수 없다(`IN_TEAM_OFFICE`).
- **Mac 연결과의 관계:** [이 Mac 연결](#이-mac-연결-openshift-허브)을 하면 팀 Office는 `team add`·`hub-link`로 repo마다 하던 일을 스스로 하고, 위의 흐름(가져가기·실행·PR·보고)은 그대로다. 위의 명령도 그대로 쓸 수 있다.
  - 연결 정보는 데이터 루트의 `team/mac-link.json`(0600)이다. 있으면 등록된 repo가 0개여도 팀 Office가 켜진다(`NO_REPOS`는 Mac 연결이 없을 때만 난다). 그때는 허브에 상태를 보내고 담당 repo를 5분마다 확인하기만 한다.
  - `up --team`은 팀 Office가 꺼져 있으면 켜기 전에 담당 repo를 한 번 맞춘다(clone·등록·연결). 허브에 닿지 않는 등의 실패는 한 줄만 남기고 켜기를 막지 않으며, 질문은 하지 않는다. 팀 Office가 켜져 있으면 등록을 바꾸지 않는다.
  - 팀 Office는 60초마다 이 Mac의 상태(일하는 중·대기 중·쉬는 중(한도)·잠김)를 허브에 보낸다. 담당 repo의 연결이 죽었으면 5분 안에 새로 받고, 등록을 바꿔야 하면 열린 Task가 없을 때 스스로 `mac restart`로 다시 켠다. 그동안 새 Task는 가져가지 않는다.
  - 자기 폴더로 `team add`·`hub-link`를 한 repo는 Mac이 고치지 않는다. 같은 원격의 repo는 clone하지 않고 그 등록을 쓴다.
  - Mac 연결을 끊으려면 `mac disconnect`다. 등록과 clone은 남는다. Mac이 clone한 repo를 `team remove`로 빼도 내가 담당이면 다음 맞추기(`up --team`, `mac connect`, 스스로 다시 켜기)에서 다시 등록된다.
- **없는 것:** PL의 Story 올리기(4단계), Story 검증 Task(PL만 가져간다), 화면(`monitor --team`은 `UNSUPPORTED`, 5단계)

## 검증

기본 전환과 Claw 삭제는 [검증 기록](verification/2026-10-30-lean-office-default.md)에 있다. Claw Office 시절의 [원본 서버 연결 기록](verification/2026-09-29-native-claw-preview.md), [실행 환경 기록](verification/2026-09-28-runtime-setup.md)과 README pilot 증거는 이력으로 보존한다.
