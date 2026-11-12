# 2026-11-12 Hub 화면 다듬기의 남은 것 세 가지 G4 (U41)

Story: D43 · M16 · V20 (Story 해시 `4a8560c1…`, 바꾸지 않음). 브랜치 `claude/agitated-matsumoto-1b5bed`, 기준 main `a3ef064`, HEAD `a635bcc`. PR syjkim0125/pazmo-agent-office#84.

- **kit run:** `.ai-workflow/runs/U41-hub-polish-leftovers.json`(runId `c02ed9b9…`, snapshot `568c7a36…`). 시도는 implement 2번, workflow-review 2번, workflow-verify 1번이다.
- **변경 기록:** [2026-11-11-hub-polish-leftovers.md](../../docs/verification/2026-11-11-hub-polish-leftovers.md)

## 보인 증거

- **시험:** 고치기 전에 실패하는 시험부터(RED 3/68, 리뷰 1차 고침 RED 2/68), GREEN 68/68, Hub 시험 파일 전부 559/559.
- **kit verify(`a635bcc`):** 580/580 + 618/618 + 664/664 = **1862/1862**, 타입 검사·Story 검사 exit 0([기록](../runs/U41-hub-polish-leftovers-verify-1.md)).
- **리뷰:** 1차(리뷰어 하나, Ready, Minor 4) → [review-1](../runs/U41-hub-polish-leftovers-review-1.md), 넷 다 고침; 2차(같은 리뷰어, Ready, 지적 0) → [review-2](../runs/U41-hub-polish-leftovers-review-2.md).
- **미리보기:** 확인용 허브(`127.0.0.1:18444`)는 건드리지 않고 그 DB의 `VACUUM INTO` 복사본과 시험 데이터로, 이 코드와 바뀌기 전 코드를 다른 포트에 띄워 Chromium으로 41개 화면 × 10가지 너비 × 두 테마를 쟀다(넘침 0).

## 질문과 답 (2026-11-12)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS (5판) 맨 위에 "마지막 확인(G4) · U41 · 머지 전에"를 올렸다: 세 가지 고침의 전후 캡처, 바뀐 양, 확인한 것과 못 한 것·남긴 것, G4 세 질문, 선택지 셋(승인 후 머지, 직접 보고 정하기, 고칠 것 있음)과 되돌리기. 대화에서도 같은 증거와 세 질문을 보였다. 질문은 "G4: how should U41 (PR #84) go?"였다. 사용자는 세 질문에 직접 답하지 않고 이렇게 골랐다(D13).

  > 승인 후 머지

- 아래 요점은 컨트롤러가 정리한 것이다.

1. **동작:** Story 보드의 단계 칸은 860px보다 넓은 창에서 언제나 한 줄이고, 861–960px에서는 여백을 줄여 가장 긴 카드 글자도 한 줄이다. Story 상태 글자는 "검증 중"이다. 취소한 Story와 열리기 전 Story의 숫자가 카드·Story 화면·`/tasks` 줄에서 같다.
2. **규칙과 실패 경로:** 주소·버튼이 하는 일·권한·승인 확인·CSRF·스크립트 없이 쓰기는 그대로이고, 모든 값은 이스케이프된다. 폰에서 가로 스크롤이 없다. 글꼴이 7px 넘게 넓으면 861px 근처에서 긴 글자가 다시 두 줄이 될 수 있지만 넘치지는 않는다.
3. **증거의 경계:** 자동 시험 1862개, 리뷰 두 차례, Chromium 화면 측정까지다. Safari·Firefox·Windows 글꼴은 확인하지 않았고, Task 카드 글자 두 줄과 취소된 Story의 글자 색 차이는 남겼다.

선택: 승인 후 머지. 컨트롤러는 G4를 기록하고, STATUS를 쓴 전달 커밋을 push한 뒤 PR을 main에 머지한다.
