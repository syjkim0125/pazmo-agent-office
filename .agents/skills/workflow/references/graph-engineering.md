# Graph execution

Use the installed Graph CLI automatically after G1; no user opt-in, extra npm install, API key or custom JavaScript adapter is needed. The host (Codex/Claude) executes agent and tool work. The local CLI checks dependencies, persists results and tells the host what to do next. It does not launch models or execute arbitrary commands from JSON.

Read `skill-integration.md` when selecting Superpowers or CE for a graph node. Each selected skill implements only that stage; its own completion or shipping workflow cannot replace the kit's remaining gates.

## Roles and graph ownership

The kit supplies graph construction, deterministic validation, dependency scheduling, joins, evidence and failure routing in both standalone use and Agent Office. Office assigns people-like roles, launches agents, carries messages and displays progress; it uses kit readiness/results rather than implementing a competing graph state machine. Office does not disable the kit graph.

A role is not necessarily one node. A Developer may perform several implementation nodes; a Reviewer may inspect several independent areas. Function nodes perform deterministic checks without an agent. Split nodes only for a meaningful dependency, distinct evidence or recovery boundary.

For a delegated node, the dispatch must identify the kit run, node, started token, role, task description, approved Story constraints, allowed access and direct dependency outputs. The assigned agent applies the relevant procedure and returns summary, evidence and explicit evaluation to that same run. It must not initialize a new delivery graph, repeat G1/G4, spawn an unbounded team or implement changes inside a read-only review assignment. Missing scope or inputs must be reported to the dispatcher rather than invented. The kit graph is already active: executing its assigned node is graph use.

For a separate role objective, use the durable `init-role` entrypoint in [role-graphs.md](role-graphs.md). It supplies PM, team-lead, developer and reviewer flows without appending the whole delivery envelope. PM intake before G1 remains non-implementation work and cannot authorize production edits. The optional generic API is still available for custom graphs, with the different guarantees listed below.

Role-local execution and host enforcement are compatible. An agent performs its assigned kit flow; Office uses that flow's identity and results to dispatch work and accept its outcome. Office also applies host-owned permissions, cancellation and global budgets. It must not reimplement the role's workflow rules or treat a worker's "done" message as proof of graph completion. If a role uses a separate graph, link its run to the Office assignment and target revision; its completion is only that role's outcome, not completion of the whole delivery. This describes the integration contract, not an adapter already shipped by the kit.

Link messages to run/node/attempt and the requirement, question, decision, artifact or finding they concern. A review failure goes back through the kit's corrective route to the responsible implementation node. Only the overall delivery owner presents G4 after final evidence, using the actual user's response. Role completion is not project completion.

One controller owns each persisted kit run through the CLI. Its file is authoritative for local transitions; Office owns the shared goal, acceptance criteria, assignments, collaboration and integration. Office may index local progress but must not independently advance a copy. The CLI file store is not a finished Office adapter. Locking and write exclusion apply within that run, not across separate runs or processes editing the same repository. Office must isolate independent writers or serialize them and enforce any overall time/cost/cancellation limits. The kit's three-attempt bound does not implement an Office-wide budget or process cancellation.

## Initialize or resume

Read the approved Story, relevant code/tests and prior learnings. Complete required G3 before implementation. Reuse repository-grounded planning/review already performed by Compound skills; do not repeat it with a fixed team of analyzers, advocates and mediators.

Use a stable run path for the Story, such as `.ai-workflow/runs/<slug>.json`. If it exists, run `status`; never replace it to escape a failure. For a small/reversible change, use the built-in plan:

```bash
node .ai-workflow/bin/graph.mjs init - .ai-workflow/runs/<slug>.json docs/<story>.md
node .ai-workflow/bin/graph.mjs status .ai-workflow/runs/<slug>.json
```

The minimal plan is `implement → workflow-review → workflow-verify`. Implementation includes test-first work, related GREEN tests and bounded simplification. Final review checks the diff; verification supplies fresh checks after any fixes. No separate plan document is needed for small work.

For independently meaningful outcomes, write a reviewed JSON plan (HOW only; Story M/V IDs remain canonical):

```json
{
  "id": "coupon-change",
  "nodes": [
    { "id": "model", "description": "Represent the approved coupon rules", "access": "write", "covers": ["M1"], "verify": "Exercise allowed and rejected model transitions" },
    { "id": "api", "description": "Expose the approved behavior", "access": "write", "covers": ["V1"], "verify": "Check the Story's API success and failure cases" }
  ],
  "edges": [{ "from": "model", "to": "api" }]
}
```

Every Story M/V ID must be covered and unknown IDs are rejected. `description`, `verify`, `covers` and `access` are required per task. Use the actual Story IDs, not these example IDs. Run `init <plan.json> <run.json> <story.md>`; it deterministically validates references/cycles and appends mandatory final review/verification. Never put human approval inside generated nodes.

## Execute ready work

1. Read the JSON status and its `action`. Give each worker only its task, Story constraints, relevant files and `input.dependencies`; do not send the whole run/history. Read evidence files by reference as needed.
2. Reserve each ready task before starting work:

   `node .ai-workflow/bin/graph.mjs start <run.json> <node-id> <ready-token>`

   Use the returned `started.token` for the result record. Start durably counts the attempt and marks it running, preventing duplicate dispatch and overlapping writers. Execute only reserved tasks. They include a token for that unique run, exact attempt and dependency state. One host controller owns the run. Read-only tasks may run concurrently within the host's limits; write tasks are exclusive. A read node must not edit code: fail it with `fix` and reset the earliest implementation node when changes are needed.
