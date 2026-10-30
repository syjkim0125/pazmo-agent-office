# U27 review 1 (independent, report-only) — commit 5e480ae

Verdict: Approve. Nothing Critical or Important.

Reviewer ran (Node 24.19.0): launcher + live-runtime + runner-settings + runner-discovery 62/62 (exit 0); runner-jobs + codex-controller + cli + team-lifecycle + lean-office 85/85 (exit 0); typecheck exit 0; story check exit 0; mutations in a scratch copy 6/6 caught (pinned ignores the files; files checked only with an installed codex; usable claude stands in under pinned in createLiveRuntime; blockedHint drops the cue; LOGIN_REQUIRED drops the move cue; step-1 pinned branch skipped when a runner is usable). Checkout left unchanged.

Checked: every runner-mode pinned start reaches createLiveRuntime with runners (claw native-office, lean, `start --live`; team engines open locked); step 1 and Office use pinnedCodexProblem on the same ~/.codex that codexJob checks, existence only, installed CLIs ignored; codexJob refusal and the no-runners path unchanged; non-pinned logic and messages as at 2062c17 apart from the ASSUMED suffix; callers of assertRunnerLogin / blockHookedClaude; the UI only displays hint text; no import cycle; temp folders cleaned, no test reads the real ~/.codex.

Minor
1. runner-settings.ts:83 — "고정 codex…가 쓸 codex가 막혀 있습니다" is wrong when no codex is installed (the problem is a file in the login folder). Absolute paths vs `~/.codex` in discovery hints (cosmetic).
2. runner-discovery.ts:76-78 — the appended login cue reads as a required extra step even when the user takes the hint's other option (choose the other CLI). Make it conditional.
3. launcher.ts:294 — no test covers the prepareMachine wiring (always `{}` would go unnoticed). Same gap as the old codexAuth wiring.
4. Docs: D32 cites an untracked doc at 5e480ae; STATUS.md:9 still lists the pinned inconsistency as open; D30's pinned sentences are replaced by D32 but neither says so; the codex AGENTS.md solution doc could mention the pinned start check.
5. Optional: under pinned, step 1 still runs discoverRunners (codex --version, codex login status, claude auth status) whose result the pinned branch does not use.

Disposition (author): 1 fixed (headline names the login folder; paths stay absolute, as in CODEX_PERSONAL_INSTRUCTIONS). 2 fixed ("<cli>를 쓰려면 터미널에서 <command>도 실행하세요."). 3 fixed with an `up --codex-runtime pinned` CLI test that stops at step 1 either way (skipped when colima/docker are missing or a codex/claude CLI sits in a default discovery folder outside the fake HOME). 4 fixed (D32 says it replaces D30's pinned sentences, so a new kit run; STATUS; solution doc; the verification doc is committed with the PR). 5 left as a follow-up: discovery under pinned costs what it cost before this change.
