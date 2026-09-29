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
