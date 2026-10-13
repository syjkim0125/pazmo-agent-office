# 검증: Lead 제안서 폴더를 .pazmo-office/plans/로 옮김

Story: `docs/understanding/office-plan-placement-contract.md` (G1 2026-10-13)
Run: `.ai-workflow/runs/office-plan-placement.json` (최소 그래프: implement → workflow-review → workflow-verify)

## 바뀐 것

- `src/core/intake.ts` 게시: `mkdtempSync(<project>/office-plan-)` 대신 `<project>/.pazmo-office/plans/plan-XXXXXX/`를 만든다. 영수증 `directory`와 Task의 `Story:`/`Plan source:` 줄, 실패 메시지가 이 프로젝트 상대 경로 전체를 가리킨다.
- `src/core/contracts.ts` `read()`: `.pazmo-office/plans/` 접두사 뒤의 나머지 경로에만 기존 규칙(빈 조각, `.`, `..`, 점으로 시작 금지)을 적용한다. 그 밖의 점 경로는 그대로 `UNSAFE_PATH`.
- 바꾸지 않은 것: 계획 스냅샷과 작업 트리 제외는 기존 `protectedPath()`가 `.pazmo-office`를 이미 보호 경로로 다루기 때문에 별도 코드 없이 성립한다. 기존 `office-plan-*` 폴더, vendor kit, 실행 중인 Office는 손대지 않았다.

## TDD

| Verify | 테스트 | RED (구현 전) | GREEN |
|---|---|---|---|
| V1 [M1] | `intake-publication` 첫 테스트: 루트 항목이 `.pazmo-office`와 기존 파일뿐이고, `directory`가 plans 하위 | 실패 (루트에 `office-plan-*` 생성) | 통과 |
| V2 [M2] | `contracts` "Office plan documents are the only dot-prefixed contract location": plans 허용, `.pazmo-office/role-runs/x`·`.pazmo-office/plans/.hidden`·`.git/x`·`.codex`·`.env`·`.pazmo-office/plans`·`.pazmo-office/plans/` 거부 | 실패 (plans 경로를 `UNSAFE_PATH`로 거부) | 통과 |
| V3 [M3] | `contracts` "legacy root plan folders stay readable" | 통과 (회귀 방지용) | 통과 |
| V4 [M4] | `intake-publication` "published plans stay out of planning snapshots and worker baselines": git 프로젝트에서 `planningSnapshot`과 `freezeWorkspace({include:["."]})` 결과에 `.pazmo-office` 항목 0개 | 실패 | 통과 |
| V5 [M5], S1 | 기존 "receipt insertion fails" 테스트(문서 보존, 작업 0건, 재시도 시 새 폴더) + 새 테스트: 실패 메시지에 `preserved at .pazmo-office/plans/…;`, `.pazmo-office`가 symlink면 `UNSAFE_PATH`이고 대상 폴더는 비어 있음 | 실패 | 통과 |

## 실행한 검사 (Node v24.19.0)

- `node --experimental-vm-modules --test tests/intake-publication.test.mjs tests/contracts.test.mjs` → 20/20 통과
- `npm run typecheck` → exit 0
- `npm test` 전체 → 552/552 통과, exit 0
  - 처음 실행에서는 524/552였다. 새 worktree에 Office UI 빌드가 없어서(`NOT_BUILT`) 생긴 실패다. `pnpm install --frozen-lockfile`과 `npm run build:office` 뒤 다시 실행해 552/552를 확인했다.

## 리뷰 반영 (implement attempt 2)

독립 리뷰(`.ai-workflow/runs/office-plan-placement-review-1.md`, Critical 0 / Important 1 / Minor 4) 반영:

- Important 1: V2 테스트에 접두사 탈출 경로를 고정했다. 대상은 `plans/../role-runs/x/story.md`, `plans/plan-a/../../role-runs/…`, `plans//…`, `plans/./…`, `./.pazmo-office/…`, 역슬래시, 그리고 plans 안의 symlink 두 개(`→ ../role-runs/x`, `→ ../../.git/x`)다. 대상 파일이 모두 실제로 있어서 경로 규칙만 거부 사유가 된다.
  - mutation 확인: 접두사 뒤를 검사하지 않는 느슨한 구현에서는 이 테스트가 실패했다(8/9). 원래 코드로 복구한 뒤 9/9.
- Minor 1: V4가 게시 문서 경로 각각이 스냅샷과 기준선에 없음을 직접 단언한다. 옛 위치인 `office-plan-*`도 함께 확인한다.
- Minor 2: V3는 읽기 경로(`readContract`, `contractMatches`)만 증명한다. 점이 없는 경로는 `read()`에서 이전과 같은 분기를 탄다.
- Minor 3, 4: 범위 밖으로 남긴다. 기존 코드와 같은 종류이고 회귀가 아니다.
  - Minor 3은 확인과 생성 사이의 경쟁 구간이다. 파일마다 쓰기 직전에 `noSymlinks`를 다시 검사하므로 문서 내용이 밖으로 쓰이지는 않는다.
  - Minor 4는 plans가 일반 파일이거나 권한 문제일 때 나는 Node 에러가 `OfficeError` 코드 없이 전파되는 점이다.

재실행 (attempt 2 이후): 관련 20/20, 전체 `npm test` 552/552 exit 0, typecheck exit 0.

## 증명하지 못한 것

- 실제 Office를 띄워 사람이 게시하는 흐름은 돌려 보지 않았다. 자동화 테스트(실제 operator CLI 게시 테스트 포함)로만 확인했다.
- 엔지니어가 예전 루트 `office-plan-*` 파일을 고쳐 diff에 섞일 수 있는지에 대한 가설은 검증하지 않았다. 이번 변경 뒤 새 제안서는 작업 트리에 들어가지 않는다.
- `.pazmo-office/`를 gitignore하지 않은 repo에서는 그 폴더 하나가 여전히 untracked로 보인다(Story O2, 별도 결정).
