# 검증 기록: 팀 Story 보드 3단계 (Story Task 모드)

이 기록은 M16·V18·D24·D34 중 Office 쪽 3단계의 자동 검사, 구현 판정, 확인하지 않은 범위, 실제 확인 계획을 담는다. 3단계는 팀 Office가 가져온 Story Task를 실제로 돌려 Story base에 머지하고 Hub에 보고하는 데까지다. 기준은 로컬 브랜치 `worktree-compound-team-office`(원격 이름 `codex/team-story-task`, 아직 push하지 않음)의 `0255dc1`부터 `848121e`까지와, 그 뒤의 Task 9 리뷰 수정(`8e74319`)과 최종 리뷰 수정(`cee9ff8`·`dec5c9c`·`d902128`·`1217710`·`c389101`과 이 문서 커밋)이다. 계획은 [3단계 구현 계획](../plans/2026-10-30-1500-feat-team-story-task-mode-plan.md), 결정은 [G3 결정](../understanding/team-story-board-decision.md)의 5·6장, 실패 처리 표, 구현 단계 3이다.

**자동 시험만 마쳤다. 실제 Hub·GitHub·VM으로 Story Task를 돌려 보지 않았다(아래 "실제 확인 계획").** 그래서 팀원에게 쓰라고 안내하지 않는다. 머지는 G4 질문 관문 뒤에 정한다.

## 만든 것

| Task | 커밋 | 내용 |
|---|---|---|
| 1 Hub | `7d7923e` | `claim`이 줄 Task가 없고 이 사람의 열린 Task가 있으면 `{task:null, open:{storyNumber, taskNumber, repoName, state}}`를 돌려준다(2단계 실제 확인의 찾은 것 1). Story 연결에 `mergeLock`·`mergeUnlock`·`merged`·`failed`·`rerun`을 더했다 |
| 2 기록 | `0c8d97c` | `team.sqlite`의 열린 기록에 단계(`claimed`·`building`·`verified`·`merging`·`reporting`·`failed`), 시도 수, 엔진 작업, 보낼 보고(outbox), 다시 실행 메모를 둔다. Task 8이 빌드 시작 시각·직전 실패·돌려줄 머지 잠금을 더했다 |
| 3 가져가기 | `19bf76d`, `c18637a` | `canExecute`·`stageOf`·`onDropped`·`blockedBy`. 하트비트 `409 STATE`의 출구(머지 보고 다시 보내기, 보낼 것 없으면 버리기), 실패한 기록은 하트비트 대신 `task()`로 본다 |
| 4 git | `205c214`, `677c162`, `7d83011` | `branch.ts`: Office 전용 체크아웃(`git worktree add --detach`), Task 브랜치 시작, 후보 트리로 커밋, push(`pushTaskBranch` 하나만 push한다), Story base 합치기, 충돌 판정. 체크아웃은 Task 사이에 초기화한다 |
| 5 PR | `3150838`, `b2ca08b` | `pr.ts`: 사람의 `gh`로 PR 열기·찾기·머지(머지 커밋, `--match-head-commit`) |
| 6 계약 문서 | `6394bfb`, `e0ff2e9` | `story-contract.ts`: Hub Story Task를 엔진이 받는 계약 문서(`story.md`·`task-1.md`·`verify-1.json`·`plan.md`)로 만든다 |
| 7 엔진 | `72a2ad2`, `1ab0085` | lean 엔진의 Story Task: Engineer부터 시작, Task G1은 Office가 기록, Task G4 없이 검증 통과에서 끝남. 검증 명령만 다시 돌리는 `verify` |
| 8 실행 상태 기계 | `919f57d`, `af22cc3`, `0448352` | `executor.ts`: 준비 → 빌드 → 커밋·push·PR → 머지 잠금 → base 합치기·재검증 → PR 머지 → 보고. 시도 3번, 한 단계 3번 연속 실패, 90분 빌드 제한, 재시작 뒤 이어 하기, 보고 다시 보내기, 다시 실행 |
| 9 연결 | `848121e` | 팀 Office가 repo마다 Story 엔진을 체크아웃에 열고 실행 상태 기계를 돌린다. `team rerun --memo`, `status --team`의 새 칸, 문서 |

## Task 9 판정 (컨트롤러 판정을 이렇게 적용했다)

