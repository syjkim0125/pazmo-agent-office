---
title: Preserve intake drafts without inventing workflow state in the UI
date: "2026-09-22"
last_updated: "2026-10-02"
module: Office chat and observation
problem_type: ui_bug
component: assistant
severity: medium
symptoms:
  - "A saved answer changed the detail but left the request list showing the old state"
  - "Credential expiry cleared an unsent request during reconnect"
  - "A rejected G4 answer produced another generic approval request without its assessment"
  - "A published parent stayed Planned while its child waited for G4"
  - "An approval that expired while Decisions was open returned 409 STALE_APPROVAL and the typed note vanished when the request was reissued"
root_cause: logic_error
resolution_type: code_fix
tags: ["intake", "drafts", "state", "credentials", "async", "decision-inbox", "approval-expiry", "stale-approval"]
---

# Preserve intake drafts without inventing workflow state in the UI

The original operator form was retired by the chat/observation change (pending main merge). The historical fix below explains the state and recovery invariant; the current application is recorded at the end.

## Problem and cause

The first operator screen refreshed detail after a successful mutation but left the list stale. The same disconnect routine served explicit logout and expired credentials, so a failed request on restart erased the user's unsent input. The backend's guarded state was correct; the screen presented conflicting information and lost the material needed to recover.

## Fix and evidence

Update list and detail from the same successful server response. Never optimistically advance workflow state or retry uncertain POSTs. Send the displayed revision and input digest, retaining inputs when the server rejects a stale response.

Explicit logout clears the operator credential, drafts and private screen. Authentication expiry still clears credentials/history, but preserves unsent text for reconnection. Keep old question answers as a separate labeled draft, never automatically attach them to a newer question. The one exception is a reissue of the same unanswered gate for the same task, typically after its challenge expired (2026-10-02 below): the unsent text moves as editable text and is never submitted for the user. Retain those drafts even if the next connection attempt also fails. Abort plus a render-generation check prevents late reads from restoring a disconnected screen.

Behavioral tests reproduced absent list updates and lost request text before the fixes. The final root suite passed 267 tests. Real browser writes verified request creation, restart/reconnection, answering a seeded PM question and cancellation. Browser tests did not call an authenticated model or establish human G4.

## Prevention

Review a mutation's list, detail, draft and pending-request lifetimes together. A correct API response does not prove the UI displays the same state. Distinguish explicit user discard from recoverable connection failure, and keep model content as text so a conversation cannot become executable page content.

## Related

- [Implementation and browser evidence](../../verification/2026-09-22-intake-console.md)
- [Historical round mutation boundaries](../logic-errors/historical-round-queue-mutation.md)
- [Ledger-side expiry and request identity for G4](../logic-errors/g4-answer-evaluation-binding.md)

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

The next actual G4 submission exposed the same draft-loss invariant in the native modal: it cleared input immediately after invoking an asynchronous callback that catches API errors. Keep the draft until the submission's own outcome or authoritative request-list reconciliation proves the answer was applied. List removal alone is not that proof: an expired challenge is also removed and replaced under a new request ID (2026-10-02 below). Show structured `ANSWER_REQUIRED` feedback instead of asking the user to repeat an invalid submission. Display the numbered format at the input, preserve approval expiry, and never submit an old answer to a replacement request for the user; carrying unsent text to a reissue of the same gate is allowed, replaying it is not. A resolved callback alone cannot prove acceptance when its owner handles errors internally. Pending/rejected submission and resolved-item-removal tests now enforce this distinction.

## Native Decisions and parent tasks (2026-09-29)

Actual users submitted a numbered answer twice; the model returned `needs_restatement` with reasons, but the successor request hid that assessment. The transport was working, so repeating the POST or merely replacing its generic error was insufficient. `CompletionLedger.feedback` now reads the latest failed assessment for the displayed request's current evidence subject. The native Decision projects the exact prior answer and three assessment reasons without altering the stored evidence, accepting an answer, or starting another model. Expired or changed requests explain renewal separately. Never carry an assessment to another candidate.

