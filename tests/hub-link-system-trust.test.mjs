import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestHub } from "./hub-fixture.mjs";

const execFileAsync = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
// The hub runs in this process, so the child must not block the event loop (async exec).
async function pairInChild({ hub, code, dataDir, extraCa, env: extraEnv = {} }) {
  const script = `
    import { pairOffice, readLinkConfig, hubCall } from ${JSON.stringify(ROOT + "src/runtime/hub-link.ts")};
    try {
      await pairOffice({ dataDir: ${JSON.stringify(dataDir)}, hub: ${JSON.stringify(hub)}, code: ${JSON.stringify(code)}, remote: "https://github.example.com/team/app-be" });
      const cfg = readLinkConfig(${JSON.stringify(dataDir)});
      const work = await hubCall(cfg, "GET", "/api/link/work");
      console.log(JSON.stringify({ ok: true, caPem: cfg.caPem, fingerprint: cfg.fingerprint, assignments: work.assignments.length }));
    } catch (e) { console.log(JSON.stringify({ ok: false, code: e.code ?? e.message, message: e.message })); }`;
  const env = { ...process.env, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}), ...extraEnv };
  if (!extraCa) delete env.NODE_EXTRA_CA_CERTS;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("without a fingerprint the Office trusts the system roots, stores no CA, and keeps working", async (t) => {
  const { store, tls, hub } = await startTestHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  const d = mkdtempSync(join(tmpdir(), "link-sys-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const ca = join(d, "ca.pem");
  writeFileSync(ca, tls.caPem);
  mkdirSync(join(d, "office")); // linkOffice creates the data dir; pairOffice expects it
  const r = await pairInChild({ hub: hub.url, code: store.createLinkCode(admin, repo), dataDir: join(d, "office"), extraCa: ca });
  assert.deepEqual(r, { ok: true, caPem: null, fingerprint: null, assignments: 0 });
});

test("a certificate the system does not trust is refused with a hint to pass the fingerprint", async (t) => {
  const { store, hub } = await startTestHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  const d = mkdtempSync(join(tmpdir(), "link-sys-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const r = await pairInChild({ hub: hub.url, code: store.createLinkCode(admin, repo), dataDir: join(d, "office") });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HUB_TLS_UNTRUSTED");
  assert.match(r.message, /--fingerprint/);
});

test("NODE_TLS_REJECT_UNAUTHORIZED=0 cannot turn verification off on the link path", async (t) => {
  const { store, hub } = await startTestHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  const d = mkdtempSync(join(tmpdir(), "link-sys-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(join(d, "office"));
  const r = await pairInChild({
    hub: hub.url, code: store.createLinkCode(admin, repo), dataDir: join(d, "office"),
    env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HUB_TLS_UNTRUSTED");
});
