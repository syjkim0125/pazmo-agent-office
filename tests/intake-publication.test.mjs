import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { fixture } from "./contract-fixture.mjs";
import { proposal } from "./planning-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
const token = "a".repeat(64);
function setup(t) {
  const f = fixture(t),
    db = new DatabaseSync(join(f.root, "office.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  applyBaseSchema(db);
  t.after(() => db.close());
  const store = new OfficeStore(db, f.project, token);
  return { ...f, db, store, intake: new IntakeLedger(db, store, f.project) };
}
const publish = (f, s) =>
  f.intake.publish(token, s.taskId, s.revision, s.inputDigest);
const folders = (f) =>
  readdirSync(f.project).filter((name) => name.startsWith("office-plan-"));

test("publication preserves existing documents, registers every task and survives reconstruction without approvals", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token, "high");
  const published = await publish(f, s);
  assert.equal(published.state, "registered");
  assert.equal(published.revision, s.revision + 1);
  assert.equal(published.publication.taskIds.length, 2);
  assert.equal(readFileSync(join(f.project, "story.md"), "utf8"), f.story);
  assert.equal(folders(f).length, 1);
  assert.deepEqual(
    new IntakeLedger(f.db, f.store, f.project).get(s.taskId),
    published,
  );
  assert.deepEqual(await publish(f, s), published);
  assert.equal(folders(f).length, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM tasks").get().n, 3);
  for (const id of published.publication.taskIds) {
    let task = f.store.get(id);
    assert.equal(task.blocker, "G1_REQUIRED");
    assert.equal(task.approved.G3, false);
    assert.equal(task.execution, "locked");
    const input = task.contract.input;
    assert.match(
      readFileSync(join(f.project, input.task), "utf8"),
      new RegExp(`Story: ${input.story}`),
    );
    assert.ok(input.plan.startsWith(published.publication.directory + "/"));
    const challenge = f.store.requestApproval(token, id, "G1");
    task = f.store.decide(token, challenge.id, {
      decision: "approve",
      note: "Scripted contract approval only.",
    });
    assert.equal(task.blocker, "G3_REQUIRED");
  }
  assert.throws(
    () =>
      f.intake.cancel(
        token,
        published.taskId,
        published.revision,
        published.inputDigest,
      ),
    { code: "INTAKE_STATE" },
  );
});

test("publication transaction rolls back all child tasks and transcript when receipt insertion fails", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  f.db.exec(
    "CREATE TRIGGER reject_publication BEFORE INSERT ON pazmo_intake_publications BEGIN SELECT RAISE(ABORT,'receipt failure'); END",
  );
  await assert.rejects(publish(f, s), /receipt failure/);
  assert.deepEqual(f.intake.get(s.taskId), s);
  assert.equal(f.store.list().length, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM tasks").get().n, 1);
  const orphan = folders(f)[0];
  writeFileSync(
    join(f.project, orphan, "story.md"),
    "Preserve user edits after failure.",
  );
  f.db.exec("DROP TRIGGER reject_publication");
  const result = await publish(f, s);
  assert.equal(result.publication.taskIds.length, 2);
  assert.notEqual(result.publication.directory, orphan);
  assert.equal(
    readFileSync(join(f.project, orphan, "story.md"), "utf8"),
    "Preserve user edits after failure.",
  );
});

test("cancellation during asynchronous contract validation prevents every registration", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  const pending = publish(f, s);
  const cancelled = f.intake.cancel(token, s.taskId, s.revision, s.inputDigest);
  await assert.rejects(pending, { code: "STALE_INTAKE" });
  assert.deepEqual(f.intake.get(s.taskId), cancelled);
  assert.deepEqual(f.store.list(), []);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM pazmo_intake_publications").get().n,
    0,
  );
});

test("invalid second contract cannot leave the first registered and concurrent calls cannot duplicate tasks", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  const pending = publish(f, s),
    directory = folders(f)[0];
  writeFileSync(join(f.project, directory, "verify-2.json"), "invalid");
  await assert.rejects(pending, { code: "INVALID_CONTRACT" });
  assert.deepEqual(f.store.list(), []);
  const results = await Promise.allSettled([publish(f, s), publish(f, s)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.store.list().length, 2);
  assert.equal(f.intake.get(s.taskId).state, "registered");
});

test("unauthorized, stale and non-proposal publication attempts cannot write project files", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  await assert.rejects(
    f.intake.publish("bad", s.taskId, s.revision, s.inputDigest),
    { code: "UNAUTHORIZED" },
  );
  await assert.rejects(
    f.intake.publish(token, s.taskId, s.revision + 1, s.inputDigest),
    { code: "STALE_INTAKE" },
  );
  const waiting = f.intake.create(token, "Another request", "normal");
  await assert.rejects(publish(f, waiting), { code: "INTAKE_STATE" });
  assert.deepEqual(folders(f), []);
});

test("a valid replacement document during validation cannot be attributed to the saved proposal", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  const pending = publish(f, s),
    directory = folders(f)[0];
  const file = join(f.project, directory, "task-2.md");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      "Input validation 2",
      "Unrelated replacement",
    ),
  );
  await assert.rejects(pending, { code: "CONTRACT_CHANGED" });
  assert.deepEqual(f.store.list(), []);
  assert.deepEqual(f.intake.get(s.taskId), s);
});

test("event failure rolls back receipt and registrations; later file edits require renewed contract approval", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  f.db.exec(
    "CREATE TRIGGER reject_publication_event BEFORE INSERT ON pazmo_intake_events BEGIN SELECT RAISE(ABORT,'event failure'); END",
  );
  await assert.rejects(publish(f, s), /event failure/);
  assert.deepEqual(f.store.list(), []);
  assert.deepEqual(f.intake.get(s.taskId), s);
  f.db.exec("DROP TRIGGER reject_publication_event");
  const p = await publish(f, s),
    task = f.store.get(p.publication.taskIds[0]);
  const challenge = f.store.requestApproval(token, task.id, "G1");
  writeFileSync(
    join(f.project, task.contract.input.plan),
    "Changed after registration.",
  );
  assert.equal(f.store.get(task.id).blocker, "CONTRACT_CHANGED");
  assert.throws(
    () =>
      f.store.decide(token, challenge.id, {
        decision: "approve",
        note: "Fixture.",
      }),
    { code: "CONTRACT_CHANGED" },
  );
});

test("a replaced project symlink cannot redirect publication into another directory", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token),
    other = join(f.root, "other");
  mkdirSync(other);
  renameSync(f.project, join(f.root, "original-project"));
  symlinkSync(other, f.project);
  await assert.rejects(publish(f, s), { code: "UNSAFE_PATH" });
  assert.deepEqual(readdirSync(other), []);
  assert.deepEqual(f.store.list(), []);
});

test("publication cannot report success inside a caller-owned transaction", async (t) => {
  const f = setup(t),
    s = proposal(f.intake, token);
  f.db.exec("BEGIN");
  try {
    await assert.rejects(publish(f, s), { code: "TRANSACTION_ACTIVE" });
    assert.deepEqual(folders(f), []);
  } finally {
    f.db.exec("ROLLBACK");
  }
  const pending = publish(f, s);
  f.db.exec("BEGIN");
  try {
    await assert.rejects(pending, { code: "TRANSACTION_ACTIVE" });
    assert.deepEqual(f.store.list(), []);
  } finally {
    f.db.exec("ROLLBACK");
  }
  assert.deepEqual(f.intake.get(s.taskId), s);
});
