---
title: Office metadata hides itself from Git with a self-ignoring .pazmo-office/.gitignore
date: "2026-10-14"
category: integration-issues
module: Office CLI install, start and remove (project metadata)
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "User repos without an ignore rule showed ?? .pazmo-office/ in git status after Office ran"
  - "git add -A would commit config.json and manifest.json with machine-local absolute paths plus Office records"
  - "First fix let remove --apply delete the ignore file while plans/ and other records remained, re-exposing them"
root_cause: incomplete_setup
resolution_type: code_fix
tags: [pazmo-office, gitignore, init, remove, manifest, user-repo, untracked-files, compatibility]
---

# Office metadata hides itself from Git with a self-ignoring .pazmo-office/.gitignore

## Problem

PR #19([Publish Lead proposals under .pazmo-office/plans](publish-lead-proposals-under-pazmo-office-plans.md))로 Office가 만드는 파일은 모두 `.pazmo-office/` 아래로 모였지만, 그 폴더 자체는 `.pazmo-office/`를 gitignore하지 않은 사용자 repo(예: app-be)에서 여전히 `?? .pazmo-office/`로 보였다. 이 폴더에는 machine-local 절대경로(`project`, `dataDir`)가 든 `config.json`/`manifest.json`(`src/cli/project.ts:180-185`, `src/cli/project.ts:201-213`), STORY.md/TASK.md 템플릿, 그리고 runtime 기록(`plans/`, `approved-contracts/`, `role-runs/`, `planning/`)이 쌓인다. 수정은 branch `codex/pazmo-office-gitignore`에 있으며, 이 문서를 쓰는 시점에는 commit/push/PR/merge 전이다(머지 후 PR 번호로 갱신).

## Symptoms

