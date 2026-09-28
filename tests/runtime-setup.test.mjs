import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupRuntime,
  runtimePaths,
  installedRuntime,
} from "../src/cli/runtime-setup.ts";
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "office-setup-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function mockFetch(t, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
test("invalid archive integrity cannot publish a runtime or leave a live setup lock", async (t) => {
  const root = fixture(t);
  let calls = 0;
  mockFetch(t, async (url, options) => {
    calls++;
    assert.match(
      url,
      /^https:\/\/registry.npmjs.org\/@openai\/codex\/-\/codex-0.155.1-darwin-arm64.tgz$/,
    );
    assert.equal(options.redirect, "error");
    return new Response("untrusted archive");
  });
  await assert.rejects(setupRuntime(root, true), {
    code: "RUNTIME_ARCHIVE_CHANGED",
  });
  assert.equal(calls, 1);
  assert.equal(existsSync(runtimePaths(root).directory), false);
  assert.deepEqual(readdirSync(join(root, "qualified-runtime")), []);
});
test("foreign partial installation is preserved instead of overwritten or silently repaired", async (t) => {
  const root = fixture(t),
    paths = runtimePaths(root);
  mkdirSync(paths.directory, { recursive: true });
  writeFileSync(paths.controller, "user file");
  mockFetch(t, async () =>
    assert.fail("Existing invalid installation must not trigger a download"),
  );
  await assert.rejects(setupRuntime(root, true), {
    code: "RUNTIME_INSTALL_INVALID",
  });
  assert.equal(readFileSync(paths.controller, "utf8"), "user file");
  assert.equal(existsSync(paths.binary), false);
});
test("setup rejects an aliased managed directory before any download or write", async (t) => {
  const root = fixture(t),
    outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(root, "qualified-runtime"));
  mockFetch(t, async () => assert.fail("No download"));
  await assert.rejects(setupRuntime(root, true), { code: "UNSAFE_PATH" });
  assert.deepEqual(readdirSync(outside), []);
});
test("interrupted download has no published runtime and a concurrent setup cannot steal its lock", async (t) => {
  const root = fixture(t);
  let resolve, entered;
  const started = new Promise((r) => (entered = r));
  mockFetch(t, async () => {
    entered();
    return await new Promise((r) => (resolve = r));
  });
  const first = setupRuntime(root, true);
  await started;
  await assert.rejects(setupRuntime(root, true), {
    code: "RUNTIME_SETUP_BUSY",
  });
  assert.ok(existsSync(join(root, "qualified-runtime/setup.lock")));
  resolve(
    new Response(
      new ReadableStream({
        start(c) {
          c.error(new Error("network lost"));
        },
      }),
    ),
  );
  await assert.rejects(first, { code: "RUNTIME_DOWNLOAD_FAILED" });
  assert.deepEqual(readdirSync(join(root, "qualified-runtime")), []);
  assert.throws(() => installedRuntime(root), {
    code: "RUNTIME_SETUP_REQUIRED",
  });
});
