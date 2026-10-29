---
title: A same-name hub CA made without key identifiers failed with a raw certificate signature failure instead of the reconnect guidance
date: "2026-10-28"
category: integration-issues
module: Team hub link TLS pinning (hub-link)
problem_type: integration_issue
component: authentication
related_components: [tooling, testing_framework]
severity: medium
symptoms:
  - "tests/hub-link.test.mjs \"a Bearer token goes only to the pinned CA's hub\" failed in the full suite (942/943, recorded in docs/verification/2026-10-27-lean-rerun.md) whenever macOS /usr/bin/openssl (LibreSSL 3.3.6) came before Homebrew OpenSSL 3.x on PATH, and passed 25/25 with Homebrew first"
  - "hubCall to a second test hub rejected with Node's certificate signature failure (code CERT_SIGNATURE_FAILURE) instead of HUB_TLS_UNTRUSTED"
  - "The reconnect message (허브 인증서가 연결할 때와 다릅니다. 허브에서 새 연결 명령을 받아 다시 연결하세요.) was not shown, because hubCall passed the raw TLS error through"
  - "A member still pinned to the old CA of a hub whose LibreSSL-made CA was regenerated would see the same raw error instead of the guidance; the Bearer token is never sent because the handshake fails first"
root_cause: logic_error
resolution_type: code_fix
tags: [hub-tls, certificate-pinning, openssl, libressl, cert-signature-failure, key-identifiers, hub-link, tls-untrusted-codes]
---

# A same-name hub CA made without key identifiers failed with a raw certificate signature failure instead of the reconnect guidance

## Problem
Every hub CA has the same subject, `/CN=Pazmo Team Hub CA` (`src/hub/tls.ts:55-59`). The CA and server certificates are made by whatever `openssl` is first on PATH (`ensureHubTls(dir, names, openssl = "openssl")`, `src/hub/tls.ts:25`, called from `src/hub/run.ts:60`). On a Mac without Homebrew that is `/usr/bin/openssl`, LibreSSL 3.3.6, which writes no key identifiers into these certificates. So when a member pinned to one such CA reached a hub with a different CA, Node failed the handshake with `CERT_SIGNATURE_FAILURE`. That code was not in `TLS_UNTRUSTED_CODES` (`src/runtime/hub-link.ts:45`), so the member saw OpenSSL's raw text instead of the reconnect guidance.

This applies only to a LAN hub that makes its own CA. A hub behind a proxy (Fusion mode) makes no CA and members verify it through system trust (`docs/understanding/team-hub-fusion-decision.md`).

The real-world trigger is a hub on a Mac without Homebrew whose CA gets regenerated. `ensureHubTls` tells the admin to delete the tls directory when the CA expires within 30 days (`HUB_CA_EXPIRING`, `src/hub/tls.ts:72`) or its DNS name changed (`HUB_CA_NAME_CHANGED`, `src/hub/tls.ts:67`). Members still pinned to the old CA then got the raw error.

The Bearer token was never exposed: the TLS handshake fails before any request header is sent. Only the user-facing guidance was wrong.

## Symptoms
- With `/usr/bin/openssl` (LibreSSL 3.3.6) before Homebrew OpenSSL 3.6.3 on PATH, the full suite was 942/943. With Homebrew OpenSSL first, `tests/hub-link.test.mjs` was 25/25. The first record of this is the environment note in `docs/verification/2026-10-27-lean-rerun.md`.
- The failing test was "a Bearer token goes only to the pinned CA's hub" (`tests/hub-link.test.mjs:175`). Its call to a second test hub (`startTestHub` uses the default openssl, `tests/hub-fixture.mjs:15`) rejected with `certificate signature failure`. It should have been `HUB_TLS_UNTRUSTED` with "허브 인증서가 연결할 때와 다릅니다. 허브에서 새 연결 명령을 받아 다시 연결하세요." (`src/runtime/hub-link.ts:115`).
- A scratch repro made two hubs, A and B, with each openssl and sent a Node https request to B with `ca: [A.caPem]`:
  - **LibreSSL:** the CA and leaf have no subjectKeyIdentifier or authorityKeyIdentifier. Only basicConstraints, keyUsage and nameConstraints are present. Error: `CERT_SIGNATURE_FAILURE`.
  - **OpenSSL 3.6.3:** the CA has SKID = AKID, and the leaf's AKID points to its own CA. Error: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, which was already mapped.