| 판정 | 적용 |
|---|---|
| repo마다 Story 엔진: project는 `<repo 데이터 폴더>/story-checkout`(켤 때 `ensureCheckout`), 데이터는 `<repo 데이터 폴더>/story`, `agents.ensureDefault()`. `<repo 데이터 폴더>/lean`은 열지 않는다 | `--live`로 켤 때 엔진보다 먼저 체크아웃을 만든다(live 실행 환경이 project가 git 최상위인지 보기 때문). 엔진 DB는 `openLeanDb`가 받은 폴더의 `lean/` 아래에 두므로 `story/lean/office.sqlite`이고, 엔진 작업 파일은 `story/` 아래다. 기본 agent는 live일 때만 만든다(lean Office와 같음). `lean/`은 열지도 만들지도 않는다 |
| 가져가기는 실행할 수 있을 때만: `--live`, repo 엔진의 실행기 준비, 열린 기록 없음 | `canExecute = live && 실행기 준비 && 열린 기록 없음`. 실행기 준비는 모든 repo 엔진의 기본 agent가 `runnersReady`인지다. 켤 때 한 번 묻고, 그 뒤에는 가져가기가 Hub에 물을 수 있을 때(멈춤·상한 아님, 열린 기록·실행 중 엔진 없음, 준비된 repo 있음)에만, 준비돼 있었으면 300000 ms마다, 아니면 가져가기마다 다시 묻는다(리뷰 수정 1회). 바뀔 때마다 그 repo와 agent의 실행기를 이름 대는 로그 한 줄을 남긴다 |
| `stageOf`·`onDropped`는 실행 상태 기계의 것 | 그대로 넘긴다. 하트비트 단계는 엔진의 단계(`build`·`review`·`verify`)이거나 `merge`다. 버린 기록의 엔진 작업은 멈추고 체크아웃·브랜치는 남긴다 |
| 구동: 엔진 settle 때와 10000 ms마다. 켤 때 열린 기록마다 한 번, 첫 하트비트 전에 | 엔진의 `onSettled`가 공유 관문의 차례 넘기기와 함께 `drive()`를 시작한다(둘을 기다리지 않고 동시에 시작한다. 한 번에 한 실행은 엔진의 `othersActive`가 지킨다). 10000 ms 타이머를 둔다. live로 켜면 바로 `drive()`를 한 번 시작한다. **최종 리뷰 수정 3에서 바뀜:** 하트비트는 그 첫 구동을 기다리지 않는다(기다리면 재검증 동안 하트비트가 끊겨 10분 뒤 보류로 보였다). 대신 첫 구동이 끝나기 전에는 하트비트 `NOT_YOURS`가 `verified`·`merging` 기록을 버리지 않는다. 머지는 됐는데 보고 전에 PL이 푼 기록은 그래서 여전히 늦은 머지 보고에 닿는다 |
| `stop --team`은 엔진이 실행 중이면 `TASK_ACTIVE` | 그대로다(검증 명령만 다시 돌리는 중도 실행 중이다). push·PR·머지·보고 사이에서는 멈춰도 되고 다음 시작이 이어 한다 |
| `team rerun --memo "<text>"`는 `requestRerun`만 쓰고 `{requested:true}`. 꺼져 있어도 된다. 실패한 기록이 없으면 `NO_FAILED_CLAIM`. 메모 2000자 | 그대로다. `--memo`가 없으면 `ARGUMENT`, 2000자를 넘으면 `INVALID`, 다른 명령의 `--memo`는 `ARGUMENT`다. `team status`(꺼져 있어도 됨)도 열린 기록의 `phase`·`attempts`를 보인다 |
| `TeamStatus`에 `execution: "live" \| "locked"`, `claim.phase`·`attempts`, `blockedBy` | 그대로다. 단, `status --team`의 `execution`은 생명주기 쪽 말(`ready`·`locked`)로 바꿔 보인다. `up --team`의 재사용 판단과 `start --team --live`의 `EXECUTION_LOCKED` 확인이 `ready`를 비교하기 때문이다(2단계와 같은 값) |
| 결정되지 않은 것: `--live` 없이 켰는데 열린 기록이 있을 때 | **ASSUMED(D34), 리뷰 수정 1회에서 컨트롤러 판정으로 고침:** 진행하지 않는다. git도, 엔진 제출도, 머지 잠금도 하지 않는다. 잠긴 엔진으로 구동하면 준비 단계가 10초마다 fetch를 되풀이하고, base가 바뀐 머지는 잠금을 쥔 채 `EXECUTION_LOCKED`로 기다려 같은 Story의 다른 Task를 막기 때문이다. 단계가 `verified`·`merging`인 기록은 하트비트도 보내지 않고 버리지도 않고 `--live` 시작에 남긴다(그 시작은 바로 첫 구동을 하고, 그것이 끝나기 전에는 하트비트 `NOT_YOURS`가 그 기록을 버리지 않는다. 최종 리뷰 수정 3). 머지된 PR이 보고되지 않았을 수 있고, PL이 푼 뒤의 하트비트 `NOT_YOURS`가 보낼 것 없는 기록을 버려 그 머지를 잃기 때문이다. 다른 단계는 하트비트(실패한 Task는 Task 읽기)만 보낸다 |
| 결정되지 않은 것: live 엔진 여러 개의 시작 시간 | 모든 repo 엔진이 실행기 탐색 하나를 함께 쓴다. 켜는 동안은 그 하나를 시간과 상관없이 다시 쓰고(리뷰 수정 1회), 켠 뒤에는 5초 재사용이다. 그러지 않으면 live 시작이 repo 수만큼 탐색(각 수 초, claude는 최대 17초, D31)을 한다. 팀 서비스의 시작 대기를 lean과 같은 30000 ms로 늘렸다 |
| 결정되지 않은 것: 서비스가 쓸 사람의 git 환경 | 시작하는 CLI가 사람의 PATH·HOME과 (있으면) `SSH_AUTH_SOCK`을 넘긴다(IPC의 `gh`를 `host`로 바꿈). `gh` 확인, git, `gh` PR이 모두 이 값을 쓴다 |

이어받은 항목:

