# U25 review 1 (independent, report-only) — commit 2d1fbba

Verdict: Changes needed. No Critical.

Reviewer ran: launcher + runner-settings + runner-models 45/45 (twice, exit 0); live-runtime "runner mode refuses startup" 2/2 (exit 0); typecheck exit 0; probes with native fake CLIs only (no real claude/codex/up).

Important
1. RUNNER_BLOCKED drops the login cue when the blocked CLI is also logged out. `inspect()` sets codex `blocked` whatever `loggedIn` is and replaces the login hint; `loadRunnerCatalog` judges hooks for any ready claude. Codex logged out + ~/.codex/AGENTS.md, claude logged out → RUNNER_BLOCKED, no "codex login" anywhere (before: LOGIN_REQUIRED "install and log in" lead). Same in createLiveRuntime for a logged-out hooked claude. Fix: count only blocked AND logged in, or append the login hint.
2. Test gaps: no step-1 test with a logged-out claude (`usable(claude)` → `status === "ready"` survives); no startupRunners test for an AGENTS.md-blocked logged-in codex with a hooked claude (works in a probe, untested).

Minor
3. Pinned, codex auth present, codex AGENTS.md-blocked, claude logged in → RUNNER_BLOCKED "no codex·claude can run" followed by "claude: 준비됨". createLiveRuntime and pinned codex jobs (runner-jobs.ts:46) ignore `blocked`; the launcher's pinned gate (from f2bd735) does not. Drop the gate's block check or word the headline per mode.
4. fakeRunners never removes its temp root (pattern is older; adds 4 dirs per launcher run).
5. startupRunners has no extraDirs seam; tests rely on both fakes shadowing /opt/homebrew/bin and /usr/local/bin.
6. No progress line during the listing (before "[1/4]"); "about 1–2 s"/"1.3 s" are idle numbers; worst case adds the 15 s timer plus up to 7 s stop.
7. Placeholders left in docs/STATUS.md and the verification doc.
8. Verification doc "lean 0.2초" is a whole `up` process time with fakes; say what was timed.

Checked correct: wiring before prepareVendor/setupRuntime/prepareVm for claw, lean, team; refactor of blockHookedClaude/usable preserves behavior; step 1 agrees with Office for every non-pinned combination traced (except D29's by-design failed-listing case); no import cycle.

Disposition (author): 1, 2, 4, 5, 7, 8 fixed. 3: headline worded for the pinned runtime; the pinned gate itself (launcher stricter than Office) is older and is a guard change, left as a follow-up for a decision. 6: documented (idle numbers and the worst case), no progress line added.
