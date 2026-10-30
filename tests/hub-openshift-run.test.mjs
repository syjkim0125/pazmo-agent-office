import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { HubStore } from "../src/hub/store.ts";
import { startHub, parsePublicUrl, parseListen } from "../src/hub/run.ts";

const dir = (t) => { const d = mkdtempSync(join(tmpdir(), "hub-run-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test("the public URL must be a bare https origin", () => {
  assert.equal(parsePublicUrl("https://pazmo-hub.apps.example.com").origin, "https://pazmo-hub.apps.example.com");
  for (const bad of ["http://h.example", "https://h.example/hub", "https://h.example:8443", "https://h.example/?a=1", "https://u:p@h.example", "HTTPS://h.example:443", "https://h.example:443", "nope"])
    assert.throws(() => parsePublicUrl(bad), { code: "ARGUMENT" }, bad);
  assert.deepEqual(parseListen("0.0.0.0:8080"), { host: "0.0.0.0", port: 8080 });
  for (const bad of ["8080", "0.0.0.0:", "0.0.0.0:99999", "host:80"]) assert.throws(() => parseListen(bad), { code: "ARGUMENT" }, bad);
});

test("behind the router the hub makes no certificate, prints only its URL and first admin link, and keeps state across restarts", async (t) => {
  const data = dir(t);
  const input = { mode: "proxy", publicUrl: "https://pazmo-hub.apps.example.com", listenHost: "127.0.0.1", listenPort: 0, dataDir: data };
  const first = await startHub(input);
  assert.deepEqual(Object.keys(first.result).sort(), ["adminInvite", "url"]);
  assert.match(first.result.adminInvite, /^https:\/\/pazmo-hub\.apps\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/);
  assert.match(first.address(), /^127\.0\.0\.1:\d+$/);
  assert.equal(existsSync(join(data, "team-hub", "tls")), false, "no CA or server certificate");
  assert.equal(existsSync(join(data, "team-hub", "hub.sqlite")), true);
  await first.stop();
  const again = await startHub(input);
  assert.equal(typeof again.result.adminInvite, "string", "no member yet: a fresh admin link (existing rule)");
  await again.stop();
});

test("the hub database waits for a lock instead of failing at once", async (t) => {
  const data = dir(t);
  const hub = await startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: 0, dataDir: data });
  t.after(() => hub.stop());
  const { DatabaseSync } = await import("node:sqlite");
  const other = new DatabaseSync(join(data, "team-hub", "hub.sqlite"));
  assert.equal(hub.busyTimeout(), 5000);
  other.close();
});

test("the LAN hub also waits for a lock, and keeps its certificate output", async (t) => {
  const data = dir(t);
  const hub = await startHub({ mode: "lan", host: "127.0.0.1", port: 0, dataDir: data });
  t.after(() => hub.stop());
  assert.equal(hub.busyTimeout(), 5000);
  assert.deepEqual(Object.keys(hub.result).sort(), ["adminInvite", "fingerprint", "trust", "url"]);
  assert.match(hub.address(), /^127\.0\.0\.1:\d+$/);
});

test("an unwritable data directory stops the hub before it listens", async (t) => {
  const data = dir(t);
  chmodSync(data, 0o500);
  t.after(() => { if (existsSync(data)) chmodSync(data, 0o700); }); // runs after the dir helper's rm
  await assert.rejects(startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: 0, dataDir: data }));
});

test("a failure after the server is listening closes the server and the database", async (t) => {
  const data = dir(t);
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const original = HubStore.prototype.bootstrapAdmin;
  HubStore.prototype.bootstrapAdmin = () => { throw new Error("boom"); };
  try {
    await assert.rejects(startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: port, dataDir: data }), /boom/);
  } finally {
    HubStore.prototype.bootstrapAdmin = original;
  }
  const again = createServer();
  t.after(() => new Promise((r) => again.close(r)));
  await new Promise((resolve, reject) => { again.once("error", reject); again.listen(port, "127.0.0.1", resolve); });
});

test("stopping twice is harmless", async (t) => {
  const data = dir(t);
  const hub = await startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: 0, dataDir: data });
  await hub.stop();
  await hub.stop();
});
