# 2026-11-19 PL Office의 자동 Story 검증 G4 (U54, D47 4a·V20)

- Story: 2026-11-18에 D47과 V20 문장을 더하고 G1을 받았다. G1에서 사용자가 "맞아, 진행해"라고 답했고, Story 해시는 `3717e8f4…`다.
- 브랜치는 `bundle4-design`, 기준 main은 `1ccc3a2`, HEAD는 `e122556`이다.
- 코드 커밋은 `453f5ba`, `d4e515d`, `3bdf926`, `3138815`이다.
- **kit run:** `.ai-workflow/runs/U54-story-check.json`
  - runId `3a73ed48…`, snapshot `b31ce680…`
  - 시도 횟수는 implement 3번, workflow-review 3번, workflow-verify 1번이다.
- **변경 기록:** [2026-11-19-story-check.md](../../docs/verification/2026-11-19-story-check.md)

## 보인 증거

- **시험**
  - **구현 1차:** RED는 5개 중 4개였다. 전체는 1976/1976이었다.
  - **구현 2차:** RED는 10개 중 6개였다. 전체는 1985/1985였다.
  - **구현 3차:** RED는 22개 중 3개였다. 전체는 1988/1988이었다.
  - 1차에는 실제 TLS 시험 허브까지 이어지는 시험이 있다. PL의 자동으로 일하기가 꺼진 상태에서 Story가 awaiting_g4로 가는지 본다.
- **kit verify(`e122556`):** 597/597 + 676/676 + 715/715 = **1988/1988**이다. 타입 검사와 Story 검사는 exit 0이다. [기록](../runs/U54-story-check-verify-1.md)
- **리뷰:** 같은 독립 리뷰어가 세 번 봤다.
  - [1차](../runs/U54-story-check-review-1.md)
    - Important 1건: gh 로그인이 풀린 레포를 "등록되지 않은 레포"로 보고해 Story를 실패시킬 수 있었다.
    - Minor 8건: 보고를 다시 보낼 때 VM을 다시 돌림, 짧은 네트워크 끊김, 커밋 전체 값, 멈춤 상태에서 이어 하기, Story base 번호, URL 비밀번호, 빠진 시험, Mac 두 대.
  - [2차](../runs/U54-story-check-review-2.md): Minor 7건이었다. 하나는 받을 수 없는 base가 있을 때 다른 레포의 VM을 다시 돌리는 것이고, 다른 하나는 INVALID일 때 다시 검사하는 것이다.
  - [3차](../runs/U54-story-check-review-3.md): 검증 가능이었다. 남은 Minor는 두 가지다.
    - R1: INVALID 로그 문구가 사실과 다르다. 지금 허브에서는 일어날 수 없다.
    - R2: 실패 횟수를 claim마다 센다. 적힌 동작이다.
- **직접 확인(확인용 허브의 사본, 18444는 건드리지 않음)**
  - 최종 코드로 새 사본에서 PL Office를 live로 띄웠다. 누르는 일 없이 #7 검증을 가져갔다.
  - VM에서 V1–V5가 통과했고, #7은 awaiting_g4가 됐다. 요약의 커밋은 `0b3ee093deb1ebd5a44b3ec16570543c07e00ff9`다. [기록](../runs/U54-story-check-hands-on-2.txt)
  - #1은 사본 Office에 fe가 없어서 레포 이름과 이유를 단 실패로 보고됐다.
  - Story 화면을 1360폭과 390폭으로 봤다. 가로 넘침은 0이었다.

## 질문과 답 (2026-11-19)

- 컨트롤러는 설명 페이지 https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS (37판, 라벨 "U54 G4") 맨 위에 G4 상자를 올렸다. 상자에는 다음을 실었다.
  - 사본 허브의 Story #7(넓은 화면, 폰)과 #1의 그림
  - 동작 설명
  - 검사 결과
  - 새 ASSUMED(멈춤이어도 이미 가진 검증은 이어 함)
  - 확인하지 못한 것과 남긴 것(AI 리뷰, 4b, Mac 두 대, INVALID 로그 문구)
  - 선택지
- 묶음 4 설계 상자는 지난 결정으로 접었다.
- 질문은 "Record G4 for U54, open the PR and merge?"였고, 사용자의 답은 다음과 같다(D13).

  > 승인 후 머지

- **요점(컨트롤러 정리)**
  - **동작:** PL의 Office가 자동으로 일하기와 상관없이 Story 검증을 가져간다. 레포마다 최신 Story base를 VM에서 검사하고, 통과·실패와 레포·커밋·결과 요약을 보고한다.
  - **지킬 것**
    - 사람의 레포 폴더는 건드리지 않는다. Office 전용 체크아웃만 쓰고, 그 Story의 base만 받는다.
    - 남의 claim에는 보고하지 않는다. 풀거나 취소하면 VM을 끊고 보고하지 않는다.
    - 짧은 네트워크 끊김은 실패가 아니다. 3번 이상, 10분 넘게 실패해야 실패로 본다.
    - 이것들이 깨지면 team-story-check·team-office·team-branch 시험이 실패한다.
  - **증거의 경계**
    - 자동 시험이 있다.
    - 사본 허브에서 최종 코드로 한 번 실제로 돌렸다.
    - 확인용 허브(18444)에서 실제로 돌리는 것은 머지 뒤 다시 띄울 때다.
    - AI 리뷰와 4b는 아직이다.

선택: 승인 후 머지.
