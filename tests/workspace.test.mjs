import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { readContract } from "../src/core/contracts.ts";
import { freezeWorkspace } from "../src/core/workspace.ts";
import { verifyCandidate } from "../src/core/candidates.ts";

const scope = {
  include: ["src", "new", "package.json"],
  exclude: ["src/generated"],
};
test("approved verification bytes carry a validated workspace selection", async (t) => {
  const f = fixture(t);
  f.put("verify.json", JSON.stringify({ ...f.verification, workspace: scope }));
  const c = await readContract(f.project, f.input);
  assert.deepEqual(c.workspace, scope);
  for (const workspace of [
    { include: ["../elsewhere"], exclude: [] },
    { include: ["src", "src/x"], exclude: [] },
    { include: [], exclude: [] },
    { include: [".ssh"], exclude: [] },
    { include: ["src"], exclude: ["src"] },
  ]) {
    f.put("verify.json", JSON.stringify({ ...f.verification, workspace }));
    await assert.rejects(readContract(f.project, f.input));
  }
});

test("selection includes nested additions/deletions, omits declared exclusions and rejects output outside scope", (t) => {
  const f = fixture(t),
    storage = join(f.root, "snapshots");
  mkdirSync(storage);
  mkdirSync(join(f.project, "src"));
  mkdirSync(join(f.project, "src/generated"));
  f.put("src/a", "a");
  f.put("src/generated/cache", "omit");
  f.put("package.json", "{}");
  const candidate = freezeWorkspace(f.project, scope, storage);
  assert.equal(verifyCandidate(candidate), true);
  assert.throws(() => freezeWorkspace(f.project, scope, storage, true), {
    code: "OUTSIDE_WORKSPACE",
  });
});

test("protected files are omitted from source and forbidden in result trees; external symlinks fail", (t) => {
  const f = fixture(t),
    storage = join(f.root, "snapshots");
  mkdirSync(storage);
  f.put(".env", "FAKE_ONLY");
  assert.equal(
    verifyCandidate(
      freezeWorkspace(f.project, { include: ["."], exclude: [] }, storage),
    ),
    true,
  );
  assert.throws(
    () =>
      freezeWorkspace(
        f.project,
        { include: ["."], exclude: [] },
        storage,
        true,
      ),
    { code: "OUTSIDE_WORKSPACE" },
  );
  mkdirSync(join(f.project, "src"));
  symlinkSync("../story.md", join(f.project, "src/link"));
  assert.throws(() =>
    freezeWorkspace(f.project, { include: ["src"], exclude: [] }, storage),
  );
});

test("an aliased result root cannot redirect capture outside its assigned directory", (t) => {
  const f = fixture(t),
    storage = join(f.root, "snapshots"),
    alias = join(f.root, "result");
  mkdirSync(storage);
  symlinkSync(f.project, alias);
  assert.throws(
    () =>
      freezeWorkspace(alias, { include: ["."], exclude: [] }, storage, true),
    { code: "UNSAFE_PATH" },
  );
});
