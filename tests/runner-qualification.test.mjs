import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QualificationStore, qualify } from "../src/runners/runner-qualification.ts";
import { tempRoot } from "./runner-fixture.mjs";

const install = (sha = "a".repeat(64), runner = "claude") => ({
  runner,
  status: "ready",
  path: "/opt/claude",
  version: "2.1.280",
  sha256: sha,
  loggedIn: true,
  hint: "준비됨",
});
function harness(passed = true) {
  const dir = tempRoot();
  const calls = [];
  const fixtures = {
    claude: async (selection) => {
      calls.push(selection);
      return [{ name: "turn-completed", passed }, { name: "no-host-write", passed: true }];
    },
    codex: async (selection) => {
      calls.push(selection);
      return [{ name: "turn-completed", passed }];
    },
  };
  const base = {
    store: new QualificationStore(dir),
    executorSha256: "e".repeat(64),
    fixture: { executor: "/x", openExecutor: () => { throw Error("unused"); }, runInContainer: async () => {}, candidateMarker: "m" },
    fixtures,
  };
  return { dir, calls, base };
}

test("a passing qualification is recorded once and reused without running again", async () => {
  const h = harness();
  const first = await qualify({ ...h.base, install: install(), model: "haiku" });
  assert.equal(first.passed, true);
  assert.equal(first.runner, "claude");
  assert.equal(first.model, "haiku");
  assert.equal(first.sha256, "a".repeat(64));
  assert.equal(first.executorSha256, "e".repeat(64));
  const again = await qualify({ ...h.base, install: install(), model: "haiku" });
  assert.deepEqual(again, first);
  assert.equal(h.calls.length, 1);
  const [file] = readdirSync(h.dir);
  assert.equal(statSync(join(h.dir, file)).mode & 0o777, 0o600);
});

test("a changed binary SHA or another model requires a new qualification", async () => {
  const h = harness();
  await qualify({ ...h.base, install: install(), model: "haiku" });
  await qualify({ ...h.base, install: install("b".repeat(64)), model: "haiku" });
  await qualify({ ...h.base, install: install(), model: "sonnet" });
  assert.equal(h.calls.length, 3);
});

test("a failed qualification is reported, not cached, and rerun next time", async () => {
  const h = harness(false);
  const failed = await qualify({ ...h.base, install: install(), model: "haiku" });
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.checks.filter((c) => !c.passed).map((c) => c.name), ["turn-completed"]);
  await qualify({ ...h.base, install: install(), model: "haiku" });
  assert.equal(h.calls.length, 2);
  assert.deepEqual(readdirSync(h.dir), []);
});

test("a runner that is not installed is never qualified", async () => {
  const h = harness();
  await assert.rejects(
    qualify({ ...h.base, install: { ...install(), status: "missing", path: undefined, sha256: undefined }, model: "haiku" }),
    /RUNNER_NOT_READY/,
  );
  assert.equal(h.calls.length, 0);
});

test("codex qualification runs with the selected model's own catalog entry", async () => {
  const h = harness();
  const result = await qualify({
    ...h.base,
    install: install("c".repeat(64), "codex"),
    model: "gpt-a",
    codexCatalog: async () => ({ entries: { "gpt-a": { slug: "gpt-a", visibility: "list" } } }),
  });
  assert.equal(result.passed, true);
  assert.equal(h.calls[0].model, "gpt-a");
  assert.match(h.calls[0].catalog.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.catalog, h.calls[0].catalog);
  await assert.rejects(
    qualify({ ...h.base, install: install("c".repeat(64), "codex"), model: "gpt-missing", codexCatalog: async () => ({ entries: {} }) }),
    /RUNNER_MODEL_UNKNOWN/,
  );
});

test("a change to Office's own boundary code invalidates earlier passes", async () => {
  const h = harness();
  const first = await qualify({ ...h.base, install: install(), model: "haiku", boundary: "1".repeat(64) });
  assert.equal(first.boundary, "1".repeat(64));
  await qualify({ ...h.base, install: install(), model: "haiku", boundary: "1".repeat(64) });
  await qualify({ ...h.base, install: install(), model: "haiku", boundary: "2".repeat(64) });
  assert.equal(h.calls.length, 2);
});

test("the default boundary digest covers the profiles, bridge and fixtures", async () => {
  const { BOUNDARY_DIGEST } = await import("../src/runners/runner-qualification.ts");
  assert.match(BOUNDARY_DIGEST, /^[a-f0-9]{64}$/);
});
