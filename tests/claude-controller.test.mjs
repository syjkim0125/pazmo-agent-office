import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeJob } from "../src/runners/claude-controller.ts";
import { terminalReport } from "../src/runners/terminal-report.ts";
import { digest } from "../src/core/candidates.ts";
import { fakeNative, tempRoot } from "./runner-fixture.mjs";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const fakeExec = fileURLToPath(new URL("./fixtures/fake-exec-server.mjs", import.meta.url));

// Some tests of a stop mock setTimeout, the controller's clock: its timeout and
// its 12 s grace then run out exactly when the test ticks them, however slowly a
// loaded machine runs the fake claude. Waiting for the fake's own progress
// keeps the real clock. A frozen clock never stops a fake on its own, and a
// fake that never gets going is waited for until the test ends, so every test
// of a refreshing claude carries a timeout, and refreshingClaude kills what is
// left after it.
const realSetTimeout = globalThis.setTimeout;
const pause = (ms) => new Promise((r) => realSetTimeout(r, ms));
/** Resolves once a fake claude has created `path`: it got that far. Gives up
 * when the test ends (its `signal`), so a fake that never gets there fails at
 * the test's timeout and leaves nothing polling. */
async function reached(path, signal) {
  while (!existsSync(path)) {
    signal.throwIfAborted();
    await pause(20);
  }
}

function setup(mode = "ok", executorMode = "ok") {
  const root = tempRoot();
  const binary = fakeNative(
    join(root, "claude"),
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeClaude)} ${mode} "$@"\n`,
  );
  let executors = 0;
  const options = {
    selection: { binary, sha256: digest(readFileSync(binary)), model: "haiku" },
    binary: "/qualified/executor",
    home: root,
    timeoutMs: 20000,
    openExecutor: () => {
      executors++;
      return spawn(process.execPath, [fakeExec, executorMode], {
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    },
  };
  return { root, options, executors: () => executors };
}
const run = (job) => job.supervise("a".repeat(64), 20000, new AbortController().signal);

test("a cancelled job starts neither claude nor its executor", async () => {
  const fx = setup();
  const abort = new AbortController();
  abort.abort();
  const result = await claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 1000, abort.signal);
  assert.equal(result.closed, true);
  assert.equal(result.result.error, "CANCELLED");
  assert.equal(fx.executors(), 0);
});

test("a changed claude binary is refused before the executor starts", async () => {
  const fx = setup();
  const job = claudeJob({ ...fx.options, selection: { ...fx.options.selection, sha256: "b".repeat(64) } }, "Bounded task");
  await assert.rejects(run(job), /UNVERIFIED_CONTROLLER_BINARY/);
  assert.equal(fx.executors(), 0);
});

test("tool calls reach the VM executor through the bridge and the report is runner-independent", async () => {
  const fx = setup();
  const job = claudeJob(fx.options, "Bounded task: summarise README");
  assert.equal(job.binary, "/qualified/executor");
  const { closed, result } = await run(job);
  assert.equal(result.error, null);
  assert.equal(result.exitCode, 0);
  assert.equal(closed, true);
  assert.deepEqual(terminalReport(result.stdout, ["report"]), {
    report: { readme: "path: /candidate/tree/README.md\nhello frames\n", promptSeen: true },
  });
  assert.equal(fx.executors(), 1);
});

for (const [mode, code] of [
  ["extra-tool", "CLAUDE_TOOLS_UNEXPECTED"],
  ["hook", "CLAUDE_HOOK_UNEXPECTED"],
  ["api-key", "CLAUDE_SUBSCRIPTION_REQUIRED"],
]) {
  test(`a failed boundary check (${mode}) stops claude before it continues`, async () => {
    const fx = setup(mode);
    const { closed, result } = await run(claudeJob(fx.options, "Bounded task"));
    assert.equal(result.error, code);
    // The fake waits where it would go on; only Office's SIGKILL ends it there.
    assert.equal(result.signal, "SIGKILL");
    assert.equal(closed, true);
    assert.equal(terminalReport(result.stdout, ["report"]), null);
  });
}

test("multi-byte text split across output chunks stays intact", async () => {
  const fx = setup("split-utf8");
  const { result } = await run(claudeJob(fx.options, "Bounded task"));
  assert.equal(result.error, null);
  assert.equal(terminalReport(result.stdout, ["report"]).report.note, "한국어 보고서");
});

test("executor loss overrides a successful exit", async () => {
  const fx = setup("ok", "die");
  const { result } = await run(claudeJob(fx.options, "Bounded task"));
  assert.equal(result.error, "EXECUTOR_CLOSED");
  assert.equal(terminalReport(result.stdout, ["report"]), null);
});

/** A claude refreshing the user's login when Office stops it: like CLI 2.1.280
 * it holds ~/.claude/.oauth_refresh.lock meanwhile and its exit handler
 * releases the lock on SIGTERM. `onTerm` replaces that handler; `started`
 * runs while it holds the lock; `idle` is what it then does over and over.
 * Whatever of it is still running when test `t` ends is killed. */
function refreshingClaude(t, onTerm = `rmdir "$lock"; exit 143`, started = "", idle = "sleep 1") {
  const root = tempRoot();
  const lock = join(root, ".claude", ".oauth_refresh.lock");
  const binary = fakeNative(
    join(root, "claude"),
    `lock="$HOME/.claude/.oauth_refresh.lock"
