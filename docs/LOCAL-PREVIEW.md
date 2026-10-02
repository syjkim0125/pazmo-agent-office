# Local Office 실행 안내

현재 원본 Claw Empire의 Office·Tasks·회의·Decisions 화면과 서버를 연결하는 중이다. 별도 activity/Tasks 대체 화면은 제거했다. 키 입력 없이 원본 로컬 세션으로 접속하며 CEO와 직원에게 픽셀 스타일을 적용했다.

**`--claw`는 화면·작업 저장 미리보기이며 모델 호출을 차단한다. `--claw --live`는 기존 Mac Codex 로그인과 검증된 전용 VM을 사용하는 실제 역할 실행 경로다. 새 원본 UI 파일럿은 PM·팀장·Developer·Reviewer와 검사 6개를 마치고 실제 사용자 G4 대기 중이다. 아직 전체 인도 완료로 간주하지 않는다. 화면의 Live 표시는 WebSocket 연결을 뜻한다.**

## 팀원용 한 명령 실행 (Apple Silicon Mac)

Office 작업 브랜치 `codex/office-kit-role-graphs`를 받아 Office 저장소 디렉터리에서 실행한다. 최초 준비는 Node **24.19 이상 24.x**, npm/npx, Git·Python 3(Command Line Tools), Homebrew의 `colima`·`docker`, Mac의 `codex login`이다. 필요하면 `brew install node@24 colima docker`를 사용하고 Node 24가 PATH에서 선택되는지 확인한다. Windows·Linux·Intel Mac의 live 실행은 아직 지원하지 않는다.

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

초기 Codex 로그인과 검증된 전용 VM 준비가 필요하다. 준비 여부와 설치 과정은 [실행 환경 기록](verification/2026-09-28-runtime-setup.md)을 따른다. 기존 서버를 중지한 뒤 같은 프로젝트로 시작한다.

```sh
node bin/pazmo-office.mjs stop --project /absolute/path/to/project
node bin/pazmo-office.mjs start --claw --live --project /absolute/path/to/project --port 0
node bin/pazmo-office.mjs monitor --project /absolute/path/to/project
```

캐릭터의 대화하기에서 업무지시를 보내거나 기존 Tasks에서 프로젝트를 선택해 배정한다. 현재 한 서버는 시작할 때 지정한 프로젝트만 실행한다. Office가 PM → 팀장 → 구현·리뷰·검증을 연결하며, 질문과 승인은 기존 Decisions에서 처리한다. 최종 승인은 실제 사용자 답변과 검증된 변경본에 연결된다. 결과는 로컬 인도 디렉터리에 저장하며 원본 프로젝트나 main을 자동 덮어쓰지 않는다.

kit 4.1.0이 각 역할의 전이를 소유하고, Office는 원본 Claw DB의 작업에 기존 승인·검증 기록을 연결한다. 실제 실행은 한 번에 한 작업을 진행한다. 취소는 해당 작업의 중지로 처리하며, 실행 종료가 불확실한 실패·재시작은 자동 재실행하지 않는다.

계획 응답의 형식 오류로 멈추고 프로세스 종료가 확인되면 기존 Decisions에 `계획 재개`가 나타난다. 원인을 확인한 뒤 재개 요청을 제출하면 기존 범위 승인과 실패 기록을 보존하며 해당 역할만 이어간다. 이 재개는 요청 전체에서 최대 두 번이며, 범위 승인이나 최종 승인을 대신하지 않는다.

옵션 없는 `start`와 기존 `bridge` 쓰기 명령은 이전 runtime 호환용이다. 원본 서버에서는 기존 채팅·작업·Decisions API를 사용하며 private API는 조회만 허용한다. 서로 다른 runtime에서 같은 작업을 독립적으로 완료 처리하지 않는다.

## 검증

[원본 서버 연결 기록](verification/2026-09-29-native-claw-preview.md)에 실제 HTTP/DB/WebSocket·브라우저 검사와 미검증 모델 흐름을 구분했다. 기존 [실행 환경 기록](verification/2026-09-28-runtime-setup.md)과 README pilot 증거는 보존한다.
