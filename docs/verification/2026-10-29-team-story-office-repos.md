# 검증 기록: 팀 Story 보드 2단계 (Office 여러 repo)

이 기록은 M16·V18·D24 중 Office 쪽 2단계의 자동 검사, 구현 판정, 확인하지 않은 범위를 담는다. 2단계는 한 사람이 **팀 Office** 하나에 repo 여러 개를 등록해 켜는 데까지다. 기준은 브랜치 `codex/team-story-office`의 Task 1–7 커밋(`9304e4e`부터 `f581278`까지)과 최종 전체 리뷰의 수정 커밋(`5434f30`)이다. 계획은 [2단계 구현 계획](../plans/2026-10-27-1730-feat-team-story-office-repos-plan.md), 결정은 [G3 결정](../understanding/team-story-board-decision.md)이다.

**가져온 Task를 실행하지 않는다(3단계). 그래서 2단계만으로는 팀이 쓸 수 없고, 팀원에게 쓰라고 안내하지 않는다.** 머지는 G4 질문 관문 뒤에 정한다.

**2단계 팀 Office는 repo 엔진을 실행하지 않는다(3단계에서 Story Task 모드와 함께 켬).** `start --team --live`나 `up --team`으로 켜도 repo 엔진은 실행이 잠긴 채 열린다. repo에 남은 lean 작업은 손대지 않고 그대로 기다린다.

## 만든 것

- **등록부(`src/team/registry.ts`, Task 1):** `team add|remove|list`. repo는 git 루트의 실제 경로와 정규화한 origin으로 등록한다. 등록 수는 1–20개다.
  - 같은 origin의 clone 두 개는 `DUPLICATE_REMOTE`다.
  - 팀 Office가 켜져 있거나 켜지는 중(`team/start.lock`)에 등록을 바꾸면 `TEAM_RUNNING`이다.
  - 단일 Office가 켜진 repo를 등록하면 `RUNNING`이다.
  - 등록된 repo를 단일 Office로 켜면 `IN_TEAM_OFFICE`다.
  - 열린 가져온 기록을 가진 repo를 `team remove`하면 `OPEN_CLAIM`이다(Task 7). 그 repo의 폴더가 없으면 거부하지 않고 빼면서 로컬 기록을 `REPO_REMOVED`로 버린다(최종 리뷰 수정).
- **설정·가져온 기록(`src/team/store.ts`, Task 2):** `<dataRoot>/team/team.sqlite`(0600)에 둔다. 가져가기 멈춤(`team pause|resume`), 하루 상한(`team cap N|off`, 기본 5), 열린 기록 하나를 저장한다. 하루는 그 PC의 현지 날짜다.
- **`gh` 확인(`src/team/gh.ts`, Task 3):** Git 호스트마다 `gh auth status --hostname <host>`를 최소 env(HOME·PATH·LANG)로, 제한 시간 10000 ms 안에 실행한다.
- **Hub Story 연결(`src/team/story-link.ts`, Task 4):** repo마다 기존 `hub-link.json`으로 `/api/link/story/*`(프로토콜 3)의 `inbox`·`claim`·`task`·`heartbeat`를 부른다.
- **가져가기(`src/team/scheduler.ts`, Task 5):** 가져가기 전에 repo마다 `inbox`를 보고, 잃은 claim은 `task`로 다시 받는다. 멈춤·상한·실행 중이면 가져가지 않는다. 등록 순서로 첫 ready Task 하나를 가져온다. 하트비트 단계는 항상 `build`이고, `NOT_YOURS`면 기록을 버린다.
- **공유 관문(`src/runtime/native-office.ts`, Task 6):** 엔진에 `othersActive`·`onSettled`를 더해, 한 호스트의 엔진 여러 개를 한 번에 하나만 돌게 묶는다.
- **팀 Office(Task 7):**
  - `src/team/office.ts`: 등록된 repo마다 그 repo의 기존 lean 데이터(`<repo dataDir>/lean/`)로 lean 엔진을 하나씩 띄운다. 엔진들은 공유 관문으로 묶이고, repo마다 lane이 생긴다. 엔진에는 live 실행 환경을 주지 않고 기본 agent도 만들지 않는다(최종 리뷰 수정). 공유 관문은 시험 전용 `createRuntime`으로 시험한다.
    - 가져가기는 30000 ms, 하트비트는 60000 ms, ready가 아닌 lane의 다시 확인은 300000 ms마다 한다. 셋 다 `unref` 타이머다.
  - `src/runtime/team-service.ts`: `lean-service.ts`와 같은 IPC 시작·종료(10 s 제한) 방식이다. 서버는 `/__pazmo/status`·`/__pazmo/stop`만 있는 `127.0.0.1` 서버다.
  - `lifecycleRoutes`: lean 서버에서 꺼내 두 서버가 함께 쓴다. lean의 동작과 시험은 바뀌지 않았다.
  - CLI: `start --team`, `up --team`(`./office --team`), `status --team`, `stop --team`을 더했다. `monitor --team`은 `UNSUPPORTED`다.
  - 데이터는 `<dataRoot>/team/`이다. 메타데이터는 `team/meta/`에 있고, 등록한 repo 폴더는 `start --team`이 건드리지 않는다. `up --team`은 단일 `up`처럼 repo마다 `.pazmo-office`를 만든다.

