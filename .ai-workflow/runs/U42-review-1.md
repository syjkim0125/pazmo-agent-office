# U42 review attempt 1 (independent reviewer, 1 agent — small change; diff a3ef064..4a6d5e1)

Verdict: Not ready (Important 1). Code fix judged correct.

Evidence the reviewer gathered:
- Every upload Hub call goes through the non-pooling agent: uploadLink default `uploadCall` (upload.ts:418-420), runUpload (:517), retiredMac (:611); openWithBases only calls the link's closures; git via async runCommand. No other hubCall caller passes a 6th argument (hub-link.ts:206, :255; hub-outgoing.ts:67, :123; story-link.ts:45; plan-link.ts:56; mac.ts:130).
- TLS trust unchanged for both agents (scratch, with NODE_TLS_REJECT_UNAUTHORIZED=0): pin A vs hub A OK; hub B with pin A HUB_TLS_UNTRUSTED; system trust vs self-signed HUB_TLS_UNTRUSTED; same host:port re-served by B after a cached A session: pin A still HUB_TLS_UNTRUSTED, pin B OK; 5 MB answer HUB_RESPONSE_TOO_LARGE; hanging server HUB_TIMEOUT at 15013 ms for both. oneShot resumes TLS sessions per pinned CA and sends Connection: close.
- Cause reproduced independently: scratch copy of the flaky test with a 6.5 s Atomics.wait before the second upload fails with the exact HUB_UNREACHABLE message on pre-fix upload.ts, passes on the repo code.
- Pre-fix pooled hubCall injected into uploadLink fails the new test 3/3 with read ECONNRESET. hub-upload-office + team-upload-link 6/6, tsc exit 0.

Findings:
- Important 1 — tests/team-upload-link.test.mjs:41-42, :66-68: the 50 ms idle close also applies to the control's two back-to-back hubCalls; a ≥50 ms stall between the first answer and reading the second request fails the control with read ECONNRESET (shown with 60/80 ms injected stalls). Fix: start with keepAliveTimeout 60_000, switch to 50 after the control.
- Minor 2 — STATUS U42 and the learning doc say 5–7 calls/connections; the most is 6 (5 + story re-read after a 409); the retiredMac path makes 2 in total.
- Minor 3 — test asserts connections === calls (how, not only what). Kept by the author: one connection per call is the fix's stated property.
- Minor 4 — `uploadCall` is typed `typeof hubCall` but silently drops a 6th argument.
- Minor 5 — learning doc's Prevention says long git/network waits are the risk; long async waits are safe (the client's 4 s timer runs); the risk is a blocked loop or late timers. Production CLI runs git async, so production exposure is small.

Not checked by the reviewer: full npm test, flake rate at real load ~20, whether failed runs really crossed the 4–6 s window, the Hub behind the company router.
