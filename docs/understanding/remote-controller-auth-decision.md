# G3 proposal: keep Codex authentication in the controller, execute tools in the VM

Status: Approved
Understanding gate (G3): user conversation · 2026-09-22 · Check-in: accepted
Story: pazmo-agent-office-contract.md (M3/M4; V3/V4)
Prior approved decision: native-runner-isolation-decision.md

## Decision

Use the existing official macOS Codex ChatGPT login for the trusted model/controller process. Send all model-requested file and command tools to a dedicated disposable container in the existing VM through Codex's official remote execution interface. Do not copy authentication files into workers or change global Codex configuration.

This changes the earlier decision's sentence: “모델 인증은 VM 전용 공식 Codex 로그인 경로로 별도 검증한다.” The user approved this authentication-location change on 2026-09-22 after clarification that it authorizes Office's actual Codex model calls using the existing Mac login, with file/command tools confined to the VM. The earlier pending AppArmor exception is not authorized or applied by this decision.

## Concrete behavior and invariant

For example, an Engineer can change `/work/src/input.ts` in its isolated copy. Asking for `environment_id=local` must fail; asking for the host's authentication file, approval DB or Docker socket must not expose them. The controller alone transfers approved snapshots and collects results. Workers receive no account credentials, host bind mounts or controller token. Completion still requires the same candidate's tests/review and human G4.

## Evidence and remaining risk

The [17-check diagnostic](../verification/2026-09-21-codex-remote-execution.md) used no real model or authentication: real Codex command/patch tools executed in the container and an explicit local-environment call was rejected. It did not require a VM security exception.

The model/controller process still holds account access on macOS. Therefore remote routing, every enabled tool, configuration/skill/hook/MCP loading, network and child-process paths must be qualified before live use. Version mismatches or unverified tool paths keep execution locked. The temporary prototype relay is not the production security boundary.

## Alternatives and recovery

- Keep the approved VM-only login arrangement and validate a separate authenticated controller in the VM. This requires a new VM login and further transport work.
- Apply a narrow AppArmor exception only if the user separately approves that existing proposal; this proposal does not grant it.

If a canary fails, stop the disposable execution environment, preserve evidence and keep live execution locked. Do not silently fall back to local tools, another provider, or an API key. No host authentication files or global policies need to be changed to roll back the proposed per-process remote configuration.

## Approval scope

Approval authorizes implementing and validating this topology and then testing it through the user's existing Codex subscription after the boundary checks pass. It does not establish that isolation already passed, authorize the AppArmor change, or replace task G1/G3/G4 and delivery checks.

## Human decision

The assistant explained model login separately from the Office operator key and asked: “이 구조로 Mac의 기존 Codex 로그인을 사용해 실제 작업을 시험해도 될까?” The user answered: “응 그렇게 해”. The prior question asking what authentication meant was clarification only; this subsequent answer is the approval. No authentication secret is part of this record.

## Subsequent evidence

The 2026-09-22 [controller qualification and actual planning calls](../verification/2026-09-22-subscription-controller.md) now record the fixed configuration, five actual CLI/VM fixture scenarios and authenticated PM/Lead reports. This establishes a bounded internal planning connection, not whole-product isolation, Engineer/Reviewer completion, public launch or human G4.
