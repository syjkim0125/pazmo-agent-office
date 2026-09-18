# Server `@ts-nocheck` Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 서버 모듈의 `@ts-nocheck`를 전부 제거하고, 기존 런타임 동작을 변경하지 않은 상태로 엄격 타입체크를 통과한다.

**Architecture:** 기능 로직은 유지하고 타입/구조만 리팩터링한다. 대형 모듈은 먼저 공통 타입/컨텍스트 바인딩 유틸을 분리해 컴파일 오류 표면적을 줄이고, 파일 단위로 `@ts-nocheck` 제거 후 즉시 타입체크를 반복한다.

**Tech Stack:** TypeScript 5.9, Express 5, Node 22, SQLite runtime (`node:sqlite`), Vitest

---

### Task 1: 기준선 타입체크 확보

**Files:**
- Modify: `tasks/todo.md`

**Step 1: 타입체크 기준선 실행**

Run: `pnpm exec tsc -p tsconfig.node.json --pretty false`
Expected: exit code `0`

**Step 2: 현재 리스크 기록**

Run: `rg -n "^// @ts-nocheck" server/modules server/types`
Expected: `13`개 파일 식별

### Task 2: 저위험 파일부터 `@ts-nocheck` 제거

**Files:**
- Modify: `server/modules/workflow.ts`
- Modify: `server/modules/routes.ts`
- Modify: `server/modules/lifecycle.ts`

**Step 1: `@ts-nocheck` 제거**

**Step 2: 즉시 타입체크**

Run: `pnpm exec tsc -p tsconfig.node.json --pretty false`
Expected: 해당 파일 관련 신규 오류만 노출

**Step 3: 최소 수정으로 green**

- 타입 미해결 import 추가
- 콜백/유틸 인자 타입 보강
- 런타임 로직 변경 금지

### Task 3: 하위 모듈(Provider/Meeting/Coordination) 타입화

**Files:**
- Modify: `server/modules/workflow/agents/providers.ts`
- Modify: `server/modules/workflow/orchestration/meetings.ts`
- Modify: `server/modules/routes/collab/coordination.ts`

**Step 1: 공통 행/응답 타입을 로컬 인터페이스로 명시**
**Step 2: `ctx` 바인딩 함수 반환 타입 명시**
**Step 3: 타입체크 반복**

Run: `pnpm exec tsc -p tsconfig.node.json --pretty false`

### Task 4: 코어 오케스트레이션 파일 세분화

**Files:**
- Modify: `server/modules/workflow/core.ts`
- Modify: `server/modules/workflow/agents.ts`
- Modify: `server/modules/workflow/orchestration.ts`
- Create: `server/modules/workflow/shared/*.ts` (필요 시)

**Step 1: 컨텍스트 바인딩 블록 분리**

- 동일한 `const foo = __ctx.foo` 패턴을 helper 함수/모듈로 분리
- 로직 함수 본문은 복사-이동만 허용

**Step 2: 로직 함수 시그니처 타입 명시**

- `taskId`, `agentId`, `provider` 등 식별자 타입 통일
- `db.prepare(...).get/all` 결과 타입을 최소 구조로 명시

**Step 3: 타입체크**

Run: `pnpm exec tsc -p tsconfig.node.json --pretty false`

### Task 5: 라우트 파일 세분화 및 `@ts-nocheck` 제거

**Files:**
- Modify: `server/modules/routes/collab.ts`
- Modify: `server/modules/routes/ops/messages.ts`
- Modify: `server/modules/routes/ops.ts`
- Modify: `server/modules/routes/core.ts`
- Create: `server/modules/routes/shared/*.ts` (필요 시)

**Step 1: 메시지/인증/결정함수 헬퍼 분리**
**Step 2: Express 핸들러 바디 타입 좁히기 (`unknown` -> guard)**
**Step 3: 타입체크 반복**

Run: `pnpm exec tsc -p tsconfig.node.json --pretty false`

### Task 6: 검증 및 결과 기록

**Files:**
- Modify: `tasks/todo.md`

**Step 1: 최종 타입체크**

Run: `pnpm exec tsc -p tsconfig.node.json --pretty false`
Expected: exit code `0`, `@ts-nocheck` 0개

**Step 2: 테스트**

Run: `pnpm run test:api`
Expected: pass (환경 의존성 실패 시 원인과 우회 검증 기록)

**Step 3: 빌드**

Run: `pnpm run build`
Expected: pass (환경 의존성 실패 시 원인과 우회 검증 기록)

**Step 4: 산출물 점검**

Run: `rg -n "^// @ts-nocheck" server/modules server/types`
Expected: no match
