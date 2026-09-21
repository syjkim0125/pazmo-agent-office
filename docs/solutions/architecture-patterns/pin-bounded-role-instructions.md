---
title: Pin bounded role instructions while keeping graph authority in Office
date: "2026-09-21"
last_updated: "2026-09-21"
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

# Pin bounded role instructions while keeping graph authority in Office

## Context

The Office coordinator already handled Engineer, tests, Reviewer and bounded fixes, but role instructions were short inline strings with no separately identifiable source/version. Giving every worker the complete interactive workflow would duplicate planning, approval, delegation and shipping responsibilities that belong to Office.

## Guidance

Keep graph transitions, approvals, execution budgets and delivery in the controller. Assign each role an explicit bounded procedure. When the runtime cannot satisfy an upstream skill's required orchestration, provide a clearly named first-party protocol or block that skill; do not claim the full skill ran.

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

## Related

- [Implementation and evidence](../../verification/2026-09-21-role-profiles.md)
- [PM/Lead protocol and plan-context regression](../../verification/2026-09-21-planning-protocol.md)
- [Nonblocking contract file validation](../runtime-errors/nonblocking-contract-file-validation.md)
- [Tool evidence versus model completion](../integration-issues/remote-codex-cwd-and-tool-evidence.md)
