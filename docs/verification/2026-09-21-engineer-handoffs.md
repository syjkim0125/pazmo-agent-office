# Engineer baseline and candidate provenance — 2026-09-21

Story M3/M4/M5, V3/V4/V5; [Task](../tasks/U6-engineer-handoffs.md). This connects controller-owned attempt records to verification and G4. It does not run an authenticated Engineer or finish the Story.

## Connected behavior

The approved verification JSON may declare `workspace.include` roots and `workspace.exclude` scratch paths. These bytes are part of the existing contract digest and G1/G3 approval. A missing selection cannot start an Engineer. Selection covers every leaf under the included roots, including later additions; absent roots support new files. Source metadata such as `.git`, `.codex` and non-example `.env` files is omitted. A result with protected or unselected paths is rejected; declared scratch paths are omitted. Limits bound selection roots, directory traversal, files and bytes. This is explicit path selection, not automatic secret discovery or an atomic filesystem snapshot under arbitrary concurrent host writes.

`HandoffLedger.prepare` reserves the Engineer and captures the registered project's baseline before staging its files in a private controller directory. Start checks that the staging tree still matches that baseline before binding a supervisor handle. Completion requires that same running handle and a successful closed-process receipt. Failed, cancelled, ambiguous, out-of-scope or changed output produces no verification candidate. Closure, the frozen candidate and the next verification round are committed together. A persistence failure quarantines the lease instead of rerunning it.

A fix begins from the failed candidate while retaining the original baseline. `CompletionLedger.prepare(taskId)` selects both ends through this ancestry; it no longer takes a caller-selected baseline. Its evidence subject binds the handoff lease, original baseline, final candidate, actual replayed diff and joined test/review results. Original-baseline tampering permanently invalidates the round even if bytes are restored. Extra JavaScript arguments cannot select a different baseline; they are ignored, not an argument-validation error.

Schema v6 adds `pazmo_handoffs`. Owned v1–v5 databases are backed up before migration. Private operator verification inspection includes handoffs and receipts; no public start/finish/result submission endpoint was added. Public execution remains locked.

## Fresh evidence

- Root suite **145/145, exit 0**, using Node 24.19.0. Includes 14 handoff tests/subtests, workspace selection and alias tests, G4 ancestry/tamper tests, real CLI/HTTP integration and v1–v5 upgrade/backup coverage.
- Integration run **35/35, exit 0** confirmed lifecycle/G4 behavior before the final complete suite.
- Fix-chain test uses real SQLite, filesystem snapshots and Git: initial candidate fails fixture checks, second attempt starts from that candidate, successful fixture checks allow mechanically verified G4 evidence against the first baseline. Evidence preparation does not approve it; further automatic implementation is refused at `awaiting_g4`.
- Failure tests cover unstarted/wrong/stale callbacks, duplicate finish, failed/unknown/cancelled attempts, out-of-scope output, baseline/staging/contract changes, restart and injected SQL rollback. Missing workspace and mismatched registered project cannot reserve an execution.
- Review added rejection of a symlinked result root before realpath resolution, and permanent baseline invalidation. These regressions are in the final suite.
- One lifecycle fixture used macOS `/var` as an alias for `/private/var`; the production no-symlink guard correctly refused it. The fixture now canonicalizes its storage path. A new missing-scope test initially serialized the verification ledger instead of the fixture contract; correcting its setup preserved production contract validation.
- TypeScript **exit 0**. Configured vendor lint **exit 0**, **0 errors / 40 existing warnings**; root modules are outside that lint configuration. Changed-source formatting and `git diff --check` are checked separately.
- [Compact evidence and source/log hashes](engineer-handoffs.json). No new VM/model/authentication execution was performed for this change; previous VM test records retain their original scope.

## Review and simplification

Sequential same-session review followed the reuse, quality and efficiency rubrics plus correctness, persistence, contract, security and failure-path concerns. The user's tool mapping prohibits treating this as independent review. No branch-wide CE review receipt or G4 readiness is claimed.

Existing stable file reads, candidate verification, transaction, execution accounting and round routing are reused. No additional behavior-preserving refactor was justified (reuse/quality/efficiency fixes: 0/0/0). Snapshot and staging directories deliberately remain siblings: storing snapshots above staging violates the existing source/storage separation invariant. Verification records are not duplicated in handoffs. Full receipt data is retained for private diagnosis while the authority remains the trusted supervisor callback, not worker-written success JSON.

## Evidence boundary and next connection

All Engineer/reviewer process observations in these tests are fixtures. The assigned host staging directory is not a worker sandbox. Next connect bounded mutable VM workspace transport and the actual Engineer supervisor, then the Reviewer and Office coordinator. Authenticated execution still requires the pending controller-authentication decision and verified tool isolation. Semantic G4 evaluation, delivery, recovery, real pilots and packaging remain open.

Story and Task checkers, Compound frontmatter validation, changed-source Prettier and `git diff --check` all returned **exit 0**. The Story checker explicitly skipped G4 because the Story is not Delivered. G4 remains pending; that skip is not human acceptance. Compound created [the attempt-provenance lesson](../solutions/integration-issues/bind-engineer-baseline-to-attempt.md); the existing mechanical-replay lesson remains related but addresses a different proof. The knowledge store is already discoverable through AGENTS.md, so no instruction-file change was needed.

## Reproduce

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
```

Run from the worktree with Node 24.19.0. Tests use disposable projects and loopback servers.
