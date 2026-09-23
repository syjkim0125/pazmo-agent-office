# PM/Lead proposal protocol — 2026-09-21

Scope: [U6 planning protocol](../tasks/U6-planning-protocol.md), Story M2/M3/M4 and V2/V3/V4. This increment supplies an internal protocol and document renderer, not a live planning service.

## Behavior and boundaries

`beginPlanning` binds a request ID, bounded user request and controller-selected risk to pinned PM instructions. `acceptPlanning` accepts only a closed, successful controller observation with one terminal Codex assistant JSON report and the exact current input digest. PM returns up to three necessary questions or structured requirements; `answerPlanning` requires exactly the addressed answers and creates a different input digest. Three question rounds are allowed. An exhausted or malformed exchange fails rather than starting implementation.

The Lead receives the PM proposal and answer history. Its bounded task decomposition must cover all MUST/Verify IDs, map each covered MUST to a verification scenario and supply a registered check for every selected Verify ID. It cannot set risk, role assignments, output paths or approval metadata. Text fields reject newlines/control characters so model content cannot introduce canonical Markdown headings or gate metadata.

The renderer returns proposed Story, plan, Tasks and verification JSON, plus a decision proposal for high risk. It writes no files, runs no commands and registers/approves nothing. Paths are fixed relative filenames; a future publication path must choose a fresh directory and preserve existing documents. Generated Tasks have fewer than 30 non-empty lines. `Implementation-ready` is syntactic readiness, not authorization: real `OfficeStore` registration still reports G1_REQUIRED and then G3_REQUIRED for high risk.

Generated `ContractInput.plan` pins the Lead plan alongside other approved documents and includes its bytes in Engineer/Reviewer context. Task `Plan source` must match. Existing inputs that omit `plan` preserve the old optional behavior. Changing a pinned plan after approval makes the contract stale. Normal risk stays normal; the model cannot downgrade a controller-selected high risk.

Not implemented here: PM/Lead model supervision and global slot accounting, persistent dialogue and concurrent reply comparison, CLI/API/UI entry points, repository-context collection, dependency scheduling, automatic draft publication, semantic evaluation or real human approval. Packet digests detect mismatched data; they are not authentication or proof that an answer came from a human. Callers must retain and correlate controller-owned packets/results. No authenticated model was invoked and the pending auth-location G3 remains pending.

## Verification and review

- Initial RED: absent planning module, exit 1 (`/private/tmp/pazmo-planning-red.log`).
- Initial GREEN: 14 focused planning/profile tests, exit 0 (`/private/tmp/pazmo-planning-green.log`).
- Review reproduced a material integration gap: the Lead plan was absent from approved role context. Added an assertion and observed exit 1 (`/private/tmp/pazmo-planning-plan-red.log`), then added optional plan binding and mutation detection.
- Reused the existing terminal-turn parser in a shared helper instead of implementing divergent PM and Reviewer parsing. Existing malformed/stale/ambiguous review tests were retained. Related planning/contracts/coordinator/reviewer tests: 31/31 exit 0 (`/private/tmp/pazmo-planning-reviewed.log`).
- Added normal-risk multi-task coverage and a plan-reference mismatch regression; final root suite **221/221, exit 0** (`/private/tmp/pazmo-planning-final-tests.log`). This includes real SQLite approval integration and existing loopback CLI/restart tests. All planning model responses and human approval decisions in the new tests are fixtures.
- TypeScript exit 0. Vendor lint exit 0, zero errors/40 existing warnings; root source is outside that lint configuration. Story and Task checks PASS; Story G4 not checked because delivery remains incomplete.
- Applied ce-simplify-code reuse/quality/efficiency criteria and ce-code-review lenses sequentially under the user tool mapping. Reviewed input bounds, immutable packet identity, role profile validation, report closure, Markdown injection, complete ID coverage, normal/high-risk behavior, optional API compatibility and plan content delivered to workers. No further actionable findings retained in this increment. No independent peer/full-branch CE receipt is claimed.
- Compound updated [bounded role ownership](../solutions/architecture-patterns/pin-bounded-role-instructions.md) with the discovered plan-context gap. No new lesson document was needed.

The broader goal remains active. PM/Lead execution, persisted conversations, user-facing flows, full canaries, authenticated pilots, real G4, learning retrieval and packaging qualification remain required.
