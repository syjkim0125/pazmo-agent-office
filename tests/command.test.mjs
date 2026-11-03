import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
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
// Each shell forks `child` back to back, so the group SIGKILL lands mid-fork. On macOS a
// process still being created misses that one signal (Linux closes this race in fork).
const forkingShells = (child) =>
  Promise.all(
    Array.from({ length: 5 }, () =>
      runCommand(
        "/bin/sh",
        ["-c", `echo $$; i=0; while [ $i -lt 40 ]; do ${child} & i=$((i+1)); done; wait`],
        { timeoutMs: 30, maxBytes: 1024, env: { PATH: "/usr/bin:/bin" } },
      ),
    ),
  );
test("a timeout also kills a child that was being forked when the group was killed", async () => {
  const started = Date.now();
  const results = await forkingShells("sleep 5");
  assert.deepEqual(
    results.map((r) => r.error),
    Array(5).fill("TIMEOUT"),
  );
  assert.ok(Date.now() - started < 4000, "every forked child must be cut off");
});
test("a stop leaves no process in the group, even one that does not hold the pipes", async () => {
  const results = await forkingShells("sleep 5 >/dev/null 2>&1");
  const groups = new Set(results.map((r) => r.stdout.trim()).filter(Boolean));
  const left = () =>
    execFileSync("ps", ["-A", "-o", "pgid="], { encoding: "utf8" })
      .split("\n")
      .filter((pgid) => groups.has(pgid.trim())).length;
  const deadline = Date.now() + 2000;
  while (left() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(left(), 0, "no forked child may outlive the stopped command");
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
