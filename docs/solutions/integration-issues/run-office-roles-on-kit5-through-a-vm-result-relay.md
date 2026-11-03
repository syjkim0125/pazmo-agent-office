---
title: Run Office role runs on kit 5 without host execution — a per-task kit folder, a candidate snapshot and a VM-result relay
date: "2026-11-03"
category: integration-issues
module: Office kit role-run adapter (kit-role-runs, kit-delivery, kit-planning)
problem_type: integration_issue
component: tooling
symptoms:
  - "After installing ai-workflow-kit 5.0.3, 22 of 1276 tests failed (coordinator 9, kit-role-runs 6, planning-coordinator 7)"
  - "init-role refused every role but PM with 'G1 approval binding changed or missing'"
  - "Developer and Reviewer init-role failed with ENOENT .ai-workflow/verification.json"
  - "A passing self-check record was refused with 'Verification execution required for V1.'"
  - "kit's own verify, run with Office's environment, failed with 'spawn npm ENOENT'"
  - "A Reviewer run went stale when the person edited a file in their own checkout"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [ai-workflow-kit, kit5, role-runs, verification, relay, snapshot, git-dir, vm-isolation, upgrade]
---

# Run Office role runs on kit 5 without host execution — a per-task kit folder, a candidate snapshot and a VM-result relay

## Problem

Office는 이 repo에 설치된 kit의 `graph.mjs`를 직접 불러 역할 run(PM·Lead·개발자·리뷰어)을 기록한다. 그래서 kit를 4.1.0에서 5.0.3으로 올리면 제품 동작이 바뀐다. kit 5는 v3 run 형식과 세 가지를 새로 요구한다.

- Story에 묶인 G1 JSON
- Story의 모든 V를 덮는 검증 프로필
- kit가 **호스트에서 직접** 돌린 검사의 실행 기록(receipt)

