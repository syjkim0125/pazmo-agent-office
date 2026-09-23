---
title: Preserve intake drafts without inventing workflow state in the UI
date: "2026-09-22"
module: Office operator intake screen
problem_type: ui_bug
component: assistant
severity: medium
symptoms:
  - "A saved answer changed the detail but left the request list showing the old state"
  - "Credential expiry cleared an unsent request during reconnect"
root_cause: logic_error
resolution_type: code_fix
tags: ["intake", "drafts", "state", "credentials", "async"]
---

# Preserve intake drafts without inventing workflow state in the UI

## Problem and cause

The first operator screen refreshed detail after a successful mutation but left the list stale. The same disconnect routine served explicit logout and expired credentials, so a failed request on restart erased the user's unsent input. The backend's guarded state was correct; the screen presented conflicting information and lost the material needed to recover.

## Fix and evidence

Update list and detail from the same successful server response. Never optimistically advance workflow state or retry uncertain POSTs. Send the displayed revision and input digest, retaining inputs when the server rejects a stale response.

Explicit logout clears the operator credential, drafts and private screen. Authentication expiry still clears credentials/history, but preserves unsent text for reconnection. Keep old question answers as a separate labeled draft, never automatically attach them to a newer question. Retain those drafts even if the next connection attempt also fails. Abort plus a render-generation check prevents late reads from restoring a disconnected screen.

Behavioral tests reproduced absent list updates and lost request text before the fixes. The final root suite passed 267 tests. Real browser writes verified request creation, restart/reconnection, answering a seeded PM question and cancellation. Browser tests did not call an authenticated model or establish human G4.

## Prevention

Review a mutation's list, detail, draft and pending-request lifetimes together. A correct API response does not prove the UI displays the same state. Distinguish explicit user discard from recoverable connection failure, and keep model content as text so a conversation cannot become executable page content.

## Related

- [Implementation and browser evidence](../../verification/2026-09-22-intake-console.md)
- [Historical round mutation boundaries](../logic-errors/historical-round-queue-mutation.md)