trap '${onTerm}' TERM
mkdir -p "$HOME/.claude" && mkdir "$lock"
${started}
echo $$ > "$HOME/pid"
while :; do ${idle}; done\n`,
  );
  const pidFile = join(root, "pid");
  const pid = () => Number(readFileSync(pidFile, "utf8"));
  t.after(() => {
    // A fake killed while writing its pid leaves the file empty: 0 would be
    // this test process's own group.
    const group = existsSync(pidFile) ? pid() : 0;
    if (group > 0)
      try {
        process.kill(-group, "SIGKILL");
      } catch {}
  });
  return {
    root,
    lock,
    options: {
      selection: { binary, sha256: digest(readFileSync(binary)), model: "haiku" },
      binary: "/qualified/executor",
      home: root,
      timeoutMs: 20000,
      openExecutor: () => assert.fail("no tool call was made"),
    },
    pid,
    holding: () => reached(pidFile, t.signal),
    /** Resolves once the fake has created `name` in its home. */
    reached: (name) => reached(join(root, name), t.signal),
  };
}

// A killed claude leaves the lock, and every claude after it fails to sign in
// ("Failed to refresh OAuth token") until the lock is a minute old.
test("a claude cancelled while it refreshes the login releases the lock", { timeout: 15000 }, async (t) => {
  const fx = refreshingClaude(t);
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  const { closed, result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(closed, true);
  assert.equal(existsSync(fx.lock), false);
});

test("a claude timed out while it refreshes the login releases the lock", { timeout: 15000 }, async (t) => {
  const fx = refreshingClaude(t);
  // Its 1.5 s timeout runs out only once it holds the lock, however long it
  // took to start.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 1500, new AbortController().signal);
  await fx.holding();
  t.mock.timers.tick(1500);
  const { closed, result } = await job;
  assert.equal(result.error, "TIMEOUT");
  assert.equal(result.timedOut, true);
  assert.equal(closed, true);
  assert.ok(fx.pid() > 0, "the claude held the lock before it timed out");
  assert.equal(existsSync(fx.lock), false);
});

// CLI 2.1.280 waits up to 2 s for a refresh in flight, then exits and the
// lock goes; on a busy Mac that took up to 9.1 s after SIGTERM (2026-10-29),
// so 6 s of grace stranded it.
test("a claude that takes 9 s to release the lock after SIGTERM still releases it", { timeout: 15000 }, async (t) => {
  // It releases the lock only when the test says so: 11.999 s into the grace.
  const fx = refreshingClaude(t, `touch "$HOME/term"; until [ -e "$HOME/go" ]; do sleep 0.05; done; rmdir "$lock"; exit 143`);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  await fx.reached("term");
  t.mock.timers.tick(11999);
  writeFileSync(join(fx.root, "go"), "");
  const { closed, result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(closed, true);
  assert.equal(result.signal, null, "it exited on its own, not by SIGKILL");
  assert.equal(existsSync(fx.lock), false, "the lock was released");
});

test("a claude that ignores SIGTERM is killed once its 12 s grace runs out", { timeout: 15000 }, async (t) => {
  // It notes the SIGTERM and carries on, answering a ping while it lives.
  const fx = refreshingClaude(t, `touch "$HOME/term"`, "", `[ -e "$HOME/ping" ] && touch "$HOME/pong"; sleep 0.05`);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  await fx.reached("term");
  t.mock.timers.tick(11999);
  writeFileSync(join(fx.root, "ping"), "");
  const first = await Promise.race([job.then(() => "ended"), fx.reached("pong").then(() => "answered")]);
  assert.equal(first, "answered", "it still runs 1 ms before the grace runs out");
  t.mock.timers.tick(1);
  const { closed, result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(result.signal, "SIGKILL");
  assert.equal(closed, true);
  assert.throws(() => process.kill(fx.pid(), 0), { code: "ESRCH" });
});

test("a process the claude started does not outlive a cancel even if it ignores SIGTERM", { timeout: 30000 }, async (t) => {
  const fx = refreshingClaude(
    t,
    undefined,
    `(trap '' TERM; while :; do sleep 1; done) </dev/null >/dev/null 2>&1 &
