import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../src/runners/command.ts";
import { forkLoop, leftInGroups } from "./runner-fixture.mjs";

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
// Ten shells print their pid (= their group id) and fork `child` back to back, killing
// each at once, until the group SIGKILL at 200 ms lands mid-fork. On macOS a process
// still being created misses that one signal (Linux closes this race in fork). The
// loop is bounded so a shell the kill misses still ends. The caller is its own node
// process with nothing left to do once the results are back, so only runCommand's
// own timers keep it alive.
function stopForkingShells(child) {
  const shell = `exec 2>/dev/null; echo $$; ${forkLoop(child)}`;
  const caller = `import { runCommand } from ${JSON.stringify(import.meta.resolve("../src/runners/command.ts"))};
const started = Date.now();
const results = await Promise.all(Array.from({ length: 10 }, () =>
  runCommand("/bin/sh", ["-c", ${JSON.stringify(shell)}], { timeoutMs: 200, maxBytes: 1024, env: { PATH: "/usr/bin:/bin" } })));
console.log(JSON.stringify({ ms: Date.now() - started, errors: results.map((r) => r.error), groups: results.map((r) => r.stdout.trim()) }));`;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", caller], {
      encoding: "utf8",
      timeout: 30000,
    }),
  );
}
test("a timeout also kills a child that was being forked when the group was killed", () => {
  const { ms, errors } = stopForkingShells("sleep 5");
  assert.deepEqual(errors, Array(10).fill("TIMEOUT"));
  assert.ok(ms < 4000, "every forked child must be cut off");
});
test("a stop leaves no process in the group, even one without the pipes in a caller that exits", async () => {
  const groups = new Set(stopForkingShells("sleep 5 >/dev/null").groups.filter(Boolean));
  assert.equal(await leftInGroups(groups), 0, "no forked child may outlive the stopped command");
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
