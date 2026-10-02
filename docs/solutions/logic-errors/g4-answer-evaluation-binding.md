---
title: Bind G4 evaluation to the addressed answer instead of the latest question
date: "2026-09-21"
category: logic-errors
module: Office completion ledger
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "Answering one G4 request returned another open request's ID and empty answer digest"
  - "A newer pending question could hide an accepted answer for the same evidence"
  - "Expired questions still appeared to be awaiting an answer"
root_cause: scope_issue
resolution_type: code_fix
tags: [approval, g4, identity, stale-results, transactions]
---

# Bind G4 evaluation to the addressed answer instead of the latest question

## Problem

A task can have multiple open questions for the same immutable evidence. Returning the most recently created question after submitting an older one loses the submitted answer's identity. A later pending question can also mask a valid accepted answer.

## What Didn't Work

`submit` and `evaluate` originally returned a task-level latest-request lookup. The regression opened two questions, submitted the first, and received the second ID with a missing answer digest. Ordering only by creation time also cannot distinguish accepted evidence from a later unanswered question.

Nonempty human text alone is not proof of understanding. Passing an `evaluation` field in the human-facing API must not let the submitter produce the controller's assessment.

## Solution

- Bind immutable raw evidence to the current verification subject, including candidate, contract and required result digests.
- Return the specific addressed request from answer/evaluation operations.
- Require the evaluator to name the exact stored answer digest. Store the assessment and final approval in one transaction.
- For task-level status, prefer the current evidence subject and its accepted request. Keep older answers and assessments as history.
- Record submission separately from acceptance. Only a trusted internal evaluator can accept all three understanding dimensions; no HTTP/CLI evaluation route exists.
- Derive pending-request expiry from both deadline and operator authority. Accepted history may remain valid after restart, but old pending challenges cannot cross sessions.

## Evidence and Prevention

The multiple-request and expiry tests failed before their fixes and now pass. HTTP tests show that forged evaluation fields cannot grant approval. Rollback injection proves that a failed evaluation write also rolls back challenge consumption and acceptance. Candidate/contract mutation tests prove that restored bytes do not revive an already-invalidated verification round.

Always test two simultaneous questions, not only a single happy-path question. Preserve the distinction between structurally valid text, a trusted assessment and actual human understanding. A fixture assessment proves the state protocol; it cannot prove the production evaluator is accurate or that the user passed G4.

## Related

- [Implementation](../../../src/core/completion.ts)
- [Regression tests](../../../tests/completion.test.mjs)
- [Protocol evidence and unimplemented adapters](../../verification/2026-09-21-g4-evidence.md)
- [Historical round ownership](historical-round-queue-mutation.md)
