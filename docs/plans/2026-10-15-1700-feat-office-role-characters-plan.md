# Office 캐릭터 역할 중심 정리 (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office 화면에는 PM·Lead·Engineer·Reviewer 역할을 맡는 캐릭터와 지금 일하는 캐릭터만 보이고, 역할 캐릭터는 역할 이름으로 표시된다. DB의 에이전트 행은 바꾸지 않는다.

**Architecture:**
- **서버(Office):** 역할마다 실제로 고르는 에이전트 id를 읽기 전용 API `GET /api/office-roles`로 낸다. 기존 `agent(role)` 함수를 그대로 쓴다.
- **화면:** 순수 함수 `applyOfficeRoles`가 App 한 곳에서 에이전트·부서 목록을 걸러 내고 표시 이름을 바꾼다. 이 결과를 모든 하위 화면이 같이 쓴다.
- **새 DB:** 시드에 `pazmo-pm`을 더한다.

**Tech Stack:** Node 24.19(`node:test`, `node:sqlite`), vendored React + vitest.

**Spec:** `docs/understanding/office-role-characters-decision.md`, Story M13 / D21 / V15.

## Global Constraints

- 역할 키는 `pm`, `lead`, `engineer`, `reviewer`다. 서버 응답은 `{ roles: { pm: string|null, lead: string|null, engineer: string|null, reviewer: string|null } }`이다. 값은 `agent(role)` 결과와 같아야 한다.
- 표시 이름(ko / en):
  - `pm`: PM / PM
  - `lead`: 리드 / Lead
  - `engineer`: 개발 / Engineer
  - `reviewer`: 리뷰 / Reviewer
- 한 캐릭터가 여러 역할이면 위 순서로 ` · `로 잇는다. 예: `PM · 리드`. 표시 이름은 화면에서만 바꾼다. `name`·`name_ko` 필드를 바꾼 사본을 쓰고, 원래 이름은 `original_name`(표시용 추가 필드)에 둔다.
- 보이는 캐릭터는 역할 캐릭터와, `status === "working"`이거나 `current_task_id`가 있는 캐릭터다. 보이는 부서는 보이는 캐릭터가 한 명 이상 있는 부서다.
- 역할 API를 한 번도 받지 못했으면(미리보기·옛 서버) 거르지 않는다. 받은 뒤 조회가 실패하면 마지막 값을 쓴다.
- 새 DB 시드 `pazmo-pm`: name "PM", name_ko "PM", department `planning`, role `senior`, provider `codex`, avatar 📋. 기존 DB에는 더하지 않는다.
- DB 에이전트·부서 행을 지우거나 고치지 않는다. 호스트의 에이전트·부서 생성·삭제 차단은 그대로 둔다.
- 커밋·푸시는 사용자 요청 시에만. 실행 중인 Office는 재시작하지 않는다.
- 테스트 명령은 A 계획과 같다. root `node --test`, `npm test`, `npm run typecheck`, vendor vitest와 tsc, `npm run build:office`.

## Review Focus

1. **역할 API 실패·부재.** 미리보기에서는 모든 캐릭터가 보여야 한다. 첫 성공 뒤 실패하면 마지막 값을 유지해야 한다. → Task 2 테스트.
2. **PM과 Lead가 같은 캐릭터(옛 3인 DB).** 이름이 `PM · 리드` 하나로 보이고, 캐릭터가 두 번 그려지지 않아야 한다. → Task 2 테스트.
3. **숨긴 캐릭터가 일하는 중.** 작업 중이면 보이고, 그 부서 방도 보여야 한다. → Task 2 테스트.
4. **다른 화면 일관성.** 상세·사이드바·상태 패널이 같은 걸러진 목록과 같은 이름을 써야 한다. App 한 곳에서 적용했는지 확인한다. → Task 2 테스트, 리뷰.
5. **역할 키와 서버 선택의 일치.** 14인 DB에서 PM=Clio, Lead=Sage, Engineer=Aria, Reviewer=Hawk여야 한다. → Task 1 테스트.

---

