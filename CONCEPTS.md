# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Gates and decisions

### Story
The canonical contract for one request: its goal, domain, required behaviors (MUST), optional behaviors (SHOULD), exclusions (OUT), assumed decisions and the verification scenarios that cover every MUST.

A Story is proposed by the PM role and means nothing until a human passes its Gate. Later planning and implementation are bound to the exact approved text, so changing a Story after approval invalidates the approvals that depend on it.

### Candidate
A frozen snapshot of proposed project changes that checks, review and a human Gate all judge as one exact subject.

A candidate is never the user's project itself: roles work on isolated copies, and nothing reaches the project until the same candidate has passed its checks and human understanding. Any change produces a new candidate, so evidence gathered on an earlier one no longer counts.

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

## Runners

### Runner
The user's own installed and logged-in AI command-line tool (codex or claude) that answers a role's model calls, chosen per role and remembered across restarts.
*Avoid:* provider, controller (when meaning the user's choice)

A runner uses the user's own subscription login where the tool keeps it; Office never copies or reads the login, and never falls back to another runner or an API key. Only its model calls happen on the user's machine: every file or command action it requests runs in the disposable, network-less execution container. A runner that would carry the user's personal tool settings or instructions into a role run is blocked instead of used. Roles the user has not chosen use a logged-in runner by default.

### Runner qualification
The credential-free check a runner must pass, for an exact binary and model, before it may serve any role.

It drives the runner against a scripted local model so that its tool actions provably run in the execution container, never on the host, and that no personal configuration leaks in. Only passing results are remembered, and any change to the runner's binary, the chosen model, the execution container's tool or Office's own boundary code requires qualifying again. Qualification is evidence about the boundary, not about the quality of the model's work, and it is no Gate.

## Hosting

### Managed mode
The state in which the original Claw office app runs inside Office as Office's screen and data store, instead of as a standalone app.
*Avoid:* Pazmo mode

In managed mode Office owns every action the original app would otherwise take by itself. Original paths that would call a model, merge work, sign in to a provider, receive outside chat messages or run background sweeps are locked or switched off. Where the screen needs information, such as whether a Runner is installed and logged in, Office supplies its own answer. A feature that can only work by reading the user's login does not run at all; it shows that Office does not provide it, instead of appearing logged out or broken.
