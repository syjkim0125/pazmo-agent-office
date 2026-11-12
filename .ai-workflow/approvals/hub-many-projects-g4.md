# 2026-11-12 일이 많아질 때의 보드 G4 (U43)

Story: D44 · M16 · V20 (Story 해시 `edf0cb7a…`, G1 2026-11-12). 브랜치 `claude/hub-many-projects`, 기준 main `1fe9292`, HEAD `03c2f97`. PR syjkim0125/pazmo-agent-office#86.

- **kit run:** `.ai-workflow/runs/U43-hub-many-projects.json`(runId `d16972a8…`, snapshot `f4f23d02…`). 시도는 implement 3번, workflow-review 3번, workflow-verify 2번(1번째는 셸 기본 Node 22로 돌아 이유를 적고 다시 함)이다.
- **변경 기록:** [2026-11-12-hub-many-projects.md](../../docs/verification/2026-11-12-hub-many-projects.md)

## 보인 증거

- **시험:** 고치기 전에 실패하는 시험부터(RED 6/42, 리뷰 1차 고침 RED 3/42, 리뷰 2차 고침 RED 1/42), GREEN 42/42, Hub 시험 파일 전부 563/563.
- **kit verify(`03c2f97`):** 576/576 + 636/636 + 655/655 = **1867/1867**, 타입 검사·Story 검사 exit 0([기록](../runs/U43-hub-many-projects-verify-1.md)).
- **리뷰:** 1차(리뷰어 하나, Ready, Important 1·Minor 6) → [review-1](../runs/U43-hub-many-projects-review-1.md); 2차(같은 리뷰어, 머지 불가, Important 1) → [review-2](../runs/U43-hub-many-projects-review-2.md); 3차(Ready, Minor 1 남김) → [review-3](../runs/U43-hub-many-projects-review-3.md).
- **미리보기:** 확인용 허브(`127.0.0.1:18444`)는 건드리지 않고 그 DB의 `VACUUM INTO` 복사본과 프로젝트 8개짜리 시험 데이터로, 이 코드와 바뀌기 전 코드를 다른 포트에 띄워 Chromium으로 쟀다(120가지 화면 넘침 0, 칩 표시 테두리 16.46·13.47:1).

## 질문과 답 (2026-11-12)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS (6판) 맨 위에 "마지막 확인(G4) · U43 · 머지 전에"를 올렸다: 세 가지 바뀐 것과 폰의 전후 캡처, Story에 따로 적지 않은 새 프로젝트 뒤 이동, 바뀐 양, 확인한 것(틀렸다가 바로잡은 대비 숫자 포함)과 못 한 것·남긴 것, G4 세 질문, 선택지 셋(승인 후 머지, 직접 보고 정하기, 고칠 것 있음)과 되돌리기. 대화에서도 같은 증거를 보였다. 질문은 "G4: approve this change and merge it?"였다. 사용자는 세 질문에 직접 답하지 않고 이렇게 골랐다(D13).

  > Approve and merge

- 아래 요점은 컨트롤러가 정리한 것이다.

1. **동작:** 나를 기다리는 일은 아무것도 숨기지 않고 같은 상태 글자끼리 한 줄(개수, 공통 설명 한 번, 제목 단추)로 묶이며 멈춘 것이 먼저다. 프로젝트가 둘 이상이면 두 보드에 프로젝트 칩이 있고, 칩은 그 프로젝트만 보이며 거르개와 탭을 건너 유지된다. 전체에서 보이는 Story가 없는 프로젝트는 맨 아래 한 줄이다. 새 프로젝트를 만들면 그 프로젝트의 칩 보기로 간다.
2. **규칙과 실패 경로:** 나를 기다리는 일은 어느 칩을 골라도 모든 프로젝트의 것이다. 모르는 프로젝트 id는 전체로 보이고 주소에 다시 실리지 않는다. 주소의 id는 Hub의 것만 URL 인코딩해 넣고 이름은 이스케이프한다. 버튼·권한·승인 확인·CSRF·스크립트 없이 쓰기·저절로 업데이트는 그대로다. 칩 표시는 모양과 칩 글자색 테두리로 구분된다.
3. **증거의 경계:** 자동 시험 1867개, 리뷰 세 차례, Chromium 화면 측정까지다. Safari·Firefox, 실제 화면 낭독기, 브라우저에서 저절로 업데이트 뒤 칩 유지는 확인하지 않았다. 폰에서 칩 줄이 묶음으로 아낀 높이를 거의 다 쓴다.

선택: 승인 후 머지. 컨트롤러는 G4를 기록하고, STATUS를 쓴 전달 커밋을 push한 뒤 PR을 main에 머지한다.
