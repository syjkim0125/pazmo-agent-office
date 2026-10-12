import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { realpathSync } from "node:fs";

const bin = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("hub commands validate their options before touching anything", (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-project-")));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  assert.match(run("hub").stderr, /--host is required/);
  assert.match(run("hub", "--host", "10.0.0.5", "--code", "x").stderr, /--code is not supported by hub/);
  assert.match(run("hub-link", "--project", project, "--hub", "https://10.0.0.5:8443").stderr, /--code is required/);
  assert.match(run("start", "--project", ".", "--host", "1.2.3.4").stderr, /--host is not supported by start/);
});

test("the hub serves HTTPS on the given address and prints the admin link once", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-cli-"));
  const child = spawn(process.execPath, [bin, "hub", "--host", "127.0.0.1", "--port", "0", "--data-dir", dir]);
  t.after(() => { child.kill("SIGINT"); rmSync(dir, { recursive: true, force: true }); });
  const [line] = await once(child.stdout, "data");
  const info = JSON.parse(String(line).split("\n")[0]);
  assert.match(info.url, /^https:\/\/127\.0\.0\.1:\d+$/);
  assert.match(info.adminInvite, /\/invite\/[A-Za-z0-9_-]{43}$/);
  assert.match(info.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  child.kill("SIGINT");
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
});

test("hub-link refuses an origin it cannot reduce to host/path without echoing it", (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-remote-")));
  const data = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-remote-data-")));
  t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });
  spawnSync("git", ["init", "-q", project]);
  spawnSync("git", ["-C", project, "remote", "add", "origin", "secret-token@/srv/repo"]);
  const out = run("hub-link", "--project", project, "--data-dir", data, "--hub", "https://127.0.0.1:1", "--code", "c", "--fingerprint", "f");
  assert.equal(JSON.parse(out.stderr.trim().split("\n").at(-1)).code, "HUB_REMOTE");
  assert.equal(out.stderr.includes("secret-token"), false);
});
