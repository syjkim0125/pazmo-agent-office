# G4 이해 확인 기록: Office 메타데이터 폴더 git 숨김

- 날짜: 2026-10-14
- 사람: JongKun Kim (현재 대화의 사용자)
- Story: `docs/understanding/pazmo-office-gitignore-contract.md`
- Graph: `.ai-workflow/runs/pazmo-office-gitignore.json`
  - `status`가 `action: g4`를 반환했다.
  - implement, workflow-review, workflow-verify 노드가 모두 완료됐다.

## 공개한 증거 (해설 없이)

- 검증: 전체 `npm test` 591/591 exit 0, typecheck exit 0, `check.mjs story`와 `gate G1` exit 0
- 실제 repo 확인: app-be를 로컬로 clone한 사본에서 확인했다.
  - init을 하고 기록 파일을 추가한 뒤, 그리고 remove 뒤에도 `git status --porcelain`이 비어 있었다.
  - 루트 `.gitignore`의 해시는 그대로였다.
- 리뷰
  - 1차: Critical 0, Important 1(remove 시 기록이 남으면 숨김 파일이 사라져 노출됨), Minor 5
  - 2차: 수정이 반영된 것을 확인했고 Ready to merge 판정을 받았다.
  - 기록: `.ai-workflow/runs/pazmo-office-gitignore-review-1.md`, `-review-2.md`
- 변경 규모: `src/cli/project.ts` +45/-11 (lifecycle 포함 src 합계), 테스트 2개 파일
- 원본 diff
  - `ignoreMetadata()`를 추가했다.
  - `init`의 세 경로(신규, 기존, dry-run)와 `start`에서 이 함수를 호출한다.
  - `remove`는 owned 규칙을 따르고, 남는 항목이 있으면 숨김 파일을 유지한다.

## 질문

"이 변경 뒤에 사용자가 겪는 일이 어떻게 달라질까요? 꼭 지켜야 할 규칙과 실패했을 때의 동작은 무엇인가요? 어떤 테스트가 그걸 확인했고, 아직 확인하지 못한 것은 무엇인가요?"

## 진행 방식 (예측 후 공개에서 벗어남)

사람이 먼저 예측하지 않고 "너가 알려줘"라고 요청했다. 그래서 에이전트가 먼저 설명했다. 설명한 내용은 다음과 같다.
- 동작 변화
- 불변 조건: 사용자 파일과 `.git`을 수정하지 않음, manifest 밖에서 관리, 이미 있는 파일은 덮어쓰지 않음
- 실패와 예외 경로: symlink는 `UNSAFE_PATH`로 거부. remove는 Office가 쓴 내용 그대로일 때만 지우고, 기록이 남아 있으면 숨김 파일을 유지함
- 증거의 경계

그 뒤 다음 세 가지를 한두 문장으로 다시 말해 달라고 요청했다: 동작, remove 때 숨김 파일이 남는 경우, 아직 확인하지 못한 것.

## 사람의 재진술

"git status에 이제 pazmo-office/가 안보여 / 사용자 파일은 고치지 않아야 해. / 실제 사용 중인 설치에는 아직 적용 못함"

평가:
- 맞음
  - 동작(M1): `git status`에서 사라진다.
  - 불변 조건(M5): 사용자 파일을 수정하지 않는다.
  - 증거의 경계: 실제 사용 중인 설치에는 아직 적용하지 않았다.
- 빠짐: remove 때 Office 기록이 남으면 숨김 파일을 유지하는 규칙(M4 보강)은 다시 말하지 않았다. 핵심 공백으로 보지는 않는다. G4 기준인 "동작, 불변 조건 또는 실패 경로 하나, 증거의 경계"는 충족했다.
- 틀림/위험: 없음

## 경계

G4는 구현을 이해했다는 확인이다. 커밋, 푸시, PR, 머지를 승인한 것은 아니다.
