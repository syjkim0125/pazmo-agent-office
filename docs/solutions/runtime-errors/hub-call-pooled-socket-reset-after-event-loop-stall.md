---
title: "Give each upload Hub call its own connection: a pooled keep-alive one can be reset after a busy pause"
date: "2026-11-11"
category: runtime-errors
module: "Team upload Hub client (hubCall in src/runtime/hub-link.ts, runUpload in src/team/upload.ts, LAN TLS Hub in src/hub/server.ts)"
problem_type: runtime_error
component: tooling
severity: medium
symptoms:
  - "tests/hub-upload-office.test.mjs 'upload again after a push failure resumes' failed now and then, only in a full npm test at machine load ~20 (twice during U40); the file alone passed 5/5"
  - "The second runUpload threw HUB_UNREACHABLE 'Hub에 닿지 못했습니다(read ECONNRESET)' on its first Hub call, GET /api/link/story/projects"
  - "The failing request was written onto a pooled socket the Hub destroyed with the request unread (RST)"
root_cause: async_timing
resolution_type: code_fix
tags: [econnreset, keep-alive, https-agent, hub-call, hub-link, upload, event-loop-block, flaky-test, tls-hub]
---

# Give each upload Hub call its own connection: a pooled keep-alive one can be reset after a busy pause

## Problem
`pazmo-office team upload` talks to the Hub in 5 calls (projects, upload, story, upload-bases, open; up to 7 with a second story read after a 409 or the `retiredMac` check after a 401), with git work (fetch, push) between them. Every call went through `hubCall` (`src/runtime/hub-link.ts:70`), which used Node's pooled global HTTPS agent (keep-alive on). A pooled connection that sits idle can be closed by the Hub, and the next call written to it fails.

The LAN Hub keeps Node's server defaults (`src/hub/server.ts:529-534`: only `kind === "proxy"` raises `keepAliveTimeout` to 65_000). In Node v24.19.0 that is `keepAliveTimeout` 5000 plus `keepAliveTimeoutBuffer` 1000, so the Hub closes an idle connection at 6 s, not 5 s. The client agent drops its own pooled socket earlier: per Node's agent implementation it lowers the socket timeout to the server's `Keep-Alive: timeout=5` hint minus 1 s, so 4 s (not measured here; observed only that a server hint under 2 s is not pooled at all). Normally the client wins the race. The failure needs the client's timer to not run.

