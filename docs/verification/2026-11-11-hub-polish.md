# 검증 기록: Hub 화면 다듬기 (차분한 신호등)

Story: D41·D42 · M16 · V20. D41이 만드는 사람에게 맡긴 "웹 화면의 모양과 문구"와 D42 (4)의 사람 말·네 가지 상태 색 안에서 한 변경이라 Story는 바꾸지 않았다(새 결정 번호 없음). kit 실행은 `.ai-workflow/runs/U40-hub-polish.json`(작은 변경의 기본 계획), 사용 안내는 [LOCAL-PREVIEW.md의 "칸반 보드와 로컬 올리기"](../LOCAL-PREVIEW.md#칸반-보드와-로컬-올리기)이다.

이 기록은 kit 증거가 아니라 변경 기록이다. kit 리뷰 전에 끝냈고 그 뒤 고치지 않는다.

## 왜, 무엇을 골랐나

사용자는 D42 보드가 아직 밋밋하다며 "다섯 살도 바로 쓸 만큼" 쉽고 예쁘게 바꾸자고 했다. 세 방향(A 차분한 신호등, B 그림책, C 촘촘한 작업판)을 지금 화면 위에 씌운 시안으로 [설명 페이지](https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS)에 보였고, 사용자가 **A 차분한 신호등**을 골랐다(2026-11-11).

- 디자인 스킬: Anthropic 스킬 저장소의 `frontend-design`. 같은 저장소의 `theme-factory`는 웹 글꼴을 쓰는 슬라이드·문서용 테마라 맞지 않았다(Hub CSP가 `default-src 'none'`이라 웹 글꼴·이미지를 못 쓴다). 캡처는 `webapp-testing` 방식(Playwright)으로 했다.
- 조사(2026-11)에서 가져온 규칙: 상태는 연한 바탕에 진한 글자와 점, 색만으로 전하지 않음, 빨강은 멈춤에만(GOV.UK Tag, Atlassian Lozenge, Fluent 2 Badge). 끝난 일은 조용히(GOV.UK Complete multiple tasks). 카드 덧붙임은 셋까지와 칸에 머문 시간(Jira Customize cards). 나를 기다리는 일은 제목 아래 상자 하나(GOV.UK Notification banner). 누르는 곳 44px(WCAG 2.2 SC 2.5.8, Apple HIG). 한글 본문 16px·줄 간격 1.6(KRDS). 빈 곳에는 다음 할 일(NN/g, Primer empty states). 테두리를 줄인 차분한 화면(Linear 2026-03), 반투명 효과 쓰지 않음(NN/g Liquid Glass).

## 바뀐 것

모양과 글자만 바꿨다. 주소, 각 버튼이 하는 일, 권한, 승인의 해시·revision 확인, CSRF·Origin 확인, POST 뒤 다시 읽기, 스크립트(`/copy.js`·`/live.js`)는 그대로다. 모든 값은 지금처럼 `esc()`를 거친다.

- **스타일(`src/hub/pages.ts`의 `STYLE`)**: 옅은 회색 바탕과 흰 판, 테두리 대신 그림자, 네 상태 색(답해 주세요 주황·진행 중 파랑·멈춤 빨강·끝남 초록)의 연한 바탕·진한 글자·띠 색을 밝은·어두운 테마 모두 정했다. 본문 16px/1.6, 단어 단위 줄바꿈, 버튼·입력 칸 44px, 3px 포커스 테두리, `prefers-reduced-motion`이면 움직임 없음. 웹 글꼴·이미지 없이 시스템 한글 글꼴만 쓴다.
- **머리글**: 이름은 링크 `Pazmo 팀 허브`(보드로), 메뉴는 지금 보는 쪽에 `aria-current="page"`(Story·Task·기획 화면은 보드 쪽), 내 이름 앞 이름 동그라미, 자동으로 일하기는 스위치 모양(글자 그대로), 내 Mac은 점과 글자(초록 일하는 중·대기 중, 주황 쉬는 중·잠김, 빈 점 꺼짐·연결 없음).
- **보드(`src/hub/board-pages.ts`)**: 맨 위 **나를 기다리는 일**(내가 PL인 Story의 결과 승인 대기, 내가 맡았거나 내 Story의 멈춘 Task, 내 웹 기획의 질문·초안·설계 승인. 보드가 이미 가진 정보만 쓰고 링크만 있다). Story 줄 머리에 이름 동그라미와 "N개 중 M개 끝" 막대(`<progress>`, 화면 읽기에는 글자만). 카드는 왼쪽 상태 띠와 상태 색 이름, 제목 링크(카드 전체가 눌린다), 맡은 사람·Mac 점·머문 시간, 멈춘 이유는 붉은 상자, 번호·레포는 아래 작은 줄. 빈 칸은 "비어 있음"(CSS)이고 폰에서는 한 줄로 접힌다. 빈 프로젝트는 다음에 할 일을 말한다. 새 Story·새 프로젝트는 버튼 모양.
- **팀**: 사람마다 이름 동그라미, Mac 점, 자동으로 일하기 켜짐(초록)·꺼짐. 폰에서는 줄마다 한 덩어리(`data-label`). "더 보기"는 큰 타일 목록.
- **Task·Story·기획 화면**: 멈춘 이유를 붉은 상자(`callout`)에 넣고, 메모·다시 시도 같은 할 일 폼을 연한 판으로 묶었다. 내 할 일의 목록은 카드처럼.

## 시험

- **RED**: 새 시험 7개와 좁게 고친 기대값을 먼저 넣고 돌린 `hub-board-page`·`hub-story-pages`·`hub-mac-pages`는 73개 중 15개가 새 마크업이 없어 실패했다.
- **GREEN**: 구현 뒤 세 파일 73/73. Hub 시험 파일 전부를 돌려 카드 링크 기대값 하나(`hub-upload-office`)를 더 고쳤다. 전체 `npm test` **1848/1848**(exit 0, 183초, 이전 1841 + 새 시험 7). `npm run typecheck` exit 0.
- 새 시험(`tests/hub-board-page.test.mjs` 끝): 카드의 상태 색·이름 동그라미·Mac 점·머문 시간·번호, 나를 기다리는 일(PL·맡은 사람·관계없는 사람·내 Story만에서도), Story 줄의 진행 막대, 지금 메뉴 표시, 머리글의 스위치·Mac 점과 글자(상태 다섯 가지의 색), 빈 프로젝트 안내 두 가지, 스타일의 바닥선(어두운 테마·포커스·44px·`overflow-wrap:anywhere`·움직임 줄이기·`url(` 없음).
- 좁게 고친 기대값과 이유(모두 같은 사실을 새 마크업으로 확인한다):
  - `hub-board-page` 팀 화면: 이름 칸이 이름 동그라미를, 켜짐/꺼짐이 `onoff` 글자를 쓴다.
  - `hub-story-pages`: 꺼진 스위치 글자 앞에 `track`이 생겼다. 팀 화면의 다른 화면 링크가 " · " 줄에서 타일 목록이 됐다. Story 줄 머리가 `story-title`과 이름 동그라미를 쓴다.
  - `hub-mac-pages`: 머리글 Mac 표시가 `pill`에서 점 달린 `macchip`이 됐다(색 클래스는 `hub-board-page`가 본다).
  - `hub-plan-pages`: 새 프로젝트·새 Story 링크가 `btn ghost` 버튼 모양이 됐고, 기획 중 카드가 카드 모양(상태 이름, PL 이름 동그라미)이 됐다.
  - `hub-upload-office`: 카드 제목 링크에서 번호가 아래 작은 줄로 옮겨졌다.

## 미리보기와 캡처

사용자가 흐름을 확인 중인 확인용 허브(`https://127.0.0.1:18444`, 데이터 `~/Documents/pazmo-midcheck/b3/`)는 멈추지도 쓰지도 않았다. 그 DB를 읽기 전용 연결의 `VACUUM INTO`로 복사해 이 worktree 코드와 바뀌기 전 코드(`git archive HEAD`)를 각각 다른 포트에서 띄웠다([Preview new web code on real data with a copy](../solutions/workflow-issues/real-check-mac-paired-features-on-a-router-mode-hub.md)). 실데이터는 Story 하나뿐이라, 모든 칸 상태가 들어간 시험 데이터(가짜 이름 지은·민준·서연·도현, `app-be`·`app-fe`)도 따로 만들었다. 두 데이터 모두 Chromium(Playwright)으로 1360px·390px, 밝은·어두운 테마를 찍었고 어느 화면도 가로로 넘치지 않았다(`scrollWidth` 확인).

| 화면 | 전 | 후 |
|---|---|---|
| 보드 · 데스크톱 · 밝은 | ![전](2026-11-11-hub-polish/before-board-desktop-light.jpg) | ![후](2026-11-11-hub-polish/after-board-desktop-light.jpg) |
| 보드 · 폰 · 어두운 | ![전](2026-11-11-hub-polish/before-board-phone-dark.jpg) | ![후](2026-11-11-hub-polish/after-board-phone-dark.jpg) |
| 멈춘 Task · 폰 · 밝은 | ![전](2026-11-11-hub-polish/before-task-failed-phone-light.jpg) | ![후](2026-11-11-hub-polish/after-task-failed-phone-light.jpg) |
| 팀 · 데스크톱 · 어두운 | ![전](2026-11-11-hub-polish/before-team-desktop-dark.jpg) | ![후](2026-11-11-hub-polish/after-team-desktop-dark.jpg) |

## 확인하지 않은 것

- 실제 브라우저에서 `/live.js`가 새 화면을 바꿔 끼우는 모습(캡처는 저장한 HTML이라 "새로 고침" 링크가 보인다). 바꿔 끼우는 `<main>`의 모양은 그대로라 동작은 바뀌지 않는다.
- Safari·Firefox·Windows(맑은 고딕). `:has()`를 쓰는 두 가지(폰에서 빈 칸 접기, 카드 포커스 테두리)는 이를 모르는 옛 브라우저에서는 접히지 않고 링크 자체의 포커스만 보인다.
- 색 대비는 주요 글자 색(흐린 글자·링크·네 상태 글자)을 바탕과 손으로 계산해 모두 4.5:1 이상인 것만 확인했다. 도구로 전 화면을 재지는 않았다.
- 사내 Hub 재배포와 실제 팀원의 화면.
