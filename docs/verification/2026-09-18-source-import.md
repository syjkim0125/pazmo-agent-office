# 소스 반입 검증 — 2026-09-18

이 문서는 최초 원본 반입 시점의 기록이다. 이후 사용자 승인에 따라 게시본에서 자격증명을 제거했다. 현재 tree·테스트·이력 정리는 [게시 검증](2026-09-18-publication.md)을 참조한다. 원본 import commit은 로컬 보존 참조에서만 조회할 수 있다.

Scope: 계획 U1 / Story M1의 고정 원본 반입 checkpoint. 제품 동작·보안·전체 V1 통과를 뜻하지 않는다.

## 실제 반입
- Branch: `codex/bootstrap-claw-v2.0.4`.
- Import commit: `8e25d7c5ea42d03e202d1599338f3a76d61d05fe`.
- Upstream commit: `5c928b24ffa55b403fe7c5521d4ac3ac49516137` (v2.0.4).
- `git rev-parse 8e25d7c:vendor/claw-empire` → `3ca77ccbebc879fa80997a374288285531aa6b26`와 정확히 일치.
- 원본 tree의 내용·파일 mode·symlink·gitlink가 보존됨. import 당시 staged 665개 경로는 vendor snapshot과 root `.gitmodules`뿐이었다.
- root LICENSE blob은 초기 `518a023:LICENSE`와 동일. 원본 MIT copyright와 vendor Apache-2.0 LICENSE를 유지했다.
- `tools/playwright-mcp` gitlink: `066e54b6eac6af877924fcba38d7a34d3ee39329`.
- `tools/ppt_team_agent` gitlink: `cfe7781859de9796ede69b9130a5ec69a0fc139b`. 두 submodule은 초기화하지 않았고 폴더는 비어 있다.
- 기존 main checkout의 21개 파일은 반입 직전 SHA256 manifest와 일치한다. main에는 작업 공간 제외를 위한 `.gitignore`만 새로 추가했다. 그 외 기존 파일을 변경하거나 이 브랜치로 이동시키지 않았다.
- source import 직후 worktree는 clean. 문서·workflow 설치는 별도 후속 commit으로 남긴다.

## 설치·문서 검증
공식 npm 3.1.1의 검증된 패키지로 이 깨끗한 worktree에 workflow를 설치했다. 원래 checkout의 untracked 설정을 staging하지 않았다. 설치된 관리 파일 hash와 workflow skill 10개 파일이 기존에 검증한 공식 버전과 일치한다. 새 root AGENTS에는 bootstrap 상태 안내만 managed block 밖에 추가했다.

Story/Task와 kit MIT license의 Git blob은 `upstream/ai-workflow-kit.lock.json` 기대값과 모두 일치한다. 실제 명령·출력은 [workflow 검사 JSON](2026-09-18-workflow-checks.json)에 기록했다.

- workflow doctor: exit 0.
- Story checker: exit 0 (Status가 Delivered가 아니므로 G4 검사는 수행하지 않음).
- G1 checker: exit 0.
- U1 Task checker: exit 0, 30 non-empty line 제한 통과.
- 최초 Task 검사에서는 `Readiness: Ready`를 거부했다(exit 1). `Implementation-ready`로 수정한 뒤 다시 검사해 통과했다.
- source/라이선스/기존 파일/hash 비교 스크립트: exit 0.

## 실행 중 관측과 한계
로컬 shallow clone에서 fetch할 때 Git이 shallow root ref 갱신을 거부하여 FETCH_HEAD가 만들어지지 않았다. 작업 tree와 index는 변경되지 않은 채 중단했다. 이미 전송된 고정 commit/tree 객체를 직접 대조한 뒤 그 tree만 read-tree로 가져왔다. 잘못된 tag나 main으로 대체하지 않았다.

upstream source는 원본 그대로다. upstream 테스트·build·서버·Codex live·격리 canary·npm 설치 시험은 실행하지 않았다. 사용자 DB나 인증자료는 사용하지 않았다. source import hash 일치는 이 시험들의 대체 증거가 아니다.

ce-simplify-code는 vendor/공식 설치/문서만 있어 변경할 코드가 없었다. 코드 리뷰의 전체 upstream full 검토, U2–U8, G3/G4는 남아 있다. 실패 SHA·기존 vendor·dirty 대상에 대한 재사용 가능한 importer 실패 주입 시험도 후속 CLI 검증 범위에 남긴다.
