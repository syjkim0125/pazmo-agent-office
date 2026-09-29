---
title: Pin bounded role instructions and separate role from project authority
date: "2026-09-21"
last_updated: "2026-09-29"
category: architecture-patterns
module: Office role profiles
problem_type: architecture_pattern
component: assistant
severity: medium
applies_when:
  - "A controller assigns work to specialized agents with different responsibilities"
  - "Installed interactive skills require orchestration that the worker cannot perform"
tags: [roles, profiles, provenance, workflow, integrity, controller]
---

# Pin bounded role instructions and separate role from project authority

## Context

The Office coordinator already handled Engineer, tests, Reviewer and bounded fixes, but role instructions were short inline strings with no separately identifiable source/version. Giving every worker the complete interactive workflow would duplicate planning, approval, delegation and shipping responsibilities that belong to Office.

## Guidance

Keep project approvals, execution budgets and delivery in Office. Delegate role-local transitions to the installed kit CLI and retain its run file as the authoritative local state. The earlier guidance to keep all graph authority in Office is superseded by the user's D7 responsibility split. Assign each role an explicit bounded procedure. When the runtime cannot satisfy an upstream skill's required orchestration, provide a clearly named first-party protocol or block that skill; do not claim the full skill ran.

Package instruction sources and a provenance lock together. Record role, source path, immutable version ref, license reference and hashes for every included instruction. Validate fixed installation paths before job construction and revalidate the packet before rendering its prompt. Keep trusted instructions outside the task-data block; remove their duplicated content from the metadata inside that block.

Reject changed or missing instructions rather than silently falling back to a generic prompt. Use bounded, nonblocking descriptor reads and reject symlinks/special files. The implementation reused the existing digest helper after two erroneous import locations caused immediate test failures; inspect the actual export before adding another helper.

## Why This Matters

A role name alone does not identify the procedure an agent received. Provenance and complete-file validation make configuration drift visible. They do not prove that the model follows the procedure, that a review is correct, or that the runtime contains the agent. The lock and code share the trusted installation boundary; a hash next to a file is not independent attestation against a compromised controller.

## When to Apply

- Use for controlled role handoffs where workers must return results instead of recursively launching the whole team.
- Keep actual model quality, sandbox canaries and human acceptance as separate evidence.
- Preserve profile identity in execution evidence when adding durable runtime history; packet metadata alone is not a persisted execution receipt.

## Examples

Pazmo Engineer v1 performs approved implementation, relevant tests and simplification, then returns the candidate. Reviewer v1 inspects the same frozen candidate and returns a bounded verdict report. Neither owns G4 or delivery. The actual CLI/VM fixture observed the full profiles on all four model requests across one failed candidate and one fix, while its model judgments and human answers remained scripted.

The PM/Lead proposal protocol exposed a related handoff gap: a Task could name `plan.md` while the contract loader only captured Story, Task, checks and the high-risk decision. A focused assertion proved that the plan did not reach approved role context. The generated contract now supplies an optional `plan` reference, the loader matches it against `Plan source`, and its bytes join the contract digest and role documents. Changing the plan invalidates approval readiness. A filename mentioned in a prompt is not equivalent to delivering its approved content. The PM/Lead tests remain scripted protocol evidence, not live planning quality.

The next inspection found that planning had an available readonly VM snapshot while its instructions forbade reading any files. Supply the snapshot's identity, worker-visible path and permitted use explicitly, and pass the rendered prompt to the actual job factory. Do not infer context delivery from a mount alone. Tests first failed on absent context metadata and the missing factory prompt; the corrected code passed 260 root tests and the readonly VM exercise. Those observations use scripted planning responses, not live planning quality.

Separate a pre-G1 proposal from planning against an approved Story. Also separate skills installed in the controller's session from skills qualified in its worker. Explicit `direct`/`not-qualified` metadata prevents reporting CE/Superpowers execution without evidence. When pinned instructions change, reject old persisted packets without rewriting their history or carrying approvals to a new packet; record the manual continuation boundary. Prompt metadata defines intended use but never substitutes for sandbox enforcement.

