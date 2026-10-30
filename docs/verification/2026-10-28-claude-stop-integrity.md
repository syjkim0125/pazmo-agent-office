# 2026-10-28 claude 역할을 멈출 때 보안 검사 멈춤은 바로 끝내기

Story: M3 · M4 · D15. 앞선 변경: PR syjkim0125/pazmo-agent-office#36(머지됨, G4는 그 머지 커밋에 기록). 설명 페이지: "OAuth 갱신 잠금 사고".

## 무엇을 고쳤나

#36은 claude 역할 실행을 멈출 때 SIGKILL 대신 SIGTERM을 먼저 보내고 2초 뒤 SIGKILL하도록 바꿨다. 토큰 갱신 중인 claude가 `~/.claude/.oauth_refresh.lock`을 지우고 끝날 시간을 주려는 것이다. 머지 뒤 독립 리뷰(보고만)에서 세 가지가 나왔다. 이 변경은 셋 모두와, 고치는 중에 리뷰에서 나온 하나(4)를 고친다. 3은 사용자 선택(2026-10-28, 추천안)이다.

1. **보안 검사로 멈출 때도 SIGTERM을 보냈다.** 예상 밖 hook 이벤트(`CLAUDE_HOOK_UNEXPECTED`), 잘못된 init(`checkClaudeInit`), init 없는 시작(`CLAUDE_INIT_MISSING`), 출력 한도(`OUTPUT_LIMIT`) 모두 SIGTERM부터였다. 리뷰어가 claude 2.1.280 바이너리를 읽은 바로는 SIGTERM 종료 처리가 SessionEnd hook을 실행한다. 관리형 hook은 `--setting-sources ""`로 꺼지지 않으므로, Office가 막으려던 코드가 호스트에서 돌 수 있다. #36 이전에는 바로 SIGKILL이었다.
   - 이제: 취소(`CANCELLED`)와 시간 초과(`TIMEOUT`)만 SIGTERM 먼저, 나머지는 바로 SIGKILL이다. relay 실패는 취소로 들어오므로 SIGTERM 먼저다.
