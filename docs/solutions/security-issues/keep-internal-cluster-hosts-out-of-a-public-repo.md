---
title: Keep internal cluster hosts out of a public repo with a parameterized OpenShift Template
date: 2026-10-16
category: security-issues
module: team hub deploy
problem_type: security_issue
component: development_workflow
severity: high
symptoms:
  - "Deploy manifest, tests and docs hard-coded the company cluster route host and builder registry"
  - "The repository is public on github.com"
root_cause: config_error
resolution_type: config_change
tags: [openshift, template, public-repo, hostnames, deploy, fusion]
---

# Keep internal cluster hosts out of a public repo with a parameterized OpenShift Template

## Problem
The Fusion (OpenShift) hub work was ready to commit, but the repo is public. The manifest, four test files, the decision doc, the plan and the Story line all contained the company's internal route domain, builder registry and console host. `main` had none of them. Pushing would have published internal infrastructure names.

## Symptoms
- `git grep -i -E "<company domains>"` over the staged tree matched the deploy manifest, tests and docs. Over `origin/main` it matched nothing.
- `gh repo view --json visibility` returned `PUBLIC`.

## What Didn't Work
- Excluding only the manifest is not enough. Tests and docs repeated the same hosts as fixtures and examples.

## Solution
1. Turn the `List` manifest into an OpenShift `Template` whose host and builder image are required parameters. Keep the real values in a git-ignored env file next to it:
   ```json
   { "apiVersion": "template.openshift.io/v1", "kind": "Template",
     "parameters": [ { "name": "HUB_HOST", "required": true },
                     { "name": "BUILDER_IMAGE", "required": true } ],
     "objects": [ … "host": "${HUB_HOST}" … "name": "${BUILDER_IMAGE}" … ] }
   ```
   ```
   # .gitignore
   deploy/fusion/local.env
   ```
   Deploy with `oc process -f deploy/fusion/pazmo-hub.json --param-file=deploy/fusion/local.env | oc apply -f -`.
2. Change test fixtures to example hosts (`pazmo-hub.apps.example.com`, `github.example.com`). The manifest test asserts the parameters exist, are required and have no default, and that the route host is `${HUB_HOST}`.
3. Replace hosts in docs with placeholders (`<apps 도메인>`, `${BUILDER_IMAGE}`).
4. Confirm the rendered Template matches what is deployed: `oc process … --local -o json` gives the same six objects and route host.
5. Before every later commit, run `git grep --cached -n -i -E "<company domains>"` and require no match.

## Why This Works
Only the env file holds the cluster-specific values, and git never tracks it. The Template keeps the structure (one pod, Recreate, PVC, edge route) reviewable in public, and the required parameters make a deploy without real values fail loudly instead of falling back to a guessed host.

## Prevention
- Do not put a company hostname into a test assertion. A test needs an example host, not the real one.
- Before the first push of any deploy or infra change, compare the staged tree with `origin/main` for internal domain names.
- Do not commit the real `local.env`. Keep the `required: true` parameters without defaults.

Related: syjkim0125/pazmo-agent-office#23 (U12).
