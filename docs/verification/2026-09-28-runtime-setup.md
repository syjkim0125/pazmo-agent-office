# Persistent qualified runtime setup

Scope: Story M2/M4, V2/V4; `docs/tasks/U7-runtime-setup.md`. Starting revision `24e1dbe`, branch `codex/office-kit-role-graphs`. The previous temporary qualified binary paths no longer existed when this continuation began. Existing authentication, binary pins, VM boundaries and kit state ownership are unchanged.

## Supported user flow

`setup-runtime` previews without writes; `setup-runtime --apply` downloads the official npm `@openai/codex` platform artifacts for macOS arm64 0.155.1 and Linux arm64 0.154.0. Pinned SHA-512 archive integrity is checked before `/usr/bin/tar` reads one exact member to stdout. Existing qualified SHA-256 binary constants are checked before private executable files are published together by directory rename. No npm lifecycle script, global install, login copy or model call is involved. Version, URL and integrity pins live in `src/cli/runtime-setup.ts`; runtime binary pins remain the existing authoritative constants.

The shared persistent cache is below the same data root used by Office. A valid installation is reused without downloading; changed/partial content is preserved and rejected. A setup lock prevents concurrent installers. Controlled download failures clean their own staging and lock; an abrupt interruption may preserve a lock requiring inspection, and is never silently stolen. Downloads/output/time are bounded, redirects refused, and managed symlinks rejected. This setup supports the already-qualified macOS arm64 host only; it is not a Linux-host or source-free package release.

`start --live` now selects that installation automatically. Explicit paired controller/executor paths remain available. The separate `operator-key` command authenticates the current running instance and returns its operator URL/key only on explicit invocation. Normal startup and status do not expose that token. The existing operator request path shares this same authenticated capability loader. Doctor's explanation now accurately distinguishes installation checks from live readiness.

## Verification

- RED: setup-runtime was unknown, default live startup demanded temporary binary paths, and operator-key was unknown. GREEN: supported CLI preview/default selection and actual authenticated key retrieval work.
- Unit/CLI checks reject mismatched archives before publication, partial foreign installations, managed symlinks and concurrent setup; interrupted streams leave no published runtime or owned lock. The first path assertion needed macOS temporary-path canonicalization; the test now compares the real parent path, matching existing locate semantics.
- Full regression: **348/348**, exit 0, Node 24.19.0; `/private/tmp/office-runtime-setup-full.log`. It includes lifecycle/approval/kit/runner regression coverage. Only the explanatory doctor string changed afterward; final related checks are recorded below.
- Final checks after that wording change: CLI/runtime setup **13/13**, TypeScript and `git diff --check`, all exit 0; `/private/tmp/office-runtime-setup-final.log`. The full suite was not repeated because no further executable behavior changed.
- TypeScript, Story and U7 Task checkers: exit 0. Story status remains Approved; its checker does not establish G4. Vendor lint: exit 0, 0 errors/40 existing warnings, `/private/tmp/office-runtime-setup-lint.log`.
- **Real official installation** succeeded at `/Users/jongkkim/.local/share/pazmo-agent-office/qualified-runtime/codex-0.155.1-0.154.0`; both existing binary SHA-256 pins matched. A second apply returned changed=false and reused the installation.
- **Real public start/status/key/stop/restart**, using default binary paths and the existing dedicated VM, succeeded for two cycles on a disposable Git project. No model task, G1 or G4 was created. Key retrieval was checked without recording the key in the report. Report: `/private/tmp/office-persistent-runtime-w_hay9r2/report.json`; diagnostic: `/private/tmp/office-persistent-runtime-smoke.py`. This is startup evidence, not the requested real-project workflow.
- Existing Colima profile is running as `colima-pazmo-office`; its installed help supports the documented no-mount/no-context/no-SSH-forwarding startup flags. Per-model VM checks still run; readiness does not waive those checks or prove subscription validity.

## Review and limits

Sequential main-context review checked archive/binary trust boundaries, stdout-only extraction, atomic publication, partial/foreign preservation, concurrent locking, auth isolation and existing CLI behavior. CE reuse/quality/efficiency criteria led to reusing dataRoot, the existing command supervisor, hash pins and one operator capability loader; no further worthwhile simplification was identified. Review is inline under the repository delegation mapping, not an independent or full multi-agent review receipt.

Compound's durable-learning check found no additional reusable lesson beyond the existing pinned-runtime learning, code, tests and setup instructions. No duplicate learning was created (Documentation skipped: no new qualifying lesson).

The user-selected actual project/task remains pending. The whole local alpha is not complete: a supported screen-driven actual PM/Lead/Developer/Reviewer workflow, exact-candidate G4 from the actual user and final delivery still need acceptance evidence. The previous README pilot and conversational approval remain preserved; no new approval was invented or inferred. Main merge and deployment remain user-owned.
