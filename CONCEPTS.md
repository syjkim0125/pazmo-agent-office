# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Gates and decisions

### Story
The canonical contract for one request: its goal, domain, required behaviors (MUST), optional behaviors (SHOULD), exclusions (OUT), assumed decisions and the verification scenarios that cover every MUST.

A Story is proposed by the PM role and means nothing until a human passes its Gate. Later planning and implementation are bound to the exact approved text, so changing a Story after approval invalidates the approvals that depend on it.

### Candidate
A frozen snapshot of proposed project changes that checks, review and a human Gate all judge as one exact subject.

A candidate is never the user's project itself: roles work on isolated copies, and nothing reaches the project until the same candidate has passed its checks and human understanding. Any change produces a new candidate, so evidence gathered on an earlier one no longer counts.

### Office metadata area
The one folder Office owns inside each user project for its own records — installation files, published Lead proposals, approval views and role-run evidence — kept apart from the project's own content.

It is never part of a Candidate or of a planning role's view of the project, and a role result that touches it is rejected, so anything Office generates in a project belongs there rather than beside the user's files. Documents Office relies on there, such as a published Story, are re-read and checked against their approved bytes, so Office does not delete them on its own.

The area also hides itself from the project's version control, because its files hold machine-local paths and records that must never be committed, and Office does this without editing any file the user tracks. Removing Office keeps that hiding in place for as long as any Office record is left behind.

### Verification round
One attempt to verify a Candidate: every registered check and one independent review each give a verdict on that exact candidate, and only a round whose verdicts are all pass reaches the G4 Gate.

A verdict is pass, fail or unknown. Fail means a defect was found (a check failed, or the review reported findings) and sends the work back to the implementer for one of a small fixed number of automatic fixes, each producing a new candidate and a new round. Unknown means there is no verdict: the process timed out or was interrupted, the review report was missing or unreadable, or the review runner ended without giving one. An unknown verdict stops the round for a person at once and spends no fix. A round also stops for a person when its contract or candidate changes or its deadline passes. A stopped round is never retried automatically: its request becomes a Stopped request.

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

### Stopped request
A request that no longer moves by itself: none of its work is running, no Decision is open for it, and Office has recorded that it will not start the step again without a human. A failed run, a result verification could not judge, a step held after a restart, and planning that stopped with no Planning recovery on offer all leave a request stopped. It is shown as stopped, together with the reason Office recorded.
*Avoid:* stuck, failed

A stopped request never resumes on its own; the human cancels it or makes a Rerun of it. A request waiting on an open Decision, including a Planning recovery, is not stopped.

### Rerun
Replacing a Stopped request with a new request whose content the human confirms (by default the same), after which the stopped request is cancelled and the two stay linked.
*Avoid:* retry, restart, resume

A rerun starts over from planning, so G1 is asked again; it is not a Planning recovery and carries nothing over from the stopped work. A request is rerun at most once and only while it is still stopped. The stopped request is cancelled only after the new request was accepted, so a refused rerun changes nothing.

## Runners

