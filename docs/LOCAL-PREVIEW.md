# Local Office 실행 안내

현재 원본 Claw Empire의 Office·Tasks·회의·Decisions 화면과 서버를 연결하는 중이다. 별도 activity/Tasks 대체 화면은 제거했다. 키 입력 없이 원본 로컬 세션으로 접속하며 CEO와 직원에게 픽셀 스타일을 적용했다.

**`--claw`는 화면·작업 저장 미리보기이며 모델 호출을 차단한다. `--claw --live`는 Mac에 설치·로그인된 codex 또는 claude CLI와 검증된 전용 VM을 사용하는 실제 역할 실행 경로다. 역할별 실행기·모델은 오피스에서 에이전트를 클릭해 고른다. 새 원본 UI 파일럿은 PM·팀장·Developer·Reviewer와 검사 6개를 마치고 실제 사용자 G4 대기 중이다. 아직 전체 인도 완료로 간주하지 않는다. 화면의 Live 표시는 WebSocket 연결을 뜻한다.**

## 팀원용 한 명령 실행 (Apple Silicon Mac)

Office 작업 브랜치 `codex/office-kit-role-graphs`를 받아 Office 저장소 디렉터리에서 실행한다. 최초 준비는 Node **24.19 이상 24.x**, npm/npx, Git·Python 3(Command Line Tools), Homebrew의 `colima`·`docker`, 그리고 Mac에 설치된 codex 또는 Claude Code 중 하나 이상의 로그인(`codex login` 또는 `claude auth login`)이다. 둘 다 있어도 되고 하나만 있어도 된다. 상태는 설정 → CLI 도구에서 확인한다. 고정 0.155.1 codex만 쓰려면 `--codex-runtime pinned`를 붙인다. 필요하면 `brew install node@24 colima docker`를 사용하고 Node 24가 PATH에서 선택되는지 확인한다. Windows·Linux·Intel Mac의 live 실행은 아직 지원하지 않는다.

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

## 팀 허브 (1단계 시험)

초대받은 팀원이 한 곳에서 레포 목록을 보고 요청을 올리게 하는 사내망 게시판이다. 허브는 AI를 실행하지 않는다. 요청은 레포 담당자가 수락해 **자기 PC의 Office와 자기 로그인**으로 실행한다. 내 구독이나 회사 API 키를 공유하지 않는다. 결정은 [team-hub-decision.md](understanding/team-hub-decision.md), 검증은 [검증 기록](verification/2026-10-12-team-hub.md)이다. **한 Mac 확인만 마쳤고 다른 사람 PC와 회사 IT 정책 확인은 남아 있다.**

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

- **레포** 화면에서 이름과 git origin 주소로 등록한다. 등록한 사람이 첫 담당자다. 담당자나 관리자가 담당자를 더하거나 뺀다(마지막 담당자는 뺄 수 없다).
- 요청은 누구나 올린다. **수락과 그 레포의 Office 연결은 담당자만** 한다. 허브는 정규화한 origin 주소로 레포와 Office를 묶는다.

### Office 연결

담당자가 허브의 **내 Office 연결 명령 만들기**를 누르면 한 줄 명령이 나온다. 코드는 10분 동안 한 번만 쓸 수 있다. **그 레포를 클론해 둔 자기 PC**에서 실행한다.

```sh
# `pazmo-office`는 `node bin/pazmo-office.mjs`와 같다
pazmo-office hub-link --project <레포 로컬 경로> --hub <허브 url> --code <코드> --fingerprint <CA 지문>
pazmo-office hub-unlink --project <레포 로컬 경로>
```

