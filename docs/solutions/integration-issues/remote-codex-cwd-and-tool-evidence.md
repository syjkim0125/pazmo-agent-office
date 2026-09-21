---
title: Verify executor paths and tool artifacts separately from Codex turn completion
date: "2026-09-21"
last_updated: "2026-09-21"
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
