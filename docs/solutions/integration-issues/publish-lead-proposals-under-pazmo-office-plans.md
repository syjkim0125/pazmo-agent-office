---
title: Publish Lead proposals under .pazmo-office/plans, not the project root
date: "2026-10-13"
category: integration-issues
module: Office proposal publication and contract paths
problem_type: integration_issue
component: service_object
severity: medium
symptoms:
  - "Every Lead proposal publication left an untracked office-plan-XXXXXX folder in the user's project root"
  - "Later planning snapshots and Engineer baselines included earlier proposal documents"
  - "Contract paths under any dot-prefixed folder, including Office's own .pazmo-office, were rejected with UNSAFE_PATH"
root_cause: scope_issue
resolution_type: code_fix
tags: [intake, publication, contract-paths, pazmo-office, protected-path, path-traversal, planning-snapshot, engineer-baseline]
---

# Publish Lead proposals under .pazmo-office/plans, not the project root

## Problem

`IntakeLedger.publish`는 Lead proposal을 게시할 때마다 사용자 project root에 `mkdtempSync(join(project, "office-plan-"))`로 폴더를 만들고 story.md/plan.md/task-N.md/verify-N.json(mode 0600)을 썼다. 이 폴더는 사용자 repo에 untracked로 쌓였고, 이후 planning snapshot과 Engineer baseline에 이전 proposal이 섞여 들어갔다. 수정은 branch `codex/office-plan-placement`에 있으며, 이 문서를 쓰는 시점에는 push/PR/merge 전이다(머지 후 PR 번호로 갱신).

## Symptoms

- eevee-be, pazmo-hub-test-backend, pazmo-office-live-pilot, ddokabeat 등 실제 사용자 repo root에 `office-plan-*` 폴더가 untracked로 쌓였다.
- `planningSnapshot`은 `git ls-files -z --cached --others --exclude-standard`로 파일을 모은다(`src/runtime/live.ts:310-317`). 그래서 untracked proposal 문서가 다음 planning 입력에 포함됐다.
- `freezeWorkspace`는 `readdirSync`로 tree를 직접 걷는다(`src/core/workspace.ts:88`). 그래서 scope include가 `"."`이면 이전 proposal이 worker baseline에 들어갔다.
- 자동화 테스트는 모두 통과하는 상태에서, 실제 Office를 사용자 checkout에 돌린 end-to-end 확인 때만 드러났다(session history).

## What Didn't Work

- **처음 발견했을 때 원인을 잘못 짚고 기록을 남기지 않음 (session history):** 2026-10-12 team hub 실제 확인 중 eevee-be에서 `office-plan-oPAk1v/`를 처음 봤다.
  - 의심한 곳은 `src/runners/kit-planning.ts`였다.
  - 결론도 후속 작업 기록도 남기지 않아서, 다음 날 다른 repo(pazmo-hub-test-backend)에서 같은 누출이 다시 나타났다.
  - 그때 원인 위치가 intake의 Lead proposal 게시 경로로 좁혀졌고, 별도 작업으로 분리됐다.
- **게시 후 삭제하거나 이동:** 문서는 임시 파일이 아니라 canonical 계약이다.
  - `contractMatches()`(`src/core/contracts.ts:266-274`)와 `contractDocuments()`(`src/core/contracts.ts:277-284`)가 같은 경로를 다시 읽고 digest를 비교한다.
  - 이 비교는 approval 요청 때와 매 dispatch(`roleContext()`, `src/core/store.ts:300-307`) 때마다 일어나므로, 등록한 뒤에는 지우거나 옮길 수 없다.
- **`.git/info/exclude`에 추가:** 세 가지 이유로 맞지 않는다.
  - Office는 `.git`에 쓰지 않는다는 원칙이 있고, `info/exclude`는 worktree 사이에 공유된다.
  - git listing에서만 숨길 뿐, `readdirSync` 기반 baseline에는 여전히 잡힌다.
  - 폴더가 쌓이는 문제 자체는 해결하지 못한다.
