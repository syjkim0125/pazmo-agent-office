import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { HandoffLedger } from "../src/core/handoffs.ts";

export async function officeFixture(t, approved = true) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "office.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  mkdirSync(join(f.project, "src"));
  f.put("src/a", "before");
  f.put(
    "verify.json",
    JSON.stringify({
      version: 1,
      workspace: { include: ["src"], exclude: [] },
      checks: [
        {
          id: "V1",
          argv: [
            "node",
            "-e",
            "require('assert/strict').equal(require('fs').readFileSync('src/a','utf8'),'after')",
          ],
          timeoutMs: 15000,
        },
      ],
    }),
  );
  const token = "a".repeat(64),
    store = new OfficeStore(db, f.project, token),
    verification = new VerificationLedger(db, store),
    execution = new ExecutionLedger(db, store, verification);
  const storage = join(f.root, "candidates");
  mkdirSync(storage);
  const handoffs = new HandoffLedger(
    db,
    store,
    verification,
    execution,
    f.project,
    storage,
  );
  const task = await store.register(token, f.input);
  if (approved)
    for (const gate of ["G1", "G3"]) {
      const r = store.requestApproval(token, task.id, gate);
      store.decide(token, r.id, {
        decision: "approve",
        note: "Disposable coordinator fixture only.",
      });
    }
  return { ...f, db, store, verification, execution, handoffs, task };
}
