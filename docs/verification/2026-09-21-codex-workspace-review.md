# Remote Codex workspace and readonly review — 2026-09-21

Story M3/M4/M5, V3/V4/V5; [task](../tasks/U4-codex-review.md). This extends the [mutable VM handoff](2026-09-21-mutable-workspace.md) with actual Codex CLI tools and a separate readonly review receipt. Model responses and review judgments are scripted localhost fixtures, not authenticated model work or independent semantic review.

## Connected behavior

`runEngineerJob` supervises Codex through `ContainerWorkspace.runRemote`. The existing handoff captures the approved baseline, reserves the Engineer, exports only after the VM writer is removed, freezes the validated result and creates the verification round. A fixed, hash-verified Linux Codex exec-server runs in the isolated worker. Its runtime volume is readonly; copied binary bytes are verified again in the VM before launch.

`ContainerReviewer` reuses that transport with an unconditionally readonly candidate volume. `runRegisteredReview` reserves only the required review node and records observed closure/evidence through the existing execution ledger. No new public launch or result submission endpoint exists. Registered checks retain their separate readonly interface.

The parser consumes only captured CLI stdout JSONL, separately from stderr. It requires a completed turn and terminal assistant message containing exactly version, candidateDigest, contractDigest, verdict, findings and summary. Candidate/contract identities must match. Missing/malformed/oversized/stale/ambiguous reports supply no review; exit zero alone cannot pass. Earlier prose is allowed; nested tool output never becomes a review. The ledger treats findings as failure even if the verdict claims pass.

The loopback relay accepts one connection with a per-run secret path, rejects Origin headers, bounds messages/output and permits only known filesystem/process/environment RPC methods. Normal Codex WebSocket disconnect is distinct from executor failure. Admission still requires CLI termination, VM cleanup, actual artifacts and verification. Abort/deadline supervision allows bounded cleanup and cannot revive a cancelled job. Unknown closure retains capacity.

## Evidence

- RED: new reviewer tests failed before the implementation existed. GREEN: nine counted parser/SQLite tests cover identity binding, malformed/conflicting/nonterminal evidence, tool-output spoofing, duplicate/wrong-node launches, missing reports, nonzero exits, unconfirmed closure, supervisor rejection and cancellation.
- Full root suite **172/172, exit 0**. TypeScript **exit 0**. Configured vendor lint **exit 0**, 0 errors / 40 existing warnings. Vendor lint excludes root runners, which have typecheck, tests and formatting checks.
- `scripts/test-codex-workspace.mjs <verified-linux-binary>`: **4/4 actual CLI/VM scenarios, exit 0**. Host Codex 0.155.1 and pinned Linux exec-server 0.154.0; only exercised protocol paths are qualified, not general version compatibility.
  1. Engineer command and patch edit the assigned VM copy. Its frozen candidate passes a real readonly VM check. A separate actual Codex Reviewer reads it; direct writes and apply_patch are denied. Its scripted report joins that exact candidate's test and reaches `awaiting_g4`.
  2. Cancel after an actual Engineer tool: no candidate/round is admitted; staging and original project stay intact.
  3. Reviewer exits zero with nonstructured prose: review is `unknown`, round is `human_required`, no G4 eligibility.
  4. Persist cancellation after an actual Reviewer read, then abort: round stays `cancelled`, late review is absent, confirmed-closed capacity is released.
- All scenarios leave label-filtered VM container/volume inventories empty. Fake existing host secrets remain intact. Completed fixtures reject explicit `environment_id=local`; fixture HOME has no auth file. User checkout is preserved.
- Preceding mutable VM regression **8/8** and readonly verifier regression **6/6** passed after remote supervision was added. These precede the reviewer-only wrapper; the final four scenarios exercise the wrapper plus unchanged mutable/test paths together.
- [Compact report, source/log hashes and raw report locations](codex-workspace-review.json). Temporary reports may expire; the compact record persists results and identities.
- Workflow Story/Task checkers exit 0; G4 skipped because the Story is not Delivered. Compound frontmatter, formatting and `git diff --check` exit 0.

## Review and corrections

Reviewed sequentially in this session per the user's agent mapping, not an independent model or branch-wide CE receipt. Scope: relay/supervisor, VM adapter, reviewer parser/lease and integration fixture. Checked closure versus result acceptance, identity binding, stdout/stderr boundaries, readonly mounts, cancellation, cleanup and unknown capacity. No additional material reviewer-path defect remained.

Prior remote work reproduced and fixed normal disconnect misclassified as failure, pre-aborted supervisor launch, later deadline overwriting cancellation, and an incomplete HTTP request holding relay close open. Their regressions remain in the full suite.

Simplification applied reuse/quality/efficiency rubrics. The reviewer reuses VM lifecycle, ledger and remote supervision. Parsing stays separate. Small test/review entry points keep different node/evidence checks explicit; no generic role framework or further behavior-preserving refactor was warranted.

An initial lint command applied the vendor config from the root over all vendor files, producing 1,843 errors with the wrong path/glob context. The package's actual `eslint src server`, run in its directory, passed with 0 errors / 40 existing warnings. No vendor code or lint rules changed; both logs remain. Compound updated [the existing evidence lesson](../solutions/integration-issues/remote-codex-cwd-and-tool-evidence.md); AGENTS.md already exposes the knowledge store.

## Remaining boundaries

Authentication-location G3 is pending. No authenticated model, real Engineer reasoning, semantic Reviewer, G4 evaluation/approval, delivery or real-project pilot occurred. Public execution stays locked. Role prompts/context, automatic coordination, deferred-capacity wakeups, explicit unknown recovery and bounded fix dispatch remain. Fixtures cannot establish model quality.

The full controller tool/hook/MCP/nested-process/network canary audit is incomplete. Workers can read/execute the pinned runtime without credentials; that does not prove the stricter nested-agent policy. No AppArmor exception was applied. Mutable volumes have export/admission bounds, not a per-job disk quota. Source-free packaging of the relay's vendor `ws` dependency is unverified.

Reproduce with Node 24.19.0, development dependencies and the existing dedicated VM:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
node scripts/test-codex-workspace.mjs /absolute/path/to/verified/linux/codex
```
