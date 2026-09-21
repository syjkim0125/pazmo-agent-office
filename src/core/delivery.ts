import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fail, noSymlinks } from "../cli/project.ts";
import {
  digest,
  freezeCandidate,
  readStable,
  verifyCandidate,
} from "./candidates.ts";
import type { Candidate, CandidateEntry } from "./candidates.ts";
import { materializeWorkspace } from "./workspace.ts";

export type DeliveryRecord = {
  task_id: string;
  round_id: string;
  candidate_digest: string;
  contract_digest: string;
  verification_subject: string;
  g4_subject: string;
  request_id: string;
  directory: string;
  receipt_digest: string;
  state: "delivered" | "invalid";
  created_at: number;
};
export function deliverySchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS pazmo_deliveries (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id),
    round_id TEXT NOT NULL UNIQUE REFERENCES pazmo_verification_rounds(id),
    candidate_digest TEXT NOT NULL, contract_digest TEXT NOT NULL,
    verification_subject TEXT NOT NULL, g4_subject TEXT NOT NULL,
    request_id TEXT NOT NULL, directory TEXT NOT NULL UNIQUE,
    receipt_digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('delivered','invalid')),
    created_at INTEGER NOT NULL
  )`);
}
export function storedDelivery(db: DatabaseSync, taskId: string) {
  return db
    .prepare("SELECT * FROM pazmo_deliveries WHERE task_id=?")
    .get(taskId) as DeliveryRecord | undefined;
}

/** Validates private local output; never executes or applies the delivered files. */
export function validDelivery(record: DeliveryRecord): boolean {
  try {
    noSymlinks(record.directory);
    if (
      JSON.stringify(readdirSync(record.directory).sort()) !==
      JSON.stringify(["candidate", "receipt.json"])
    )
      return false;
    noSymlinks(join(record.directory, "candidate"));
    if (
      JSON.stringify(
        readdirSync(join(record.directory, "candidate")).sort(),
      ) !== JSON.stringify(["manifest.json", "tree"])
    )
      return false;
    const bytes = readStable(
      join(record.directory, "receipt.json"),
      64 * 1024 * 1024,
    );
    if (digest(bytes) !== record.receipt_digest) return false;
    const receipt = JSON.parse(bytes.toString());
    return (
      receipt.version === 1 &&
      receipt.taskId === record.task_id &&
      receipt.roundId === record.round_id &&
      receipt.candidateDigest === record.candidate_digest &&
      receipt.contractDigest === record.contract_digest &&
      receipt.g4.subject === record.g4_subject &&
      receipt.g4.id === record.request_id &&
      verifyCandidate({
        directory: join(record.directory, "candidate"),
        digest: record.candidate_digest,
      })
    );
  } catch {
    return false;
  }
}

/** Caller owns this newly created directory until its receipt is committed. */
export function createDelivery(
  root: string,
  candidate: Candidate,
  receipt: unknown,
) {
  noSymlinks(dirname(root));
  noSymlinks(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(root, "delivery-"));
  let scratch: string | undefined;
  try {
    scratch = mkdtempSync(join(root, ".staging-"));
    const bytes = Buffer.from(JSON.stringify(receipt));
    if (bytes.length > 64 * 1024 * 1024)
      fail("DELIVERY_LIMIT", "Delivery evidence exceeds 64 MiB.");
    const working = join(scratch, "tree");
    materializeWorkspace(candidate, working);
    const entries: CandidateEntry[] = JSON.parse(
      readStable(
        join(candidate.directory, "manifest.json"),
        4 * 1024 * 1024,
      ).toString(),
    ).entries;
    // Materialization restores original modes before refreezing; copying the
    // readonly tree directly would change the candidate's manifest and digest.
    const copied = freezeCandidate(
      working,
      entries.map((e) => e.path),
      directory,
    );
    if (copied.digest !== candidate.digest)
      fail(
        "CANDIDATE_CHANGED",
        "Delivered snapshot differs from the approved candidate.",
      );
    renameSync(copied.directory, join(directory, "candidate"));
    writeFileSync(join(directory, "receipt.json"), bytes, {
      flag: "wx",
      mode: 0o400,
    });
    return { directory, receiptDigest: digest(bytes) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}