## What Didn't Work
- **Reading it as load flakiness or as caused by the change under test** (session history). Two earlier sessions met this failure while verifying unrelated changes. One ran the test alone on the unchanged baseline, saw the same failure there and set it aside as pre-existing. Unlike the load-related failures of the same days (startup and git timeouts that cleared on a solo run), it is deterministic and follows PATH order.
- **Putting Homebrew OpenSSL first on PATH** (session history). This made the suite pass (943/943 and 947/947 in those sessions) but only hid the environment dependence. It also left the member-facing guidance gap in place.
- **The first full run in the fresh worktree was 913/944.** Thirty-one Office-start tests failed with `NOT_BUILT` because the Office UI had not been built. This had nothing to do with the TLS failure; see Related Issues. After `npm run build:office` the only remaining failure was the one above.
- **Giving each hub CA a unique name** was considered and rejected. It has the same limit as the next item: CAs that already exist keep the shared name. It also changes the CA name that members see.
- **Adding key identifiers in `tls.ts`.** This adds `-addext subjectKeyIdentifier=hash -addext authorityKeyIdentifier=keyid:always` to the CA `req -x509` (`src/hub/tls.ts:55`), and `subjectKeyIdentifier=hash` and `authorityKeyIdentifier=keyid` to `server.ext` (`src/hub/tls.ts:92`). It was verified with LibreSSL 3.3.6: pinned A → hub B then gives `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. It was rejected because it only helps CAs made after the change. A member pinned to an existing LibreSSL CA (no SKID) would still get `CERT_SIGNATURE_FAILURE`, because OpenSSL skips the keyid comparison when the candidate issuer has no SKID. That last point is reasoning from OpenSSL's issuer check and was not tested.

## Solution
Map `CERT_SIGNATURE_FAILURE` to `HUB_TLS_UNTRUSTED` like the other untrusted-certificate codes. The fix is in PR #39 (open, not yet merged as of this writing).

```ts
// before (src/runtime/hub-link.ts)
export const TLS_UNTRUSTED_CODES: ReadonlySet<string> = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED", "CERT_REJECTED", "HOSTNAME_MISMATCH", "ERR_TLS_CERT_ALTNAME_INVALID",
]);
```

```ts
// after (src/runtime/hub-link.ts:45-51)
export const TLS_UNTRUSTED_CODES: ReadonlySet<string> = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED", "CERT_REJECTED", "HOSTNAME_MISMATCH", "ERR_TLS_CERT_ALTNAME_INVALID",
  // Another hub whose CA has the pinned CA's name but no key identifiers (as LibreSSL makes them).
  "CERT_SIGNATURE_FAILURE",
]);
```

The `req.on("error")` handler (`src/runtime/hub-link.ts:112-117`) already picks the message by trust mode. A pinned link gets the reconnect message; system trust gets the `--fingerprint` hint. So the new code needs no other change.

The new test, "a hub certificate that names the pinned CA but fails its signature is reported as a changed certificate" (`tests/hub-link.test.mjs:184`), produces `CERT_SIGNATURE_FAILURE` under either openssl (see Prevention).

TDD evidence:
- **Before the fix:** the file was 24/26 with LibreSSL first (the old and new tests failed) and 25/26 with OpenSSL first (the new test failed with `certificate signature failure`).
- **After the fix:** 26/26 with both.
- **Full suite:** `npm test`, after `npm run build:office` and a rebase onto main, was 950/950 with LibreSSL first and 950/950 with OpenSSL first, run one at a time. `npm run typecheck` exited 0.

## Why This Works
The repro shows the split. Key identifiers that differ make Node report no issuer; without key identifiers the pinned CA is taken as the issuer of the other hub's leaf, because all hub CAs share one name, and the chain then fails on the signature. This matches OpenSSL's issuer check, which matches on the issuer name and compares key identifiers only when they are present.

Both errors mean the same thing to a pinned member: this hub's certificate is not the one they connected to. They should get the same guidance. The fix does not depend on how a CA was made, so it also covers members pinned to CAs that already exist.

## Prevention
- **Test TLS error mapping with a forged signature, not with a second generated CA.** Take the hub's own server certificate, flip the last byte of its DER (the end of the signature), re-wrap it as PEM and serve it with the real key from a throwaway `https.createServer` on port 0. Then connect with that hub's CA pinned. This gave `CERT_SIGNATURE_FAILURE` 3/3 times under each openssl, so the test does not depend on PATH:
  ```js
  const der = Buffer.from(new X509Certificate(tls.certPem).raw);
  der[der.length - 1] ^= 1; // the last byte of the signature
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const forged = createServer({ cert, key: tls.keyPem }, (_req, res) => res.end("{}"));
  ```
  A test that reaches an error code only because of which certificate generator happened to run passes or fails with PATH. Build the exact failure instead.
- **When a TLS test passes on one machine and fails on another, compare `openssl version` and the certificates' extensions first.** `openssl x509 -noout -text` shows whether the key identifiers are there. LibreSSL and OpenSSL 3 already differ in key encoding here; see the comment at `src/hub/tls.ts:40-41`.
- **Map the error codes for a meaning, not for one reproduction.** "This is not the certificate you pinned" can arrive as no issuer, a self-signed chain, a hostname mismatch or a bad signature, depending on how the certificates were built. The code-list test "TLS failures that mean an untrusted hub are all reported as HUB_TLS_UNTRUSTED" in `tests/hub-link.test.mjs` checks the set itself; the forged-signature test checks this code end to end.

## Related Issues
- [fresh-worktree-tests-fail-without-office-ui-build.md](../test-failures/fresh-worktree-tests-fail-without-office-ui-build.md) explains the cause of the 31 `NOT_BUILT` failures in the first fresh-worktree run.
- [classify-review-runner-failure-as-unknown.md](classify-review-runner-failure-as-unknown.md) has the same shape in another module: a classifier missing one input class, so an infrastructure condition reached the user as the wrong outcome.
- `docs/verification/2026-10-27-lean-rerun.md` first recorded this failure as a follow-up. It is hash-pinned graph evidence, so it stays as written (see [keep-workflow-graph-evidence-files-immutable.md](../workflow-issues/keep-workflow-graph-evidence-files-immutable.md)); this doc closes that follow-up.