The pending 4.1.0 integration exposed a second authority boundary: a native role-complete result can change after Office records its tests. G4 must bind the kit run, assignment, source and evidence hashes as well as the same actual candidate. The adapter now rechecks that receipt before G4; a test mutates the completed run after evidence preparation and confirms rejection. Persisting a display status alone would miss this failure.

A kit start and an Office process reservation are separate writes. Preserve the native dispatch packet before execution and never synthesize its token after a capacity wait. The adapter resumes a saved self-check or review packet only after Office finds no active or unknown leases; it does not automatically replay Developer work. A crash before the dispatch receipt is saved still requires explicit recovery. Tests cover both self-check and Reviewer capacity waits without adding an attempt. This is controlled reconciliation, not a cross-store transaction guarantee.

Office's G1 event may approve a contract whose source file still says Draft. The adapter materializes an immutable approved input view from that actual event while checking the original contract on each dispatch. Preserve the original requirements and approval provenance; do not silently rewrite the source or treat a derived view as an independently approved contract. A regression test verifies the original Draft bytes stay unchanged.

The actual README pilot's model Reviewer passed an ambiguous authentication sentence that controller integration review rejected. Record that disagreement as a separate candidate-bound finding rather than editing the model's immutable verdict or pretending a test failed. The pending integration-feedback path invalidates G4 eligibility and uses the same fix budget, while the next Developer packet receives both the original observations and the new finding. This preserves who decided what and why the project returned to implementation even though the role had completed.

## Related

- [Implementation and evidence](../../verification/2026-09-21-role-profiles.md)
- [Readonly planning context and kit handoff boundaries](../../verification/2026-09-21-kit-handoff-context.md)
- [PM/Lead protocol and plan-context regression](../../verification/2026-09-21-planning-protocol.md)
- [Nonblocking contract file validation](../runtime-errors/nonblocking-contract-file-validation.md)
- [Tool evidence versus model completion](../integration-issues/remote-codex-cwd-and-tool-evidence.md)

## Restoring upstream execution without bypassing role boundaries

Original Claw workflow factories capture provider functions in closures. Replacing only the exported runtime-context function does not intercept those internal calls. Guard the concrete CLI, one-shot meeting, API/OAuth, task-start and merge entries before activating the original server, then connect the qualified adapter explicitly. Tests invoke these entries with missing dependencies and require the boundary error before any tool, credential, file or task-state access. HTTP-only blocking is not sufficient for timers or internal delegation.

Keep native data separate from preserved legacy data until a reviewed migration exists; do not run two authoritative coordinators for one task. The locked native startup and HTTP/DB/WebSocket tests are integration evidence, not proof of a working kit/model workflow. [Native restoration evidence](../../verification/2026-09-29-native-claw-preview.md).

## Human-routed planning recovery is not a reset

The restored native pilot exposed a distinction between a closed process and a resumable graph. The real Lead returned a workspace selection rejected by Office, and kit recorded it with action `human`. The initial suggestion to reset that same run was wrong: the installed kit CLI refuses reset for human-routed failures and requires a decision followed by a new run. Do not patch its state or fabricate a successful proposal from a diagnostically corrected response.

The pending Office recovery change uses the actual user's addressed recovery request, confirms all planning processes for that task are released, and preserves the task, approved Story, G1 and failed run. Only the pending role receives a successor, with an immutable receipt linking predecessor identity/revision and the human event. Office's total of two planning recoveries spans successors; kit still controls each run's nodes and readiness. This extra host budget matters because a new graph's attempt counter does not remember earlier graphs. Missing or changed predecessors and unknown processes stop before a model starts. Tests cover preserved failed bytes and G1, duplicate replies, restart, cancellation and exhaustion. The actual resumed Lead passed its previously rejected investigate node; downstream delivery is separate evidence.

Prevention: inspect the installed CLI's permitted transition before promising recovery. Classify malformed protocol output separately from unknown process liveness, and do not confuse a recovery request with scope approval or G4. Model prompts must state the workspace selection invariant enforced by the parser; unrelated paths outside include must not be supplied as exclusions.
