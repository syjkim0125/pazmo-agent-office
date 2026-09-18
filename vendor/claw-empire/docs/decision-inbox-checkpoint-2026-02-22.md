# Decision Inbox Checkpoint (2026-02-22)

## 목적
- 프로젝트 단위 의사결정 흐름을 기존 작업 연장선으로 유지
- 불필요한 신규 회의/중복 업무 방지
- 의사결정 UI/문구 다국어 일관성 확보

## 반영된 핵심 변경
1. 프로젝트 리뷰 게이트
- 프로젝트 활성 항목이 모두 `review` 상태일 때 바로 팀장 회의를 시작하지 않고 Decision Inbox 승인 대기
- 승인 시에만 프로젝트 리뷰 회의 진행

2. 의사결정 Inbox API/클라이언트
- `GET /api/decision-inbox`
- `POST /api/decision-inbox/:id/reply`
- 클라이언트 의사결정 모달/회신 연결

3. 선택지 정책
- `대기 유지(keep_waiting)` 노출 제거
- 선택 의미가 없는 단일 항목 케이스는 `기존 작업 이어서 진행` 대신 바로 `팀장 회의 진행`
- 다국어(ko/en/ja/zh) 라벨/요약 문자열 정리

4. 추가요청(보완 라운드)
- `추가요청 입력` 시 기존 task의 subtask로 추가 요청 생성
- `review -> pending`으로 분기하여 보완 라운드 시작
- 가능하면 즉시 실행 재개, 불가 시 pending 사유 로그 기록

5. UI 개선
- 추가요청 입력을 `window.prompt`에서 모달 하단 입력 영역으로 변경
- 라이트/다크 모드에서 `요청 등록` 버튼 대비(시인성) 보정

## 확인된 동작
- 추가요청 입력값은 아래에 기록됨
  - `task_logs`: `Decision inbox follow-up request added: ...`
  - `subtasks`: `[의사결정 추가요청] ...` 또는 다국어 prefix
- 보완 라운드 분기/재실행 로그 확인
  - `Decision inbox: supplement round opened (review -> pending)`
  - `Decision inbox: supplement round execution started`

## 다음 작업 (OpenClaw 연동)
- 의사결정 항목 발생 시 OpenClaw Gateway wake 알림 전송
- 대상 이벤트
  - 프로젝트 의사결정 준비 완료(project_review_ready)
  - 타임아웃 후 재개 의사결정 필요(task_timeout_resume)
- 중복 방지 키를 적용해 과도 알림 방지