- `OPEN_CLAIM` 안내(`registry.ts`)가 "다음 하트비트가 기록을 버린다"고만 했다. 실패한 기록은 하트비트를 보내지 않는다. 이제 기록이 닫히는 길(머지·보고, 또는 켜진 동안 PL의 취소, 실패한 Task는 풀기도)과 알아채는 때(다음 하트비트, 실패한 Task는 다음 Task 읽기)를 말한다.
- `CHECKOUT_DIRTY`는 쓰지 않는다(Task 4 판정: 체크아웃은 Office 것이라 Task 사이에 초기화한다). 계획의 오류 목록에 줄을 그어 적었다. 다시 만들지 않았다.
- 커밋 서명: 커밋은 사람의 git 설정을 따른다. `commit.gpgsign`이 켜져 있는데 서명 agent가 없으면 커밋이 서명 오류로 실패하고, 세 번 연속이면 Task가 그 이유로 실패 보고된다. 사용 안내에 적었다.
- 체크아웃의 `manifest.json`: 체크아웃에는 Office 설치 메타데이터(`.pazmo-office/manifest.json`)가 없다. `readManifest`·`init`을 부르는 곳은 CLI의 생명주기·`up`·`init`·`remove`·`doctor`뿐이고(`src/cli/`), 엔진(`src/runtime/`, `src/lean/`, `src/core/`)과 팀 코드(`src/team/`)에는 없다. 팀 Office가 `locate`하는 것은 등록된 repo이지 체크아웃이 아니다. 시험 두 개가 체크아웃에 `manifest.json`이 생기지 않는 것을 본다(엔진을 연 뒤, Story Task를 제출한 뒤).
- 해결 문서 [give-local-claim-record-an-exit-for-every-hub-answer.md](../solutions/architecture-patterns/give-local-claim-record-an-exit-for-every-hub-answer.md)를 3단계 출구(`STATE`, 실패한 기록, 다시 실행, 끝내 거절된 보고, 재시작 뒤 첫 구동)와 지금 줄 번호로 고쳤다.

## 자동 검사 (2026-11-02)

- 전체 시험: root `npm test` **1255/1255** exit 0. Task 9 변경을 커밋하기 직전의 작업 트리(HEAD `0448352` + Task 9 변경)에서 다른 전체 실행 없이 돌렸다. 코드는 `848121e`와 같다. 그 뒤 `team-office` 시험의 기다림 한도만 2초에서 10초로 늘렸고(부하가 큰 PC용), 아래 팀 시험 전체는 `848121e`에서 다시 돌렸다. Task 8 끝(`0448352`)의 전체 결과는 1247/1247이었다.
- `npm run typecheck` exit 0, `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` exit 0.
- 팀 시험 전체(`tests/team-*.test.mjs`) **280/280**.
- Task 9의 시험(`team-office` 새 시험 7개와 고친 시험 7개, `team-lifecycle` 새 시험 2개와 고친 시험 2개, `team-registry`·`team-store`의 문구·모양 확인 2개):
  - "start --team without --live claims nothing and status says execution locked": 연결된 repo에 줄 Task가 있어도 가져가지 않고, 체크아웃도 git도 없다.
  - "a team Office opens one story engine per repo on its checkout and never opens <repo dataDir>/lean": 체크아웃이 detached worktree, 엔진 DB의 project가 체크아웃, 기본 agent 하나, 실행 환경의 데이터가 `story/`, `manifest.json` 없음, 사람의 HEAD·브랜치·커밋 안 한 변경 그대로, `lean/` 없음, repo 둘이 실행기 탐색 하나를 함께 씀.
  - "status --team shows phase, attempts and blockedBy"
  - "team rerun --memo writes the request; NO_FAILED_CLAIM without a failed record"(실제 CLI)
  - 실행기 준비 전에는 가져가지 않고 준비되면 가져감, 첫 하트비트 전 구동(머지 잠금 답이 늦어도 하트비트가 기다림), 10000 ms 구동으로 가져온 Task가 체크아웃의 Story 엔진에 기본 agent로 제출되고 하트비트가 엔진 단계를 보냄, PL이 풀면 엔진 실행이 멈춤, 엔진 settle만으로 다시 실행 뒤의 새 claim이 엔진에 들어감, 실행 중이면 가져가지 않음, 엔진은 한 번에 하나, 멈춤·닫기, 열리지 않는 엔진.
- 변이 확인(되돌림): 첫 구동 없음, 하트비트가 첫 구동을 기다리지 않음, settle 구동 없음, 실행기 준비 무시, live 무시, 10000 ms 타이머 없음, `story` 대신 `lean` 폴더, `stageOf` 고정, `onDropped` 없음, 실행기 탐색 공유 없음. 10개 모두 해당 시험이 실패했다.
- 시험 방식: git은 시험마다 만든 로컬 repo와 진짜 `git worktree`, origin에 닿는 git 단계·`gh`·VM 실행 환경은 가짜다. Task 4·5·8의 시험이 로컬 bare repo와 PATH의 가짜 `gh`로 그 단계들을 따로 본다.

## 리뷰

