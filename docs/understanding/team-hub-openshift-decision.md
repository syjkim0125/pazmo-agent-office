# G3 proposal: 팀 허브를 OpenShift(team-project 프로젝트)에 상시로 띄우기

Status: Approved
Understanding gate (G3): user conversation · 2026-10-14 · Check-in: accepted
Story: pazmo-agent-office-contract.md (M11; V13; D19)
Builds on: team-hub-decision.md (D16), team-hub-office-send-decision.md (D17), team-hub-office-cancel-decision.md (D18)

## 사용자 요청 (2026-10-14)

팀 허브 실제 확인 중 노트북 사내망 IP가 192.168.12.141 → 192.168.8.178 → 192.168.12.141로 바뀌었다. 그때마다 허브를 다시 시작하고, 두 Office를 다시 연결하고, 브라우저에 다시 로그인해야 했다. 사용자는 "허브는 OpenShift에 올려서 거기랑 해야겠다"고 했고, 프로젝트는 team-project로 정했다.

## 확인한 사실 (2026-10-14, OpenShift 콘솔 읽기와 이 Mac의 접속)

- **플랫폼:** OpenShift 콘솔이다(프로젝트 `team-project`).
- **배포 선례:** 같은 프로젝트에 기존 배포가 있다.
  - BuildConfig: Source 전략, 빌더 `${BUILDER_IMAGE}`, 출력은 내부 ImageStream.
  - Deployment: 파드 1개. Service와 Route가 붙어 있다.
  - 근거: app-be `docs/understanding/mockup-hosted-contract.md`.
- **주소와 TLS:** Route 주소는 `https://<이름>-team-project.<apps 도메인>` 형식이다. TLS는 라우터가 처리한다(edge, 안전하지 않은 트래픽은 Redirect).
  - 인증서는 `*.<apps 도메인>` 와일드카드이고 발급자는 `DigiCert Global G2 TLS RSA SHA256 2020 CA1`(공인 CA)다. 만료는 2026-11-17이다.
  - 브라우저와 Node가 기본으로 신뢰한다.
- **접근:** 주소가 사내 IP(172.30.x)로 풀린다. 이 Mac에서 기존 Route에 HTTPS로 접속하면 200과 인증서 검증 성공이 나온다. 사내망 밖이나 VPN에서 되는지는 확인하지 않았다.
- **저장소:** 프로젝트에 mysql·mongodb·elasticsearch용 PVC가 있고, 콘솔에서 PVC를 만들 수 있다.
- **허브 런타임:** 허브(`src/hub/*`)는 npm 의존성이 없다. Node 기본 모듈과 `node:sqlite`만 쓴다. `openssl` 호출은 자체 CA를 만들 때만 쓰므로 OpenShift 모드에서는 필요 없다.
- **레포:** `syjkim0125/pazmo-agent-office`는 github.com 공개 레포다. 목업은 회사 GitHub Enterprise에서 빌드한다. OpenShift에서 github.com으로 나가는 연결이 되는지는 확인하지 않았다.

## 사용자 결정 (설명 페이지 https://claude.ai/artifact/2oFMDvQg1Kp9gz5ZzsfFwv 확인 후)

| 질문 | 선택 |
|---|---|
| 지금의 사내망 허브 방식 | **둘 다 유지.** 사내망 허브(자체 CA, 사설 IP)는 그대로 두고 OpenShift 모드를 추가한다. |
| 데이터 위치 | **team-project 네임스페이스 PVC.** 네임스페이스 권한자가 저장된 스냅샷을 읽을 수 있다는 것을 알고 둔다. |
| 주소 | **전용 호스트.** 예: `https://pazmo-hub.apps.example.com`. 기존 호스트의 경로로 붙이지 않는다. |
| 빌드 | **로컬에서 올리는 빌드.** 목업과 같은 Node 24 빌더를 쓰는 BuildConfig에 `oc start-build --from-dir`로 허브 묶음을 올린다. 회사 GitHub로 옮기지 않고, github.com 접근에 의존하지 않는다. |

## 결정

