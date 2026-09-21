# Native 격리 시험 이후 실행 환경 결정

Status: Approved
Understanding gate (G3): accepted · 2026-09-18
Story: pazmo-agent-office-contract.md (M3/M4; V3/V4)
Prior decision: pazmo-agent-office-plan.md (승인 유지)

## 관찰

2026-09-18 macOS의 설치된 Codex 0.154.0으로 모델 없이 임시 canary를 실행했다. `/private/tmp`의 가짜 승인 DB·토큰·정책·다른 프로젝트 파일은 명시적 deny에도 읽기/쓰기가 가능했다. 일반 사용자 경로에서는 파일·symlink·TCP/Unix 소켓·소유 controller 신호가 차단됐지만, Codex native binary를 새 프로세스로 실행하여 `--version`을 호출할 수 있었다. 이는 인증된 모델 실행이나 sandbox 탈출의 증거는 아니지만, 현재 계획의 신규 Codex child 제한 조건을 충족하지 못한다. 브라우저/Apple Events와 인증된 전체 runner는 시험하지 않았다.

따라서 native 정책을 통과로 기록하지 않고 live 실행을 잠근다. 원본 출력과 재현 명령은 [검증 기록](../verification/2026-09-18-runtime-baseline.md)에 있다. [OpenAI의 macOS 임시 폴더 제한 설명](https://github.com/openai/codex-security/blob/main/sdk/typescript/README.md#generate-a-security-policy)도 확인했다.

## 권고안: 전용 Linux VM에서 다음 격리 검증

호스트에는 Office UI/controller/승인 DB만 두고, worker·검증 명령은 전용 VM의 서로 분리된 일회성 환경에서 실행하는 방향을 검증한다. Claw의 단일 큐와 승인 의미는 유지한다.

- 새 시스템 범위: Homebrew로 Colima와 Docker CLI를 설치하고 `pazmo-office` 전용 profile을 만든다. 자원은 CPU 2개, RAM 4 GiB, 데이터 디스크 20 GiB이며 별도 root 디스크도 20 GiB다. 이미지/패키지 다운로드와 VM 저장 공간이 필요하다. 제안 당시 해당 도구는 PATH에 없었고, 2026-09-18 설치했다.
- 기본값 그대로 시작하지 않는다. [Colima 기본 설정](https://github.com/abiosoft/colima/blob/main/embedded/defaults/colima.yaml)은 홈 공유와 context/SSH 설정 변경을 포함한다. 설치된 0.10.3에서 `--mount none` → `mounts: null`을 확인해 당초 빈 교환 폴더보다 좁은 **공유 폴더 없음**으로 실행했다. 실제 VM mount 목록도 검사한다. 홈·프로젝트 원본·Office 설치·controller 데이터는 공유하지 않는다. Docker 기본 context 선택/SSH config/로그인 시작 설정은 변경하지 않는다.
- 파일은 controller가 검증한 snapshot을 복사해 전달하고 결과를 회수한다. worker에 호스트 Docker socket·controller API·승인 token을 주지 않는다. 검증용 환경은 network none이며 후보 원본은 읽기 전용이다.
- 모델 인증은 VM 전용 공식 Codex 로그인 경로로 별도 검증한다. 기존 호스트 인증 파일을 자동 복사하지 않는다. 모델 통신에 필요한 외부 접속과 작업 명령의 네트워크 권한을 분리하고, 작업 명령에서 인증 파일·호스트 주소·새 모델 child 접근이 막혀야 한다.
- VM이라는 이유만으로 통과시키지 않는다. 파일/프로세스/소켓/브라우저/네트워크/중첩 실행 canary와 실제 runner 경계를 다시 시험한다. 통과 전에는 현재 preview를 유지한다. VM 내부 인증·도구 경계가 불충분하면 구현/실행을 차단하고 원인을 보고한다.

## 대안과 복구

도구 설치를 하지 않는 대안은 현재 읽기 전용 preview를 유지하고 native 제약 해소를 기다리는 것이다. 이는 전체 Story의 AI 팀 실행 인도가 아니다. 같은 호스트에 별도 OS 계정을 만드는 안은 계정 생성·키체인·프로세스/네트워크 정책 관리가 추가되므로 우선 권고하지 않는다.

시험 실패 시 VM을 중지하고 후보·로그를 보존한다. 전용 profile의 삭제는 사용자가 결과를 회수한 뒤 별도로 한다. 실제 사용자 DB migration, npm publish, main merge는 이 결정에 포함하지 않는다.

## 승인 기록

사용자가 VM 전환안과 Colima/Docker CLI 설치 제안을 받은 뒤 “다음에 할 일은 뭐야. 그거 진행해.”라고 요청했다. 이를 위 설치·전용 VM·격리 검증 진행 승인으로 기록한다. 실제 격리 통과, 인증 완료, 전체 Story/G4 승인으로 간주하지 않는다.

## 실행 결과

Colima 0.10.3/Docker CLI 29.7.2 설치와 전용 VM 생성, 컨테이너 기초 canary 46개 검증을 완료했다. 읽기 전용 설정을 제거한 음성 대조군은 exit 1로 실패했다. 동일한 제한 안에서 Codex 0.154.0 자체 sandbox는 namespace 생성 단계에서 exit 1로 중단되어, 인증·도구 분리는 아직 입증되지 않았다. 모델 실행은 계속 잠그고 시험 VM은 중지했다. [원본 증거와 재현 절차](../verification/2026-09-18-vm-isolation.md)를 따른다.