### Task 1: 서버 — 역할 API와 새 DB PM 캐릭터

**Files:**
- Modify:
  - `src/runtime/native-office.ts`: 브리지에 `officeRoles()`를 둔다. `agent()` 160–173행을 재사용한다.
  - `vendor/claw-empire/server/pazmo/host.ts`: 브리지 타입에 `officeRoles?(): unknown`을 더하고, `GET /office-roles` 라우트를 `/cli-models` 옆에 둔다.
  - `src/runtime/service.ts`: 새 DB 시드에 `pazmo-pm`을 더한다. 126–155행 근처다.
- Test:
  - `tests/native-office.test.mjs`(또는 새 `tests/office-roles.test.mjs`)
  - `tests/claw-host-runners.test.mjs`(또는 host 테스트 중 bridge stub을 쓰는 파일)
  - 새 DB 시드 테스트(`service` 시작 경로를 쓰는 기존 테스트 파일을 찾아 추가)

**Interfaces:**
- Produces:
  - `officeRoles(): { roles: Record<"pm"|"lead"|"engineer"|"reviewer", string|null> }`
  - `GET /api/office-roles`: bridge에 메서드가 없으면 404 `NOT_FOUND`.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - 14인 시드(`applyDefaultSeeds`) DB에서 `officeRoles()`의 각 id를 이름으로 바꾸면 `{pm:"Clio", lead:"Sage", engineer:"Aria", reviewer:"Hawk"}`이다.
  - 3인 DB(lead·engineer·reviewer만 있는 DB)에서는 `pm === lead === "pazmo-lead"`이다. 테스트 안에서 agents 테이블을 직접 만든다.
  - 새 Office DB(서비스 시작 경로)에는 4행이 있고, `officeRoles()`가 `{pm:"pazmo-pm", lead:"pazmo-lead", engineer:"pazmo-engineer", reviewer:"pazmo-reviewer"}`를 돌려준다.
  - host:
    - `GET /api/office-roles`는 bridge 결과를 그대로 준다.
    - bridge에 `officeRoles`가 없으면 404다.
    - POST는 거부된다. 기존 쓰기 차단 미들웨어가 423을 주거나 라우트가 405를 준다. 둘 중 실제 동작을 단언한다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
  - `officeRoles: () => ({ roles: { pm: agent("pm"), lead: agent("lead"), engineer: agent("engineer"), reviewer: agent("reviewer") } })`
  - host: `if (req.method === "GET" && req.path === "/office-roles") return office.officeRoles ? res.json(office.officeRoles()) : res.status(404).json({ error: "NOT_FOUND" });`
  - 시드: `insert.run("pazmo-pm","PM","PM","planning","senior","codex","📋")`
- [ ] **Step 4: 통과를 확인한다.** 실행할 것: 위 테스트, `npm test`, `npm run typecheck`.

### Task 2: 화면 — 역할로 거르고 역할 이름 표시

**Files:**
- Create:
  - `vendor/claw-empire/src/app/officeRoles.ts`: 순수 함수 `applyOfficeRoles`와 `roleLabel`
  - `vendor/claw-empire/src/app/useOfficeRoles.ts`: 30초마다 조회. 첫 성공 전에는 null이고, 실패하면 마지막 값을 유지한다.
- Modify:
  - `vendor/claw-empire/src/api/*`: `getOfficeRoles`를 추가한다. 기존 `request` 패턴을 따르고, `api` index에서 export한다.
  - `vendor/claw-empire/src/App.tsx`: `overlayAgents`·`overlayDepartments` 계산 뒤 한 곳에서 `applyOfficeRoles`를 적용한다. 하위 화면에 넘기는 모든 `agents`·`departments`를 걸러진 값으로 바꾼다.
  - `vendor/claw-empire/src/components/AgentDetail.tsx`: `original_name`이 있으면 이름 아래에 작게 표시한다.
  - `vendor/claw-empire/src/types/index.ts`: `Agent`에 `original_name?: string`을 더한다.
