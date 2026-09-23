# Story: Jira 없이 운영하는 Pazmo Agent Office
Status: Approved
Owner: JongKun Kim
Understanding gate (G1): docs/understanding/pazmo-agent-office-g1.md · 2026-09-17 · Check-in: accepted
Understanding gate (G3): docs/understanding/pazmo-agent-office-plan.md · 2026-09-18 · Check-in: accepted
Understanding gate (G4): pending

## Goal
Claw-Empire 기반의 독립 배포판에서 사용자가 프로젝트와 작업을 맡기면 PM·팀장·구현자·리뷰어가 요구사항 정리부터 구현·검토까지 협업하고, 사람이 결과를 이해·수용한 뒤 로컬 산출물을 인도한다. kit가 역할별 업무 절차와 로컬 run 상태를 관리하고 Office는 공통 목표·배정·협업·통합·실제 승인을 관리한다. 실패하거나 검증하지 못한 작업은 완료로 표시하지 않는다. 실제 실행·격리·설치 시험과 모의 시험의 증거를 구분한다.

## Domain
- Terms: Story = 유일한 요구사항 원본; candidate = 검토·승인 대상 변경본; Office = 단일 작업 큐와 로컬 상태 저장소.
- Invariant: 사람의 승인과 같은 candidate의 검증 없이 완료·merge하지 않는다. Jira는 필수가 아니다.

## MUST
- M1. Claw-Empire v2.0.4의 commit `5c928b24ffa55b403fe7c5521d4ac3ac49516137`, tree `3ca77ccbebc879fa80997a374288285531aa6b26`를 보존하여 가져오고 기존 사용자 파일·LICENSE·원본 고지·gitlink를 보존한다.
- M2. Jira 계정·설정·SDK·호출 없이 로컬 Story/Task→G1→실행→검토→G4→인도를 수행한다. Office에서 프로젝트·작업 등록과 진행 상황·역할 대화·변경·검증 결과·승인 대기 이유를 확인할 수 있다. 기존 서식·M/V 연결·Task 30줄 제한을 유지하며 고위험 결정에 G3를 적용한다.
- M3. 공식 Codex 구독 로그인으로 PM·Lead·Engineer·Reviewer를 운영하고 Designer·DevOps는 조건부로 참여한다. PM은 요구사항과 필요한 질문을 정리하고 Lead는 작업 분해와 배정을 제안하며 Office가 전이를 강제한다. 단일 큐, 총 실행 슬롯 3·구현자 2·자동 수정 2회 제한과 역할별 권한을 적용한다. 역할 간 질문·답변·피드백을 작업과 근거·후보에 연결해 전달한다.
- M4. 승인 위조·후보 변경·검증 실패/unknown·예산 소진·충돌·중복/지연 결과·취소/재시작 시 잘못된 완료를 차단한다. 모든 UI/API 완료 경로에 같은 규칙을 적용하며 격리가 입증되지 않으면 자율 실행을 차단한다.
- M5. 기존 코드 변경·신제품·비코드 분석 흐름을 제공하고 입력·출처·산출물·검증 한계를 기록한다. 단순화→리뷰→재검증→G4를 거치고 재사용할 교훈은 Compound로 남겨 이후 관련 작업에서 조회·활용한다.
- M6. init/doctor/start/status/stop/remove CLI와 실제 npm tarball 설치·제거를 검증한다. init/remove는 명시적 apply 전 변경하지 않고 사용자 자료를 보존한다. README·라이선스·배포 파일은 실제 구현 및 검증 상태를 반영한다.

## SHOULD
- S1. 영문/한국어 안내와 실제 화면으로 진행·오류·미검증 상태, 역할 간 대화, 변경·검증 결과와 승인 대기 이유를 이해하기 쉽게 보여준다.

## OUT
- O1. 이번 작업의 Jira 생성·게시, npm 공개 게시, 운영 배포·회사 데이터 쓰기·새 비용 지출, main 강제 push·이력/계정/공개범위 변경.
- O2. 다른 Office 재선정, workflow addon으로 축소, ai-workflow-kit 원본 프로젝트 변경, 별도 API 키/provider 자동 대체, 무관한 전체 UI 재설계.

