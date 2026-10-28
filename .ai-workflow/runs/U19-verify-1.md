# U19 workflow-verify attempt 1: fresh checks after the review fixes

Code revision: origin/main `187431a` plus the uncommitted working tree of branch `codex/lean-rerun` (no code edit after these runs; only documents and these run records changed afterwards). Node v24.19.0.

| Command | Result |
|---|---|
| `npm test` (PATH with `/opt/homebrew/bin` first, so `openssl` is OpenSSL 3.6.3) | tests 943, pass 943, fail 0; exit 0 |
| `npm run typecheck` | exit 0 |
| `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md` | PASS, exit 0 |
| `git diff --check` | exit 0 |
| `node --experimental-vm-modules --test tests/lean-office.test.mjs tests/lean-schema.test.mjs tests/lean-server.test.mjs tests/lean-web.test.mjs` | 135/135 |

The run before it, with macOS LibreSSL 3.3.6 first on PATH, was 942/943: `tests/hub-link.test.mjs` "a Bearer token goes only to the pinned CA's hub" failed with `certificate signature failure`. That file passes 25/25 with OpenSSL 3.6.3. It does not touch the changed code; recorded as an environment note and a follow-up candidate in `docs/verification/2026-10-27-lean-rerun.md`.

UI: a real lean Office with a fake live runtime on a temporary project, in the built-in browser. Checked: the rerun button and hint on a stopped task, the prefilled dialog with `aria-describedby`, submit → new task with "이전 작업" link and log, old task cancelled with "다시 실행한 작업" link, and the plain new-task dialog unchanged.

Not verified: the eevee-be real Office (needs the user's Office restarted), English screens beyond tests, G4.
