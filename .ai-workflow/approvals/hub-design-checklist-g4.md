# 2026-11-12 허브 디자인 체크리스트 적용 G4 (U44, D41·V20)

Story는 바꾸지 않았다(화면 모양과 문구는 D41이 만드는 사람에게 맡긴 범위). 브랜치 `feat/hub-design-checklist`, 기준 main `247b310`, HEAD `3848f40`.

- **kit run:** `.ai-workflow/runs/U44-hub-design-checklist.json`(runId `187277bd…`, snapshot `fcffee0e…`, 작은 변경의 기본 계획). 시도는 implement 2번, workflow-review 2번, workflow-verify 1번이다.
- **변경 기록:** [2026-11-12-hub-design-checklist.md](../../docs/verification/2026-11-12-hub-design-checklist.md), 체크리스트 문서 [hub-design-checklist.md](../../docs/solutions/conventions/hub-design-checklist.md)

## 보인 증거

- **시험:** 구현 뒤 전체 `npm test` 1884/1884, 리뷰 1차 고침 뒤 1889/1889. 각 항목을 실패하는 시험부터 썼다(RED 11/88, 고침 RED 6/94).
- **kit verify(`3848f40`):** 626/626 + 586/586 + 677/677 = **1889/1889**, 타입 검사·Story 검사 exit 0. [기록](../runs/U44-verify-1.md)
- **리뷰:** [1차](../runs/U44-review-1.md) 리뷰어 하나, Ready with fixes, Critical·Important 0, Minor 8 → 모두 고침. [2차](../runs/U44-review-2.md) 같은 리뷰어, Ready, 새 Critical·Important 0.
- **측정:** 확인용 허브 데이터의 복사본과 긴 이름·제목 데이터로 화면마다 840번씩 재어 가로 넘침 240 → 0, 컨트롤 32px(마우스)·44×44px(터치) 미만 0(문장 속 글자 링크 제외), 묶음 간격 2배 규칙 충족.

## 질문과 답 (2026-11-12)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/GJBHwuZJSNs9xqUJDPQKAR (8판) 맨 위에 "G4 · U44"를 올렸다. 전후 캡처 3쌍(폰 320px 보드, /me 640px, 다크 1360px 보드), 바뀐 것, 검사, 확인하지 못한 것(Safari·Firefox, 실제 브라우저 확대, 실제 브라우저의 저절로 업데이트, 구현이 고른 다크 아바타 색), G4 세 질문, 선택지(① 승인 후 머지, ② 고칠 것)가 있다.
- 대화에서도 같은 증거와 세 질문을 보였다. 질문은 "U44 G4: 어느 선택지로 할까요?"였다. 사용자는 세 질문에 직접 답하지 않고 이렇게 골랐다(D13).

  > ① 승인 후 머지

- 요점(컨트롤러 정리): 동작은 화면 모양뿐(토큰 색, 넘침 막기, 누르는 곳, 빈 칸 안내, 강조 절제, 줄바꿈, 간격, 일주일 넘으면 서울 날짜, 숫자 폭). 지킬 것은 주소·버튼·권한·승인 확인·스크립트 없이 쓰기 그대로, 깨지면 디자인 불변 시험이 실패한다. 증거의 경계는 macOS Chromium 측정과 자동 시험까지.

선택: ① 승인 후 머지.
