# 채팅으로 Office에 일 맡기기

사용자는 이 저장소의 Codex 채팅에 **대상 로컬 Git 프로젝트 경로와 원하는 작업**을 말한다. 채팅 담당자는 아래 지원 명령으로 Office에 등록하고, Office의 실제 역할 실행을 이어간다. 사용자에게 키 복사, 승인 JSON 작성, SQLite 수정을 요구하지 않는다. Office의 **진행과 결과** 화면은 조회 전용이다.

예: “`/절대/경로/프로젝트`에서 입력 오류 원인을 조사하고, 수정안과 테스트 결과를 보여줘. Office로 진행해.” Jira 링크만으로 코드 위치나 재현 정보가 생기지는 않는다. 필요한 접근 권한·프로젝트·재현 정보만 확인한다.

## 실행 전제와 경계

- 승인된 Mac controller 로그인, 전용 VM, kit 4.1.0 역할 그래프를 유지한다. 설치·시작은 [실행 안내](LOCAL-PREVIEW.md)를 따른다.
- 채팅 담당자가 아래 CLI를 실행할 수 있는 신뢰된 로컬 호스트여야 한다. 아무 채팅 앱에 메시지를 보낸다고 자동 연결되지는 않는다.
- Office가 PM/팀장/Developer/Reviewer를 실행한다. 채팅 담당자가 그 결과를 대신 작성하거나 kit 전체 workflow를 각 역할에 다시 시작시키지 않는다.
- 채팅 담당자가 활동하는 동안 다음 단계를 이어간다. 별도 상주 에이전트를 설치하지 않는다. 채팅 종료 이후 자동으로 다음 역할을 계속 호출한다고 약속하지 않는다. 이미 접수된 실행은 Office가 관리하며, 다음 채팅에서 저장된 상태를 읽고 이어간다.
- 사용자 승인 답변은 원문을 보존한다. 요청 자체를 모든 후속 승인으로 확대하지 않는다. G4 이해 답변을 생성하지 않는다.

## 채팅 호스트용 명령

아래 JSON은 **호스트 구현 규약**이며 사용자 입력 절차가 아니다. 작업 디렉터리는 현재 Office checkout, Node는 검증된 24.19.0을 사용한다. 모든 명령에 같은 프로젝트와 선택한 `--data-dir`을 유지한다.

`node bin/pazmo-office.mjs bridge --project /absolute/project [--data-dir /absolute/data]`

stdin으로 JSON 객체 하나를 전달한다. 최대 64 KiB이며, 임의 URL이나 파일 경로를 호출할 수 없다. 내부 인증키는 CLI가 처리하고 결과에 포함하지 않는다. 명령 문자열에 사용자 텍스트를 보간하지 말고 stdin으로 안전하게 전달한다.

| action | 추가 필드 | 용도 |
| --- | --- | --- |
| `runtime`, `requests`, `contracts` | 없음 (`requests`만 선택적 `before`) | 실행 준비, 요청/실행 작업 조회 |
| `request` | `taskId` | 요청·질문·범위·계획·인계 기록 조회 |
| `submit` | `input: {request, risk}` | 사용자 요청 등록 (`risk`: `normal` 또는 `high`) |
| `run-planning`, `publish`, `cancel-request` | `taskId`, `input: {revision, inputDigest}` | 저장된 요청에 대한 역할 실행·계획 등록·취소 |
| `answer` | `taskId`, `input: {revision, inputDigest, answers: [{id, answer}]}` | 현재 질문 ID에 실제 답변 전달 |
| `approve-story` | `taskId`, `input: {revision, inputDigest, answer: {decision, note}}` | 실제 G1 범위 결정 전달 |
| `verification`, `evidence`, `delivery` | `taskId` | 동일 후보 검증·diff·G4 근거·인도 조회 |
| `run-task`, `cancel-task` | `taskId`, `input: {contractDigest}` | 검사한 계약의 구현·리뷰·검사 또는 취소 |
| `request-approval` | `taskId`, `input: {gate}` | G1/G3/G4 질문 생성/재개 |
| `decide` | `input: {id, answer}` | 반환받은 승인 요청 ID에 사용자 결정 전달 |
| `assess` | `taskId`, `input: {requestId, answerDigest}` | 저장된 G4 답변의 실제 controller 평가 |
| `deliver` | `taskId` | 서버가 승인한 검증 결과물 인도 |

`answer.decision`은 `approve` 또는 `reject`다. `note`에는 실제 사용자 말을 기록한다. G4 승인 답변에 필요한 `understanding: {behavior, invariant, evidence}`는 실제 질문에 대한 사용자 답변으로만 채운다. 거절은 사유를 전달한다. 기존 API의 검증·승인 제한은 그대로 적용된다.

