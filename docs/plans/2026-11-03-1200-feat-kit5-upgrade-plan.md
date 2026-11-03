# 계획: kit 5.0.3, Office 역할 run v3 (D36, U30)

Status: Approved (G3 2026-11-03, [결정](../understanding/kit5-upgrade-decision.md))
Story: ../understanding/pazmo-agent-office-contract.md (M3·M4·M8, V3·V4·V8; D36)
Run: `.ai-workflow/runs/U30-kit5-upgrade-replan.json` (기본 계획 `-`: implement → workflow-review → workflow-verify; 처음 run `U30-kit5-upgrade.json`은 프로필 변경 전 것으로 남김)

## 1. kit 설치 (끝남)

- 공식 npm 5.0.3 tarball을 받았고, integrity가 레지스트리 값과 같았다. 설치는 `ai-workflow-kit init --host codex`로 했고 `doctor`는 모두 PASS였다.
- 함께 바꾼 것: `upstream/kit.lock.json`(버전·integrity·release commit·`.ai-workflow/{bin,graph}/*.mjs` 해시 15개), `upstream/ai-workflow-kit.lock.json`, `THIRD_PARTY_NOTICES.md`(Pstack MIT)

## 2. 이 repo의 kit 5 절차

- `.ai-workflow/verification.json`: 시험 3묶음(`scripts/kit-test-shard.mjs`; kit 검사 하나의 상한 300초 안에 들게), `typecheck`, `story`. recipe는 `docs/verification/kit-checks.md`다. 처음에는 `npm test` 하나였지만, 부하 아래 336초가 걸려서 나눴다. 프로필이 바뀌었으므로 run을 `U30-kit5-upgrade-replan.json`으로 새로 시작했다.
- Story G1 → `.ai-workflow/approvals/pazmo-agent-office-g1.json`(storyHash = kit `storyContract`)

## 3. Office: 승인 기록 (`src/core/kit-role-runs.ts`, `store.ts`, `kit-planning.ts`)

- `kitStoryHash(text)`: kit `canonicalStory`와 같은 규칙이다(Status·Understanding gate·G4 줄을 빼고 trim한 뒤 sha256). 시험이 kit `storyContract`와 같은 값인지 비교한다.
- `kitG1(view, challengeId, record)`: Office 승인 기록에 `gate: "G1"`, `storyHash`, `responseRef: "office-approval:<challenge_id>"`를 더한다.
- Lead(`kit-planning`): 새 이름 `story.v3.md`·`g1.v3.json`을 쓴다. 옛 `story.md`·`g1.json`은 그대로 둔다. 옛 `store.kitSource`와 `approved-contracts/`는 없앴다(개발자·리뷰어는 아래 kit 폴더를 쓴다).

## 4. Office: 작업별 kit 폴더 (개발자·리뷰어)

- 위치: `<project>/.pazmo-office/kit/<digest(kit5:task:revision:contractDigest)>/`(`store.kitWorkspace` → `kitWorkspace`)
- 내용:
  - `story.md`: Task 범위 보기다. Verify 절에서 이 Task가 덮지 않는 V 줄 앞에 `(outside this Task)`를 붙인다.
  - `g1.json`
  - `office-check.mjs`: 중계(`src/runners/kit-check-relay.mjs`를 복사)
  - `.ai-workflow/verification.json`: 등록 검사마다 `{ id, covers:[V], argv:["node","office-check.mjs",id], timeoutMs:5000 }`이고, `inputs:["candidate.json","office-check.mjs"]`다. 같은 V의 검사가 여럿이면 id는 `V1`, `V1-2`다(`kitCheckIds`).
  - `candidate.json`: `{ digest, round }`
