# Offline container verifier — 2026-09-21

Story M3/M4, V3/V4; [bounded Task](../tasks/U4-container-verifier.md). This implements the deterministic-test portion of U4. It does not complete U4, authenticated role execution or the full Story.

## Behavior

`runRegisteredCheck` obtains the command from the approved round, reserves execution capacity, binds the actual container ID before start, and records the controller's observation through the execution ledger. Workers cannot choose another check or submit their own success receipt.

`ContainerVerifier` uses the existing dedicated Colima VM and pinned Node image, with no pulls or host binds. A trusted preparer validates copied manifest/content/modes/links and changes ownership inside the private VM volume. Only that preparer has CHOWN; it never imports candidate code. The test uses UID 1000, read-only root/candidate, no capabilities/network, no-new-privileges, bounded memory/CPU/PIDs and separate scratch tmpfs.

The controller captures bounded stdout/stderr from `docker start --attach`, then compares the container's inspected exit with `docker wait`. Docker CLI success alone is not test success. Timeout/cancel/output-limit stops the actual container, then removes run-owned containers and volume. An unconfirmed cleanup cannot pass. Unexpected supervisor promise rejection immediately quarantines its reservation without claiming process termination.

## Fresh evidence

- Node 24.19.0 root suite: **85/85, exit 0**, including subtests. This includes mocked Docker transport and actual local subprocess/HTTP/SQLite tests, not 85 real VM scenarios.
- TypeScript: exit 0. Configured vendor lint: exit 0, 0 errors / 40 existing warnings. That lint script covers vendor `src`/`server`, not the new root runner; the latter was typechecked and reviewed.
- `node scripts/test-container-verifier.mjs`: **5/5 real VM scenarios, exit 0**, after the supervisor exception fix.
- Post-run dedicated-daemon container and volume queries filtered by `label=pazmo.verifier`: both exit 0 and empty. No owned resources remained.
- Workflow Story and Task checkers: exit 0. Story is not Delivered, so G4 was explicitly skipped. Compound frontmatter validator, runner/test formatting check and `git diff --check`: exit 0.
- [Compact real report](container-verifier.json) includes source hashes, observation/output hashes and the temporary full-report path/hash. Oversized output is deliberately summarized rather than copied into this document.

| Real scenario | Test evidence | Round / execution |
|---|---|---|
| Pass | exit 0, marker; read frozen bytes/link; UID/capability/seccomp checks; EROFS candidate write; absent fake host secret; loopback only; scratch write works | checking / released; review still missing |
| Fail | actual exit 7 and output | checking / released; join still awaits review |
| Timeout with child | timeout, confirmed container removal | human_required / unknown; expired reservation remains held |
| Cancellation with child | CANCELLED, confirmed container removal | human_required / released |
| Output flood | OUTPUT_LIMIT, bounded capture, confirmed container removal | human_required / released |

The fixture's G1/G3 decisions authorize only disposable fixture data. No real account/model, approval UI or project pilot was used.

## Review and corrections

Test-first evidence for unexpected supervisor rejection failed before the correction with `reserved` and `running` instead of `unknown`; both cases then passed. Existing regression checks cover duplicate receipts, stale candidates, rollback and restart.

The same-session sequential simplification pass used the ce-simplify-code reuse, quality and efficiency rubrics. No additional behavior-preserving production refactor was justified. Manifest checks on both sides are intentional trust-boundary checks; removing one for deduplication would weaken verification. The earlier polling/log-tail approach was replaced by bounded attached output because rotated logs cannot establish complete capture.

The scoped source review checked command environment isolation, bounded capture, trusted preparation, untrusted worker configuration, Docker exit/closure distinction, cleanup and ledger exception handling. The supervisor rejection finding is fixed and revalidated. This is not independent review or a completed branch-wide ce-code-review receipt; that broader gate and G4 remain pending.

Compound updated the existing [candidate-preparation lesson](../solutions/integration-issues/prepare-readonly-container-candidates.md) rather than creating a duplicate.

## Limits and next connection

- Office's public execution gate stays locked; this is an internal controller runner exercised by an opt-in integration script.
- Real Codex Engineer/Reviewer, automatic fan-out, fixes, G4 and delivery still need connection. The controller-auth-location G3 proposal is unanswered; no authentication was moved or copied.
- The pinned offline Node image does not provide arbitrary project dependencies. Dependency preparation and writable build outputs require their own approved preparation contract before a general project pilot.
- Unknown reservations remain held even if later cleanup succeeds; explicit recovery authorization/reconciliation is still missing. A cleanup call can consume additional bounded time after the check deadline; this is not a hard real-time termination guarantee.
- No daemon-loss, host-reboot or authenticated-model isolation proof is established by these five scenarios.

## Reproduction

From the worktree with Node 24.19.0 and the existing dedicated VM/image:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
node scripts/test-container-verifier.mjs
```

The integration command uses disposable fixtures only and does not start Office or call a model. Docker's [copy](https://docs.docker.com/reference/cli/docker/container/cp/) and [wait](https://docs.docker.com/reference/cli/docker/container/wait/) contracts informed the ownership and exit-status handling.
