# 2026-11-11 Hub 화면 다듬기 G4 (D43, U40)

Story: D41·D42·D43 · M16 · V20 (Story 해시 `4a8560c1…`, G1 2026-11-11 D43 고침). 브랜치 `claude/hub-design-polish-c216f1`, 기준 main `a72a57b`, HEAD `0d3baab`. PR syjkim0125/pazmo-agent-office#83.

- **kit run:** `.ai-workflow/runs/U40-two-boards.json`(runId `810dc421…`, snapshot `388be3f5…`). 시도는 implement 3번, workflow-review 3번, workflow-verify 2번이다. 앞 실행 `.ai-workflow/runs/U40-hub-polish.json`(Story가 D43으로 바뀌기 전, implement 1번·review 1번)은 증거로 남겼다.
- **변경 기록:** [2026-11-11-hub-polish.md](../../docs/verification/2026-11-11-hub-polish.md)

## 보인 증거

- **시험:** 새 화면·주소·고침마다 실패하는 시험부터(RED 15/73, 22/126, 8/65, 2/37). 전체 `npm test`는 리뷰 2차 고침 뒤 1859/1859, 3차 고침 뒤 부하 18–22에서 1860/1861(바뀌지 않은 올리기 시험의 `ECONNRESET`, 그 파일만은 5/5 다섯 번).
- **kit verify(`0d3baab`):** 579/579 + 618/618 + 664/664 = **1861/1861**, 타입 검사·Story 검사 exit 0([기록](../runs/U40-two-boards-verify-2.md)). 1차 시도는 바뀌지 않은 `tests/runtime-state.test.mjs`가 부하 12–31에서 1개 흔들렸다([기록](../runs/U40-two-boards-verify-1.md)).
- **리뷰:** 얼굴 단계 1차(리뷰어 둘, Important 3) → [U40-review-1](../runs/U40-review-1.md); 두 보드 1차(둘, Important 1) → [review-1](../runs/U40-two-boards-review-1.md); 2차(하나, Minor 3) → [review-2](../runs/U40-two-boards-review-2.md); 3차(하나, Ready) → [review-3](../runs/U40-two-boards-review-3.md).
- **미리보기:** 확인용 허브(`127.0.0.1:18444`)는 건드리지 않고 그 DB의 `VACUUM INTO` 복사본과 시험 데이터로, 이 코드와 바뀌기 전 코드를 다른 포트에 띄워 Chromium으로 22개 화면 × 390·900·1000·1360px × 두 테마를 쟀다(넘침 0).

## 질문과 답 (2026-11-11)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS (3판) 맨 위에 "마지막 확인(G4) · 머지 전에"를 올렸다: 바뀐 양, 새 화면 캡처, 확인한 것과 못 한 것, G4 세 질문, 선택지 셋(승인 후 머지, 직접 보고 정하기, 고칠 것 있음)과 되돌리기. 대화에서도 같은 증거와 세 질문을 보였다. 질문은 "G4: 어느 쪽으로 할까요?"였다. 사용자는 세 질문에 직접 답하지 않고 이렇게 골랐다(D13).

  > 승인 후 머지

- 아래 요점은 컨트롤러가 정리한 것이다.

1. **동작:** 허브의 첫 화면은 Story 단계 칸(기획 중·진행 중·Story 검증·승인 대기·완료)의 Story 보드이고, Story를 누르면 그 Story의 Task 보드, `/tasks`에 모든 Task가 있다. 모든 화면이 차분한 신호등 모양(네 상태 색을 글자와 함께, 이름 동그라미, Mac 점, 44px)이고, 맨 위에 나를 기다리는 일이 모인다.
2. **규칙과 실패 경로:** 버튼이 하는 일·권한·승인의 해시와 revision·CSRF·Origin·POST 뒤 다시 읽기는 그대로이고 새 주소는 `/tasks` 하나다. 모든 값은 이스케이프되고, 스크립트 없이도 모든 버튼이 동작하며, 10초 업데이트는 쓰는 중이면 쉰다. 옛 주소는 모두 열린다.
3. **증거의 경계:** 자동 시험 1861개, 리뷰 세 차례, Chromium 화면 측정까지다. Safari·Firefox, 실제 브라우저의 저절로 업데이트, 사내 Hub 재배포와 실제 팀원의 화면은 확인하지 않았다.

선택: 승인 후 머지. 컨트롤러는 G4를 기록하고, STATUS를 쓴 전달 커밋을 push한 뒤 PR을 main에 머지한다.
