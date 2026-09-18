# Claw-Empire v2.0.4 가져오기 — M0 실행 절차

**이 절차는 다음 세션의 권한 있는 로컬 작업 환경에서 실행한다. 준비 세션에서는 GitHub 쓰기가 403으로 거절되어 실행하지 못했다. 이 ZIP에는 Claw-Empire 전체 소스가 없다.**

목표는 원본 tracked tree를 `vendor/claw-empire/`에 보존하는 것이다. GitHub Fork 버튼이나 새 repository 생성은 필요 없다. `.git` 이력 전체, node_modules, 실행 데이터는 복사 대상이 아니다. 별도 gitlink의 외부 소스는 아직 초기화하지 않는다.

## 1. 대상과 작업 공간 확인

- 이미 clone한 `syjkim0125/pazmo-agent-office`가 있으면 그것을 읽고 사용자 변경을 보존한다. 다른 저장소에서 진행하지 않는다.
- 없으면 `git clone https://github.com/syjkim0125/pazmo-agent-office.git`로 전용 폴더에 clone한다. `--recurse-submodules`는 사용하지 않는다.
- `origin`이 요청한 저장소인지 확인하되, 자격증명이 포함된 remote URL을 로그에 출력하지 않는다. remote 주소를 토큰 포함 주소로 변경하지 않는다.
- 현재 HEAD/branch/작업 트리/기존 root LICENSE를 확인한다. 준비 시점에는 MIT LICENSE만 있었지만 다음 세션의 현재 파일을 우선한다.
- 작업 트리가 dirty면 해당 작업과 섞지 않는다. 사용자 수정이 없는 별도 worktree에서 시작하거나 충돌 범위를 보고한다. `reset --hard`, `clean -fd`, force push로 해결하지 않는다.
- 깨끗한 상태에서 `git switch -c bootstrap/claw-v2.0.4-v3`로 작업 브랜치를 만든다. 같은 이름이 있으면 내용을 확인하여 재개하고 덮어쓰지 않는다.
- 아래 스니펫은 **브랜치를 만든 뒤 대상 저장소 root에서** 실행한다. 먼저 읽고 확인한다. 중간 실패 시 index·worktree 상태를 확인한 뒤 재개하며 재실행으로 덮지 않는다.

## 2. 고정 tag를 fetch하고 원본 tree를 가져오기

```bash
set -euo pipefail

test -n "$(git branch --show-current)"
test "$(git branch --show-current)" != main
test -z "$(git status --porcelain)"
test -s LICENSE
test ! -e vendor/claw-empire
test ! -e .gitmodules

UPSTREAM_COMMIT=5c928b24ffa55b403fe7c5521d4ac3ac49516137
UPSTREAM_TREE=3ca77ccbebc879fa80997a374288285531aa6b26
ORIGINAL_LICENSE=$(git rev-parse HEAD:LICENSE)

git fetch --no-tags --depth=1 \
  https://github.com/GreenSheep01201/claw-empire.git \
  refs/tags/v2.0.4

test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "$UPSTREAM_COMMIT"
test "$(git rev-parse 'FETCH_HEAD^{tree}')" = "$UPSTREAM_TREE"

git read-tree --prefix=vendor/claw-empire/ -u "$UPSTREAM_TREE"
STAGED_ROOT=$(git write-tree)
test "$(git rev-parse "$STAGED_ROOT:vendor/claw-empire")" = "$UPSTREAM_TREE"
test "$(git rev-parse "$STAGED_ROOT:LICENSE")" = "$ORIGINAL_LICENSE"
test -s vendor/claw-empire/LICENSE

git ls-tree -r "$UPSTREAM_COMMIT" -- \
  tools/playwright-mcp tools/ppt_team_agent

git diff --cached --stat
```

`FETCH_HEAD`의 commit과 tree가 다르면 작업을 중단한다. 바뀐 tag를 자동 수용하거나 main으로 대체하지 않는다. `read-tree`는 내용을 index에 추가하므로 기존 staged 변경이 없는 사전 조건이 중요하다.

기존 `vendor/claw-empire`나 root `.gitmodules`가 있는 환경에서는 위 precondition이 실패하는 것이 정상이다. source와 lock이 이미 일치하면 import를 생략하고 기록한다. 기존 수정본을 초기 원본으로 되돌리지 않는다. root `.gitmodules`에 다른 항목이 있으면 보존하는 병합 변경을 별도로 검토한다.

## 3. gitlink를 root에서 찾을 수 있게 연결

위 스니펫이 root `.gitmodules` 부재를 확인한 경우에만 다음을 추가한다. vendor 안의 원본 `.gitmodules`는 변경하지 않는다.

