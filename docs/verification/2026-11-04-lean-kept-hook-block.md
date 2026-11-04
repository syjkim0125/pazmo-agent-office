# lean Office와 팀 Office의 목록 사본도 claude hook 막힘을 유지한다 (U34)

Story: M16 · V18 · D29 · D39. Story는 그대로다. Story 해시 `b005160e`가 G1 기록(`.ai-workflow/approvals/pazmo-agent-office-g1.json`)과 같다. 근거: U33 리뷰 1차의 Minor 5번(`.ai-workflow/runs/U33-review-1.md`)과 STATUS의 U33 "남은 것".

결정 설명 페이지: https://claude.ai/artifact/UfeLicdWbEcSc1s6MFTPzJ (version 1)

- 사용자는 이 페이지를 본 뒤 "A. Story 그대로"를 골랐다(2026-11-04).
- 그래서 이 변경은 lean 화면과 팀 Office가 이미 있는 규칙을 따르게 하는 수정이다. 그 규칙은 D29의 "조회 실패는 판단하지 않음"과 D39다. G1은 다시 받지 않았다.
- D29의 "(막지 않음)"은 "조회 실패가 새로 막지 않음"으로 읽는다. 같은 claude를 앞서 막은 것은 풀지 않는다. 이 읽기는 D39·U33에서 엔진이 이미 따르던 것이고, Story 글에는 적혀 있지 않다.
- 다른 안은 D29 문구를 고치고 G1을 새로 받는 것이었다.

## 무엇이 문제였나

- 실행기 목록은 여러 사본으로 들고 있다.
  - 엔진의 사본: `RunnerSettings.refresh()`. `keptClaudeBlock`을 거친다. 같은 claude 바이너리가 앞서 hook 때문에 막혔으면, 모델·hook 목록 조회가 실패해도(`claudeUnlisted`) 막힘을 유지한다.
  - lean Office의 사본: `src/lean/office.ts`의 `catalog`. `discoverNow()`가 탐색 결과를 그대로 넣었다.
  - 팀 Office가 repo들과 함께 쓰는 탐색 결과: `src/team/office.ts`의 `sharedDiscovery`. 이것도 그대로 넣었다.
- 엔진은 lean Office의 `discoverNow()`로 목록을 받는다. 엔진의 사본은 lean 사본보다 드물게 새로 받는다. 그래서 hook을 찾은 조회를 lean 사본만 보고 엔진 사본은 못 볼 수 있다.
- 그 뒤 같은 claude의 조회가 한 번 실패하면 두 가지 일이 생겼다.
  - **lean 사본을 읽는 세 곳**에서 claude가 막히지 않은 것으로 보였다.
    - 실행기 화면(`runners()`): `blocked:false`, 안내 "준비됨".
    - agent 저장 검사(`LeanAgents`의 만들기·고치기): 모델을 고르지 않은 claude를 저장했다. 모델을 고르면 빈 모델 목록 때문에 `RUNNER_MODEL_UNKNOWN`으로 거절됐다.
    - 기본 실행기(`chooseRunner`의 agent 없음, `ensureDefault`의 첫 agent): codex가 준비 안 됐으면 claude를 골랐다.
  - **엔진이 hook 걸린 claude를 띄울 수 있었다.**
    - 엔진은 실행기가 준비 안 됨이면 거절하기 직전에 다시 탐색한다(D39).
    - 엔진 사본이 hook을 찾은 조회를 못 봤고, 그 다시 탐색에서 조회가 실패하면, 엔진 사본에는 막힘이 없다.
    - 그러면 역할 실행이 그대로 시작됐다. D39의 다시 탐색이 D29의 빈틈을 연 것이다.
    - 팀 Office에서는 다른 repo의 엔진도 그랬다. 한 repo의 탐색만 hook을 찾았고, 다른 repo의 엔진은 그 결과를 받지 못했다.
- 엔진 사본이 hook을 찾은 조회를 직접 봤으면 엔진은 거절했다. 처음 기록(이 파일의 첫 판)은 이 경우만 보고 "화면 문제"라고 적었다. 리뷰 1차가 고쳤다(아래 "리뷰").
- 확인 방법: U33 리뷰어가 코드로 찾았다. 이 변경에서 시험으로 재현했다(아래 "고치기 전"). 실제 claude로는 재현하지 않았다.

## 무엇이 바뀌었나

- 같은 함수 `keptClaudeBlock`(`src/runtime/runner-settings.ts`에서 export)을 사본마다 거친다.
  - lean Office의 `discoverNow()`: 탐색 결과를 `keptClaudeBlock(catalog, found)`에 거친 뒤 저장하고 돌려준다.
  - 팀 Office의 `sharedDiscovery`: 함께 쓰는 탐색 결과를 `keptClaudeBlock(kept?.catalog, found)`에 거친 뒤 저장하고 돌려준다.
  - 엔진의 `RunnerSettings.refresh()`: 전과 같다.
- 그래서 막힘은 아래로 전해진다.
  - 팀 Office: 모든 repo의 탐색이 함께 쓰는 탐색을 거친다. 한 repo가 찾은 막힘을 모든 repo의 lean 사본이 받는다.
  - lean Office: 엔진은 `discoverNow()`로 목록을 받으므로, lean 사본이 유지한 막힘을 엔진도 받는다. 엔진 자신이 hook을 찾은 조회를 못 봤어도 그렇다.
  - 아래 사본은 받은 결과에 자기 `keptClaudeBlock`을 한 번 더 적용한다. 같은 막힘이면 같은 안내를 다시 만들 뿐이다.
