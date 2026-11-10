import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureHubTls } from "../src/hub/tls.ts";
import { newPlanHolder, planFailure, planLink, planStateOf } from "../src/team/plan-link.ts";

/** A fake `hubCall` that records its arguments and answers `{ lease: null }` / `{ ok: true }`. */
function fakeCall() {
  const calls = [];
  const call = async (...args) => {
    calls.push(args);
    return args[2].endsWith("/plan-next") ? { lease: null } : { ok: true };
  };
  return { call, calls };
}
const cfg = { hub: "https://hub.example.com", caPem: null, fingerprint: null, token: "t", memberId: "m", memberName: "PL", repoId: "r" };
const HOLDER = "0123456789abcdef".repeat(2);
const HEX32 = /^[a-f0-9]{32}$/;
const SHA = "1".repeat(40);

test("planLink sends its Office's holder id on plan-next, plan-heartbeat and plan-result, and bases only on a heartbeat that carries them; the Story routes are as before", async () => {
  const { call, calls } = fakeCall();
  const link = planLink(cfg, call, HOLDER);
  await link.next();
  await link.heartbeat("p", "l");
  await link.heartbeat("p", "l", { r: SHA });
  await link.result("p", "l", 3, { kind: "failed", reason: "x" });
  assert.deepEqual(
    calls.map(([, method, path, body]) => [method, path, body]),
    [
      ["POST", "/api/link/story/plan-next", { holder: HOLDER }],
      ["POST", "/api/link/story/plan-heartbeat", { planId: "p", leaseId: "l", holder: HOLDER }],
      ["POST", "/api/link/story/plan-heartbeat", { planId: "p", leaseId: "l", holder: HOLDER, bases: { r: SHA } }],
      ["POST", "/api/link/story/plan-result", { planId: "p", leaseId: "l", revision: 3, result: { kind: "failed", reason: "x" }, holder: HOLDER }],
    ],
  );
  await link.cancel("s-1");
  assert.deepEqual(calls.at(-1).slice(1, 4), ["POST", "/api/link/story/cancel", { storyId: "s-1" }], "no holder on the Story routes");
});

test("newPlanHolder is 16 random bytes in lowercase hex; planLinks made without one share this process's; a holder that is not 32 hex characters is refused before any call", () => {
  const a = newPlanHolder();
  const b = newPlanHolder();
  assert.match(a, HEX32);
  assert.notEqual(a, b);
  const one = fakeCall();
  const two = fakeCall();
  planLink(cfg, one.call).next();
  planLink(cfg, two.call).next();
  assert.match(one.calls[0][3].holder, HEX32);
  assert.equal(one.calls[0][3].holder, two.calls[0][3].holder, "one id per process start");
  for (const bad of ["", "A".repeat(32), "a".repeat(31), "a".repeat(33), "g".repeat(32)])
    assert.throws(() => planLink(cfg, fakeCall().call, bad), /holder/i, JSON.stringify(bad));
});

test("over TLS, a 409 STATE answer carries the plan state: planFailure says state and planStateOf names it (cancelled, failed); none without it or for another code", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "plan-link-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tls = ensureHubTls(join(dir, "tls"), { ip: "127.0.0.1" });
  let answer = { status: 409, body: { error: "STATE", message: "취소된 기획입니다.", state: "cancelled" } };
  const seen = [];
  const server = createServer({ cert: tls.certPem, key: tls.keyPem }, (req, res) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      seen.push({ path: req.url, body: JSON.parse(text) });
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const link = planLink(
    { ...cfg, hub: `https://127.0.0.1:${server.address().port}`, caPem: tls.caPem, fingerprint: tls.fingerprint },
    undefined,
    HOLDER,
  );
  const refusal = () => link.heartbeat("p", "l").then(() => assert.fail("expected a refusal"), (e) => e);

  let e = await refusal();
  assert.deepEqual([planFailure(e), planStateOf(e)], ["state", "cancelled"]);
  assert.deepEqual(seen[0], { path: "/api/link/story/plan-heartbeat", body: { planId: "p", leaseId: "l", holder: HOLDER } });
  answer = { status: 409, body: { error: "STATE", message: "멈춘 기획입니다.", state: "failed" } };
  e = await refusal();
  assert.deepEqual([planFailure(e), planStateOf(e)], ["state", "failed"]);
  answer = { status: 409, body: { error: "STATE", message: "옛 Hub" } };
  e = await refusal();
  assert.deepEqual([planFailure(e), planStateOf(e)], ["state", null]);
  answer = { status: 409, body: { error: "NOT_YOURS", message: "다른 Office", state: "cancelled" } };
  e = await refusal();
  assert.deepEqual([planFailure(e), planStateOf(e)], ["not-yours", null]);
});
