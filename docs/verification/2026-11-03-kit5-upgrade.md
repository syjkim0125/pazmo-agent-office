# 검증 기록: kit 4.1.0 → 5.0.3, Office 역할 run v3 (D36, U30)

[G3 결정](../understanding/kit5-upgrade-decision.md) · [계획](../plans/2026-11-03-1200-feat-kit5-upgrade-plan.md) · kit run `.ai-workflow/runs/U30-kit5-upgrade-replan.json`

## 설치

- 공식 npm `@pazmo/ai-workflow-kit@5.0.3` tarball(integrity `sha512-3Wu1…prYw==`)을 받아 계산한 sha512가 레지스트리 값과 같았다. release commit은 `a0c0787`이다.
- `ai-workflow-kit init --host codex` 뒤 `doctor`가 모두 PASS였다(graph 런타임 13개 파일, 검사기).
- 설치 전 이 repo의 kit 파일은 4.1.0 패키지와 바이트가 같았다(`.ai-workflow/graph`·`check.mjs`·skill 트리).
- `upstream/kit.lock.json`: Office가 kit 명령마다 확인하는 해시 15개(`bin` 2개, `graph` 13개)를 다시 쓰고, `version`·`integrity`·`sourceCommit`도 고쳤다.

## 바꾸기 전 (main `226cbf1`, 실험 사본)

- 실험 사본에 5.0.3만 설치하고 kit lock만 맞춘 상태에서 전체 시험: **1254/1276**, 실패 22개(`coordinator` 9, `kit-role-runs` 6, `planning-coordinator` 7). 167초.
- Office와 같은 조건의 탐침에서 나온 오류:
  - `G1 approval binding changed or missing`
  - `ENOENT … .ai-workflow/verification.json`
  - `Verification execution required for V1.`
  - `spawn npm ENOENT`(Office 환경에서 kit가 호스트 명령을 실행)
  - 사용자 파일을 고친 뒤 리뷰어 `status` → `stale`

## 바꾼 뒤

- 새 역할 run은 `version: 3`, `kind: "role"`이다. 위치는 PM·Lead가 `.pazmo-office/kit-runs/`, 개발자·리뷰어가 `.pazmo-office/kit/<digest>/runs/`다. kit 4 run(`role-runs/`)은 열지도 고치지도 않는다.
- G1 기록에 `gate`·`storyHash`·`responseRef: office-approval:<challenge>`가 들어간다. storyHash는 kit의 `storyContract`와 같다(시험으로 비교).
- 개발자 self-check는 검사마다 kit `graph verify`의 실행 기록(receipt)이 있어야 통과로 기록된다. 이때 실행되는 것은 Office 중계(`node office-check.mjs V1`)뿐이다. 중계가 실패하는 경우는 셋이다. 이 round에 VM 결과가 없을 때, 다른 candidate나 round의 결과일 때, 실패한 결과일 때다. 이 경우 kit는 통과 기록을 거부한다.
- 리뷰어 run은 `candidate.json`(candidate 지문·round)에 묶인다. 사람이 자기 checkout을 고치고 커밋해도 `stale`이 되지 않는다. candidate가 바뀌면 `stale`이고, 통과 기록이 거부된다.
- Task 범위 보기: Task가 덮지 않는 V 줄은 `(outside this Task)`로 시작하므로 kit가 ID로 읽지 않는다. canonical Story는 그대로다.
- kit 4로 시작한 작업은 `KIT_UPGRADE_REQUIRED`로 멈추고 옛 run을 그대로 둔다(전달, 계획 모두). 완료 증거를 kit 4로 이미 기록한 round는 그대로 G4를 기다린다.
- 리뷰어 packet의 `reviewBudget`은 Office 값이다(리뷰어 1명).

## 돌연변이 확인 (고친 코드를 잠깐 되돌려 시험이 잡는지)

- `GIT_CEILING_DIRECTORIES`를 빼면 리뷰어 바인딩 시험이 실패한다(사람의 커밋으로 `stale`).
- kit 4 완료 기록을 그대로 두는 분기를 끄면 해당 시험이 실패한다.
- Task 밖 V 표시를 끄면 Task 범위 보기 시험이 실패한다.

## 자동 검사

- 구현 끝(리뷰 전): root `npm test` **1284/1284** exit 0, 336초(부하 27–39). 타입 검사 exit 0. Story 검사기 exit 0. kit 시험 세 파일은 coordinator 24/24·kit-role-runs 10/10·planning-coordinator 34/34이다.
- 336초는 kit 검사 하나의 상한(300초)을 넘는다. 그래서 이 repo의 검사 프로필은 시험을 3묶음으로 나눴다(`scripts/kit-test-shard.mjs`). 프로필이 바뀌어 run을 `U30-kit5-upgrade-replan.json`으로 새로 시작했다.
- 독립 리뷰 1차(3명: 정확성·복구, 격리·무결성, 시험·이전·문서): Critical 0, Important 4, Minor 여러 건이었다. 모두 고쳤다.
  - git 차단: `GIT_DIR`(없는 경로)를 더했다. 경로의 대소문자가 다르거나 `:`가 있으면 ceiling만으로는 막지 못했다.
  - 같은 V의 검사 둘: kit 검사 id를 `V1-2`처럼 나눈다.
  - kit 4 작업: 실행기 자리를 잡기 전에 확인하고, round 사유로 남긴다.
  - `executed()` 재개 분기: 실제로 닿지 않아서 지웠다. 끊긴 self-check는 사람에게 간다.
  - 그 밖에 중계 파일을 스냅샷 입력에 넣었다. `candidate.json`은 원자적으로 바꾼다. 중계 5초, `verify` CLI 30초로 시간을 맞췄다. PATH 순서를 바꿨다. 증거 목록에 이전 attempt의 실행 기록을 넣었다.
- 새 시험은 다섯이다: 같은 V의 검사 둘, kit 4 두 번째 실행, 중계의 시간 초과·오류 결과, 같은 검사의 두 번째 실행 거부.
- 돌연변이 4개를 모두 잡았다.
  - `GIT_DIR`만 남기면 통과하고, 둘 다 빼면 실패한다.
  - id 번호를 끄면 실패한다.
  - 자리 잡기 전 확인을 끄면 실패한다.
- 수정 뒤: kit 시험 세 파일 69/69. root `npm test` **1284/1285** exit 1(184초). 실패 1건은 `tests/team-gh.test.mjs`의 4초 상한 시간 단언이고, 이번 변경과 무관하다. 그 파일만 3번 다시 돌리면 15/15였다. 타입 검사 exit 0, Story 검사기 exit 0.
- kit `graph verify` 실행 기록은 U30 replan run의 `workflow-verify`에 남는다.

## 경계

- 실제 Office(실제 VM·실제 claude/codex)로 v3 역할 run을 돌려 보지 않았다. 시험은 가짜 실행 환경과 가짜 runner를 쓴다.
- 이 repo의 `verification.json`은 자동 검사만 돌린다. 실제 확인이 필요한 V(V3·V4·V9·V10·V13·V14·V17·V18의 실제 부분)는 [kit-checks.md](kit-checks.md)의 경계에 적었다.
- 머지 뒤 main을 합치는 다른 브랜치가 4.1.0으로 만든 kit run은 `upgrade-required`(읽기 전용)가 된다. 그 브랜치는 v3 run을 새로 시작해야 한다.
