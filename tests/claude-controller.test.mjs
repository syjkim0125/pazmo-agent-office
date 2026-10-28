import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeJob } from "../src/runners/claude-controller.ts";
import { terminalReport } from "../src/runners/terminal-report.ts";
import { digest } from "../src/core/candidates.ts";
import { fakeNative, tempRoot } from "./runner-fixture.mjs";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const fakeExec = fileURLToPath(new URL("./fixtures/fake-exec-server.mjs", import.meta.url));

function setup(mode = "ok", executorMode = "ok") {
  const root = tempRoot();
  const marker = join(root, "marker");
  const binary = fakeNative(
    join(root, "claude"),
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeClaude)} ${mode} ${JSON.stringify(marker)} "$@"\n`,
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
  return { root, marker, options, executors: () => executors };
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
    const { result } = await run(claudeJob(fx.options, "Bounded task"));
    assert.equal(result.error, code);
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(existsSync(fx.marker), false);
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
 * runs while it holds the lock. */
function refreshingClaude(onTerm = `rmdir "$lock"; exit 143`, started = "") {
  const root = tempRoot();
  const lock = join(root, ".claude", ".oauth_refresh.lock");
  const binary = fakeNative(
    join(root, "claude"),
    `lock="$HOME/.claude/.oauth_refresh.lock"
trap '${onTerm}' TERM
mkdir -p "$HOME/.claude" && mkdir "$lock"
${started}
echo $$ > "$HOME/pid"
while :; do sleep 1; done\n`,
  );
  const pidFile = join(root, "pid");
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
    pid: () => Number(readFileSync(pidFile, "utf8")),
    async holding() {
      while (!existsSync(pidFile)) await new Promise((r) => setTimeout(r, 20));
    },
  };
}

// A killed claude leaves the lock, and every claude after it fails to sign in
// ("Failed to refresh OAuth token") until the lock is a minute old.
test("a claude cancelled while it refreshes the login releases the lock", async () => {
  const fx = refreshingClaude();
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  abort.abort();
  const { closed, result } = await job;
  assert.equal(result.error, "CANCELLED");
  assert.equal(closed, true);
  assert.equal(existsSync(fx.lock), false);
});

test("a claude timed out while it refreshes the login releases the lock", async () => {
  const fx = refreshingClaude();
  const { closed, result } = await claudeJob(fx.options, "Bounded task").supervise(
    "a".repeat(64),
    1500,
    new AbortController().signal,
  );
  assert.equal(result.error, "TIMEOUT");
  assert.equal(result.timedOut, true);
  assert.equal(closed, true);
  assert.ok(fx.pid() > 0, "the claude held the lock before it timed out");
  assert.equal(existsSync(fx.lock), false);
});

test("a claude that ignores SIGTERM is still killed soon after a cancel", { timeout: 15000 }, async (t) => {
  const fx = refreshingClaude("");
  t.after(() => {
    try {
      process.kill(-fx.pid(), "SIGKILL");
    } catch {}
  });
  const abort = new AbortController();
  const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
  await fx.holding();
  const begun = Date.now();
  abort.abort();
  const { closed, result } = await job;
  assert.ok(Date.now() - begun < 4000, "the cancel still ends promptly");
  assert.equal(result.error, "CANCELLED");
  assert.equal(closed, true);
  assert.throws(() => process.kill(fx.pid(), 0), { code: "ESRCH" });
});

test("a process the claude started does not outlive a cancel even if it ignores SIGTERM", async (t) => {
  const fx = refreshingClaude(
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
  // The orphan is reaped by launchd once killed.
  const deadline = Date.now() + 1000;
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
