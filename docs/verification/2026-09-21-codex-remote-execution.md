# Codex remote tool execution — 2026-09-21

Story M3/M4, V3/V4; plan U4. This is a transport/isolation diagnostic, not completion of the authenticated runner or a project pilot.

## Observed result

The official Codex `exec-server --listen stdio` ran in a disposable container in the existing `pazmo-office` VM. No AppArmor profile, global namespace restriction, host mount, login, or production Office database was changed. The VM was already running; the sandboxed `colima list` result of `Broken` was contradicted by the authorized read-only status and Docker connection, so the VM was not restarted.

The final saved diagnostic passed **17/17 checks, exit 0**. It exercised a real Codex CLI with a deterministic localhost Responses fixture, not a real model:

- `exec_command` wrote a marker inside `/work` and returned exit 0.
- `apply_patch` created `/work/patched.txt`, read back through the remote filesystem RPC.
- An explicit `environment_id=local` call was rejected with `unknown turn environment id local`; its host canary was not created.
- Direct exec-server process/file operations worked, while a fake host controller file was inaccessible.
- Container inspection confirmed network `none`, dropped capabilities and no host bind mounts. The server binary mount was read-only and the worker had no authentication file.
- The controller used a new empty HOME/CODEX_HOME and a fake local provider, without account credentials. This fixture is not an API-key/provider fallback for the product.
- All run-owned containers and volumes were removed; a subsequent Docker inventory returned no matching resources.

Raw records: [RPC and checks](codex-remote-probe.json), [Codex events and local-environment rejection](codex-remote-controller-probe.json). Full temporary records, including tool schemas, remain at `/private/tmp/pazmo-exec-server-nu3ojwu9/`.

## Versions and source grounding

Host CLI was observed as **0.155.1**, rather than the earlier 0.154.0. The Linux exec-server was the previously verified official npm **0.154.0-linux-arm64** binary with SHA-256 `9b7c1c7abdc26fc3c4f47c77656a8e9121def5483dbae830ef1ee561758448a9`. The diagnostic refuses another server hash and requires the observed host version for its mock-controller mode. This mixed-version trial establishes only the tested interactions, not general compatibility. The handshake reported `executorVersion: 0.0.0`; it must not replace the artifact hash as version evidence.

The locally inspected official source at `/private/tmp/pazmo-codex-source-0.154.0/` provided the protocol and test patterns:

- `codex-rs/exec-server-protocol/src/protocol.rs`: initialize, process and filesystem requests.
- `codex-rs/exec-server/src/environment_provider.rs`: a configured `CODEX_EXEC_SERVER_URL` excludes the local environment.
- `codex-rs/exec/src/lib.rs`: `--ignore-user-config` resolves execution environments from the process environment.
- `codex-rs/exec/tests/suite/apply_patch.rs` and `core/tests/common/responses.rs`: local Responses fixtures for tool execution.

These are pinned-source observations, supplemented by the actual 0.155.1 behavior above; no full audit of 0.155.1 is claimed.

## Reproduction

With the approved VM running, the pinned Node image already present, root dependencies installed and Node 24 on PATH:

```sh
python3 scripts/probe-codex-remote.py \
  --binary /path/to/verified/0.154.0-linux-arm64/bin/codex \
  --mock-controller
```

No image pull or package installation is hidden in this command. The script creates uniquely named, bounded, disposable containers/volumes and retains fake diagnostic output under `/private/tmp`. Its companion `.mjs` is only a fixture and transport relay, not a production launcher. `danger-full-access` in that fixture selects the existing outer container as the command boundary; the script must not be repurposed to run real tasks with a local execution environment.

`--binary /usr/bin/true` was a negative check: exit 1 with `Refusing unverified exec-server binary`, before Docker work. Python compilation, Node syntax check and `git diff --check` passed. Root application tests were not rerun because this change adds standalone diagnostics only.

## Failed attempt and review

The first mock-controller attempt reached `process/start` but failed with ENOENT because a host temporary cwd was sent to the container. Using the executor's `/work` fixed the call. A successful model turn by itself would have concealed this failure; the diagnostic instead requires the actual remote artifact and process result.

The saved version advances the process/read cursor, verifies the server hash and controller version, fails on any failed check, and kills a timed-out helper process group. Cleanup errors are failures. Review was sequential in the current session under the user's tool mapping, not an independent agent review or a completed branch-wide CE receipt.

## Remaining evidence and decision

This proves remote command and patch execution without an AppArmor exception in the tested configuration. It does not prove authenticated model execution, comprehensive tool coverage, malicious child-process containment, reconnect/fallback behavior, controller credential isolation under every tool, or persisted runtime leasing/cancellation.

Before product use: pin/audit the chosen controller/server pair; test the remaining boundaries and failure cases; integrate a supervised runner with the contract/candidate/verification ledgers; then run real project pilots, G4 and delivery.

The approved VM decision specifies a separate VM login. Using the existing macOS Codex login only in the controller would change that authentication location. That alternative is recorded as **pending G3**, not silently activated: [remote controller decision](../understanding/remote-controller-auth-decision.md).
