# Task: Reproducible local runtime setup
Readiness: Implementation-ready
Story: docs/understanding/pazmo-agent-office-contract.md
Plan source: docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md

## Outcome
The user can install the qualified runtime into persistent private storage and start live Office without finding temporary binaries or assembling approval JSON.
## Covers — Story M/V IDs
M2, M4, V2, V4
## Scope
Pinned runtime setup command, default live paths, explicit operator key retrieval and concise usage instructions.
## Constraints
Reuse existing pins and approved Mac controller/VM boundary; no global CLI change, model calls, credential copying or worker-side installer.
## Verify
V2: supported dry-run/apply and restart reuse; concise operator login and launch sequence.
V4: refuse wrong hashes, redirects, symlinks, partial/foreign installs and concurrent publication without overwriting user files.