## Task 7 판정 (컨트롤러 판정을 이렇게 적용했다)

| 판정 | 적용 |
|---|---|
| lane 상태는 `no-link` → `gh` → `ready` 순으로 정한다. ready가 아닌 lane(스케줄러가 정한 `relink`·`hub-too-old` 포함)은 300000 ms마다 다시 본다 | 연결 파일을 다시 읽고(바뀌었든 아니든 다시 만든다. `storyLink`는 상태가 없다), 실패한 호스트의 `gh`만 다시 묻고, 스케줄러가 가진 **같은 lane 객체**의 상태를 그 자리에서 고친다. ready lane은 다시 보지 않는다. Hub가 거절했던 lane은 이렇게 다시 ready가 되고, 그래도 거절되면 다음 가져가기에서 다시 빠진다 |
| 타이머: 가져가기 30000 ms, 하트비트 60000 ms, 다시 확인 300000 ms. 모두 `unref`다. 거절된 promise는 잡아서 기록한다. 앞 실행이 끝나기 전에는 새로 시작하지 않는다 | 타이머마다 실행 중 표시를 둔다. 실패(예: `OPEN_CLAIM`)는 `team: the claim tick failed (...)` 한 줄로 남기고 다음 주기에 계속한다. `beginStop`·`close`가 타이머를 먼저 멈춘다 |
| 엔진의 `othersActive`는 다른 열린 엔진 하나라도 `busy()`이면 참이다. 절대 예외를 던지지 않고, 예외를 던지는 엔진은 실행 중으로 센다. `onSettled`는 끝난 엔진 다음 것부터 등록 순서로 돌아가며 다른 엔진을 `refresh()`한다 | `sharedGate`가 맡는다. refresh는 하나씩 차례로 기다린다(앞 엔진이 다음 실행을 시작했으면 뒤 엔진은 기다린다). 실패는 기록하고 다음 엔진으로 간다. 닫힌 엔진과 멈추는 중의 관문은 건너뛴다. 가져가기의 `busy`는 엔진 중 하나라도 `busy()`인지다 |
| `team remove`는 열린 기록의 repo를 `OPEN_CLAIM`으로 거부한다 | `removeTeamRepo`에서 등록 확인 뒤 본다. `team.sqlite`가 아직 없으면 기록도 없으므로 파일을 만들지 않는다 |
| `TeamStatus.claim`은 `{storyNumber, taskNumber, title, project}`, `today`는 오늘 새로 가져온 수, `busy`는 엔진 중 하나라도 실행 중인지다 | 그대로다. `status --team`은 이 값을 실행 상태(`status`·`execution`·`engine`·`dataDir`)와 함께 보여준다. 화면이 없으므로 `url`은 주지 않는다 |
| 엔진은 등록된 repo에만 만든다. live일 때만 기본 agent를 만든다. `--live` 없이는 `start --lean`처럼 실행이 잠긴다 | 한 엔진이라도 열지 못하면 그때까지 연 엔진·DB·저장소를 닫고 시작을 실패시킨다. **최종 리뷰에서 바뀌었다:** live와 상관없이 모든 엔진을 잠근 채 열고 기본 agent를 만들지 않는다(아래 "최종 전체 리뷰 수정") |
| `monitor --team`은 `UNSUPPORTED`다. `--team`은 `--project`·`--lean`·`--claw`와 함께 쓸 수 없다(`ARGUMENT`). 등록 repo 없이 켜면 `NO_REPOS`다 | 그대로다. `--team`은 `start`·`up`·`status`·`stop`·`monitor`에만 받는다. `start --team`의 기본 포트는 0(빈 포트)이다. 열 화면이 없어 고정 포트가 필요 없다 |

- `gh`는 서비스 자신의 격리된 HOME·PATH가 아니라 사람의 PATH·HOME으로 실행한다. 시작하는 CLI가 IPC로 넘기며, live가 실행기 CLI를 찾을 때 쓰는 값과 같다.

## 최종 전체 리뷰 수정

최종 전체 브랜치 리뷰의 지적(Important 4건, Minor 2건, 공개 저장소 정리 1건)을 한 번에 고쳤다. 코드는 `5434f30`, 문서는 그 뒤 docs 커밋 두 개다.

