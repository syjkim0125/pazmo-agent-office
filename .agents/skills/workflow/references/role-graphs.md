# Persistent role work

**The kit manages how an assigned job gets finished. Office manages how several jobs achieve one goal.**

Use this guide when assigned a role objective. If the dispatcher supplied an existing run/node/started token, return to that node instead of initializing another run. Without a role assignment, use the normal delivery flow in `graph-engineering.md`.

## Ownership

- Kit run file: local readiness, attempts, questions, answers, feedback, evidence and role completion. One controller writes it through the CLI.
- Office: canonical goal and acceptance criteria, assignments, agent execution, collaboration messages, combined results, global limits, cancellation and real user approval. Office may index kit state; it must not independently advance a duplicate local state machine.
- Agent: performs ready work and records actual observations. It may choose HOW within its assignment, but cannot change the agreed completion criteria.

Standalone use has the same local rules. Codex/Claude runs the CLI and tools. No Office server is needed. The CLI cannot intercept tools or authenticate people: host permissions and real approvals remain separate.

If PM and Developer disagree about completion, return the exact requirement and evidence to Office. Resolve the shared criteria there. A changed requirement or assignment starts a new run; do not silently edit the bound source or reuse old completion evidence.

## Assignment schema and initialization

Save an assignment as project-relative JSON, for example `assignments/developer-1.json`:

```json
{
  "version": 1,
  "taskId": "payment-idempotency",
  "role": "developer",
  "source": "docs/payment-story.md",
  "scope": ["M1", "V1"],
  "targetRevision": "snapshot-before-work"
}
```

| Field | Contract |
|---|---|
| `version` | Integer `1` |
| `taskId` | Nonempty assignment identity from the caller |
| `role` | `pm`, `team-lead`, `developer`, or `reviewer` |
| `source` | Existing nonempty request file for PM; approved canonical Story for other roles. Paths stay inside the project and cannot contain symlinks. |
| `scope` | PM uses `[]`. Others use unique existing Story IDs with at least one M and one V. This is the assigned subset, not copied requirements. |
| `targetRevision` | Nonempty caller-owned snapshot identity. For Developer it identifies the starting input; for Reviewer it identifies the submitted code. Include uncommitted changes. |

```sh
node .ai-workflow/bin/graph.mjs init-role assignments/developer-1.json .ai-workflow/runs/developer-1.json
node .ai-workflow/bin/graph.mjs status .ai-workflow/runs/developer-1.json
```

Reuse the same run across sessions. `init-role` does not overwrite files. The assignment contents and source are bound to the run. Source/assignment changes require a new run after the caller resolves the change. PM should write a separate Story proposal, not overwrite its input request.

| Role | Local graph | Return |
|---|---|---|
| PM | `clarify → propose` | Story proposal and remaining decisions; no self-issued G1 |
| Team lead | `investigate → plan` | Repository-grounded plan, scope links and assignment suggestions |
| Developer | `implement → self-check` | Code, fresh checks and `output.producedRevision` |
| Reviewer | `review` | Evidence, `output.reviewedRevision` and `output.verdict`: `pass` or `needs_changes` |

Use the focused skills in `skill-integration.md` inside these stages. No role starts another full workflow. Final delivery still needs independent review, combined verification, useful Compound learning and real user acceptance, coordinated by the delivery owner.

## Start and record

Use the same `start` and `record` commands as delivery graphs. `status.ready` contains node instructions, token, assignment, source, direct dependency outputs and relevant `input.messages` only. Reserve with the ready token, execute the work, and record using `started.token`.

```json
{
  "token": "<started.token>",
  "output": {
    "summary": "Assigned behavior implemented and checked",
    "evidence": ["evidence/developer-attempt-1.md"],
    "producedRevision": "snapshot-after-work"
  },
  "evaluation": { "passed": true }
}
```

Developer's final `self-check` requires `producedRevision`. Reviewer's result requires `reviewedRevision` equal to the assignment's `targetRevision`, plus `verdict`. The CLI compares the supplied identities; Office/host must verify that they actually identify the files inspected.

A completed review can have `evaluation.passed: true` and `output.verdict: "needs_changes"`: the review was performed, and its finding is that the product needs changes. Do not interpret that as product approval. A review that could not be performed should fail with a concrete `fix`, `replan` or `human` action.

All local nodes passing returns `action: "role-complete"`, `assignment`, `submission.output` and `revisionToken`. Office consumes the native outcome and evidence. **Role completion does not approve the product or finish delivery.** Existing delivery graphs still return `g4` as preparation for human review.

## Ask and resume

Available for both role and delivery runs. A running task can submit:

```json
{ "token": "<current task token>", "text": "Which accepted requirement governs this case?" }
```

```sh
node .ai-workflow/bin/graph.mjs question <run.json> <node-id> <question.json>
```

The response has `action: "question"` and `question: {id, nodeId, text, token}`. One question may be pending per run. New dispatch stops. Other already running nodes may finish. The asking node cannot record or reset past the unanswered question. Its previous token is invalidated.

Office transports the question and answer. Standalone agents ask their user. Save the actual answer as evidence, then submit:

```json
{
  "token": "<question.token>",
  "questionId": "<question.id>",
  "text": "The answer or decision received",
  "evidence": ["evidence/answer-1.md"]
}
```

```sh
node .ai-workflow/bin/graph.mjs answer <run.json> <node-id> <answer.json>
```

Continue from `resumed` and use its new token. This retains the same attempt. Duplicate/wrong answers and old worker results are rejected. Answers are input, never G1/G3/G4 approval. If an answer changes requirements, resolve the canonical document and create a new assignment/run; do not continue against the old contract.

There are at most three question exchanges per node across the run. Batch related questions. The fourth question is rejected; report the unresolved blocker with `evaluation.action: "human"`. Starting a new run only to evade this limit is not allowed. Global time/cost limits remain host-owned.

## Apply feedback

Local failed checks use `reset` on the earliest affected implementation node. Its next input includes downstream failure feedback. External review feedback uses a separate command with the current `status.revisionToken`:

```json
{
  "token": "<current status.revisionToken>",
  "summary": "Handle repeated requests without charging twice; see Reviewer finding R1.",
  "evidence": ["evidence/reviewer-finding-r1.md"]
}
```

```sh
node .ai-workflow/bin/graph.mjs feedback <developer-run.json> implement <feedback.json>
```

The target must be completed or failed and affected workers must be stopped. Feedback resets that node and descendants, preserves unrelated work and attempt counts, and attaches the finding to their inputs. Maximum three starts per node. Stale feedback, missing evidence and retries past the limit are rejected. A revised submission needs a review assignment bound to its new revision.

For `human`, `replan` or exhausted attempts, resolve the decision explicitly; these are not ordinary question waits. Existing stop rules still apply. Keep answer and feedback evidence immutable because history checks their hashes even after a reset.

## Compatibility and limits

Assignment schema is v1; role run format is v2. Existing delivery v1 files work without migration. Old runtimes cannot read role v2. Do not downgrade a runtime while using these commands, or edit versions/fingerprints to force compatibility. Install this source artifact and run `doctor`; a package name/version alone does not prove which code an Office worker has.

No Office adapter, cross-run lock, transport authentication, sandbox, model execution or global budget manager is included. Each run has its existing atomic file lock and local read/write scheduling. Host processes must isolate multiple writers and validate actual revisions before integrating results.