A second projection gap left the intake parent Planned after its children had been published. Use the intake publication receipt as the child list, project Review/collaborating onto the native parent, and reserve Done for actual child delivery. Managed cards explain their pending Decision or running assessment; upstream Run remains available for unadopted requests. Hide unsupported Resume/delete and disable status/reassignment controls instead of offering silent no-ops. Cancel remains available for unfinished managed work. Preserve upstream Hide through an exact hidden-only PATCH allowlist; adding a status or any other field still fails the workflow guard.

Review removed candidate/evidence revalidation from the frequently polled Task Board progress projection: only runtime activity is needed to label an active answer assessment. The actual approval and feedback paths retain exact evidence validation. Do not turn a harmless progress label into repeated disk hashing.

Regression evidence covers rejected answer → successor with reasons → no automatic reassessment → actual addressed fixture answer → trusted fixture assessment → child/parent delivery; stale evidence suppresses feedback. UI tests distinguish managed and upstream tasks. The actual browser showed both Sage and Hawk in Review, no parent Run, and saved model assessment reasons. These checks do not stand in for final human G4. See the current native verification record for the evidence boundary.

## Feedback is guidance, not an endless approval quiz (2026-09-30)

Showing the reasons alone did not fix the user's repeated rejection: the controller still renewed a quiz after each failed assessment. D13 explicitly changes that product policy. After one failed assessment, Decisions shows its real feedback and a separate `workflow_acknowledge` action (option 3). The user can approve by clicking it without writing another answer or launching another model. Keep the initial understanding assessment and the original answer; an acknowledgment is not proof that the answer became correct.

`CompletionLedger.acknowledgeFeedback` binds the confirmation to the current challenge and the failed request on the same evidence subject. Persist the feedback request ID and evaluation digest with the unchanged original answer, and retain the failed evaluation in the receipt. Existing candidate, test/review, authority, expiration, cancellation and execution-closure checks still govern delivery. A new option number prevents old clients' answer submissions from turning into acknowledgments. The renderer and button reuse one feedback projection to avoid doubling candidate hashing on every poll.

Regression coverage includes failed assessment → feedback → one explicit click → child/parent delivery, no second model call, no feedback/no authority/replay rejection, and expired/cancelled/invalidated/active/changed-session refusal. The browser confirmation is display-only; fixture delivery does not substitute for the actual user's click. This supersedes the required re-answer behavior in the previous section.

## Expired approval challenge in an open Decisions window (2026-10-02)

G1/G3/G4 challenges are single-use, session-bound and expire 10 minutes after issue (`src/core/approvals.ts`). The native reconcile `pump()` in `src/runtime/native-office.ts` replaces an expired challenge, but it ran only on events: startup, a reply, task assign/run, an incoming chat message, a settled role run, or the host's STALE catch in `vendor/claw-empire/server/pazmo/host.ts`. A human who is only reading triggers none of these. In the eevee-be case three G1 requests issued at 16:44:09 expired at 16:54:09 while `GET /api/decision-inbox` kept listing them. The human submitted to the old ID and got 409 `STALE_APPROVAL`. The host catch then refreshed, reissuing all three at 16:56:24, and the client's 5 s live sync swapped the IDs. The modal treated the vanished ID as answered and cleared the target and draft, and the action handler showed an alert asking the user to copy a note that was already gone. "4 pending" was three G1 requests plus one older questions Decision, not duplication. Challenge security held; the screen offered expired authority and then destroyed what the user needed to answer the replacement.

**Rejected approaches.** A server timer at expiry would reissue an ignored request every 10 minutes indefinitely, and because the chat notice identity was derived from a binding that contains the new challenge ID, it would repost the notice each time. The 2026-09-29 rule "clear when the server no longer lists the request" is right for success but cannot tell a successful submit from a reissue. The alert-based STALE message left recovery to the human.

**Fix (local branch `fix/decision-inbox-stale-approval`, not yet pushed or merged as of 2026-10-02).** Reconcile on read through the existing poll instead of adding a scheduler, once per expired unconsumed challenge, so one expiry does not cause a reconcile on every request:

