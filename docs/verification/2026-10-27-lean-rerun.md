# 2026-10-27 멈춘 lean 작업 다시 실행 검증

Story: M15 · V17 · D25. 결정: [lean-rerun-decision.md](../understanding/lean-rerun-decision.md). 설명 페이지: https://claude.ai/artifact/GjdNddv7bY4GzzAbB7v2zj. 사용 안내: [LOCAL-PREVIEW.md](../LOCAL-PREVIEW.md#새-office-1단계-시험). kit 그래프: `.ai-workflow/runs/U19-lean-rerun.json`.

기준: 브랜치 `codex/lean-rerun`. PR syjkim0125/pazmo-agent-office#32가 머지되기 전이라 그 끝(`1e7883e`)에서 시작했다(사용자 선택). #32 머지 뒤 main(`187431a`, #32·#34 포함) 위로 옮겼다. 겹친 곳은 `2026-10-21-lean-office-phase1.md`의 이웃한 두 줄뿐이었다. 3번은 이 변경의 문구로, 4번은 main의 문구로 합쳤다. 아래 자동 검증은 main 위에서 다시 돌린 결과다. 아직 커밋하지 않았다.

## 구현 범위

- **저장(`src/lean/schema.ts`):**
  - `task_reruns(task_id, previous_id)` 표를 더했다. 새 작업이 지워지면 연결도 지워지고, 한 작업은 한 번만 다시 실행된다(유일 조건).
  - 저장 파일을 열 때마다 `CREATE TABLE IF NOT EXISTS`로 만든다. 그래서 1단계에서 만든 기존 파일도 그대로 쓴다.
- **파사드(`src/lean/office.ts`):**
  - `rerun(id, input)`의 순서는 다음과 같다.
    1. 멈추는 중이면 거부한다.
    2. 루트 작업인지 확인한다(`NOT_FOUND`).
    3. 이미 다시 실행했는지 본다(`ALREADY_RERUN`).
    4. 지금 멈춤인지 본다(lean `stopOf`, 아니면 `NOT_STOPPED`).
    5. 새 작업을 만든다.
    6. 두 작업 기록에 한 줄씩 남긴다.
    7. 멈춘 작업을 취소한다. 그사이 이미 취소됐으면 건너뛴다.
  - 새 작업 만들기는 기존 `createTask`와 같은 검사를 거친다. 연결 행은 작업 행과 한 트랜잭션에서 저장한다. 그 트랜잭션 안에서 3·4번을 다시 검사한다. 그래서 실행기 확인을 기다리는 동안 다른 요청이 먼저 다시 실행했거나 다른 탭에서 취소했다면 새 작업을 만들지 않는다.
  - 취소는 엔진의 기존 `cancel`을 부른다. 실패하면 새 작업을 남기고 `previousCancelled: false`를 돌려준다. 새 작업 기록에 "이전 작업을 취소하지 못했습니다: <코드>"가 남는다.
  - 작업 상세에 `risk`, `rerunOf`, `rerunBy`를 더했다. 위험도 규칙은 보드와 같은 `riskOf`로 모았다.
- **서버(`src/lean/server.ts`):**
  - `POST /api/tasks/:id/rerun`(201, `{id, previousCancelled}`)을 더했다. 몸통에서 `title`, `body`, `agentId`, `risk`만 넘긴다.
  - `NOT_STOPPED`, `ALREADY_RERUN`은 409다. 세션·CSRF·Host·Origin 검사는 다른 쓰기 경로와 같은 공통 검사다.
- **화면(`src/lean/web/`):**
  - 멈춘 작업 상세에 [다시 실행]이 보인다. 이미 다시 실행했지만 취소만 실패한 작업에는 보이지 않고, 안내가 "이 작업은 취소하세요"로 바뀐다.
  - 창은 새 작업 창을 재사용한다. 제목·내용·위험도가 채워지고, agent는 원래 agent(지워졌으면 가장 오래된 agent)가 골라진다.
  - 위쪽에 "새 작업을 만든 뒤 이 작업을 취소합니다. 취소는 되돌릴 수 없습니다."가 보인다. 이 문구는 창의 `aria-describedby`라서 화면 낭독기가 창을 열 때 읽는다.
  - 성공하면 새 작업 상세로 가고, 두 작업의 제목 아래에 서로를 잇는 링크가 보인다.
- **바꾸지 않은 것:** 엔진(`src/core`, `src/runtime/native-office.ts`, `src/runners`), Claw Office, 결정 규칙, 대기열, 실행 예산.

## 자동 검증

