import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { digest } from "./candidates.ts";

export type Gate = "G1" | "G3" | "G4";
export type ApprovalAnswer = {
  decision: "approve" | "reject";
  note: string;
  understanding?: { behavior: string; invariant: string; evidence: string };
};
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  const savepoint = db.isTransaction
    ? `pazmo_${randomBytes(8).toString("hex")}`
    : null;
  db.exec(savepoint ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec(savepoint ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    if (savepoint)
      db.exec(
        `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`,
      );
    else db.exec("ROLLBACK");
    throw error;
  }
}
function validSubject(gate: Gate, subject: string): void {
  if (!["G1", "G3", "G4"].includes(gate) || !/^[a-f0-9]{64}$/.test(subject))
    fail(
      "INVALID_APPROVAL",
      "Approval requires a known gate and exact subject digest.",
    );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 16000
  );
}

/** Controller-only ledger. Its capability must never enter a worker packet or environment. */
export class ApprovalLedger {
  #tokenHash: string;
  #db: DatabaseSync;
  #now: () => number;
  constructor(
    db: DatabaseSync,
    operatorToken: string,
    now: () => number = Date.now,
  ) {
    if (!/^[a-f0-9]{64}$/.test(operatorToken))
      fail("INVALID_APPROVAL", "Invalid operator capability.");
    this.#tokenHash = digest(operatorToken);
    this.#db = db;
    this.#now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS pazmo_approval_challenges (
        id TEXT PRIMARY KEY, gate TEXT NOT NULL CHECK(gate IN ('G1','G3','G4')),
        subject TEXT NOT NULL, authority_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS pazmo_approvals (
        gate TEXT NOT NULL, subject TEXT NOT NULL, challenge_id TEXT NOT NULL UNIQUE,
        authority_hash TEXT NOT NULL, answer_json TEXT NOT NULL, accepted_at INTEGER NOT NULL,
        PRIMARY KEY(gate,subject), FOREIGN KEY(challenge_id) REFERENCES pazmo_approval_challenges(id)
      );
      CREATE TABLE IF NOT EXISTS pazmo_approval_rejections (
        challenge_id TEXT PRIMARY KEY, answer_json TEXT NOT NULL, rejected_at INTEGER NOT NULL,
        FOREIGN KEY(challenge_id) REFERENCES pazmo_approval_challenges(id)
      );
    `);
  }
  authorize(token: string): void {
    if (
      typeof token !== "string" ||
      !timingSafeEqual(Buffer.from(digest(token)), Buffer.from(this.#tokenHash))
    )
      fail("UNAUTHORIZED", "Operator authentication required.");
  }
  issue(
    token: string,
    gate: Gate,
    subject: string,
  ): { id: string; gate: Gate; subject: string; expiresAt: number } {
    this.authorize(token);
    validSubject(gate, subject);
    const id = randomBytes(32).toString("hex"),
      expiresAt = this.#now() + 10 * 60 * 1000;
    this.#db
      .prepare(
        "INSERT INTO pazmo_approval_challenges (id,gate,subject,authority_hash,expires_at) VALUES (?,?,?,?,?)",
      )
      .run(id, gate, subject, this.#tokenHash, expiresAt);
    return { id, gate, subject, expiresAt };
  }
  decide(token: string, id: string, answer: ApprovalAnswer): void {
    this.authorize(token);
    if (
      !answer ||
      !["approve", "reject"].includes(answer.decision) ||
      !text(answer.note)
    )
      fail("INVALID_APPROVAL", "A decision and human note are required.");
    transaction(this.#db, () => {
      const challenge = this.pending(token, id);
      const now = this.#now();
      if (answer.decision === "approve") {
        if (
          challenge.gate === "G4" &&
          (!answer.understanding ||
            ![
              answer.understanding.behavior,
              answer.understanding.invariant,
              answer.understanding.evidence,
            ].every(text))
        )
          fail(
            "UNDERSTANDING_REQUIRED",
            "G4 requires the human's behavior, invariant and evidence-boundary restatements.",
          );
        this.#db
          .prepare("INSERT INTO pazmo_approvals VALUES (?,?,?,?,?,?)")
          .run(
            challenge.gate,
            challenge.subject,
            id,
            this.#tokenHash,
            JSON.stringify(answer),
            now,
          );
      } else {
        this.#db
          .prepare("INSERT INTO pazmo_approval_rejections VALUES (?,?,?)")
          .run(id, JSON.stringify(answer), now);
      }
      this.#db
        .prepare(
          "UPDATE pazmo_approval_challenges SET consumed_at=? WHERE id=?",
        )
        .run(now, id);
    });
  }
  pending(token: string, id: string) {
    this.authorize(token);
    const challenge = this.#db
      .prepare("SELECT * FROM pazmo_approval_challenges WHERE id=?")
      .get(id) as
      | {
          gate: Gate;
          subject: string;
          authority_hash: string;
          expires_at: number;
          consumed_at: number | null;
        }
      | undefined;
    if (
      !challenge ||
      challenge.consumed_at !== null ||
      challenge.expires_at <= this.#now() ||
      challenge.authority_hash !== this.#tokenHash
    )
      fail(
        "STALE_APPROVAL",
        "Approval challenge expired, was consumed, or belongs to another session.",
      );
    if (this.has(challenge.gate, challenge.subject))
      fail(
        "ALREADY_APPROVED",
        "This exact subject already has approval; this request cannot revoke it.",
      );
    return challenge;
  }
  has(gate: Gate, subject: string): boolean {
    validSubject(gate, subject);
    return Boolean(
      this.#db
        .prepare("SELECT 1 FROM pazmo_approvals WHERE gate=? AND subject=?")
        .get(gate, subject),
    );
  }
}