- 막힘이 남지 않는 경우는 그대로다.
  - 바이너리가 바뀐 경우.
  - 조회가 성공한 경우. 이때는 hook을 다시 판정한다.
  - 같은 바이너리의 조회가 한 번도 성공하지 못해 막힘이 없었던 경우(D29: 조회 실패는 판단하지 않음).
- 유지한 막힘의 안내는 지금의 로그인 상태로 다시 만든다(U33의 `hookBlock`).

## 시험

시험 5개를 더했다. 목록은 손으로 만든 catalog다. 다섯 개 모두 고치기 전에 실패했다(`.ai-workflow/runs/U34-implement-1.md`, `U34-implement-2.md`).

`tests/lean-office.test.mjs`:

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
4. **엔진의 역할 실행(D29).**
   - 엔진 사본은 claude를 로그아웃으로 봤다. hook을 찾은 조회는 실행기 화면(lean 사본)만 봤다. 엔진이 Engineer를 돌리려다 다시 탐색하고, 그 조회가 실패한다.
   - 결과: `RUNNER_NOT_READY claude: <hook 안내>`로 거절되고 claude 실행은 시작되지 않는다.
   - 고치기 전: `error: null`, claude Engineer가 시작됐다.

`tests/team-office.test.mjs`:

5. **팀 Office의 다른 repo.**
   - repo 두 개(alpha, beta)로 팀 Office를 켠다. alpha의 엔진만 hook을 찾은 조회를 본다. 그 뒤 beta의 엔진이 다시 탐색하고, 같은 claude의 조회가 실패한다.
   - 결과: beta의 엔진 사본도 막힘과 hook 안내를 가진다.
   - 고치기 전: beta의 안내는 "준비됨"이었다.
   - 이 시험을 위해 시험의 가짜 runtime이 엔진의 실행기 설정(`runners`)을 받아 둔다.

변이(그 줄만 바꿈, 매번 원래대로 되돌림). lean 변이는 `tests/lean-office.test.mjs` 전체(51개)로 돌렸다.

| 변이 | 결과 | 실패한 시험 |
|---|---|---|
| lean: 고치기 전으로 되돌림 | 47/51 | 1–4 |
| lean: 사본만 유지하고, 탐색 결과는 원래 것을 돌려줌 | 48/51 | 1, 2, 4 |
| lean: `keptClaudeBlock` 대신 앞의 claude 설치 정보를 그대로 복사 | 50/51 | 1(로그아웃 뒤 안내가 낡음) |
| lean: 조회가 성공해도 앞의 막힘을 유지 | 50/51 | 1 |
| 팀: 함께 쓰는 탐색 결과를 그대로 저장 | 0/1(시험 5만 돌림) | 5 |

- 리뷰어가 따로 돌린 변이 중 "바이너리 비교를 무시"는 lean-office 시험에서 살아남는다. 바이너리 비교는 `keptClaudeBlock` 안에 있고 `tests/runner-settings.test.mjs`가 지킨다.
- 관련 시험 파일 7개는 172/172다: lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office.
- 타입 검사는 exit 0이다.
- 전체 시험·타입 검사·Story 검사의 결과는 kit 실행 `.ai-workflow/runs/U34-lean-kept-hook-block.json`의 검증 기록에 있다.

## 리뷰

- **1차**(`.ai-workflow/runs/U34-review-1.md`): 머지 불가. Critical 0, Important 2, Minor 3. 코드와 처음 세 시험은 맞다고 봤다.
  - Important 1: 처음 기록은 엔진이 늘 거절한다고 적었다. 실제로는 엔진 사본이 hook을 찾은 조회를 못 봤으면, D39의 다시 탐색에서 hook 걸린 claude가 시작됐다. → 이 기록을 고치고 시험 4를 더했다.
  - Important 2: 팀 Office의 다른 repo에 남는 위험을 좁고 가볍게 적었다. 실제로는 다른 repo의 엔진이 hook 걸린 claude를 시작할 수 있었다. → 함께 쓰는 탐색에도 `keptClaudeBlock`을 넣고 시험 5를 더했다.
  - Minor: 기본 실행기 시험의 아무 일도 안 하는 `runners()` 호출을 뺐다. 엔진 거절 자체를 지키는 시험이 없었다(→ 시험 4). D29의 "(막지 않음)"을 읽는 방식은 위 Story 단락에 적었다.
- 학습 문서: [기억하는 실행기 막힘은 목록 사본마다 유지한다](../solutions/logic-errors/keep-a-remembered-runner-block-in-every-catalog-copy.md)

## 확인하지 않은 것과 남은 위험

- **아래 사본의 더 오래된 막힘.**
  - 아래 사본(엔진, 또는 팀 Office의 repo별 lean 사본)은 자기가 본 더 오래된 막힘을 계속 쓸 수 있다.
  - 예: 엔진이 hook A로 막힌 조회를 봤다. 그 뒤 lean만 hook B(또는 hook 없음)인 조회를 봤다. 엔진이 다시 볼 때 조회가 실패했다.
  - 그러면 엔진은 자기 기록의 hook A로 막고, lean 화면은 hook B(또는 준비됨)를 보인다.
  - 아래 사본이 더 조심하는 쪽으로 틀리고, 다음 성공한 조회에서 맞춰진다. 시험하지 않았다.
- **한 번도 성공하지 못한 조회.** 같은 바이너리의 조회가 Office 안에서 한 번도 성공하지 못했으면 막힘이 없다. 그러면 hook 걸린 claude도 시작될 수 있다. D29가 정한 대로이고("조회 실패는 판단하지 않음"), 이 변경 전과 같다.
- **Office 사이.** 단일 Office·lean Office·팀 Office는 프로세스마다 따로 기억한다. Office를 다시 켜면 기억이 없다.
- 실제 claude로 재현하지 않았다. 가짜 목록으로만 확인했다.
