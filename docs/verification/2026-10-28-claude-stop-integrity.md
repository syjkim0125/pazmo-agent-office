# 2026-10-28 claude 역할을 멈출 때 보안 검사 멈춤은 바로 끝내기

Story: M3 · M4 · D15. 앞선 변경: PR syjkim0125/pazmo-agent-office#36(머지됨, G4는 그 머지 커밋에 기록). 설명 페이지: "OAuth 갱신 잠금 사고".

## 무엇을 고쳤나

#36은 claude 역할 실행을 멈출 때 SIGKILL 대신 SIGTERM을 먼저 보내고 2초 뒤 SIGKILL하도록 바꿨다. 토큰 갱신 중인 claude가 `~/.claude/.oauth_refresh.lock`을 지우고 끝날 시간을 주려는 것이다. 머지 뒤 독립 리뷰(보고만)에서 세 가지가 나왔다. 이 변경은 그중 둘(1·2)과, 고치는 중에 리뷰에서 나온 하나(4)를 고친다.

1. **보안 검사로 멈출 때도 SIGTERM을 보냈다.** 예상 밖 hook 이벤트(`CLAUDE_HOOK_UNEXPECTED`), 잘못된 init(`checkClaudeInit`), init 없는 시작(`CLAUDE_INIT_MISSING`), 출력 한도(`OUTPUT_LIMIT`) 모두 SIGTERM부터였다. 리뷰어가 claude 2.1.280 바이너리를 읽은 바로는 SIGTERM 종료 처리가 SessionEnd hook을 실행한다. 관리형 hook은 `--setting-sources ""`로 꺼지지 않으므로, Office가 막으려던 코드가 호스트에서 돌 수 있다. #36 이전에는 바로 SIGKILL이었다.
   - 이제: 취소(`CANCELLED`)와 시간 초과(`TIMEOUT`)만 SIGTERM 먼저, 나머지는 바로 SIGKILL이다. relay 실패는 취소로 들어오므로 SIGTERM 먼저다.
2. **claude가 이미 끝난 뒤의 멈춤은 SIGKILL로 이어지지 않았다.** `exit` 뒤 `close` 전에 멈춤이 들어오면 SIGTERM만 가고, 출력이 닫히며 `close`가 2초 타이머를 지웠다. 그래서 SIGTERM을 무시하는 그룹 프로세스가 살아남았다(리뷰어 재현: #36에서 5/5 생존).
   - 이제: 이미 끝났으면(`child.exitCode`·`signalCode`가 있으면) 바로 SIGKILL이다.
3. (고치지 않음, 사용자 결정 대기) **2초는 갱신 중인 실제 claude의 종료보다 짧을 수 있다.** 리뷰어의 바이너리 읽기로는 정리(최대 2초)와 진행 중 갱신 대기(최대 2초) 뒤에 잠금이 풀린다. 실제로 본 것은 아니다.
4. **(1을 고치다 생긴 것) 정상 종료 중에 나오는 줄이 종료를 끊었다.** 취소가 init 전에 들어오고 claude가 나가면서 `result` 같은 줄을 출력하면, 1의 변경 때문에 `CLAUDE_INIT_MISSING`으로 바로 SIGKILL돼 잠금이 다시 남았다.
   - 이제: 멈춤이 진행 중이면 hook 이벤트만 바로 SIGKILL로 이어진다(hook은 이미 시작된 뒤라 막는 게 아니라 줄이는 것). 다른 줄은 무시한다. 출력 한도는 줄 해석 전에 확인하므로 그대로 바로 SIGKILL이다.

오류 코드는 바뀌지 않는다. 처음 멈춘 이유가 기록된다.

## 시험

| 시험 (`tests/claude-controller.test.mjs`) | 고치기 전 (main `8b9d23b`) | 고친 뒤 |
|---|---|---|
| "a claude stopped for an unexpected hook or init gets no SIGTERM to shut down on" (hook·잘못된 init·init 없음 3가지) | 실패: 종료 처리기가 돌았다 | 통과 |
| "a cancel after the claude itself exited still kills what it left running" | 실패: SIGTERM 무시 자식이 살아남았다 | 통과 |
| "a hook the claude starts while shutting down after a cancel is killed at once" | 실패: hook이 끝까지 돌았다 | 통과 |
| "a line the claude prints while shutting down after a cancel does not cut its shutdown short" (리뷰어 재현을 옮김) | 통과(main), 4번 고치기 전 이 브랜치에서 실패: 잠금이 남았다 | 통과 |

- 시험은 시간이 아니라 표시 파일로 판정한다. 세 번째 시험만 hook 쪽에 1.5초 여유가 있다.
- 파일 전체: 고치기 전 12개 통과·새 시험 실패, 고친 뒤 19/19(3번 반복).
- 독립 리뷰가 main 컨트롤러로 새 시험을 돌려 0/6 통과(각자 예상한 단언에서 실패)를 확인했다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` (main `8b9d23b`에 이 변경, 리뷰 반영 뒤) | 957/957 (exit 0) |
| 같은 변경, 리뷰 반영 전 전체 실행 | 955/956. 실패 1건은 `tests/claw-lifecycle.test.mjs` "Office startup timed out"(load average 29, 다른 시험과 동시 실행)이고, 따로 돌리면 1/1 통과 |
| `tests/claude-controller.test.mjs` | 19/19, 3번 반복 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

## 리뷰

- #36 머지 뒤 리뷰(보고만): Changes needed. Important 3건(위 1·2·3), Minor 몇 건(멈춘 뒤에도 출력 해석, 시험 10의 부하 민감성, PR 본문의 "모두 먼저 실패" 표현).
- 이 변경의 리뷰(보고만): Changes needed. Important 1건(위 4)을 고쳤다. Minor인 시험 3의 여유(1초→1.5초)와 문서 문구 세 군데도 고쳤다. 출력 한도는 바로 SIGKILL이 맞다는 데 동의했다.
- 받아들이지 않은 제안: "멈춘 뒤에는 출력을 해석하지 말자"(#36 리뷰 Minor). 그러면 종료 중 hook을 볼 수 없어서, 위 4처럼 hook만 계속 본다.

## 아직 하지 않은 것

- 실제 claude가 갱신 중에 SIGTERM을 받을 때 무엇을 출력하는지, SessionEnd hook을 이벤트로 흘리는지(만료 토큰과 관리형 hook이 있어야 볼 수 있다).
- 위 3(2초 유예 길이): 사용자 결정 대기.
- `tests/claude-controller.test.mjs`의 기존 시험 10이 부하에서 흔들릴 수 있는 점(#36 리뷰 Minor).
- **G4:** 사용자 답변으로만 기록한다.
