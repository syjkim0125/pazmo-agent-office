# 2026-11-03 그룹 kill 후속 G4 (relay·claude 실행·모델 조회)

Story: M3·M4(멈춘 실행기가 끝난 것처럼 보이지 않고 실제로 멈춤). #67(`runCommand`)의 후속이다. 브랜치 `claude/runner-group-kill-race`.

- 커밋:
  - `d46cfba` 수정
  - `dfb171d` 시험
  - `d05d554` 문서
  - 리뷰 2차의 문서 수정과 kit 기록은 이 G4 뒤의 전달 커밋에 들어간다.
- kit graph:
  - kit 4.1.0 run `.ai-workflow/runs/runner-group-kill-race.json`(구현·리뷰 1차)은 main #65(kit 5)를 합친 뒤 읽기 전용이 됐다.
  - 최종 run은 kit 5 v3 `.ai-workflow/runs/runner-group-kill-race-v3.json`이다.
- 학습 문서: [macos-fork-escapes-one-shot-process-group-sigkill.md](../../docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md).
- 이어받음: 처음 세션은 리뷰 2차 도중 계정 사용 한도에 걸려 멈췄다. 다른 계정의 두 번째 세션이 같은 worktree에서 리뷰 2차부터 이어서 했다.

## 보인 증거

- **diff(main `4a6d6ed` 대비):** 코드 4개 파일(`command.ts`, `exec-relay.ts`, `claude-controller.ts`, `runner-models.ts`), 시험 5개 파일, 학습 문서, STATUS.
- **시험:**
  - 경로마다 fork 경합 시험 하나를 더했다. 셋 다 고치기 전 코드에서 먼저 실패했다(구현자 3/3, 리뷰어 재확인).
  - 타이머를 unref로 바꾸는 변이는 relay·claude 역할 시험이 잡았다.
- **리뷰:**
  - 독립 리뷰 1차는 With fixes였다(Important 1, Minor 2).
  - 2차는 새 리뷰어가 맡았고 With fixes였다(Critical·Important 0, 문서 Minor 3).
  - 고친 문서만 본 리뷰는 STATUS 문구 Minor 2건을 짚었다. 이 2건은 전달 커밋에서 고쳤다.
  - 기록: [1차](../runs/runner-group-kill-race-review-1.md), [2차](../runs/runner-group-kill-race-v3-review-1.md), [문서 재확인](../runs/runner-group-kill-race-v3-review-2.md)
- **kit verify:**
  - 시험 436/436 + 448/448 + 424/424 = **1308/1308**.
  - 타입 검사·Story 검사 exit 0.
  - snapshot `eb64ec53…`. [verify 기록](../runs/runner-group-kill-race-v3-verify-1.md)

## 질문과 답 (2026-11-03)

컨트롤러는 먼저 설명 페이지 "그룹 kill 후속 G4"(https://claude.ai/artifact/1UAfG94c4BVErALtVwJjrH, 1판)를 보였다. 그 페이지에는 다음이 있다.
- 고치기 전과 뒤의 타임라인 그림
- 네 곳의 멈춤과 첫 kill 오류 처리 표
- 지키는 규칙 여섯 가지
- 시험 표, 전체 검증, 리뷰
- 확인하지 않은 것
- G4 세 질문
- 선택지 셋(① 승인 후 머지, ② 실제 확인 뒤 머지, ③ 고칠 것 요청)과 각각의 비용·되돌리기·지금 정하는 이유

D39의 설명 페이지도 함께 보였다. 사용자는 세 질문에 직접 답하지 않고 두 변경의 선택지를 한 번에 골랐다.

> 둘 다 ① 승인 후 머지

아래 답은 컨트롤러가 설명 페이지의 내용으로 썼다. 사용자는 기록 전에 이 답을 보지 않았다(#67과 같은 방식).

1. **동작:** relay를 닫거나 claude 역할 실행·모델 조회를 SIGKILL로 멈출 때, 첫 그룹 SIGKILL 뒤에도 20 ms마다 그룹을 다시 kill한다. 그래서 그 순간 fork되던 자식도 다음 kill에 죽는다. SIGTERM의 순서와 횟수는 그대로다.
2. **규칙과 실패 경로:**
   - 반복은 첫 kill이 성공한 뒤에만, SIGKILL에만 한다. kill이 처음 실패하거나(ESRCH, macOS의 EPERM) 250번이 되면 멈춘다.
   - 각 곳의 첫 kill 오류 처리는 바뀌지 않았다.
   - kill이 성공하는 동안은 그룹이 있으므로 번호 재사용으로 남의 프로세스를 죽이지 않는다.
   - `exec-relay.ts`·`claude-controller.ts`가 `BOUNDARY_DIGEST`에 들어 있어, 업데이트 뒤 첫 역할 실행 전에 실행기 자격 검사가 한 번 다시 돈다.
3. **증거와 한계:**
   - macOS에서 가짜 CLI로 한 fork 경합 시험, 리뷰어 측정, kit 전체 검증까지다.
   - 확인하지 못한 것: Linux, 실제 claude·codex를 fork 중에 멈춘 확인, SIGTERM 순간의 같은 경합(SIGTERM은 여전히 한 번).

선택: ① 승인 후 머지.
