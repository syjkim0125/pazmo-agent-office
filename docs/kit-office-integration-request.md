# kit 4.0.0 → Office 연동 검토와 API 요청

2026-09-21. Office Story M2/M3/M4, V2/V3/V4의 후속 검토다. 요구사항 원본은 [승인된 Story](understanding/pazmo-agent-office-contract.md)이며, 이 문서는 새 승인이나 구현 완료 기록이 아니다. kit 원본은 읽기만 했다.

## 판단과 현재 상태

인계 프롬프트의 책임 분리는 유지한다. ADK 설계 개념만 사용하고 Office의 기존 SQLite를 권위 있는 상태 저장소로 유지한다. 다만 아래 경계를 명시해야 바로 구현 가능한 지시가 된다.

| 구분 | Office 코드에서 확인한 상태 | 남은 연결 |
|---|---|---|
| 구현 | 계약/승인, 후보 해시, 실행 예약, 전역 슬롯, 취소/재시작 격리, 검증/인도 ledger | kit 전이 규칙을 같은 DB transaction에 연결 |
| 부분 구현 | PM 질문→팀장 제안 및 Engineer→Reviewer/테스트→최대 두 번 수정의 내부 조정기 | 실제 모델 factory, 사용자 실행 UI, 대기 작업 재개 |
| 부분 구현 | 고정된 자체 역할 지침, 읽기 전용 계획 snapshot | worker 내 CE/Superpowers 설치·발견·호출·모드별 검증 |
| 미구현 | 승인된 Story 이후 caller-owned ce-plan 실행 | 현재 Lead는 **G1 이전 초안 제안**이다. 승인된 계획 실행으로 보고하지 않는다 |
| 미검증 | 인증 모델의 실제 피드백/수정/재검증, 실제 사용자 G4, 후속 학습 조회, 전체 tarball pilot | fixture나 설치 성공으로 대체하지 않는다 |

Office에는 kit 3.1.1 지침/checker가 설치되어 있다. 아래 4.0.0 조사는 설치·통합 완료가 아니다. 현재 Office review와 tests는 같은 후보에서 병렬 실행된다. kit 최소 delivery graph의 review 이후 final verification과 대응하는 단계/증거도 명시적으로 정해야 한다.

## 확인한 산출물과 API

- kit 저장소: `/Users/jongkkim/Documents/ai-workflow-kit`, branch `feat/graph-engineering-runtime`, 조사 HEAD `b04117fae48b170f38328bd212eb4d64706fecd7`.
- tarball: `/tmp/pazmo-ai-workflow-kit-4.0.0.tgz`, SHA-256 `2f9adc22db9a70dad2e58fa6d8cf4a4b5b62777fa3ca75651caec5afe850c712`.
- 안전하게 추출한 패키지: `/private/tmp/pazmo-kit-office-audit-ub3qe14y/package`. 36개 파일 중 35개가 조사 당시 source와 같았다. 다른 세션에서 수정 중인 README.md만 달랐다. runtime/reference가 일치한다는 근거이며 전체 working tree가 패키지와 동일하다는 주장은 아니다.
- 조사: kit 인계 문서, `skill-integration.md`, `graph-engineering.md`, `src/graph/{index,executor,scheduler,workflow,storage,cli,task-graph}.mjs`.

| 실제 공개 API/동작 | Office에서 가정하면 안 되는 것 |
|---|---|
| `createTaskGraph`, `createRunState`, `getReadyNodes`, `assertRunState`, `resetAffectedSubgraph`, `executeTaskGraph`, `createPlanningGraph` | ready 조회가 durable claim이라는 가정 |
| executor는 입력 runState를 복사하여 내부 상태를 바꾸고 종료 후 반환 | callback 전의 running 전이가 Office DB에 저장된다는 가정 |
| CLI start/record/reset은 파일 lock/token/최대 3회 정책을 제공 | 같은 제한이 모든 프로그램 API에도 적용된다는 가정 |
| CLI init/status/start/record/reset, human 분기 | question/reply/resume API가 존재한다는 가정 |
| Story/G4 기록 checker | 실제 사람의 신원/승인을 인증한다는 가정 |
| 문서의 `office-kit-draft-1` | 이미 배포·검증된 kit schema라는 가정 |

## 요청 1 — 외부 저장소 transaction에서 재사용할 전이 규약

**제안이며 현재 API 이름/타입이 아니다.** CLI의 업무 규칙을 중복 구현하지 않고 호출할 수 있는, I/O 없는 전이 함수 또는 동등한 공식 연결 지점을 요청한다. 새 DB나 실행 엔진은 필요 없다.

입력:

- immutable graph와 현재 run state, node ID, 기대 state version/token.
- claim/record/reset 같은 요청, 시도 식별자, 검증된 native output/evaluation 및 근거 참조.
- 필요한 경우 Story/candidate fingerprint를 묶을 host context. 실제 프로세스 handle/lease와 사용자 신원은 Office가 관리한다.