- `--project`의 `git origin`이 등록한 원격 주소와 같아야 한다. 평소 Office에 `--data-dir`를 줬다면 같은 값을 쓴다.
- 지문과 일치하는 인증서 한 개만 신뢰하며, 토큰은 Office 데이터 디렉터리에 0600으로 저장된다. 토큰은 그 팀원·그 레포의 요청 조회, 진행 올리기, 답변·취소 받기만 할 수 있다.
- 연결은 **live Office(`start --live`)**에서만 동작하고 5초마다 허브를 조회한다. 실행 중인 live Office는 연결 후 5초 안에 붙는다. `hub-unlink`나 허브의 연결 해제로 끊는다. 끊으면 이전과 같은 동작이다.
- Office는 계속 `127.0.0.1`에만 열린다. 허브가 Office로 들어오지 않는다.
- 허브를 다른 Office(다른 PC·다른 데이터 디렉터리)로 옮길 때는 **먼저 진행 중인 일을 반납하거나 취소**한다. 다시 짝을 맺으면 이전 연결이 회수되고, 이전 Office에 남은 로컬 작업은 허브가 알 수 없어 계속 돈다. 남으면 맡은 사람이 직접 취소한다.

### 누가 무엇에 답하나

| 결정 | 답하는 사람 | 어디서 |
| - | - | - |
| PM 질문, 요청 범위(G1), 계획 재개 | **요청자** | 허브 요청 상세 |
| 작업 G1, G3, G4와 인도 | **맡은 사람** | 자기 Office 화면 |

- 맡은 사람의 Office는 요청자의 질문·G1에 "요청자가 팀 허브에서 답합니다"를 보여 주고 직접 답하지 못하게 한다. 허브 답변은 답변 원문, 답한 팀원과 시각, 허브 요청 ID와 함께 기록되고 출처는 `hub:<memberId>`다.
- 질문이 바뀌었으면 Office가 옛 답을 거부하고 허브는 "질문이 바뀌었어요"를 보여 준다.
- G4와 인도는 허브에서 끝낼 수 없다. 허브 답변을 위조해도 인도에는 맡은 사람의 로컬 G4가 필요하다.
- 요청자는 요청을 취소할 수 있고, 맡은 사람은 반납할 수 있다. 허브가 꺼져도 수락된 작업은 Office에서 계속되고, 허브가 켜지면 최신 상태를 다시 올린다.

### 내 PC에서 나가는 것

연결된 Office는 요청마다 허브에 **진행 스냅샷**을 올린다. 허브에 저장되고 허브에 들어온 모든 팀원이 볼 수 있다.

- **나가는 것:** 제목, 상태와 진행 메시지, 질문·범위(G1) 결정 내용, **역할 대화**, 변경 내용(diff, 512 KiB에서 잘림), 최종 보고 요약 4줄, 역할별 실행기·버전·모델. diff와 대화에는 코드와 파일 이름이 그대로 들어간다.
- **나가지 않는 것:** codex·claude 로그인 정보, 레포 전체, 인도물 파일, 실행 환경(VM), G4 검증 증거 원문. 허브에는 이를 읽을 수단이 없다.
- 허브 쪽 저장: 팀원, 등록한 브라우저, 초대·연결 코드·세션·토큰(해시만), 레포, 요청, 스냅샷, 답변. 허브 데이터는 허브를 연 Mac에 있다.

### 알려진 한계

- 허브는 고정 사설 IPv4에서만 연다. 호스트 이름이나 IP 변경 자동 대응은 없다.
- 허브 CA는 회전하지 않는다. 만료 30일 전이면 `HUB_CA_EXPIRING`으로 멈추며, TLS 디렉터리를 지우고 모두 다시 신뢰한다.
- 연계 요청, 에이전트 간 질문, 알림, 자동 배정, 사내 서버 배포는 후속이다.
- 팀원을 회수해도 그 사람이 맡은 열린 요청은 열려 있다. 요청자가 취소하거나 관리자가 정리한다.
- 요청 본문은 UTF-8 16384바이트(한글 약 5400자)까지다.

## 검증

[원본 서버 연결 기록](verification/2026-09-29-native-claw-preview.md)에 실제 HTTP/DB/WebSocket·브라우저 검사와 미검증 모델 흐름을 구분했다. 기존 [실행 환경 기록](verification/2026-09-28-runtime-setup.md)과 README pilot 증거는 보존한다.
