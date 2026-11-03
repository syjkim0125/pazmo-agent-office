# G3: kit 4.1.0 → 5.0.3, Office 역할 실행을 v3로 (D36)

Status: Approved
Understanding gate (G3): user conversation · 2026-11-03 · Check-in: accepted ("①로 진행", 설명 페이지 게시 후)
Story: pazmo-agent-office-contract.md (M3·M4·M8; V3·V4·V8; D24·D34·D35 P4; D36)
Builds on: 2026-11-02 순서 결정(A안: 3단계 먼저, 사용자 선택). 설명 페이지: https://claude.ai/artifact/TgVDwL5CSjBtqysv59AWFX

## 요청

Office 제품 코드는 이 repo에 설치된 kit 파일(`.ai-workflow/bin/graph.mjs`·`check.mjs`)을 직접 부른다. 그래서 kit를 4.1.0에서 npm 최신 5.0.3으로 올리면 Office가 역할(PM·Lead·개발자·리뷰어)을 실행하는 방식도 바뀐다. 5.0.0은 npm에 없고, 5.0.1의 깨지는 변화가 5.0.3에 그대로 있다. 5.0.2에는 D35 P2(intake 위험 렌즈)가 들어 있다.

## 조사 (main `226cbf1`, 실험 사본에만 설치)

- 전체 시험: 1254/1276 통과, 22개 실패(`coordinator` 9, `kit-role-runs` 6, `planning-coordinator` 7). 팀 모드와 `check.mjs` 시험은 모두 통과했다. 실행 시간은 167초였다.
- Office와 같은 조건(cwd = 프로젝트, `PATH=/usr/bin:/bin`)의 탐침으로 다섯 가지 막힘을 확인했다.
  1. G1 기록에 `gate`·`storyHash`·`responseRef`가 없다 → PM을 뺀 역할의 `init-role`이 거부된다.
  2. 개발자·리뷰어 run에는 kit root에 `.ai-workflow/verification.json`이 있어야 하고, 이 파일이 Story의 모든 V를 덮어야 한다.
  3. self-check는 kit `graph verify`의 실행 기록(receipt) 없이는 통과로 기록되지 않는다.
  4. kit의 검사 실행기는 호스트에서 상속한 환경 그대로, 샌드박스 없이 명령을 돌린다. Office 환경에서는 `spawn npm ENOENT`가 났다.
  5. kit 스냅샷은 run이 있는 폴더(지금은 사용자 repo)를 묶는다. 그래서 검토한 candidate가 아니라 호스트 checkout을 묶고, 사용자가 파일을 고치면 리뷰가 `stale`이 된다.

## 결정 (사용자 선택 ①)

- 새 역할 run은 v3(`kind: role`)다. 옛 v1·v2 run은 그 자리에 읽기 전용 증거로 남는다. v3 run은 새 폴더 이름을 쓰므로 옛 run과 섞이지 않는다.
- 개발자·리뷰어 run은 작업마다 따로 둔 kit 폴더(`.pazmo-office/kit/<작업·개정·계약 digest>/`)에서 돈다. 폴더 안에는 다음이 있다.
  - Task 범위 Story 보기: 이 Task가 덮지 않는 V 줄은 ID 없이 남긴다.
  - 그 보기에 묶인 G1 JSON(Office 실제 승인 이벤트).
  - Office 등록 검사로 만든 `verification.json`(검사 명령 = 중계).
  - candidate 지문 파일 `candidate.json`. 이것이 kit 스냅샷의 유일한 입력이다.
  - git이 부모 repo를 찾지 않게 `GIT_CEILING_DIRECTORIES`를 준다.
- 등록 검사는 지금처럼 VM에서 한 번만 돈다. Office는 그 결과(exit·출력·판정)를 kit 폴더의 `.ai-workflow/evidence/office/<round>/<check>.json`에 쓴다. 그다음 검사마다 `graph verify`를 부른다. 중계 명령은 `candidate.json`의 candidate·round와 같은 결과가 있고 통과했을 때만 exit 0이다. 결과가 없거나 다른 candidate면 실패한다.
- PM·Lead run은 지금 자리(프로젝트 root)에 두고, G1 JSON만 kit 5 형식으로 바꾼다.
- 팀 모드의 머지 직전 재검증은 Office가 맡는다(D34). kit 실행 기록으로 바꾸지 않는다.
- P4(repo 기본 검사를 Task 검증에 더하기)는 다음 PR에서 한다.

## 버린 것

- ② kit가 `verify`를 부르는 순간 VM 검사를 돌린다: 보장 수준은 ①과 거의 같다(둘 다 Office가 VM 결과를 전한다). 대신 검사 흐름을 다시 짜고 Office와 중계 사이 통신을 새로 만들어야 하며, 300초 상한 때문에 긴 검사를 거부해야 한다.
- ③ Office를 4.1.0 사본에 고정한다: Office 역할 실행이 v3로 가지 않는다(이번 완료 조건 미충족).
- kit 기본 방식(호스트에서 직접 실행): "agent가 만든 코드는 VM에서만 실행한다"를 깬다.
- kit root를 사용자 repo로 둔다(최소 변경): kit 스냅샷이 검토한 변경이 아니라 호스트 checkout을 묶는다. 사람이 자기 repo를 고치기만 해도 리뷰가 무효가 된다.