- **project 밖(dataDir)에 저장:** packaged kit checker의 `checkArtifact()`는 artifact가 project root 안에 있어야 한다(`.ai-workflow/bin/check.mjs:264-266`). vendor kit은 수정 대상이 아니므로 이 방법은 기각했다.
- **첫 구현에 탈출 회귀 테스트가 없었음:** 경로 규칙을 완화한 첫 버전은 prefix 탈출 사례를 검사하는 테스트 없이 나갔다. 독립 리뷰에서 다음 지적을 받았다. 나중에 리팩터링하면서 prefix를 떼기 전에 path를 normalize하면, traversal이 조용히 다시 열릴 수 있다.

## Solution

핵심은 kit이 아니라 Office 자신의 `read()`가 막고 있었다는 점이다.

- kit checker는 root 안이면 점으로 시작하는 디렉터리도 허용한다.
- Office도 이미 `kitSource()`에서 `.pazmo-office/approved-contracts/<digest>/`를 kit에 넘기고 있다(`src/core/store.ts:77`).
- 막힌 곳은 `.git`/`.env`를 막으려고 점으로 시작하는 segment를 모두 거부하던 `read()`였다.

**Before:**

```ts
// contracts.ts read()
!path ||
// ...
path.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith("."))

// intake.ts publish
noSymlinks(this.#project);
const directory = basename(mkdtempSync(join(this.#project, "office-plan-")));
```

**After** (`src/core/contracts.ts:37-53`, `src/core/intake.ts:635-639`):

```ts
/** Office's own plan folder is the only dot-prefixed location a contract may name. */
export const PLAN_ROOT = ".pazmo-office/plans";
function read(project: string, path: string): string {
  const local =
    typeof path === "string" && path.startsWith(`${PLAN_ROOT}/`)
      ? path.slice(PLAN_ROOT.length + 1)
      : path;
  if (
    typeof path !== "string" || !local || isAbsolute(path) ||
    path.includes("\\") || /[\x00-\x1f]/.test(path) ||
    local.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith("."))
  ) fail("UNSAFE_PATH", /* ... */);

// intake.ts publish
const plans = join(this.#project, PLAN_ROOT);
noSymlinks(plans);
mkdirSync(plans, { recursive: true, mode: 0o700 });
const directory = `${PLAN_ROOT}/${basename(mkdtempSync(join(plans, "plan-")))}`;
```

**바뀐 규칙:**
- 정확한 `PLAN_ROOT + "/"` prefix 하나만 떼어 낸다.
- 나머지 경로에는 기존 규칙을 그대로 적용한다. 빈 segment, `.`, `..`, 점으로 시작하는 segment, 절대경로, backslash, 제어문자는 모두 거부된다.
- 다음 세 곳 모두 project-relative 전체 경로를 쓴다.
  - receipt
  - Task의 `Story:`/`Plan source:` 치환
  - 실패 메시지("Unregistered documents are preserved at ...")

**새 코드 없이 해결된 것:**
- snapshot과 baseline 제외: `protectedPath()`가 이미 `.pazmo-office`를 보호하고(`src/core/candidates.ts:33-43`), `planningSnapshot`과 `freezeWorkspace`가 이 함수를 쓴다.
- 기존 작업 호환: 이미 등록된 root `office-plan-*` 경로는 점이 없으므로 같은 분기로 계속 읽힌다.
- 기존 폴더는 등록된 작업이 참조하므로 의도적으로 옮기거나 지우지 않았다.

## Why This Works

원인은 Office가 만든 파일을 Office 메타데이터 영역 밖에 둔 것이었다. `.pazmo-office/`는 snapshot과 baseline에서 이미 제외되는 영역이다. 그래서 그 아래로 옮기기만 해도 폴더가 쌓이는 문제와 이전 proposal이 새어 들어가는 문제가 함께 사라진다.

경로 완화는 정확한 prefix 하나에 대한 예외일 뿐이다. 나머지 경로는 기존 규칙을 그대로 통과해야 한다. 그래서 `.pazmo-office/role-runs`나 `.git`으로 빠져나가는 경로는 여전히 `UNSAFE_PATH`다. plans 안에 있는 symlink는 `noSymlinks`가 따로 거부한다.

