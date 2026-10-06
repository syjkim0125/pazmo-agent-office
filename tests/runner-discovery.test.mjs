import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverRunners, nativeBinary } from "../src/runners/runner-discovery.ts";
import { exists, fakeNative, tempRoot } from "./runner-fixture.mjs";

function fixture() {
  const root = tempRoot();
  const home = join(root, "home");
  mkdirSync(home);
  const marker = join(root, "executed");
  // bun/npm global layout: bin/codex -> node_modules/@openai/codex/bin/codex.js
  const modules = join(root, "global/node_modules/@openai");
  const launcher = join(modules, "codex/bin/codex.js");
  mkdirSync(join(modules, "codex/bin"), { recursive: true });
  writeFileSync(launcher, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(marker)}, "ran")\n`);
  chmodSync(launcher, 0o755);
  const nativeCodex = fakeNative(
    join(modules, "codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex"),
    `case "$1 $2" in
  "--version ") echo "codex-cli 0.160.0";;
  "login status") echo "Logged in using ChatGPT";;
  *) exit 2;;
esac\n`,
  );
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(launcher, join(bin, "codex"));
  const nativeClaude = fakeNative(
    join(root, "cask/2.1.280/claude"),
    `case "$1 $2" in
  "--version ") echo "2.1.280 (Claude Code)";;
  "auth status") echo '{"loggedIn":false,"authMethod":"none"}';;
  *) exit 2;;
esac\n`,
  );
  symlinkSync(nativeClaude, join(bin, "claude"));
  const scriptBin = join(root, "script-bin");
  mkdirSync(scriptBin);
  writeFileSync(
    join(scriptBin, "claude"),
    `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`,
  );
  chmodSync(join(scriptBin, "claude"), 0o755);
  const empty = join(root, "empty");
  mkdirSync(empty);
  return { root, home, bin, scriptBin, empty, marker, nativeCodex, nativeClaude };
}

test("finds the native codex behind a bun/npm launcher and reports login", async () => {
  const fx = fixture();
  const r = await discoverRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(r.codex.status, "ready");
  assert.equal(r.codex.path, fx.nativeCodex);
  assert.equal(r.codex.version, "0.160.0");
  assert.match(r.codex.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.codex.loggedIn, true);
  assert.equal(exists(fx.marker), false, "the JS launcher must never run");
});

test("a ready but logged-out claude explains the login command", async () => {
  const fx = fixture();
  const r = await discoverRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(r.claude.status, "ready");
  assert.equal(r.claude.version, "2.1.280");
  assert.equal(r.claude.loggedIn, false);
  assert.match(r.claude.hint, /claude auth login/);
});

test("a script-only claude is unsupported and never executed", async () => {
  const fx = fixture();
  const r = await discoverRunners({ pathEnv: fx.scriptBin, home: fx.home, extraDirs: [] });
  assert.equal(r.claude.status, "unsupported");
  assert.match(r.claude.hint, /네이티브/);
  assert.equal(exists(fx.marker), false);
});

test("missing runners explain how to install and log in", async () => {
  const fx = fixture();
  const r = await discoverRunners({ pathEnv: fx.empty, home: fx.home, extraDirs: [] });
  assert.equal(r.codex.status, "missing");
  assert.equal(r.claude.status, "missing");
  assert.match(r.codex.hint, /codex login/);
  assert.match(r.claude.hint, /claude auth login/);
});

test("login status runs without the caller's credentials or API keys", async () => {
  const fx = fixture();
  const envLog = join(fx.root, "env.txt");
  fakeNative(fx.nativeCodex, `env > ${JSON.stringify(envLog)}\necho "codex-cli 0.160.0"\n`);
  process.env.OPENAI_API_KEY = "must-not-leak";
  try {
    await discoverRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
  const { readFileSync } = await import("node:fs");
  const env = readFileSync(envLog, "utf8");
  assert.doesNotMatch(env, /must-not-leak/);
  assert.match(env, new RegExp(`HOME=${fx.home}`));
});

test("nativeBinary maps the launcher and rejects scripts", () => {
  const fx = fixture();
  assert.equal(nativeBinary(join(fx.bin, "codex")), fx.nativeCodex);
  assert.equal(nativeBinary(join(fx.scriptBin, "claude")), null);
  assert.equal(nativeBinary(join(fx.empty, "nothing")), null);
});

test("codex login status printed on stderr still counts as logged in", async () => {
  const fx = fixture();
  fakeNative(
    fx.nativeCodex,
    `case "$1 $2" in
  "--version ") echo "codex-cli 0.160.0";;
  "login status") echo "Logged in using ChatGPT" >&2;;
esac\n`,
  );
  const r = await discoverRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(r.codex.loggedIn, true);
});

test("claude keychain lookup receives the login user name", async () => {
  const fx = fixture();
  fakeNative(
    fx.nativeClaude,
    `case "$1 $2" in
  "--version ") echo "2.1.280 (Claude Code)";;
  "auth status") if [ -n "$USER" ]; then echo '{"loggedIn":true}'; else echo '{"loggedIn":false}'; fi;;
esac\n`,
  );
  const r = await discoverRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(r.claude.loggedIn, true);
});

test("codex with personal instructions in ~/.codex is marked blocked with guidance", async () => {
  const fx = fixture();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(fx.home, ".codex"));
  writeFileSync(join(fx.home, ".codex/AGENTS.md"), "personal rules");
  const r = await discoverRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(r.codex.status, "ready");
  assert.match(r.codex.blocked, /AGENTS\.md/);
  assert.match(r.codex.hint, /AGENTS\.md/);
  assert.match(r.codex.hint, /claude/);
  assert.equal(r.claude.blocked, undefined);
});
