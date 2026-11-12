import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureHubTls } from "../src/hub/tls.ts";
import { hubCall } from "../src/runtime/hub-link.ts";
import { uploadLink } from "../src/team/upload.ts";

// The upload command's Hub calls over real TLS connections (U42). Between its calls the command waits on git. A LAN Hub
// (Node's defaults) closes a connection that sat idle for 5 s plus 1 s; Node's client drops a pooled one after 4 s,
// but only when its timer gets to run. When this process was busy past the Hub's close, the next call was written to
// the closed connection and failed with `read ECONNRESET` (HUB_UNREACHABLE).

const REPLIES = {
  "GET /api/link/story/projects": { projects: [] },
  "POST /api/link/story/upload": { storyId: "s1", number: 1, state: "draft", already: false, bases: {} },
  "GET /api/link/story/story?id=s1": { state: "draft", branches: [] },
  "POST /api/link/story/upload-bases": { bases: { "r-be": "a".repeat(40) } },
  "POST /api/link/story/open": { state: "open" },
};

/**
 * A TLS Hub that answers the upload routes and, like a LAN Hub, offers a 5 s keep-alive. It keeps idle connections for
 * a minute until `closeIdleAfter(ms)` shortens that (the real Hub's 6 s, shortened); each answer reads the value anew.
 * It counts the connections it accepted and the requests it answered.
 */
async function idleClosingHub(t) {
  const dir = mkdtempSync(join(tmpdir(), "upload-link-"));
  const tls = ensureHubTls(join(dir, "tls"), { ip: "127.0.0.1" });
  const seen = { connections: 0, requests: [] };
  const server = createServer({ key: tls.keyPem, cert: tls.certPem }, (req, res) => {
    req.resume();
    req.on("end", () => {
      const route = `${req.method} ${req.url}`;
      seen.requests.push(route);
      res.writeHead(REPLIES[route] ? 200 : 404, { "content-type": "application/json", "keep-alive": "timeout=5" });
      res.end(JSON.stringify(REPLIES[route] ?? { error: "NOT_FOUND" }));
    });
  });
  server.keepAliveTimeout = 60_000;
  server.keepAliveTimeoutBuffer = 0;
  server.on("secureConnection", () => seen.connections++);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const cfg = { hub: `https://127.0.0.1:${server.address().port}`, caPem: tls.caPem, fingerprint: tls.fingerprint, token: "link-token" };
  return { cfg, seen, closeIdleAfter: (ms) => (server.keepAliveTimeout = ms) };
}

/**
 * Keeps this process busy for `ms`, as slow git does under load, past the Hub's idle close. It starts outside the timers
 * phase (as after a git process exits): the next call is written first, and the Hub's overdue idle timer runs before
 * the Hub reads it.
 */
async function busy(ms) {
  await new Promise((resolve) => setImmediate(resolve));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test("every upload call reaches the Hub even after the Hub closed an idle connection while this process was busy", async (t) => {
  const { cfg, seen, closeIdleAfter } = await idleClosingHub(t);
  // The Hub keeps a connection alive between calls that follow each other (while it keeps idle ones for a minute, so a
  // busy machine cannot close it between the two).
  await hubCall(cfg, "GET", "/api/link/story/projects", undefined, "3");
  await hubCall(cfg, "GET", "/api/link/story/projects", undefined, "3");
  assert.equal(seen.connections, 1, "two calls in a row share one connection");
  seen.connections = 0;
  seen.requests = [];
  closeIdleAfter(50);

  const link = uploadLink(cfg);
  const calls = [
    () => link.projects(),
    () => link.upload({ projectId: "p", title: "t", body: "b", risk: "normal", storyHash: "h", graph: { nodes: [], edges: [] }, storyVerify: [] }),
    () => link.story("s1"),
    () => link.uploadBases("s1", { "r-be": "a".repeat(40) }),
    () => link.open("s1"),
  ];
  for (const call of calls) {
    await call();
    await busy(200);
  }
  assert.deepEqual(seen.requests, Object.keys(REPLIES), "each call reached the Hub once");
  assert.equal(seen.connections, calls.length, "each upload call opened its own connection");
});