- Task 1–8: Task마다 독립 리뷰를 마쳤다. Task 1·2·5는 한 번에, 3·4·6·7은 수정 1회 뒤, 8은 수정 2회 뒤 통과했다.
- Task 9: 리뷰 1회(Important 2건, Minor 8건)를 아래 "리뷰 수정 1회"에서 고쳤고, 재리뷰에서 통과했다.
- 최종 전체 브랜치 리뷰(`43d18f6..8e74319`): Critical 0, Important 4, Minor 7. Important 4건은 모두 리뷰어의 시험(probe)이 재현했다. 아래 "최종 리뷰 수정"에서 모두 고쳤다. 그 수정의 재리뷰(2026-11-02, `8e74319..957ec6e`)는 모든 지적을 해결로 판정했다. 원래 재현 시험 4/4와 변형 8/8이 통과했고, `8e74319`에서 새 시험이 실패하는 것을 확인했으며, 새 Critical·Important는 없었다.
- 최종 확인(`957ec6e`): `npm test` **1275/1275** exit 0, 타입 검사 exit 0, Story 검사기 exit 0. kit 실행 `U29-team-story-task-mode-replan.json`의 세 노드를 기록했고 다음은 G4다.

## 리뷰 수정 1회 (Task 9)

| 지적 | 고친 것 | 시험 |
|---|---|---|
| Important 1: `--live` 없이 다시 켜면, 머지 뒤 보고 전에 멈춘 `merging` 기록이 PL이 푼 Claim의 하트비트 `NOT_YOURS`로 버려져 머지가 보고되지 않는다 | 컨트롤러 판정: 잠긴 팀 Office는 `verified`·`merging` 기록에 하트비트를 보내지 않고 버리지도 않는다(claim마다 로그 한 줄). `--live` 시작의 첫 구동이 그 머지를 보고한다. D34·사용 안내·이 기록을 고쳤다. `team rerun`은 live 팀 Office만 처리한다고 사용 안내·도움말에 적었다 | `team-office` "a locked start leaves a verified or merging record for a live start: …"(claimed는 하트비트, verified·merging은 하트비트 없음·기록 그대로, 그 뒤 live 시작이 늦은 길로 보고), 도움말 시험 |
| Important 2: 할 일 없는 live 팀 Office가 30초마다 실행기 탐색(codex·claude 실행)을 했다 | 컨트롤러 판정: 가져가기가 Hub에 물을 때만(멈춤·상한 아님, 열린 기록·실행 중 엔진 없음, 준비된 repo 있음) 묻고, 준비돼 있었으면 300000 ms(`RECHECK_MS`)마다, 아니면 가져가기마다 다시 묻는다. 켤 때 한 번 묻는다 | `team-office` "with --live, the runners are checked once for the start, again every 300000 ms while ready, …"(가짜 시계: 준비된 동안 9번의 가져가기에 탐색 없음, 300000 ms 뒤 한 번, 준비 안 됨이면 가져가기마다, 상한·멈춤 동안 없음) |
| 3: 로그가 "codex 또는 claude에 로그인"만 말했다. 엔진 agent는 처음 만들 때 정해진다 | 준비되지 않은 repo마다 agent의 작업·리뷰 실행기를 이름 댄다(`(work codex, review codex)`). agent를 다시 고르지는 않는다 | 실행기 준비 시험에 문구 확인 |
| 4: 이 기록과 보고서가 settle 구동이 공유 관문 다음이라고 했다 | 둘이 함께 시작한다고 고쳤다(한 번에 한 실행은 `othersActive`) | — |
| 5: 아무것도 확인하지 않는 확인 둘 | 잠긴 시험이 기록하는 git·gh를 실제로 받고 둘 다 불리지 않음을 본다. 상수 둘을 비교하던 `team-lifecycle` 시험은 지웠다 | — |
| 6: `host` 검사와 live→ready 변환에 시험이 없었다 | live→ready 변환을 `lifecycleView`(`office.ts`)로 꺼내 팀 서비스가 쓰고 시험한다. 서비스 시험은 숫자 `sshAuthSock`·없는 `host`를 `INVALID_HOST_CONFIG`로 거부하고, 글자 `sshAuthSock`은 받아 다음 단계(`NO_REPOS`)까지 가는지 본다 | `team-office` 잠긴·엔진 시험, `team-lifecycle` 서비스 시험 |
| 7: 실행기 탐색 공유는 엔진이 5초 안에 열릴 때만이었다 | 켜는 동안은 탐색 하나를 시간과 상관없이 다시 쓴다(`hold`) | 엔진 시험: 시계를 읽을 때마다 2초가 지나도 탐색 1번 |
| 8: 체크아웃 실패가 repo를 말하지 않았다 | `GIT_FAILED` 메시지에 repo 경로를 넣고, 사용 안내에 한계를 적었다(CLI가 내는 코드는 `FAILED`다: 최종 리뷰 Minor 5에서 문서를 고침) | `team-office` "a live start that cannot make a repo's checkout fails with GIT_FAILED naming that repo, …" |
| 9: `blockedBy`는 가져가기를 묻지 않는 동안 마지막 값이 남는다 | 고치지 않고 문서로 정했다: 마지막 가져가기 답의 열린 Task다. 사용 안내에 적었다 | — |
| 10: D34가 전부를 사용자 선택이라고 했다 | 사용자 선택(체크아웃, 검증 명령만 다시)과 계획 판정(`story/` 데이터, 가져가는 조건), ASSUMED(잠긴 Office)를 나눴다. Story 검사기 exit 0 | — |

