# Supported live launch checkpoint

Scope: U7-live-launch, Story M2/M3/M4 and V2/V3/V4; branch codex/office-kit-role-graphs, starting at b683484. This is a first-use connection, not whole-Story or local-alpha completion.

## Behavior and authority

`start --live --controller PATH --executor PATH` passes trusted configuration into the owned service. It checks fixed qualified binary hashes, existing login-file presence, Git root and dedicated VM/image. Browsers cannot provide binaries, authentication paths, daemon addresses, node transitions or worker-authored approvals. Preview remains locked.

Authenticated addressed launch/cancel routes reuse PlanningCoordinator, OfficeCoordinator, KitDelivery, global leases/budgets and completion preparation. Native kit files remain role-state authority. Runtime memory tracks only owned promises/abort signals; it cannot complete a task. A first planning snapshot is stored outside the project and reused across questions/G1/restart. Model work never overwrites the original project.

The screen offers readiness, PM/Lead launch, proposal publication, actual execution-contract documents/checks, human G1/G3 decisions, implementation/review/check launch and cancellation. Scope G1 is distinct from execution-contract G1 and final G4. Normal stop rejects active ownership; SIGTERM drains cancellation before closing SQLite. Unknown leases and attempt limits remain enforced by existing ledgers.

## Evidence

- Actual qualified startup/status/stop passed with the same pinned Mac 0.155.1 and Linux 0.154.0 binaries and dedicated VM. Report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-live-start-orEhwf/report.json`. This proves supported preflight and service startup; **no model invocation, actual human approval or delivery occurred**.
- Full suite **323/323**, exit 0, `/private/tmp/office-live-full.log`, before final review fixes. Runtime regression **7/7**, exit 0, `/private/tmp/office-live-runtime-final.log`, includes the Git configuration fix. Final focused results are recorded below.
- RED/GREEN: actual runtime-status routing initially returned 423 before reaching authorization. The route now returns 401 without the operator capability and locked state for preview; preview execution remains rejected.
- Real SQLite/HTTP tests with fixture supervisors cover stale/duplicate starts, missing contract approval, exact identity, cancellation before worker signaling, ownership during cleanup, draining shutdown and unknown-lease reconstruction. UI tests assert exact human text and refuse launch while locked. Fixtures do not establish model reasoning or human consent.
- Chrome desktop 1280/mobile 390 exercised readiness, planning launch, publication, exact fixture approval, implementation launch/cancel without overflow or script errors. Diagnostic script/screenshots: `/private/tmp/office-live-browser.mjs`, `/private/tmp/office-live-*.png`. APIs and model/human inputs were mocked. Visual review found a stale approval label in the list after detail refresh; it now updates from the fresh contract.
- Security review reproduced host execution through a disposable repository's `core.fsmonitor` during `git ls-files`. Explicit `-c core.fsmonitor=false -c core.untrackedCache=false` closes that path; the real-Git regression verifies no marker is written. Only a disposable test script/marker was used, not user commands or secrets.
- A final service regression exposed a response-shape change: adding transient `active: false` to preview GET broke equality with the preserved publication receipt. Activity is now exposed only in live mode; preview/legacy receipt shape is preserved.
- Final affected service/runtime/UI checks: **53/53**, exit 0, `/private/tmp/office-live-final-focused.log`. TypeScript, Story/Task checkers and `git diff --check`: exit 0. Parent Story is Approved, so G4 was not checked. Vendor lint: exit 0, 40 existing warnings.

## Review and limits

Reused the approved U7 plan and authentication G3. Applied focused TDD and sequential reuse/quality/efficiency plus correctness/security/reliability/API/test review under the user's inline tool mapping. The CE multi-agent/cross-model pipeline is not claimed as executed; no independent agent or external model review ran. Simplification found no justified architecture change; existing coordinators/ledgers were retained. Review produced the Git configuration fix and accurate approval-list refresh.

Compound updated the existing remote-execution learning with the host Git configuration boundary. Lightweight non-interactive capture; mechanical claims/frontmatter checks passed, with no semantic validator. CONCEPTS.md was absent, so vocabulary creation was deferred; active instructions already point to docs/solutions. Documentation complete.

Durable qualified-binary installation/pairing, trusted G4 answer evaluation and one actual screen-driven model/user acceptance run remain. README conversational approval is preserved and was not replayed or synthesized. This continuation neither updates kit source nor merges main.
