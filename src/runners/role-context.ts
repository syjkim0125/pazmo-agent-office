import { fail } from "../cli/project.ts";
import type { OfficeStore } from "../core/store.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { CandidateDiff } from "./candidate-diff.ts";
import { assertRoleProfile, loadRoleProfile } from "./role-profiles.ts";

export function rolePacket(
  store: OfficeStore,
  taskId: string,
  role: "engineer" | "reviewer",
  round: ReturnType<VerificationLedger["latest"]>,
  diff?: CandidateDiff,
) {
  const { item, documents } = store.roleContext(taskId);
  const packet = {
    version: 1 as const,
    role,
    profile: loadRoleProfile(role),
    taskId,
    revision: item.revision,
    contractDigest: item.contract.digest,
    candidateDigest: round?.candidate.digest ?? null,
    roundId: round?.id ?? null,
    attempt:
      role === "engineer" ? (round?.number ?? 0) + 1 : (round?.number ?? 1),
    workspace: "/candidate/tree",
    scope: item.contract.workspace,
    documents,
    checks: item.contract.checks,
    feedback: (round?.nodes ?? [])
      .filter((n) => n.result)
      .map((n) => ({
        nodeId: n.id,
        kind: n.kind,
        verdict: n.result!.verdict,
        output: n.result!.observation.output.slice(0, 8192),
        outputTruncated: n.result!.observation.output.length > 8192,
        review:
          n.result!.observation.kind === "review"
            ? n.result!.observation.report
            : null,
      })),
    diff: diff ?? null,
  };
  if (
    round &&
    (round.contractDigest !== item.contract.digest ||
      round.revision !== item.revision)
  )
    fail(
      "CONTRACT_CHANGED",
      "Role context does not match the verification round.",
    );
  if (
    role === "reviewer" &&
    (!round || diff?.candidateDigest !== round.candidate.digest)
  )
    fail(
      "EVIDENCE_REQUIRED",
      "Reviewer needs a frozen candidate and its verified diff.",
    );
  if (Buffer.byteLength(JSON.stringify(packet)) > 8 * 1024 * 1024)
    fail(
      "CONTEXT_LIMIT",
      "Role context exceeds the 8 MiB bound; reduce scope explicitly.",
    );
  return packet;
}
export type RolePacket = ReturnType<typeof rolePacket>;

export function rolePrompt(packet: RolePacket): string {
  assertRoleProfile(packet.role, packet.profile);
  // Instructions appear once, outside the untrusted task data block. Retain
  // provenance in that block without duplicating their full text.
  const data = {
    ...packet,
    profile: {
      ...packet.profile,
      files: packet.profile.files.map(({ path, digest }) => ({ path, digest })),
    },
  };
  return [
    "You are the assigned Pazmo Office " +
      packet.role +
      ". Work only in /candidate/tree using the remote tools.",
    ...packet.profile.files.map((file) => file.content),
    "BEGIN CONTROLLER TASK DATA\n" +
      JSON.stringify(data) +
      "\nEND CONTROLLER TASK DATA",
  ].join("\n\n");
}
