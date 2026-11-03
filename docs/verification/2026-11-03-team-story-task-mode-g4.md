# 2026-11-03 팀 Story 보드 3단계 (Story Task 모드) G4

Story: M16 · V18 · D24 · D34. 검증 기록: [2026-11-02-team-story-task-mode.md](2026-11-02-team-story-task-mode.md). 실제 확인: [2026-11-03-team-story-task-mode-real-check.md](2026-11-03-team-story-task-mode-real-check.md). 결정: [team-story-board-decision.md](../understanding/team-story-board-decision.md)의 5·6장, 실패 처리 표, 구현 단계 3. PR syjkim0125/pazmo-agent-office#59. kit graph: `.ai-workflow/runs/U29-team-story-task-mode-merge.json`(상태 `g4`).

## 질문과 답 (2026-11-03)

컨트롤러는 먼저 설명 페이지("3단계 Story Task G4")를 보였다. 그 페이지에는 다음이 있다.

- Task 하나가 지나가는 길
- 지키는 규칙 다섯
- 실패할 때의 동작 표
- 확인한 것과 못 본 것
- G4 세 질문
- 선택지 셋(① 승인 후 머지, ② 2차 실제 확인 뒤 머지, ③ 고칠 것 요청)과 각각의 비용·되돌리기·지금 정하는 이유

사용자는 세 질문에 직접 답하지 않고 선택지를 골랐다.

> ① 승인 후 머지

아래 답은 컨트롤러가 설명 페이지의 내용으로 썼다. 사용자는 이 답을 기록 전에 보지 않았다(#51·#53과 같은 방식).

1. 동작:
   - Task를 가져가는 조건: `./office --team`이나 `start --team --live`로 켰고, 모든 repo 엔진의 실행기가 준비됐고, 열린 기록이 없다. 그러면 팀 Office가 Hub에서 이 사람에게 줄 ready Story Task 하나를 가져간다.
   - VM 안: repo의 Office 전용 체크아웃에서 구현 → 리뷰 → 검증을 한다.
   - VM 밖(그 사람의 git·`gh`): Task 브랜치를 push하고 Story base로 PR을 연다. Hub 머지 잠금을 잡고 최신 base를 합친다(바뀌었으면 검증 명령만 다시 돈다). 그다음 PR을 머지 커밋으로 머지하고, Hub에 PR 주소·머지 커밋·3줄 요약·`ASSUMED:` 판단 기록을 보고한다.
   - 사람이 하는 일은 켜 두기, 실패 보고된 Task를 `team rerun --memo`로 다시 실행하기, `status --team` 보기다. `--live` 없이 켜면 아무것도 가져가지 않는다.
2. 규칙과 실패 경로:
   - 지키는 규칙:
     - 등록한 repo 폴더(작업 트리·HEAD·브랜치·커밋 안 한 변경)는 바뀌지 않는다.
     - 원격 쓰기는 `feature/story-<N>/task-<M>` push(강제 없음)와 그 PR을 Story base로 머지하는 것뿐이다.
     - Office가 검사하고 push한 head만 머지한다.
     - 어느 단계 사이에서 꺼져도 PR·머지·보고는 한 번씩이다.
     - 모든 기록에 출구가 있다.
   - 실패 경로:
     - 충돌, 재검증 실패, 엔진 멈춤, 90분 초과, 남의 커밋은 시도를 하나씩 쓴다. 3번을 넘으면 Hub에 실패로 보고한다.
     - 한 단계가 3번 연속 실패하거나 사람이 PR을 닫으면 바로 실패로 보고한다.
     - PL이 취소하거나 풀면 머지하지 않고 엔진을 멈춘다.
     - Hub가 끊긴 동안의 보고는 쌓아 두었다가 다시 보낸다. Hub가 끝내 거절한 보고의 claim은 다시 가져오지 않고 PL에게 맡긴다.
3. 증거와 한계:
   - 자동 검사(`e69f0c6`): `npm test` 1276/1276 exit 0, 타입 검사 exit 0, Story 검사기 exit 0. git은 진짜(로컬·bare repo)로, `gh`·VM은 가짜로 시험했다.
   - 리뷰: Task별 독립 리뷰와 재리뷰에서 Critical 1개·Important 10개를 고쳤다. 최종 전체 브랜치 리뷰의 Important 4개(재현 시험 있음)도 고쳤고, 재리뷰를 통과했다.
   - 실제 확인 1차: 로컬 Hub, GitHub private repo 두 개, VM, claude로 Task 3개가 머지·보고까지 갔다. repo 폴더는 그대로였고, 원격에는 Task 브랜치만 생겼다. 멈췄다 다시 켜면 이어 갔고, 잠긴 시작은 가져가지 않았다. 찾은 요약 버그는 이 PR에서 고쳤다.
   - 확인하지 못한 것:
     - 실제 확인 2차(충돌, 단계 사이 끄기, ssh·서명, "Commit suggestion", 닫은 PR, 재검증 중 취소, 머지 커밋을 막은 repo)
     - 사용 한도에 걸린 실행기가 시도를 낭비하는 문제(머지 뒤 별도 작업)
     - 회사 GitHub Enterprise, 다른 사람 PC

선택: ① 승인 후 머지.

## 평가

Story, diff, 시험, 실제 확인 기록과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. 위 순서는 `src/team/executor.ts`(단계 `claimed`→`building`→`verified`→`merging`→`reporting`), `src/team/office.ts`(`canExecute`, 구동), M16·V18·D34, 실제 확인 1차의 로그·PR과 같다. 다만 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 규칙 다섯과 실패 경로는 `branch.ts`(`pushTaskBranch`, `linkedWorktree`), `pr.ts`(Story 일치, `--match-head-commit`), executor의 `pushedSha`·`holdLock`·`prClosed`·`failAttempt`, scheduler의 `recover`·`refusedClaim`, 그리고 각 시험·리뷰 기록과 맞다. |
| 증거 범위 | 1차 실제 확인까지는 충분하다. 2차 실제 확인과 사용 한도 처리는 하지 않았다고 따로 적었다. STATUS는 3단계를 시험 단계로 두고 팀원에게 쓰라고 안내하지 않는다. |
| 선택 | 승인 후 머지. |

남는 한계: 사용자는 세 질문에 직접 답하지 않았다. 설명 페이지를 본 뒤 ①을 골랐다. 이 기록은 사용자가 그 내용을 보고 머지를 맡겼다는 사실을 보여 준다. 사용자가 스스로 설명할 수 있다는 증거는 아니다. 실제 확인 2차는 머지 뒤, 팀원에게 쓰라고 안내하기 전에 한다.