echo $! > "$HOME/helper"`,
  );
  const helper = () => Number(readFileSync(join(fx.root, "helper"), "utf8"));
  t.after(() => {
    try {
      process.kill(helper(), "SIGKILL");
    } catch {}
  });
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  const { result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(existsSync(fx.lock), false);
  // The orphan is reaped by launchd once killed, which a loaded machine may
  // take a while to do; one that was not killed never goes.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !gone(helper())) await new Promise((r) => setTimeout(r, 20));
  assert.ok(gone(helper()), "the helper was killed with the claude's process group");
});

function gone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

// On SIGTERM the CLI runs its shutdown, SessionEnd hooks included, so a stop
// for something Office refuses must not give it that chance.
test("a claude stopped for an unexpected hook or init gets no SIGTERM to shut down on", async (t) => {
  for (const [line, code] of [
    ['{"type":"system","subtype":"hook_started","hook_name":"SessionStart"}', "CLAUDE_HOOK_UNEXPECTED"],
    ['{"type":"system","subtype":"init","tools":["Bash"],"mcp_servers":[],"plugins":[]}', "CLAUDE_TOOLS_UNEXPECTED"],
    ['{"type":"assistant"}', "CLAUDE_INIT_MISSING"],
  ])
    await t.test(code, async (t) => {
      const fx = refreshingClaude(t, `touch "$HOME/term-ran"; exit 143`, `echo '${line}'`);
      const { closed, result } = await run(claudeJob(fx.options, "Bounded task"));
      assert.equal(result.error, code);
      assert.equal(closed, true);
      assert.equal(existsSync(join(fx.root, "term-ran")), false, "no shutdown handler ran");
    });
});

test("a cancel after the claude itself exited still kills what it left running", { timeout: 30000 }, async (t) => {
  const root = tempRoot();
  const binary = fakeNative(
    join(root, "claude"),
    `(trap '' TERM; while :; do sleep 1; done) </dev/null >/dev/null 2>&1 &
echo $! > "$HOME/helper"
(while :; do sleep 1; done) &
echo $$ > "$HOME/pid"
exit 0\n`,
  );
  const helper = () => Number(readFileSync(join(root, "helper"), "utf8"));
  t.after(() => {
    try {
      process.kill(helper(), "SIGKILL");
    } catch {}
  });
  const options = {
    selection: { binary, sha256: digest(readFileSync(binary)), model: "haiku" },
    binary: "/qualified/executor",
    home: root,
    timeoutMs: 20000,
    openExecutor: () => assert.fail("no tool call was made"),
  };
  const abort = new AbortController();
  const job = claudeJob(options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  // The claude has exited; a child keeps its output open, so the run goes on.
  await reached(join(root, "pid"), t.signal);
  const pid = Number(readFileSync(join(root, "pid"), "utf8"));
  while (!gone(pid)) {
    t.signal.throwIfAborted();
    await pause(20);
  }
  abort.abort();
  const { result } = await job;
  assert.equal(result.error, "CANCELLED");
  // As above: once killed, it is gone when launchd has reaped it.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !gone(helper())) await new Promise((r) => setTimeout(r, 20));
  assert.ok(gone(helper()), "the helper that ignores SIGTERM was killed too");
});

test("a hook the claude starts while shutting down after a cancel is killed at once", { timeout: 15000 }, async (t) => {
  // Its hook runs until it is killed, and Office's clock stands still, so the
  // grace never runs out: only the hook line can end this claude.
  const fx = refreshingClaude(
    t,
    `cat "$HOME/hook.json"; while :; do sleep 1; done`,
    `echo '{"type":"system","subtype":"hook_started","hook_name":"SessionEnd"}' > "$HOME/hook.json"`,
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  const { closed, result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(result.signal, "SIGKILL", "killed while its hook ran");
  assert.equal(closed, true);
});

// A cancel can land before init, while a startup login refresh holds the lock;
// what the CLI prints on its way out is no init problem and must not cut the
// shutdown short.
test("a line the claude prints while shutting down after a cancel does not cut its shutdown short", { timeout: 15000 }, async (t) => {
  const fx = refreshingClaude(
    t,
    `cat "$HOME/result.json"; sleep 0.3; rmdir "$lock"; exit 143`,
    `echo '{"type":"result","subtype":"error_during_execution","is_error":true}' > "$HOME/result.json"`,
  );
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  const { closed, result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(closed, true);
  assert.equal(existsSync(fx.lock), false, "the lock was released");
});
