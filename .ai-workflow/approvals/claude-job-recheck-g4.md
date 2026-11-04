# 2026-11-04 claude 역할 실행마다 실행 직전 재확인 G4 (D40, U35)

Story: D40 · M16 · V18 (D29·D39 후속). 브랜치 `claude/great-ritchie-b80adf`, 기준 main `534a769`(#73까지 포함), HEAD `2d4d921`. PR syjkim0125/pazmo-agent-office#74.

- **kit run:**
  - 커밋된 트리: `.ai-workflow/runs/U35-claude-job-recheck-committed.json`(runId `bc3aaa84…`, 최소 계획). 시도는 implement 2번, workflow-review 2번, workflow-verify 1번이다.
  - 첫 실행 `.ai-workflow/runs/U35-claude-job-recheck.json`(runId `32eb3174…`)은 커밋 전 트리에서 g4까지 갔다. 커밋으로 스냅샷(git HEAD 포함)이 바뀌어 stale이 되었다. 시도는 implement 3번, review 3번, verify 1번이다.
- **변경 기록:** [2026-11-04-claude-job-recheck.md](../../docs/verification/2026-11-04-claude-job-recheck.md)
- **G1:** Story 해시 `1b507999…`이고, 2026-11-04에 새로 기록했다(사용자 "B + D40 승인"). V18 구절은 ASSUMED이다.

## 보인 증거

- **시험:**
  - 새 시험 7개는 고치기 전에 모두 실패했다(runner-jobs 17/20, lean-office 51/54, 취소 시험 1개). 고친 시험은 1개다.
  - 변이 6개와 리뷰어 변이를 잡았다.
  - 관련 시험 파일 10개는 222/222다.
- **kit verify(커밋된 트리):** 448/448 + 449/449 + 436/436 = **1333/1333**, 타입 검사·Story 검사 exit 0. [기록](../runs/U35-committed-verify-1.md)
- **리뷰:** 다섯 번 모두 머지 가능이었다(Critical·Important 0).
  - 첫 실행: [1차](../runs/U35-review-1.md) Minor 6, [2차](../runs/U35-review-2.md) Minor 2, [3차](../runs/U35-review-3.md) Minor 2
  - 커밋된 트리: [1차](../runs/U35-committed-review-1.md) Minor 2, [2차](../runs/U35-committed-review-2.md) Minor 1
  - 마지막 Minor(검증 기록의 한 문장이 바뀐 줄을 다 적지 않음)는 이 전달 커밋에서 고쳤다. kit 리뷰·검증 밖이다.

## 질문과 답 (2026-11-04)

- 사용자가 먼저 썼다.

  > 피드백 보고 승인할게. 머지도해

- 컨트롤러는 그 뒤 설명 페이지 "U35 claude 재확인 G4"(https://claude.ai/artifact/JNQ7TJWq2EYYsfwaXQr5eo, 2판)를 만들어 보였다. 페이지에는 다음이 있다.
  - 바뀐 것(전·후)
  - G4 세 질문과 그 요점
  - 증거와 확인하지 못한 것
  - ASSUMED V18 구절
  - 선택지 둘(① 피드백 확인 후 승인·머지, ② 고칠 것 요청)과 되돌리기·지금 정하는 이유
- 질문은 "피드백을 확인하셨으면 승인하고 머지할까요?"였다. 사용자는 세 질문에 직접 답하지 않고 이렇게 답했다(D13).

  > 피드백 확인 후 승인·머지

- 아래 요점은 컨트롤러가 설명 페이지에 쓴 것이다.

1. **동작:**
   - claude를 고른 역할 실행(pm·lead·engineer·reviewer, G4 평가)은 실행마다 시작 직전에 실행기를 새로 확인한다.
   - 작업 도중 hook이 생기면, 화면이 봤든 아무도 안 봤든 다음 claude 실행은 `RUNNER_NOT_READY claude`로 거절된다. 팀 Office는 D39처럼 기다린다.
   - 비용은 claude 역할 실행마다 탐색 한 번이다. codex는 그대로다.
2. **규칙과 실패 경로:**
   - hook이 걸린 claude는 프로세스를 띄우기 전에 거절한다(D29).
   - 조회가 실패하면 D29·U34 그대로다. 탐색 전체가 실패하면 마지막 사본으로 판단한다.
   - 다시 확인하는 동안 취소되면 자격 검사 없이 `CANCELLED`로 끝난다.
3. **증거와 한계:**
   - 자동 시험·변이·리뷰 다섯 번·kit 전체 검증까지다. 실제 claude로는 재현하지 않았다.
   - 탐색 뒤나 실행 도중의 hook은 실행 중 감시가 맡는다.
   - lean의 진행 중 탐색 공유와 팀 Office의 탐색 재사용(5초, 켜는 동안)은 틈으로 남는다.
   - 탐색은 취소 신호를 받지 않는다.

선택: ① 피드백 확인 후 승인·머지. 컨트롤러는 G4를 기록하고, 전달 커밋을 push한 뒤 PR #74를 머지한다. 페이지가 보인 ASSUMED V18 구절도 받아들인 것으로 기록한다.
