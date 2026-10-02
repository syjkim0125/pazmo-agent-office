# Local contract and approval integration — 2026-09-19

Scope: U3 (Story M2/M4, V2/V4), with additive U2 database/lifecycle integration. This is partial implementation evidence, not whole-Story delivery or live worker isolation proof.

## Implemented and exercised

- Canonical Story/Task formatting uses the installed, package-owned workflow checker. Project code is never imported as a checker. Task coverage must refer to existing M/V IDs and selected V cases must cover its selected M requirements. Draft Tasks and OPEN BLOCKING Stories are rejected.
- SHA-256 binds exact UTF-8 document contents, including a BOM, contract paths, risk and verification settings. Approval subjects also include project, task ID, gate and revision. Changes to Story, Task, decision or verification files invalidate readiness.
- A private operator capability is independent of the lifecycle capability. Real HTTP tests reject absent/wrong/lifecycle tokens and foreign origins. CLI register/list/request/decide use this API and do not print the capability. Authenticated stop removes the current operator token file.
- Contracts use the existing Claw `tasks` queue and additive `pazmo_` tables in its SQLite DB. G1 plus required G3 move a task from inbox to planned. `ready` describes contract approval only; every response keeps execution locked.
- Challenges expire after ten minutes, are session-bound and single-use. Different tasks/revisions cannot share approval. Rejection of an already accepted subject returns an error; it is not a withdrawal operation.
- Injected SQLite failures demonstrate registration rollback and rollback of approval, challenge consumption and task status together. Historical accepted approvals survive controller restart; old pending challenges cannot be consumed by a new authority.
- Owned v1 DBs get a real SQLite backup before version-2 additive migration. Tests inspect the backup and migrated DB and verify no second backup on a version-2 restart. Foreign DB bytes remain unchanged.
- Candidate primitives copy selected file bytes without sharing inodes, preserve recorded source modes/links, reject escaped links/paths and detect candidate mutations. They are not yet connected to an actual runner/verifier/delivery flow.

## Test-first and review evidence

New contract/store imports initially failed with module-not-found; lifecycle tests then failed on missing operator credentials and migration backup. The CLI integration test failed with `Unknown command` before wiring it. The initial sandboxed HTTP run failed with EPERM on loopback binding; rerunning the same tests with that host restriction lifted exposed the intended feature failures.

Review reproduced and fixed: Draft readiness accepted as an execution contract; unrelated V mappings; a BOM ignored by the UTF-8 decoder; a later rejection reported as accepted despite a prior approval; FIFO open blocking before descriptor validation. The FIFO regression timed out before the fix and returned `INVALID_CONTRACT` afterwards. SQLite trigger injection also confirms the composed transaction rollback.

Simplification inspected reuse, clarity and repeated I/O in the changed files. Kept safety-critical rereads, removed unused test imports and the duplicate CLI stat call, and formatted the changed code. Reviews run sequentially in the main session under the user's AGENTS mapping; there was no independent agent or cross-model review. Full workflow review/requirements closure remains open with U3–U8; these checks do not satisfy G4.

## Fresh commands and boundaries

Node 24.19.0, macOS. All commands below exited 0:

| Command                                                                                   | Evidence                                                                                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                | 39/39 root tests, including real CLI/HTTP/SQLite integration. Temporary loopback binding was allowed. |
| `npm run typecheck`                                                                       | Root TypeScript check passed.                                                                         |
| `npm --prefix vendor/claw-empire run lint`                                                | 0 errors; 40 existing upstream warnings. Root has no separate ESLint configuration.                   |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | PASS, exit 0; G4 explicitly not checked because Story is not Delivered.                               |
| `node .ai-workflow/bin/check.mjs task docs/tasks/U3-contract-approvals.md`                | PASS, exit 0.                                                                                         |
| Official ai-workflow-kit 3.1.1 `doctor --root .`                                          | Six checks passed, exit 0.                                                                            |

The root test transcript is `/private/tmp/pazmo-contract-verification/root-tests.txt`. Prior browser/build/vendor tests belong to the earlier runtime evidence; they were not rerun as proof of these new CLI approval operations. The imported board can display the last stored planned state after a document edit; the operator contract listing is the current contract status source.

## Still incomplete

- Approved candidate → isolated execution → captured verifier/reviewer evidence → G4 evaluation → delivery.
- Candidate persistence and full deletion/base-conflict semantics; attempt/lease/cancellation/recovery guards and role budgets.
- Browser approval UI, three live workflow pilots, and source-free tarball installation.
- Worker exclusion from operator files/API. Mode-0600 files and HTTP token tests are not an OS isolation proof. No real Codex authentication or live agent execution occurred.

The proposed VM AppArmor exception is still awaiting explicit user approval after automatic approval review rejected it. This change was not applied, and no alternative weakened VM policy. See [the concrete decision](../understanding/vm-bwrap-policy-decision.md).

Compound captured the verified [FIFO validation failure](../solutions/runtime-errors/nonblocking-contract-file-validation.md). The unresolved VM/Codex containment problem is not documented as solved. No Jira, merge, commit, push or publication was performed for this increment.