- `.pazmo-office/`를 ignore하지 않은 repo에서 `git status`에 `?? .pazmo-office/`가 계속 남았다(PR #19 문서의 "남은 한계").
- `git add -A` 한 번이면 다른 팀원에게 의미 없는 절대경로와 Office 기록이 그대로 commit된다.
- `protectedPath()`(`src/core/candidates.ts:33-43`)는 snapshot/baseline/worker 결과에서만 `.pazmo-office`를 제외한다. 사용자가 직접 쓰는 git 명령에는 아무 영향이 없다.

## What Didn't Work

- **사용자 root `.gitignore`에 한 줄 추가 (B, 기각):** 사용자가 commit해 둔 파일을 Office가 고치는 것이라 매번 diff로 보이고 사용자가 commit해야 한다(Story D1).
- **`.git/info/exclude` (C, 기각):** Office는 `.git`에 쓰지 않는다는 원칙이 있다(PR #19 문서와 같은 이유). worktree 사이에 공유된다는 문제도 같다.
- **문서로만 안내 (D, 기각):** repo마다 사람이 기억해야 하므로 누출이 반복된다.
- **ignore 파일을 manifest에 넣기:** `readManifest()`는 manifest의 file 집합이 정확히 `managedNames`(`config.json`, `STORY.md`, `TASK.md`)와 같아야 통과한다(`src/cli/project.ts:18`, `src/cli/project.ts:130-131`). `.gitignore`를 추가하면 기존 설치가 모두 `CONFLICT`로 실패한다. 그래서 파일을 manifest 밖에 둔다(`src/cli/project.ts:143`).
- **첫 구현: `remove()`가 ignore 파일을 일반 managed 파일처럼 지움:** 독립 리뷰가 실제로 쓰인 설치(`plans/` 등이 남은 상태)에서 재현했다.
  - `remove --apply`가 `.gitignore`를 지웠다.
  - 그 뒤 `git status`에 `?? .pazmo-office/manifest.json`과 기록들이 다시 나타났다. Story가 막으려던 바로 그 상태다.
  - 자동화 테스트는 기록이 없는 깨끗한 설치만 다뤄서 통과했다.

## Solution

핵심은 `.venv`/`.pytest_cache`와 같은 패턴이다. Office 폴더 안에 `*` 한 줄짜리 `.gitignore`를 두면 폴더 전체가 자기 자신을 숨긴다. 사용자 tracked 파일과 `.git`은 건드리지 않는다.

**Before:** `.pazmo-office/`에 ignore 파일이 없었다. `init()`은 managed 파일 3개와 manifest만 썼고, `start()`/`remove()`는 ignore를 다루지 않았다.

**After** (`src/cli/project.ts:143-158`):

```ts
// Outside the manifest so earlier installations stay valid.
const ignoreName = ".gitignore";
const ignoreText =
  "# Office metadata: machine-local paths and records. Never commit.\n*\n";
export function ignoreMetadata(p: Project): boolean {
  const path = join(p.directory, ignoreName);
  noSymlinks(path);
  try {
    writeFileSync(path, ignoreText, { flag: "wx", mode: 0o600 });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}
```

- `noSymlinks`가 symlink된 ignore 파일을 `UNSAFE_PATH`로 거부하고, `wx`는 경쟁 중에 생긴 symlink를 따라가지 않으며 사용자가 만든 파일을 절대 덮어쓰지 않는다(`EEXIST`면 `false`).

**설치 경로별 적용:**
- 새 설치: `mkdirSync` 직후, `config.json`보다 먼저 쓴다. 절대경로가 디스크에 닿기 전에 숨겨진다(`src/cli/project.ts:196-198`).
- 기존 설치 + `init --apply`: 파일을 만들고 `changed: true`를 보고한다. dry-run은 `wouldCreate: [".gitignore"]`로 알린다(`src/cli/project.ts:160-169`). 새 설치 dry-run도 목록에 포함한다(`src/cli/project.ts:175`).
- `start()`: UI build 확인 뒤에 호출하므로 예전 설치도 다음 start에서 파일을 얻는다(`src/cli/lifecycle.ts:131-133`). `./office` launcher도 매번 `init(p, true)`를 부른다(`src/cli/launcher.ts:210`).

**`remove()` 규칙** (`src/cli/project.ts:221-258`):

```ts
for (const name of managedNames) take(name, manifest.files[name]);
// Records Office leaves behind (and the manifest's local paths) stay hidden.
const left = readdirSync(p.directory).filter((n) => !removed.includes(n));
if (left.every((name) => name === "manifest.json" || name === ignoreName))
  take(ignoreName, hash(ignoreText));
else if (left.includes(ignoreName)) preserved.push(ignoreName);
```

- 공통 `take(name, expected)`는 regular file이고 bytes가 정확히 같을 때만 지운다(`src/cli/project.ts:226-243`). 사용자가 고친 ignore 파일은 `preserved`로 남는다.
- managed 파일을 먼저 처리한 뒤, 남은 항목이 `{manifest.json, .gitignore}`의 부분집합일 때만 ignore 파일을 지운다. 기록이 하나라도 남으면 ignore 파일은 `preserved`로 보고하고 유지한다.

## Why This Works

원인은 Office가 사용자 repo에 폴더를 만들면서 Git에서의 가시성을 사용자에게 맡긴 것이었다. Git은 하위 디렉터리의 `.gitignore`도 읽으므로, 폴더 안의 `*`는 그 폴더의 모든 항목(자기 자신 포함)을 untracked 목록에서 뺀다. 사용자 파일이나 `.git`을 수정하지 않으니 팀원 repo에는 아무 변화가 없다.

manifest 밖에 둔 덕분에 `readManifest()`의 정확한 집합 비교가 그대로 유지되고, 기존 설치는 `CONFLICT` 없이 init/start에서 파일을 얻는다. `remove()`는 "지킬 대상이 남아 있는 동안에는 가드를 치우지 않는다"는 규칙으로, 기록이 남은 설치에서도 manifest의 절대경로와 기록이 다시 드러나지 않는다.

검증: 전체 suite 591/591, typecheck exit 0. app-be를 `git clone --local`한 사본에서 init 직후, 기록 생성 후, remove 후 모두 `git status`가 깨끗했고 root `.gitignore` hash는 변하지 않았다(`docs/verification/2026-10-13-pazmo-office-gitignore.md`).

남은 한계:
- 이미 실행 중인 설치는 다음 `./office` 실행이나 stop+start 때 파일을 얻는다.
- 이미 commit된 `.pazmo-office` 파일은 ignore와 무관하게 계속 추적된다(범위 밖).

## Prevention

- **Office가 사용자 project에 만드는 것은 Office 스스로 Git에서 숨긴다.** 사용자 tracked 파일(root `.gitignore`)이나 `.git`(`info/exclude`)은 건드리지 않는다. 테스트는 사용자 파일 목록이 init/remove 전후로 같은지 단언한다(`tests/cli.test.mjs` "Office metadata hides itself from Git without touching the user's ignore files", "remove deletes only the ignore file Office wrote").
- **정리(cleanup)는 가드가 지키는 대상이 남아 있는 동안 가드를 지우지 않는다.**
  - "기록이 남은" 경우를 반드시 테스트한다. 깨끗한 설치만 테스트하면 첫 구현처럼 통과해 버린다.
  - `tests/cli.test.mjs` "remove keeps the ignore file while Office records remain"이 `plans/a.json`을 둔 채 `remove --apply` 후 `git status`에 `pazmo-office`가 없음을 단언한다.
  - mutation 확인: 조건 없이 항상 지우도록 바꾸면 이 테스트가 실패했다(파일 기준 14/15). 원래 코드로 복구한 뒤 15/15.
- **호환성에 민감한 파일은 정확한 집합을 비교하는 manifest에 넣지 않는다.** 새 Office 소유 파일을 추가할 때는 `readManifest()`의 `managedNames` 비교(`src/cli/project.ts:130-131`)를 먼저 확인하고, 기존 설치가 다음 실행에서 자연스럽게 파일을 얻는 경로(init/start)를 함께 둔다. 회귀 테스트: "an existing installation gains the ignore file and keeps its manifest", `tests/lifecycle.test.mjs` start 테스트(ignore 파일을 지운 설치가 start 후 다시 얻음).
- **사용자 파일은 덮어쓰지 않고 symlink는 거부한다.** "a user's ignore file is never replaced and a symlinked one is refused"가 `wx`/`noSymlinks` 동작을 고정한다.

## Related Issues

- [Publish Lead proposals under .pazmo-office/plans, not the project root](publish-lead-proposals-under-pazmo-office-plans.md): 이 문서가 닫는 "남은 한계"를 남긴 선행 작업이다.
- [Record why planning output was rejected before spending recoveries](record-planning-rejection-cause.md): `.pazmo-office/role-runs/` 기록의 출처다.
- [Root tests that start Office fail in a fresh worktree until the Office UI is built](../test-failures/fresh-worktree-tests-fail-without-office-ui-build.md): `start()` 테스트를 새 worktree에서 돌릴 때 필요한 준비다.
- Story와 검증 기록:
  - `docs/understanding/pazmo-office-gitignore-contract.md`
  - `docs/verification/2026-10-13-pazmo-office-gitignore.md`