## 상태를 읽고 이어가기

1. `runtime`으로 준비 상태를 확인한다. 잠긴 preview를 실제 실행으로 보고하지 않는다. `requests`/`request`로 이미 등록된 동일 요청이 있는지 확인한 뒤 새 요청이면 `submit`한다.
2. 최신 요청이 `waiting_pm` 또는 `waiting_lead`이고 실행 중이 아니면 현재 `revision`/`inputDigest`로 `run-planning`한다. 접수 성공은 역할 완료가 아니다. 실행 중에는 읽기만 하며 결과가 나올 때까지 기다린다.
3. `awaiting_answer`에서는 저장된 질문만 사용자에게 묻고 원문 답변을 `answer`로 전달한다. `human_required`/`G1_REQUIRED`이면 저장된 Story를 간결하게 설명하고 실제 결정 이후 `approve-story`한다. 다른 원인의 `human_required`는 이유와 선택지를 보고하고 임의로 상태를 고치지 않는다.
4. `proposal`의 범위·검사 명령·작업 공간을 확인하고 기존 승인 범위 안에서 `publish`한다. 반환된 `publication.taskIds`가 구현 작업 ID다. 요청 ID와 혼용하지 않는다.
5. 각 계약을 `contracts`와 `verification`으로 확인한다. 필요한 G1/G3 질문을 `request-approval`로 받고 실제 사용자의 결정을 `decide`로 전달한다. 기존의 해당 계약 승인 기록이 있으면 다시 묻지 않는다. 조회 결과의 `verification.contract.contract.digest`(또는 `contracts` 항목의 `contract.digest`)를 `run-task`의 `contractDigest`로 보낸다.
6. Office가 구현→리뷰/검사→필요한 수정·재검증을 관리한다. 최대 2회 수정 한도와 kit 전이를 호스트에서 재구현하지 않는다. `verification`에서 실행·피드백·오류를 읽는다. 실행 중에는 같은 쓰기 명령을 반복하지 않는다.
7. 검증된 후보의 `evidence`를 읽고 G4 질문을 생성/재개한다. 정답을 대신 알려준 다음 사용자의 이해 답변으로 기록하지 않는다. 사용자가 답하면 `decide`로 저장한다. `completion.id`와 `completion.answerDigest`로 `assess`를 호출하고 결과를 읽는다. 단순 답변 제출을 최종 승인으로 보고하지 않는다.
8. 서버에서 현재 후보의 G4 승인이 확인됐을 때만 `deliver`한다. 인도 경로와 검증 범위를 사용자에게 알린다. 원본 프로젝트 자동 덮어쓰기·main 병합은 하지 않는다.

취소는 현재 단계에 맞는 `cancel-request` 또는 `cancel-task`를 호출하고 실행 정리 상태까지 확인한다. 시간 초과·연결 끊김 후 쓰기를 자동 재시도하지 않는다. 먼저 조회해 반영 여부를 확인한다. `STALE_INTAKE`/`CONTRACT_CHANGED`/`STALE_APPROVAL`이면 최신 상태를 다시 검토한다. 같은 원인으로 진전 없는 재시도 2회 후 멈추고 원인과 다음 행동을 알린다.

## 화면 열기

호스트가 `node bin/pazmo-office.mjs monitor --project /absolute/project [--data-dir /absolute/data]`를 호출하고 반환된 `url`을 브라우저로 연다. URL에는 조회만 가능한 일회 실행 인스턴스의 접속 정보가 담긴다. 문서나 Git에 저장하지 않는다. 브라우저는 이를 HttpOnly 조회 세션으로 바꾸고 주소창에서 지운다. 내부 실행키는 전달되지 않는다.

Office 하단 **진행과 결과**에서 요청, 역할 간 기록, diff, 검사·승인·인도 결과를 볼 수 있다. 5초마다 조회하며 숨겨진 탭은 갱신을 멈춘다. 재시작으로 연결이 만료되면 채팅에 “Office 화면 열어줘”라고 요청한다. `/operator`의 옛 링크도 이 화면으로 연결된다.

## 검증 범위

채팅 명령과 조회 화면은 실제 로컬 HTTP/DB를 이용한 자동 검사 및 fixture UI 검사로 검증한다. 이 검사는 실제 모델의 성공이나 사람의 G4 승인을 증명하지 않는다. 새 채팅 UX로 실제 프로젝트 한 건의 요청부터 인도까지 확인하기 전에는 로컬 알파 전체 완료를 선언하지 않는다.
