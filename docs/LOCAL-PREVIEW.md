# Local Office 실행 안내

작업은 Codex 채팅으로 맡기고, Office에서는 진행과 결과를 확인한다. 채팅 담당자의 실행 규약은 [채팅 연결 안내](CHAT-CONTROL.md)에 있다. 사용자는 Operator 키를 입력하거나 승인 JSON을 만들 필요가 없다. 내부 인증·격리·실제 사용자 승인 규칙은 유지한다.

## 현재 Mac에서 시작하기

현재 작업 checkout에서 검증된 Node 24.19.0을 사용한다. 아래 `OFFICE_PROJECT`는 실제 작업을 맡길 **기존 로컬 Git 저장소의 절대 경로**로 바꾼다. 채팅에 경로와 작업을 알려주면 호스트가 이 명령을 처리할 수 있다.

```sh
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
OFFICE_PROJECT=/absolute/path/to/existing-git-project
node bin/pazmo-office.mjs setup-runtime --apply
node bin/pazmo-office.mjs init --project "$OFFICE_PROJECT" --apply
node bin/pazmo-office.mjs start --live --project "$OFFICE_PROJECT" --port 0
```

`setup-runtime --apply`는 공식 npm의 고정된 Mac controller 0.155.1과 Linux executor 0.154.0 배포본을 받아 해시를 검사한다. 전역 Codex나 인증 파일을 바꾸지 않는다. 기존에 일치하는 바이너리가 있으면 다시 받지 않는다. 기본 데이터 위치는 `$XDG_DATA_HOME/pazmo-agent-office` 또는 `$HOME/.local/share/pazmo-agent-office`이며, 프로젝트별 폴더에 DB·검증·결과물을 보관한다. `--data-dir`을 선택하면 모든 명령에 같은 값을 사용한다.

이미 preview가 실행 중이면 `stop --project "$OFFICE_PROJECT"` 후 `start --live`한다. 실행 중인 작업이 있으면 먼저 채팅으로 취소하고 정리가 끝나야 종료할 수 있다. VM이 멈췄다면 기존 격리 설정을 유지해 시작한다.

```sh
colima start pazmo-office --mount none --activate=false --ssh-config=false --ssh-agent=false --port-forwarder none
```

`LOGIN_REQUIRED`이면 Mac에서 Codex 로그인 후 다시 시작한다. 모델 인증은 Mac의 신뢰된 controller만 사용하고 파일·명령 도구는 전용 VM에서 실행한다. 로그인 파일 존재나 설치 성공만으로 실제 계정 호출 성공을 증명하지 않는다. 일반 `doctor`는 설치 확인이며 모델 실행 준비 완료가 아니다. 준비 상태는 `start --live`, `status`, 화면에서 확인한다.

## 사용 순서

1. 채팅에 프로젝트 경로와 작업을 말한다. 호스트는 Office에 등록하고 실제 PM을 실행한다.
2. PM의 필요한 질문과 범위 승인에 채팅으로 답한다. 호스트가 팀장 계획과 필요한 결정을 전달하고 승인된 구현·리뷰·검사를 이어간다.
3. “Office 화면 열어줘”라고 요청한다. 호스트가 `monitor` 명령의 조회 전용 주소를 브라우저로 연다. Office 하단 **진행과 결과**에서 대화, diff, 검사·리뷰, 승인 대기 이유를 확인한다. 옛 `/operator` 주소도 조회 화면으로 연결된다.
4. G4 질문에 본인이 답하고 승인 여부를 정한다. 답변 저장 후 별도 controller 평가와 현재 변경본의 검증이 통과해야 인도된다. 호스트가 결과 폴더와 기록 위치를 알려준다. 원본 프로젝트를 자동으로 덮어쓰지 않는다.
5. 중단하려면 채팅에 작업 취소를 요청한다. 다시 이어갈 때는 저장된 기록을 먼저 읽는다. Office를 재시작하면 화면의 조회 연결도 새로 연다.

이 연결은 해당 지원 명령을 실행할 수 있는 신뢰된 로컬 채팅 호스트를 사용한다. 별도 상주 자동화는 없으므로 채팅 종료 후에도 호스트가 다음 역할을 계속 호출한다고 보장하지 않는다. 이미 시작된 프로세스는 Office가 관리한다.

## 모델 없는 화면 미리보기

```sh
node bin/pazmo-office.mjs init --project /absolute/path/to/project --apply
node bin/pazmo-office.mjs start --project /absolute/path/to/project --port 0
node bin/pazmo-office.mjs monitor --project /absolute/path/to/project
```

`start`가 출력한 주소는 Office 그림, `monitor`의 주소는 인증된 조회 화면이다. 호스트가 후자를 직접 연다. 주소의 조회 정보는 문서나 Git에 저장하지 않는다. 실제 모델 실행은 `--live` 없이 시작되지 않는다. 정적인 역할 배치/캐릭터 애니메이션 자체는 실제 모델 실행 증거가 아니다. 실제 실행·대화·검증 상태는 **진행과 결과**의 저장 기록을 기준으로 본다.

초기화는 `.pazmo-office`의 소유권 manifest와 템플릿만 추가한다. `init`/`remove`는 기본 dry-run이고 `--apply`가 변경을 실행한다. `remove --apply`는 변경되지 않은 소유 파일만 제거하고 사용자 수정 파일과 DB·로그를 보존한다. 알 수 없는 런타임 파일을 지우거나 PID를 직접 종료해 복구하지 않는다.

## 개발 명령과 호환 API

```sh
npx --yes pnpm@10.30.1 --dir vendor/claw-empire install --frozen-lockfile --ignore-scripts
npm run build:office
npm run typecheck
npm test
```

테스트는 임시 loopback 서버를 띄운다. 모델 로그인/실행이나 공개 배포는 이 명령에 포함되지 않는다. 기존 `contracts`, `contract`, `intake-*`, `approval-*`, `verification`, `delivery`, `deliver`와 private operator API는 내부 호환을 위해 유지한다. 새 채팅 호스트는 `bridge`를 사용한다. 옛 키 출력 명령은 호환용으로만 남으며 사용자 화면에 키 입력란은 없다.

작업 계약은 Story/Task/검사 계획과 관련 파일 해시에 연결된다. 문서가 바뀌면 이전 승인을 사용할 수 없다. 실행 요청은 현재 계약 해시, PM 답변은 현재 요청 버전과 질문 ID, G4 평가는 저장된 답변 해시에 연결된다. CLI나 브라우저에서 평가를 위조하는 API는 없다.

인도는 controller 데이터 폴더의 `deliveries/` 아래 읽기 전용 `candidate/tree`, manifest, `receipt.json`을 만든다. 기록에는 후보, diff, 검사·리뷰, 실제 승인 답변과 평가가 연결된다. 검증된 파일과 인도 기록이 확정돼야 작업이 완료된다. 재시작/명시적 결과 조회에서 훼손이 발견되면 복구 필요 상태로 전환한다. 출처 없는 폴더를 인도 완료로 취급하지 않는다.

## 검증 범위

[채팅/관찰 변경 검증](verification/2026-09-28-chat-observation.md)에서 구현, fixture 검사, 브라우저 확인을 구분한다. 기존 [실행 환경 검증](verification/2026-09-28-runtime-setup.md)과 README pilot의 실제 증거는 보존한다. 새 채팅 경로로 실제 프로젝트의 PM부터 사용자 G4·인도까지 한 건 확인하는 인수 검증은 별도이며, 자동 테스트 통과로 대신하지 않는다.
