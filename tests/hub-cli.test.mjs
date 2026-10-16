import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startTestHub } from "./hub-fixture.mjs";
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

test("hub Fusion arguments are validated before the hub starts", () => {
  const code = (out) => JSON.parse(out.stderr.trim().split("\n").at(-1)).code;
  const a = run("hub", "--public-url", "https://h.example", "--host", "192.168.0.2", "--listen", "127.0.0.1:0");
  assert.equal(code(a), "ARGUMENT");
  assert.equal(code(run("hub", "--public-url", "https://h.example", "--listen", "127.0.0.1:0", "--name", "x")), "ARGUMENT");
  assert.equal(code(run("hub", "--public-url", "https://h.example", "--listen", "127.0.0.1:0", "--port", "1")), "ARGUMENT");
  assert.equal(code(run("hub", "--public-url", "http://h.example", "--listen", "127.0.0.1:0")), "ARGUMENT");
  assert.equal(code(run("hub", "--public-url", "https://h.example")), "ARGUMENT");
  assert.equal(code(run("hub", "--listen", "127.0.0.1:0")), "ARGUMENT");
  assert.equal(code(run("hub", "--public-url", "https://h.example", "--listen", "nope")), "ARGUMENT");
  assert.match(run("start", "--project", ".", "--public-url", "https://h.example").stderr, /--public-url is not supported by start/);
});

test("the hub behind the router starts without a certificate and prints only its URL and admin link", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-cli-proxy-"));
  const child = spawn(process.execPath, [bin, "hub", "--public-url", "https://pazmo-hub.apps.example.com", "--listen", "127.0.0.1:0", "--data-dir", dir]);
  t.after(() => { child.kill("SIGINT"); rmSync(dir, { recursive: true, force: true }); });
  const [line] = await once(child.stdout, "data");
  const info = JSON.parse(String(line).split("\n")[0]);
  assert.deepEqual(Object.keys(info).sort(), ["adminInvite", "url"]);
  assert.equal(info.url, "https://pazmo-hub.apps.example.com");
  child.kill("SIGINT");
  const [exit] = await once(child, "exit");
  assert.equal(exit, 0);
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

test("hub-link without --fingerprint reports an untrusted certificate with its own code and the fingerprint hint", async (t) => {
  const { hub } = await startTestHub(t);
  const project = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-trust-")));
  const data = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-trust-data-")));
  t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });
  spawnSync("git", ["init", "-q", project]);
  spawnSync("git", ["-C", project, "remote", "add", "origin", "https://github.example.com/team/repo.git"]);
  const env = { ...process.env };
  delete env.NODE_EXTRA_CA_CERTS;
  // The hub lives in this process, so the CLI must run without blocking the event loop.
  const out = await promisify(execFile)(process.execPath, [bin, "hub-link", "--project", project, "--data-dir", data, "--hub", hub.url, "--code", "c"], { env, encoding: "utf8" })
    .then(() => assert.fail("hub-link should fail"), (e) => e);
  const body = JSON.parse(out.stderr.trim().split("\n").at(-1));
  assert.equal(body.code, "HUB_TLS_UNTRUSTED");
  assert.match(body.error, /--fingerprint/);
});

test("hub-link --connect pairs from one pasted connection string; mixing it with --hub/--code/--fingerprint is an argument error", async (t) => {
  const { hub, store, tls } = await startTestHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const project = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-connect-")));
  const data = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-connect-data-")));
  t.after(() => { rmSync(project, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });
  spawnSync("git", ["init", "-q", project]);
  spawnSync("git", ["-C", project, "remote", "add", "origin", "https://github.example.com/team/be-service.git"]);
  const errCode = (r) => JSON.parse(r.stderr.trim().split("\n").at(-1)).code;
  const text = `${hub.url}/connect#c=${store.createConnectCode(admin)}&fp=${tls.fingerprint}`;
  for (const extra of [["--hub", hub.url], ["--code", "x"], ["--fingerprint", "AB"]])
    assert.equal(errCode(run("hub-link", "--project", project, "--data-dir", data, "--connect", text, ...extra)), "ARGUMENT");
  assert.match(run("start", "--project", project, "--connect", text).stderr, /--connect is not supported by start/);
  assert.equal(errCode(run("hub-link", "--project", project, "--data-dir", data, "--connect", "hello")), "HUB_CONNECT_INVALID");
  // The hub lives in this process, so the CLI must run without blocking the event loop.
  const out = await promisify(execFile)(process.execPath, [bin, "hub-link", "--project", project, "--data-dir", data, "--connect", text], { encoding: "utf8" });
  const body = JSON.parse(out.stdout.trim().split("\n").at(-1));
  assert.equal(body.linked, true);
  assert.equal(body.member, admin.name);
  assert.equal(body.repoName, "be-service");
  assert.equal(body.created, true);
  // A second pairing finds the repo the first one registered.
  const again = await promisify(execFile)(process.execPath, [bin, "hub-link", "--project", project, "--data-dir", data, "--connect", `${hub.url}/connect#c=${store.createConnectCode(admin)}&fp=${tls.fingerprint}`], { encoding: "utf8" });
  const body2 = JSON.parse(again.stdout.trim().split("\n").at(-1));
  assert.equal(body2.created, false);
  assert.equal(body2.repoName, "be-service");
});