그리고 kit는 run이 있는 폴더의 코드 스냅샷에 리뷰·검증을 묶는다. Office의 규칙은 "agent가 만든 코드는 VM에서만 실행한다"이고, 검토 대상은 사용자 checkout이 아니라 고정된 candidate다. 그래서 그대로는 둘이 맞지 않았다(PR #65, D36).

## Symptoms

- 실험 사본에 5.0.3만 깔았더니 전체 시험 1254/1276, 실패 22개가 kit 역할 run 시험 세 파일에 몰렸다. 팀 모드와 `check.mjs` 시험은 그대로 통과했다.
- Office와 같은 호출 조건(cwd = 프로젝트, `PATH=/usr/bin:/bin`)의 탐침에서 다섯 가지가 차례로 막혔다.
  1. `G1 approval binding changed or missing`: Office의 `g1.json`에 `gate`·`storyHash`·`responseRef`가 없었다.
  2. 개발자·리뷰어 `init-role`에서 `ENOENT … .ai-workflow/verification.json`.
  3. self-check 통과 기록에서 `Verification execution required for V1.`
  4. kit `verify`를 Office 환경으로 돌리면 `spawn npm ENOENT`. kit는 상속한 환경 그대로 샌드박스 없이 명령을 돌린다.
  5. 사람이 자기 checkout의 파일 하나를 고치자 리뷰어 `status`가 `stale`이 됐다. kit가 사용자 repo(HEAD·index·파일)를 스냅샷했기 때문이다. 정작 그 스냅샷에는 Office가 검토한 candidate가 들어 있지 않았다.

## What Didn't Work

- **kit가 검사를 호스트에서 직접 돌리게 두기**: kit 5의 기본 방식이다. agent가 만든 코드를 Mac에서 사용자 권한으로 돌리게 되어 VM 격리 규칙을 깬다. G3에서 버렸다.
- **kit root를 사용자 repo로 두는 최소 변경**: kit 스냅샷이 검토한 변경이 아니라 호스트 checkout을 묶는다. 사람이 자기 repo를 고치기만 해도 리뷰가 무효가 되고, 실제 변경이 바뀌는 것은 감지하지 못한다.
- **`verify` 순간에 중계가 Office에게 VM 검사를 다시 시키기**(G3 선택지 ②): 보장 수준은 아래 해법과 거의 같다(둘 다 Office가 VM 결과를 전한다). 대신 검사 흐름을 다시 짜고 소켓 통신을 새로 만들어야 하며, kit의 검사 상한 300초 때문에 긴 검사를 거부해야 한다.
- **`GIT_CEILING_DIRECTORIES`만으로 git 막기**: 리뷰 1차에서 깨졌다. git은 ceiling을 디스크 표기(`getcwd()`)와 비교한다. 그래서 사용자가 입력한 경로의 대소문자가 다르거나(macOS) 경로에 `:`가 있으면, 부모 repo를 그대로 찾았다(리뷰어가 재현).
- **verify와 record 사이에서 끊긴 self-check를 자동으로 잇기**(`executed()` 건너뛰기): 실제로는 닿지 않았다. verify가 run 상태를 바꿔 revision token이 달라지므로, `continuation()`이 dispatch 영수증을 찾지 못하고 먼저 멈춘다. 지우고, 이 경우는 사람에게 넘긴다.

## Solution

1. **G1 JSON**: kit의 `canonicalStory` 규칙과 같은 해시를 계산한다(`kitStoryHash`, `src/core/kit-role-runs.ts:26`). Office의 실제 승인 이벤트에 `gate: "G1"`, `storyHash`, `responseRef: "office-approval:<challenge>"`를 붙인다(`kitG1`). Lead는 새 이름(`story.v3.md`·`g1.v3.json`)을 쓰므로, kit 4 파일은 그대로 남는다.
2. **작업별 kit 폴더**: 개발자·리뷰어 run은 `<project>/.pazmo-office/kit/<digest(kit5:task:revision:contract)>/`에서 돈다(`kitWorkspace`, `src/core/kit-role-runs.ts:90`). 폴더 내용은 다음과 같다.
   - Task 범위 Story 보기: 이 Task가 덮지 않는 V 줄은 `(outside this Task)`로 시작해서 kit가 ID로 읽지 않는다(`src/core/store.ts:64`).
   - 그 보기에 묶인 `g1.json`
   - 중계 `office-check.mjs`
   - `.ai-workflow/verification.json`: 등록 검사마다 `argv: ["node","office-check.mjs",<id>]`, `inputs: ["candidate.json","office-check.mjs"]`, `timeoutMs: 5000`(`:113`·`:119`). 같은 V의 검사가 여럿이면 id를 `V1`, `V1-2`로 나눈다(`kitCheckIds`, `:73`). kit는 id가 겹치는 프로필을 거부한다.
   - `candidate.json`: `{ digest, round }`. 임시 파일에 쓴 뒤 이름 바꾸기로 통째 바꾼다(`kitCandidate`, `:129`).
3. **git 차단**: kit 폴더에서 CLI를 부를 때 `GIT_DIR=<폴더>/.no-git`(없는 경로)와 `GIT_CEILING_DIRECTORIES`를 준다(`:345-346`). `GIT_DIR`이 없는 경로라 git 호출이 모두 exit 128이 되고, kit는 비 git 모드로 선언한 입력만 스냅샷한다. `PATH`는 `<Office node>:/usr/bin:/bin`(`:336`)이라 중계는 Office의 Node로 돈다. `verify`의 CLI 제한은 30초로, 중계 5초보다 넉넉하다(`:350`).
4. **VM 결과 중계**: 등록 검사는 지금처럼 VM에서 한 번만 돈다. self-check를 마칠 때 Office는 VM 결과를 `.ai-workflow/evidence/office/<round>/<id>.json`에 쓰고(`kitObservation`, `:146`), 검사마다 `graph verify`를 부른다(`src/runners/kit-delivery.ts:239`). 중계(`src/runners/kit-check-relay.mjs`)는 `candidate.json`의 candidate·round와 같은 결과를 읽어 출력을 그대로 낸다. 그 결과가 통과(verdict pass, exit 0, signal·시간 초과·오류 없음)일 때만 exit 0이다(`:25`). `process.exit` 대신 `process.exitCode`를 쓴다(`:37`). macOS에서는 파이프 쓰기가 비동기라, 바로 끝내면 출력이 잘린다.
5. **kit 4 작업**: 이 개정에 `kit5:` 접두어가 없는 kit 배정이 있으면, coordinator가 실행기 자리(lease)를 잡기 **전에** `KIT_UPGRADE_REQUIRED`로 멈춘다(`src/runners/coordinator.ts:108`, `kit-delivery.ts:58`). 확인 중인 round가 있으면 그 사유로 남는다. 완료 증거를 kit 4로 이미 기록한 round는 그 기록을 그대로 쓴다(`kit-delivery.ts:307`).

## Why This Works

- kit 5가 실제로 지키려는 것은 "통과 기록 뒤에 실행된 프로세스가 있다"와 "기록이 특정 코드 상태에 묶인다"이다. Office에서는 신뢰하는 호스트가 Office이고, agent는 VM 안에 있다.
- 그래서 실행 기록이 중계의 실행이어도 보장 수준은 같다. 중계는 Office가 같은 candidate·round로 기록한 VM 결과만 전한다.
- `candidate.json`(candidate 지문)과 중계 파일만 스냅샷 입력으로 두면, kit의 스냅샷 지문이 곧 Office의 candidate 지문이 된다. candidate가 바뀌면 `stale`이 되고(원하는 동작), 사용자가 자기 checkout을 고치는 것은 무관해진다.
- `GIT_DIR`은 경로 표기와 무관하게 git의 repo 탐색 자체를 끊는다. ceiling은 두 번째 장치로만 남는다.
- kit 4 확인을 lease 전으로 옮겼으므로, 다시 실행해도 같은 사유가 나온다. lease 뒤에 실패하면 lease가 unknown으로 남아, 다음 실행이 `PROCESS_LIVENESS_UNKNOWN`으로 보였다.

## Prevention

- kit를 올릴 때는 먼저 실험 사본에 새 kit와 `upstream/kit.lock.json` 해시만 바꿔 전체 시험을 돌린다. 그리고 Office와 같은 환경(cwd·PATH)으로 `init-role → start → record → verify → status`를 직접 부르는 탐침을 만든다. 시험이 숨기는 막힘(예: `spawn npm ENOENT`)이 이 탐침에서 드러난다.
- 이 해법을 붙드는 시험:
  - `tests/kit-role-runs.test.mjs`: 중계 거부 다섯 경우, 같은 검사의 두 번째 실행 거부, 사람의 커밋으로 stale이 되지 않는 리뷰어, kit `storyContract`와 같은 storyHash
  - `tests/coordinator.test.mjs`: kit 폴더·실행 기록, 같은 V 검사 둘, kit 4 멈춤과 두 번째 실행
  - `tests/planning-coordinator.test.mjs`: 계획 단계 kit 4
  - 돌연변이로 확인한 것: git 차단, id 번호, lease 전 확인 중 하나만 빼도 해당 시험이 실패한다.
- 남은 공백: 경로 대소문자·`:`를 쓰는 git 차단 시험은 없다(리뷰어 재현만). 실제 VM·claude/codex로 v3 역할 run을 돌린 확인도 아직 없다.
- kit 폴더 파일은 한 번만 쓴다(`writeOnce`). 그래서 중계나 프로필 모양을 바꾸는 Office 업데이트는, 이미 kit 폴더가 있는 작업을 `KIT_SOURCE_CHANGED`로 멈춘다. 중계를 바꿀 때는 이 영향을 함께 정한다.

## Related Issues

- PR syjkim0125/pazmo-agent-office#65 (D36). 결정: `docs/understanding/kit5-upgrade-decision.md`, 검증 기록: `docs/verification/2026-11-03-kit5-upgrade.md`
- [Keep workflow-graph evidence files immutable after recording a node](../workflow-issues/keep-workflow-graph-evidence-files-immutable.md): 같은 kit graph의 증거 고정 규칙. kit 5에서는 코드 스냅샷 고정이 더해졌다.
- [Office metadata hides itself from Git with a self-ignoring .pazmo-office/.gitignore](self-ignore-pazmo-office-metadata-folder.md): kit 폴더가 들어가는 `.pazmo-office/`. 그 글의 `role-runs/`·`approved-contracts/` 언급은 kit 4 시절의 배치다.