### Runner
The user's own installed and logged-in AI command-line tool (codex or claude) that answers a role's model calls, chosen per role and remembered across restarts.
*Avoid:* provider, controller (when meaning the user's choice)

A runner uses the user's own subscription login where the tool keeps it; Office never copies or reads the login, and never falls back to another runner or an API key. Only its model calls happen on the user's machine: every file or command action it requests runs in the disposable, network-less execution container. A runner that would carry the user's personal tool settings or instructions into a role run is blocked instead of used. Roles the user has not chosen use a logged-in runner by default.

### Runner qualification
The credential-free check a runner must pass, for an exact binary and model, before it may serve any role.

It drives the runner against a scripted local model so that its tool actions provably run in the execution container, never on the host, and that no personal configuration leaks in. Only passing results are remembered, and any change to the runner's binary, the chosen model, the execution container's tool or Office's own boundary code requires qualifying again. Qualification is evidence about the boundary, not about the quality of the model's work, and it is no Gate.

### Agent
A named worker in the lean Office that a human assigns a task to, carrying a work runner and a review runner.
*Avoid:* role agent, employee (the Claw Office's per-role characters)

The workflow stages (plan, design, build, review, G4) run inside the agent's task as its progress, not as separate role characters. An agent with an open task, and the last agent, cannot be deleted. A task whose agent was deleted, or that the engine created without one, uses the oldest remaining agent's runners.

### Work runner
An agent's runner choice (CLI, model, effort) for the plan, design and build stages of its tasks.

### Review runner
An agent's runner choice for the review stage, including the G4 evaluation, so that a different model can check the work.

A review runner that ends without a report (an API error or refusal, for example) gives the review an unknown verdict in its Verification round, never a fail.

## Hosting

### Managed mode
The state in which the original Claw office app runs inside Office as Office's screen and data store, instead of as a standalone app.
*Avoid:* Pazmo mode

In managed mode Office owns every action the original app would otherwise take by itself. Original paths that would call a model, merge work, sign in to a provider, receive outside chat messages or run background sweeps are locked or switched off. Where the screen needs information, such as whether a Runner is installed and logged in, Office supplies its own answer. A feature that can only work by reading the user's login does not run at all; it shows that Office does not provide it, instead of appearing logged out or broken.

## Team hub

### Team hub
The invite-only, intranet-hosted board where teammates see the repo list, post requests and follow progress. It is a bulletin board and post office: it stores people, repos, requests, progress snapshots and answers, and for team Stories the projects, task graphs, Claims and results, but never runs a model and holds no login, repository contents or deliverables.
*Avoid:* team server, shared Office

The hub is not a second Office. Each person's Office keeps its own `127.0.0.1` boundary and only reaches out to the hub; a compromised hub can forge a requester's answers but cannot deliver anything, because delivery needs the assignee's local G4.

### Repo owner
A teammate who may accept requests for a registered repo and connect their own Office to it. The person who registers a repo is its first owner; owners or the admin add and remove owners. Anyone may post a request, but only an owner takes it.

### Assignment
An owner's explicit acceptance of one hub request, binding it to that owner's Office, PC and login, made on the hub page or from the owner's Office Inbox. There is no automatic assignment. An owner may instead decline an open request with an optional reason; that closes it for every owner and the requester sees the decline and reason. The requester answers the questions and the scope Gate (G1) on the hub; the assignee answers the task Gates and G4 in their own Office. An assignee can release the request and the requester can cancel it.

### Office link
The one-owner, one-repo pairing between an Office and the hub. The member copies a single-use, member-level connection string from the hub's start page and pastes it into the Office's top-bar team hub dialog (or `hub-link --connect`); the hub finds the repo by the Office's git origin and, if no repo has that origin, registers it with that member as owner. A repo someone else owns refuses the link and leaves the string usable. With a fingerprint (LAN hub) the Office trusts only that hub CA; without one (Fusion hub) it verifies the public certificate through system trust. The stored token can only read that owner's accepted requests for that repo, upload their progress and receive answers and cancellations, plus — from hub protocol 2 — list repos, create requests in the owner's name and read, answer and cancel the Outgoing requests sent from this repo's Office, and list, accept and decline the repo's open incoming requests. From hub protocol 3 it also reads the team Story board, takes Claims on that repo's ready tasks and reports their results; a Story's PL may use any of their links for the Story's own actions.
*Avoid:* login, sync account

A link is outbound and polled; the hub never opens a connection into an Office. Re-pairing moves the link to another Office and revokes the first, whose in-flight local work the hub can no longer reach.

### Outgoing request
A hub request a person sends from their own linked Office (a Tasks card or the chat) to another repo, recorded in that Office with the hub request ID, the local task if any, the target repo and when it was sent. The Office shows its status on the card and lists the other side's PM questions, scope Gate (G1) and planning retry in its own Decisions; those answers travel through the Office link as the requester's hub answers.
*Avoid:* handoff, delegation, cross-repo task

Sending is always a person's act; the original task keeps running. If an owner of the target repo declines it instead of accepting, the request is closed and the sender's card shows it as declined with the owner's optional reason; a decline is not a cancellation by the sender. From Decisions the Office can approve or cancel the request — "rejecting" means cancelling, there is no send-back-for-revision — and a card can cancel it while it is waiting or in progress; cancelling is the hub's own cancel, so the assignee's Office stops. The Office never sees the other repo's diff, task Gates, G4 or delivery. Scope is (member, origin repo): the same person's requests sent from another repo's Office or from the hub page are not listed.

### Hub snapshot
The single bounded summary an Office uploads for an accepted request: status, title, pending questions and scope Decisions, role conversation, the candidate diff, a short report and the runners used. The hub keeps only the latest one, so a reconnect simply sends it again.
*Avoid:* event log, sync

A snapshot is what leaves the owner's machine, so it is the unit to reason about for privacy. It never carries login information, the whole repository, delivered files or the raw G4 evidence.

### PL
The member who publishes a team Story: they split it into a task graph, approve it before it reaches the hub, run its Story-level verification and answer its G4. Only the PL opens, extends or completes a Story; to recover when the PL is gone, a hub admin may also release or cancel its tasks or cancel the Story.

### Claim
A member's Office's hold on one ready work task of a team Story, taken automatically for a repo the member owns and identified by its own claim ID. The Story's verification task is the exception: only the PL claims it, explicitly. A member has at most one open Claim at a time.
*Avoid:* assignment (that is the accept-based request flow), lease

Every report about the task must carry the current claim ID. After the PL releases or cancels the task, or after a rerun issues a new ID, the old ID is refused, so a returning Office learns the task is no longer its own. The one exception is a merged report from the Claim that last held the Merge lock (see Merge lock). A failed task stays its member's open Claim until they rerun it or the PL releases or cancels it. When an Office stops sending heartbeats its Claim is shown as held, but it is never released automatically.

### Merge lock
The per-Story, per-repo turn that one Claim holds while it brings the latest Story base into its task branch, re-verifies and merges the result into the Story base.

It is never released by time. It ends when the task is merged or fails, when its own Claim gives it up to retry, or when the PL releases or cancels the task. The hub remembers which Claim last held it only so that a merge which already landed before a PL release still counts when it is reported late; a Claim that gave the lock up itself, by unlocking or reporting failure, has given that standing up too.

### Story base
The per-repo integration branch of one team Story, cut from the project's base branch, into which finished task branches merge automatically. A person tests it and merges it into the project's main line; Office never writes the main line.
