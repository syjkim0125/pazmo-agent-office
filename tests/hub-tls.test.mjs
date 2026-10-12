import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHubTls } from "../src/hub/tls.ts";

test("the hub issues its own CA and a server certificate for its LAN address", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-tls-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tls = ensureHubTls(dir, { ip: "10.0.0.5", dns: "hub.local" });
  const ca = new X509Certificate(tls.caPem), leaf = new X509Certificate(tls.certPem);
  assert.match(leaf.subjectAltName, /IP Address:10\.0\.0\.5/);
  assert.match(leaf.subjectAltName, /DNS:hub\.local/);
  assert.ok(leaf.verify(ca.publicKey), "signed by the hub CA");
  assert.ok(ca.ca && !leaf.ca);
  assert.equal(leaf.publicKey.asymmetricKeyDetails.namedCurve, "prime256v1", "leaf key uses a named curve");
  assert.equal(ca.publicKey.asymmetricKeyDetails.namedCurve, "prime256v1", "CA key uses a named curve");
  assert.equal(tls.fingerprint, ca.fingerprint256);
  assert.equal(statSync(join(dir, "ca.key")).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "server.key")).mode & 0o777, 0o600);
  assert.equal(ensureHubTls(dir, { ip: "10.0.0.5", dns: "hub.local" }).certPem, tls.certPem, "reuses a current certificate");
  const moved = ensureHubTls(dir, { ip: "10.0.0.6", dns: "hub.local" });
  assert.equal(moved.fingerprint, tls.fingerprint, "the CA the team trusts survives an address change");
  assert.match(new X509Certificate(moved.certPem).subjectAltName, /10\.0\.0\.6/);
  assert.throws(() => ensureHubTls(dir, { ip: "8.8.8.8", dns: "hub.local" }), /HUB_HOST_PRIVATE_IP_REQUIRED/);
  assert.throws(() => ensureHubTls(dir, { ip: "172.32.0.1", dns: "hub.local" }), /HUB_HOST_PRIVATE_IP_REQUIRED/);
  assert.throws(() => ensureHubTls(dir, { ip: "hub.local" }), /HUB_HOST_IP_REQUIRED/);
  assert.throws(() => ensureHubTls(dir, { ip: "10.0.0.5", dns: "bad name" }), /HUB_NAME_INVALID/);
});

test("the CA carries critical name constraints and refuses a different DNS name", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-tls-names-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tls = ensureHubTls(dir, { ip: "10.0.0.5", dns: "hub.local" });
  const text = execFileSync("openssl", ["x509", "-noout", "-text"], { input: tls.caPem }).toString();
  assert.match(text, /X509v3 Name Constraints: critical/);
  for (const range of ["10.0.0.0/255.0.0.0", "172.16.0.0/255.240.0.0", "192.168.0.0/255.255.0.0", "127.0.0.0/255.0.0.0"])
    assert.ok(text.includes(range), `permits ${range}`);
  assert.match(text, /DNS:hub\.local/);
  assert.equal(readFileSync(join(dir, "ca.names"), "utf8"), "hub.local");
  assert.throws(() => ensureHubTls(dir, { ip: "10.0.0.5", dns: "other.local" }), /HUB_CA_NAME_CHANGED/);
  assert.throws(() => ensureHubTls(dir, { ip: "10.0.0.5" }), /HUB_CA_NAME_CHANGED/);
  const ipOnly = mkdtempSync(join(tmpdir(), "hub-tls-names-ip-"));
  t.after(() => rmSync(ipOnly, { recursive: true, force: true }));
  const bare = ensureHubTls(ipOnly, { ip: "192.168.1.9" });
  assert.match(execFileSync("openssl", ["x509", "-noout", "-text"], { input: bare.caPem }).toString(), /DNS:invalid/);
  assert.throws(() => ensureHubTls(ipOnly, { ip: "192.168.1.9", dns: "hub.local" }), /HUB_CA_NAME_CHANGED/);
});

test("directory is made private before keys exist", (t) => {
  const dir = join(tmpdir(), `hub-tls-priv-${Date.now()}`);
  mkdirSync(dir, { mode: 0o755 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  ensureHubTls(dir, { ip: "10.0.0.5" });
  assert.equal(statSync(dir).mode & 0o777, 0o700, "directory mode is 0o700");
});

test("stale leaf is reissued after CA regeneration", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-tls-regen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = ensureHubTls(dir, { ip: "10.0.0.5" });
  const firstFp = first.fingerprint;
  rmSync(join(dir, "ca.pem"));
  rmSync(join(dir, "ca.key"));
  const second = ensureHubTls(dir, { ip: "10.0.0.5" });
  assert.notEqual(second.fingerprint, firstFp, "CA fingerprint differs after regeneration");
  const secondCa = new X509Certificate(second.caPem);
  const secondLeaf = new X509Certificate(second.certPem);
  assert.ok(secondLeaf.verify(secondCa.publicKey), "new leaf verifies against new CA");
});
