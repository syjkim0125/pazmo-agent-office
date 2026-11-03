# kit 5 검사 절차 (이 repo)

`.ai-workflow/verification.json`의 recipe다. kit의 `graph verify`가 이 repo의 자동 검사를 직접 돌릴 때 이 절차를 따른다. 실제 Office 실행·실제 CLI·실제 GitHub 확인은 여기서 증명하지 않는다(아래 경계).

## Doctor (돌리기 전에)

- `node --version`이 `.node-version`(24.19.0)이어야 한다. kit는 셸 없이 명령을 돌리고 지금 `PATH`의 `npm`·`node`를 쓴다. 22.x가 먼저 잡히면 `.ts` 파일을 읽지 못해 모든 시험 파일이 실패한다. nvm이라면 `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`로 `graph.mjs`를 부른다.
- 이 checkout에서 `npm ci`를 했어야 한다(root `ws`·TypeScript).
- 다른 전체 시험이 돌고 있지 않아야 한다(`pgrep -f -- --test`). 두 전체 시험이 겹치면 시작 시간 초과와 git `TIMEOUT`이 난다. 전체 시험은 2026-11-03에 부하 16에서 167초, 부하 27–39에서 336초였다. kit 검사 하나의 상한은 300초다. 그래서 시험 파일을 정렬해 3묶음으로 나눠(`scripts/kit-test-shard.mjs <i> 3`, i번째 파일마다) 검사 세 개로 돌린다. 부하가 높으면 기다렸다가 돌린다.
- Mac이 잠들면 시험이 멈춘다(덮개를 닫지 않는다).

## Drive

`workflow-verify`(또는 개발자 `self-check`)를 `start`한 토큰으로 검사마다 한 번씩 돌린다.

```bash
node .ai-workflow/bin/graph.mjs verify <run.json> workflow-verify <started-token> tests-1of3
node .ai-workflow/bin/graph.mjs verify <run.json> workflow-verify <started-token> tests-2of3
node .ai-workflow/bin/graph.mjs verify <run.json> workflow-verify <started-token> tests-3of3
node .ai-workflow/bin/graph.mjs verify <run.json> workflow-verify <started-token> typecheck
node .ai-workflow/bin/graph.mjs verify <run.json> workflow-verify <started-token> story
```

- `tests-1of3`·`tests-2of3`·`tests-3of3`: 시험 파일 전체를 세 묶음으로 나눈 것이다. 셋을 합치면 `npm test`와 같은 파일을 돌리며, 모든 V의 자동 부분을 덮는다. 각 stdout의 `ℹ tests`·`ℹ pass`·`ℹ fail` 줄을 더해 X/X를 적는다.
- `typecheck`: `npm run typecheck`(`tsc -p tsconfig.json`). kit는 검사마다 V를 하나 이상 요구하므로 모든 V를 적었다. 이 검사는 코드 전체의 타입 검사일 뿐, 어느 V의 동작도 증명하지 않는다.
- `story`: canonical Story의 모양·게이트 기록 검사(V2의 서식·ID·승인 게이트). 이 검사의 exit 0은 실행 가능한 인도를 뜻하지 않는다. 인도는 G4 뒤의 `graph.mjs delivery`로 확인한다.

## Evidence

- 실행 기록과 출력은 `.ai-workflow/evidence/<runId>/<executionId>/`에 남는다. 커밋하기 전에 출력에 비밀값이 없는지 읽는다(시험 출력에는 임시 폴더 경로만 있어야 한다).
- `verification.passed`, exit 코드, signal, 시간 초과 여부, 스냅샷 전후 값을 결과 기록에 옮긴다.
- 코드를 바꾸면 리뷰·검사가 `stale`이 된다. 커밋도 HEAD를 바꾸므로 스냅샷이 달라진다. 그래서 G4 JSON을 쓰고 `graph.mjs delivery`가 통과한 뒤에만 다음 둘을 더 커밋한다. 하나는 kit 출력(`.ai-workflow/runs/`·`evidence/`·`approvals/`)이고, 다른 하나는 STATUS의 G4 결과 줄이다. G4 기록 자체는 `.ai-workflow/approvals/`에 둔다(스냅샷 밖).

## Cleanup

시험은 자기 임시 폴더를 지운다. kit 실행기는 끝난 명령의 프로세스 그룹을 정리한다. 남은 `node --test` 프로세스가 있으면 `pgrep -f -- --test`로 찾아 확인한다.

## 경계 (자동 검사로 증명하지 않는 것)

- V3·V9: 실제 로그인한 codex·claude CLI로 역할을 돌리는 것. 시험은 가짜 실행 파일을 쓴다.
- V4: 실제 VM sandbox 경계(canary). 시험은 가짜 실행 환경을 쓴다.
- V13·V14·V10·V18: 실제 OpenShift 배포, 실제 Hub 연결, 실제 GitHub PR·머지. 시험은 로컬 Hub·bare repo·가짜 `gh`를 쓴다.
- V5·V6: pilot 산출물, tarball 설치. 시험은 일부만 흉내 낸다.

이 확인들은 각 변경의 `docs/verification/` 기록과 `docs/STATUS.md`의 "남은 것"에 따로 남는다.
