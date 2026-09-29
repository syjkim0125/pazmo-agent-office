# Task: Chat control and Office observation
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
The trusted chat host handles requests, addressed replies, approvals and execution; the user observes the existing Office Tasks view without entering an operator key or operating a separate control console.
## Covers — Story M/V IDs
M2, M3, M4, V2, V3, V4
## Scope
Supported authenticated local bridge, read-only observation inside Tasks and removal of the old interactive operator page once bridge parity is checked.
## Constraints
Preserve existing ledgers, kit transitions, real-human gates and controller/VM isolation. Viewer credentials cannot authorize mutations. No daemon or Jira integration.
## Verify
V2/V3: request and role execution control through the bridge; display real saved conversations, active roles, checks and results.
V4: addressed approvals and stale/cancelled-result guards remain enforced; viewer cannot mutate or obtain operator secrets; interrupted requests never retry silently.

D11 continuation: original TaskBoard/server replaces the custom observer. Legacy bridge evidence is historical; native role execution, kit bindings and human delivery remain open (V8).
