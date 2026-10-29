# 2026-10-29 팀 Story 보드 2단계 (팀 Office 여러 repo) G4

Story: M16 · V18 · D24. 검증 기록: [2026-10-29-team-story-office-repos.md](2026-10-29-team-story-office-repos.md). 구현 계획: [2026-10-27-1730-feat-team-story-office-repos-plan.md](../plans/2026-10-27-1730-feat-team-story-office-repos-plan.md). kit graph: `.ai-workflow/runs/U21-team-story-office-repos.json`(상태 `g4`).

## 질문과 답 (2026-10-29)

컨트롤러가 G4 설명 페이지("팀 Story 보드", 2단계 G4판)와 대화로 증거를 먼저 보였다. 증거는 팀 Office의 모양, 30초 주기, 거절하는 것, 확인한 것과 못 한 것, 미뤄 둔 것 셋, 진행 중 컨트롤러가 정한 것이다. 그다음 세 질문과 선택지(① G4 승인 → 푸시·PR, ② 실제 확인 먼저, ③ 그대로 두기), 답 초안을 냈다. 앞선 G4들과 같은 방식이다. 사용자는 초안을 고치지 않고 이렇게 답했다.

> 피드백 확인 후 승인

사용자가 승인한 답(초안 그대로):

1. 동작: `team add --project`로 repo를 등록하고 `./office --team`으로 켜면, 팀 Office 하나가 등록 순서대로 담당 repo의 ready Task 하나를 가져와 기록하고 60초마다 하트비트를 보낸다. 한 번에 하나, 하루 기본 5개, `team pause`로 멈춘다. 가져온 Task를 실행하지는 않는다(3단계). `--team` 없이 켜면 Claw·lean Office는 지금과 같다.
2. 규칙과 실패: 같은 origin의 clone 두 개, 켜져 있거나 켜지는 중의 등록 변경, 등록된 repo의 단일 Office, 가진 Task가 있는 repo 빼기는 거절한다. 응답을 잃었거나 재시작했으면 같은 Task를 이어 받는다. "당신 것이 아님"이나 404를 받으면 기록을 버린다. Hub가 안 되는 repo는 건너뛰고, `gh` 로그인이 안 된 repo는 건너뛰고 5분마다 다시 확인한다. 폴더가 사라지면 `REPO_MISSING`으로 멈추고 `team remove`를 안내한다.
3. 증거: 전체 시험 1083/1083, 실제 CLI로 repo 두 개 켜기·상태·끄기(가짜 `gh`), 가짜 시계 시험, 변이 확인. 못 한 것: 실제 Hub에 시험 Story를 올려 돌리기, `up --team` 실제 실행, 다른 PC, 가져온 Task 실행.

선택: ① G4 승인 → 푸시·PR. 머지는 사용자가 말할 때 한다.

## 평가

Story, 결정 문서(G3 4장), diff, 시험과 비교했다.

| 항목 | 평가 |
| - | - |
| 동작 | 맞다. 등록·켜기·가져가기·하트비트·멈춤·하루 상한과, 2단계에서 실행하지 않는 점, `--team`이 없을 때 그대로인 점이 `src/team/`과 lifecycle 변경, `team-lifecycle` 시험과 맞는다. 다만 자기 말로 쓴 답은 아니다. |
| 불변 조건·실패 동작 | 맞다. 거절 코드 넷은 `src/team/registry.ts`, 이어 받기와 기록 버리기는 `src/team/scheduler.ts`의 inbox 복구와 claimId 확인, 건너뛰기와 5분 재확인은 `src/team/office.ts`, `REPO_MISSING`은 켜기 전 검사와 같다. 다만 자기 말로 쓴 답은 아니다. |
| 증거 범위 | 충분하다. 확인한 것(전체 시험, 실제 CLI 실행, 가짜 시계, 변이 확인, Task별·전체 리뷰)과 못 한 것(실제 Hub, `up --team`, 다른 PC, 실행)을 나눴다. |
| 선택 | ① 푸시·PR. 머지는 사용자가 직접 정한다. |

남는 한계: 답이 컨트롤러 초안을 그대로 승인한 형태라서, 자기 말로 쓴 답보다 근거가 약하다(D13 방식, PR #32·#35·#40 G4와 같은 형태). 이 답이 G4다.

## G4 뒤 변경

- main(#40, `b84d62d`)을 합쳤다(`45df698`). 충돌은 `docs/STATUS.md`의 항목 순서뿐이었다. #40은 claude 실행기의 멈춤만 바꾸고 팀 코드에는 닿지 않는다.
- 합친 커밋에서 다시 확인: root `npm test` **1092/1092** exit 0(OpenSSL 3.6.3이 PATH 앞, 다른 전체 실행 없음), `npm run typecheck` exit 0, Story 검사기 exit 0. kit graph U21은 그대로 `g4`다.