3. Save actual observations to a new, nonempty project-relative evidence file per attempt. Include changed files, commands, exit codes, review findings and verification limits as applicable. Do not overwrite evidence from completed independent work. Long logs remain files, not copied model context.
4. Write a result JSON with the started task's token:

```json
{
  "token": "copy started.token from start",
  "output": { "summary": "Describe the observable result", "evidence": ["docs/understanding/coupon-model-attempt-1.md"] },
  "evaluation": { "passed": true }
}
```

```bash
node .ai-workflow/bin/graph.mjs record <run.json> <node-id> <result.json>
```

A failed result uses `"evaluation": { "passed": false, "action": "fix", "feedback": "Specific failed expectation and affected task" }`. Evaluation is mandatory. An omitted value, empty evidence, premature node or stale token cannot complete a task. The CLI validates evidence existence and hashes, not the truth of observations; the host must actually run and assess the checks. CLI exit 0 means the record was accepted, including a failure record: inspect `action` and `failed`.

## Route the next action

| Action | Host behavior |
|---|---|
| `execute` | Perform ready tasks and record their results. Fetch fresh status after each completion. |
| `wait` | Wait for running workers; do not dispatch them again. After an interrupted session, inspect their side effects and explicitly reset stopped workers. |
| `fix` | Identify the earliest affected task; reset it before doing corrective work, then rerun it and invalidated descendants. Independent results stay recorded. |
| `replan` | Correct the plan; validate it into a new run and retain the old run as evidence. Scope changes use the existing human gate. |
| `human` | Surface the unresolved decision and wait. After resolution, use a new run reflecting it. |
| `stop` | Report exhausted attempts and evidence. Do not restart under a new filename without an explicit decision to continue. |
| `question` | Transport the pending question; submit the matching answer and continue with `resumed.token`. See `role-graphs.md`. An answer is not approval. |
| `role-complete` | Return the role's native outcome and evidence to the caller. This does not finish delivery. |
| `g4` | Follow `understanding-gate.md`; this is readiness, not approval or delivery. |

```bash
node .ai-workflow/bin/graph.mjs reset <run.json> <earliest-affected-node> "What will be corrected and why"
```

Reset the implementation node when a review requires code edits; resetting only the reviewer would retain invalid implementation evidence. Stop any affected running workers before reset; reset invalidates their old tokens. Reset preserves attempt counts; three attempts is the per-node limit. No automatic repeated side effects or unrestricted retry loop. Changing graph content or Story requirements invalidates the run; progress/gate metadata may change without invalidating requirements. New plans conservatively start fresh instead of guessing which old outputs remain valid.

Writes use an exclusive `.lock` and atomic file replacement. After a crashed CLI process, inspect the lock's owner and the run before manually removing a stale lock. Never delete a live writer's lock. Avoid simultaneous install/remove and execution. Updates/removal preserve run and evidence files; keep those separate from the managed `.ai-workflow/graph/` runtime.

## Programmatic API (optional)

After init, import from `./.ai-workflow/graph/index.mjs`. Consumers who install the npm package as a dependency can also import `@pazmo/ai-workflow-kit/src/graph/index.mjs`.

`executeTaskGraph({ graph, runNode, evaluateNode, context, runState, maxConcurrency })` requires explicit evaluation results. Default concurrency is 1; a higher positive integer allows overlapping nodes marked `access: 'read'`. Writers and undeclared-access nodes run exclusively. A newly ready node starts as soon as a slot becomes available; joins wait only for their dependencies. `waves` records dispatch batches, not global barriers.

Node input is `{ context, dependencies }`, copied to avoid shared mutation. Persisted states carry a graph fingerprint; changed plans and unknown/unevaluated statuses are rejected. Interrupted `running` nodes require an explicit `resetAffectedSubgraph` after checking external side effects. This in-process API does not persist checkpoints or approve gates; use the installed CLI for the durable host workflow.

The generic API is not the delivery CLI's policy API. Choose the interface by its actual guarantees:

| Responsibility | Generic API | Delivery CLI | Host |
|---|---|---|---|
| Dependency readiness, read concurrency, exclusive writers | Within one execution | Within one run | Isolate or serialize work across runs |
| Attempts | Counts starts; no built-in cap | Maximum three starts per node | Enforce global time, cost and attempt budgets |
| `human` / `replan` evaluation | Records the action; independent work can continue | Routes to the decision; no further start until resolved in a new run | Stop affected processes and obtain the decision |
| Evidence and persistence | Returns state and explicit evaluation; no evidence-file checks or checkpoint store | Checks evidence files/hashes and persists run changes | Verify observations and bind them to the actual code revision |
| User approval and tool permissions | Not provided | Checks approval records, not identity; does not intercept tools | Own actual approval events and execution permissions |

Do not assume `executeTaskGraph` or `resetAffectedSubgraph` enforces the delivery CLI's retry or human-decision rules. Office integration must first identify its actual dispatch, storage, cancellation and result-application boundary. If it needs shared delivery transitions, extract only the necessary rules from the CLI when connecting that consumer; do not duplicate the rules in Office or invent an unused public API in advance.

`access: 'read'` describes product-code access, not a filesystem sandbox. Review evidence and test-generated files may still require designated output paths. Host enforcement must distinguish these from product edits. Multiple developer processes alone do not provide safe parallel implementation: the host must manage workspace isolation, integration and verification of the combined result.

`createPlanningGraph()` supplies `planner → review → validate-graph`. Planner/review callbacks return task graphs; the last node executes built-in deterministic validation rather than an LLM callback. Research and extra review roles are chosen for the work, not required by the graph.
