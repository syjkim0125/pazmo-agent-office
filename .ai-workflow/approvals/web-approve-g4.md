# 2026-11-20 웹 결과 승인 G4 (U56, D49·V20)

- Story: 2026-11-19에 D49와 V20 문장을 더했고, 같은 날 프롬프트에 Playwright 줄을 더했습니다. G1 답은 "맞아, 진행해"와 "D49 끝내고 다음 묶음", Story 해시는 `31be3d3a…`입니다.
- 브랜치 `web-approve`, 기준 main `d256fc6`, HEAD `26931c0`.
- 코드 커밋: `3f57ad0`, `d1d94e0`, `ac1cb5c`.
- **kit run:** `.ai-workflow/runs/U56-web-approve.json`
  - runId `6037030d…`, snapshot `cf4a0ea4…`
  - 시도 횟수: implement 3번, workflow-review 3번, workflow-verify 2번.
- **변경 기록:** [2026-11-20-web-approve.md](../../docs/verification/2026-11-20-web-approve.md)

## 보인 증거

- **시험**
  - 구현 1차: RED 137/147, GREEN 151/151, 전체 2044/2044.
  - 구현 2차: RED 43/51, GREEN 215/215, 전체 2046/2046.
  - 구현 3차: RED 49/54, GREEN 234/234, 전체 2049/2049(부하 80–116 때의 한 번은 손대지 않은 7개 파일이 시간 초과, 그 파일만 다시 141/141).
- **kit verify(`26931c0`):** 2차에 738/738 + 608/608 + 703/703 = **2049/2049**, 타입 검사와 Story 검사 exit 0. 1차는 손대지 않은 `team-registry` 정지 시험 1개가 부하 끝자락에 실패해(607/608) 다시 했습니다. [기록](../runs/U56-web-approve-verify-2.md)
- **리뷰:** 같은 독립 리뷰어가 세 번 봤습니다.
  - [1차](../runs/U56-web-approve-review-1.md): 아직 아님. Important 2개.
    - 웹 승인에 진 `team finish` 기록이 남아, PR이 닫힌 뒤 묻지 않고 다시 승인될 수 있음.
    - 실행 방법이 PL의 레포 폴더를 그 커밋으로 바꿔, 커밋하지 않은 수정이 섞인 채 검사될 수 있음.
  - [2차](../runs/U56-web-approve-review-2.md): Important 1개. 확인 폴더 받기가 실패해도 다음 줄이 이어져, 옛 커밋이나 PL의 폴더에서 검사됨.
  - [3차](../runs/U56-web-approve-review-3.md): 검증 가능. Minor 3개는 한계로 기록했습니다.
- **직접 확인:** 확인용 허브 사본(18576)에서 했습니다. 18444는 건드리지 않았습니다. 사용자가 "#1로 끝까지"로 테스트 레포 be·fe main 머지를 허락했습니다.
  - 다시 검증 → VM 검증 통과 → 결과 승인 칸(복사 단추가 화면의 프롬프트를 그대로 복사, 스크립트 없으면 단추 숨김) → 웹 승인 "웹 승인 · PL" → 완료.
  - [fe PR #2](https://github.com/syjkim0125/pazmo-story-test-fe/pull/2): head는 검증한 `bed598e4…`.
  - [be PR #5](https://github.com/syjkim0125/pazmo-story-test-be/pull/5): head는 be main을 합친 `2d761eab…`(부모 `34aa2e9c…` 검증 커밋, `95ec0bf6…` be main). D48대로 합친 뒤 VM에서 다시 검사하고 머지.
  - [기록](../runs/U56-web-approve-hands-on-1.txt)

## 질문과 답 (2026-11-20)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS 47판에 직접 확인 범위를, 48판에 U56 G4 상자와 직접 확인 그림 다섯 장을 올렸습니다.
- 질문은 "D49 웹 결과 승인을 G4로 승인하고 머지할까요?"였고, 사용자의 답은 다음과 같습니다(D13).

  > 승인 후 머지

- **요점(컨트롤러 정리)**
  - **동작:** PL은 Story 화면의 결과 승인 칸에서 검사 결과·바뀐 코드·AI가 정한 것·QA 목록을 보고, 필요하면 옆 폴더에서 직접 실행하거나 프롬프트를 AI에 붙여 넣어 확인한 뒤, 웹 단추로 승인합니다. 그 뒤 머지는 D48 그대로 PL Office가 합니다.
  - **지킬 것:**
    - 승인은 화면이 보인 Story 지문과 검증 커밋에 묶이고, PL만 할 수 있습니다. 깨지면 `approveOnWeb`의 STALE·FORBIDDEN 시험과 웹 경로 시험이 실패합니다.
    - 실행 방법은 PL의 레포 폴더를 바꾸지 않고, 확인 폴더 받기가 실패하면 검사를 돌리지 않습니다.
    - 웹 승인과 `team finish` 중 먼저 온 것이 쓰이고, 진 기록은 치워 둡니다.
  - **증거의 경계:**
    - 자동 시험과 사본 허브에서 한 번 해 본 웹 승인·실제 머지.
    - 실제 사내 허브와 여러 사람의 Mac, 실제 브라우저(헤드리스 아닌)는 아직 확인하지 않았습니다.

선택: 승인 후 머지.