| 지적 | 고친 것 | 시험 |
|---|---|---|
| 하트비트가 `404 NOT_FOUND`(Hub를 지우고 새로 만듦, repo를 다른 Hub에 다시 연결, repo를 새로 만들어 id가 바뀜)를 받으면 `retry`로 남아, 가져가기는 계속 `open`으로 멈추고 `team remove`는 계속 `OPEN_CLAIM`이었다 | 하트비트에서만 `404`+`NOT_FOUND`이면 `NOT_YOURS`와 같은 claim id 확인 뒤 기록을 `NOT_FOUND`로 버린다. Hub가 아직 이 사람의 claim이라고 하면 다음 가져가기가 `recovered`로 다시 받는다. 다른 호출의 404는 그대로 다시 시도한다(`classifyLinkError`는 바꾸지 않음) | `team-scheduler` 3개 |
| 등록된 repo 폴더를 옮기거나 지우면 `start --team`은 서비스 안의 `ENOENT`로, `up --team`은 git 오류로 끝났고, `team remove`는 그 repo의 열린 기록 때문에 `OPEN_CLAIM`으로 막혔다 | `start --team`·`up --team`·팀 서비스가 무엇이든 열기 전에 `REPO_MISSING`으로 멈추고 경로와 `pazmo-office team remove --project <경로>`를 안내한다. 폴더가 없는 repo는 열린 기록이 있어도 빼고, 그 기록을 `REPO_REMOVED`로 버린다(Hub Task는 하트비트가 끊겨 10분 뒤 보류되고 PL이 정한다). 폴더가 있는 repo는 그대로 `OPEN_CLAIM`이다 | `team-office` 1개, `team-lifecycle` 1개, `team-registry` 2개 |
| 팀 Office가 `--live`·`up --team`으로 켜지면 repo 엔진마다 live 실행 환경을 주고 기본 agent를 만들어, repo에 남은 lean 작업이 볼 화면도 취소·답할 곳도 없이 돌았다 | **2단계 팀 Office는 repo 엔진을 실행하지 않는다(3단계에서 Story Task 모드와 함께 켬).** `TeamConfig`에서 `live`를 빼고 `ensureDefault()`를 부르지 않는다. 가져가기·`gh` 확인·하트비트는 그대로 돈다. `status --team`의 `execution`은 `--live`로 켰는지만 나타낸다(`up --team`의 재사용 판단이 이 값을 본다) | `team-office` 1개(가짜 live 설정을 줘도 대기 작업이 그대로이고 기본 agent가 없음), 공유 관문 시험은 시험 전용 `createRuntime`으로 유지 |
| `teamRunning`이 `running.json`만 봐서, 켜지는 중(최대 15 s)에 등록을 바꿀 수 있었다 | `team/start.lock`이 있어도 켜진 것으로 본다 | `team-registry` 1개 |
| `OPEN_CLAIM` 안내와 사용 안내의 "PL이 풀거나"가 틀렸다. 풀기는 보류·실패 Task에만 되고, 켜진 팀 Office는 60초마다 하트비트를 보내 보류되지 않는다 | 켜진 팀 Office에서는 PL의 취소만 claim을 푼다고 고쳤다 | `team-registry`의 `OPEN_CLAIM` 시험에 문구 확인 추가 |
| 문서가 G4 전에 머지할 수 있다고 썼고, Task 7을 리뷰 전으로 적었다 | 머지 표현을 지우고 리뷰 상태와 이 수정을 적었다 | — |
| 공개 저장소의 G3 결정 문서에 사내 Git 호스트 이름이 있었다 | 중립 표현으로 바꿨다 | — |

## 자동 검사 (2026-10-29)

- 전체 시험: root `npm test` **1083/1083** exit 0. main(`8b9d23b`)을 합친 `678389f`에서 2026-10-29 오후에 돌렸다(OpenSSL 3.6.3이 PATH 앞, 다른 전체 실행 없음). 같은 커밋에서 `npm run typecheck` exit 0, Story 검사기 exit 0, `git diff --check` 깨끗함.
- 이전 전체 결과: root `npm test` **1073/1073**는 `574b401`에서 2026-10-29 오전에 돌린 것이다. 그 뒤 HEAD가 바뀌었으므로(`f581278`, `5434f30`) 지금 HEAD의 전체 결과가 아니다. Task 7의 새 시험은 22개다(`team-office` 14, `team-lifecycle` 6, `team-registry` 2).
  - `f581278`은 그 뒤 `OPEN_CLAIM` 안내 문구 한 줄만 바꿨다. `f581278`에서 다시 돌린 전체 실행은 PC 절전과 높은 부하(load 약 115) 때문에 끝나지 않았다. 그래서 `f581278`의 전체 결과는 없다.
