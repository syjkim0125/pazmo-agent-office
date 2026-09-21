import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readContract, contractMatches } from "../src/core/contracts.ts";

import { fixture } from "./contract-fixture.mjs";

test("validates canonical artifacts and binds every input byte to one digest", async (t) => {
  const f = fixture(t),
    contract = await readContract(f.project, f.input);
  assert.equal(contractMatches(f.project, contract), true);
  assert.deepEqual(contract.verifyIds, ["V1"]);
  assert.match(contract.digest, /^[a-f0-9]{64}$/);
  for (const path of ["story.md", "task.md", "decision.md", "verify.json"]) {
    const original = (await import("node:fs")).readFileSync(
      join(f.project, path),
    );
    f.put(path, Buffer.concat([original, Buffer.from("\n")]));
    assert.equal(contractMatches(f.project, contract), false, path);
    f.put(path, original);
  }
  assert.equal(contractMatches(f.project, contract), true);
});
test("rejects absent high-risk decision, unknown task IDs and unbounded verification", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    readContract(f.project, { ...f.input, decision: null }),
    { code: "INVALID_CONTRACT" },
  );
  f.put("task.md", f.task.replace("M1, V1", "M1, V99"));
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
  f.put("task.md", f.task);
  f.put("verify.json", JSON.stringify({ version: 1, checks: [] }));
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
});
test("rejects traversal, symlinks, wrong Story reference and malformed workflow documents", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    readContract(f.project, { ...f.input, story: "../outside" }),
    { code: "UNSAFE_PATH" },
  );
  symlinkSync("story.md", join(f.project, "alias.md"));
  await assert.rejects(
    readContract(f.project, { ...f.input, story: "alias.md" }),
  );
  f.put("task.md", f.task.replace("Story: story.md", "Story: other.md"));
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
  f.put("task.md", f.task);
  f.put("story.md", "# Story\nApproved by AI");
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
});

test("draft blockers and unrelated verification IDs cannot become execution contracts", async (t) => {
  const f = fixture(t);
  f.put(
    "task.md",
    f.task.replace("Readiness: Implementation-ready", "Readiness: Draft"),
  );
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
  f.put("task.md", f.task);
  f.put(
    "story.md",
    f.story.replace(
      "- D1. Local only.",
      "- OPEN BLOCKING: Decide the required behavior.",
    ),
  );
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
  const expanded = f.story
    .replace(
      "- M1. Reject invalid input.",
      "- M1. Reject invalid input.\n- M2. Unrelated output.",
    )
    .replace(
      "- V1 [M1]. Check invalid input.",
      "- V1 [M1]. Check invalid input.\n- V2 [M2]. Check unrelated output.",
    );
  f.put("story.md", expanded);
  f.put("task.md", f.task.replace("M1, V1", "M1, V2"));
  f.put(
    "verify.json",
    JSON.stringify({
      version: 1,
      checks: [{ id: "V2", argv: ["node", "--test"], timeoutMs: 1000 }],
    }),
  );
  await assert.rejects(readContract(f.project, f.input), {
    code: "INVALID_CONTRACT",
  });
});

test("adding a UTF-8 BOM changes the approved document bytes", async (t) => {
  const f = fixture(t),
    contract = await readContract(f.project, f.input);
  f.put("story.md", "\uFEFF" + f.story);
  assert.equal(contractMatches(f.project, contract), false);
});

test("special-file inputs fail without blocking the controller", (t) => {
  const f = fixture(t);
  const made = spawnSync("mkfifo", [join(f.project, "pipe.md")]);
  assert.equal(made.status, 0);
  const script = `import { readContract } from ${JSON.stringify(new URL("../src/core/contracts.ts", import.meta.url).href)};
    try { await readContract(process.argv[1], JSON.parse(process.argv[2])); process.exit(2); }
    catch (error) { process.stdout.write(error.code ?? 'unexpected'); }`;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      f.project,
      JSON.stringify({ ...f.input, story: "pipe.md" }),
    ],
    { encoding: "utf8", timeout: 2000 },
  );
  assert.equal(result.status, 0, result.error?.message);
  assert.equal(result.stdout, "INVALID_CONTRACT");
});

test("an optional plan must match the Task reference and remain part of the approved bytes", async (t) => {
  const f = fixture(t);
  f.put("plan.md", "Inspect the parser before changing behavior.");
  const input = { ...f.input, plan: "plan.md" };
  await assert.rejects(readContract(f.project, input), {
    code: "INVALID_CONTRACT",
  });
  f.put(
    "task.md",
    f.task.replace(
      "Plan source: N/A — small and reversible",
      "Plan source: plan.md",
    ),
  );
  const contract = await readContract(f.project, input);
  assert.ok(contract.files.some((file) => file.path === "plan.md"));
  assert.equal(contractMatches(f.project, contract), true);
  f.put("plan.md", "Different instructions.");
  assert.equal(contractMatches(f.project, contract), false);
});