2. **claude가 이미 끝난 뒤의 멈춤은 SIGKILL로 이어지지 않았다.** `exit` 뒤 `close` 전에 멈춤이 들어오면 SIGTERM만 가고, 출력이 닫히며 `close`가 2초 타이머를 지웠다. 그래서 SIGTERM을 무시하는 그룹 프로세스가 살아남았다(리뷰어 재현: #36에서 5/5 생존).
   - 이제: 이미 끝났으면(`child.exitCode`·`signalCode`가 있으면) 바로 SIGKILL이다.
3. **2초는 갱신 중인 실제 claude의 종료보다 짧을 수 있었다.** 리뷰어의 바이너리 읽기로는 정리(최대 2초)와 진행 중 갱신 대기(최대 2초) 뒤에 잠금이 풀린다. 실제로 본 것은 아니다.
   - 이제(사용자 선택: 6초 + 감독 유예 12초): 취소·시간 초과 뒤 SIGKILL까지 6초를 기다린다. 바깥 감독 코드(`superviseRemote`)는 멈춘 뒤 12초(6초 + relay 정리 최대 5초)를 기다린 다음에야 "정리 확인 못 함"으로 기록한다. 보통 claude는 지금처럼 0.5초 안팎에 끝난다.
   - 경계: 예약 마감(lease deadline)을 넘긴 실행은 기록 전에 `DEADLINE_EXCEEDED`로 격리된다. 시간 초과 멈춤은 원래 마감 시각에 일어나므로 이 점은 그대로다. 마감 직전의 취소에서 정리가 마감을 넘길 수 있는 구간은 5.5초에서 최대 12초로 넓어진다.
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
| "a claude that takes over 2 s to release the lock after SIGTERM still releases it" | 실패: 잠금이 남았다 | 통과 |
| `tests/remote-job.test.mjs` "a controller that reaps its process within the stop budget is confirmed closed" (멈춘 뒤 7초에 정리) | 실패: 정리 확인 못 함(5.5초) | 통과 |

- 시험은 시간이 아니라 표시 파일로 판정한다. 세 번째 시험만 hook 쪽에 1.5초 여유가 있다.
- 파일 전체: 고치기 전 12개 통과·새 시험 실패, 고친 뒤 20/20. `remote-job` 포함 25/25(2번 반복).
- 기존 시험 "a claude that ignores SIGTERM is still killed soon after a cancel"의 시간 한도를 4초에서 8초로 바꿨다(6초 유예 뒤 SIGKILL). 기존 "unresponsive controller cleanup" 시험은 12초 유예를 기다리므로 그만큼 길어졌다.
- 독립 리뷰가 main 컨트롤러로 새 시험을 돌려 0/6 통과(각자 예상한 단언에서 실패)를 확인했다.

## 자동 검증

| 검사 | 결과 |
|---|---|
| root `npm test` (main `8b9d23b`에 이 변경, 6초·12초 반영 뒤) | 959/959 (exit 0) |
| 같은 변경, 6초·12초 반영 전(리뷰 반영 뒤) | 957/957 (exit 0) |
| 같은 변경, 리뷰 반영 전 전체 실행 | 955/956. 실패 1건은 `tests/claw-lifecycle.test.mjs` "Office startup timed out"(load average 29, 다른 시험과 동시 실행)이고, 따로 돌리면 1/1 통과 |
| `tests/claude-controller.test.mjs` + `tests/remote-job.test.mjs` | 25/25, 2번 반복 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | exit 0 |

## 리뷰

- #36 머지 뒤 리뷰(보고만): Changes needed. Important 3건(위 1·2·3), Minor 몇 건(멈춘 뒤에도 출력 해석, 시험 10의 부하 민감성, PR 본문의 "모두 먼저 실패" 표현).
- 이 변경의 리뷰(보고만): Changes needed. Important 1건(위 4)을 고쳤다. Minor인 시험 3의 여유(1초→1.5초)와 문서 문구 세 군데도 고쳤다. 출력 한도는 바로 SIGKILL이 맞다는 데 동의했다.
- 받아들이지 않은 제안: "멈춘 뒤에는 출력을 해석하지 말자"(#36 리뷰 Minor). 그러면 종료 중 hook을 볼 수 없어서, 위 4처럼 hook만 계속 본다.

## 아직 하지 않은 것

- 실제 claude가 갱신 중에 SIGTERM을 받을 때 무엇을 출력하는지, SessionEnd hook을 이벤트로 흘리는지(만료 토큰과 관리형 hook이 있어야 볼 수 있다).
- 6초가 실제로 충분한지(갱신 중 실제 claude의 종료 시간)는 재 보지 못했다.
- 2026-10-29 갱신 없는 경우를 쟀다([실제 CLI 확인](2026-10-29-real-cli-runner-checks.md)). SIGTERM 뒤 0.3–1.7초에 끝났고, SessionEnd hook이 있으면 최대 1.9초였다. 실제 CLI는 SessionEnd hook을 SIGTERM 때도 정상 종료 때도 stream 이벤트로 내지 않는다. 갱신이 걸린 claude(가짜 토큰, 답하지 않는 프록시)는 갱신을 최대 2초 기다리고 나갔다. 한가할 때는 2.5초 안에 끝났다. 부하가 높으면 6초를 넘었고(최대 9.1초), 6초 SIGKILL로 잠금이 남았다(load average 90–102에서 3회 중 2회). 2026-10-30 D28로 12초(감독 18초)로 늘렸다([변경 기록](2026-10-30-claude-stop-grace-hooks.md)). 관리형 hook은 아직이다.
- `tests/claude-controller.test.mjs`의 기존 시험 10이 부하에서 흔들릴 수 있는 점(#36 리뷰 Minor).
- **G4:** 사용자 답변으로만 기록한다.
