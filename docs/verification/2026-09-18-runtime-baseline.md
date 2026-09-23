# Runtime baseline verification — 2026-09-18

Scope: U2 development preview and an early U4 feasibility probe. Base `8e14344e97ae5effd90bd5b00fff8334bab63425`, branch `codex/office-runtime-baseline`. Worktree `.worktrees/bootstrap-claw-v2.0.4`. These changes are uncommitted. This is not full Story delivery, live execution approval, a tarball test, or a complete audit of Claw.

## Environment and workflow

- macOS local, Node 24.19.0, pinned pnpm 10.30.1, Claw v2.0.4 source checkpoint, Codex CLI 0.154.0 for sandbox diagnostics only.
- Official ai-workflow-kit 3.1.1 doctor: exit 0, six checks PASS. Story checker: exit 0; explicitly skipped G4 because Story is not Delivered. Runtime G3 acceptance is linked in the Story. Jira was not used.
- Dependencies installed with the vendor frozen lockfile, `--ignore-scripts`, temporary npm/pnpm caches. No upstream startup, postinstall, Remotion browser setup or optional gitlink initialization ran.
- The new service only imports the existing base schema/seeds, creates its own owned database, and serves the existing Claw UI. A public API allowlist supplies preview reads; every mutation and unsupported API fails closed. No second scheduler or model launcher is present.

## Automated results

| Check | Evidence / result |
|---|---|
| Root `npm test` | 16/16 PASS: 7 CLI cases, 6 lifecycle cases, 3 inherited OAuth-default tests |
| Vendor `npm run test:web` | 77/77 PASS in 26 files after Dashboard/TaskBoard changes |
| Vendor API baseline | First sandbox run: 193 PASS, 10 failures from `listen EPERM 0.0.0.0`. Socket-permitted rerun of the two affected files: 17/17 PASS, including all ten failed cases. Together covers 203 distinct baseline cases. No claim that upstream agent execution was safe. |
| `npm run build:office` | PASS, TypeScript build and Vite. Existing >550 kB bundle warning remains (main ~725 kB). |
| `npm run typecheck` | PASS for new root TypeScript |
| Vendor `npm run lint` | Exit 0, 0 errors and 40 warnings, all in unchanged upstream files |
| Root style/static checks | Prettier on changed root JS/TS/JSON and vendor UI; root has no ESLint configuration. Python probe parsed as Python 3 source. |

CLI RED was observed before the implementation (seven missing-command failures). Lifecycle RED was observed before start support and on the missing stats route. UI tests demonstrated RED before adding preview state/disabled controls. A review regression test demonstrated RED for stop during `start.lock`, then passed after the correction. Later test refinement keeps the unrelated server's event loop alive so it tests identity rejection rather than only a timeout.

Root tests cover dry-run writes, idempotent init, unmanaged metadata conflict, symlink refusal, project/controller path separation, modified-file preservation, invalid options, real lifecycle calls, port collision without stopping an unrelated server, restart persistence, foreign SQLite preservation, pending startup and unauthenticated saved PID state. The HTTP test exercises POST/PATCH/DELETE against six mutation routes, denies CLI probing, rejects unauthenticated stop and foreign Origin, and verifies seeded counts, banner and data preservation.

## Browser pipeline

Host-native Codex browser was used against an owned temporary project/data fixture on loopback. It rendered Office with three roles, Dashboard with PREVIEW and locked execution text, and the empty Tasks board. Dashboard creation and Tasks create/project/hide controls are disabled. An actual screenshot was inspected in the tool result. Stats matched the three seeded agents and zero tasks.

Initial browser testing caught two issues: the banner injection assumed a bare body tag, and automatic settings persistence attempted a forbidden mutation. Both were fixed. Later inspection found unsupported controls opening mutation flows; Dashboard/empty Tasks controls were disabled and tested. Two historical EXECUTION_LOCKED console entries from the older build remain in the browser log; none from the final `index-B4a_MZQg.js` reload was returned in the final port-filtered log check. This is scoped evidence, not a blanket no-errors claim for untested views.

Original Offline/Disconnected indicators remain because the preview does not start WebSocket orchestration. Other imported dialogs, provider login, G1/G3/G4 UI, authenticated/live Codex, three business pilots and package-installed browsing were skipped as unavailable, not marked passed. Browser verification used the local source build; it does not establish source-free asset resolution.

## Native isolation result: NOT PROVED

