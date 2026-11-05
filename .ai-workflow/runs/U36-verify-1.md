# U36 (Mac connect) verify, attempt 1

Tree `abc62f4` (snapshot `8825152e…`, the same before and after every check). Run with `graph.mjs verify` per docs/verification/kit-checks.md, node 24.19.0, no other test process running, load ~2–3.

| Check | Result | Evidence |
|---|---|---|
| tests-1of3 | `ℹ tests 395`, `ℹ pass 395`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (00:17:14–00:17:48Z) | `.ai-workflow/evidence/49c10ece-4d4c-45d6-b9aa-532dba7a6a29/243834d7-6937-4814-97e0-2c239499d8a9/` |
| tests-2of3 | `ℹ tests 600`, `ℹ pass 600`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (00:17:49–00:18:51Z) | `.ai-workflow/evidence/49c10ece-4d4c-45d6-b9aa-532dba7a6a29/b119a9e0-9a9e-4473-a401-82665c7af9f7/` |
| tests-3of3 | `ℹ tests 561`, `ℹ pass 561`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (00:18:52–00:19:56Z) | `.ai-workflow/evidence/49c10ece-4d4c-45d6-b9aa-532dba7a6a29/dadc014c-632a-4a85-a496-c728a525da7a/` |
| typecheck | exit 0 | `.ai-workflow/evidence/49c10ece-4d4c-45d6-b9aa-532dba7a6a29/c4bd3c70-ea5c-4e57-818e-90f0fec55b1e/` or `.ai-workflow/evidence/49c10ece-4d4c-45d6-b9aa-532dba7a6a29/d5b853fa-5d3b-4646-8293-1a5a39e4d198/` |
| story | exit 0 (shape and gate presence only) | as above |

Tests total: 395 + 600 + 561 = **1556/1556**, the same count as the full `npm test` on `9fc54f5` (code identical).

Secret scan of the evidence output: the words token/secret/password appear only in test names; no token values, only temporary folder paths.

Boundary (not proven by these checks): V19's real part — real `launchctl` (print, enable, kickstart, StartInterval, bootout), a real reboot and boot session id, a real install line and Homebrew (incl. Rosetta), a real OpenShift Hub (router X-Forwarded-For), two people's Macs. Also V3/V9 real CLIs, V4 real VM sandbox, V5/V6, V10/V13/V14/V18 real GitHub/OpenShift (kit-checks.md boundary).
