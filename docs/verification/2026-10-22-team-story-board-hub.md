# 검증 기록: 팀 Story 보드 1단계 (Hub, U17)

이 기록은 U17(M16·V18·D24 중 Hub 부분)의 자동 검사, 리뷰, 확인하지 않은 범위, G4를 담는다. 기준은 PR syjkim0125/pazmo-agent-office#29의 커밋 `bcb76df`이다. **Hub만 만들었고 Office는 아직 이 경로를 부르지 않는다. 그래서 팀원이 쓸 수 있는 상태가 아니며, V18의 실제 확인(Office 두 개·시험 repo 두 개)은 5단계 뒤에 한다.**

## 만든 것

- `src/hub/story-protocol.ts`: import 없는 순수 모듈이다. 다음을 담는다.
  - 한도 `LIMITS`
  - 브랜치 이름 `feature/story-<N>/base`, `feature/story-<N>/task-<M>`
  - 그래프 검사: 순환, 프로젝트 밖 repo, 같은 repo 파일 겹침의 순서 없음, 추가 시 기존 Task로의 의존 금지
- `src/hub/story-store.ts`의 `StoryBoard`: 프로젝트, Story 올리기(draft → open), Task 추가, 취소, 가져가기, 하트비트·보류, 풀기·다시 실행, 머지 잠금(잡기·내려놓기), 머지·실패 보고(재전송 안전), 늦은 머지 보고(R13), Story 검증·완료, 받은 일 목록을 맡는다.
- `src/hub/link-api.ts`·`run.ts`: `/api/link/story/*` 경로 22개(메서드 23개)를 연다(프로토콜 3). 기존 경로와 프로토콜 1·2는 그대로이고, 프로토콜 2 경로는 3도 받는다.

## 자동 검사 (2026-10-22, `bcb76df` 직전 트리 `d595316` + 문서)

