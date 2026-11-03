# 2026-11-03 실행기 계정 문제는 시도로 세지 않고 기다린다 (D37) G4

- Story: M16 · V18 · D37. PR syjkim0125/pazmo-agent-office#66.
- 커밋: `9e1eda8`(구현), `e0c7bbb`(main #60–#64 합침), `43b967a`(kit 기록).
- kit graph: `.ai-workflow/runs/U31-runner-account-wait-merge.json`(상태 `g4`).
- [변경 기록](2026-11-03-runner-account-wait.md)
- 학습 문서: [detect-runner-account-limits-from-the-cli-error-kind.md](../solutions/integration-issues/detect-runner-account-limits-from-the-cli-error-kind.md)

## 보인 증거

- **diff(main 대비):**
  - `src` 8개 파일 +249 −29: `runner-account.ts` 새 파일 +76, `store.ts` +67 −4, `executor.ts` +46 −9, `claude-profile.ts` +24 −2, `native-office.ts` +20 −8, `story-contract.ts` +9 −3, `office.ts` +5 −2, `cli/team.ts` +2 −1.
  - `tests` 7개 파일 +424 −9.
  - `docs` 4개 파일 +149 −4.
  - kit 기록 18개 +707.
- **시험:**
  - 새 시험 16개는 모두 고치기 전에 실패했다(runner-account 8, team-executor 6, native-story-task 1, team-store 1).
  - main을 합친 트리에서 전체 `npm test` 1294/1294 exit 0이었다. 타입 검사·Story 검사기·G1 검사도 exit 0이었다.
- **리뷰:** 리뷰어 8개와 독립 재확인 2번을 거쳤다.
  - 찾은 것은 P2 2건, P3 이하 4건, 번호 충돌 1건이고 모두 고쳤다.
  - 반영하지 않은 2건은 이유와 함께 적었다.
  - [리뷰 기록](../../.ai-workflow/runs/U31-review-2.md)
- **확인하지 못한 것:**
  - 한도·결제·로그아웃에 걸린 실제 계정
  - claude의 `rate_limit_event`와 codex 계정 문구의 실제 모습
  - codex 출력을 엔진까지 통과시키는 시험
  - 기다리는 동안 `RUNNER_NOT_READY`(후속 세션)

## 질문과 답 (2026-11-03)

컨트롤러는 먼저 설명 페이지("실행기 한도 대응", 3판)를 보였다. 그 페이지에는 다음이 있다.

- 위 증거
- G4 세 질문
- 선택지 넷과 각각의 비용·되돌리기
  - ① 직접 답하기
  - ② 승인 후 머지(답은 컨트롤러가 씀)
  - ③ 실제 확인 뒤 머지
  - ④ 고칠 것 요청
- 지금 정하는 이유

동작 설명은 일부러 넣지 않았다. 사용자는 세 질문에 직접 답하지 않고 선택지를 골랐다.

> ② 승인 후 머지

아래 답은 컨트롤러가 Story·diff·시험으로 썼다. 사용자는 이 답을 기록 전에 보지 않았다(#51·#53·#59·#62와 같은 방식). 그래서 이 G4의 이해 근거는 사용자의 말이 아니다.

1. **동작:**
   - 팀원의 claude·codex 계정이 사용 한도·결제·로그인 만료에 걸리면, Story Task의 구현·리뷰 실행이 바로 끝나도 시도로 세지 않는다. 예전에는 몇 초 만에 시도 셋을 쓰고 `ENGINEER_FAILED`로 실패 보고했다.
   - Office는 Task를 쥔 채 claude가 알려 준 리셋 시각에, 없으면 30분 뒤에 같은 시도를 구현부터 다시 한다.
   - 기다리는 동안 `status --team`·`team status`에 `claim.waiting`(실행기·종류·실행기의 말 한 줄·시작·다음 시각)이 보이고, Office 로그에 한 줄이 남는다.
   - 첫 발견부터 6시간이 지나도 막혀 있으면 `RUNNER_LIMIT claude: You've hit your …` 같은 이유로 Hub에 실패 보고한다. 담당자는 `team rerun`으로 다시 실행한다.
2. **규칙과 실패 경로:**
   - 계정 문제로 보는 신호는 실행기 CLI 자신이 낸 것뿐이다.
     - claude는 스스로 만든 마지막 거절 답의 `error` 종류로 본다. 거절 뒤에 다른 답을 이어 갔으면 보지 않는다.
     - codex는 실패한 턴이나 마지막 `error` 이벤트의 문구로 본다.
     - 모델이 쓴 글은 신호가 아니다. 그 밖의 실패(코드 오류, 시간 초과, 충돌)는 지금처럼 시도로 센다.
   - 시도로 센 실패는 기다림을 끝낸다. 다음 시도의 계정 문제는 새 6시간을 연다. 리뷰에서 찾은 결함(시간 초과 뒤 기다림이 남음)의 수정이 이 규칙이다.
   - 기다림은 `team.sqlite`에 남아 Office를 껐다 켜도 이어진다. 읽을 수 없는 기록은 기다림 없음으로 읽는다(다음 실행이 다시 알아낸다).
   - 다시 하는 실행은 계약 폴더를 따로 둔다(`-a<시도>-r<번째>`). 실행기의 말은 Hub 이유와 로그에만 가고, Engineer 계약에는 들어가지 않는다.
   - Hub와 프로토콜은 바꾸지 않았다. 기다리는 동안 PL에게는 진행 중으로 보인다.
3. **증거와 한계:**
   - `tests/runner-account.test.mjs`: 실제 확인 때 남은 claude 출력 모양과 claude 2.1.280·codex 0.155.1 설치본에서 찾은 오류 종류·문구로 분류를 확인한다.
   - `tests/team-executor.test.mjs`: 30분·리셋 시각·6시간 상한·재시작·시간 초과 뒤 새 기다림·폴더를 확인한다.
   - `tests/native-story-task.test.mjs`: 엔진이 구현·리뷰 출력에서 `runnerAccount`를 붙이는지 확인한다.
   - `tests/team-office.test.mjs`·`tests/team-lifecycle.test.mjs`: `waiting`을 확인한다.
   - 확인하지 못한 것은 위 "보인 증거"의 마지막 항목과 같다.

선택: ② 승인 후 머지.

## 평가

Story D37, diff, 시험, 리뷰 기록과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. `src/team/executor.ts`의 `waitForRunner`(재시도 시각·6시간·실패 이유)와 `prepare`의 대기, `src/team/store.ts`의 `waitingOf`, 시험 "a run stopped by its runner's account is not an attempt …"의 기대값과 같다. 다만 사용자가 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. "시도로 센 실패는 기다림을 끝낸다"는 `failAttempt`의 두 기록(`runnerWait: null`)과 시험 "a run after a wait that runs past its deadline …"이 확인한다(고치기 전 실패). "모델의 말은 신호가 아니다"는 "the words alone are not the signal …"과 "a refused reply claude went on from …"이 확인한다. |
| 증거 범위 | 자동 시험과 설치본 근거까지다. 실제 한도 계정, 실제 이벤트 모양, codex의 엔진 통과, `RUNNER_NOT_READY`는 하지 않았다고 따로 적었다. |
| 선택 | 승인 후 머지. |
