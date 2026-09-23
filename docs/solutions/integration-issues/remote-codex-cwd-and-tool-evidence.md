---
title: Verify executor paths and tool artifacts separately from Codex turn completion
date: "2026-09-21"
last_updated: "2026-09-23"
category: integration-issues
module: Codex remote execution diagnostic
problem_type: integration_issue
component: testing_framework
severity: high
symptoms:
  - "Codex exited zero after a remote process/start failed with ENOENT"
  - "The final assistant message appeared although the expected remote file was absent"
root_cause: scope_issue
resolution_type: test_fix
tags: [codex, remote-execution, cwd, verification, false-pass]
---

# Verify executor paths and tool artifacts separately from Codex turn completion

## Host-side project discovery boundary

Supported live startup revealed a separate execution path before model calls: `git ls-files --cached --others --exclude-standard` can execute a target repository's `core.fsmonitor` command on the host. A clean subprocess environment and `--no-optional-locks` do not suppress repository-local configuration. The RED test used a disposable monitor script writing a marker and observed the marker during snapshot discovery.

The current unmerged continuation invokes both Git discovery commands with `-c core.fsmonitor=false -c core.untrackedCache=false`, explicit environment and no global/system config. The same real-Git regression now passes without a marker; original project files remain untouched. See [runtime source](../../../src/runtime/live.ts), [regression](../../../tests/live-runtime.test.mjs) and [launch evidence](../../verification/2026-09-23-live-launch.md). Trusted host preparation needs its own configuration boundary even when model tools are remote. This covers these discovery commands; it does not imply arbitrary Git commands cannot invoke hooks, filters, diff tools or helpers.

## Problem

The mock controller used a macOS temporary cwd for a command executed in a Linux container. That path did not exist remotely. The scripted final assistant message still completed the turn and the CLI exited zero, which could have produced a false success report.

## Symptoms

`process/start` returned `No such file or directory (os error 2)`. The CLI reported `turn.completed`, but reading `/work/model-tool.txt` through the executor failed. The first diagnostic therefore recorded `mock-controller-tool-executed-remotely: false`.

## What Didn't Work

Starting and initializing a remote exec-server did not imply that the command's working directory was valid there. The outer CLI exit code described the turn, not the success of every requested tool.

## Solution

Specify the executor's `/work` in the fixture tool call. Require a successful command event and read the resulting marker through the remote filesystem RPC. Test `apply_patch` independently and read its artifact back as well. Reject `environment_id=local` explicitly and confirm that its fake host target was not written.

The saved diagnostic exits nonzero if any required check or cleanup fails. It also refuses an unverified server binary before contacting Docker.

## Why This Works

Paths belong to an execution environment. A controller's existing local path is not evidence that the executor can use it. Independent process and artifact observations expose a tool error even when the model or a model fixture produces a reassuring final message.

## Prevention

- Bind each tool packet to an environment and an executor-native working directory.
- Keep CLI termination, tool termination, verification, review and human approval as distinct facts.
- Assert expected artifacts through the same remote transport; do not infer success from conversational output.
- Keep mock-model transport evidence distinct from authenticated model and full isolation evidence.

## Extension: transport closure and structured review

Connecting the diagnostic to persisted handoffs exposed a different false failure: Codex normally closes its WebSocket before its CLI exits. Treating every disconnect as failure killed an otherwise successful turn. The relay now stops its executor on that disconnect while the supervisor separately checks CLI termination, VM closure and candidate evidence. Premature executor termination while still connected remains a failure.

Three lifecycle regressions were reproduced and fixed: an already-aborted supervisor still launched; a later timeout overwrote the cancellation cause; and an incomplete HTTP request kept relay shutdown waiting. Check abort before launch, retain the first cancellation cause, and close all owned HTTP connections when shutting down the relay. Never release an unknown process slot merely because its socket disappeared.

For Reviewer, separate captured stdout JSONL from diagnostic stderr and parse only the terminal assistant report. Require exact candidate/contract digests and a bounded schema. Nested tool output, earlier conflicting verdicts, malformed prose and exit zero alone are insufficient. A dedicated readonly reviewer mount enforces nonmutation independently of its prompt.

Actual CLI/VM tests demonstrated that the Reviewer could read the candidate but command and patch writes failed. A scripted pass joined real tests on that candidate; nonstructured output with exit zero routed to unknown, and cancellation discarded a late result. These prove transport/evidence handling, not semantic review quality or authenticated isolation. See [workspace and review evidence](../../verification/2026-09-21-codex-workspace-review.md).

## Related Issues

- [Diagnostic and companion relay](../../../scripts/probe-codex-remote.py)
- [Observed failures, success and boundaries](../../verification/2026-09-21-codex-remote-execution.md)
- [Verification join evidence](../../verification/2026-09-21-verification-join.md)

## Extension: pin the model tool catalog as well as the executable

On Codex 0.155.1 the 5.6 catalog entries select `code_mode_only` before the feature flags are considered. Disabling `code_mode_host` therefore removed the advertised direct tools even though some direct calls from a scripted response still executed. This was caught by checking the model-visible tool inventory, not merely a final message or CLI exit code. The older fixture model GPT-5.4 also had a retirement marker and was not a valid live default.

The first subscription controller uses GPT-5.5 and an unchanged, SHA-256-pinned entry extracted from the same official source release. The static catalog prevents a later remote metadata refresh from silently widening the qualified tool surface. It does not prove server-side model identity or continued account entitlement. No automatic model substitution is allowed.

The profile ignores personal config/rules, disables hooks/plugins/apps and host skill discovery, and supplies bounded Office role text explicitly. Pin the native executable, not just a version string or mutable npm launcher. A private HOME/cwd/log/state path is separate from the existing CODEX_HOME used for login. Model calls have account access in the trusted controller; command/patch/session tools are routed to the VM.

Expanded actual CLI fixtures verify the three advertised tools, command and child-process environment isolation, VM network failure, disabled-tool requests, readonly review, cancellation, executor loss and resource cleanup. One fixture initially failed because its appended JavaScript redeclared a variable; requiring an observed zero tool exit and the canary output prevented a false pass. A turn completing after an unsupported tool call is still not evidence that that tool succeeded.

These tests qualify the documented configuration on the current machine. They do not establish that every future Codex version, model catalog, enterprise policy, or Office public launch is safe. Repeat qualification when those inputs change. Actual user G4 and end-to-end delivery remain separate.

## Extension: qualify generated verification commands before approving a plan

The authenticated Lead produced syntax-valid `node -e` commands whose regex metacharacters were overescaped. It also proposed forbidden-word checks that do not understand negative completion warnings. Schema validation, a zero model exit and JavaScript syntax checks therefore did not make its verification plan execution-ready.

For the first documentation pilot, retain the original PM/Lead receipt and label the controller's changes in the bound plan. Prefer simple structural checks for file inventory, unchanged reference-file digest, required terminology, preserved warning and a concrete documentation link. Leave meaning, overclaims and diff scope to the separate Reviewer instead of claiming a keyword test proves them.

Run those checks in the actual verifier environment on unchanged input and a clearly labeled synthetic positive control. The unchanged README failed the three missing-content checks, while the temporary positive control passed all five. Neither was an Engineer-produced candidate, a human approval or pilot completion. Keep those evidence categories distinct when recording a successful checker repair. See [the pilot preparation evidence](../../verification/2026-09-22-live-contract.md).
