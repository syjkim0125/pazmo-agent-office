# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Gates and decisions

### Story
The canonical contract for one request: its goal, domain, required behaviors (MUST), optional behaviors (SHOULD), exclusions (OUT), assumed decisions and the verification scenarios that cover every MUST.

A Story is proposed by the PM role and means nothing until a human passes its Gate. Later planning and implementation are bound to the exact approved text, so changing a Story after approval invalidates the approvals that depend on it.

### Gate
A point where work stops until a human records an understanding or approval answer bound to an exact subject (a Story, a contract or a verified result). A Gate is passed by recorded evidence, never by a model's claim that it was approved.

- **G1** — approval of scope. For a new request it approves the PM's Story before the Lead plans against it; for an execution contract it approves the plan before implementation starts.
- **G3** — an extra approval required only for high-risk work, over a separate decision document, before execution.
- **G4** — the understanding gate before a verified result is delivered or merged: the human shows they understand the changed behavior, an invariant or failure path, and the limits of the evidence.

### Decision
A pending human answer that Office shows in its Decisions inbox: a Gate approval, answers to role questions, or a planning recovery request. Its display text is a readable projection; the answer is bound to the underlying subject, never to the text shown, and the complete subject stays available for inspection.

A Decision is identified to the human by its task and gate, not by its inbox entry: when its Approval challenge expires, Office replaces the entry with a new one, and an unsent answer may follow it to any replacement for the same task and gate as text, but is never submitted automatically; the human re-reads before submitting.

### Approval challenge
The one-time authority a Gate Decision carries: a human answer is accepted only against a live challenge for that exact subject.

A challenge is consumed by the first answer, belongs to the Office session that issued it, and expires after a short fixed time. An expired or foreign challenge rejects the answer without recording it; Office issues a fresh challenge for the same subject rather than extending the old one, so a stale answer can never be replayed into a later approval.

### Planning recovery
A human-requested resumption of a planning role (PM or Lead) after its closed response was rejected as structurally invalid.
*Avoid:* retry, reset

Recovery is not an approval of scope or results, and it does not reset the failed attempt: the rejected run and its failure record are preserved, and a successor run is linked to it. Each request has a small fixed recovery budget that successor runs do not refill, so a recovery is meant to follow a recorded failure cause rather than a guess. It is only offered once the planning process is confirmed closed.
