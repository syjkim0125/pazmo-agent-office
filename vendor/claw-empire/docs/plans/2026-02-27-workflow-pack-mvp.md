# Workflow Pack MVP Implementation Plan

**Goal:** 개발 워크플로우 중심 구조를 유지하면서, `소설/보고서/영상 기획/웹서치+리포트/롤플레이` 수요를 동일한 오케스트레이션 엔진 위에서 처리한다.

**Architecture:** 기존 `task + meeting + messenger` 파이프라인은 공통 엔진으로 유지하고, 도메인별 차이는 `Workflow Pack` 설정(입력 스키마/프롬프트/검수/산출물)으로 분리한다.

**Tech Stack:** TypeScript 5.9, Express 5, React 19, SQLite (`node:sqlite`), existing settings + task orchestration routes

---

## 1. Product Scope (MVP)

### In Scope

- `workflow_pack_key` 기반 실행 모드 분기
- 세션별 기본 팩 지정(메신저 설정)
- 자동 라우팅 + 저신뢰도 시 확인 질문
- 팩별 필수 입력 수집(질문-응답 폼/대화)
- 팩별 산출물 템플릿 + QA 게이트

### Out of Scope (MVP 이후)

- 영상 파일 렌더링(실제 T2V 엔진 호출)
- 다단계 결제/요금제 과금
- 외부 번역 관리 SaaS 연동

### Success Metrics

- 팩 자동 분류 정확도 >= 85%
- 팩별 첫 응답 실패율 <= 5%
- 재요청률(같은 의도 재입력) 20% 이상 감소
- 완료 리포트 수신률(메신저/웹) >= 98%

---

## 2. Workflow Pack Model

```ts
type WorkflowPackKey = "development" | "novel" | "report" | "video_preprod" | "web_research_report" | "roleplay";
```

공통 필드(설정 저장):

- `key`: 팩 식별자
- `name`: 표시명
- `enabled`: 사용 가능 여부
- `input_schema_json`: 필수 입력 항목 정의
- `prompt_preset_json`: 시스템/역할 프롬프트
- `qa_rules_json`: 검수 규칙
- `output_template_json`: 결과 포맷
- `routing_keywords_json`: 라우팅 힌트
- `cost_profile_json`: 모델/토큰/라운드 제한

우선순위(실행 시 pack 결정):

1. 사용자 명시 전환(`/mode report`, UI 토글)
2. 세션 기본 팩(`messengerChannels.*.sessions[].workflowPackKey`)
3. 프로젝트 기본 팩(`projects.default_pack_key`)
4. 자동 라우터 추론
5. 글로벌 기본값 `development`

---

## 3. Data Model / Migration Plan

기존 구조를 최대한 유지하면서 확장:

### 3.1 New table

```sql
CREATE TABLE IF NOT EXISTS workflow_packs (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  input_schema_json TEXT NOT NULL,
  prompt_preset_json TEXT NOT NULL,
  qa_rules_json TEXT NOT NULL,
  output_template_json TEXT NOT NULL,
  routing_keywords_json TEXT NOT NULL,
  cost_profile_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);
```

### 3.2 Existing table extensions

```sql
ALTER TABLE projects ADD COLUMN default_pack_key TEXT NOT NULL DEFAULT 'development';
ALTER TABLE tasks ADD COLUMN workflow_pack_key TEXT NOT NULL DEFAULT 'development';
ALTER TABLE tasks ADD COLUMN workflow_meta_json TEXT;
ALTER TABLE tasks ADD COLUMN output_format TEXT;
```

### 3.3 Settings schema extension

- key: `messengerChannels` (기존 유지)
- 세션 객체에 optional 필드 추가:
  - `workflowPackKey?: WorkflowPackKey`
  - `workflowPackOverrides?: Record<string, unknown>`

---

## 4. API Design (MVP)

### 4.1 Pack catalog

- `GET /api/workflow-packs`
  - 모든 팩 목록 + enabled/config 요약 반환
- `PUT /api/workflow-packs/:key`
  - 팩 설정/활성 상태 수정

### 4.2 Routing preview

- `POST /api/workflow/route`
  - 입력: `text`, `sessionKey?`, `projectId?`
  - 출력: `packKey`, `confidence`, `reason`, `requiresConfirmation`

### 4.3 Session binding

- `PATCH /api/messenger/sessions/:sessionId`
  - 입력: `workflowPackKey`
  - 효과: 세션 기본 팩 저장

### 4.4 Task execution binding

- 기존 task/directive 생성 시 필드 추가:
  - `workflow_pack_key`
  - `workflow_meta_json`
  - `output_format`

---

## 5. Pack-by-Pack MVP Definition

### development

- 목적: 기존 개발회사형 워크플로우 유지
- 필수입력: 프로젝트/경로/지시문
- 산출물: task result + 보고서 + 의사결정
- QA: 기존 테스트/리뷰 게이트 재사용

### report

- 목적: 구조화 문서 생성
- 필수입력: 목적, 독자, 분량, 톤, 형식
- 산출물: `요약 -> 본문 -> 액션아이템`
- QA: 섹션 누락 시 자동 재생성

### web_research_report

- 목적: 웹서치 기반 근거 보고서
- 필수입력: 주제, 기간, 신뢰도 기준, 언어
- 산출물: 출처 링크 포함 보고서
- QA: 출처 없는 단정 문장 차단

### novel

- 목적: 소설/시나리오 작성
- 필수입력: 장르, 시점, 분위기, 분량, 등장인물
- 산출물: 시놉시스 + 본문
- QA: 캐릭터 일관성/톤 이탈 검사

### video_preprod