## Symptoms
- "upload again after a push failure resumes" (`tests/hub-upload-office.test.mjs`, around line 297) failed twice in full `npm test` runs at load ~18 to 22, while building U40 (PR syjkim0125/pazmo-agent-office#83).
- The error came from the second upload's first call, `GET /api/link/story/projects`, mapped by `hubFailure` (`src/team/upload.ts:460`): `HUB_UNREACHABLE` "Hub에 닿지 못했습니다(read ECONNRESET). 네트워크를 확인한 뒤 같은 명령을 다시 실행하세요."
- Alone, the file passed 5/5 every time. Nothing in `src/team`, `src/hub/link-api.ts` or the TLS server had changed.

## What Didn't Work
- **Blaming "the Hub's 5 s keep-alive".** The first reviewer reading said that. The real close is at 6 s. A reproduction with a 5.5 s block passed (server closes at 6 s, not 5).
- **A repro that blocked right after a `setTimeout`.** It passed even at 8 s. The block ran inside the timers phase, so the poll phase read the request and refreshed the server's timer before the overdue timer fired. The block must start outside the timers phase, as it does after a child process exits.
- **A repro whose first call got a 401.** It did not show whether the second call reused the connection, so it proved nothing. Every later repro logged `req.reusedSocket`.
- **Rerunning the suite.** The flake only shows under load; the isolated file never failed.

## Solution
Hub and client share one process in the test. Between the two uploads the test runs 19 synchronous git commands (2 in `w.remote`, 10 in `w.clones`, 7 in `commit()`), each an `execFileSync` (`tests/git-fixture.mjs:26-27, 82-83`).

Reproduction (scratch scripts, not committed): one link call, then `await setImmediate` and an `Atomics.wait` block, then a second call.

| Setup | Result |
| --- | --- |
| Block 8 s | `read ECONNRESET` 2/2 (`reusedSocket` true) |
| Block 6.5 s | `read ECONNRESET` |
| Block 5.5 s | OK |
| 8 s block, server `keepAliveTimeout` 65 s | OK (the Hub's idle close is the trigger) |
| 8 s block, non-keep-alive client agent | OK |
| Real flaky test plus an extra 6.5 s `Atomics.wait` in its synchronous window | exact `HUB_UNREACHABLE` message before the fix; passes after, at 6.5 s and 9 s |

Measured in an isolated run at load 11 to 15, the idle time between the two uploads was 1.2 to 1.6 s, of which 0.6 to 0.8 s was synchronous. Reaching the 4 to 6 s window in a full run at load ~20 is inferred (a 4 to 5 times slowdown of process spawns), not measured. The failing U40 run is consistent with it: the test took 17.2 s at load 19.75, against 3.9 s alone at load ~9 (session history).

Fix: an opt-in `{ keepAlive: false }` on `hubCall`, backed by one module-level agent, and every upload Hub call routed through it.

Before (`src/runtime/hub-link.ts`):

```ts
export function hubCall(cfg: Target, method: "GET" | "POST", path: string, body?: unknown, protocol: string = HUB_PROTOCOL): Promise<any> {
  ...
    const req = request(new URL(path, cfg.hub), {
      method,
      rejectUnauthorized: true,
```

After (`src/runtime/hub-link.ts:64, 70-88`):

```ts
const oneShot = new Agent({ keepAlive: false });
export function hubCall(
  cfg: Target, method: "GET" | "POST", path: string, body?: unknown,
  protocol: string = HUB_PROTOCOL,
  { keepAlive = true }: { keepAlive?: boolean } = {},
): Promise<any> {
  ...
    const req = request(new URL(path, cfg.hub), {
      method,
      ...(keepAlive ? {} : { agent: oneShot }),
```

Before (`src/team/upload.ts`):

```ts
export function uploadLink(cfg: HubLinkConfig, call: typeof hubCall = hubCall): UploadLink {
```

After (`src/team/upload.ts:418-420`):

```ts
const uploadCall: typeof hubCall = (cfg, method, path, body, protocol) => hubCall(cfg, method, path, body, protocol, { keepAlive: false });

export function uploadLink(cfg: HubLinkConfig, call: typeof hubCall = uploadCall): UploadLink {
```

`retiredMac` (`src/team/upload.ts:608-611`) also uses `uploadCall`, so no upload path reaches the pooled agent. Default behavior of `hubCall` is unchanged.

Rejected alternatives:
- **Retry once on `req.reusedSocket && ECONNRESET`** (Node's documented pattern). It would replay a POST once. The upload routes are built to resume idempotently, but a fresh connection avoids any replay, and it also covers EPIPE and silently dropped connections that a reset-only retry misses.
- **Raise the LAN Hub's `keepAliveTimeout`** like the proxy mode. It changes the server and only narrows the window.
- **Make the test's git helpers async.** It hides a client fragility the CLI also has whenever its timers run late.

Cost: one TLS connection per upload call (5 to 7 per upload); the agent still caches TLS sessions.

## Why This Works
Node's client agent reuses a free pooled socket if it is not yet destroyed, and writes the request to it synchronously. If the process was blocked (synchronous git) so that the connection went from under 4 s idle to over 6 s idle without the event loop running, the client's 4 s timer never ran. The request is written to the pooled socket. The event loop then enters the timers phase, and the Hub's overdue idle timer destroys its side with the request unread. The kernel answers the unread data with RST, and the client sees `read ECONNRESET`.

With `keepAlive: false` the agent never pools a socket (it asks the server to close the connection after the answer; the header itself was not inspected here), so no call is ever written to a connection the Hub may have closed as idle. There is no idle window left to race.

## Prevention
- A CLI whose Hub calls are separated by long waits (git, network) should not depend on a pooled keep-alive connection. Use `{ keepAlive: false }` for such flows.
- Tests that host the server in the same process as the client share its event loop. Synchronous helpers (`execFileSync`) can turn a 2 s timing margin into a reset under load.
- Other link clients still use the pooled global agent: the 5 s hub sync loop, the outgoing-request gateway (`hub-outgoing.ts`), the claim scheduler's story-link, plan-link, mac and pair. This is unchanged and a possible follow-up. A failed tick there is retried on the next tick (not separately verified).
- Test technique, `tests/team-upload-link.test.mjs`:
  - A TLS server advertises `keep-alive: timeout=5` but closes idle connections after 50 ms (`keepAliveTimeout = 50`, `keepAliveTimeoutBuffer = 0`), keeping the advertised hint so the client still pools.
  - A control first shows two default `hubCall`s in a row share one connection.
  - Five upload-link calls (projects, upload, story, uploadBases, open) each run, followed by `await setImmediate` plus a 200 ms `Atomics.wait`. Blocking after `setImmediate` puts the block outside the timers phase.
  - It asserts every call reached the Hub once and that each call opened its own connection.
  - RED 5/5 `read ECONNRESET` before the fix, GREEN 5/5 after. Related test files 110/110, typecheck exit 0.
- To reproduce any keep-alive race: block outside the timers phase, and shorten the server's idle close while keeping the advertised hint. A block inside a timer callback will not reproduce it.

## Related
- Fix unit: U42; PR pending. The flake was first seen building U40 (PR syjkim0125/pazmo-agent-office#83).
- `docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md`: another race that only shows when the test process's own event loop is starved under load.
- `docs/solutions/test-failures/claw-startup-wait-is-cpu-bound-under-load.md`: a full-run-only failure at load 20–30 with a different cause; measure before raising waits.
- `docs/solutions/test-failures/rewrite-a-fake-cli-script-not-its-executed-binary.md`: another test that passed alone and failed only under load; record the raw failure before blaming slowness.
- `docs/solutions/integration-issues/report-changed-hub-certificate-on-cert-signature-failure.md`: how `hubCall` maps TLS failures; the new option does not change that mapping.
