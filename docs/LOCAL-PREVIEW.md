# Local development preview

Requires Node **24.19.0** (tested) and the checked-out repository. The Claw preview stays read-only. The separate operator screen supports planning, approvals and execution when the qualified runtime is explicitly enabled below. The complete local-alpha model/user acceptance flow is still under verification. Do not use the imported vendor start/dev commands: those start the unguarded upstream runtime.

## Build

The root package has no dependencies. Development build tools come from the pinned vendor lockfile. Installation explicitly skips all dependency lifecycle scripts.

```sh
npx --yes pnpm@10.30.1 --dir vendor/claw-empire install --frozen-lockfile --ignore-scripts
npm run build:office
npm run typecheck
npm test
```

Tests start temporary loopback servers. Restricted execution environments must permit that binding. Remotion browser downloads, optional submodule initialization, provider authentication and model execution are not part of these commands.

## Run against an existing project directory

Use an existing project outside the Office installation. Choose a controller data directory outside both the project and Office installation, and pass the same paths on every invocation. The data directory gets a project-specific hash suffix.

```sh
node bin/pazmo-office.mjs init --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs init --project /absolute/path/to/project --data-dir /absolute/path/to/office-data --apply
node bin/pazmo-office.mjs doctor --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs start --project /absolute/path/to/project --data-dir /absolute/path/to/office-data --port 0
node bin/pazmo-office.mjs status --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs stop --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs remove --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs remove --project /absolute/path/to/project --data-dir /absolute/path/to/office-data --apply
```

`init` and `remove` default to dry-run. `--apply` is the only mutating form. A new `.pazmo-office` folder contains templates and an ownership manifest; other project files remain untouched. Remove deletes only unchanged manifest-listed regular files, retaining modified files and the Office DB/logs. Partial init, foreign DBs and unauthenticated runtime state are preserved for inspection, not repaired automatically. Do not delete an unknown runtime state file just to restart it.

`start` prints a loopback URL. Port `0` chooses a free port; the default is `8790`. Three seeded roles are visible but no models run. CLI stop authenticates the controller instance; it never signals a PID copied from a state file. Doctor reports build/initialization facts and `execution: locked`; exit 0 is not live-execution readiness.

## Qualified live startup and screen controls

Use the existing Mac Codex login and the already qualified dedicated `pazmo-office` Colima VM. The controller must be the native macOS arm64 Codex **0.155.1** binary matching Office's pinned hash; the VM executor must be the qualified Linux arm64 **0.154.0** binary. A mutable npm launcher or updated global installation is not accepted. Durable qualified-binary installation is still part of the remaining first-use setup; this command assumes those two files already exist. No credentials are copied into candidates or containers.

After `init --apply`, stop any existing preview, then run from this Office checkout:

```sh
node bin/pazmo-office.mjs start --live \
  --controller /absolute/path/to/qualified/macos/codex \
  --executor /absolute/path/to/qualified/linux/codex \
  --project /absolute/path/to/existing-git-project \
  --data-dir /absolute/path/to/persistent-office-data --port 0
```

Startup checks binary hashes, login-file presence, the Git root and dedicated VM/image. Login-file presence does not prove that the subscription is currently valid; actual model errors remain in task state. Per-run VM configuration and kit integrity checks remain mandatory. `status` reports the instance's runtime readiness. `doctor` remains a preview/installation check. Keep the same persistent data path across normal restarts. The worker Git project must be outside the Office installation and must not contain it.

1. Open **작업 관리** and connect using the private Operator key described below. **모델 실행 준비 상태 확인** shows readiness and owned operations.
2. Save a request, select it, and click **PM 실행**. Model calls consume the existing Codex account's usage. Use **대화 새로고침** to see progress, questions or Story G1. Answer questions and explicitly resume the waiting role.
3. Inspect and approve the PM Story scope. Click **팀장 실행**, inspect the proposal, then **이 계획을 실행 승인 대기로 등록**. Registration writes proposed documents and contract drafts; it does not authorize implementation.
4. Select the registered task under **실행 결과**. Inspect **실행 계획·범위·검사 확인**, including actual documents, workspace and check commands. **실행 계획 승인하기** records execution-contract G1; high-risk contracts also require G3. These differ from PM scope approval and final G4.
5. Select the task again to refresh, then **구현·리뷰·검증 실행**. Inspect the same-candidate checks, review and diff. **이 작업 실행 취소** persists cancellation before signaling workers; a request's own cancel control applies to PM/Lead.
6. G4 questions and answer submission are supported. **The trusted G4 answer evaluator is not yet connected to this live service**, so a new answer remains awaiting evaluation. The system will not fabricate approval or deliver without it.