- 새 시험은 고치기 전에 실패했다(6개: 도움말, 느린 시작의 두 번째 탐색, 실행기 이름 없음, `verified` 기록의 하트비트, 탐색 10번, repo 이름 없는 오류). 서비스 `host` 시험은 이미 있던 검사를 덮는 시험이라 처음부터 통과했다.
- 변이 확인(되돌림): 잠긴 Office가 `merging`에 하트비트, 가져가기마다 탐색, 가져갈 수 없을 때도 탐색, 켜는 동안 탐색 붙잡기 없음, 체크아웃 오류에 repo 없음, 실행기 이름 없음. 6개 모두 해당 시험이 실패했다.
- 자동 검사(리뷰 수정 1회 뒤, 2026-11-02): root `npm test` **1258/1258** exit 0(새 시험 4개, 지운 시험 1개), 팀 시험 **283/283**, `team-office`·`team-lifecycle` 34/34, 타입 검사 exit 0, Story 검사기 exit 0.

## 최종 리뷰 수정 (전체 브랜치)

리뷰어의 시험(probe) 4개를 저장소 시험으로 옮겨 고치기 전에 실패하는 것을 본 뒤 고쳤다. 판정은 컨트롤러가 정했다.

| 지적 | 고친 것 | 시험 |
|---|---|---|
| Important 1: 머지 단계가 Office가 검증하고 push한 head가 아니라 원격 Task 브랜치 끝을 머지했다. 검증 뒤 다른 사람이 push한 커밋(PR의 "Commit suggestion", 봇, 팀원)이 검사 0번으로 머지됐다(probe: `verifies 0`, 머지한 head가 그 커밋) | 기록에 Office가 push한 head(`team_claims.pushed_sha`, `building_since`와 같은 열 추가 방식)를 둔다. 빌드의 push 뒤, base 합친 head의 push 뒤(재검증 통과·실패 둘 다) 적는다. 머지 단계에서 가져온 Task 브랜치 끝이 그것과 다르면 시도를 실패로 센다(이유 `the Task branch moved outside the Office: <앞 12자>`). 다음 시도는 그 커밋이 있는 브랜치에서 엔진이 검증한다(`cee9ff8`) | `team-executor` "a commit pushed to the Task branch outside the Office after its verified push is never merged: …"(진짜 git), `team-store` "setPhase records the Task branch head the Office pushed …" |
| Important 2: 사람이 닫은 PR을 무시하고 새 PR을 열어 한 구동 안에 머지했다(probe: PR 2개 열고 새 #8 머지) | `pr.ts`의 찾기가 열린 PR도 머지된 PR도 없으면 가장 최근에 닫힌 PR을 돌려주고, 그 위에 새 PR을 열지 않는다. 빌드·머지 단계는 닫힌 PR을 사람의 멈춤으로 보고 시도로 세지 않고 바로 실패로 보고한다(이유 `PR #<N> was closed on GitHub; reopen it, then run team rerun`). 실패 보고가 머지 잠금도 푼다(`dec5c9c`) | `team-executor` "a PR a person closed is their stop: …"(다시 열고 `team rerun`하면 같은 PR로 머지), "a PR found closed when a later attempt hands its change over …", `team-pr` "ensurePr never opens a new PR over one closed without merging: …", findPr 시험 |
| Important 3: 재검증 중의 PL 취소·풀기를 `mergePr` 전에 보지 않았다. live 시작의 첫 구동 동안 하트비트가 기다려서 10분 뒤 보류로 보이고, 풀기는 머지 잠금도 풀어 같은 Story·repo의 다른 Task가 동시에 머지할 수 있었다(probe: Hub는 취소인데 PR 머지, 보고는 `NOT_YOURS`) | (a) `mergePr` 바로 전에 머지 잠금을 다시 묻는다(잡고 있으면 다시 준다). `NOT_YOURS`면 늦은 보고 길(머지된 PR만 보고), 그 밖의 거절·Hub 끊김은 이번 구동에서 머지하지 않는다. (b) 하트비트는 첫 구동을 기다리지 않는다. 첫 구동이 끝나기 전에는 하트비트 `NOT_YOURS`가 `verified`·`merging` 기록을 버리지 않고 claim마다 한 줄 남긴다(`keepOnNotYours`). 그 뒤는 예전 규칙이다(`d902128`) | `team-executor` "a PL cancel or release that lands while the merged base is checked again is honoured: …"(취소·풀기 둘 다, PR 머지 0), "a Hub that cannot answer the second merge lock ask …", `team-office` "with --live, the heartbeat does not wait for the first drive; …", "… once the first drive has settled, a heartbeat NOT_YOURS drops a merging record as before", `team-scheduler` "a heartbeat NOT_YOURS on a record keepOnNotYours holds …" |
| Important 4 (가장 무거움): Hub가 끝내 거절한 머지 보고가 끝없이 돌았다. 기록을 버리면 복구가 같은 claim을 다시 기록하고, 앞 엔진 작업을 이어받아 base 합친 체크아웃 위에 옛 후보를 다시 써서(base 변경을 되돌리는 커밋을 push할 수 있음) 또 거절됐다(probe: 3틱에 3번) | (a) Hub의 PR 주소 검사(`prUrlOf`)를 `story-protocol.ts`로 옮겨 Hub와 Office가 함께 쓴다. 기록은 Hub가 거절할 주소의 머지 보고를 받지 않고, 실행 상태 기계는 GitHub 주소가 그렇지 않으면 `https://<remote>/pull/<N>`으로 보고한다. 알려진 유일한 원인이 없어졌다. (b) 마지막 로컬 기록이 `HUB_REFUSED_REPORT`로 버려진 claim은 복구가 다시 가져오지 않는다(`store.refusedClaim`). 한 줄 남기고 `blockedBy`에 보이며 하트비트가 없어 Hub에서 10분 뒤 보류로 보인다. PL이 풀거나 취소한다. 하트비트의 머지 보고 다시 보내기가 끝내 거절되면(`STATE`·`INVALID`·`LOCK_REQUIRED`) 매 하트비트 로그만 남기던 것도 같은 출구로 끝난다(`1217710`) | `team-executor` "a merged report the Hub refuses for good is dropped once with its PR: …"(3틱에 다시 가져오기 0, push·제출·후보 적용 각 1번, 로그 1줄, 하트비트 없음, PL이 풀면 새 claim), "a PR address the Hub would refuse is never reported: …", `team-scheduler` "a merged resend refused for good …", "a claim whose report the Hub refused for good is not taken back: …", `team-store` "refusedClaim …", 보고 한도 시험의 주소 9개 |
| Minor 1: 엔진이 남긴 충돌 표시를 커밋이 거부하면 한 단계 실패로 세어 세 번이면 Task 실패였다 | `commitAll`의 거부를 `ConflictMarkers`(파일 목록 포함, 코드는 그대로 `GIT_FAILED`)로 내고, 실행 상태 기계가 그것을 시도 실패로 센다. 다음 시도의 `plan.md`에 충돌 파일이 들어간다(`c389101`) | `team-executor` "a verified change that still holds conflict markers costs an attempt, …"(진짜 git) |
| Minor 2: 머지됐는데 머지 커밋이 아직 없는 PR이 base 합치기·`mergePr`로 넘어가 세 번이면 머지된 PR이 실패로 보고됐다 | 기다림으로 본다(다음 구동에 다시, 세지 않음). 늦은 보고 길도 같은 줄을 남긴다 | `team-executor` "a PR GitHub shows merged but without its merge commit yet is waited for, …" |
| Minor 3: `- ASSUMED:`·`* ASSUMED:`·`**ASSUMED:**` 줄이 빠졌다 | 앞의 목록 표시와 굵게(`**ASSUMED:** x`, `**ASSUMED: x**`)를 떼고 Hub 모양 `ASSUMED: x`로 둔다. 50줄 × 500자 그대로. `ASSUMED(BLOCKING):`은 넣지 않았다(D35 후속) | `team-story-contract` "assumedLines also reads ASSUMED lines written as list items or in bold, …" |
| Minor 4: `startTaskBranch`의 보호가 아무 linked worktree나 받았다 | git이 알려 준 최상위 폴더(심볼릭 링크를 따른 실제 경로)의 이름이 `story-checkout`이어야 하고, 실행 상태 기계가 넘긴 등록 repo와 같으면 안 된다. 아니면 아무것도 바꾸지 않고 `GIT_FAILED`. 폴더 이름은 `branch.ts`의 `STORY_CHECKOUT` 하나를 `office.ts`도 쓴다 | `team-branch` "startTaskBranch refuses a person's repo that is itself a linked worktree, under any name, …"(이름이 다른 worktree, `story-checkout`이라는 이름의 등록 repo, `story-checkout` 심볼릭 링크) |
| Minor 5: 사용 안내가 체크아웃 실패 오류를 `GIT_FAILED`라고 했는데 CLI는 `FAILED`를 낸다 | **문서를 고쳤다(코드는 그대로).** 켜기 경로(팀 서비스 → CLI)가 오류 메시지만 넘기고, 이 경로는 lean Office와 함께 쓴다. 사용 안내와 이 문서의 한계에 CLI가 내는 JSON을 적었다 | — |
| Minor 6: PR 본문에 `ASSUMED:` 줄과 Hub 제목이 그대로 들어가 `@이름`이 알림을 보냈다 | Office가 쓰는 PR 제목·본문의 멘션 `@` 뒤에 U+200D를 넣는다. `dev@example.com` 같은 주소와 Hub 보고는 그대로다 | `team-executor` "mentions in the PR title and body the Office writes notify nobody; …" |
| Minor 7: 사용 안내에 전제 조건이 없었다 | 팀 Office 절에 적었다: repo가 머지 커밋을 허용해야 함(아니면 모든 Task가 머지 단계에서 실패), `checkout -B`가 같은 이름의 로컬 Task 브랜치를 강제로 옮기는 것(바뀌는 것과 안 바뀌는 것), 자기 폴더에서 그 Task 브랜치를 체크아웃해 두면 Task가 실패함 | — |

- 고치기 전 실패(RED): Important 1 시험 2개, Important 2 시험 4개(실행 상태 기계 2, `pr.ts` 2), Important 3 시험 3개(실행 상태 기계 2, Office 1: "timed out waiting: a heartbeat goes out while the first drive runs"), Important 4 시험 6개, Minor 1·2·3·4·6 시험 각 1개. probe 4개의 출력(고치기 전): "recovered 3 times", "creates 2 merges 1 … merged PR 8", "mergePr headSha = 다른 사람 커밋, verifies 0", "merges 1 … hub state cancelled".
- 바뀐 기존 시험: 닫힌 PR을 다시 쓰지 않는다던 `team-pr` 시험(뒤집힘), `- ASSUMED:` 줄이 빠진다던 `assumedLines` 시험, http 주소로 거절을 일으키던 실행 상태 기계 시험(이제 https 주소로 보고됨; 거절은 따로 만든 답으로 본다), 머지 잠금 요청 수 2 → 3(머지 직전 한 번 더), 첫 구동 전 하트비트 시험(첫 구동 중 하트비트로 다시 씀), Office 시험의 가짜 git(Task 브랜치 끝 = 마지막 push).
- 자동 검사(최종 리뷰 수정 뒤, 2026-11-02): root `npm test` **1275/1275** exit 0(새 시험 17개), 팀 시험 **300/300**, 타입 검사 exit 0, Story 검사기 exit 0. Hub Story 시험(`hub-story-*`)도 `prUrlOf`를 옮긴 뒤 통과했다.

## 실제 확인 계획

1차(정상 흐름: 2·3·4·8·9)는 2026-11-02–03에 했다. 결과와 찾은 것은 [실제 확인 기록](2026-11-03-team-story-task-mode-real-check.md)에 있다. 2차(5·6·7·10)는 아직이다.

사용자 확인 뒤에 한다. 공유 Hub, app-be(실제 데이터 폴더와 OpenShift Hub 연결이 있음), 회사 repo에는 쓰지 않는다. 그런 것이 필요하면 따로 묻는다.

1. **준비**
   - 이 Mac에서 로컬 Hub를 새로 띄운다(`pazmo-office hub --host 127.0.0.1 --port <포트>`, 2단계 실제 확인과 같은 방식).
   - GitHub에 시험 repo 두 개(be·fe 역할, bare가 아닌 원격)를 두고, 각 repo에 Story base `feature/story-<N>/base`를 손으로 만든다(Story base 만들기는 4단계). 검증 명령은 그 repo에서 몇 초 안에 끝나는 것으로 한다.
   - Hub에 프로젝트와 Story 하나(Task 3개, 의존 1개)를 Hub Story API로 올리고 연다(PL 쪽 올리기는 4단계).
   - `./office`로 VM·실행기를 한 번 준비해 둔다. 그 호스트에 `gh auth login`을 한다.
2. **켜기:** 두 repo를 `team add`·`hub-link`하고 `./office --team`. 확인: 30초 안에 켜짐(repo 두 개의 live 엔진, 실행기 탐색 하나), `status --team`의 `execution`이 `ready`, 체크아웃 두 개가 `git worktree list`에 보임, 등록한 repo 폴더의 HEAD·브랜치·`git status`가 그대로.
3. **한 Task 끝까지:** 가져가기 → `building`(VM에서 구현·리뷰·검증) → push → PR → 머지 잠금 → 머지 → 보고. 확인: Hub의 Task가 `merged`이고 PR 주소·머지 커밋·3줄 요약·`ASSUMED:` 판단 기록이 있음, 뒤 Task가 `ready`, 원격에 생긴 ref가 `feature/story-<N>/task-<M>`뿐, PR이 Story base로 머지 커밋으로 머지됨, 로그의 단계 줄.
4. **Task 5에서 미룬 `gh` 확인:**
   - `XDG_CONFIG_HOME`·`GH_CONFIG_DIR` 없이(HOME·PATH·LANG·`GH_PROMPT_DISABLED`만) `gh`가 그 사람의 로그인을 찾는지. 설정을 다른 곳에 둔 사람은 실패할 수 있다.
   - Office의 작업 폴더(repo가 아닌 팀 데이터 폴더)에서 `gh pr create -R <host>/<owner>/<repo>`가 되는지.
   - `gh pr view`의 `mergeCommit`이 `{oid}` 모양인지(머지 직후와 다시 읽을 때). 같은 head 이름의 포크 PR이 목록에 섞이는지.
5. **실패 길:** 같은 파일을 만지는 Task 두 개로 base 충돌 → 다음 시도가 충돌 표시를 풂, base가 바뀐 뒤 재검증 실패 → 시도 수 증가, 보호 브랜치 등으로 push 거부 세 번 → `failed` 보고 → `status --team`의 `blockedBy`와 `team status`의 `phase: failed` → `team rerun --memo`로 다시 실행.
6. **멈추고 다시 켜기:** push 뒤, PR 뒤, 머지 뒤 보고 전에 각각 `stop --team`(엔진 실행 중이면 `TASK_ACTIVE`)하고 `./office --team`. 같은 PR을 두 번 열거나 두 번 머지하지 않는지. 머지 뒤 보고 전에 PL이 풀었으면 늦은 머지 보고가 Hub에 닿는지.
7. **사람 환경:** ssh origin(`git@…`)의 push가 `SSH_AUTH_SOCK`으로 되는지. `commit.gpgsign`이 켜진 repo에서 안내대로 실패 이유가 보이는지.
8. **잠긴 시작:** `start --team`(`--live` 없음)이 아무것도 가져가지 않고 체크아웃을 만들지 않는지, 열린 기록이 있으면 하트비트만 보내는지, `merging` 기록에는 하트비트를 보내지 않고 다음 `--live` 시작이 그 머지를 보고하는지.
9. **실행기 확인 횟수:** 할 일 없는 live 팀 Office의 로그와 프로세스 목록에서 codex·claude 실행이 5분에 한 번 정도인지.
10. **최종 리뷰 수정의 실제 확인:**
    - 열린 PR에서 "Commit suggestion"을 반영한 뒤 머지 단계: 머지하지 않고 시도를 실패로 세는지(`the Task branch moved outside the Office`), 다음 시도가 그 커밋 위에서 검증하고 머지하는지.
    - 열린 PR을 머지하지 않고 닫기: 새 PR이 열리지 않고 Task가 바로 실패로 보고되는지, PR을 다시 열고 `team rerun`하면 같은 PR로 머지되는지.
    - base를 합친 뒤 재검증 중에 PL이 취소(또는 보류된 Task를 풀기): PR이 머지되지 않는지, 하트비트가 기록을 닫는지.
    - 머지 커밋을 허용하지 않는 repo: 머지 단계 세 번 실패 뒤 실패 보고와 그 이유(`gh`의 문구)가 보이는지.

## 확인하지 않은 것

- 위 실제 확인 전부: 진짜 GitHub(Enterprise 포함)의 `gh`, 실제 VM에서의 Story Task, 여러 live 엔진의 시작 시간, ssh agent push, 커밋 서명.
- PL의 여러 repo planning, Story G1 화면, Story base 만들기, Story 검증·Story G4(4단계). 화면(5단계).
- 다른 PC, 회사 IT·보안 정책.

## 알려진 한계 (리뷰가 미룬 것 포함)

- **Hub가 끝내 거절한 보고:** 기록을 `HUB_REFUSED_REPORT`로 버리고 그 claim을 다시 가져오지 않는다. Hub가 나중에 그 보고를 받게 되더라도 PL이 풀고 다시 실행해야 한다. 그동안 `blockedBy`의 `repoName`은 다음 가져가기 답까지 `null`이다. 이 수정 전의 빌드가 Hub가 거절할 주소로 써 둔 보고는 이제 읽을 수 없는 보고(`INVALID`)로 보인다(이 브랜치는 아직 배포하지 않았다).
- **Task 브랜치에 다른 사람이 push한 커밋:** 그때마다 시도 하나를 쓴다(세 번이면 Task 실패).
- **닫힌 PR:** GitHub가 브랜치 삭제로 닫은 PR도 사람의 멈춤으로 보아 다시 열 때까지 Task가 실패로 남는다.
- **첫 구동 동안의 취소:** live 시작의 첫 구동이 끝나기 전에 PL이 취소한 `verified`·`merging` 기록은 그 구동이 끝날 때까지 남는다(머지는 하지 않는다).
- **머지 커밋이 없는 머지된 PR:** GitHub가 머지 커밋을 끝내 주지 않으면 머지 잠금을 쥔 채 기다린다(세지 않음). PL이 취소하면 끝난다.
- `--live` 없이 켠 팀 Office는 열린 기록을 진행하지 않는다(ASSUMED, D34). `verified`·`merging` 기록은 하트비트가 끊겨 Hub에서 10분 뒤 보류로 보인다.
- `--live`로 켤 때 체크아웃을 만들지 못하면(예: 커밋이 하나도 없는 repo) 팀 Office 전체가 켜지지 않는다. CLI는 `{"code":"FAILED","error":"The Story checkout of <repo 경로> could not be made: …"}`를 낸다(팀 Office 안의 코드 `GIT_FAILED`는 켜기 경로가 넘기지 않는다). 사용 안내에도 적었다.
- 실행기가 준비돼 있다고 본 뒤 300000 ms 안에 로그아웃하면 그동안 가져간 Task는 엔진 실행에서 실행기 오류로 멈춘다(시도 하나로 센다).
- `blockedBy`는 마지막으로 Hub에 가져가기를 물었을 때의 답이다. 묻지 않는 동안에는 그 값이 남는다(사용 안내에 적음).
- 충돌 뒤 재시작한 시도는 충돌 파일 목록 없이 시작한다.
- `freezeProject`가 만든 체크아웃 전체 스냅샷은 지우지 않고 쌓인다. 검증 도중 Office가 죽으면 그 컨테이너가 남을 수 있다.
- 판단 기록은 Engineer 마지막 메시지에서 `ASSUMED:`로 시작하는 줄(앞의 `- `·`* ` 목록 표시와 `**` 굵게는 뗌)만 모은다. `ASSUMED(BLOCKING):` 줄은 아직 빠진다(D35 후속).
- 세 번째 실패는 보고와 단계를 두 번에 나눠 쓴다(그 사이에 멈춰도 다음 시작이 보고를 보낸다).