The diagnostic script is `scripts/probe-native-isolation.py`. It creates only disposable fake controller files, fake auth data, an unrelated-project fixture, sockets and its own signal handler. It uses an isolated Codex config/home, runs no model and never opens real authentication files. It is not connected to a readiness toggle.

Commands (use absolute installed binary paths):

```sh
python3 scripts/probe-native-isolation.py /absolute/path/to/native/codex /absolute/path/to/node
python3 scripts/probe-native-isolation.py /absolute/path/to/native/codex /absolute/path/to/node .worktrees
```

The second parent must already exist. First test the actual native binary, not just a JS launcher: an inaccessible launcher module is an inconclusive failure, not evidence that native process creation is denied.

- [Temporary-path report](native-canary-temp.json): probe exit 1. Workspace positive control worked; five protected fixture files were readable/writable despite explicit deny, symlink and nested Node reads succeeded, and a native Codex `--version` child started. TCP/Unix access and the owned controller signal were denied.
- [Non-temporary-path report](native-canary-home.json): probe exit 1. Workspace positive control worked; protected files, symlink, nested Node reads, TCP/Unix access and the owned controller signal were denied. Native Codex `--version` still started.
- Report `exitCode: 0` is the inner sandbox command exiting normally after reporting observations. Added `probeExitCode: 1` is the diagnostic's failure result. Neither is a live-execution permission grant; `completeProof: false` and `execution: locked` are explicit.
- The first probe failed before Node started because OpenSSL configuration was unreadable. Only `/System/Library/OpenSSL` read permission was added for Node startup. A separate long-path fixture hit macOS Unix socket length limits; the owned socket fixture was moved to a short temporary path. Neither setup failure was counted as a successful boundary test.
- Browser/Apple Events, authenticated Codex tools/model traffic, Linux enforcement and a complete runner allowlist are unverified. Starting `--version` is not proof of model execution or sandbox escape.

The observed temporary-path behavior is consistent with [OpenAI's documented macOS limitation](https://github.com/openai/codex-security/blob/main/sdk/typescript/README.md#generate-a-security-policy). Named profiles were grounded in the [official permission implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/permissions.rs) and checked against installed CLI help; documentation alone was not accepted as a successful canary.

KTD5 requires a new design decision when native protection is insufficient. [The VM proposal](../understanding/native-runner-isolation-decision.md) is reviewable but unapproved. No VM packages, profile, user account or credentials were installed/created for it.

## Simplification and review

ce-simplify-code examined the changed root implementation and modified UI using reuse, quality and efficiency lenses, sequentially per the user's tool mapping. Applied: quality 1 (unused test import removed), reuse 0, efficiency 0. Intentional independent preview routing was retained: importing upstream handlers would bring execution side effects into a locked service. No safety checks were removed and no unrelated vendor refactor was made.

ce-code-review covered correctness, project standards, testing, maintainability, API behavior, security, reliability, adversarial interactions and the intentionally unavailable agent surface. Review was performed in this session per the explicit sequential-main-thread mapping, not by independent agents or a different model. The deterministic scope helper selected full depth (large executable diff). New files were included with intent-to-add for review; this is not a commit. Upstream imported instructions were treated as source material, not new authorization.

Resolved findings: inaccurate live Dashboard state; automatic writes in preview bootstrap; active create controls in the empty board; stop incorrectly reporting stopped during startup; synchronous test helper preventing its own unrelated server from replying. Final root/UI checks cover those edits. File/path preservation, parameterized DB ownership setup, loopback Host/Origin enforcement and token/instance lifecycle checks were inspected.

Remaining limits: full U3–U8 functionality, source-free packaging, independent review, live isolation, unclean-start automatic recovery and concurrent filesystem attacks by another unsandboxed process are not established. Unknown runtime state is deliberately preserved and blocks restart/remove. A failed startup preserves partially created DBs for inspection. This preview cannot authorize AI work or mark tasks Delivered. No P0/P1 defect was retained in the bounded read-only preview implementation; the unresolved execution-environment decision blocks the complete Story.

Compound was evaluated after review/revalidation: the ordinary regression fixes are already captured in tests, and the unsolved isolation boundary is recorded above and in the decision document. No duplicate solution document was created or unsolved protection described as fixed. Re-run Compound after the live boundary is actually resolved. Documentation skipped (no additional solved, reusable lesson outside the existing evidence).

Local review receipt: `/private/tmp/compound-engineering-502/ce-code-review/20260918-runtime-baseline/review.json` (ephemeral; durable conclusions are above).
