# U42 implement attempt 1

- Commit `4a6d5e1` on `claude/elegant-ritchie-715793` (base main `a3ef064`).
- Changed: `src/runtime/hub-link.ts` (opt-in `{ keepAlive: false }`, non-pooling agent), `src/team/upload.ts` (`uploadCall` for uploadLink and retiredMac), new `tests/team-upload-link.test.mjs`, `docs/STATUS.md` (U42 entry), `docs/solutions/runtime-errors/hub-call-pooled-socket-reset-after-event-loop-stall.md`.
- Cause reproduced before the fix: pooled-connection call after an 8 s block outside the timers phase → `read ECONNRESET` 2/2; server keep-alive 65 s → OK; non-keep-alive agent → OK; the real flaky test plus 6.5 s block in its sync window → exact HUB_UNREACHABLE message; after the fix it passes at 6.5 s and 9 s.
- RED: `node --test tests/team-upload-link.test.mjs` 5 runs, 5 × fail `read ECONNRESET`. GREEN after the fix: 5 runs, 5 × pass.
- Related files (team-upload-link, hub-upload-office, team-upload, hub-story-upload, hub-link, hub-link-system-trust, team-mac, team-mac-cli): 110/110. `npm run typecheck` exit 0.
- Full `npm test`: 1862/1862, exit 0, 190 s (load 24 at the end).
- Simplification: change is two small seams; no further simplification.