- 이 파일들은 처음 한 번만 쓴다(`wx`). 다시 열 때 내용이 다르면 `KIT_SOURCE_CHANGED`로 멈춘다. 그래서 중계나 프로필 모양을 바꾸는 Office 업데이트는, 이미 kit 폴더가 있는 작업 개정을 멈춘다. `candidate.json`만 round마다 임시 파일을 쓴 뒤 이름 바꾸기로 통째 바꾼다.
- `KitRoleRun`이 `root`를 받는다. 이 경우 cwd는 kit 폴더다. 환경은 `PATH=<Office node dir>:/usr/bin:/bin`, `GIT_DIR=<kit 폴더>/.no-git`(없는 경로라서 모든 git 호출이 실패하고, kit는 선언한 입력만 본다), `GIT_CEILING_DIRECTORIES=<부모>`다. `verify`의 CLI 제한은 30초, 나머지는 15초다. 완료 증거 경로는 프로젝트 기준이다.
- run 폴더: PM·Lead는 `.pazmo-office/kit-runs/<digest(id)>/`, 개발자·리뷰어는 `<kit 폴더>/runs/<digest(id)>/`다. 옛 `role-runs/`는 증거로 남는다.

## 5. Office: self-check 중계, 리뷰어 바인딩 (`kit-delivery.ts`, `coordinator.ts`)

- `beginSelfCheck`: `candidate.json`을 round candidate로 쓰고 self-check를 시작한다.
- `finishSelfCheck`: VM 결과마다 `.ai-workflow/evidence/office/<round>/<check id>.json`을 쓴 뒤 `graph verify`를 하고, 기존처럼 기록한다. kit는 한 attempt에서 같은 검사를 두 번 돌리지 않는다. 그래서 verify와 record 사이에 끊긴 self-check는 사람에게 간다(round가 사람 확인 상태가 된다).
- 중계: `candidate.json`의 round·digest와 같은 결과 파일을 읽어 출력을 그대로 낸다. `verdict === "pass"`, exit 0, signal·시간 초과·오류 없음일 때만 exit 0이고, 아니면 이유를 stderr에 쓰고 exit 1이다.
- `beginReview`·`verifyCompletion`: `candidate.json`을 round candidate로 쓴다. 리뷰어 run의 `targetSnapshot`이 여기에 묶인다.
- kit 4 작업: 이 개정에 접두어 `kit5:`가 없는 kit 배정이 있으면, coordinator가 실행기 자리를 잡기 전에 `KIT_UPGRADE_REQUIRED`로 멈춘다(`assertCurrent`). round가 있으면 그 사유로 남는다. 계획 단계는 옛 `role-runs/` PM run이 있을 때 멈춘다. 완료 증거를 이미 기록한 round는 `verifyCompletion`에서 kit 4 기록을 그대로 둔다.
- packet: kit `version: "5.0.3"`. 리뷰어 `input.reviewBudget`은 Office 값(1명, 하위 위임 없음)이다.

## 6. 시험

- 깨진 22개를 고쳤다.
- 새 시험:
  - storyHash = kit `storyContract`
  - 새 run은 v3, `kit-runs`에 있고 kit 4 파일은 그대로임
  - self-check 기록에 중계 실행 기록이 있음. 중계는 결과 없음, 다른 candidate, 실패, 시간 초과, 오류를 거부함. 같은 검사를 두 번 돌리면 거부함
  - 리뷰어는 사람의 커밋으로 `stale`이 되지 않고, candidate가 바뀌면 `stale`임
  - Task 밖 V 표시
  - 같은 V의 검사 둘
  - kit 4 작업은 두 번째 실행에서도 `KIT_UPGRADE_REQUIRED`
  - kit 4 완료 기록 유지
  - 계획 단계의 kit 4
  - 리뷰 예산
- 끝에 전체 `npm test`, `npm run typecheck`, Story 검사기를 돌리고 U30 replan `graph verify`를 한다.

## M/V 대응

- M3·V3: 역할 run 형식과 역할별 검사 기록
- M4·V4: 중계가 VM 결과만 넘김, candidate 바인딩, 옛 run 보존
- M8·V8: kit 역할 run과 작업 연결
- 실제 Office·VM·CLI로 v3 run을 돌려 보는 확인은 이 PR 밖이다(남은 것).
