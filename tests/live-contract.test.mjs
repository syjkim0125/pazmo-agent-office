import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { officeFixture } from "./coordinator-fixture.mjs";

const script = new URL("../scripts/run-live-contract.mjs", import.meta.url);
function run(f) {
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(script),
      "--live-approved",
      f.project,
      join(f.root, "office.sqlite"),
      f.task.id,
      "/missing-executor-must-not-be-opened",
    ],
    { encoding: "utf8" },
  );
}

test("live entry stops before Docker or login when this contract lacks human G1", async (t) => {
  const f = await officeFixture(t, false);
  const result = run(f);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).reason, "G1_REQUIRED");
  assert.equal(f.execution.list(f.task.id).length, 0);
  assert.equal(f.store.get(f.task.id).approved.G1, false);
});

test("live entry rejects a task from a different project before model dispatch", async (t) => {
  const f = await officeFixture(t);
  f.db
    .prepare("UPDATE tasks SET project_path=? WHERE id=?")
    .run(f.root, f.task.id);
  const result = run(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROJECT_MISMATCH/);
  assert.equal(f.execution.list(f.task.id).length, 0);
});

test("cancelled approved work cannot be restarted by the live entry", async (t) => {
  const f = await officeFixture(t);
  f.store.cancelExecution(f.task.id);
  const result = run(f);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).state, "cancelled");
  assert.equal(f.execution.list(f.task.id).length, 0);
});
