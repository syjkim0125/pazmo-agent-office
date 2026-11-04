# lean Office의 목록 사본도 claude hook 막힘을 유지한다 (U34)

Story: M16 · V18 · D29 · D39. Story는 그대로다. Story 해시 `b005160e`가 G1 기록(`.ai-workflow/approvals/pazmo-agent-office-g1.json`)과 같다. 근거: U33 리뷰 1차의 Minor 5번(`.ai-workflow/runs/U33-review-1.md`)과 STATUS의 U33 "남은 것".

결정 설명 페이지: https://claude.ai/artifact/UfeLicdWbEcSc1s6MFTPzJ (version 1)

- 사용자는 이 페이지를 본 뒤 "A. Story 그대로"를 골랐다(2026-11-04).
- 그래서 이 변경은 lean 화면이 이미 있는 규칙을 따르게 하는 수정이다. 그 규칙은 D29의 "조회 실패는 판단하지 않음"과 D39다. G1은 다시 받지 않았다.
- 다른 안은 D29 문구를 고치고 G1을 새로 받는 것이었다.

## 무엇이 문제였나

- lean Office는 실행기 목록 사본을 따로 들고 있다(`src/lean/office.ts`의 `catalog`). `discoverNow()`가 탐색 결과를 그대로 넣었다.
- 엔진의 사본(`RunnerSettings.refresh()`)은 `keptClaudeBlock`을 거친다.
  - 같은 claude 바이너리가 앞서 hook 때문에 막혔으면, 모델·hook 목록 조회가 실패해도(`claudeUnlisted`) 막힘을 유지한다.
- 그래서 조회가 한 번 실패하면, lean 사본을 읽는 세 곳에서 claude가 막히지 않은 것으로 보였다.
  - **실행기 화면**(`runners()`): `blocked:false`, 안내 "준비됨".
  - **agent 저장 검사**(`LeanAgents`의 만들기·고치기): 모델을 고르지 않은 claude를 저장했다. 모델을 고르면 빈 모델 목록 때문에 `RUNNER_MODEL_UNKNOWN`으로 거절됐다.
  - **기본 실행기**(`chooseRunner`의 agent 없음, `ensureDefault`의 첫 agent): codex가 준비 안 됐으면 claude를 골랐다.
- 엔진은 여전히 역할 실행을 거절했다. `runnersReady`도 빈 모델 목록으로 실패했다.
  - 그래서 막힌 claude가 실제로 돌지는 않았다. D29는 후퇴하지 않았다.
  - 화면과 저장이 엔진과 다르게 말하는 문제였다. D39 전부터 있었다.
- 확인 방법: 리뷰어가 코드로 찾았고, 이 변경에서 시험으로 재현했다(아래 "고치기 전").

## 무엇이 바뀌었나

- `discoverNow()`는 이제 탐색 결과를 `keptClaudeBlock(catalog, found)`에 거친 뒤 저장하고 돌려준다. 엔진과 같은 함수다(`src/runtime/runner-settings.ts`에서 export).
- 엔진은 lean Office의 `discoverNow()`로 목록을 받는다.
  - 그래서 lean 사본이 막힘을 유지하면 엔진도 그 결과를 받는다. 엔진 자신이 hook을 찾은 조회를 보지 못했어도 그렇다.
  - 엔진은 받은 결과에 자기 `keptClaudeBlock`을 한 번 더 적용한다. 같은 막힘이면 같은 안내를 다시 만들 뿐이다.
- 막힘이 남지 않는 경우는 그대로다.
  - 바이너리가 바뀐 경우.
  - 조회가 성공한 경우. 이때는 hook을 다시 판정한다.
  - 앞서 막힘이 없었던 경우.
- 유지한 막힘의 안내는 지금의 로그인 상태로 다시 만든다(U33의 `hookBlock`).

## 시험

`tests/lean-office.test.mjs`에 시험 3개를 더했다. 목록은 손으로 만든 catalog다. 고치기 전에 3개 모두 실패했다(`.ai-workflow/runs/U34-implement-1.md`).

1. **실행기 화면.**
   - hook으로 막힌 조회 뒤에 같은 claude의 조회가 실패하면, 화면은 앞의 막힘과 안내를 그대로 보인다. 모델은 비어 있다.
   - 그 사이 로그아웃했으면 안내에 로그인 안내가 붙는다. 새 조회가 만든 안내와 글자까지 같다.
   - 조회가 성공하고 hook이 없으면 막힘이 풀리고 "준비됨"이다.
   - 고치기 전: `blocked:false`, `hint:"준비됨"`.
2. **agent 저장.**
   - 모델을 고르지 않은 claude로 만들기·고치기가 `RUNNER_NOT_READY`와 hook 안내로 거절되고, 아무것도 저장되지 않는다.
   - 저장 전의 새 탐색으로 엔진 사본도 같은 막힘을 받는다. 엔진은 hook을 찾은 조회를 보지 못했다.
   - 고치기 전: 만들기가 거절되지 않았다.
3. **기본 실행기.**
   - codex가 로그아웃이고 claude 막힘이 유지되면, agent 없는 `chooseRunner`와 `ensureDefault`가 codex를 고른다.
   - 고치기 전: `{runner:"claude", model:"default"}`.

변이(`discoverNow()`의 그 줄만 바꿈, 매번 원래대로 되돌림):

| 변이 | 실패한 시험 |
|---|---|
| 고치기 전으로 되돌림 | 3개 모두 |
| lean 사본만 유지하고, 탐색 결과는 원래 것을 돌려줌 | 화면, 저장(2개) |
| `keptClaudeBlock` 대신 앞의 claude 설치 정보를 그대로 복사 | 화면(로그아웃 뒤 안내가 낡음) |
| 조회가 성공해도 앞의 막힘을 유지 | 화면 |

- 관련 시험 파일 7개는 170/170이다: lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office.
- 타입 검사는 exit 0이다.
- 전체 시험·타입 검사·Story 검사의 결과는 kit 실행 `.ai-workflow/runs/U34-lean-kept-hook-block.json`의 검증 기록에 있다.

## 확인하지 않은 것과 남은 위험

- **엔진 사본의 더 오래된 막힘.**
  - 엔진 사본은 자기가 본 더 오래된 막힘을 계속 쓸 수 있다.
  - 예: 엔진이 hook A로 막힌 조회를 봤다. 그 뒤 lean만 hook B(또는 hook 없음)인 조회를 봤다. 엔진이 다시 볼 때 조회가 실패했다.
  - 그러면 엔진은 자기 기록의 hook A로 막고, lean 화면은 hook B(또는 준비됨)를 보인다.
  - 엔진이 더 조심하는 쪽으로 틀리고, 다음 성공한 조회에서 맞춰진다. 시험하지 않았다.
- **팀 Office의 다른 repo.**
  - 팀 Office는 repo마다 엔진과 lean 사본이 따로 있고, 탐색 결과만 함께 쓴다.
  - 어떤 repo의 사본이 같은 claude의 성공한 조회를 한 번도 못 보고 실패한 조회만 봤다면, 막힘을 모른다.
  - 켤 때는 모든 repo가 같은 첫 탐색 결과를 받는다. 그래서 바이너리가 바뀐 직후에만 생긴다. 시험하지 않았다.
- 실제 claude로 재현하지 않았다. 가짜 목록으로만 확인했다.
