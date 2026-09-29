---
title: Preserve intake drafts without inventing workflow state in the UI
date: "2026-09-22"
last_updated: "2026-09-29"
module: Office chat and observation
problem_type: ui_bug
component: assistant
severity: medium
symptoms:
  - "A saved answer changed the detail but left the request list showing the old state"
  - "Credential expiry cleared an unsent request during reconnect"
  - "A rejected G4 answer produced another generic approval request without its assessment"
  - "A published parent stayed Planned while its child waited for G4"
root_cause: logic_error
resolution_type: code_fix
tags: ["intake", "drafts", "state", "credentials", "async"]
---

# Preserve intake drafts without inventing workflow state in the UI

The original operator form was retired by the chat/observation change (pending main merge). The historical fix below explains the state and recovery invariant; the current application is recorded at the end.

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

## Applying the lesson when control moves to chat

Moving input out of the browser does not remove the approval and recovery boundary. The chat host retains the actual human answer and addresses the current Office request; the viewer never creates an answer. A failed or timed-out write is followed by a read to establish whether it committed, not an automatic retry. The bridge reuses the existing authenticated API and does not introduce another workflow state store.

A key-entry screen was unnecessary friction, but removing server authentication would have changed the trust boundary. Office now gives the viewer a separate read capability and validates a closed GET allowlist before delegating to the existing reader. The internal operator capability stays with the trusted host. Tests verify that a viewer cannot call operator endpoints or approve work, and restart invalidates its old session.

The late-response invariant still applies: a response for a previously selected request must not replace the current task, and an expired session must not be reopened by a concurrent read. Keep hidden-tab polling paused and preserve unchanged detail DOM so inspection does not fight the user. The browser check caught a CSS selector accidentally left attached to the button rule after removing the old form styles; DOM protocol tests alone did not detect the visual regression.

[Current verification and limits](../../verification/2026-09-28-chat-observation.md) distinguishes actual HTTP/DB and browser checks from the still-pending actual-model chat-to-delivery pilot.

## Tasks integration correction

The separate observation page did not match the requested Office experience. Keep the user's existing Tasks navigation and embed the read-only observer there; removing a control form does not imply that a second page should replace it. Retain the old URL only as a redirect.

When moving the observer into React, effect cleanup/remount becomes part of authentication lifetime. StrictMode can mount a second observer after the first has consumed the URL fragment but before its session request returns. Share that in-flight session promise per window so the second mount waits instead of issuing an unauthenticated read. This is temporary transport coordination, not workflow state. Scope DOM queries and styles to the Tasks root, and dispose polling when leaving Tasks. The focused React test uses a deliberately delayed session response and confirms only one login and no early reads. [Tasks integration evidence](../../verification/2026-09-28-tasks-observation.md).

## D11 supersedes the custom observer

The user subsequently requested the original Claw TaskBoard and server. The custom observer and its tests are retired; the React session-race discussion above is historical. Use the native TaskBoard/local session/WebSocket, preserving backend authorization and qualified execution boundaries. Do not equate visual restoration with completed model integration.

## Keep approval evidence separate from its presentation

The native G4 request carried the complete evidence bundle into Markdown, overwhelming both Decisions and chat with hashes, commands and model logs. Shorten the display without rewriting the pending request or generating a new approval: retain human questions and verdict counts, and disclose the exact diff and review limitations on demand. Render raw diffs as escaped text, not Markdown. Failed or missing results must remain visible; unsupported complete evidence formats fall back to the original content.

The browser check caught a second surface: chat notices truncate the evidence JSON, so the same parser cannot reliably summarize them. Keep the questions there and point to the complete Decisions entry. Never infer a pass from partial evidence. Component tests cover malformed/truncated data and failure visibility; the actual browser verified both surfaces. [Verification](../../verification/2026-09-29-native-claw-preview.md).

The next actual G4 submission exposed the same draft-loss invariant in the native modal: it cleared input immediately after invoking an asynchronous callback that catches API errors. Keep the draft until authoritative request-list reconciliation removes the addressed item. Show structured `ANSWER_REQUIRED` feedback instead of asking the user to repeat an invalid submission. Display the numbered format at the input, preserve approval expiry, and never replay an old answer into a replacement request. A resolved callback alone cannot prove acceptance when its owner handles errors internally. Pending/rejected submission and resolved-item-removal tests now enforce this distinction.

## Native Decisions and parent tasks (2026-09-29)

Actual users submitted a numbered answer twice; the model returned `needs_restatement` with reasons, but the successor request hid that assessment. The transport was working, so repeating the POST or merely replacing its generic error was insufficient. `CompletionLedger.feedback` now reads the latest failed assessment for the displayed request's current evidence subject. The native Decision projects the exact prior answer and three assessment reasons without altering the stored evidence, accepting an answer, or starting another model. Expired or changed requests explain renewal separately. Never carry an assessment to another candidate.

A second projection gap left the intake parent Planned after its children had been published. Use the intake publication receipt as the child list, project Review/collaborating onto the native parent, and reserve Done for actual child delivery. Managed cards explain their pending Decision or running assessment; upstream Run remains available for unadopted requests. Hide unsupported Resume/delete and disable status/reassignment controls instead of offering silent no-ops. Cancel remains available for unfinished managed work. Preserve upstream Hide through an exact hidden-only PATCH allowlist; adding a status or any other field still fails the workflow guard.

Review removed candidate/evidence revalidation from the frequently polled Task Board progress projection: only runtime activity is needed to label an active answer assessment. The actual approval and feedback paths retain exact evidence validation. Do not turn a harmless progress label into repeated disk hashing.

Regression evidence covers rejected answer → successor with reasons → no automatic reassessment → actual addressed fixture answer → trusted fixture assessment → child/parent delivery; stale evidence suppresses feedback. UI tests distinguish managed and upstream tasks. The actual browser showed both Sage and Hawk in Review, no parent Run, and saved model assessment reasons. These checks do not stand in for final human G4. See the current native verification record for the evidence boundary.