남은 한계: `.pazmo-office/`를 gitignore하지 않은 repo에서는 그 폴더 하나가 여전히 untracked로 보일 수 있다. 이 부분은 별도 결정 사항으로 남겼다.

## Prevention

- **Office가 사용자 project에 만드는 파일은 `.pazmo-office/` 아래에 둔다.**
  - `protectedPath()`가 snapshot, baseline, worker 결과에서 이미 제외하므로 따로 exclude할 필요가 없다.
  - kit role-run 증거도 같은 원칙으로 `.pazmo-office/role-runs/`에 둔다([Record why planning output was rejected before spending recoveries](record-planning-rejection-cause.md)).
- **게시 후 project root에 새 항목이 없는지 테스트로 확인한다.**
  - `tests/intake-publication.test.mjs` 첫 테스트가 게시 후 root 목록이 `.pazmo-office`와 기존 파일뿐인지 단언한다.
  - 실제 확인 중 사용자 project root에 처음 보는 파일이 보이면, 지금 검증하는 기능과 무관해 보여도 바로 후속 작업으로 기록한다(session history).
- **경로 안전 규칙을 완화할 때는 탈출 사례 회귀 테스트를 함께 넣는다.**
  - 테스트 대상 경로는 실제로 존재하게 만든다. 대상이 없으면 "파일 없음"으로 실패해서, 경로 규칙이 아니라 파일 존재 여부를 검증하게 된다.
  - `tests/contracts.test.mjs` "Office plan documents are the only dot-prefixed contract location"이 다음 사례를 모두 존재하는 대상으로 검사한다.
    - `..`를 쓰는 탈출: `plans/../role-runs/x/story.md`, `plans/plan-a/../../role-runs/...`
    - 빈 segment와 `.`: `plans//`, `plans/./`, 맨 앞의 `./`
    - backslash
    - plans 안의 symlink: `../role-runs/x`와 `../../.git/x`를 가리키는 것
- **mutation 확인을 한다.**
  - 나머지 경로 검증을 건너뛰도록 코드를 바꿨을 때 위 테스트가 실패해야 한다.
  - 이번에는 `tests/contracts.test.mjs`의 테스트 9개 중 위 탈출 사례를 모두 담은 1개가 실패했다(파일 기준 8/9 통과). 원래 코드로 복구한 뒤 9/9가 되어, 테스트가 규칙을 실제로 고정한다는 것을 확인했다.
- **관련 회귀 테스트:**
  - legacy root plan 경로 호환: `tests/contracts.test.mjs` "contracts registered under legacy root plan folders stay readable"
  - snapshot/baseline 제외: `tests/intake-publication.test.mjs` "published plans stay out of planning snapshots and worker baselines". 게시 문서 경로 각각이 manifest에 없음을 직접 단언한다.
  - 실패 처리: "failed publication names the preserved plan folder and a symlinked plan root is refused". 보존된 경로를 메시지로 알리고, symlink된 plan root를 거부하는지 확인한다.

## Related Issues

- [Reject FIFO contract inputs before they can block the controller](../runtime-errors/nonblocking-contract-file-validation.md): 같은 `read()`의 다른 안전 규칙(regular file, `O_NONBLOCK`)이다.
- [Record why planning output was rejected before spending recoveries](record-planning-rejection-cause.md): Office 소유 파일을 `.pazmo-office/` 아래에 둔 선례다.
- [Bind the original baseline to the Engineer attempt](bind-engineer-baseline-to-attempt.md): 이번 수정이 의존하는 Engineer baseline 동작을 다룬다.
- [Root tests that start Office fail in a fresh worktree until the Office UI is built](../test-failures/fresh-worktree-tests-fail-without-office-ui-build.md): 새 worktree에서 이번 검증을 돌릴 때 필요한 준비다.
- Story와 검증 기록:
  - `docs/understanding/office-plan-placement-contract.md` (G1/G4)
  - `docs/verification/2026-10-13-office-plan-placement.md`
- 이전 동작의 원래 설계 기록: `docs/verification/2026-09-21-intake-publication.md` (역사 기록)
