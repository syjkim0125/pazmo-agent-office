# Mutable VM workspace and Engineer handoff — 2026-09-21

Story M3/M4/M5, V3/V4/V5; [Task](../tasks/U4-mutable-workspace.md). This is actual VM command execution and file transfer. Its commands are fixture programs, not authenticated Codex agents.

## Connected behavior

`runEngineerJob` prepares the approved handoff and binds its lease to the inspected VM container before starting the command. `ContainerWorkspace` shares the bounded Docker lifecycle with `ContainerVerifier`, while the verifier's public interface has no writable option. Trusted preparation validates the frozen manifest and restores original file modes only for the workspace copy. Both workers retain a readonly rootfs, UID 1000, zero capabilities, no-new-privileges, no network, memory/CPU/PID limits and no host bind mounts. The workspace volume alone is writable for the implementation job.

After successful command exit, the controller removes the entire writer container before creating a separate readonly exporter. The fixed exporter traverses the approved scope without importing candidate code or reading symlink targets. It rejects protected/unselected paths and special files, limits traversal to 20,000 entries, files to 10,000 and data to 100 MiB, and emits a JSON/base64 representation. The reader has a 30-second timeout, 1 GiB memory ceiling and 150 MiB output ceiling; the command's output remains separately bounded at 256 KiB. These capture bounds are not a per-job filesystem quota on the mutable VM volume.

The host receiver independently checks scope, canonical paths, duplicate/ancestor collisions, base64, permissions, links and byte bounds. It builds a new private tree, validates link resolution, and swaps only the assigned staging directory. Invalid or incomplete payloads preserve the prior staging. If a replacement fails, it restores the prior directory; if restoration itself fails, the backup is retained. No worker-created tar/archive is unpacked on the host. The user's registered checkout is not replaced by this transport.

Only after successful export, cleanup and receive does the handoff freeze the returned tree and create a verification round. Failure, cancellation, timeout, changed baseline, missing handle, cleanup error or rejected supervisor promise cannot admit a candidate. Unknown execution capacity remains held. This internal adapter accepts a controller-selected command; there is no public job submission or model launch endpoint.

## Evidence

- RED: transfer tests initially failed because the receiver module was absent; container tests then failed because the writable runner export was absent.
- Final root suite **152/152, exit 0**. TypeScript **exit 0**. Vendor lint **exit 0**, **0 errors / 40 existing warnings**; root modules are outside that lint configuration.
- Host receiver tests cover binary data, links, permissions, empty deletion, unsafe paths, protected/excluded output, duplicates, ancestor collisions, malformed/truncated payloads, bad base64, escaping/dangling/cyclic links, special kinds and symlinked destinations. Every invalid case preserves the original staging and removes its temporary output. A 1 MiB binary case protects the non-recursive base64 validation path.
- Controlled Docker tests cover writer removal before export, writable vs readonly mounts, nonzero exit, timeout, cleanup/export failure and malformed transfer. Rejected supervisor promises before and after start retain an unknown lease with no candidate.
- **Actual VM 8/8, exit 0**: edit, delete-last-file, exit-7 failure, out-of-scope file, absolute symlink, FIFO, timeout with child, cancellation with child. The three hostile filesystem cases require command exit 0 before asserting the specific export/receive rejection, so a failed fixture command cannot masquerade as boundary proof. Timeout/cancel require the child-start marker and the correct classification.
- The edit case changes text, creates binary data and an internal link, and changes permissions inside the VM. It confirms UID 1000, no network interface except loopback, zero effective capabilities, readonly `/etc`, and absence of a fake controller secret. Both successful candidates subsequently pass an actual readonly VM check but remain `checking` because the Reviewer is absent. Original project bytes and the fake controller file are preserved in every scenario.
- **Existing readonly VM regression 6/6, exit 0**: pass, empty, failure, timeout, cancellation and output limit. This checks the shared lifecycle change against its earlier contract.
- Final workspace report's label-filtered container and volume inventories are empty. No credentials, real model, public API execution, user DB, host bind mount or policy exception was used. A sandboxed `colima status` misleadingly reported stopped; the direct, authorized Docker socket query proved the existing daemon was running, so no VM restart was performed.
- [Compact source/log/report hashes and outcomes](mutable-workspace.json). This preserves the new real evidence separately from previous handoff fixtures and prior VM reports.
- Story/Task checkers, Compound frontmatter validation, changed-code formatting and `git diff --check`: **exit 0**. The Story checker skipped G4 because the Story is not Delivered; human G4 remains pending.

## Review and simplification

Same-session sequential reuse/quality/efficiency and failure-path review followed the user's tool mapping; no independent or branch-wide review is claimed. The lifecycle was factored into one internal function while readonly and writable public entry points remain distinct. Existing candidate validation, scope validation, execution leases and handoff admission are reused. Base64 validation uses decoding plus exact canonical re-encoding; a large repeated-group regex was removed before final verification to avoid stack-dependent rejection of valid binary payloads.

Node's strip-only TypeScript runtime rejected parameter properties in the first factoring attempt. Explicit private fields restored runtime compatibility without changing flags or introducing a transpilation requirement. Review also strengthened the real failure assertions to require the intended malicious file/child to exist before rejection. No safety checks were removed. Compound captures [stopped-volume export and receiver rules](../solutions/architecture-patterns/receive-stopped-vm-workspaces.md).

## Remaining connection

The next step is the actual Codex remote tool supervisor using this workspace lifecycle, followed by Reviewer and Office coordination. The controller-authentication G3 proposal remains pending; this transport neither changes login location nor proves complete tool isolation. Live roles, automatic fix dispatch, semantic G4, delivery, recovery and real pilots remain unfinished. Public Office execution is still locked.

## Reproduce

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
node scripts/test-container-workspace.mjs
node scripts/test-container-verifier.mjs
```

Use Node 24.19.0 from this worktree. The last two commands opt into the existing dedicated VM and pinned image and should run sequentially because cleanup inventories cover all verifier-labelled resources.
