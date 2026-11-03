# Prove the current Story against the running product

Read this at project setup and final verification, not at every node. The pinned Pstack [principle](pstack/principle-prove-it-works.md) and [recipe guide](pstack/create-verification-skill.md) supply evidence standards. Pstack creates project-specific `verify-<app>` skills; it does not expose one universal `verify` skill. This integration uses that project procedure inside SP's fresh-verification stage; Graph owns state and receipts.

## Discover and exercise the project procedure

1. Inspect the project's skill catalog, E2E scripts and verification guides. Reuse an adequate existing procedure. Record its project-relative path as profile `recipe`; read it before running relevant checks. If no guide is needed for a simple existing assertion, a recipe-free profile remains valid.
2. If the user journey has no runnable procedure, use the pinned creation guide to write a minimal project-local `verify-<app>/SKILL.md` or an existing-style verification guide. Include Launch (start/configure), Doctor (diagnose prerequisites), Drive (user actions and assertions), Evidence (preserved observations), Cleanup (owned resources) and only necessary Helpers. A short-lived CLI can state that no server is required. Reuse the current harness and record external stand-ins and limits.
3. For multiple journeys, keep a small feature index beside the recipe linking each covered V to its actions, expected result, failure path and checker. Read only relevant entries. List helper/feature-map directories in profile `inputs`; Markdown links alone do not bind those files.
4. Before accepting a new or changed procedure, actually follow it once: diagnose the environment, launch/drive the real product, inspect assertions/logs and clean up. Check that evidence survives cleanup. A changed feature or failed Doctor triggers repair of the affected procedure, not a second full workflow or one worker per feature.

For a runnable example see [verify-cli](../../../examples/verification/verify-cli/SKILL.md) in the package source; installed projects copy `examples/verification` from the package as described in its README. Do not install full Pstack setup/poteto-mode or register a second workflow to obtain this procedure.

For each Story V ID, describe the real user entry point, preconditions, action, expected state/side effect and failure path. Reuse a suitable existing test. Otherwise write a small executable checker that starts/drives the actual CLI/server/browser and asserts those observations. A server's successful startup alone does not prove its feature. No mocks beyond existing external boundaries. Missing prerequisites, unavailable environments and manual-only checks remain unverified and block executable delivery; never replace them with a convenient no-op.

## Project profile

Create `.ai-workflow/verification.json` (review it like executable code):

```json
{
  "version": 1,
  "recipe": "verify-app/SKILL.md",
  "inputs": ["src", "scripts/prove-feature.mjs", "verify-app", "package.json"],
  "checks": [
    {"id":"feature", "covers":["V1"], "argv":["node","scripts/prove-feature.mjs"], "timeoutMs":30000}
  ],
  "requiresG3": false
}
```

Use actual project paths and Story IDs. Optional `recipe` must name a readable, nonempty file inside the project without symlinks. Task inputs include its path/byte hash and relevant check IDs; receipts retain that recipe identity. The file is not executed as code. A hash binds content, not proof that an agent read/invoked the skill or that its assertions are adequate.

Commands run from the project root with `shell: false`, inherited host environment/permissions, closed stdin and a 30-second default timeout (maximum 300 seconds). Combined output over 10 MiB fails the check and retains truncated logs. Cleanup targets the command's process group on POSIX and its direct child on Windows; checkers must stop services they detach. If output pipes remain open beyond the 500ms termination grace, the runner closes its streams and records `outputIncomplete`, which fails verification. Shell operators are literal argv; put pipelines/server lifecycle in a reviewed checker script that asserts behavior and exits nonzero on failure. This runner is not a security sandbox. Use an existing worktree/container for risky prototypes according to host policy.

Git snapshots include HEAD, index state, tracked bytes/deletions, executable modes and nonignored untracked files, plus explicit inputs. Profile, selected recipe and required G3 design are always additional snapshot inputs, including when Git-ignored. Other ignored helpers/features require explicit inputs. Recipe edits make previous review/verification stale; profile edits require a new run. Non-Git projects must still list behavioral inputs explicitly, including dependencies/configuration/checkers. Commit/stage before final verification, or rerun affected checks after those Git changes. External services, environment variables, installed dependencies and data are not fully captured; record versions/seed conditions and remaining boundaries in the recipe.

Keep generated run/result/log/approval files under `.ai-workflow/runs/`, `.ai-workflow/evidence/`, `.ai-workflow/approvals/`. These outputs are excluded; never put product source there. Keep checker-generated caches/builds Git-ignored, or make them declared stable inputs. Logs may contain secrets: keep them local, inspect/redact before intentionally sharing, never automatically upload/commit them.

## Bind human decisions

Compute the canonical Story hash with installed `storyContract` from `.ai-workflow/graph/workflow.mjs`; it excludes Status and G1/G3/G4 metadata lines. Add the existing gate line pointing to an approval JSON. Populate only after the real human decision:

```json
{"gate":"G1", "storyHash":"<canonical hash>", "responseRef":"<actual response reference>"}
```

For a design requiring G3, set `requiresG3: true` and `design: "docs/design.md"` in the profile; the G3 JSON additionally has `decisionHash` (SHA-256 of design bytes). Obtain the decision before initialization/implementation. Small changes need no G3. Risk declaration belongs to the approved scope and reviewed profile, not a keyword classifier.

G4 JSON additionally has the current Graph `snapshot` and `runId`; preserve prediction-before-reveal in `understanding-gate.md`. These bindings prevent accidental reuse; a host controlling repository files can forge records. They are not human identity authentication.

## Run and inspect

Start the final verification node, then execute every configured check intersecting its V scope. If several checks cover the same V, all are required; one convenient passing journey cannot replace another:

```bash
node .ai-workflow/bin/graph.mjs verify <run.json> workflow-verify <started-token> feature
```

Under `superpowers:verification-before-completion`, read `verification.passed`, exit code/signal/timeout/incomplete-output, actual stdout/stderr, snapshot before/after and asserted boundaries from this same execution. No second run is needed merely because Pstack and SP both apply. CLI exit 0 reports successful collection, including a failing check. Empty logs are valid; the structured receipt captures execution. Raw log hashes and receipts are rechecked. A failed execution cannot be overridden by result `passed: true`; reset affected work and re-execute after correction. Repeating a check in one attempt is rejected. Reset preserves attempt counts and fences late results; it does not cancel a running process, which remains timeout-bound. Inspect host-owned workers before recovery.

Record the existing result JSON afterward. Review and final checks must reference the current code snapshot. `status` returns `stale` without rewriting saved state when code changed. Reset the earliest stale node, rerun descendants, and obtain G4 for the fresh snapshot. After real G4 run `graph.mjs delivery <run.json>`; document shape checks alone cannot establish delivery.

Legacy v1/v2 runs remain readable with `upgrade-required`. Stop old workers, retain artifacts/attempt history, and rerun checks/review in a new v3 run. Never import old `passed` flags as proof or reset budgets by renaming runs. Package 5.0 introduces this breaking persisted-format change; run format v3 is independent of the package version.