- Test:
  - `vendor/claw-empire/src/app/officeRoles.test.ts`
  - `useOfficeRoles.test.tsx`
  - `AgentDetail` 원래 이름 표시 테스트(기존 테스트 파일에 추가)

**Interfaces:**
- Consumes: Task 1 `GET /api/office-roles`.
- Produces:

```ts
export type OfficeRoles = { pm: string | null; lead: string | null; engineer: string | null; reviewer: string | null };
export function applyOfficeRoles(input: { agents: Agent[]; departments: Department[]; roles: OfficeRoles | null; language: "ko" | "en" | string }): { agents: Agent[]; departments: Department[] };
```

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `officeRoles.test.ts`
  - 14인 목록(부서 6개)과 roles(Clio/Sage/Aria/Hawk id)를 넣는다.
    - 캐릭터 4명, 부서 3개(planning, dev, qa)만 남는다.
    - 이름이 ko `PM`·`리드`·`개발`·`리뷰`, en `PM`·`Lead`·`Engineer`·`Reviewer`이다.
    - `original_name`은 원래 이름이다(ko는 `name_ko`가 있으면 그것, 없으면 `name`).
  - 3인 목록에서 pm=lead=`pazmo-lead`이면 Lead 캐릭터 한 명이 `PM · 리드`로 보인다.
  - Bolt가 `status:"working"`이거나 `current_task_id`가 있으면 Bolt와 dev가 남고, 이름은 그대로다.
  - `roles: null`이면 입력을 그대로 돌려준다(같은 배열 내용).
  - 입력 배열과 객체를 바꾸지 않는다(freeze한 입력으로 확인).
  - `useOfficeRoles.test.tsx`:
    - 계속 실패하면 null이다.
    - 성공한 뒤 실패하면 값을 유지한다.
  - `AgentDetail`: `original_name`이 있으면 보인다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
  - 함수는 `roles`에서 id → 역할 목록 맵을 만든다. 맵에 있는 캐릭터는 이름을 바꾸고, 일하는 캐릭터는 이름을 그대로 둔다. 둘 다 아니면 뺀다.
  - 부서는 남은 캐릭터의 `department_id` 집합으로 거른다.
  - App에서는 `const { agents: officeAgents, departments: officeDepartments } = useMemo(() => applyOfficeRoles({ agents: overlayAgents, departments: overlayDepartments, roles, language }), …)`로 계산한다. 기존에 `overlayAgents`·`overlayDepartments`를 쓰던 곳(429, 474, 494행 근처 포함)을 모두 이 값으로 바꾼다.
- [ ] **Step 4: 통과·회귀를 확인한다.** vendor vitest 전체, vendor tsc app/node, root `npm run build:office`.

### Task 3: 검증·문서

- [ ] 전체 회귀를 X/X로 돌린다. 이어서 B 범위 리뷰를 1회 한다(A 최종 리뷰와 별도).
- [ ] `docs/LOCAL-PREVIEW.md`에 "Office 캐릭터" 짧은 절을 쓴다. `CONCEPTS.md`에 role character 항목이 필요한지 확인한다.
- [ ] 실제 eevee-be 확인은 A 실제 확인과 함께 한다. Office 재시작은 사용자 확인 후에 한다.

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (보이는 캐릭터·방) | Task 2 |
| 결정 2 (역할 이름·합침·원래 이름) | Task 2 |
| 결정 3 (DB 무변경) | Global Constraints, Task 2 비변경 테스트 |
| 결정 4 (`pazmo-pm`) | Task 1 |
| 결정 5·6 (제외) | Global Constraints |
| 실패 처리표 | Task 2 hook·함수 테스트 |
| V15 | Task 1–3 |

- **Placeholder:** host 테스트 파일과 시드 테스트 파일은 "기존 파일을 찾아 추가"로 적었다. 구현자는 실제 파일을 찾아 그 파일에 쓴다.
- **이름 일관성:** `officeRoles`, `/api/office-roles`, `getOfficeRoles`, `useOfficeRoles`, `applyOfficeRoles`, `OfficeRoles`, `original_name`을 모든 Task에서 같은 이름으로 쓴다.
