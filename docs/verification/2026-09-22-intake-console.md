# 2026-09-23 continuation: execution result visibility

Task: `docs/tasks/U7-execution-results.md`. The existing operator shell now reads `/api/pazmo/contracts` and `/api/pazmo/verification/:id` to display the current candidate, test/Reviewer outcomes, integration feedback, process leases and G4/delivery status. It creates no approval, execution or delivery and does not copy kit transitions into UI state. Reuse the same in-memory bearer credential, generation guard and request wrapper.

Fresh evidence: `node --test tests/operator-console.test.mjs` **8/8**, exit 0 after formatting. Three new cases cover authenticated GET-only reads, untrusted model content, failed refresh, late response after disconnect, and accepted/delivered versus awaiting-G4 display. RED observed missing controls, then the delivered-state label bug; GREEN after implementation/correction. Parent Story and U7 Task checker exit 0; G4 remains unverified. The prior 292-test integration result belongs to the preceding commit, not this UI change.

Actual installed Chrome with a disposable profile passed desktop 1280px and mobile 390px rendering, no horizontal overflow, no page errors and disconnect clearing. The Playwright bundled browser cache was absent, so the run used installed Chrome. The fixture intercepted every request and exercised no real authentication, model or approval. Evidence: `/private/tmp/pazmo-results-browser.mjs`, screenshots `/private/tmp/pazmo-results-desktop.png` and `/private/tmp/pazmo-results-mobile.png`; mobile screenshot visually inspected. These temporary files are not distributed runtime dependencies.

Sequential inline simplify/review checked reuse of credential/error lifecycle, absence of write calls, text-only rendering, cancellation races and server-owned state. No additional abstraction or code simplification was warranted. Compound capture was considered after verification: the new UI mechanics and corrected status label are fully explained by code/tests and the existing authority learning; no distinct durable lesson justified another learning file. No new skill execution inside model workers is claimed.

Use **작업 관리 → 연결 → 실행 결과 → 결과 목록 조회**, then select a registered task. Select it again to refresh. An empty list means no contracts are registered in that Office instance; the separate internal pilot database is not imported automatically. Model launch, G4 answer/evaluation controls, raw-diff UI and native kit progress remain subsequent connections. Historical intake-only evidence follows.

# Operator intake screen

Date: 2026-09-22
Story: `docs/understanding/pazmo-agent-office-contract.md` M2/M3/M4, V2/V3/V4; S1
Task: `docs/tasks/U7-intake-console.md`
Plan: U7, `docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md`
Base: `87c16639bc4b06289e3b0923d147bfce500caa62`
Branch: `codex/office-runtime-baseline`

## Behavior

The existing Claw preview links to `/operator`, an Office-owned static screen served by the same controller. A human manually supplies the existing operator key. It is never embedded in the HTML, URL or persistent browser storage. Host/Origin enforcement and authorization happen before data access, and every mutation uses the existing operator API/ledger. No model launch, approval evaluation, kit state replica or new authentication provider was added.

The screen creates a request, lists the current project's saved requests, opens conversations, submits addressed PM answers and cancels intake. List queries use a stable `(created_at,id)` cursor, 50-item pages and a project-scoped cursor lookup. They omit full event/packet data. Existing publication records produce `registered`; the list does not independently decide workflow state.

Model/project text is rendered with textContent, not interpreted HTML or Markdown. A static CSP limits scripts/styles/connections to the controller and denies framing/forms/base URLs. Fetch omits cookies, refuses redirects and disables caching. Disconnect aborts reads and invalidates their render generation, so a late response cannot repopulate the screen. These measures do not replace the pending worker sandbox and real account canaries.

Writes carry the displayed revision/input digest. Conflicts retain inputs; uncertain network failures do not auto-retry. Server mutation results update list and detail together. Expired credentials clear the key and history while retaining unsent drafts for reconnection. Explicit disconnect/reload clears page-local drafts. Refreshed answers are retained separately rather than silently attached to a newer question.

## Evidence