```ts
const reconciledExpiries = new Set<string>();
async function currentDecisions() {
  const expired = (db.prepare(`SELECT c.id FROM pazmo_native_decisions d
      JOIN pazmo_approval_challenges c ON c.id=json_extract(d.payload,'$.challengeId')
      WHERE c.consumed_at IS NULL AND c.expires_at<=?`).all(Date.now()) as { id: string }[]
  ).filter((c) => !reconciledExpiries.has(c.id));
  if (expired.length) { for (const c of expired) reconciledExpiries.add(c.id); await pump(); }
  return decisions();
}
```

The host GET now calls it. Each item carries `decision_kind` (the gate, stable across reissue) and the `expires_at` of its unconsumed challenge. The decision notice identity excludes the rotating challenge: task, gate and contract digest for G1/G3, and task plus verification round only when a G4 reissue is a pure time-out (a changed session or candidate is still announced). A reissue always broadcasts `task_update`, so open windows reload even when the chat message is deduplicated.

On the client, the draft's lifetime is keyed to the human's intent, not the row ID. The follow-up target records kind, task, gate and option action. When its item disappears, the modal looks for the same task, the same gate in G1/G3/G4 and the same option action:

```ts
if (!followupTarget || followupPending) return;          // in-flight reply: its outcome decides
if (items.some((e) => e.id === followupTarget.itemId)) return;
const reissued = findReissuedDecision(items, followupTarget);
if (reissued) { /* move target to the new id and option */ setFollowupNotice("reissued"); return; }
if (followupNotice) { if (followupNotice !== "gone") setFollowupNotice("gone"); return; }
setFollowupTarget(null); setFollowupDraft("");            // ordinary removal, no failure seen
```

The reply callback returns `"sent" | "stale" | "failed"`. `sent` clears the draft explicitly, so a delivered answer never migrates onto a later request for the same task. `stale` reloads the inbox instead of alerting and shows an inline notice; the draft moves to the reissued request but is resubmitted only by an explicit click. With no replacement, `gone` keeps the note readable with submit disabled. Each open approval shows its deadline and warns in the last two minutes. Single use, session binding and the 10-minute expiry are unchanged. Known limits: if the read-triggered reconcile throws, that one GET fails; the challenge is not retried, so the next poll returns the list. The client matches task and gate, not the subject, so a reissue caused by a changed contract or G4 candidate also carries the unsent text and shows the same "expired" notice; the explicit click and the re-read prompt are the safeguard.

**Evidence.** RED→GREEN: two native-office tests (reading replaces an expired G1 with a new unconsumed challenge for the same task and gate, approves nothing, rejects a late reply to the old ID and does not reissue again; three unchanged reissues produce one chat notice and a `task_update` each), modal tests (draft moves on reissue; note kept after STALE and resubmitted only on click; note visible with no replacement; delivered answer not carried forward; deadline warning) and action tests (STALE reloads without replay; gate and deadline mapped). After rebase: root 369/369, vendor server 203/203, vendor web 102/104 (two pre-existing, unrelated sprite-avatar failures). In an isolated `--claw` preview browser a reissue within one poll kept the note, a 409 to the expired ID recorded no approval, the explicit resubmit returned 200 and consumed exactly one challenge, and the deadline warning appeared. Failures under shell Node 22.3 and `NOT_BUILT` in a fresh worktree were environment issues (use Node 24.19 and build the vendor UI). Not a model pilot and not human G4. [Verification](../../verification/2026-09-29-native-claw-preview.md).

**Prevention.** Key a draft's lifetime to the human's intent (task, gate, action), never to a server row ID that can rotate. Any expiring authority shown in the UI needs reconciliation on read or an explicit expired state; event-only reconciliation leaves a reading human looking at dead authority. Make the submit path report its own outcome, because list removal cannot distinguish success from replacement. Never auto-replay an approval into a replacement. Exclude rotating secrets and IDs from notice identities, or every renewal becomes a new announcement. Keep tests that rotate the ID under an open draft and that return `STALE_APPROVAL` with a typed note.