## 지켜야 할 것

- agent가 만든 코드는 VM에서만 실행된다. kit가 호스트에서 돌리는 것은 Office의 중계뿐이다.
- 중계는 실행 기록을 만들어 내지 않는다. 같은 candidate·같은 round·같은 검사의 VM 결과가 통과했을 때만 성공한다.
- kit 스냅샷은 실제로 검사·검토한 candidate를 가리킨다. candidate가 바뀌면 그 리뷰·검증은 `stale`이다.
- 옛 run 파일과 옛 승인 보기 파일은 고치거나 지우지 않는다.

## 실패와 복구

- 중계 실패·실행 기록 누락·`stale`: kit가 통과 기록을 거부한다. Office는 지금처럼 그 단계를 실패로 다루며, 사람 확인이나 고치기로 간다.
- 진행 중이던 작업(옛 v1·v2 run이 있는 작업): `KIT_UPGRADE_REQUIRED`로 멈춘다(아래 "구현하며 바뀐 것"). 완료 증거를 이미 기록한 round는 그대로 G4로 간다.
- 되돌리기: PR revert로 된다. 그 사이 만든 v3 run은 4.1.0이 읽지 못하므로, 그 작업의 리뷰·검증을 다시 해야 한다.

## 구현하며 바뀐 것 (2026-11-03, 사용자에게 보고)

진행 중이던 작업은 G3 때 기본값(ASSUMED)으로 "리뷰·검증을 새 v3 run에서 다시 한다"고 적었다. 구현에서는 그렇게 하지 않고 **멈추고 사람에게 넘긴다(`KIT_UPGRADE_REQUIRED`)**. 옛 run 파일과 Office 기록은 그대로 둔다. 이유는 둘이다.

- Office는 사람 확인으로 멈춘 round를 자동으로 다시 돌리지 않는다("Explicit recovery is required").
- 리뷰를 다시 하려면 Office 장부에 있는 그 round의 리뷰 결과를 비워야 하는데, 그런 길이 없다. 만들면 새 복구 경로가 되어 이번 범위를 넘는다.

멈춘 작업은 취소하고 다시 만들면 kit 5로 진행한다. 멈춘 사유는 round에 `KIT_UPGRADE_REQUIRED`로 남고, 다시 실행해도 같다(실행기 자리를 잡기 전에 확인한다).

리뷰 1차 뒤에 더한 것: git 차단에 `GIT_DIR`(없는 경로)를 더했다. 경로의 대소문자가 다르거나 `:`가 있으면 ceiling만으로는 사람의 checkout을 막지 못했기 때문이다. 같은 V에 등록 검사가 여럿이면 kit 검사 id를 `V1-2`처럼 나눈다. 중계 파일도 스냅샷 입력이다. kit 폴더 파일은 한 번만 쓰므로, 중계나 프로필 모양을 바꾸는 Office 업데이트는 이미 kit 폴더가 있는 작업을 `KIT_SOURCE_CHANGED`로 멈춘다. 이미 G4를 기다리며 완료 증거를 kit 4로 기록한 round는 그 기록을 그대로 쓰고 멈추지 않는다.

## 이 repo의 개발 절차에 생기는 변화

- `.ai-workflow/verification.json`(자동 시험·타입 검사·Story 검사로 Story의 모든 V를 덮음)과 recipe를 둔다. 실제 확인(실제 로그인한 CLI, 실제 VM 경계)은 자동 검사로 증명하지 않는다.
- Story의 G1을 kit 5의 JSON 기록으로 바꾼다. Story를 고칠 때마다 G1을 새로 받아야 한다. 이번 답("①로 진행")을 D36이 들어간 Story의 G1으로 기록한다. 사용자가 고르기 전에 설명 페이지와 대화에서 이 사실을 봤다.
- G4 뒤에는 G4 JSON과 `graph.mjs delivery` 검사가 붙는다. kit 스냅샷은 HEAD를 포함하므로, 검증한 커밋 뒤에는 kit 출력(run·receipt·승인 JSON)만 더 커밋한다.

## 증거 계획

- 자동: 깨진 22개를 고치고 새 시험을 더한다.
  - G1 storyHash가 kit의 `storyContract`와 같은지.
  - v3 run 형식.
  - 중계의 성공·실패(결과 없음, 다른 candidate, 실패한 결과).
  - candidate가 바뀌면 `stale`, 호스트 repo가 바뀌어도 `stale`이 아님.
  - Task 범위 보기.
  - 옛 v2 run이 그대로 남는지와 진행 중 round의 이전.
- 끝에 전체 `npm test`(X/X), `npm run typecheck`, Story 검사기를 돌리고, U30 run의 `graph verify` 실행 기록을 남긴다.
- 실제 Office 실행(실제 VM·실제 CLI)으로 v3 run을 확인하는 일은 이 PR에서 하지 않는다. 남은 것으로 적는다.
