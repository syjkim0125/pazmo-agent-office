# Local Office 실행 안내

`./office`는 Pazmo의 최소 Office(Tasks·작업 상세·Decisions·Agents)를 켠다. 출발점이던 Claw Empire의 화면·서버, 채팅 bridge, 옵션 없는 `start`의 옛 미리보기는 2026-10-30에 지웠다(D30, [결정](understanding/lean-office-default-decision.md)). 예전 버전에서 업데이트하는 순서는 [README](../README_ko.md#claw-버전에서-업데이트)에 있다.

## 팀원용 한 명령 실행 (Apple Silicon Mac)

Office 저장소의 `main` 브랜치를 받아 Office 저장소 디렉터리에서 실행한다. 최초 준비는 Node **24.19 이상 24.x**, npm/npx, Git·Python 3(Command Line Tools), Homebrew의 `colima`·`docker`, 그리고 Mac에 설치된 codex 또는 Claude Code 중 하나 이상의 로그인(`codex login` 또는 `claude auth login`)이다. 둘 다 있어도 되고 하나만 있어도 된다. 상태는 Agents 화면에서 실행기를 고를 때 보인다. 고정 0.155.1 codex만 쓰려면 `--codex-runtime pinned`를 붙인다. 필요하면 `brew install node@24 colima docker`를 사용하고 Node 24가 PATH에서 선택되는지 확인한다. Windows·Linux·Intel Mac의 live 실행은 아직 지원하지 않는다.

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
- 한 Office는 시작할 때 지정한 프로젝트만 실행하고, 한 번에 한 작업을 진행한다. 결과는 로컬 인도 디렉터리에 저장하며 원본 프로젝트나 main을 자동 덮어쓰지 않는다. kit 4.1.0이 각 역할의 전이를 소유한다.
- 예전 버전이 켠 Claw Office가 아직 켜져 있으면 `status`가 보여 주고, `start`·`up`·`monitor`는 `ENGINE_MISMATCH`로 거부한다. `node bin/pazmo-office.mjs stop --project …`로 멈춘 뒤 다시 켠다.

## 팀 허브

초대받은 팀원이 레포 목록과 담당자를 함께 관리하는 서버다. 팀 일은 팀 Story 보드(아래 [팀 Office](#팀-office-2단계-시험))로 Hub에서 나눠 가진다. 허브는 AI를 실행하지 않는다. 결정은 [team-hub-decision.md](understanding/team-hub-decision.md)와 [team-story-board-decision.md](understanding/team-story-board-decision.md)이다. **한 Mac 확인만 마쳤고 다른 사람 PC와 회사 IT 정책 확인은 남아 있다.**

Office에서 허브 요청을 보내고 받던 화면(상단 팀 허브 버튼, 보내기, 받은 요청 수락·거절, 보낸 요청 취소)은 Claw Office와 함께 지웠다(D30). 허브 웹의 요청 게시판은 남아 있지만 수락한 요청을 실행하는 Office가 없다.

### 팀원의 가장 짧은 순서

1. 관리자에게 받은 **초대 링크**를 연다. 사내망 허브라면 먼저 아래 "인증서를 한 번 신뢰하기"를 한다(Fusion 허브는 필요 없다).
2. 합류하면 허브의 **내 Office 연결** 화면이 열린다. **연결 문자열 만들기 → 복사**를 누른다.
3. 그 레포를 클론해 둔 자기 PC에서 `pazmo-office hub-link --project <레포 경로> --connect "<연결 문자열>"`을 실행한다.
   - 허브는 Office의 git origin으로 레포를 찾는다. 허브에 없는 레포면 내 이름을 담당자로 해서 자동 등록한다. 다른 사람이 담당자인 레포면 거부되고, 그 사람이나 관리자가 나를 담당자로 추가하면 같은 문자열로 다시 연결할 수 있다(10분 안).
4. 그 레포를 [팀 Office](#팀-office-2단계-시험)에 등록한다.

결정은 [team-hub-onboarding-decision.md](understanding/team-hub-onboarding-decision.md)이다.

### Fusion(OpenShift)에 허브 띄우기

노트북 IP가 바뀌어도 끊기지 않게 허브를 Fusion 프로젝트에 상시로 띄울 수 있다. 라우터가 공인 인증서로 TLS를 처리하므로 **CA 신뢰와 지문이 필요 없다.** 결정은 [team-hub-fusion-decision.md](understanding/team-hub-fusion-decision.md)이다.

- 매니페스트는 OpenShift Template `deploy/fusion/pazmo-hub.json`이다. 이 레포가 공개라서 클러스터 호스트와 빌더 이미지는 매개변수이고, 실제 값은 git이 무시하는 `deploy/fusion/local.env`에 둔다.

```sh
# local.env 예: HUB_HOST=pazmo-hub-<프로젝트>.<apps 도메인>, BUILDER_IMAGE=<Node 24 S2I 빌더 이미지>
oc login …                      # 사용자가 직접
oc project <프로젝트>
oc process -f deploy/fusion/pazmo-hub.json --param-file=deploy/fusion/local.env | oc apply -f -
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
- 요청은 누구나 올린다. **수락·거절과 그 레포의 Office 연결은 담당자만** 한다. 수락·거절은 허브 웹에서 한다. 허브는 정규화한 origin 주소로 레포와 Office를 묶는다.

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
- 지문이 있으면 그 지문의 인증서 한 개만 신뢰하고, 없으면(Fusion) 공인 인증서를 시스템 신뢰로 검증한다. 토큰은 Office 데이터 디렉터리에 0600으로 저장되고 브라우저로 가지 않는다.
- 이 연결은 [팀 Office](#팀-office-2단계-시험)가 repo마다 쓴다. 단일 Office는 허브에 연결하지 않는다.
- `hub-unlink`는 이 Office의 설정만 지운다. 허브 쪽 연결 기록까지 끊으려면 허브의 레포 화면에서 연결 해제를 한다.
- Office는 계속 `127.0.0.1`에만 열린다. 허브가 Office로 들어오지 않고, 연결은 사람이 명령을 실행할 때만 일어난다.

### 알려진 한계

- 사내망 허브는 고정 사설 IPv4에서만 연다. 호스트 이름이나 IP 변경 자동 대응은 없다. IP가 자주 바뀌면 Fusion 허브를 쓴다.
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

# 4. 팀 Office 켜기 (VM·실행기·의존성 준비는 ./office와 같다)
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
- **데이터:** 팀 Office 자신의 데이터는 데이터 디렉터리의 `team/`이다. repo 엔진은 그 repo의 기존 lean 데이터를 그대로 쓴다. 등록된 repo는 단일 Office로 켤 수 없다(`IN_TEAM_OFFICE`).
- **실행 잠금:** 2단계 팀 Office는 `start --team`, `start --team --live`, `./office --team` 어느 것으로 켜도 repo 엔진을 잠근 채 연다. 가져가기·`gh` 확인·하트비트는 그래도 돈다.
- **없는 것:** 가져온 Task 실행(3단계), PL의 Story 올리기(4단계), 화면(`monitor --team`은 `UNSUPPORTED`, 5단계)

## 검증

기본 전환과 Claw 삭제는 [검증 기록](verification/2026-10-30-lean-office-default.md)에 있다. Claw Office 시절의 [원본 서버 연결 기록](verification/2026-09-29-native-claw-preview.md), [실행 환경 기록](verification/2026-09-28-runtime-setup.md)과 README pilot 증거는 이력으로 보존한다.
