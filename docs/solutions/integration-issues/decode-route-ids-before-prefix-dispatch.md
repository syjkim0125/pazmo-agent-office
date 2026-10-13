---
title: Decode route ids before dispatching on an id prefix
date: "2026-10-13"
category: integration-issues
module: Office host decision reply route (team hub outgoing)
problem_type: integration_issue
component: service_object
related_components: [testing_framework]
symptoms:
  - "An answer to a team hub item (id hubout:<requestId>:<decisionId>) in Office Decisions never reached the hub gateway"
  - "The host matched req.path, where the id arrived as hubout%3A… and failed the startsWith(\"hubout:\") check"
  - "Gateway and native-office unit tests passed because they called reply() with the raw id, not through HTTP"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [express, req-path, url-encoding, decodeuricomponent, decision-inbox, team-hub, hubout, csrf]
---

# Decode route ids before dispatching on an id prefix

## Problem
Team hub phase 2 lists the other side's PM questions and scope Gate in the sender's Office Decisions under ids of the form `hubout:<requestId>:<decisionId>`. Office routes a reply to the hub gateway when the id starts with `hubout:` (`src/runtime/native-office.ts:911`). Answers sent from the screen never took that branch, so the hub never received them.

## Symptoms
- The screen sends the id through `encodeURIComponent` (`vendor/claw-empire/src/api/messaging-runtime-oauth.ts:84`), so the `:` arrives as `%3A`.
- The host reads the id with a regex over `req.path` (`vendor/claw-empire/server/pazmo/host.ts:143`). Express leaves `req.path` percent-encoded, so the id was `hubout%3A…`, the prefix check failed and the reply fell through to the native path.
- Native Decisions ids are UUIDs with no reserved characters, so the same encode/no-decode mismatch had been invisible since the route was written.
- Unit tests for the gateway and `native-office` passed: they call `reply("hubout:…")` directly and never pass through HTTP. The Task 3 reviewer confirmed the failure with a probe against the host (session finding, recorded in the SDD ledger).

## What Didn't Work
- Relying on the layer tests. Every layer below the host route was correct in isolation; the defect lived only at the HTTP boundary, which no test crossed with a reserved character in the id.

## Solution
Decode the captured segment once, at the route that captured it, before any prefix dispatch or permission check. Treat a malformed escape as a stale item rather than a 500:

```ts
const reply = req.path.match(/^\/decision-inbox\/([^/]+)\/reply$/);
if (reply && req.method === "POST") {
  // The UI sends encodeURIComponent(id) and Express leaves req.path encoded.
  let id: string;
  try {
    id = decodeURIComponent(reply[1]);
  } catch {
    return res.status(409).json({ error: "STALE_APPROVAL", message: "이미 처리됐거나 변경된 요청입니다." });
  }
  // Answering a hub gate acts in the member's name on the team hub.
  if (id.startsWith("hubout:") && !hasValidCsrfToken(req)) return res.status(403).json({ error: "csrf_token_invalid" });
  return res.json(await office.reply(id, Number(req.body?.option_number), req.body?.note ?? ""));
}
```

The host test (`tests/claw-host-hub.test.mjs`) now posts to `/api/decision-inbox/${encodeURIComponent(hubId)}/reply`. It asserts that the bridge receives the decoded `hubout:…` id, that the hub branch requires CSRF, that a plain native id still works without CSRF, and that a malformed escape (`%E0%A4%A`) returns 409 `STALE_APPROVAL`.

## Why This Works
Express decodes `req.params` for routes declared with `:param`, but `req.path` is the raw path. A hand-written regex over `req.path` therefore sees exactly what the client encoded. Decoding at the capture site restores the id the screen meant. The prefix dispatch and the CSRF check then judge the same string the rest of Office uses. Decoding before the CSRF check also matters: an encoded `hubout%3A` id must not slip past the check that guards acting in the member's name on the hub.

## Prevention
- When a route captures an id from `req.path` with a regex, decode it at that point. Alternatively, declare the route with an Express `:param` so Express decodes it. Never compare raw path segments against a prefix.
- When ids gain a new shape with reserved characters (`:`, `/`, `%`, spaces, non-ASCII), add at least one test that sends such an id through the real HTTP route with the same encoding the screen uses. Layer tests that call the handler directly cannot catch this.
- Put permission checks that depend on the id's prefix after decoding, and test the encoded form against them.

## Related Issues
- Plan: `docs/plans/2026-10-13-1200-feat-team-hub-office-send-plan.md` (Task 3). Verification: `docs/verification/2026-10-13-team-hub-office-send.md`.
