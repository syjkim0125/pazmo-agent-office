# kit 4.1.0 role runs and the authorized README pilot

Scope: Story D7, M2–M4/V2–V4; `docs/tasks/U6-kit-role-runs.md`. Branch `codex/office-kit-role-graphs`, starting at `385a459b2a9ce8764a99914104bcc754d1ffba79`. This is an integration checkpoint, not whole-Story delivery.

## Installed contract and ownership

Installed the official npm `@pazmo/ai-workflow-kit@4.1.0` tarball after checking registry SHA-512. `upstream/kit.lock.json` records integrity, source commit and runtime hashes; the 12 inspected CLI/runtime/reference files matched kit source `696ac4b`. The kit repository was read only. `doctor --root .` and actual Graph CLI help passed. New role commands were exercised through the installed CLI, not inferred from a version string.

Kit run files own local transitions. `KitRoleRun` only invokes the trusted installed CLI. Office stores immutable assignments and evidence receipts, actual candidate manifests, global process budgets, cancellation and human approvals. The Developer keeps one run across fixes; each review binds its own assignment to the produced snapshot. Developer self-check uses registered VM checks before the readonly Reviewer. A native role-complete verdict never delivers the project.

Actual Office G1 can precede changes to the Story's Draft metadata. The adapter derives an immutable approved source view from the exact DB approval event, leaves canonical source bytes unchanged and rechecks the original contract on each call. Neither the view nor a kit response creates a human approval.

## Review and regression evidence

- Final root suite: **292/292**, exit **0**, Node 24.19.0; `/private/tmp/pazmo-kit-role-final-292-tests.log`. Earlier 290/290 passed. The first expanded run exposed nine migration-fixture failures: the new feedback table was removed before constructing the ledger that creates it. Moving that fixture removal after construction yielded 9/9 focused passes, followed by this full pass. The unprivileged suite encountered loopback EPERM; authorized local-server runs establish the result.
- TypeScript and `git diff --check`: exit **0**. Parent Story and U6 Task checkers: exit **0**; parent remains Approved, so the Story check does not check G4.
- Inline sequential review found and fixed G4 reuse after kit evidence changes, legacy-mode bypass of existing kit assignments, lost dispatch tokens after capacity waits, and incompatibility between DB approval and Draft source metadata. Focused regressions accompany each fix. Review used the main context under the user's tool mapping; it is not an independent reviewer receipt.
- Question/answer checks use the returned resumed token and reject duplicates/stale records. Changed source, cancelled calls, wrong candidate and the maximum three implementations are covered. Self-check and Reviewer capacity waits resume the saved native packet without adding an attempt or replaying Engineer work.
- Compound updated `docs/solutions/architecture-patterns/pin-bounded-role-instructions.md`; mechanical claims and frontmatter checks passed. Lightweight non-interactive capture, no subagents, no semantic validator. No CONCEPTS.md existed, so vocabulary creation was deferred; active instructions already identify docs/solutions. Documentation complete.

## Current machine qualification

The global Codex changed from qualified 0.155.1 to 0.156.0. The integration did not weaken the hash pin or change the global installation. It restored official 0.155.1 macOS and 0.154.0 Linux binaries in private temporary paths, verified registry SHA-512 and the previously qualified binary SHA-256 values, and reran all **five** actual CLI/VM scenarios: pass, cancel, invalid review, review cancellation and executor failure. All passed, exit **0**.

Report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-codex-workspace-luBWp6/report.json`; log `/private/tmp/pazmo-role-controller-qualification.log`. This uses scripted localhost model responses and no account. `PAZMO_CODEX_CONTROLLER` selects an alternate controller path in the qualification and live scripts; the same fixed hash check still applies before execution.

## Real task approval and execution

Task `1673c3aa-71f7-47dc-a96e-601f6a7a4e93`, revision 1, contract digest `b7444f90c330eae51031791999b444a0bc22725e08771cc5dde1727a3a26f2c5`. The original actual PM/Lead proposal and contract are described in `2026-09-22-live-contract.md`.

The user answered **“이 문서 작업으로 진행”** to the concrete README authentication-guide G1 question. This exact approval was recorded in Office after backing up its DB; task readiness became true. The prior authentication-location G3 was reused, not re-requested. Original pilot Story bytes remain unchanged. Its historical pending text is superseded by this actual DB event and this record.

The first authenticated `--kit-roles` run reached awaiting_g4 with five checks and the actual Reviewer passing. Report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-live-planning-6BDObz/live-contract-YCDDfr/report.json`. Requested model was gpt-5.5; the serving model is not independently identified. No generated G4 answer or automatic approval was recorded.

Controller integration review then found an actual wording contradiction: README line 22 said actual model calls were separate from the Codex subscription login while saying the controller uses that login. This is an M2/M3 clarity issue, not an injected failure. The original passing Reviewer observation remains immutable. A separate `pazmo_integration_feedback` event binds the exact candidate/contract, removes G4 eligibility and routes through the existing two-fix budget. The next Developer packet and native kit feedback carry that finding. This distinguishes model Reviewer feedback from controller integration feedback.

The resumed authenticated run completed **one actual fix and fresh verification**: round 2 candidate `0f97c1493cb5c8c7b675808ebb4675b745ceff999760ed5f7734a96ca929399d`, V1–V5 exit 0, fresh Reviewer pass with no findings. All 14 process leases across two rounds are released with no closure error. Developer uses the same native run with implement/self-check attempt counts 2; kit history contains the feedback event. Both Reviewer assignments identify their exact respective candidates. Native status is role-complete for these roles; Office is awaiting_g4, not delivered.

Private report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-live-planning-6BDObz/live-contract-ISY92J/report.json`. [Sanitized observations](2026-09-23-live-kit-pilot.json) retain result identities, actual feedback provenance, native history and hashes of four private model-call records. [Raw diff and G4 evidence](../understanding/auth-guide-pilot-diff.md) are ready for the user. The original checkout README remains unchanged until approved artifact handling. This proves a controller-assisted real model loop, not the full public Office experience or worker skill qualification.

The new feedback regression first failed on the absent method, then passed. An integration test confirms prepared G4 is rejected after feedback, the same Developer run receives it, the next changed candidate has a new review and fresh G4 evidence. Attempt-three feedback escalates to human_required; it cannot create a fourth implementation. The method is controller-internal, with no public unauthenticated feedback endpoint.

## Reproduction and limits

Use the qualified Node/VM setup and an existing current approved Office task. Do not run another controller over active or unknown leases. The following is an internal operator entry; public UI launch remains locked:

```sh
PAZMO_CODEX_CONTROLLER=/absolute/path/to/qualified/macos/codex \
  node --experimental-vm-modules scripts/run-live-contract.mjs \
  --live-approved "$PROJECT" "$DB" "$TASK_ID" "$LINUX_CODEX" --kit-roles
```

The command prepares evidence at awaiting_g4; it neither approves nor delivers. Reuse the same task/run after a capacity wait. An uncertain process, missing dispatch receipt or interrupted cross-store write requires explicit inspection; do not delete the run or forge a token. Legacy tasks remain supported but existing kit assignments cannot be resumed in legacy mode.

Remaining: PM/Lead role-graph connection after intake, public execution and question/answer UI, actual worker CE/Superpowers qualification, trusted user-facing G4 evaluation, learning retrieval, full restart/failure live coverage, and tarball installation. The worker currently receives the bounded kit node and Pazmo profile; installed host skills are not claimed as worker skill execution. Proposed optional kit recovery/approval seams are distinguished from current CLI commands in `docs/kit-office-integration-request.md`.
