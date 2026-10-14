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
A human-requested resumption of a planning role (PM or Lead) after its closed response was rejected as structurally invalid, or after its Runner failed before returning any plan (for example, a sign-in failure).
*Avoid:* retry, reset

Recovery is not an approval of scope or results, and it does not reset the failed attempt: the rejected run and its failure record are preserved, and a successor run is linked to it. Each request has small fixed recovery budgets, kept separately for rejected responses and for Runner failures, so a transient Runner problem does not use up the recoveries meant for fixing a response; successor runs do not refill either budget, and a recovery is meant to follow a recorded failure cause rather than a guess. It is only offered once the planning process is confirmed closed.

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

## Team hub

### Team hub
The invite-only, intranet-hosted board where teammates see the repo list, post requests and follow progress. It is a bulletin board and post office: it stores people, repos, requests, progress snapshots and answers, but never runs a model and holds no login, repository contents or deliverables.
*Avoid:* team server, shared Office

The hub is not a second Office. Each person's Office keeps its own `127.0.0.1` boundary and only reaches out to the hub; a compromised hub can forge a requester's answers but cannot deliver anything, because delivery needs the assignee's local G4.

### Repo owner
A teammate who may accept requests for a registered repo and connect their own Office to it. The person who registers a repo is its first owner; owners or the admin add and remove owners. Anyone may post a request, but only an owner takes it.

### Assignment
An owner's explicit acceptance of one hub request, binding it to that owner's Office, PC and login. There is no automatic assignment. The requester answers the questions and the scope Gate (G1) on the hub; the assignee answers the task Gates and G4 in their own Office. An assignee can release the request and the requester can cancel it.

### Office link
The one-owner, one-repo pairing between an Office and the hub, created by a single-use command (hub address, code, certificate fingerprint) run on the owner's PC. The Office trusts only the hub certificate with that fingerprint, and the stored token can only read that owner's accepted requests for that repo, upload their progress and receive answers and cancellations, plus — from hub protocol 2 — list repos, create requests in the owner's name and read, answer and cancel the Outgoing requests sent from this repo's Office.
*Avoid:* login, sync account

A link is outbound and polled; the hub never opens a connection into an Office. Re-pairing moves the link to another Office and revokes the first, whose in-flight local work the hub can no longer reach.

### Outgoing request
A hub request a person sends from their own linked Office (a Tasks card or the chat) to another repo, recorded in that Office with the hub request ID, the local task if any, the target repo and when it was sent. The Office shows its status on the card and lists the other side's PM questions, scope Gate (G1) and planning retry in its own Decisions; those answers travel through the Office link as the requester's hub answers.
*Avoid:* handoff, delegation, cross-repo task

Sending is always a person's act; the original task keeps running. From Decisions the Office can approve or cancel the request — "rejecting" means cancelling, there is no send-back-for-revision — and a card can cancel it while it is waiting or in progress; cancelling is the hub's own cancel, so the assignee's Office stops. The Office never sees the other repo's diff, task Gates, G4 or delivery. Scope is (member, origin repo): the same person's requests sent from another repo's Office or from the hub page are not listed.

### Hub snapshot
The single bounded summary an Office uploads for an accepted request: status, title, pending questions and scope Decisions, role conversation, the candidate diff, a short report and the runners used. The hub keeps only the latest one, so a reconnect simply sends it again.
*Avoid:* event log, sync

A snapshot is what leaves the owner's machine, so it is the unit to reason about for privacy. It never carries login information, the whole repository, delivered files or the raw G4 evidence.
