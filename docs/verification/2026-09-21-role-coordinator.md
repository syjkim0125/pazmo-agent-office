# Approved role coordination and bounded fixes — 2026-09-21

Story M3/M4/M5, V3/V4/V5; [task](../tasks/U6-role-coordinator.md). Extends the [actual remote tool/review connection](2026-09-21-codex-workspace-review.md). Model decisions remain scripted unauthenticated fixtures; this does not establish semantic engineering/review quality, G4 acceptance or delivery.

## Behavior

`OfficeCoordinator.run` advances one approved task using the existing store, handoffs, execution ledger and verification ledger. It constructs Engineer context, runs the isolated Engineer, admits its frozen candidate, starts its required readonly Reviewer and deterministic checks within global capacity, and awaits all owned supervisors. A failed joined round enters another Engineer attempt on the previous candidate. At most the initial implementation plus two fixes can run, with fresh test/review nodes for every round. Passing stops at `awaiting_g4`; it never marks done or accepts G4.

Role context reads the exact approved Story/Task/verification/decision bytes and verifies their digests. It includes task/revision/contract identities, relative workspace scope, check definitions and prior findings. The Reviewer also receives the original-to-candidate diff with replay verification. No host candidate directory, operator token or auth path is included. Total packet size is limited to 8 MiB; feedback output previews are explicitly capped at 8,192 characters with a truncation flag, while full evidence stays in the ledger. These are initial Pazmo role instructions, not a claim that full CE/Superpowers skill profiles have been loaded or audited.

Engineer and Reviewer reservations now use their configured job timeouts. Direct ledger calls keep their prior ten-minute defaults, and deterministic nodes keep their approved check timeouts. Previously two ten-minute role reservations per round plus tests could prevent the third round from finishing inside the fixed one-hour budget even for short jobs. Actual reservations remain persisted, validated and nonrefundable; no budget limit was enlarged.

Cancellation is persisted in the shared task/round before workers receive abort. Contract invalidation and terminal round changes are monitored at one-second intervals, not as a real-time guarantee. Unknown closure keeps capacity occupied and cannot initiate another fix. In-process duplicate calls return deferred; persisted reservations prevent duplicate work across coordinator instances. Startup's existing interrupted-execution recovery remains authoritative.

Other work occupying global slots returns `deferred` without consuming an Engineer reservation. Calling again after capacity changes resumes from stored state; this unit does not install an Office-wide wakeup pump. Closed failed handoffs return `human_required` on reconstruction even if they never produced a verification round.

## Evidence

- Test-first: new coordinator tests failed before the module existed. Twelve final counted cases exercise successful fix/recheck, two-fix exhaustion, G1/G3 absence, contract mutation, pre-launch and in-flight cancellation, duplicate invocation, unknown Reviewer closure, external capacity deferral/resume, job-construction failure and failed Engineer reconstruction.
- The failed Engineer reconstruction regression first returned `deferred` instead of `human_required`. The coordinator now checks the latest persisted handoff before constructing another job. No new role packet or attempt is created on that path.
- A fixture initially reused a supervisor handle derived only from candidate digest. Repeated unchanged candidates correctly hit the database's handle uniqueness constraint. Fixed the fixture to use distinct attempt handles; did not relax production uniqueness or candidate checks.
- Actual CLI/VM automatic-flow script: initial Engineer intentionally writes `needs-fix`; a real VM assertion fails; the controller sends its failure to a second Engineer; that writes `after`; fresh real VM test and separately supervised readonly Codex review join on the second candidate and reach G4 waiting. The original project remains `before`. All six role/check leases are released and four role controllers report closure; task context is observed in the localhost Responses requests. Reinvocation at G4 launches no further role. Container/volume inventories are empty.
- Existing actual Codex/VM four-scenario regression (pass, Engineer cancel, malformed review, Reviewer cancel) passes after timeout propagation and fixture changes. No model/account credentials are used; fake host secrets and original source remain preserved.
- Fresh full root suite **184/184, exit 0**, TypeScript **exit 0**, configured vendor lint **exit 0** (0 errors / 40 existing warnings). Workflow Story/Task checks, Compound frontmatter, formatting and diff checks exit 0. Logs and source hashes are recorded in [compact evidence](role-coordinator.json). Vendor lint covers `src server` inside the vendor package, not root runner code. G4 is explicitly skipped by the Story checker.

## Review and simplification

Sequential in-session review per the user's agent mapping, not independent peer review or a branch-wide CE receipt. Checked approval/context provenance, candidate ancestry, new round evidence, parallel slot accounting, duplicate dispatch, cancellation ordering, capacity deferral, budget persistence, failed supervisor recovery and no automatic G4 acceptance.

The reuse/quality/efficiency pass retains existing runner and ledger boundaries. Coordination owns routing and lifecycle; role-context construction owns document/diff input; process adapters retain isolation/evidence capture. No generic graph framework, second queue or duplicate budget state was introduced. The loop terminates on stored terminal state, unavailable capacity or bounded fix exhaustion. No additional behavior-preserving refactor was warranted after the reconstruction fix. Rechecked that affected scope before final validation.

Compound updated the existing [historical round/state lesson](../solutions/logic-errors/historical-round-queue-mutation.md) with failed-handoff reconstruction and non-runnable versus capacity states. Knowledge-store discoverability is already covered in AGENTS.md.

## Remaining work

Public execution stays locked. The coordinator is a controller-internal entry point exercised by the integration script, not an Office UI launch or an authenticated scheduler. Pending controller-authentication G3, full tool/config/hook/MCP/network/nested-agent canaries, verified live role profiles and model behavior, Office capacity wakeups, explicit unknown recovery, G4 semantic evaluator/approval, delivery and an actual project pilot remain. Fixture tasks/approvals/judgments cannot stand in for those requirements. Large production role packets still require qualification of the eventual CLI input transport; the actual fixture sends a small prompt.

Reproduce with Node 24.19.0, installed development dependencies and the existing dedicated VM:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
node scripts/test-role-coordinator.mjs /absolute/path/to/verified/linux/codex
node scripts/test-codex-workspace.mjs /absolute/path/to/verified/linux/codex
```