- 목적: 영상 제작 사전기획
- 필수입력: 플랫폼, 목표 길이, 타겟, 스타일
- 산출물: 콘셉트 -> 대본 -> 샷리스트 -> 편집가이드
- QA: 샷리스트 누락 시 실패

### roleplay

- 목적: 단순 대화형 역할 놀이
- 필수입력: 캐릭터 카드, 금지 규칙, 톤
- 산출물: 멀티턴 대화
- QA: 안전 규칙/캐릭터 붕괴 방지

---

## 6. Backend Implementation Tasks

### BE-1. Schema + seed

- 대상:
  - `server/modules/bootstrap/schema/base-schema.ts`
  - `server/modules/bootstrap/schema/*migrations*.ts`
  - 신규 `server/modules/bootstrap/schema/workflow-pack-seeds.ts`
- 완료 기준:
  - 신규/기존 DB 모두 migration 성공
  - `workflow_packs` 기본 6개 row seed

### BE-2. Runtime pack resolver

- 대상:
  - 신규 `server/modules/workflow/packs/resolver.ts`
  - 신규 `server/modules/workflow/packs/router.ts`
  - `server/modules/routes/collab/direct-chat.ts`
- 완료 기준:
  - 라우팅 우선순위 1~5 동작
  - confidence low 시 확인 질문 반환

### BE-3. Task binding + execution hooks

- 대상:
  - `server/modules/routes/ops/messages/directives-inbox-routes.ts`
  - `server/modules/routes/core/tasks/*`
  - `server/modules/workflow/orchestration.ts`
- 완료 기준:
  - task row에 `workflow_pack_key` 저장
  - 실행 프롬프트에 pack preset 반영

### BE-4. Pack QA gate

- 대상:
  - 신규 `server/modules/workflow/packs/qa-gates.ts`
  - `server/modules/workflow/orchestration/report-workflow-tools.ts`
- 완료 기준:
  - 팩별 검수 실패/재생성 루프 1회 지원

### BE-5. Settings/session 확장

- 대상:
  - `server/modules/routes/ops/settings-stats.ts`
  - `server/messenger/session-agent-routing.ts`
  - `server/gateway/client.ts`
- 완료 기준:
  - 세션 `workflowPackKey` 저장/조회/기본값 처리

---

## 7. Frontend Implementation Tasks

### FE-1. Type extension

- 대상:
  - `src/types/index.ts`
  - `src/api/*` (settings/task payload)
- 완료 기준:
  - `WorkflowPackKey` 타입, 세션 `workflowPackKey` 반영

### FE-2. Settings UI (팩 관리)

- 대상:
  - 신규 `src/components/settings/WorkflowPacksTab.tsx`
  - `src/components/settings/SettingsTabNav.tsx`
- 완료 기준:
  - 팩 활성/비활성 + 요약 표시

### FE-3. Messenger session UI 바인딩

- 대상:
  - `src/components/settings/GatewaySettingsTab.tsx`
- 완료 기준:
  - 세션별 기본 팩 선택 가능
  - 새 채팅 추가 모달에서도 팩 지정 가능

### FE-4. Chat mode UX

- 대상:
  - `src/components/ChatPanel.tsx`
  - `src/components/chat-panel/*`
- 완료 기준:
  - 현재 모드 뱃지 표시
  - `/mode` 또는 드롭다운으로 즉시 전환

### FE-5. 다국어 텍스트 정리

- 대상:
  - 신규 `src/i18n/workflow-pack.ts` (또는 기존 `t({ko,en,ja,zh})` 확장)
- 완료 기준:
  - 신규 UI 문구 4개 언어 지원

---

## 8. QA / Verification Tasks

### QA-1. Unit

- 서버:
  - `server/modules/workflow/packs/*.test.ts`
  - `server/modules/routes/collab/direct-chat.normalize.test.ts` 확장
- 프론트:
  - `src/components/settings/*workflow*.test.tsx`

### QA-2. Integration

- 시나리오:
  - 세션 기본팩 `roleplay`에서 일반 채팅
  - 같은 세션에서 `/mode report` 전환 후 보고서 태스크 생성
  - `web_research_report`에서 출처 누락 시 재생성

### QA-3. Regression

- 기존 `$` directive 흐름과 review decision inbox 영향 없음 확인
- 메신저 채널 분리 라우팅 유지 확인

### QA-4. Exit Criteria

- `pnpm run test` 통과
- `pnpm run test:e2e` 통과
- 수동 시나리오 6건 체크리스트 전부 통과

---

## 9. Delivery Phasing

### Phase 1 (Foundation)

- BE-1, BE-2, FE-1, FE-3, QA-1 일부
- 결과: 팩 선택/저장/기본 라우팅 가능

### Phase 2 (High-demand packs first)

- `report`, `web_research_report`, `roleplay`
- 결과: 실제 사용자 체감 기능 우선 제공

### Phase 3 (Creative packs)

- `novel`, `video_preprod`
- 결과: 크리에이티브 수요 대응

### Phase 4 (Hardening)

- 비용 상한, 라우팅 정확도, 분석 대시보드

---

## 10. Risks and Guardrails

- 리스크: 팩 분기 증가로 프롬프트 복잡도 상승
  - 대응: 팩별 preset 최소화 + 공통 템플릿 재사용
- 리스크: 웹서치 팩 환각/출처 누락
  - 대응: citation gate 강제
- 리스크: roleplay가 업무지시로 오탐
  - 대응: task intent classifier와 pack intent classifier 분리
- 리스크: UX 복잡도 증가
  - 대응: 세션 기본팩 + 현재 모드 뱃지 + 단일 전환 UX