1. **허브 OpenShift 모드(프록시 뒤 모드).**
   - 시작: `pazmo-office hub --public-url https://<호스트> --listen <IP>:<포트> --data-dir <경로>`. 컨테이너에서는 `--listen 0.0.0.0:8080 --data-dir /data`다.
   - 컨테이너 안에서는 HTTP로 연다. TLS 종료는 라우터가 한다.
   - 이 모드에서는 자체 CA와 서버 인증서를 만들지 않는다. `--host`의 사설 IPv4 제한도 쓰지 않는다. 바인딩 주소는 `--listen`이 정한다.
   - `--public-url`은 `https://`로 시작해야 하고 경로·포트·쿼리가 없어야 한다. 아니면 시작하지 않는다.
   - 요청 검사:
     - Host 헤더는 공개 호스트만 받는다. 그 밖은 421.
     - 쓰기 요청의 Origin은 공개 출처(`https://<호스트>`)만 받는다. 그 밖은 403.
     - 쿠키는 지금처럼 `HttpOnly; Secure; SameSite=Strict`다.
     - 보안 헤더는 사내망 모드와 같다. 라우터 뒤에서 보면 스킴은 늘 https다.
   - `/trust` 화면과 "인증서 먼저 신뢰" 안내는 이 모드에서 나오지 않는다. 초대 링크로 바로 들어온다.
   - 첫 관리자 초대 링크는 지금처럼 첫 줄 JSON으로 나온다. 컨테이너에서는 `oc logs`로 받는다.
   - 상태 확인 경로 `GET /healthz`를 둔다. 인증 없이 200과 본문 `ok`를 준다(GET만, Host 검사 전). 파드 준비·생존 검사에 쓴다.
2. **Office 연결(공인 인증서 신뢰).**
   - `hub-link --hub https://<호스트> --code <코드>`에서 `--fingerprint`를 생략할 수 있다. 생략하면 Node 기본 신뢰 저장소로 서버 인증서를 검증한다.
   - 연결 설정에는 "시스템 신뢰"로 기록한다. CA PEM은 저장하지 않는다.
   - `--fingerprint`를 주면 지금처럼 그 CA 하나만 신뢰한다(사내망 허브).
   - 이미 연결된 Office의 동작은 바뀌지 않는다.
   - 허브 화면의 "내 Office 연결 명령 만들기"는 OpenShift 모드에서 `--fingerprint` 없는 명령을 보여 준다.
3. **저장과 동시성.**
   - 허브 DB는 지금 SQLite 그대로다. 위치는 PVC(`/data`)다.
   - 파드는 1개로 고정하고 배포 전략은 `Recreate`다. 같은 볼륨에 두 파드가 동시에 붙지 않게 하려는 것이다.
   - SQLite 잠김을 바로 실패시키지 않도록 대기 시간(busy timeout)을 둔다. 사내망 모드에도 같이 적용한다.
4. **배포 파일과 절차.**
   - `deploy/openshift/pazmo-hub.json`에 OpenShift Template을 둔다. 레포가 공개라서 클러스터 호스트와 빌더 레지스트리는 매개변수 `HUB_HOST`·`BUILDER_IMAGE`로 받고, 실제 값은 git이 무시하는 `deploy/openshift/local.env`에 둔다(2026-10-15 공개 전 정리).
     - ImageStream
     - BuildConfig: Source 전략, 바이너리 입력, 빌더 `${BUILDER_IMAGE}`
     - Deployment: 파드 1개, Recreate, `/data` PVC, `/healthz` 검사
     - Service
     - Route: 전용 호스트, edge, Redirect
     - PVC: 2Gi, RWO (team-project 네임스페이스 최소 2Gi; 처음 ASSUMED 1Gi는 서버 시험 적용에서 거부됨)
   - `npm run hub:bundle`로 허브 실행에 필요한 파일만 묶는다. 대상은 `bin/`, 허브와 그 의존 파일, `package.json`이다.
   - 절차는 문서에 둔다.
     1. `oc login`(사용자)
     2. `oc process -f deploy/openshift/pazmo-hub.json --param-file=deploy/openshift/local.env | oc apply -f -`
     3. `oc start-build pazmo-hub --from-dir <묶음> --follow`
     4. `oc logs`로 관리자 링크 받기
   - 로그인 정보와 토큰은 다루지 않는다. 명령은 사용자가 실행한다.
5. **경계는 그대로다.**
   - 각 Office는 `127.0.0.1`에만 열리고, 허브는 Office로 접속하지 않는다.
   - 허브는 AI를 실행하지 않고, 로그인 정보·레포 전체·인도물·VM을 갖지 않는다.
   - 초대, 담당자 수락, 요청자 답변·취소 권한은 D16–D18과 같다.
   - 사내망 허브 모드와 그 테스트는 유지한다.

## 실패 처리