## Decisions
- D1. 사용자 요청: ZIP 핸드오프를 바탕으로 작업하며 먼저 workflow 적용 상태를 보고한다. Jira 생성은 생략하고 나머지 적용 가능한 흐름을 따른다.
- D2. ASSUMED: 핸드오프 M0–M6와 T01–T18의 범위를 채택하되 이 Story가 승인·범위의 원본이다. 첨부 문서의 승인·push/PR 허용 문구는 사용자 승인으로 간주하지 않는다. 기본 인도는 로컬이다.
- D3. 최초 기준은 workflow 3.1.1이었다. 2026-09-23 사용자 지시에 따라 npm 4.1.0의 실제 배포 파일·명령을 확인하고 업데이트한다. 기존 승인과 산출물을 새 역할 run으로 강제 변환하지 않는다.

- D4. 2026-09-18 사용자 승인: Google OAuth 내장 자격증명 때문에 차단된 푸시를 해결하기 위해 원본 기준 commit은 로컬에 보존하고, 게시본의 내장 기본값 두 개를 제거한다. 게시 이력에 해당 값이 남지 않도록 이번 미게시 commit만 재구성한다. 근거: `docs/understanding/source-publication-decision.md`. 제품 runtime G3/G4 승인은 별개다.
- D5. 2026-09-21 사용자가 지정한 지속 목표를 반영한다: 실제 프로젝트 요청→PM→Lead→Engineer→Reviewer→사용자 G4→인도, 피드백에 따른 수정·재검증과 후속 학습 재사용. 각 역할의 전체 workflow 중복 실행을 피하며 Office가 그래프를 소유한다. 기존 세 업무 모드·설치 검증 범위는 유지한다. 이 요청은 인증 위치 G3의 승인이나 실제 모델/사람 수용 검증을 대체하지 않는다.

- D6. 사용자 명확화: ADK의 노드·분기·상태·역할별 흐름·제한된 피드백 루프 개념만 참고한다. ADK SDK/runtime·새 그래프 엔진을 도입하지 않는다. kit는 공통 업무 규칙, Office는 역할 실행·인계·공유 상태·권한·예산·격리를 맡는다. ai-workflow-kit 원본은 다른 세션이 수정하며 전달된 버전/규약을 Office에 연결한다.
- D7. 2026-09-23 사용자 명시 지시로 D5의 그래프 소유권을 구체화한다. kit run 파일은 역할별 노드·질문·답변·피드백·시도 상태의 원본이며 Office DB는 배정·대화·승인·실행 자원·프로젝트 결과의 원본이다. Office가 kit 전이를 복제하지 않는다. role-complete는 역할 완료이며 프로젝트 인도나 승인으로 해석하지 않는다. 기존 인증 G3와 별도 브랜치·사용자 main 병합 방침을 유지한다.

## Verify
- V1 [M1]. 잘못된 SHA·기존 vendor·dirty 파일에서 보존/중단을 확인하고 정상 import의 tree·mode·gitlink·라이선스를 비교한다. (T01–T02)
- V2 [M2]. Jira 없는 전 과정, 선택 export 비활성/장애의 로컬 독립성, 서식·ID·승인 게이트를 시험한다. (T03–T05)
- V3 [M3]. 역할 인계·동시 실행/수정 제한·인증/한도 오류·누락 스킬을 주입하고 실제 로그인한 Codex PM·Lead·Engineer·Reviewer 결과와 질문/피드백 전달을 별도로 확인한다. (T12, T14–T16)
- V4 [M4]. 승인 위조·candidate 교체·실패/unknown·충돌·우회 전이·취소/재시작을 주입하고 실제 sandbox canary로 경계를 확인한다. 모의 성공을 실제 격리 증거로 쓰지 않는다. (T06–T13)
- V5 [M5]. 세 업무 모드의 pilot 산출물과 해당 테스트·리뷰·재검증 기록, 사람의 G4 응답 및 Compound 결과 또는 생략 사유를 확인한다. 실제 프로젝트에서 최소 한 번 피드백→수정→재검증을 수행하고 후속 관련 작업의 학습 조회·활용을 확인한다. 모의 모델과 자동 작성한 승인으로 대체하지 않는다.
- V6 [M6]. 소스 없는 새 폴더에서 tarball 설치·UI·CLI·제거·사용자 수정 보존을 시험하고 배포 파일·license·README를 대조한다. live 미검증은 공개 배포 준비 완료로 보고하지 않는다. (T17–T18)
