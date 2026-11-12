# U42 review attempt 2 (same independent reviewer, fix commit only: 4a6d5e1..8e241f7)

Verdict: Ready (Critical 0, Important 0, Minor 1).

Checked:
- Important 1 fixed: the test Hub keeps idle connections 60 s; `closeIdleAfter(50)` after the control (Node reads the value per answer). Repo test 3/3 pass; pooled hubCall injected into uploadLink 3/3 `read ECONNRESET`; 80 ms and 300 ms stalls after the first answer pass; 300 ms stall plus pooled call still fails with `read ECONNRESET` (the change does not hide the bug).
- Minor 4 fixed: `uploadCall` forwards options, forces only `keepAlive: false` (upload.ts:418-419); retiredMac (:612) still uses it; tsc exit 0.
- Minor 2 fixed: 5 calls per upload, 6 after a 409 on open — matches runUpload.
- Minor 5 fixed: the risk is a blocked loop or timers ≥2 s late, not a long async wait; matches async `runCommand`.
- hub-upload-office + team-upload-link 6/6; no internal names in added lines.

Minor 1 (not blocking): learning doc lines 85-93 still show the old one-line `uploadCall`, and four line references are off by one (upload.ts 418-420 → 418-421, retiredMac 608-611 → 609-612, hubFailure :460 → :461). Owner's decision: fix it in the post-G4 delivery commit, outside kit review/verify (doc-only; precedent U33), and say so in STATUS and the G4 record.
Kept by choice: Minor 3 (one connection per call is the stated property).
Not checked by the reviewer: full npm test; behaviour at real load ~20.