| 상황 | 동작 |
|---|---|
| `--public-url`이 https가 아니거나 경로·포트가 있음 | 시작하지 않고 이유를 출력한다. |
| 다른 Host로 들어온 요청(라우터 우회, 잘못된 DNS) | 421 Misdirected Request |
| 다른 출처의 쓰기 요청 | 403 |
| 파드 재시작 | PVC의 DB·비밀이 남아 세션·연결·요청이 이어진다. 관리자 링크는 다시 나오지 않는다(팀원이 있으면). |
| PVC가 없거나 쓰기 불가 | 시작하지 않는다. 파드는 재시작을 반복하고 `oc logs`에 이유가 남는다. |
| 지문 없이 연결했는데 인증서가 공인 CA가 아님 | 연결을 거부한다. 지문을 주라는 안내를 보여 준다. |
| 공인 인증서 만료·교체 | 플랫폼이 갱신한다. Office는 시스템 신뢰라서 다시 연결할 필요가 없다. |
| 허브 업데이트 | 새 묶음을 `oc start-build`로 올리면 Recreate로 잠깐 끊긴다. Office는 5초 확인으로 다시 붙는다. |

## 범위

- **이번:**
  - 허브 OpenShift 모드: 공개 주소, HTTP 수신, Host·Origin 검사, `/healthz`, 대기 시간
  - `hub-link`의 시스템 신뢰
  - 허브 화면의 연결 명령
  - `deploy/openshift/` 매니페스트와 묶음 스크립트, 사용 안내
  - team-project 프로젝트 실제 배포와 확인
- **제외:**
  - 파드 여러 개와 다른 DB
  - 회사 SSO 로그인
  - 자동 백업. 내보내기 명령(`oc rsync`)만 안내한다 (ASSUMED).
  - 사내망 밖 접속
  - 별도 네임스페이스
  - Git 소스 자동 빌드
  - 사내망 허브에서 OpenShift로 데이터 옮기기. OpenShift는 새 허브로 시작한다 (ASSUMED).

## 검증 (V13)

- 자동 테스트로 확인한다.
  - OpenShift 모드 시작 인자 검증
  - Host 421과 Origin 403, 쿠키 속성, `/healthz`
  - 자체 CA를 만들지 않는 것
  - 지문 없는 연결의 시스템 신뢰: 테스트 CA를 `NODE_EXTRA_CA_CERTS`로 넣어 확인
  - 공인 아닌 인증서 거부
  - 지문 연결 회귀
  - DB 대기 시간
- 기존 테스트는 전부 통과해야 한다. Office `127.0.0.1` 단언도 유지한다.
- 실제 확인(사용자와 함께):
  1. team-project 프로젝트에 배포한다.
  2. 관리자로 입장한다.
  3. app-be Office와 시험 Office를 지문 없이 연결한다.
  4. 보내기 → 수락 → 취소를 한 바퀴 돈다.
  5. 파드를 재시작한 뒤 세션과 연결이 이어지는지 본다.
  6. 노트북 IP가 바뀌어도 연결이 유지되는지 본다.
- 보안을 포함한 브랜치 전체 리뷰 1회. 결과는 X/X로 보고한다.

## 대안과 복구

- **사내망 허브만 계속:** IP가 바뀔 때마다 재시작·재연결·재로그인이 필요해 택하지 않았다.
- **OpenShift 모드만 두기:** 로컬 시험과 다른 팀의 허브를 위해 두 모드를 유지한다.
- **기존 호스트의 경로로 붙이기:** 허브 경로 전체에 접두사가 필요하고 쿠키 도메인을 다른 서비스와 나눠 써서 택하지 않았다.
- **회사 GitHub 미러·github.com Git 빌드:** 레포 이중 관리나 확인되지 않은 외부 접근에 기대야 해서 택하지 않았다.
- **복구:** OpenShift 리소스를 지우면 사내망 허브로 돌아간다. OpenShift에 쌓인 데이터는 `oc rsync`로 내보낸 뒤 지운다.

## 사람의 결정

사용자는 이 문서와 Story 수정안을 검토한 뒤 2026-10-14 "승인, 계획 써줘"라고 답했다. 이 답이 G3 승인이다.

## 승인 범위

- **승인하는 것:** 위 결정 1–5의 구현·검증과 team-project 프로젝트(개발 클러스터) 배포. 이것은 팀 시험 운영이며, D16이 미룬 "사내 서버 배포"를 이 범위로 연다.
- **승인하지 않는 것:** 운영 클러스터 배포, 파드 여러 개, SSO, 사내망 밖 공개, 자동 백업, 데이터 이전
