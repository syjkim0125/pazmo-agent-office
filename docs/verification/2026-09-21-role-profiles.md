# Pinned role instructions — 2026-09-21

Scope: [U6 role profiles](../tasks/U6-role-profiles.md), Story M3/M4/M5 and V3/V4/V5, existing plan KTD6. This is a completed implementation increment, not completion of U6 or the Story.

## Behavior

Engineer and Reviewer now receive packaged Pazmo-authored instructions with role, source path, version ref, MIT license reference and SHA-256 for each instruction/reference file. `upstream/skills.lock.json` records provenance; it contains no imported CE/Superpowers code. The profiles explicitly do not claim to run those full workflows.

`rolePacket` checks the selected profile before constructing a job. `rolePrompt` checks the packet against the installed profile again and emits instruction text once before untrusted task data. Unknown roles, missing/changed instructions or common references, symlinks, directories, oversized files, FIFOs and forged packets fail with `ROLE_PROFILE_INVALID`. Only fixed packaged paths are read. A descriptor-based bounded reader preserves the earlier FIFO prevention lesson.

Office continues to own approvals, budgets, retries, verification and delivery. These prompts do not enforce OS isolation and cannot unlock public or authenticated execution. PM/Lead runtime, learning retrieval, UI and live qualification remain outstanding. Profile metadata currently travels in role packets and diagnostic reports; it is not yet a durable per-execution DB attestation in the delivery receipt. Integrity assumes the Office installation/code/lock are trusted together.

## Fresh verification

- RED: new test import failed with `ERR_MODULE_NOT_FOUND` for the absent profile implementation, before production edits (`/private/tmp/pazmo-role-profiles-red.log`). Two intermediate implementation runs failed because the digest helper import pointed to the wrong module; corrected to the existing `core/candidates.ts` export before GREEN.
- GREEN: focused role/coordinator tests initially 21/21; added a bounded FIFO subprocess test during review. Final root suite **215/215, exit 0**, including the existing real SQLite, CLI restart and delivery tests (`/private/tmp/pazmo-role-profiles-tests.log`).
- TypeScript project check exit 0. Vendor ESLint exit 0, zero errors and 40 existing warnings (`/private/tmp/pazmo-role-profiles-lint.log`). The lint configuration covers vendor `src/server`, not root TypeScript.
- Actual Codex CLI/VM test exit 0, one end-to-end scenario (`/private/tmp/pazmo-role-profiles-vm.log`). The mock endpoint observed both complete instruction files and the profile ref on all four initial model requests: Engineer → Reviewer → Engineer → Reviewer. Actual tools implemented the first failing candidate and a corrected second candidate; actual registered tests rechecked it, and scripted review/G4 assessment allowed local delivery. All four supervisors closed and all six execution leases released. Follow-up Docker queries returned no Pazmo containers/volumes.
- Raw VM report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-coordinator-yZz9xd/report.json`. Retained output: `deliveries/delivery-kWNeha` under that report directory. Candidate digest `2196b5c6039cd71e8ee94bfec12677a1f11cb052713e5d19ae397e4a51499a06`; receipt digest `0a491cc65112341d71aac71290e2b27d1ef74c6ddfc139636d4eea6d61157a36`.
- Source/log/report hashes are captured in [role-profiles.json](role-profiles.json). Fixture judgments do not prove model understanding, real user G4, instruction obedience or a real project pilot.

## Simplification and review

Executed ce-work natively in the existing worktree under workflow-owned finishing; no external implementation binding, fallback, new worker or model call. Existing dirty work belongs to this continuing authorized task; root checkout files were preserved. The existing U6/KTD6 plan supplied scope; no new execution authority was granted.

Applied ce-simplify-code's reuse, quality and efficiency lenses sequentially under the user AGENTS mapping. Reused existing digest and symlink checks; kept the distinct bounded profile reader instead of broadening the contract-reader API. Removed the old inline role instructions and duplicated profile text from task JSON. Deliberately retained prompt-time revalidation to catch drift between packet creation and use. No cache, scheduler, schema or dependency added.

Reviewed changed profile/packet/fixture paths against role separation, unsafe-file failures, coordinator exception handling, review schema compatibility and test coverage. Added FIFO regression coverage. No further actionable defects retained in this scope. This was a same-context sequential review adapted from ce-code-review, not an independent peer review or a complete branch/CE pipeline receipt. The broader plan remains incomplete.

Compound captured [bounded role instruction ownership](../solutions/architecture-patterns/pin-bounded-role-instructions.md). Local related-doc search found distinct filesystem/remote-tool lessons; no stale guidance required refresh. GitHub issue search was attempted but unavailable (`error connecting to api.github.com`); no issue findings are claimed.
