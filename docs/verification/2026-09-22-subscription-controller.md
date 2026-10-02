# Subscription controller: boundary tests and actual planning calls

Scope: U4, Story M3/M4 and V3/V4. The authentication-location G3 was approved by the human on 2026-09-22. This is not G4 or whole-product completion.

## Fixed inputs

- Native macOS arm64 Codex 0.155.1 SHA-256: `8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e`.
- Official source archive `rust-v0.155.1`: SHA-256 `b9e18d40d322586913e94d6747f3f934922c4f5130eb5a349ba019c57b83dad8`. Inspection skipped one vendor LICENSE symlink; no source code was executed.
- Linux exec-server 0.154.0 SHA-256: `9b7c1c7abdc26fc3c4f47c77656a8e9121def5483dbae830ef1ee561758448a9`. Evidence is for this exact mixed-version pair, not a compatibility claim for other versions.
- Existing pinned Node image in `container-verifier.ts`, dedicated Pazmo Colima socket, readonly rootfs, no host bind mounts, no worker network, UID 1000 and dropped capabilities.
- Requested model GPT-5.5, unchanged entry extracted from the official source catalog, SHA-256 `04c40699d3aa07744cf40af02757a95150221710107bebd456fb84694fa1d465`. License and notice retained. The CLI receipt does not independently attest the backend model identity.

Source grounding: [remote environment provider](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/exec-server/src/environment_provider.rs) omits local execution when a remote URL is configured; [exec](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/exec/src/lib.rs) still resolves that environment with `--ignore-user-config`; [tool mode](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/src/tools/mod.rs) gives model metadata precedence over feature defaults. Static catalog selection uses `model-provider/src/provider.rs` and `models-manager/src/manager.rs` at the same tag.

## Implemented boundary

`codexJob` is an internal, opt-in adapter for existing reserved VM jobs. It pins the native executable and catalog, uses a private HOME/cwd/log/state directory, and retains the existing CODEX_HOME only for the approved login. It never reads or copies credential contents. No global settings or AppArmor policy were changed. Ambient keys/proxies/tools are not inherited. Hooks, plugins, apps, host skill discovery, code-mode host, browser/image tools, nested agents and web search are disabled. Office role instructions remain explicit bounded packets.

The relay has one VM executor connection. Command, patch and session I/O are the only advertised tools in the qualified fixture catalog. Controller failures abort the owned process; missing turn completion, transport failure and unconfirmed closure are not successful jobs. Fixture and actual controllers share this lifecycle code. There is no automatic model/provider/API-key fallback. Public Office execution is still locked.

## Actual CLI/VM, scripted model tests

Command: Node 24.19.0 `--experimental-vm-modules scripts/test-codex-workspace.mjs <pinned-linux-binary> --qualify`.

Final result: **5/5, exit 0**, after sharing the production lifecycle. Evidence: `/private/tmp/pazmo-controller-qualification.log`; detailed report `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-codex-workspace-2jvNFY/report.json`.

- Writable Engineer tools and patch created independently inspected candidate artifacts; the original project remained unchanged.
- Remote session polling completed. Explicit `environment_id=local`, disabled `spawn_agent` and disabled `view_image` calls were rejected.
- Fake host secret stayed inaccessible/unchanged; controller environment was absent in worker and child; VM had only loopback, zero effective capabilities, no Docker socket, and an outbound connection failed.
- Poisoned personal config, skill and AGENTS canaries were not injected; hook marker stayed absent. Source inspection, disabled-hook configuration and canaries are combined evidence, not a claim that one untrusted hook marker tests every hook trust setting.
- Readonly Reviewer command and patch writes failed; actual deterministic tests joined the same candidate.
- Engineer cancel, malformed Reviewer report, Reviewer cancel and forced executor loss failed closed. No candidate was accepted after executor loss. All test containers and volumes were removed.

These tests use no account or real model judgment. The trusted controller intentionally retains model network/account access. The worker's network boundary is OS-enforced. Current-machine inspection found no `/etc/codex` or the checked managed-preferences file; arbitrary future managed policy changes are not qualified by this evidence. Repeat qualification before changing the binary, catalog, policy or tool surface.

## Actual authenticated PM → Lead

Command: Node 24.19.0 `--experimental-vm-modules scripts/probe-live-planning.mjs --live-approved <pinned-linux-binary>`, only after the preceding qualification and human authorization.

Both runs used the existing ChatGPT subscription login and actual readonly snapshots of this Office project's `README_ko.md`, `docs/LOCAL-PREVIEW.md` and authentication decision. PM and Lead each returned exit 0, confirmed closure and schema-valid reports; Office persisted the handoff, reached `proposal`, and released both leases. No contract was published, no human approval was synthesized, and no project output was delivered. [Sanitized actual reports](2026-09-22-live-planning.json) retain proposed checks and command exit statuses, including one unsuccessful command in the first PM run.

The first Lead proposal was not executable as written: it assumed Git metadata and negated a pipeline that could hide failure; another check prohibited a required documentation link. This exposed a missing runtime description in the planning packet. `verificationEnvironment` now explains the readonly candidate, absent Git, available Node/sh, no network/dependency install, controller manifest/diff checks and mandatory semantic review. Its existing planning test was observed RED before the change and GREEN after it.

The second actual PM/Lead run removed Git assumptions and produced five `node -e` checks. All five passed **syntax-only** compilation (`node --check` with source on stdin). This does not prove semantic correctness: broad keyword prohibitions can still reject legitimate negative wording. Neither proposal is an approved implementation plan. This rerun is a controller diagnostic, not the required Engineer feedback/fix cycle or an automatic approval.

## Review and checks

- New profile/controller tests were observed failing for missing modules before implementation. They exercise invalid addresses, changed/linked executable, excluded ambient credentials, pre-cancel, missing completion and uncertain/failed relay closure.
- Final root suite: **273/273, exit 0** (`/private/tmp/pazmo-controller-tests-final.log`). Affected suite: **24/24, exit 0**; TypeScript: **exit 0**. The actual five-scenario VM run exercised the consolidated lifecycle.
- Vendor ESLint: **0 errors, 40 existing warnings**. Formatting and diff whitespace checks passed.
- Story checker: **exit 0**; explicitly did not inspect G4 because status remains Approved, not Delivered.
- Simplification reused existing hash/path/process/relay helpers and consolidated fixture/live termination handling. Security, correctness, testing, reliability and failure-path review ran sequentially in this context under the user's tool mapping; this is not an independent or full multi-agent CE review receipt. The review caught the duplicated lifecycle proof path and preservation of staging during uncertain termination; both were fixed before revalidation.
- Compound updated the existing [remote tool evidence learning](../solutions/integration-issues/remote-codex-cwd-and-tool-evidence.md); frontmatter validator exited 0.

Remaining: semantic validation and correction of generated plans, actual Engineer→Reviewer feedback→fix→reverification, actual human G4, delivery, cancellation/restart qualification of authenticated execution, public launch/approval UI, worker skill qualification, learning retrieval and three workflow/tarball pilots. No full-goal completion is claimed.