- `5434f30`(최종 리뷰 수정)에서 확인한 것:
  - 팀·lean 관련 시험 **176/176**: `node --experimental-vm-modules --test tests/team-*.test.mjs tests/lean-server.test.mjs tests/lean-lifecycle.test.mjs`
  - `npm run typecheck` exit 0
  - `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` exit 0
- `f581278`에서 다시 확인한 것:
  - `npm run typecheck` exit 0
  - `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` exit 0
  - Task 7 관련 시험 **83/83**: `team-lifecycle`, `team-office`, `lean-server`, `lean-lifecycle`, `team-registry`
  - `team-lifecycle`(실제 CLI 실행): repo 두 개를 등록하고 `start --team`(live 없음)을 한다. `status --team`이 `running`·`team`과 repo 두 개(`no-link`, 호스트별 `gh` 결과)를 보이고, `stop --team`으로 프로세스가 끝난다. 그 밖에 `NO_REPOS`, `ARGUMENT` 조합 11개, `monitor --team`의 `UNSUPPORTED`, `up --team`의 repo·팀 메타데이터 준비를 본다. `gh`는 PATH의 가짜 `#!/bin/sh`다.
  - `team-office`(단위): `gh` 실패는 `gh`이고 호스트마다 한 번만 묻는다. 가짜 시계로 300000 ms 뒤 다시 확인한다(`relink`·`gh`·`no-link` → `ready`, ready lane은 다시 묻지 않음). 가져가기는 30000 ms, 하트비트는 60000 ms마다 돈다. 거절된 가져가기는 기록하고 계속한다. 시험 전용 실행 환경(`createRuntime`)을 준 엔진이 실행 중이면 `busy`이고 가져가지 않는다. 같은 방식으로 B의 대기 작업은 A가 끝난 뒤 시작한다. 그 밖에 관문 단위 시험, 멈춤·닫기, 시작 실패 시 정리, 팀 서버를 본다.
  - 변이 확인: `othersActive`를 끄거나 `onSettled`를 비우거나, 다시 확인에서 연결을 다시 읽지 않거나, 가져가기의 `busy`를 끄면 해당 시험이 실패했다.
- 실제 서비스 로그(임시 데이터 폴더): 연결 없는 repo마다 `hub-link --project` 안내가 한 줄씩 남았다.

## 리뷰

- Task 1–7: Task마다 독립 리뷰를 마쳤다. Task 5·6은 수정 1회 뒤 재리뷰를 통과했다.
- 최종 전체 브랜치 리뷰: 마쳤다. 지적은 위 "최종 전체 리뷰 수정"에서 한 번에 고쳤다.

## 확인하지 않은 것

- **가져온 Task의 실행(3단계):** Story Task 모드로 넘기기, 하트비트의 실제 단계, push·PR·Story base 자동 머지
- **PL의 Story 올리기(4단계), 화면(5단계):** 2단계의 상태 확인은 `status --team`뿐이다.
- **로컬 Hub로 하는 실제 확인:** `pazmo-office hub`에 시험 Story를 API로 올리고 eevee-be와 시험 repo 두 개로 가져가기·하트비트·재시작 뒤 이어 받기를 본다. 사용자 확인 뒤에 한다. 공유 Hub에 시험 데이터를 쓰는 것은 따로 묻는다.
- **`up --team` 실제 실행:** VM·실행기·vendor 준비를 끝까지 하는 것. 자동 시험은 첫 검사(colima 또는 로그인)에서 멈추는 데까지만 본다. 2단계는 repo 엔진을 실행하지 않으므로, live 엔진 여러 개를 띄우는 것은 3단계에서 본다.
- **다른 PC, 회사 IT·보안 정책, 실제 GitHub Enterprise의 `gh` 로그인**
- 알려진 한계:
  - ready가 된 lane은 다시 확인하지 않는다. 켠 뒤 `gh` 로그인이 풀려도 재시작 전까지는 그 repo에서 계속 가져간다. 2단계는 push를 하지 않으므로 기록·하트비트만 하고, push 전 확인은 3단계가 다룬다.
  - 닫는 중에 Hub 응답을 기다리던 가져가기는 기록되지 못할 수 있다. 다음 시작에서 `inbox` → `task`로 같은 claim을 이어 받는다.
  - 폴더가 없는 repo를 빼면 로컬 기록만 버린다. Hub의 그 Task는 하트비트가 끊겨 10분 뒤 보류되고, 그다음은 PL이 정한다.
  - repo에 남은 lean 작업은 팀 Office에서 보이지 않는다. 그 repo를 `team remove`하고 단일 Office로 켜면 다시 보인다.
