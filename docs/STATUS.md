# 진행 상태 — 2026-09-21

현재 브랜치 `codex/office-runtime-baseline`에 **로컬 CLI·읽기 전용 Office preview·operator 계약/승인 API**를 구현했다. main에 머지된 U1 checkpoint `8e14344e97ae5effd90bd5b00fff8334bab63425`에서 시작했다. 이 브랜치는 전체 Story가 진행 중인 구현 체크포인트이며, G4·live 검증·main 병합은 완료하지 않았다. 기본 checkout의 기존 사용자 파일은 보존했다. [체크포인트 범위와 검증](verification/2026-09-21-runtime-checkpoint.md).

[실행/계약 승인 안내](LOCAL-PREVIEW.md) · [계약 구현 증거](verification/2026-09-19-contract-approvals.md) · [preview 검증·리뷰](verification/2026-09-18-runtime-baseline.md) · [VM 검증](verification/2026-09-18-vm-isolation.md) · [실행 환경 결정](understanding/native-runner-isolation-decision.md)

## 현재 되는 것

- **요청과 PM/Lead 대화 저장·조회·답변·취소**를 기존 SQLite/작업 큐와 operator CLI/API에 연결했다. 버전과 입력 해시로 중복·지연 답변을 거부하고, 취소와 이력은 재시작 후에도 보존한다. v1–v7 백업 후 v8로 업그레이드한다. 전체 root **227/227**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. 실제 PM/Lead 실행과 Office 대화 화면은 아직 미연결이며 새 요청은 `waiting_pm`에 보존된다. [증거와 한계](verification/2026-09-21-intake-ledger.md) · [사용 방법](LOCAL-PREVIEW.md#planning-requests-and-replies).

- **PM 질문·답변 → Lead 제안 → 계약 초안 생성의 내부 규약**을 구현했다. 현재 요청에 연결된 종료된 응답만 받고, 모든 요구사항/검증의 Task 연결과 질문 횟수를 제한한다. 모델 초안은 승인이 아니며, 기존 저장소 등록 후 G1/G3를 요구한다. Lead 계획을 승인 해시와 역할 문서에 포함하도록 누락을 수정했다. 전체 root **221/221**, 타입 검사 exit 0, Story/Task PASS. 실제 PM/Lead 실행·대화 영속화·API/UI 연결은 아직 없으며 모델 응답은 fixture다. [증거와 경계](verification/2026-09-21-planning-protocol.md).

- **Engineer/Reviewer 역할 지침을 고정 파일과 출처·버전·해시·라이선스 기록으로 연결했다.** 누락·변조·위조된 프로필을 실행 전에 거부한다. 실제 CLI/VM의 네 역할 요청에 지침이 전달되고 수정·재검증·모의 G4·로컬 인도가 이어짐을 확인했다. root **215/215**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. Pazmo 자체 프로필이며 CE/Superpowers 전체 실행·실제 모델 판단을 입증하지 않는다. [검증·리뷰·한계](verification/2026-09-21-role-profiles.md). 아래는 이전 단계 당시의 증거다.

- **G4 승인 후 로컬 산출물 인도**를 operator CLI/API에 연결했다. 검증된 변경본·원본 대비 diff·필수 결과·승인 답변/평가를 저장하고, 인도 기록과 `done`을 같은 SQLite transaction으로 확정한다. 재시작/명시적 조회에서 파일 누락·훼손을 발견하면 사람 확인으로 전환한다. 실제 Codex/VM의 수정·재검증 흐름을 **모의 G4와 로컬 파일 인도까지** 시험했다. root **205개**, 타입 검사, vendor lint(오류 0/기존 경고 40)가 통과했다. 모델·사람 판단은 fixture이며 실제 사용자 G4·인증 모델·UI 실행은 미완료다. [인도 증거와 한계](verification/2026-09-21-local-delivery.md). 아래 항목은 각 이전 단계의 당시 검증 기록이다.

- 승인된 작업을 **Engineer → 필수 테스트·Reviewer → 실패 시 최대 두 번 수정 → 새 후보 재검증 → G4 대기**로 진행하는 내부 조정기를 연결했다. 실제 Codex/VM에서 첫 테스트 실패 후 자동 수정·재검증을 확인했고 원본 프로젝트는 보존됐다. 전체 root **184개**, 타입 검사, vendor lint(오류 0/기존 경고 40), 기존 실제 CLI/VM 4개 회귀 시나리오가 통과했다. 승인 문서·실패 결과·검증된 diff를 역할에 전달하며, 슬롯 부족은 명시적 대기로 반환하고 실패/unknown은 자동 재시작하지 않는다. 모델 판단은 fixture이며 UI 실행·인증된 모델·G4 승인·인도는 아직 연결되지 않았다. [조정 흐름 증거](verification/2026-09-21-role-coordinator.md).

- 실제 Codex 도구를 **Engineer 수정 → 후보 고정 → VM 테스트 → 별도 읽기 전용 Reviewer → 동일 후보 결과 취합**에 연결했다. 정상 흐름은 G4 대기에 도달하며 잘못된 리뷰 응답과 실행 중 취소는 승인을 만들지 않는다. 실제 CLI/VM 4개 시나리오, 전체 root **172개**, 타입 검사와 vendor lint(오류 0/기존 경고 40)가 통과했다. 모델 응답·리뷰 판단은 무인증 localhost fixture이며 실제 의미 리뷰·인증된 역할·자동 조정·G4 승인·인도는 남아 있다. [증거와 한계](verification/2026-09-21-codex-workspace-review.md).

- 승인된 Engineer 기준본을 **수정 가능한 전용 VM 복사본으로 전달 → 종료 후 결과 회수 → 후보 고정 → 읽기 전용 테스트**로 연결했다. 실제 VM 8개 시나리오와 기존 readonly 6개, 전체 root **152개**, 타입 검사 및 vendor lint(오류 0/기존 경고 40)가 통과했다. 원본 checkout은 보존하며 경로 이탈·링크·특수 파일·실패/취소/timeout은 후보로 받아들이지 않는다. 명령은 fixture이며 실제 Codex 모델·Reviewer·Office 자동 조정은 다음 연결이다. [실제 VM 증거](verification/2026-09-21-mutable-workspace.md).

- Engineer 시작 전 승인된 작업 범위와 기준본을 고정하고, 종료가 확인된 동일 실행의 결과만 검증 후보로 연결한다. 수정은 직전 후보에서 시작하며 G4는 최초 기준본을 사용한다. 누락된 범위·다른 프로젝트·실패/취소/unknown·경로 이탈·기준본 변조를 차단한다. 스키마 v6 및 v1–v5 백업/업그레이드, 전체 root **145개**, 타입 검사, vendor lint(오류 0/기존 경고 40)를 확인했다. 이 단계의 Engineer/리뷰 실행 관찰은 fixture다. 후속 VM 전달 시험은 위 별도 증거를 따른다. [증거와 한계](verification/2026-09-21-engineer-handoffs.md).

- G4의 diff를 임의 문자열 대신 **고정 기준본과 검증 후보에서 실제 Git으로 생성**한다. 임시 기준본에 패치와 권한 변경을 재적용해 대상과 일치하는지 검사하며, 생성 중 취소·후보 변경과 오래된 미검증 bundle을 거부한다. 빈 기준본·전체 삭제·바이너리·비 UTF-8·링크·파일 형태 변경을 검증했다. 최종 root **124개**, 실제 VM **6개 시나리오**, 타입 검사와 lint가 통과했다(lint는 vendor 대상, 기존 경고 40개). 이 단계에서 남았던 기준본 출처/선택 범위는 후속 인계 코드에 연결했고, 실제 Engineer supervisor와 의미 평가 모델은 남아 있다. [증거와 한계](verification/2026-09-21-candidate-diff.md).

- 동일 후보의 검증·실행 종료 기록과 raw diff를 묶어 **G4 질문 → 사람 답변 저장 → 별도 평가 후 승인**하는 구조를 operator HTTP/CLI에 연결했다. 답변 제출만으로 승인되지 않으며 후보·계약 변경, 취소, 만료된 요청을 차단한다. 실제 diff 생성은 후속 단계에서 연결했으며 의미 평가 모델은 남아 있고 시험 답변/평가는 fixture다. 스키마 v5 및 v1–v4 백업·업그레이드·재시작 검증, 해당 단계 root **114개 통과**, 타입 검사 exit 0, vendor lint 오류 0/기존 경고 40. [증거와 남은 연결](verification/2026-09-21-g4-evidence.md).

- 등록된 테스트의 자동 병렬 배정을 구현했다. 전역 슬롯 3개 제한 안에서 대기 검사를 이어서 실행하고, 취소·unknown이면 나머지 검사를 중단한 뒤 정리를 기다린다. 실제 VM에서 **세 검사 동시 실행과 네 번째 대기**, **전체 취소 시 대기 검사 미실행·자원 정리**를 확인했다. 해당 단계 root 시험 **96개 통과**를 기록했다. 리뷰가 없으면 G4로 넘어가지 않는다. [병렬 배정 증거](verification/2026-09-21-verification-dispatch.md).

- 고정 후보의 등록된 테스트를 전용 VM에서 실제로 실행하고 종료 코드·출력을 실행 예약 및 검증 노드에 연결했다. 해당 단계에서 실제 VM의 정상·실패·시간 초과·취소·출력 초과 **5개 시나리오**와 root 시험 **85개**를 통과했다. 실행기 예외도 즉시 unknown으로 보존한다. 현재 테스트 배정은 내부 경로에 연결됐으며 인증된 Engineer/Reviewer, Office 자동 조정, G4·인도는 미연결이다. [단일 검사 검증 범위와 증거](verification/2026-09-21-container-verifier.md).

- 실행 예약·예산을 같은 SQLite에 영구 기록한다. 전체 슬롯 3개·Engineer 2개·초기 구현 1회와 자동 수정 2회 제한, 자원 중복 점유 차단, 결과 저장/슬롯 반환의 원자성, 재시작 시 unknown 슬롯 보존을 구현했다. v1–v3 DB 사전 백업 후 v4로 전환하며 operator 검증 조회에 실행 기록을 표시한다. 이 기반 구현 당시 전체 root 시험 **74개 통과**를 기록했고, 이후 offline test supervisor를 연결했다. 인증된 모델 supervisor는 남아 있다. [기반 증거와 기본 예산](verification/2026-09-21-execution-budgets.md).

- 공식 Codex 원격 도구 실행 진단 17개를 통과했다. 임시 무인증 환경에서 실제 CLI의 명령·patch를 VM 컨테이너로 전달하고 명시적인 local 환경 요청을 거부했다. AppArmor 변경 없이 시험했으며 실제 모델/계정 호출은 하지 않았다. [증거와 재현](verification/2026-09-21-codex-remote-execution.md). 기존 macOS 로그인을 controller에서 사용하는 대안은 [새 G3 제안](understanding/remote-controller-auth-decision.md)이며 아직 승인되지 않았다.

- 동일 후보의 필수 테스트·리뷰 결과 취합·분기 코드를 Office 서비스에 연결했다. operator 전용 `verification --task-id` 조회와 재시작 시 중단된 검증의 사람 확인 처리를 구현했다. 실제 offline test runner 결과는 내부 경로에 연결했으며 인증된 리뷰·자동 협업은 아직 연결하지 않았다. [취합 로직의 검증](verification/2026-09-21-verification-join.md).

- Node 24.19.0에서 init/doctor/start/status/stop/remove. init/remove는 기본 dry-run이며 수정된 사용자 파일과 DB/log를 보존한다.
- loopback에서 Claw Office·Dashboard·빈 Task board를 확인할 수 있다. 모델 실행·작업 변경·업데이트는 서버에서 차단된다. upstream scheduler·launcher·recovery는 import하지 않는다.
- 이전 baseline에서 root 시험 16개, 웹 시험 77개, 빌드·타입 검사 통과. upstream lint 오류 0/기존 경고 40. 검증 범위와 재시도 내역은 연결 문서에 기록했다.
- Colima/Docker CLI와 전용 VM 설치 완료. 호스트 폴더 공유 없는 컨테이너 기초 검사 46개 통과, 읽기 전용을 제거한 음성 대조군 실패 확인. 해당 시험 컨테이너·볼륨은 정리했다. 이후 VM을 다시 시작해 직접 Codex sandbox 시험을 수행했으며, 현재 VM 상태는 별도 조회가 필요하다.

- 이번 변경의 root 시험 39개, 타입 검사, vendor lint(오류 0/기존 경고 40), workflow doctor 6개 및 Story/Task checker(exit 0)가 통과했다. G4는 미검사이며 전체 인도는 미완료다.
- operator CLI에서 계약 등록·목록·G1/G3 요청·응답을 실제 HTTP/같은 SQLite 큐에 연결했다. Story/Task/결정/검증 조건의 내용과 작업·revision에 승인 효력을 묶는다. 변경 감지, 재사용 거부, rollback 및 v1 DB 백업 시험을 추가했다.
- candidate 복사·내용/mode/link 검사, 실제 offline verifier와 G4 증거/답변 프로토콜을 연결했다. G4의 실제 diff와 Engineer 기준본 출처는 연결했으며 인증된 모델 실행, 의미 평가, 인도와 브라우저 승인 UI는 아직 없다. `ready`는 계약 승인 상태이며 `execution`은 여전히 `locked`다.

## 실행이 잠겨 있는 이유와 다음 결정

2026-09-21 지속 목표와의 차이: CLI 등록과 Engineer 이후 내부 흐름은 연결돼 있으나, PM·Lead의 실제 요구사항 정리/배정과 구조화된 질문·답변 인계, Office 작업 등록·대화·승인 UI, 후속 작업의 학습 조회, 인증된 모델의 실제 프로젝트 pilot 및 사용자의 실제 G4는 남아 있다. 이번 역할 프로필 연결은 그중 Engineer/Reviewer 지침의 누락·변경 확인을 해결했다. 다음은 PM·Lead 제안과 질문을 기존 계약/승인 흐름에 연결하는 작업이다. 세 업무 모드와 npm tarball 설치 검증도 전체 완료 기준에 유지한다.

native 격리 canary가 필수 조건을 충족하지 못했다. 명시적 deny에도 `/private/tmp`의 가짜 보호 파일에 읽기/쓰기가 가능했고, 일반 경로에서도 Codex native binary의 새 프로세스 실행이 가능했다. 실제 인증 파일·사용자 DB는 시험에 쓰지 않았다. 인증된 모델 호출이나 sandbox 탈출이 성공했다는 의미는 아니다.

[전용 Linux VM 설계 G3](understanding/native-runner-isolation-decision.md)는 사용자의 후속 진행 요청으로 승인됐다. VM 기초 경계는 시험했지만, 해당 컨테이너 안의 Codex sandbox는 namespace 생성에서 실패했다. 따라서 live 실행은 계속 잠겨 있다. **도구 실행과 내부 역할 조정은 무인증 Codex/VM 시험에 연결했고, 다음은 live 전 canary·역할 프로필 검증과 사용자 실행 경로 연결**이다. 실제 인증 실행에는 별도로 대기 중인 controller 인증 위치 G3 승인이 필요하다. U3의 candidate/결과 연결 및 U4–U8 구현과 인증된 전체 runner, G4 및 전체 Story 인도는 남아 있다. 기초 canary 통과를 U4 전체 완료로 간주하지 않는다.

전용 VM에서 직접 실행해도 AppArmor가 user namespace 관련 권한을 거부했다. 고정 bwrap 경로에만 예외를 주는 [구체적인 변경](understanding/vm-bwrap-policy-decision.md)은 자동 승인 검토에서 거절됐다. 사용자에게 별도 승인을 요청했고, 아직 적용하지 않았다. 이 대기와 독립적인 계약·승인 구현은 진행 중이다.

## 계약과 workflow

요구사항 원본은 [Story](understanding/pazmo-agent-office-contract.md), HOW는 [U1–U8 계획](plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md)이다. G1과 기존 runtime G3는 승인됐으며 native 검증을 통과로 간주하지 않는다. 계획의 과거 G3 대기 표현은 당시 작성된 기록이고 현재 승인 기록은 [G3 문서](understanding/pazmo-agent-office-plan.md)를 따른다.

ai-workflow-kit 3.1.1 doctor와 Story checker exit 0. Story가 Delivered가 아니므로 checker는 G4를 검사하지 않았다. ce-work → test-first → ce-simplify-code → ce-code-review → 재검증을 U2 변경에 적용했다. 사용자 도구 매핑에 따라 리뷰는 같은 세션에서 순차 수행했으며 독립 모델 리뷰로 주장하지 않는다. 이번 진단의 준비 단계 실패와 음성 대조군, 리뷰 보강은 [VM 검증](verification/2026-09-18-vm-isolation.md)에 기록했다. Compound로 [읽기 전용 후보 준비와 검사 원칙](solutions/integration-issues/prepare-readonly-container-candidates.md)을 남겼다. 인증 격리 자체는 해결됐다고 기록하지 않았다.

Jira를 만들지 않았고, 모델·다른 provider·Remotion/PPT·submodule·npm publish·main merge를 실행하지 않았다. U1 게시 정리와 원본 보존은 [과거 게시 기록](verification/2026-09-18-publication.md)을 따른다. 자격증명을 포함하는 로컬 원본 보존 브랜치는 푸시하지 않는다.

## 입력 문서의 권한

[HANDOFF-v3.md](HANDOFF-v3.md), [IMPORT-UPSTREAM.md](IMPORT-UPSTREAM.md), [VERIFICATION.md](VERIFICATION.md)는 ZIP의 원본 참고 자료다. 그 안의 과거 HTTP 403, pending 상태, push 권한 문구 및 vendor의 지침은 현재 상태나 사용자 승인 기록이 아니다.
