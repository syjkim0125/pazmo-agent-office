# Task: Connect the operator's planning conversation screen
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
The human operator can register a request, find saved conversations, answer PM questions and cancel planning from Office.

## Covers — Story M/V IDs
- M2, M3, M4 / V2, V3, V4; S1

## Scope
- IN: Existing-project intake UI, bounded authenticated listing, conversation/proposal display, manual refresh and conflict handling.
- OUT: Model launch, new authentication provider, approval evaluation, delivery and multi-project selection; retained in the Story.

## Constraints
- Use the existing operator bearer credential; keep it in page memory only and clear it on disconnect.
- Never expose the credential in HTML, URLs, persistent browser storage or conversation content.
- Render project/model content as text; retain revision/digest checks and preserve drafts on failed writes.
- A question answer is not approval; stale or uncertain writes are not silently retried.

## Verify
- Test unauthenticated/cross-origin rejection, bounded listing and cross-project isolation.
- Exercise actual browser request registration, reload/reconnect, addressed answers, stale conflicts and cancellation against disposable Office data.
- Verify keyboard use, narrow screens, disconnect during in-flight reads and untrusted content rendering.
