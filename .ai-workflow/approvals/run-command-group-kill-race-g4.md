# 2026-11-03 프로세스 그룹 kill 경합 G4 (PR #67)

Story: M3·M4(멈춘 실행기가 끝난 것처럼 보이지 않고 실제로 멈춤)와 M16(팀 Office의 `gh` 로그인 확인). PR syjkim0125/pazmo-agent-office#67.

- 커밋: `c6c67e4`·`6ab8aa2`·`a963036`(수정), `44a19b6`(시험), `9e3dfa8`(kit 기록), `70b8ff3`(학습 문서), `3dfbd2d`(main `e8380d9` 합치기), `91a4b8c`(main `1047da4`, #65 합치기), `0e57363`(G1 다시 받기).
- kit graph: kit 4.1.0 run `.ai-workflow/runs/run-command-group-kill-race.json`과 `run-command-group-kill-race-merge.json`(main #62–#66 뒤)이 있다. 둘 다 kit 5가 들어온 뒤 읽기 전용이 됐다. 최종 run은 kit 5 v3 `.ai-workflow/runs/run-command-group-kill-race-v3.json`이다(`delivered`).
- 학습 문서: [macos-fork-escapes-one-shot-process-group-sigkill.md](../../docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md).

## 보인 증거

- diff(main 대비): `src/runners/command.ts` +15 −1, `tests/command.test.mjs` +37, 학습 문서 +88, kit 기록 9개.
- 원인 근거(macOS 26.2, Node 24.19.0):
  - 부하만 걸었을 때: 0/813과 0/30.
  - kill을 fork 순간에 맞춘 probe: 122/10000 느림. 모두 그 그룹에 자식이 살아남아 있었다.
  - 시험과 같은 형태를 `runCommand`로 돌림: 고치기 전 22/2000, 고친 뒤 0/10000.
  - 원래 5206 ms 실패와의 연결은 시간이 맞는다는 데서 한 추론이다(그 실행의 오류 문자열이 남지 않음).
- 시험:
  - 새 시험 2개가 고치기 전 코드와 중간 수정 두 버전에서 먼저 실패했다(각 3/3회). 최종 코드에서는 6/6을 3번 연속 통과했다.
  - 관련 시험 20개 파일 337/337.
  - 합치기 전 최종 트리(`44a19b6`)의 전체 `npm test` 1278/1278 exit 0. 타입 검사·Story 검사기 exit 0.
- 리뷰: 독립 리뷰 세 번(Critical 0). 1차 Important 1, 2차 머지 가능(Minor 4), 3차 Important 1. 모두 고쳤고, 3차 수정(시험만)은 다시 리뷰받지 않았다. [리뷰 기록](../runs/run-command-group-kill-race-review-1.md)

## 질문과 답 (2026-11-03)

컨트롤러는 먼저 설명 페이지("그룹 kill 경합 G4")를 보였다. 그 페이지에는 다음이 있다.

- 고치기 전·뒤의 타임라인 그림(SIGKILL 한 번 → 살아남은 자식이 5초 동안 파이프를 쥠 / 20 ms마다 다시 kill → 그룹이 비면 멈춤)
- 파이프를 쥔 자식과 쥐지 않은 자식의 두 경우
- 근거 숫자
- 지키는 것 셋과 실패할 때의 동작
- 시험이 버전마다 실패·통과한 표
- 확인한 것과 못 본 것, diff 통계
- G4 세 질문
- 선택지 셋(① 승인 후 머지, ② 나머지 세 곳과 함께 머지, ③ 고칠 것 요청)과 각각의 비용·되돌리기·지금 정하는 이유

사용자는 세 질문에 직접 답하지 않고 선택지를 골랐다(메모 없음).

> ① 승인 후 머지 (Recommended)

아래 답은 컨트롤러가 설명 페이지의 내용으로 썼다. 사용자는 이 답을 기록 전에 보지 않았다(#51·#53·#59·#62·#66과 같은 방식).

1. 동작: 시간 초과·취소·출력 한도로 명령을 멈출 때, 첫 그룹 SIGKILL 뒤에도 20 ms마다 그룹을 다시 kill한다. 결과를 돌려준 뒤에도 계속한다. 그래서 그 순간 막 fork되던 자식도 다음 kill에 죽는다.
   - 파이프를 쥔 자식 때문에 5초 기다린 뒤 `CLI_CLOSE_UNCONFIRMED`로 끝나던 결과는 이제 바로 `TIMEOUT`이다.
   - 파이프를 쥐지 않은 자식이 `TIMEOUT` 뒤에서 계속 돌던 일도 없어진다.
2. 규칙과 실패 경로:
   - 멈춘 명령의 그룹에는 아무도 남지 않는다. 보통 결과 뒤 한 번 더(약 20–40 ms) kill하면 그룹이 빈다.
   - 다시 kill하기는 kill이 처음 실패하면 멈춘다. 그룹이 사라졌거나, macOS에서 회수 전 리더만 남은 EPERM인 경우다. 어떤 경우에도 250번(약 5초)이 상한이다.
   - kill이 성공하는 동안은 그룹이 있으므로 번호 재사용으로 남의 프로세스를 죽이지 않는다.
   - 죽지 않는 프로세스가 있으면 짧은 CLI가 최대 약 5초 더 기다리고, 예전처럼 `CLI_CLOSE_UNCONFIRMED`로 알린다. 첫 kill이 실패할 때의 `:KILL_FAILED`는 바뀌지 않았다.
3. 증거와 한계:
   - fork 경합 시험 2개가 고치기 전 코드와 중간 수정 두 버전에서 먼저 실패했고 지금 통과한다. 원래 형태의 표본은 22/2000에서 0/10000이 됐다.
   - 확인하지 못한 것:
     - 원래 5.2초 실패가 이 경합이었다는 직접 증거(추론).
     - Linux 동작.
     - 실제 codex·claude·gh를 fork 중에 멈춘 확인.
     - 같은 한 번짜리 kill이 남은 `exec-relay.ts`·`claude-controller.ts`·`runner-models.ts`. 별도 세션이 작업 중이다.

선택: ① 승인 후 머지.

## 선택 뒤에 한 일

1. 첫 번째 합치기. `docs/STATUS.md` 충돌 없이 머지하려고 main `e8380d9`(#62–#66)를 합쳤다(`3dfbd2d`, 충돌 없음).
   - main의 Story 변경(D37·D38) 때문에 첫 run의 명령은 더 쓸 수 없게 됐다. 그래서 kit 4.1.0 `-merge` run을 이었다.
   - 합친 트리의 `npm test`는 1296/1296 exit 0이었다.
2. 두 번째 합치기. 그사이 main에 #65(kit 5)가 머지돼 STATUS가 다시 충돌했다. main `1047da4`를 합치고(`91a4b8c`), STATUS는 양쪽 항목을 모두 살렸다.
   - kit 5에서는 main을 합친 브랜치의 kit 4.1.0 run이 읽기 전용이 된다. 새 v3 run은 지금 Story에 묶인 G1이 있어야 시작된다.
   - 마지막 G1 뒤로 Story에 바뀐 것은 D37(#66)뿐이었다.
3. G1. 컨트롤러는 같은 설명 페이지의 2판에 "지금 정할 것"을 더해 보였다. 선택지는 A(G1 다시 승인 → v3 run → G4 묶기 → 머지), B(kit 4 기록으로 머지), C(보류)였다.
   - 사용자의 답: "A. G1 승인 후 진행 (Recommended)".
   - 컨트롤러가 그 답으로 `.ai-workflow/approvals/pazmo-agent-office-g1.json`을 새로 썼다(`0e57363`). D36·D37·D38이 든 Story에 묶인다.
4. v3 run `run-command-group-kill-race-v3.json`.
   - implement: 코드는 `44a19b6`과 같다.
   - review: 세 번의 독립 리뷰가 그대로 유효하다. 두 합치기는 컨트롤러가 스스로 검토했고 독립 리뷰는 아니다. 지적은 없었다.
   - workflow-verify: kit 검사 다섯 개. 시험은 434/434 + 447/447 + 424/424 = **1305/1305**이고, 타입 검사와 Story 검사는 exit 0이었다. snapshot은 검사 전후가 같았다.
5. G4.
   - 사용자가 고른 ①을 v3 run의 snapshot(`064b3a28…`, HEAD `0e57363`)에 묶었다: `.ai-workflow/approvals/run-command-group-kill-race-g4.json`.
   - 사용자가 ①을 고를 때 본 트리는 main을 합치기 전이었다. 코드는 같다.
   - 결과: `check.mjs story` exit 0, `gate G4` exit 0, `graph.mjs delivery` exit 0(`delivered`).

## 평가

Story, diff, 시험, 리뷰 기록과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. `src/runners/command.ts:74-98`(`stop`의 첫 kill과 반복 timer)과 두 시험(`tests/command.test.mjs:65`, `:70`)의 기대값과 같다. 다만 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 그룹이 비는 것은 두 번째 시험(`ps -o pgid=` 확인)으로 봤다. 상한·EPERM·unref 없음은 리뷰 2·3차의 측정(239회 상한, EPERM 확인, 결과 뒤 18–37 ms에 ESRCH)으로 확인했다. |
| 증거 범위 | macOS의 자동 시험과 표본 측정까지는 충분하다. 원래 실패와의 연결, Linux, 실제 CLI, 남은 세 곳은 하지 않았다고 따로 적었다. |
| 선택 | 승인 후 머지. |
