# Story: Office 메타데이터 폴더가 사용자 repo의 git 상태에 나타나지 않는다
Status: Delivered
Owner: JongKun Kim
Understanding gate (G1): docs/understanding/pazmo-office-gitignore-g1.md · 2026-10-13 · Check-in: accepted
Understanding gate (G4): docs/understanding/pazmo-office-gitignore-diff.md · 2026-10-14 · Check-in: accepted
G4: PASS — git status에서 .pazmo-office가 사라지고 사용자 파일은 수정하지 않으며, 실제 사용 중인 설치에는 아직 적용되지 않았다고 재진술했다(에이전트 설명 후 재진술; remove 시 기록이 남으면 숨김 유지 규칙은 미재진술).

## Goal
지금은 .pazmo-office/를 gitignore하지 않은 repo에서 `git status`에 이 폴더가 계속 보이고,
`git add -A` 한 번이면 이 PC의 절대 경로가 든 설정과 Office 기록이 커밋된다. 바꾼 뒤에는
Office가 설치·시작할 때 이 폴더 안에 스스로를 숨기는 .gitignore를 두어, 사용자가 커밋한
파일을 하나도 고치지 않고도 폴더 전체가 git에서 사라진다. 사용자가 이미 둔 파일은 덮어쓰지
않고, 기존 설치는 그대로 인정된다. 테스트와 실제 repo의 `git status`로 확인한다.

근거(2026-10-13 코드 확인): `config.json`에 프로젝트·데이터 폴더 절대 경로가 들어간다(`src/cli/project.ts` `init()`).
`readManifest()`는 manifest 파일 목록을 정확히 대조하므로 새 파일을 manifest에 넣으면 기존 설치가 CONFLICT가 된다.
판단 자료: https://claude.ai/artifact/Upev2K4aYmQax5HRhKtSxa (2단계)

## Domain
- Terms: Office metadata area = Office가 사용자 프로젝트 안에 두는 자기 전용 폴더(.pazmo-office/)
- Invariant: Office는 사용자 프로젝트의 커밋된 파일과 .git을 수정하지 않는다

## MUST
- M1. 새 설치 후 .pazmo-office/.gitignore(내용 `*`)가 생기고, 그 repo의 git status에 .pazmo-office가 나타나지 않는다.
- M2. 이미 설치된 프로젝트도 Office를 실행(init/start)하면 같은 파일이 생기며, 기존 manifest는 CONFLICT 없이 그대로 인정된다.
- M3. .pazmo-office/.gitignore가 이미 있으면 내용과 관계없이 덮어쓰지 않는다. symlink면 거부한다(UNSAFE_PATH).
- M4. Office 제거(remove)는 Office가 만든 내용 그대로인 .gitignore만 지우고, 사용자가 바꾼 것은 보존한다. 다른 파일이 없으면 폴더도 지금처럼 정리된다.
- M5. 사용자 루트 .gitignore, .git/ 아래 파일은 바뀌지 않는다.

## SHOULD
- S1. dry-run(init without apply)이 이 파일도 만들 예정이라고 보여 준다.

## OUT
- O1. 사용자 루트 .gitignore 수정, .git/info/exclude 사용
- O2. 이미 커밋된 .pazmo-office 파일의 git 기록 정리(사람이 처리)
- O3. vendor kit 수정, 실행 중인 Office 변경

## Decisions
- D1. 2026-10-13 사용자 승인: 방식은 자기 숨김 .gitignore (선택지 A). B(루트 .gitignore 수정)는 사용자 커밋 파일을 바꾸고, C(.git/info/exclude)는 Office의 .git 비접촉 원칙과 충돌하며, D(안내만)는 repo마다 사람이 기억해야 해서 제외.
- D2. 2026-10-13 사용자 승인: 제거 시 Office가 만든 내용 그대로인 .gitignore만 지운다(M4).
- ASSUMED: 파일 내용은 `*` 한 줄과 설명 주석 한 줄이다(제거 시 이 정확한 내용일 때만 지움).
- ASSUMED: manifest 형식은 바꾸지 않는다(기존 설치 호환).

## Verify
- V1 [M1]. git init한 임시 프로젝트에 init → .gitignore 존재, `git status --porcelain`에 .pazmo-office 없음
- V2 [M2]. .gitignore 없는 기존 설치(옛 manifest)에서 init/start → 파일 생성, readManifest 통과
- V3 [M3]. 사용자 내용의 .gitignore가 있으면 그대로 유지, symlink면 UNSAFE_PATH
- V4 [M4]. remove → Office가 만든 .gitignore는 지워지고 폴더 정리, 사용자가 바꾼 것은 preserved로 남음
- V5 [M5]. 위 과정 전후 루트 .gitignore와 .git/info/exclude 바이트 동일