Normal `stop` refuses while an operation owns a worker: cancel, wait for cleanup, then stop. SIGTERM requests cleanup before SQLite closes. Unknown leases remain held after restart and require inspection; do not delete records to retry. Planning captures bounded tracked/nonignored files once, omits protected authentication/Office metadata, and reuses that frozen context across questions/G1. Later edits are not silently added. Unsupported selections such as submodules fail explicitly. Capture is not an atomic snapshot of concurrent editor changes or a general secret scanner.

[Launch validation and remaining alpha work](verification/2026-09-23-live-launch.md).

## Preview limits

`PlanningCoordinator` uses kit 4.1.0 PM clarify/propose, waits for actual operator Story G1, then uses Lead investigate/plan against a readonly snapshot. Questions resume the same native node. It shares the three execution slots with Engineer/Reviewer/tests and retains unknown slots after restart. Existing legacy conversations keep their original protocol. The supported operator launch reuses this coordinator. [Native planning evidence](verification/2026-09-23-kit-role-runs.md#native-planning-and-story-g1-continuation).

`OfficeCoordinator` connects approved context, Engineer, registered checks/readonly review and up to two fixes. Live operator launch reuses it and stops at G4 waiting. Earlier actual-model evidence came from the internal pilot; the complete screen-driven model/user flow remains unverified. There is no automatic capacity-wakeup scheduler. [Coordinator evidence](verification/2026-09-21-role-coordinator.md).

Office, Dashboard and the empty Tasks board were exercised in the browser. The banner and Dashboard describe the lock. Creation controls on Dashboard/Tasks are disabled. Other imported controls are not supported workflows and may show an error; the server rejects all public mutations and unsupported APIs with 423. WebSocket orchestration is not connected, so the original UI displays Offline/Disconnected. No operator approval session is granted by `/api/auth/session`.

The preview process imports the pinned Claw schema/seeds and uses its UI; it does not import its scheduler, process launcher, updater or recovery routes. These will need the approved guard integration before live operation. Source-free tarball execution, Linux support and browser approval flows are unverified.

## Operator contract and approval CLI

### Planning conversation screen

Open the `start` URL and follow **작업 관리**, or append `/operator`. The screen uses the same operator capability as the CLI; loopback alone grants no access. Preview saves requests; qualified live startup enables explicit model execution.

Use the actual project-specific `dataDir` returned by `start`/`status`. In your private terminal, read its `running.json` to obtain `instance`, then open `operator-<instance>.json` in that same directory and copy only its `token` value into **Operator 인증키**. Do not paste that file into an agent conversation, place it in the project, or share it. The screen does not receive the runtime control token from `running.json`. This manual pairing is an interim user flow; automatic browser pairing is not implemented.

This key permits operating this Office instance. It is separate from the Codex account login needed for actual model execution. The browser keeps the key only in page memory, sends it in the existing Authorization header, and clears it on disconnect/reload. Office restart rotates the key; reconnect with the new instance's operator key.

The screen supports request creation, 50-item pages, saved conversations, role questions and cancellation. New requests select native kit role graphs. After PM completes, the full Story includes exclusions, assumptions and verification. **이 범위로 계획 진행** or **범위 거절** records the operator's own reason. Scope approval permits Lead planning; it does not approve the execution contract or final result. Automated screen checks use fixture questions and approvals, not actual model/user decisions.

Failed writes preserve drafts and are never automatically retried: refresh to determine whether an uncertain request was saved. Changed conversations retain previous answers as separate drafts instead of applying them to new questions. Disconnect/reload clears local drafts; saved Office conversations remain. G4 submission is distinct from the trusted controller's evaluation and does not itself authorize delivery.

[Screen verification and evidence limits](verification/2026-09-22-intake-console.md).

Contract `ready: true` means only that the current contract has required approvals; runtime readiness and explicit launch are separate. Contract records retain legacy `execution: locked` metadata. Use `/api/pazmo/runtime` or `status` for the live controller's capability, never the contract alone.

Prepare canonical Story and Task Markdown in the target project. The Task must be `Implementation-ready`, with `Story: story.md` pointing to the selected project-relative Story path and real M/V references. Draft Stories may be submitted for G1, but unresolved `OPEN BLOCKING` decisions are rejected. Markdown `Approved` or `PASS` text never grants operator approval.

Create `contract.json` with project-relative document paths:

```json
{
  "story": "story.md",
  "task": "task.md",
  "verification": "verify.json",
  "risk": "high",
  "decision": "decision.md"
}
```

For normal-risk work use `"risk": "normal", "decision": null`. The operator chooses the risk classification; this is not an automatic risk detector. High-risk work requires a decision document and G3. Document paths must be distinct and cannot contain symlinks or hidden path components. Each document is limited to 1 MiB.

`verify.json` records the exact future verifier command and timeout; registration never executes it:

```json
{
  "version": 1,
  "checks": [{ "id": "V1", "argv": ["node", "--test"], "timeoutMs": 30000 }],
  "workspace": { "include": ["src", "test", "package.json"], "exclude": [] }
}
```

Every covered V ID needs a check, and the selected V cases must cover the Task's M IDs. There can be 1–32 checks, each with a timeout of 1–600000 ms. Commands will need the isolated runner before they can execute.

`workspace` declares the complete project-relative input/output selection for the Engineer. Included roots may be absent initially; exclusions are scratch paths strictly inside those roots. Use explicit roots appropriate to the task, or `"include": ["."]` with deliberate exclusions. Protected metadata/authentication paths are omitted from source and rejected in output; this is not a general secret scanner. The selection is part of the approved contract. Older contracts without it remain inspectable but cannot prepare an Engineer attempt. Changing it requires a new approved revision. No CLI command launches the Engineer yet.

With the Office started, use the same project/data paths as lifecycle commands:

```sh
node bin/pazmo-office.mjs contract --file /absolute/path/to/contract.json --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs contracts --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs approval-request --task-id TASK_ID --gate G1 --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
```

Read the referenced documents and the returned digest/revision/checks. Write your decision as JSON, for example `{"decision":"approve","note":"I reviewed the scope and verification limits."}`, then submit it using the returned challenge ID:

```sh
node bin/pazmo-office.mjs approval-decide --challenge CHALLENGE_ID --file /absolute/path/to/answer.json --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
```

Repeat the request/decision for G3 when required. A challenge expires after ten minutes and can be consumed once. `reject` records rejection of a pending gate; it does not withdraw a previously accepted gate. Refresh a changed contract with `contract --task-id TASK_ID --file ...`; its new revision requires new approval. Changed documents immediately make `contracts` report `CONTRACT_CHANGED`, even before refresh. The imported task board may still show the last stored `planned` status; it is not a current execution-readiness indicator.

Operator credentials are generated separately from lifecycle credentials, stored with mode 0600 outside the project, and removed on an authenticated stop. Loopback and Markdown are not operator authentication. Processes with access to that private directory can act as the operator; separation from an actual untrusted worker remains unverified and execution stays locked. G4 requests require joined verification, closed execution receipts and a controller-prepared raw-diff bundle; otherwise they return `EVIDENCE_REQUIRED`.

### G4 understanding protocol

Once that evidence exists, `approval-request --gate G4 --task-id TASK_ID` returns raw evidence and three questions. Use `approval-decide` with your own `understanding.behavior`, `understanding.invariant` and `understanding.evidence` strings alongside `decision` and `note`. This records **awaiting_evaluation**, not acceptance. The trusted controller must separately evaluate the exact answer; there is no CLI command to self-approve that evaluation. The internal preparer now derives `evidence.diff` from two frozen snapshots using actual Git, verifies patch replay, and exposes `rawDiffEncoding` (`utf8` or `base64`) plus `modeChanges`. Empty diffs can mean permission-only changes or an unchanged snapshot; inspect the metadata and both digests. Old bundles without this proof cannot open G4. The internal preparer selects the original baseline from a persisted successful Engineer handoff and rejects unbound candidates. Actual Codex tools now connect through internal Engineer and readonly Reviewer adapters with scripted localhost responses; authenticated models and the semantic evaluator remain unconnected. Protocol tests still use fixture judgments and human assessments.

Use `verification --task-id TASK_ID` to inspect `completion`. It distinguishes pending answers/evaluation, required restatement, rejection, accepted current evidence, stale evidence and expired pending challenges. A new operator session expires old pending questions while preserving their answers. G4 acceptance alone does not deliver files or unlock model execution.

## Verification evidence

With the Office started, inspect the latest controller-owned verification round:

```sh
node bin/pazmo-office.mjs verification --task-id TASK_ID --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
```

The response contains `verification: null` if this registered task has no round, or its candidate, required nodes, recorded results and routing state. It also includes `executions`, the task's execution reservations and their state, and `handoffs`, including baseline/candidate ancestry and supervisor receipts. These are private controller records, not worker-submitted proof. Unknown task IDs fail. The corresponding `GET /api/pazmo/verification/:taskId` requires the private operator credential; lifecycle credentials are insufficient. There is no public result-submission endpoint. Candidate/contract changes or expired execution reservations discovered on inspection invalidate eligibility, so this query can persist a safety-state change.

At startup, interrupted `checking` rounds become `human_required` with `CONTROLLER_RESTARTED` before requests are accepted. Completed evidence remains available and is rechecked on inspection. This neither resumes nor proves termination of a worker. Actual execution remains locked; G4 needs the additional evidence and assessment described above.

Interrupted execution reservations also become `unknown` on restart and keep their slots occupied. The internal accounting caps all executions at three, with two Engineer slots and two automatic fixes. Offline test supervision/dispatch and an internal VM workspace job adapter are connected. The latter performs actual Codex file edits and result recovery in disposable integration tests. A readonly Codex Reviewer adapter joins a structured report on that candidate, with malformed output and cancellation refusing success. These use scripted model responses and have no public CLI launch command. See [evidence](verification/2026-09-21-codex-workspace-review.md). Authenticated model supervision is still unconnected. There is no operator command to discard unknown leases or force free slots.

New instances use schema version 10. An owned version-1 through version-9 Office DB gets an `office-vVERSION-UUID.sqlite` backup before the additive migration; foreign or unknown databases are refused. Schema creation, version changes and interrupted-round/execution recovery share a transaction. To recover a failed migration, stop the Office, preserve its failed DB and backup, and restore the matching backup together with the previous runtime. Do not overwrite a running database.

### Planning requests and replies

With the Office running, save `request.json` containing `{"request":"Validate parser input.","risk":"normal"}`. Use `high` for a task that requires a separate G3 decision. Register and inspect it with:

```sh
node bin/pazmo-office.mjs intake-create --project /absolute/project --file request.json
node bin/pazmo-office.mjs intake --project /absolute/project --task-id TASK_ID
```

Include the same `--data-dir` used at init if it was overridden. Registration currently persists `waiting_pm`; live PM/Lead supervision remains disabled. It does not silently start a model. Questions and model proposals can only be recorded by the internal controller, not through an operator model-result endpoint.

When an intake is `awaiting_answer`, copy its current numeric `revision`, `inputDigest`, and exact question IDs into an answer file such as `{"revision":2,"inputDigest":"DIGEST_FROM_INTAKE","answers":[{"id":"Q1","answer":"The public parser."}]}`. Then submit:

```sh
node bin/pazmo-office.mjs intake-answer --project /absolute/project --task-id TASK_ID --file answers.json
```

A stale revision, wrong question ID, or missing answer is rejected. Re-read the intake rather than resubmitting an obsolete answer. To cancel, save only the current `revision` and `inputDigest` in `cancel.json`, then run `intake-cancel` with the same project/task flags and `--file cancel.json`. Dialogue and cancellation survive restart. Invalid model evidence becomes `human_required`; automatic recovery is not enabled.

These commands use the private operator capability internally. The corresponding private paths are POST `/api/pazmo/intakes`, GET `/api/pazmo/intakes/:id`, and POST `/api/pazmo/intakes/:id/answer` or `/cancel`. No approval is created by any of them. The interactive Office controls and live planning supervision remain pending.

### Register a saved proposal

When the controller has produced an intake with `state: "proposal"`, inspect its proposed documents, commands and workspace scope. Save its numeric `revision` and `inputDigest` in `publication.json`, then run:

```sh
node bin/pazmo-office.mjs intake-publish --project /absolute/project --task-id INTAKE_ID --file publication.json
node bin/pazmo-office.mjs contracts --project /absolute/project
```

This command writes a new `office-plan-RANDOM/` directory in the project. It preserves existing documents and creates every proposed task in one database transaction with the publication receipt and dialogue event. It returns `state: "registered"` and `publication.taskIds`. These IDs identify the execution contracts; the original intake remains their conversation record. Each task still requires G1 and, for high-risk work, G3 through the existing approval commands. Registration starts no worker and does not approve the proposal.

The private API is POST `/api/pazmo/intakes/:id/publish` with exactly `revision` and `inputDigest`. The controller chooses the directory; caller-selected paths, documents or approval fields are rejected. Repeating the original successful request returns the same receipt, including after restart. Changing registered files makes the affected contracts report `CONTRACT_CHANGED`; refresh those contracts and obtain new approvals. `publication.documents` records original file digests, not a claim that the files are still unchanged.

On failure or a concurrent losing request, the new directory may remain without a committed publication. Preserve it for inspection; the error identifies the directory when available. A retry creates a different directory and never adopts or deletes abandoned files or user edits. A crash before commit has the same possible orphan-file outcome. Read the intake and `contracts` to establish whether registration committed before retrying. SQLite cannot roll back project files, and power-loss durability is not established by these tests. Published intakes no longer accept planning answers or intake cancellation; downstream execution has its own cancellation lifecycle.


## Inspect and accept a verified result in the operator screen

Open `/operator`, connect with the current Operator key, select **실행 결과 → 결과 목록 조회**, and choose a registered task. **검증된 diff와 승인 자료 보기** reads the controller's prepared evidence without creating an approval. The screen shows the actual diff and file permission changes; non-UTF-8 diffs are explicitly labeled Base64.

If G4 is waiting for an answer, the same question resumes. Otherwise **G4 답변 작성** requests a question for the displayed evidence. Enter your own understanding and decision; rejection requires only a reason. Submitting an answer is not approval. **답변 평가 대기** currently needs the trusted controller's separate evaluation; the public model/evaluator connection is still being implemented. No evaluation can be supplied by the browser. Previously saved answers and controller feedback are visible.

After server-confirmed approval, **승인된 결과물 인도받기** invokes the existing local delivery operation and shows the result directory. It does not modify the original project. Expired credentials preserve unsent text separately for reconnection; explicit disconnect clears it. Uncertain writes are never automatically retried: reload the task to confirm whether the server stored the result. Evidence reads reject missing, changed or invalidated verification; they cannot manufacture a diff or approve a task.

These controls were verified against real HTTP/SQLite ledgers with fixture role/approval results, and in Chrome with intercepted fixture API responses. They do not prove a completed live model/user flow. The earlier README pilot's explicit conversational approval remains recorded separately from its pending Office DB handling and delivery.

## Local delivery after evaluated G4

After the controller has separately evaluated G4, the operator may create the approved local artifact:

```sh
node bin/pazmo-office.mjs deliver --task-id TASK_ID --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
node bin/pazmo-office.mjs delivery --task-id TASK_ID --project /absolute/path/to/project --data-dir /absolute/path/to/office-data
```

`deliver` is a write command. `delivery` inspects the committed result. Both require the private operator credential. Delivery writes a controller-owned directory under the instance's `deliveries/`, containing readonly `candidate/tree`, its manifest, and `receipt.json` with raw diff, mode metadata, required results and G4 answer/evaluation. The receipt is private task evidence, not a public distribution package. The original checkout is untouched. The response returns the directory and content identities; inspect the candidate manifest for original file modes.

A current approved G4, joined evidence and confirmed process closure are all required. There is no CLI override for missing evaluator approval or an arbitrary output path. A successful repeat returns the same receipt. Only after the files are verified and the receipt commits does the task become done. Startup or private `delivery`/`verification` inspection detects missing/changed output and moves it to explicit recovery; ordinary preview polling shows the last stored state, not continuous filesystem validation. Never treat an unreferenced output directory as delivered.

This path was tested with scripted G4 judgments and actual Codex/VM tool output. The live semantic evaluator, authenticated model and public execution flow remain pending. [Evidence](verification/2026-09-21-local-delivery.md).