- First invocation used the shell's Node 22.3.0 and failed before testing because it lacks `node:sqlite`. All actual checks below use `/Users/jongkkim/.nvm/versions/node/v24.19.0/bin/node`; the environment failure is not a behavioral RED.
- RED: project listing test failed because `IntakeLedger.list` was absent. Console tests failed on the absent module. Later behavioral RED tests reproduced missing post-create list update and lost input after expired credentials.
- Focused ledger/browser-DOM tests and actual operator HTTP lifecycle test passed after fixes.
- Full root `--experimental-vm-modules --test tests/*.test.mjs`: **267/267**, exit 0, `/private/tmp/pazmo-operator-all.log`.
- TypeScript check: exit 0. Vendor ESLint `src server`: exit 0, 0 errors/40 existing warnings, `/private/tmp/pazmo-operator-lint.log`. There is no root ESLint configuration.
- Story/Task checker, Compound frontmatter validation, scoped Prettier check and `git diff --check`: exit 0. The Story checker explicitly did not check G4 because the Story is not Delivered.

Actual integrated-browser checks used a temporary Office at port 58109 and disposable project/DB. The fixture setup initially used a `/var` path alias while Office stored the canonical `/private/var` path; the scoped listing correctly excluded that fixture row. Only the disposable seed was corrected. No product path guard was relaxed.

| Route/flow | Result | Boundary |
|---|---|---|
| `/` → 작업 관리 → `/operator` | Pass | Existing Claw preview link, no automatic operator session |
| `/operator` connection and keyboard submit | Pass | Disposable operator key, no Codex login |
| Request create and immediate list/detail update | Pass | Real HTTP/SQLite write |
| Server restart and reconnect | Pass | Old key rejected, browser-created request preserved |
| PM question and answer | Pass | PM question seeded; browser answer persisted via real API |
| Cancellation | Pass | List and detail both show cancelled |
| Untrusted HTML-like request | Pass | Displayed literally, no script/dialog |
| 320/768/1024/1440 widths | Pass for overflow | DOM scroll width equalled viewport; screenshots inspected at 320 and 1440 |
| Console errors after final create/cancel | None | Captured browser error/warning log was empty |
| Live PM/Lead/Engineer/Reviewer and G4 | Not run | Authentication-location decision and canaries remain pending |

Native integrated browser screenshots/AX evidence are in the task tool history. DOM tests additionally cover disconnected late reads, stale answer preservation, header/redirect behavior and no local/session storage. Manual screen-reader certification and automatic browser pairing are not established by these checks.

After browser checks, a read-only SQLite inspection confirmed the exact submitted answer and cancellation state: `/private/tmp/pazmo-operator-browser-evidence.json`. The disposable controller was stopped, its browser closed, viewport override reset, and the obsolete fixture key removed from test metadata. No user project or account was used.

## Review and learning

Workflow continued the approved U7 scope. Frontend UI Engineering guided labels, semantic controls, feedback and responsive layout. ce-test-browser was applied with the native browser; no third-party browser stack or real account was used. The simplified implementation shares list row rendering and separates conversation-to-text formatting; no generic UI framework, second state store or scheduler was introduced.

Review was sequential in this context under the user's tool mapping. It covered authorization, cross-project scope, late UI responses, duplicate writes, stale revisions, draft retention, model-content rendering, static route allowlist and the evidence boundary. It found and fixed stale list display after writes and lost drafts on credential expiry. This is not an independent review or full multi-agent CE receipt. The complete goal is not ready for G4 or merge on this evidence.

Compound records the draft/state lesson in `docs/solutions/ui-bugs/preserve-intake-drafts-and-server-state.md`. The existing AGENTS.md already describes the knowledge store.

## Remaining scope

Project switching/registration UI, proposal publication/approval/delivery UI, live model execution, qualified worker skills and kit durable transitions remain. This is a usable intake screen over the existing API, not a completed autonomous Office. The user asked what model authentication means; that is a clarification request, not approval. Authentication-location G3 remains pending.
