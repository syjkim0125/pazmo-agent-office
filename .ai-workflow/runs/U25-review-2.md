# U25 review 2 (same independent reviewer, report-only) — commit 2e8a816

Verdict: Approve. Items 1, 2, 4, 5, 7, 8 of review 1 fixed; item 3's headline fixed. Nothing Critical or Important left.

Reviewer ran: launcher + runner-settings + runner-models 49/49 (exit 0); live-runtime "runner mode" 3/3 (exit 0); typecheck exit 0; fake-CLI probes only (no real claude, codex or up). Worktree stayed clean.

Checked: blocked counts only when logged in (launcher.ts:38-43, live.ts:427), pinned by `codexAuth && !!codex.blocked`; probes for logged-out blocked codex (LOGIN_REQUIRED, login lead, AGENTS.md hint) and pinned with auth.json + blocked logged-out codex (RUNNER_BLOCKED, pinned headline); new tests fail when `&& i.loggedIn` or the pinned `codexAuth &&` is dropped; t.after cleanup at every call site; extraDirs forwarded and left unset in production (launcher.ts:288); doc timing and "lean 0.2초" wording; review-1 record matches.

Minor (none blocks merge)
1. Codex logged out and AGENTS.md-blocked, claude hooked and logged in → RUNNER_BLOCKED; the codex hint lacks `codex login`, so fixing codex (rather than claude) leads to a second RUNNER_BLOCKED. Optional: append the login hint in inspect() when codex is blocked and logged out.
2. Older pinned issue: pinned, no ~/.codex/auth.json, codex logged in → LOGIN_REQUIRED with the generic "codex or claude" lead and "claude: 준비됨". Belongs to the pinned-gate follow-up.
3. Doc worst case "약 24초" vs its breakdown 15 + 3 + 2 + 2 = 22 s.
4. D30: "(Office를 켜는 createLiveRuntime도 같음)" sits after the pinned parenthetical; createLiveRuntime has no pinned blocked rule (pinned + auth.json passes).
5. Placeholders in STATUS and the final npm test row.

Disposition (author): 3, 4, 5 fixed (docs; 4 changes the Story wording, so a new kit run per the graph rule). 1 and 2 recorded as follow-ups in the verification doc (1 would change the codex hint shown in the UI as well; 2 is the pinned-gate decision).
