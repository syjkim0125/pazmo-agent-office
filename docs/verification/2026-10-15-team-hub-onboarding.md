# 2026-10-15 팀 허브 합류·연결 붙여넣기 한 번 (A) 검증

Story: M12 · V14 · D20. 결정: [team-hub-onboarding-decision.md](../understanding/team-hub-onboarding-decision.md). 계획: [2026-10-15-1400-feat-team-hub-onboarding-plan.md](../plans/2026-10-15-1400-feat-team-hub-onboarding-plan.md).

## 구현 범위

- **허브:**
  - 팀원 단위 일회용 연결 코드(`hub_connect_codes`, 해시, 10분, 1회)
  - `pairAny`: 레포 단위 코드와 팀원 단위 코드를 함께 받는다.
  - origin으로 레포를 찾고, 없으면 등록한다(경로 끝 이름, 겹치면 `-2`).
  - 담당자가 아닌 레포는 거부하고 코드를 남긴다(트랜잭션 롤백).
- **허브 화면:**
  - `/start`: 세 단계 안내와 연결 문자열 만들기
  - `/connect`: 세션 없이 열리는 안내 화면이다. 코드를 다루지 않는다.
  - 초대·기기 링크로 합류하면 `/start`로 간다.
  - 메뉴에 "내 Office 연결"을 넣었다.
- **Office:**
  - `parseConnection`:
    - URL 형식은 fragment 키가 `c`와 선택 `fp`, 각각 한 번뿐이다. 지문은 32바이트 콜론 형식이다.
    - 옛 명령 형식은 https 원점만 받는다. 잘못된 `--fingerprint`는 거부한다.
  - `projectRemote`
  - 게이트웨이:
    - `link`/`unlink`/`status.repoName`
    - 실패 시 기존 설정을 그대로 둔다.
    - 허브 오류 코드는 그대로 두고 UI 문구로 바꾼다. 소켓 오류는 `HUB_UNREACHABLE`이다.
  - CLI `hub-link --connect`
- **Office 화면:**
  - 로컬 API `POST /api/hub/link`·`/api/hub/unlink`(CSRF). live가 아니면 `HUB_NOT_LIVE` 409.
  - 상단 "팀 허브" 버튼: 상태 점과 접근성 이름에 상태를 넣었다.
  - 연결 창:
    - 대상 호스트 표시
    - 교체·해제는 화면 안에서 확인
    - 새 레포 등록 안내, 해제 안내
  - `useHubStatus`: 첫 성공 전에는 null이고, 그 뒤 실패하면 마지막 값을 유지한다.
- **덤으로 고친 것:** U12 허브 진입점이 준비 완료 줄을 출력한 **뒤에** SIGTERM 처리기를 등록하던 순서를 바꿨다. 부하가 걸리면 `hub-bundle` SIGTERM 테스트가 간헐적으로 실패했다. 같은 프로세스 안에서 처리기가 0개임을 보이는 RED 테스트를 먼저 썼다(`tests/hub-main-signals.test.mjs`).

## 자동 검증 (2026-10-15, 작업 트리 기준)

| 검사 | 결과 |
|---|---|
| root `npm test` | 677/677 |
| root `npm run typecheck` | exit 0 |
| vendor vitest | 169/171. 실패 2건은 이전부터 실패하던 sprite-avatar(ReportHistory, TaskReportPopup)다. |
| vendor tsc app / node | exit 0 / exit 0 |
| `npm run build:office` | exit 0 |
| Story·Task 검사 | exit 0 |

Task별 RED/GREEN 증거는 SDD 원장의 Task 보고서에 있다.

## 리뷰

- **Task 1–4 리뷰:** 보안 관련 Task는 가장 강한 모델이 맡았다.
  - Task 3에서 Important 2건이 나왔고 고쳤다.
    - 소켓 오류 코드가 그대로 화면으로 새던 문제
    - 옛 명령 형식에서 잘못된 지문이 조용히 시스템 신뢰로 바뀌던 문제
  - 나머지 Task는 승인됐다. 사소한 항목은 고치거나 원장에 남겼다.
- **브랜치 전체 리뷰(보안 포함): Ready, Critical/Important 0.** 사소한 항목 5개를 한 번의 수정으로 반영했고, 재검토 결과 Approved다.
  - 새 레포 등록 표시
  - 지문·fragment 엄격화
  - 연결 전 대상 호스트 표시
  - 초록 점의 뜻과 해제 범위 문서화
  - `HUB_FINGERPRINT_NOT_USED` 화면 문구
- **남긴 것:**
  - 허브에서 레포를 지우는 기능이 없다. 잘못 자동 등록된 레포는 관리자가 담당자를 바로잡는다.
  - 상태 점은 "설정이 있음"을 뜻한다. 동기화 실패를 점에 반영하지는 않는다.
  - CLI `--fingerprint` 플래그는 엄격 형식 검사를 하지 않는다. 틀리면 지문 불일치로 실패한다.

## 아직 하지 않은 것 (G4 전)

- **실제 확인:** OpenShift 허브에서 다음을 해 본다.
  1. "테스트" 팀원을 초대하고 다른 브라우저로 합류한다.
  2. 시작 화면에서 문자열을 복사한다.
  3. 시험 Office 상단에 붙여넣어 연결한다. 레포는 자동 등록된다.
  4. app-be에서 보내기 → 수락 → 취소를 한 바퀴 돈다.
  - 이 확인에는 OpenShift 재배포와 Office 재시작이 필요하다. 둘 다 사용자 확인 후에 한다.
- **밝은 테마와 어두운 테마의 실제 브라우저 화면 확인**
- **G4:** 사용자 답변으로만 기록한다.