- root `npm test` **765/765** (시작 721 + 새 44), `npm run typecheck` exit 0
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` exit 0
- 시작 기준: 새 worktree에서 vendor 화면을 빌드하기 전에는 692/721이었다. 실패 29건은 모두 "Build the Office UI before starting."이었다. `npm run build:office` 뒤 721/721이 됐다(환경 문제였고 코드 문제가 아니다).

## 리뷰

- **Task별 리뷰 5건:** 모두 Approved, Critical·Important 0
- **브랜치 전체 리뷰:** With fixes. 운영 Hub에 올려도 안전하다는 판단을 받았다. 표는 덧붙이기만 하고 여러 번 실행해도 같으며, 프로토콜 1·2는 그대로다. 받은 지적:
  - Important 5건
    - I1: 가져간 Task 다시 받기
    - I2: 머지 잠금 스스로 풀기
    - I3: 자기 claim의 끝난 Task에 NOT_YOURS를 주던 것, Story 검증 재전송
    - I4: PL이 푼 뒤의 늦은 머지 보고
    - I5: PL이 없을 때의 복구
  - Minor 10건
- **수정 묶음 1회 + 범위 재리뷰:** 10개 항목을 모두 반영했다. 다만 늦은 머지 보고 경로에서 새 구멍 N1을 찾았다.
  - N1: 스스로 잠금을 풀었거나 실패를 보고한 claim의 머지 보고가 받아들여졌다.
- **N1 수정(`d595316`) + 재리뷰:** 반영됐고, 새로 깨진 곳은 없다. 재현한 세 경우(A·B·C)가 수정 전 실패, 수정 후 통과한다.

## 실제 확인 (2026-10-22, OpenShift team-project)

- **배포:**
  - 사용자가 `oc login --web` 후 이 브랜치 worktree의 `npm run hub:bundle` 묶음으로 `oc start-build pazmo-hub`를 실행했다.
  - 묶음은 17개 파일이고, `story-protocol.ts`와 `story-store.ts`를 포함한다.
  - 빌드 `pazmo-hub-5`가 Complete됐다. 같은 묶음으로 중복 시작한 `pazmo-hub-6`은 취소했다.
  - 새 파드 `pazmo-hub-557c48fd6d-6stxp`가 오류 없이 떴다(`listening 0.0.0.0:8080`).
- **바깥 주소에서 부른 결과(데이터 쓰기 없음):**

  | 호출 | 응답 |
  |---|---|
  | `/healthz` | 200 |
  | `/api/link/story/inbox`, 프로토콜 3, 토큰 없음 | 401 `UNAUTHORIZED` |
  | `/api/link/story/inbox`, 프로토콜 2 | 426 `expected:"3"` |
  | `/api/link/work`, 프로토콜 2, 토큰 없음 | 401 (기존과 같음) |

- **기존 데이터와 연결(파드 안 SQLite 읽기 전용 조회):**
  - 기존 데이터: 팀원 2, repo 2, 요청 2, 살아 있는 연결 2
  - 가장 최근 연결 확인이 3초 전이다. 즉 기존 Office(프로토콜 2)가 새 Hub에 그대로 붙어 있다.
  - 새 표 8개가 생겼다: `hub_seq`, `hub_projects`, `hub_project_repos`, `hub_stories`, `hub_story_tasks`, `hub_story_appends`, `hub_task_deps`, `hub_task_events`. Story는 0개다.
- **주의:** 배포된 Hub는 머지 전 브랜치(`bcb76df`) 코드다. main과 달라지면 main에서 다시 묶어 올린다.

## 확인하지 않은 것

- 실제 Hub에서 새 경로로 데이터를 쓰는 동작(프로젝트·Story 만들기, 가져가기 등). 공유 Hub에 시험 데이터를 남기므로 사용자 확인 뒤에 한다.
- Office가 이 경로를 부르는 동작(2~5단계): 여러 repo, Story Task 모드, push·PR·자동 머지, PL 올리기, 화면
- 여러 PC, 회사 IT·보안 정책, 실제 GitHub Enterprise 브랜치·PR
- 미룬 항목(각 단계 계획에 넣음)
  - 2단계: story 표에 칸을 더하는 마이그레이션 장치
  - 4단계: Task 추가 전 base 만들기, 요청 크기 한도 1 MiB
  - 5단계: 목록 화면 데이터

## G4 (2026-10-22, 사용자 답변)

질문은 동작, 불변 조건 또는 실패 동작, 증거 범위 세 가지다. 컨트롤러는 질문과 설명만 했고 답은 사용자가 직접 썼다. kit 그래프(`.ai-workflow/runs/U17-team-story-board-hub.json`)는 implement·workflow-review·workflow-verify 기록 후 `action: g4`였다.

사용자의 첫 답:

> 몰라 알려줘

| 항목 | 평가 |
| - | - |
| 동작 | 답 없음. 컨트롤러가 설명했다. Hub가 프로젝트·Story·Task 그래프를 저장·검사하고, 담당 repo Task 가져가기(사람당 하나), 보류·풀기, 머지 잠금, 결과 기록, Task 추가, Story 검증·완료를 맡는다. Office가 아직 부르지 않아 팀원은 쓸 수 없다(2~5단계). |
| 불변 조건·실패 동작 | 답 없음. 컨트롤러가 설명했다. 동시에 가져가면 한 명만 받고 다른 쪽은 "없음"을 받는다. 사라진 담당자의 Task는 10분 뒤 보류로 보이고 저절로 풀리지 않는다. PL·관리자가 풀면 다른 사람이 가져가고, 돌아온 원래 Office는 "이제 당신 Task가 아님"으로 멈춘다. 같은 Story·repo 머지는 한 번에 하나이고, 잠금을 스스로 놓은 claim의 머지 보고는 거절된다(N1). |
| 증거 범위 | 답 없음. 컨트롤러가 설명했다. 확인한 것은 자동 시험 765/765, 타입·계약서 검사, 리뷰 Task별 5·전체 1·재리뷰 2, OpenShift 배포·호환·기존 데이터와 연결 유지다. 확인하지 않은 것은 실제 Hub 데이터 쓰기, Office 쪽(2~5단계), 여러 PC, 회사 IT 정책, 실제 GitHub Enterprise 브랜치·PR이다. |

사용자는 설명을 본 뒤 "피드백 확인 후 승인"이라고 답했다(D13 방식). 이 답이 U17의 G4다.
