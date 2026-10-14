# 검증: Office 메타데이터 폴더를 git에서 숨김

Story: `docs/understanding/pazmo-office-gitignore-contract.md` (G1 2026-10-13)
Run: `.ai-workflow/runs/pazmo-office-gitignore.json` (최소 그래프: implement → workflow-review → workflow-verify)

## 바뀐 것

- `src/cli/project.ts`
  - `ignoreMetadata()`가 `.pazmo-office/.gitignore`를 만든다. 내용은 설명 주석 한 줄과 `*`이다.
  - 쓰기는 `wx` 플래그로 해서 이미 있으면 덮어쓰지 않는다. 쓰기 전에 `noSymlinks`로 경로를 검사한다.
  - `init()`
    - 새 설치: manifest 다음에 이 파일을 만든다.
    - 기존 설치를 `--apply`로 실행: 파일이 없으면 만들고 `changed: true`를 돌려준다.
    - dry-run: `wouldCreate`에 `.gitignore`가 포함된다.
  - `remove()`: 바이트가 Office가 쓴 내용과 정확히 같을 때만 이 파일을 지우고, 다르면 preserved로 남긴다. managed 파일과 같은 규칙이다.
  - manifest 형식은 바꾸지 않았다. 그래서 기존 설치가 그대로 유효하다.
- `src/cli/lifecycle.ts` `start()`: UI 빌드 확인 뒤 `ignoreMetadata(p)`를 호출한다. 이전 버전으로 설치된 프로젝트도 다음 시작 때 파일을 얻는다. `./office` 런처는 매번 `init(p, true)`를 거치므로 이 경로도 포함된다.
- 바꾸지 않은 것: 사용자 루트 `.gitignore`, `.git/`, vendor kit, 실행 중인 Office.

## TDD

| Verify | 테스트 | RED | GREEN |
|---|---|---|---|
| V1 [M1], V5 [M5], S1 | `cli` "Office metadata hides itself from Git without touching the user's ignore files" | 실패 | 통과 |
| V2 [M2] | `cli` "an existing installation gains the ignore file and keeps its manifest" + `lifecycle` start 테스트(파일을 지운 옛 설치가 start 후 파일을 얻음) | 실패 | 통과 |
| V3 [M3] | `cli` "a user's ignore file is never replaced and a symlinked one is refused" | 실패 | 통과 |
| V4 [M4], V5 | `cli` "remove deletes only the ignore file Office wrote" + `lifecycle`(remove 뒤 `.pazmo-office` 없음) | 실패 | 통과 |

RED: 새 테스트 4개와 수정한 start 테스트 1개, 합계 5개가 실패했다(`cli`+`lifecycle`: 35/40 통과).

## 실행한 검사 (Node v24.19.0)

- `cli`, `lifecycle`, `launcher` 테스트: 46/46
- 전체 `npm test`: 590/590, exit 0
- `npm run typecheck`: exit 0
- 실제 repo 확인(사용자 repo는 건드리지 않음): `~/Documents/eevee-be`를 scratchpad에 `git clone --local`하고, 이 브랜치의 CLI를 별도 data dir로 실행했다.
  - `init --apply` 뒤 `git status --porcelain`이 비어 있었다. `.pazmo-office/`는 `--ignored`에서 `!!`로만 보였다.
  - 루트 `.gitignore`의 sha1은 변경 전후 모두 `11e2405…`로 같았다.
  - `remove --apply`는 `.gitignore`까지 제거했고 폴더가 사라졌다.

## 리뷰 반영 (implement attempt 2)

독립 리뷰(`.ai-workflow/runs/pazmo-office-gitignore-review-1.md`) 결과는 Critical 0, Important 1, Minor 5다.

- **Important 1 (반영):** 문제는 쓰던 설치에 `remove --apply`를 하면 숨김 파일만 지워진다는 것이었다. 이때 기록 폴더와 `manifest.json`(절대 경로 포함)이 남아 다시 `git status`에 보인다.
  - 수정: 관리 파일을 처리한 뒤 남는 항목이 `manifest.json`과 `.gitignore`뿐일 때만 숨김 파일을 지운다. 다른 항목이 남으면 preserved로 둔다.
  - 테스트 추가: `cli` "remove keeps the ignore file while Office records remain".
  - mutation 확인: 항상 지우도록 바꾸면 이 테스트가 실패했다(파일 기준 14/15 통과). 원래 코드로 복구한 뒤 15/15.
  - M4와의 관계: M4는 "Office가 만든 것만 지운다"는 규칙이므로 이 수정과 충돌하지 않는다. Goal("폴더 전체가 git에서 사라진다")을 지키는 쪽으로 동작을 좁힌 것이다.
- **Minor 2 (반영):** 기존 설치에 dry-run을 하면 `wouldCreate: [".gitignore"]`를 보여 준다(S1).
- **Minor 3 (반영):** 새 설치에서 숨김 파일을 디렉터리를 만든 직후, config.json보다 먼저 쓴다.
- **Minor 4·5 (범위 밖, 기록만):** 기존 패턴과 같은 종류다.
  - Minor 4: `.gitignore`를 읽을 수 없으면(EACCES) remove가 중간 상태로 끝난다. 다시 실행하면 이어서 처리된다.
  - Minor 5: `.gitignore` 쓰기 실패가 start를 막는다. symlink면 UNSAFE_PATH로 막는 것은 M3에 맞다. `.pazmo-office`가 읽기 전용이라 EACCES로 막히는 경우는 기록만 했다.

재실행 결과 (attempt 2 이후): `cli`/`lifecycle`/`launcher` 47/47, 전체 `npm test` 591/591 exit 0, typecheck exit 0.

## 증명하지 못한 것

- 실제로 쓰고 있는 설치(eevee-be 등)에는 적용하지 않았다. 실행 중인 Office를 건드리지 않는다는 원칙 때문이다. 이 설치들은 다음 `./office` 실행이나 `start` 때 파일을 얻는다.
- 이미 git에 커밋된 `.pazmo-office` 파일이 있는 repo에서는, 추적 중인 파일이 계속 보인다(Story O2).
- 실행 중인 Office에서 `start`를 다시 호출하면 running 상태를 그대로 반환하므로 파일을 만들지 않는다. 다음 정지·시작 때 만들어진다.
