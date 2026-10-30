---
title: Merge stacked PRs one at a time, after each one is retargeted to main
date: 2026-10-16
category: workflow-issues
module: pull request workflow
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Several PRs are stacked, each based on the previous PR's branch"
  - "The stack is merged on GitHub in quick succession"
tags: [stacked-prs, github, merge, retarget, base-branch]
---

# Merge stacked PRs one at a time, after each one is retargeted to main

## Context
U12, A and B shipped as a stack: syjkim0125/pazmo-agent-office#23 (base `main`), #24 (base `codex/team-hub-openshift`) and #25 (base `codex/team-hub-onboarding`). All three were merged within about 17 seconds. Only #23 reached `main`. GitHub had not yet retargeted #24 and #25, so they merged into their intermediate base branches and `main` was missing A and B. Every PR showed "Merged", so nothing looked wrong until `git log origin/main..<top branch>` still listed seven commits.

The fix was one more PR, #26, from the top branch (`codex/office-role-characters`) to `main`. It carried the same already-reviewed commits and no new changes.

## Guidance
- Merge from the bottom of the stack up, one PR at a time.
- Before merging the next PR, confirm its base is `main`. Retarget it explicitly if GitHub has not:
  ```bash
  gh pr view 24 --json baseRefName -q .baseRefName   # must print main
  gh pr edit 24 --base main                          # if it does not
  ```
- After the last merge, check that nothing is left behind:
  ```bash
  git fetch origin --prune
  git log --oneline origin/main..origin/<top-branch>   # must print nothing
  ```
- If a PR already landed in an intermediate branch, open one PR from the top branch to `main`. Do not re-review the code; say in the body that the commits are unchanged.

## Why This Matters
A merged-into-the-wrong-base PR looks identical to a correct one in the PR list. Follow-up work (a deploy, a G4 note saying "merged", the next branch cut from `main`) then starts from a `main` that lacks the feature.

## When to Apply
Any time a branch's PR targets another feature branch instead of `main`. When the stack has only two PRs, merging them in one PR from the top branch is simpler.

## Examples
- 2026-10-16: #23 → `main`; #24 → `codex/team-hub-openshift`; #25 → `codex/team-hub-onboarding`. Fixed by #26 (`codex/office-role-characters` → `main`); afterwards `git log origin/main..codex/office-role-characters` was empty.
