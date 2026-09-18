---
title: Preserve upstream provenance without publishing embedded credentials
date: 2026-09-18
category: workflow-issues
module: upstream import
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "A pinned upstream snapshot contains embedded credentials"
  - "A rejected initial push has no accepted remote feature history"
tags: [upstream, provenance, push-protection, credentials]
---

# Preserve upstream provenance without publishing embedded credentials

## Context
Claw-Empire v2.0.4 imported exactly, but GitHub rejected its built-in Google OAuth values. They were encoded using Base64; source-tree equality alone did not establish suitability for publication.

## Guidance
Keep the original verified tree under an explicit local-only reference. Obtain approval for the precise upstream deviation, remove embedded defaults while preserving explicit configuration, and record both original and published trees. Include a modification notice without copying the old values into docs, diffs shown to users, or test failure output.

For an initial push that was rejected, rebuild only the owned unpublished checkpoint history from the existing clean parent. A later deletion commit alone leaves the values in ancestors. Preserve the original local commits first and never rewrite accepted shared history as an automatic extension of this procedure.

Test the actual module with unset, explicit, and empty environment values. Scan every blob reachable from the publication branch for both the original encoded and decoded values. Push only the sanitized branch; never push all local refs or allowlist the credential to bypass protection.

## Why This Matters
A verified source snapshot and a credential-free publication are distinct artifacts. Keeping both tree IDs and the narrow modification record preserves attribution without misrepresenting the published tree as an exact copy.

## When to Apply
This procedure covers owned, unpublished checkpoints. Already-published credentials require a separate response that considers credential invalidation and collaborators; do not infer that rewriting local history resolves prior exposure.

## Related
- [Approved publication decision](../../understanding/source-publication-decision.md)
- [Focused verification](../../verification/2026-09-18-publication.md)
- [Upstream modifications](../../../upstream/CHANGES.md)