기대 출력:

- 유효성 검사를 통과한 다음 상태와 실행 입력 token/시도 identity, 또는 구조화된 거절 사유.
- 아직 실행을 시작하지 않은 claim 결과를 Office가 **기존 IMMEDIATE transaction 안에서** lease와 함께 저장할 수 있어야 한다. 결과 적용도 결과/상태/lease 해제를 함께 저장한다.
- stale/duplicate/취소된 결과 및 소진된 시도를 거절한다. 영향받은 후속 노드 reset 시 기존 시도 수를 보존하고, 최초 실행+수정 2회 한도를 일관되게 적용한다.
- 프로세스 종료 불명 상태는 성공/재시작으로 바꾸지 않는다. Office가 global budget·프로세스 종료·격리를 책임지며 kit API가 자체 실행하거나 승인하지 않는다.

Office는 DB에 저장한 kit 상태를 단일 원본으로 사용할 예정이다. 별도 CLI run 파일을 동시에 갱신하거나 CLI 결과를 사후 성공으로 보정하지 않는다. 함수 호출만으로 동시성 안전이 생기지 않으므로 Office의 transaction/조건부 갱신과 결합한다. 정확한 schema와 serialization/version 정책은 kit 담당 세션이 반환한 계약으로 확정한다.

### 재현

Office checkout에서 다음을 실행한다. 스크립트는 모델/DB/kit 파일을 수정하지 않는다.

```sh
node scripts/probe-kit-office-seam.mjs /Users/jongkkim/Documents/ai-workflow-kit
node scripts/probe-kit-office-seam.mjs /private/tmp/pazmo-kit-office-audit-ub3qe14y/package
```

두 실행 모두 exit 0으로 다음 현재 동작을 확인했다. 이는 standalone in-process executor 자체의 결함 판정이 아니라 Office durable adapter가 필요하다는 재현이다.

```json
{
  "duringCallback": "pending",
  "originalStateAfterExecution": "pending",
  "launchesFromSameSavedState": 2,
  "programmaticAttemptAfterThree": 4
}
```

하나의 pending 상태를 두 controller 호출에 넘기면 각 callback이 실행된다. callback 중 controller가 죽으면 호출자에게 보관된 상태는 여전히 pending이다. attempts=3인 pending 상태도 프로그램 API는 네 번째 실행을 허용한다. 기대 동작은 **제안된 durable seam + Office transaction**에서 첫 claim만 저장/실행하고, 재시작 시 그 시도를 식별하며 네 번째 시도는 거절하는 것이다. 기존 CLI 제한과 비교해 규약이 어디에 적용되는지 문서화해 달라.

## 요청 2 — delivery 단계 질문/응답의 연결 정책

우선순위는 요청 1보다 낮다. 현재 Office intake에는 question ID와 답변 연결이 있지만 delivery 단계의 질문/재개는 미완성이다. kit CLI의 human은 결정 반영 새 run을 요구한다.

입력 사례: 구현 중 요구사항의 모호성을 발견한 node가 run/node/attempt/revision과 question ID를 반환하고, 사용자가 해당 질문에 답한다. 기대 출력: 이전 시도와 승인/변경본 관계를 보존하는 명시적 continuation 또는 새 run 연결 규약. 오래된 답변을 적용하거나 질문을 실패 테스트, 일반 답변을 G1/G4로 처리하면 안 된다. 당장 resume API를 추가하지 않는다면 현재 버전의 권장 host 절차와 증거 연결 방법을 반환해 달라.

## Office에서 계속할 일과 프롬프트 추가 문구

worker skill qualification, 실제 모델 factory, 승인된 Story 이후 계획 단계, 사용자 승인/대화 UI, live canary와 G4는 Office 책임이다. kit에 이 기능 전체를 이전하지 않는다. 인증 위치 결정은 [기존 G3](understanding/remote-controller-auth-decision.md)가 여전히 대기 중이며 이번 인계는 그 승인이 아니다.

인계 프롬프트에 아래를 추가하면 의미가 분명해진다.

> 현재 PM/Lead intake의 G1 이전 제안과, G1 이후 승인된 Story에 대한 실행 계획을 구분해라. 실제 worker에 제공된 스킬·문맥·버전과 실행 증거를 기록하고, host에 설치된 스킬을 worker가 실행했다고 간주하지 마라. kit의 durable 전이 규약이 확인되기 전에는 Office DB와 CLI run 파일을 함께 권위 있는 상태로 운용하지 마라. API 연결이 대기 중이어도 기존 Office 흐름의 문맥 전달·격리·사용자 접점은 계속 완성해라.

이번 Office 수정은 snapshot 경로/해시/읽기 권한을 PM/Lead job factory에 전달하고, 스킬 미검증 상태를 직접 수행으로 표시한다. 새로운 kit envelope/API 구현이 아니다. [검증과 남은 범위](verification/2026-09-21-kit-handoff-context.md).
