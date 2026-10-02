# Mechanical candidate diff and G4 binding — 2026-09-21

Story M2/M4/M5, V2/V4/V5; [Task](../tasks/U7-candidate-diff.md). This closes the arbitrary raw-string G4 seam. It is not the authenticated Engineer pipeline or the repository's human G4 acceptance.

## Follow-up

The later [Engineer handoff change](2026-09-21-engineer-handoffs.md) replaces the signature below with `prepare(taskId)` and selects the original baseline through persisted attempt ancestry. The results below describe the earlier diff-only implementation.

## Behavior

`CompletionLedger.prepare(taskId, baseline)` is now asynchronous. It selects the target from the eligible verification round, generates a patch from both frozen snapshots, verifies replay, and rechecks the same round after subprocess completion. The persisted `evidence.diff` contains version 1, both snapshot digests, `rawDiff`, `rawDiffEncoding`, full POSIX `modeChanges` and `roundTripVerified`. The whole diff record contributes to the immutable approval subject. A caller-written string is rejected. Legacy v5 bundles without this proof remain in the database but cannot authorize requests/evaluation; they are not silently overwritten or grandfathered in. The table schema remains v5.

The collector uses private baseline, target and replay copies, and a private HOME. It invokes `/usr/bin/git` without a shell or inherited environment, repository discovery, global/system configuration, hooks, external diff or textconv. Candidate code never executes. Diff output is bounded to 1 MiB and each command to ten seconds; serialized evidence has its own 1 MiB ceiling. Applying the generated patch occurs only in the disposable replay directory. Files, links, path sets and modes are compared with the target before evidence is returned; own temporary data is removed on success and failure.

Ordinary patches remain readable UTF-8. Non-UTF8 text patches use explicitly labelled base64 so bytes are not lost during JSON persistence. Binary files use Git's binary patch. Git's executable bit does not cover all manifest permissions, so separate mode metadata is replayed and verified. An empty patch can represent unchanged files or permission-only changes; the mode list and both digests disambiguate them. Empty snapshots now support new-project baselines and deleting the last file, including in VM candidate preparation.

[Git diff documentation](https://git-scm.com/docs/git-diff) defines filesystem `--no-index` comparisons and their exit-status behavior. [Git apply documentation](https://git-scm.com/docs/git-apply) documents applying patches outside a repository and path-prefix handling. The local tests verify these behaviors with the installed Git rather than assuming documentation alone proves the integration.

## Evidence

- RED before production edits: empty candidate creation was rejected; the command runner ignored a requested private cwd; the collector module did not exist; the old G4 preparer accepted arbitrary raw strings. New tests exposed these missing behaviors.
- Seven actual-Git tests cover text/add/delete, binary patches, non-UTF8 text, internal links, executable/full permissions, unusual filenames, file-directory and link-file replacements in both directions, empty/unchanged snapshots, hostile Git environment/configuration, tampered snapshots and output overflow. They apply actual patches and validate the resulting trees.
- Completion tests use mechanically generated diffs with real SQLite/HTTP/CLI. They reject changed mode metadata, legacy unverified bundles, caller-written text and cancellation while capture is pending. Other completion tests still cover exact-answer binding and stale evidence. Test/review observations and semantic assessments remain fixtures.
- Final root suite: **124/124, exit 0**. TypeScript: exit 0. Configured vendor lint: exit 0, **0 errors / 40 existing warnings**; it does not cover the new root module. Changed-source Prettier and `git diff --check` are checked separately.
- Actual dedicated VM: **6/6 scenarios, exit 0**: pass, empty candidate, exit-7 failure, timeout with descendant, cancellation with descendant and output limit. The empty snapshot is prepared and checked by a real uid-1000 container. Reviewer is absent, so passing test results still remain `checking`. Every owned container/volume is cleaned; subsequent label-filtered inventories are empty. No user credentials or model calls were used.
- [Compact evidence](candidate-diff.json) records source/log/raw-report hashes, Git version, VM outcomes and cleanup observations. Historical five-scenario evidence is preserved in `container-verifier.json`.
- Story/Task checker and Compound frontmatter validation: **exit 0**. The Story checker explicitly skipped human G4 because the Story is not Delivered; this does not certify delivery.

## Simplification and review

The reuse, quality and efficiency passes were performed sequentially in this session per the repository's tool mapping. Reused the bounded command runner and stable no-follow file reader, and consolidated approval-subject calculation. The narrowed eligible return preserves the proven non-null subject type; a type error exposed the lost narrowing during that refactor and was corrected before final verification. No independent-agent or full branch-wide review is claimed.

The scoped review covered filesystem mutation and private temporary ownership, Git configuration/attribute execution, exact patch bytes, metadata omissions, async cancellation and changed candidates, legacy persisted evidence, internal async caller updates, and empty-snapshot effects on the VM preparer. Added file-type replacement and metadata-tampering cases during review. Ordinary Git permissions cannot describe full manifest permissions, and UTF-8 decoding cannot preserve arbitrary patch bytes; both have explicit representations and regression coverage.

Compound recorded the verified lesson in [replay frozen diffs before approval](../solutions/integration-issues/replay-frozen-diff-before-approval.md). Existing G4 answer-binding documentation covers a different failure, so this is a separate related lesson; AGENTS.md already exposes the knowledge store.

## Remaining work and evidence boundary

This proves the difference between the two supplied frozen selections. It does **not** establish that the baseline was captured before Engineer execution or that those selections cover every approved project file. The trusted coordinator must bind that baseline and selection contract to the Engineer attempt. It must also schedule the actual authenticated Engineer/Reviewer, collect real review evidence, evaluate human understanding, and deliver the approved candidate. These connections, the pending authentication-location G3, live project pilots, UI and packaging remain unfinished; public execution remains locked. None of the fixture answers is a human G4 pass.

Reproduce with Node 24.19.0:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
node scripts/test-container-verifier.mjs
```

The last command is opt-in and uses the existing dedicated VM/image with disposable fixtures.
