# 2026-11-12 Hub 다시 디자인 "나 결정 카드" PR 2: 두 보드 G4 (U46, D41·V20)

Story는 바꾸지 않았다(D41 범위, D42 메뉴·D43 첫 화면과 카드 항목·D44 기다리는 일·U41 넓은 화면 한 줄 그대로). 방향은 사용자가 설명 페이지 7판에서 고른 "나 결정 카드"이고, 사용자의 "PR 2 시작"으로 시작했다. 남은 일을 넷으로 나눴다(① U45 공통 틀 ② 이것 ③ Story·Task 화면과 내 할 일 ④ Story 만들기 흐름). 브랜치 `worktree-hub-na-boards`, 기준 main `c6b7ca7`, HEAD `d39c036`.

- **kit run:** `.ai-workflow/runs/U46-hub-boards.json`(runId `cf5c65a0…`, snapshot `6dd34f7c…`, 작은 변경의 기본 계획). 시도는 implement 2번(처음, 리뷰 1차 고침), workflow-review 2번, workflow-verify 1번이다.
- **변경 기록:** [2026-11-12-hub-boards.md](../../docs/verification/2026-11-12-hub-boards.md), 학습 문서 [count-elements-drawn-past-the-edge-when-overflow-is-clipped.md](../../docs/solutions/ui-bugs/count-elements-drawn-past-the-edge-when-overflow-is-clipped.md)

## 보인 증거

- **시험:** RED 9/83 → GREEN 98/98, 리뷰 고침 RED 2/6 → GREEN 130/130, Hub 시험 파일 43개 600/600, 타입 검사 exit 0.
- **kit verify(`d39c036`):** 641/641 + 586/586 + 677/677 = **1904/1904**, 타입 검사·Story 검사 exit 0. [기록](../runs/U46-hub-boards-verify-1.md)
- **리뷰:** [1차](../runs/U46-hub-boards-review-1.md) 독립 리뷰어 하나, Ready(Minor 6: /tasks 기획 색 시험 없음, 멈춘 카드의 "아래 이유를", 안 보이는 개수 칩, 기획 화면 색, 낡은 문구, 어두운 카드 테두리) → 넷 고침, 기획 화면 색은 PR 4, 테두리는 남김. [2차](../runs/U46-hub-boards-review-2.md) 같은 리뷰어, Ready(문서 Minor: 내 할 일의 "아래 이유를"을 PR 3으로 적기, 점검표 줄 길이).
- **측정:** 확인용 허브(18444)는 건드리지 않고 그 DB 복사본과 시험 데이터로 5화면 × 7폭 × 두 테마 = 70번, 접힘을 연 채: 가로 넘침·화면 끝 넘음·작은 누름 대상·860px보다 넓은 창에서 두 줄로 나뉜 단계 모두 0.

## 질문과 답 (2026-11-12)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS (12판, 라벨 "9판: U46 G4 (나 PR 2 두 보드)") 맨 위에 G4 상자를 올렸다. 전후 캡처(Story 보드 1360, 다른 사람이 본 보드, 폰 390), 바뀐 것, 검사, 확인하지 못한 것(Safari·Firefox, 실제 화면 낭독기, 기획 화면 색은 PR 4, 내 할 일 문구는 PR 3, 어두운 카드 테두리, 폰의 긴 기다리는 일), G4 세 질문, 선택지(승인 후 머지, 직접 보고 정하기, 고칠 것 있음)가 있다.
- 대화에서도 같은 증거와 세 질문을 보였다. 질문은 "U46 G4: which option?"이었다. 사용자는 세 질문에 직접 답하지 않고 이렇게 골랐다(D13).

  > 승인 후 머지

- 요점(컨트롤러 정리): 동작은 화면 모양과 보드 문구뿐(기다리는 일 줄 목록·두 칸, 보드의 실패 문구, 카드 윗줄 없음, 기획 카드 정리와 보는 사람별 색, 빈 단계 띠, 제목 중복 없앰). 지킬 것은 D43 카드 항목, D44 묶음·순서·개수·모든 프로젝트, 넓은 화면 단계 한 줄, 주소·거르개·칩·권한 그대로이고, 깨지면 U46·U44·U43·U41 시험이 실패한다. 증거의 경계는 macOS Chromium 측정과 자동 시험까지.

선택: 승인 후 머지.
