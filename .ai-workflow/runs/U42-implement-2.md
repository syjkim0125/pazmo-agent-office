# U42 implement attempt 2 (after review 1)

- Commit `8e241f7` on top of `4a6d5e1`.
- Important 1 (control can flake under load): the test Hub starts with keepAliveTimeout 60 000 and `closeIdleAfter(50)` is called after the control. Reproduced first: scratch copy with an 80 ms stall after the first answer failed the old control with `read ECONNRESET` (20 ms passed); with the change, 80 ms and 300 ms stalls pass.
- RED still holds: scratch copy injecting the pooled `hubCall` into `uploadLink` fails 3/3 with `read ECONNRESET`.
- Minor 4: `uploadCall` forwards hubCall's options and forces only `keepAlive: false` (src/team/upload.ts).
- Minor 2 and 5: STATUS and the learning doc say 5 calls per upload (6 after a 409 on open); the risk is a blocked loop or timers ≥2 s late, not a long async wait, so production exposure is small.
- Minor 3 kept on purpose: one connection per call is the fix's stated property.
- Related files (8): 110/110. `npm run typecheck` exit 0. Full suite runs next in kit verify (the earlier full `npm test` at `4a6d5e1` was 1862/1862).
