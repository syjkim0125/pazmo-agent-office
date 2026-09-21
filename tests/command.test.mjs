import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/runners/command.ts";

test("capture actual status and both streams without inheriting ambient credentials", async (t) => {
  const previous = process.env.PAZMO_TEST_SECRET;
  process.env.PAZMO_TEST_SECRET = "FAKE_PARENT_SECRET";
  t.after(() => {
    if (previous === undefined) delete process.env.PAZMO_TEST_SECRET;
    else process.env.PAZMO_TEST_SECRET = previous;
  });
  const r = await runCommand(
    process.execPath,
    [
      "-e",
      "console.log(process.env.PAZMO_TEST_SECRET ?? 'clean');console.error('detail');process.exit(7)",
    ],
    { timeoutMs: 3000, maxBytes: 1024, env: { PATH: "/usr/bin:/bin" } },
  );
  assert.equal(r.exitCode, 7);
  assert.equal(r.stdout, "clean\n");
  assert.equal(r.stderr, "detail\n");
  assert.equal(r.error, null);
});
test("timeouts and output limits never look like successful completion", async () => {
  const timed = await runCommand(
    process.execPath,
    ["-e", "setInterval(()=>{},100)"],
    { timeoutMs: 100, maxBytes: 1024, env: {} },
  );
  assert.equal(timed.timedOut, true);
  assert.notEqual(timed.exitCode, 0);
  const flood = await runCommand(
    process.execPath,
    ["-e", "while(true) process.stdout.write('x'.repeat(4096))"],
    { timeoutMs: 3000, maxBytes: 1024, env: {} },
  );
  assert.equal(flood.error, "OUTPUT_LIMIT");
  assert.ok(Buffer.byteLength(flood.stdout) <= 1024);
});
test("missing executable and pre-cancelled work fail without a successful exit", async () => {
  const missing = await runCommand("/pazmo-does-not-exist", [], {
    timeoutMs: 1000,
    maxBytes: 1024,
    env: {},
  });
  assert.equal(missing.exitCode, null);
  assert.match(missing.error, /ENOENT/);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await runCommand(
    process.execPath,
    ["-e", "console.log('should not execute')"],
    { timeoutMs: 1000, maxBytes: 1024, env: {}, signal: controller.signal },
  );
  assert.equal(cancelled.error, "CANCELLED");
  assert.equal(cancelled.stdout, "");
});

test("trusted commands can use a private cwd and retain exact non-UTF8 output", async (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-command-cwd-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const r = await runCommand(
    process.execPath,
    [
      "-e",
      "process.stderr.write(process.cwd());process.stdout.write(Buffer.from([0xff,0x00,0x61]))",
    ],
    { cwd, captureBytes: true, timeoutMs: 3000, maxBytes: 1024, env: {} },
  );
  assert.equal(r.exitCode, 0);
  assert.equal(r.stderr, cwd);
  assert.deepEqual(r.stdoutBytes, Buffer.from([0xff, 0x00, 0x61]));
});
