# 2026-10-30 새 Office 기본 전환과 Claw Empire 삭제 G4

Story: M1 · M2 · M3 · M8 · M12 · M15 · D33(처음에는 D30). 검증 기록: [2026-10-30-lean-office-default.md](2026-10-30-lean-office-default.md). 결정: [lean-office-default-decision.md](../understanding/lean-office-default-decision.md). PR syjkim0125/pazmo-agent-office#56. kit graph: `.ai-workflow/runs/U28-lean-office-default-replan.json`(상태 `g4`).

## 질문과 답 (2026-10-30)

컨트롤러는 먼저 설명 페이지("Claw 철거 순서")를 보였다. 그 페이지에는 결과·숫자·리뷰·확인한 것과 못 한 것·사전 확인 두 개·G4 세 질문과 선택지 넷이 있다. 사용자는 세 질문에는 답하지 않고 선택지만 골랐다.

> 2

②는 "승인 → 푸시·PR·머지까지"다. 컨트롤러는 push와 PR을 진행했다. 머지는 미뤘고, 그 대신 대화에 아래 답 초안과 사전 확인 두 개를 올렸다. 사전 확인은 app-be Claw Office의 진행 중·결정 대기 작업, OpenShift 허브의 수락된 진행 중 요청이다. 사용자 답은 다음과 같다.

> 확인했어 승인

컨트롤러는 이 답을 두 가지로 받아들였다. 하나는 사전 확인 두 개를 사용자가 확인했고 머지를 막을 것이 없다는 뜻이다. 다른 하나는 답 초안을 승인한다는 뜻이다. 사용자는 이 답을 기록 전에 봤다. 답은 컨트롤러가 썼다(D13 방식).

1. 동작:
   - `./office`(옵션 없음)·`start`가 새 Office(Tasks·작업 상세·Decisions·Agents)를 켠다. 예전 명령의 `--lean`도 같은 Office를 켠다.
   - `--claw`는 `CLAW_REMOVED`로 거부된다. 지운 명령(`bridge`·`contract`·`intake-*`·`approval-*`·`verification`·`delivery`·`deliver`·`operator-key`)은 `COMMAND_REMOVED`로 `./office`를 안내한다.
   - 업데이트 뒤 첫 실행은 루트 의존성 `ws`를 설치한다(npm 레지스트리 접속 필요). 첫 역할 실행 전에 실행기 자격 검사가 한 번 다시 돈다.
   - Office에서 허브 요청을 보내고 받던 화면이 없어졌다. 옛 `claw/` 데이터는 남지만 새 Office는 읽지 않는다.
2. 규칙과 실패 경로:
   - 사용자 데이터를 지우지 않는다.
   - 예전 버전이 켠 claw·legacy Office는 `status`로 보이고 `stop`으로 멈춘다. `start`·`up`·`monitor`는 `ENGINE_MISMATCH`로 거부한다.
   - 거부되는 시작·재사용에서는 아무것도 설치하지 않는다. `./office` 1단계의 실행기 검사(main의 D30·D32)는 의존성 설치보다 먼저 돈다.
   - 네트워크 없는 첫 실행은 설치 실패로 켜지지 않는다.
   - 한 checkout에서 여러 Office를 켠 채 업데이트하면 설치 중 다른 Office의 claude 작업이 실패할 수 있다(README 업데이트 절차 3번).
3. 증거와 한계:
   - 시험 수는 1104/1104(기준선)에서 1070/1070(vendor 삭제)이 됐다. 지운 시험은 파일별로 대조했다. 최종은 1089/1089다(main 1121 대비 −32).
   - vendor 없는 새 사본도 1070/1070이었다. 타입 검사와 Story 검사기는 exit 0이다.
   - 빌드된 Claw checkout을 업데이트해도 `git status`가 깨끗하고 `claw/`가 그대로였다.
   - 켜진 Office 재사용과 거부를 실제로 확인했다. 재시작 복구 시험의 돌연변이는 3/3, 리뷰 반영 시험의 돌연변이는 2/2를 잡았다.
   - 독립 리뷰는 리뷰어 9명과 Codex가 했고, P2 셋을 모두 고쳤다.
   - 확인하지 못한 것: app-be에서 작업 하나를 끝까지 돌리는 실제 확인(V17), `up`의 VM 준비 전체, 다른 사람 PC, 오프라인 첫 실행.

선택: ② 승인 후 머지.

## 평가

Story, diff, 시험과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. 기본 엔진, `--lean`·`--claw`, 지운 명령의 오류, 첫 실행 설치, 자격 검사 재실행, 허브 화면 삭제, `claw/` 보존은 다음과 같다: `lifecycle.ts`의 `STARTED`·`RETIRED`·`start`·`monitor`, `index.ts`의 `REMOVED_COMMANDS`·`CLAW_REMOVED`, `launcher.ts`의 `prepareDependencies`·`reuseOrStart`, 시험, D33. 다만 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 옛 상태 파일을 읽고 멈추는 것, 거부 때 설치하지 않는 것, 1단계 검사가 먼저인 것, 오프라인·여러 Office의 비용은 다음과 맞다: 코드, 리뷰 기록(`U28-review-1.md`, `U28-replan-review-3.md`), README 절차. |
| 증거 범위 | 충분하다. 자동 시험, 돌연변이, 실제 업데이트·재사용 확인, 리뷰를 들었다. V17 실제 실행과 VM 준비 전체를 하지 않은 것은 따로 적었다. |
| 사전 확인 | 사용자가 "확인했어"로 답했다. 컨트롤러는 그 내용(작업·요청이 없었는지, 끝냈는지)을 보지 못했다. |
| 선택 | 승인 후 머지. |

남는 한계: 사용자는 세 질문에 직접 답하지 않았다. 컨트롤러가 쓴 답을 본 뒤 "확인했어 승인"으로 받아들였다. 이 기록은 사용자가 답 초안을 보고 변경을 받아들여 머지를 맡겼다는 사실을 보여 준다. 사용자가 스스로 설명할 수 있다는 증거는 아니다. V17은 머지 뒤 app-be에서 확인한다.
