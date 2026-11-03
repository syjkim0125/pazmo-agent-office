# 2026-11-03 3줄 요약의 따옴표(비ASCII) 경로 G4

Story: M16 · V18(Story Task의 3줄 요약; 같은 `changeSummary`가 단일 Office의 G4 요약도 만든다). PR syjkim0125/pazmo-agent-office#62. 커밋 `e0245fd`(수정), `4b1f643`(kit 기록). kit graph: `.ai-workflow/runs/quoted-path-change-summary.json`(상태 `g4`). 학습 문서: [count-added-and-deleted-files-in-no-index-no-prefix-diffs.md](../solutions/integration-issues/count-added-and-deleted-files-in-no-index-no-prefix-diffs.md).

## 보인 증거

- diff(main 대비): `src/runtime/decision-summary.ts` +18 −2, `tests/candidate-diff.test.mjs` +29, `tests/decision-summary.test.mjs` +11, 학습 문서 +19 −20, kit 기록 7개.
- 시험: 새 시험 두 개가 고치기 전에 실패했다(짝 시험은 `변경 없음`, 단위 시험은 요약 5줄). 관련 4개 파일 40/40. 전체 `npm test` 1278/1278 exit 0, 타입 검사 exit 0, Story 검사기 exit 0. 첫 전체 실행은 1277/1278이었다(`tests/team-gh.test.mjs` "a gh that hangs times out", 이 변경과 무관, 따로 3/3·뒤 두 번 전체 통과, 원인 진단은 별도 세션).
- 리뷰: 독립 리뷰 두 번, 모두 머지 가능. Critical 0, Important 0, Minor 5개 모두 고침. [리뷰 기록](../../.ai-workflow/runs/quoted-path-change-summary-review-1.md)

## 질문과 답 (2026-11-03)

컨트롤러는 먼저 설명 페이지("3줄 요약 따옴표 경로 G4")를 보였다. 그 페이지에는 다음이 있다.

- 고치기 전·뒤의 그림(바뀐 파일 → Git이 쓴 머리줄 → 요약 줄)
- 8진수 숫자를 글자로 바꾸는 법(`\354\235\270` → 인)
- 지키는 것 셋과 실패할 때의 동작
- 확인한 것과 못 본 것, diff 통계
- G4 세 질문
- 선택지 셋(① 승인 후 머지, ② 실제 확인 뒤 머지, ③ 고칠 것 요청)과 각각의 비용·되돌리기·지금 정하는 이유

사용자는 세 질문에 직접 답하지 않고 선택지를 골랐다.

> ① 승인 후 머지

아래 답은 컨트롤러가 설명 페이지의 내용으로 썼다. 사용자는 이 답을 기록 전에 보지 않았다(#51·#53·#59와 같은 방식).

1. 동작: 바뀐 파일 이름에 한글 같은 비ASCII 글자나 `"`가 있으면 Git이 diff 머리줄을 따옴표로 싸고 한글을 8진수 숫자로 쓴다. 이제 요약이 그 줄도 읽어 실제 이름을 보인다. 예: `2. 변경 파일: 변경 없음` → `2. 변경 파일: src/인사.js, 지울.txt, 한글 " space.txt (+3 −2줄)`. Hub 보고와 단일 Office의 G4 질문이 같다.
2. 규칙과 실패 경로:
   - 요약은 언제나 3줄이다. `\t`·`\n` 같은 글자 이스케이프는 풀지 않고 그대로 둔다(Git은 LF·CR을 늘 이렇게 쓴다). Office·Hub 화면이 요약을 줄 단위로 읽기 때문이다.
   - 따옴표 없는 머리줄(영문, 공백만 있는 이름, 새 파일 `b/ b/`, 지운 파일 `a/ a/`)은 #59의 규칙 그대로다.
   - 읽지 못한 머리줄은 목록에서 빠질 뿐 오류가 나지 않는다. 모두 못 읽으면 예전처럼 `변경 없음`이다. 요약은 저장된 diff로만 만든다(모델 호출 없음).
3. 증거와 한계:
   - 짝 시험은 실제 `captureCandidateDiff`(실제 `/usr/bin/git`)로 추가·수정·삭제 파일을 ASCII 셋, 따옴표 셋으로 만들어 요약 줄을 본다. 단위 시험은 Git 2.50.1이 실제로 쓴 패치(바이트까지 같음)로 `\\`·`\t`·`\n` 경로를 본다.
   - 확인하지 못한 것: 한글 이름 파일을 바꾸는 실제 Story Task·Office G4 실행, Git 2.50.1이 아닌 버전의 따옴표 규칙.

선택: ① 승인 후 머지.

## 평가

Story, diff, 시험, 리뷰 기록과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. `decision-summary.ts:34-38`(따옴표 갈래와 `unquote` 호출)과 `:10-17`(`unquote`), 짝 시험(`tests/candidate-diff.test.mjs:199`)의 기대값과 같다. 다만 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 3줄 유지는 단위 시험의 `split("\n").length === 4`와 리뷰 2회차 탐침(가짜 3번째 줄을 넣은 경로도 4줄)으로 확인했다. 따옴표 없는 갈래는 바뀌지 않았고 기존 시험이 그대로 통과한다. |
| 증거 범위 | 자동 시험과 실제 Git 출력까지는 충분하다. 실제 Story Task 실행과 다른 Git 버전은 하지 않았다고 따로 적었다. |
| 선택 | 승인 후 머지. |
