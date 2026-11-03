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

- `kitStoryHash(text)`: kit `canonicalStory`와 같은 규칙이다(Status·Understanding gate·G4 줄을 빼고 trim한 뒤 sha256). kit의 `storyContract`와 같은 값인지 시험한다.
- `boundG1(view, approval)`: 기존 필드에 `gate: "G1"`, `storyHash`, `responseRef: "office-approval:<challenge_id>"`를 더한다.
- Lead(`kit-planning`): `story.v3.md`, `g1.v3.json`(새 이름; 옛 `story.md`·`g1.json`은 그대로)
- `store.kitSource`: 이 Office가 쓰는 전체 Story 보기도 같은 규칙을 따른다(`approved-contracts/<digest(v3:…)>`).

## 4. Office: 작업별 kit 폴더 (개발자·리뷰어)

- 위치: `<project>/.pazmo-office/kit/<digest(task:revision:contractDigest)>/`(`store.kitWorkspace`)
- 내용:
  - `story.md`: Task 범위 보기다. Verify 절에서 이 Task가 덮지 않는 V 줄은 `- (이 Task 밖) V3 …`로 ID를 지운다.
  - `g1.json`
  - `.ai-workflow/verification.json`: Task 등록 검사마다 `{ id, covers:[id], argv:["node","office-check.mjs",id], timeoutMs:20000 }`이고, `inputs:["candidate.json"]`
  - `office-check.mjs`: 중계 스크립트다(`src/runners/kit-check-relay.mjs`를 복사).
  - `candidate.json`: `{ digest, round }`
- 이 파일들은 처음 한 번만 쓴다(`wx`). 다시 열 때 내용이 다르면 `KIT_SOURCE_CHANGED`로 막는다. `candidate.json`만 round마다 다시 쓴다.
- `KitRoleRun`에 `root`를 받는다. 이 경우 cwd는 kit 폴더이고, 환경은 `PATH=<node dir>:/usr/bin:/bin`, `GIT_CEILING_DIRECTORIES=<kit 폴더의 부모>`다. 완료 증거 경로는 프로젝트 기준(`<root>/<path>`)으로 돌려준다.
- run 폴더: `.pazmo-office/kit-runs/<digest(id)>/`(v3 전용 새 이름이다. 옛 `role-runs/`는 증거로 남는다)

## 5. Office: self-check 중계, 리뷰어 바인딩 (`kit-delivery.ts`)

- `beginSelfCheck`: `candidate.json` = round candidate를 쓰고 self-check를 시작한다.
- kit 4 작업: 이 개정에 접두어 `kit5:`가 없는 kit 배정이 있으면 `KIT_UPGRADE_REQUIRED`로 멈춘다. 계획 단계는 옛 `role-runs/` PM run이 있을 때 멈춘다. 완료 증거를 이미 기록한 round의 `verifyCompletion`은 kit 4 기록을 그대로 둔다.
- `finishSelfCheck`: VM 결과마다 `.ai-workflow/evidence/office/<round>/<check>.json`을 쓴다. 이 attempt에서 아직 실행하지 않은 검사만 `graph verify`한 뒤 기존처럼 기록한다.
- 중계: `candidate.json`의 round·digest와 같은 결과 파일을 읽어 출력을 그대로 내보낸다. `verdict === "pass"`이고 exit 0이고 signal·시간 초과·오류가 없을 때만 exit 0이다. 그 밖에는 이유를 stderr에 쓰고 exit 1이다.
- `beginReview`·`verifyCompletion`: `candidate.json` = round candidate. 리뷰어 run의 `targetSnapshot`이 이 값에 묶인다.
- packet: kit `version: "5.0.3"`, 리뷰어 `input.reviewBudget`은 Office 값(리뷰어 1명, 하위 위임 없음)으로 바꾼다.

## 6. 시험

- 깨진 22개: 승인 JSON, kit 폴더, 중계로 고친다.
- 새 시험:
  - storyHash = kit `storyContract`
  - 새 run은 `version: 3`
  - self-check 기록에 실행 기록이 있고, 중계가 결과 없음·다른 candidate·실패 결과를 거부함
  - candidate를 바꾸면 리뷰어가 `stale`이 되고, 프로젝트 파일을 바꿔도 `stale`이 아님
  - Task 밖 V는 ID가 없음
  - 옛 v2 run 파일이 그대로 남고, 진행 중 round가 이전됨
  - 리뷰 예산을 바꿔 전달함
- 끝에 전체 `npm test`, `npm run typecheck`, Story 검사기를 돌리고 U30 `graph verify`를 한다.

## M/V 대응

- M3·V3: 역할 run 형식과 역할별 검사 기록
- M4·V4: 중계가 VM 결과만 넘김, candidate 바인딩, 옛 run 보존
- M8·V8: kit 역할 run과 작업 연결
- 실제 Office·VM·CLI로 v3 run을 돌려 보는 확인은 이 PR 밖이다(남은 것).