| 검사 | 결과 |
|---|---|
| 기준선(변경 전, `1e7883e`) root `npm test` | 927/927 |
| 새 시험 RED | office 7/7 실패(`rerun is not a function`), schema 1/1 실패(표 없음), server 2개 실패(경로 404), web 4개 실패(함수·문구 없음), office 위험도 1개 실패 |
| 리뷰 뒤 추가 RED | "실행기 확인 중 다른 탭에서 취소" 시험이 트랜잭션 안 재검사 전에는 "Missing expected rejection"으로 실패했고, 재검사를 넣자 통과했다. "엔진이 받은 뒤 시작만 실패" 시험은 처음부터 통과했다(결정 표 4행을 고정하는 특성 시험). |
| 동시 요청 방어 확인 | 트랜잭션 안 검사를 일부러 빼면 동시 요청 시험이 `ERR_SQLITE_ERROR`로 실패하고, 되돌리면 통과한다 |
| lean 시험 4파일(office·schema·server·web) | 135/135 |
| root `npm test` (main `187431a` 위) | **943/943**, exit 0. 새 시험 13개(office 9, schema 1, web 3)를 포함하고, server·web 기존 시험 몇 개에 다시 실행 경우를 더했다. |
| root `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | PASS, exit 0 |
| `git diff --check` | exit 0 |

**환경 메모(이 변경과 무관):** 세션이 다시 시작된 뒤 첫 전체 실행에서 943개 중 942개가 통과했다. 실패 1건은 `tests/hub-link.test.mjs` "a Bearer token goes only to the pinned CA's hub"(`certificate signature failure`)였다.

- 원인은 시험용 허브 인증서를 만드는 `openssl`이 PATH 순서를 따른다는 점이다. 그 셸에서는 macOS 기본 LibreSSL 3.3.6이 먼저 잡혔다.
- Homebrew OpenSSL 3.6.3을 PATH 앞에 두면 그 파일은 25/25, 전체는 위의 943/943이다.
- 실패 시 오류 코드(`CERT_SIGNATURE_FAILURE`)는 `TLS_UNTRUSTED_CODES`에 없다. 그래서 LibreSSL로 만든 허브라면 실제로도 "허브 인증서가 다릅니다" 대신 일반 오류가 날 수 있다. 후속 작업 후보다.
- 이전 세션에서는 전체 실행에서 시간 초과 9건이 났다. 독립 리뷰어가 같은 시점에 전체 시험을 돌렸기 때문이다. 리뷰어의 단독 실행은 938/938(`1e7883e` 기준, 리뷰 전 변경)이었다.

## 리뷰

- **독립 리뷰(보고만, 1차):** Critical 0, Important 0, Minor 6이었다. 반영한 것은 다음과 같다.
  - 1번: 멈춤을 트랜잭션 안에서 다시 검사한다.
  - 2번: 시작 실패 시험을 더했다.
  - 3번: 이 기록의 빈칸을 채웠다.
  - 4번: 로그 문구에 검증된 제목을 쓴다(작업 행을 다시 읽지 않음).
  - 5번: `previous_id` 주석을 달았다.
  - 6번: 확인 문구를 `aria-describedby`로 연결했다.
  - 받지 않은 것: `app.js`를 소스 정규식으로 고정하는 시험. 소스 글자만 확인하는 시험이 되기 때문이다. 분기는 `view.js` 시험으로 고정했고, 연결은 실제 브라우저로 확인했다.
- **수정분 재리뷰(보고만):** Critical·Important 없음, 회귀 없음. Nit은 경합 시험의 대기 루프에 상한이 없다는 점이었는데 받지 않았다. 같은 파일의 기존 경합 시험과 같은 방식이고, 멈추면 거짓 통과가 아니라 시험이 끝나지 않는 쪽으로 드러난다.

## 화면 확인 (가짜 실행기, 사용자 Office 아님)

임시 프로젝트에 실제 lean Office를 띄웠다. 실행기만 가짜였고 멈춘 작업 하나를 두었다. 내장 브라우저로 다음을 확인했다.

1. 멈춘 작업 상세에 [다시 실행]·[작업 취소]가 보이고, 안내는 "진행 기록을 확인하고, 다시 실행하거나 작업을 취소하세요."였다.
2. 창 제목과 버튼은 "다시 실행"이었다. 제목·내용·위험도(높음)·agent(Bob)가 채워져 있었다.
3. 제목을 고쳐 확인하자 새 작업 상세로 갔다. "다시 실행했습니다." 알림과 "이전 작업: …" 링크가 보였고, 진행 기록에 "멈춘 작업을 다시 실행했습니다. 이전 작업: …"이 남았다. [다시 실행] 버튼은 없었다.
4. 링크로 간 이전 작업은 단계가 "취소"였다. 버튼과 멈춤 안내가 없고 "다시 실행한 작업: …" 링크와 기록 한 줄이 있었다.
5. main 위로 옮긴 뒤 다시 띄워 확인했다. 다시 실행 창은 `aria-describedby`가 확인 문구를 가리켰다. 새 작업 창은 비어 있고 "만들기"였으며 `aria-describedby`가 없었다.

## 확인하지 않은 것

- **실제 Office:** app-be 실제 Office에서 멈춘 작업을 다시 실행하지 않았다. 사용자의 Office를 다시 켜야 해서 요청할 때 한다.
- **엔진의 unknown 실행 기록:** 프로세스 생존을 알 수 없는 실행 기록이 남은 작업은 취소해도 그 기록과 슬롯이 남는다. 기존 취소와 같은 엔진 동작이다(B안 범위).
- **영어 화면:** 문구는 시험으로만 확인했다.
- **G4:** 남아 있다.