```bash
cat > .gitmodules <<'EOF'
[submodule "claw-empire/tools/ppt_team_agent"]
	path = vendor/claw-empire/tools/ppt_team_agent
	url = https://github.com/GreenSheep01201/ppt_team_agent
[submodule "claw-empire/tools/playwright-mcp"]
	path = vendor/claw-empire/tools/playwright-mcp
	url = https://github.com/microsoft/playwright-mcp.git
EOF

git add -- .gitmodules
STAGED_ROOT=$(git write-tree)
test "$(git rev-parse "$STAGED_ROOT:vendor/claw-empire")" = "$UPSTREAM_TREE"
test "$(git rev-parse "$STAGED_ROOT:LICENSE")" = "$ORIGINAL_LICENSE"
git diff --cached -- .gitmodules
```

gitlink 기대값:

| vendor 상대 경로 | 고정 commit |
|---|---|
| `tools/playwright-mcp` | `066e54b6eac6af877924fcba38d7a34d3ee39329` |
| `tools/ppt_team_agent` | `cfe7781859de9796ede69b9130a5ec69a0fc139b` |

이 단계는 참조를 보존할 뿐 외부 component를 설치하지 않는다. 필요한 때만 해당 commit의 LICENSE와 하위 의존성, 실행 script를 검토한 후 선택적으로 초기화한다. 모든 submodule을 가져오거나 Remotion/PPT 도구를 설치하는 일을 첫 import에 섞지 않는다.

## 4. import만 별도 commit으로 고정

staged 변경이 vendor snapshot과 새 root `.gitmodules`뿐인지 확인한 뒤 실행한다. Git 작성자 정보가 없다면 사용자의 지정 정보를 사용하며 임의의 사람 이름을 만들지 않는다.

```bash
git commit -m "chore: import Claw-Empire v2.0.4 source snapshot"
test "$(git rev-parse HEAD:vendor/claw-empire)" = "$UPSTREAM_TREE"
test "$(git rev-parse HEAD:LICENSE)" = "$ORIGINAL_LICENSE"
git status --short
```

이 commit ID가 원본 import의 증거다. 이후 vendor 수정 때문에 tree가 달라지는 것은 허용되지만, 이 baseline과 수정 목록을 보존해야 한다. Git tree 일치는 tracked 내용·모드·참조가 동일하다는 검사이며, 실제 실행이나 안전성의 증거가 아니다.

## 5. README·서식·출처 문서를 배치

- 첨부 `repository-files/`에서 대상에 없는 파일을 경로대로 복사한다. 현재 파일이 있으면 diff를 검토하며 보존/병합한다. 전체 디렉터리를 강제로 덮어쓰지 않는다.
- root LICENSE는 동봉하지 않았다. 대상에 이미 있는 MIT LICENSE와 `Joshua` 명의를 보존한다. vendor의 Apache 원문과 kit 재사용분의 MIT 고지는 별도로 유지한다.
- `HANDOFF-v3.md`를 `docs/HANDOFF-v3.md`, 이 파일을 `docs/IMPORT-UPSTREAM.md`로 복사한다. 그러면 README의 상대 링크가 연결된다.
- `upstream/claw-empire.lock.json`의 `import_status: pending`은 준비 당시 사실이다. **실제 tree 확인 후에만** `verified`로 갱신하고 import commit·검사 명령·관측 결과를 기록한다. `verification.build`, `verification.tests`, `verification.codex_live`, `verification.npm_install`은 각 시험을 실행하기 전 `not_run`을 유지한다.
- README의 `Source import: Pending`은 source 검증 후에만 갱신한다. Pazmo 역할 제어·안전 gate·npm 배포가 완료된 것으로 함께 바꾸지 않는다.
- 템플릿과 kit license는 Git blob hash를 비교한다. 의도적으로 원본 내용이 달라졌다면 source와 변경 사항을 별도 기록한다.
- 문서·서식 반영은 import와 다른 commit으로 남긴다. 이것이 아직 제품 workflow 구현은 아니다.

## 6. 원격 반영과 baseline 실행

권한 있는 세션에서 작업 브랜치를 push하고 `main` 대상 PR을 만든다. main 강제 push·기존 이력 교체는 하지 않는다. GitHub 연결이 403이면 local commit과 diff를 남기고 차단 사실을 보고한다. 다른 계정/통로를 사용해 거부된 권한을 우회하지 않는다.

이후에만 upstream 설치·predev/prestart·migrate·auto-update script와 lockfile을 검토한다. frozen dependency 설치, loopback·격리 DB의 baseline build/test를 실행해 upstream 실패와 새 회귀를 구분한다. `pnpm dev`·`start`를 습관적으로 먼저 실행하지 않는다. README의 현재 지원 범위는 실제 명령과 결과에 맞춰 갱신한다.

M0 결과 보고: 정확한 release/commit/tree, target commit/branch/PR, 보존한 라이선스, submodule 초기화 여부, 실행한 검증, 아직 하지 않은 build·Codex·npm 검증. 다음 작업은 `HANDOFF-v3.md` M1이며 Office 선택 토론을 다시 시작하지 않는다.
