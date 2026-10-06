---
title: Claw CLI Usage panel reads CLI login files and shows a false "not signed in" under Office
date: "2026-10-06"
category: security-issues
module: Claw CLI Usage panel and refreshCliUsageData (vendor/claw-empire)
problem_type: security_issue
component: authentication
related_components:
  - tooling
  - frontend_stimulus
symptoms:
  - "Office CLI Usage panel showed \"not signed in\" for claude and codex while the same panel listed both CLIs as connected"
  - "Upstream refreshCliUsageData ran checkAuth() and the usage fetchers, which open CLI login files (~/.codex/auth.json, ~/.claude/.credentials.json, macOS keychain) against Story D15"
  - "Stale unauthenticated rows in the cli_usage_cache table kept being served by GET /api/cli-usage"
  - "Only the isolated service HOME kept the reads from finding real tokens"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [claw-empire, cli-usage, credentials, office-managed, d15, isolated-home, guard-placement, vendored-upstream]
---

# Claw CLI Usage panel reads CLI login files and shows a false "not signed in" under Office

## Problem

The vendored Claw "CLI Usage" panel gets its numbers by reading CLI login tokens directly and calling provider usage APIs. Under Pazmo-managed mode (`PAZMO_MANAGED=1`) that breaks the Office rule that login information is never read or moved (Story D15; `docs/understanding/cli-runner-selection-decision.md` item 2: login state comes only from `codex login status` / `claude auth status`). The only thing that kept the reads from finding anything was the Office service's isolated `HOME`, and that produced a wrong "not signed in" label.

## Symptoms

- The office view's CLI Usage card showed "로그인되지 않음" ("not signed in") for claude and codex while the same panel listed them as connected. The panel only renders cards for CLIs that `/api/cli-status` reports as `installed && authenticated` (`vendor/claw-empire/src/components/office-view/CliUsagePanel.tsx:98`). Office answers that status from the official CLI commands, but the usage row came from upstream's file-based `checkAuth()`.
- The cause was the isolated home. Office starts the Claw service with `HOME: join(p.dataDir, "home")` (`src/cli/lifecycle.ts:177`). Upstream `checkAuth()` looks for `~/.claude.json` / `~/.claude/auth.json` and `~/.codex/auth.json` under `os.homedir()` (`vendor/claw-empire/server/modules/workflow/agents/providers/usage-cli-tools.ts:147-151`, `:157-160`). Inside the isolated home those files don't exist, so `refreshCliUsageData()` wrote `{ error: "unauthenticated" }` rows into `cli_usage_cache`.
- Those stale `unauthenticated` rows stayed in `cli_usage_cache` and `GET /api/cli-usage` kept serving them from the cache.

## What Didn't Work

- **Relying on HOME isolation.** It is not a guard. It only makes the reads find nothing, which caused the misleading label. It also covers less than it seems:
  - `readCodexTokens()` reads `~/.codex/auth.json` (`vendor/claw-empire/server/modules/workflow/agents/providers/credential-tools.ts:62`).
  - `readClaudeToken()` reads `~/.claude/.credentials.json` (`credential-tools.ts:49`), but on macOS it first asks the keychain with `security find-generic-password -s "Claude Code-credentials"` (`credential-tools.ts:34-36`). The keychain lookup doesn't depend on `HOME`.
  - In the current upstream code, the keychain read is skipped only because the HOME-based `checkAuth()` fails first. If `HOME` ever pointed at the real home again, all of these paths would read real tokens and send them to the provider usage APIs (`usage-cli-tools.ts:29-33`, `:65-70`).
- **Intercepting `GET /api/cli-usage` and `POST /api/cli-usage/refresh` in `vendor/claw-empire/server/pazmo/host.ts`.** Office already intercepts `/api/cli-status` and `/api/cli-models` there (`host.ts:109-111`), so this looked natural, but it was rejected:
  - `refreshCliUsageData()` also runs without any HTTP request. After a task finishes, workflow orchestration calls it and then broadcasts `cli_usage_update` (`vendor/claw-empire/server/modules/workflow/orchestration/review-finalize-tools.ts:618`, `report-workflow-tools.ts:166`). An HTTP interception never sees those calls.
  - The `/api` middleware begins with `if (!office) return next();` (`host.ts:100`). Before the Office bridge is set up, requests fall through to the upstream routes.
  - Other sessions were editing `host.ts` at the same time.

## Solution

The guard lives in `refreshCliUsageData()` itself, the one function that every caller (both routes and both workflow paths) goes through. It was shipped in PR #6, and PR #7 updated the verification note in `docs/verification/2026-10-06-cli-runner-selection.md`.

Before (upstream):

```ts
async function refreshCliUsageData() {
  const providers = ["claude", "codex", "gemini", "copilot", "antigravity"];
  const usage = {};
  const fetchMap = { claude: fetchClaudeUsage, codex: fetchCodexUsage, gemini: fetchGeminiUsage };
  // ... tool.checkAuth() → fetcher() → upsert into cli_usage_cache
}

app.get("/api/cli-usage", async (_req, res) => {
  let usage = readCliUsageFromDb();
```

After:

```ts
// vendor/claw-empire/server/modules/routes/ops/worktrees-and-usage.ts:337
async function refreshCliUsageData(): Promise<Record<string, CliUsageEntry>> {
  const providers = ["claude", "codex", "gemini", "copilot", "antigravity"];
  const usage: Record<string, CliUsageEntry> = {};
  // Office never reads CLI login files; usage APIs need those tokens, so report ownership instead.
  if (isPazmoManaged()) {
    for (const p of providers) usage[p] = { windows: [], error: "office_managed" };
    return usage;
  }
  // ... upstream path unchanged

// worktrees-and-usage.ts:383
app.get("/api/cli-usage", async (_req, res) => {
  let usage = isPazmoManaged() ? {} : readCliUsageFromDb();
```

- **Managed refresh** (`worktrees-and-usage.ts:340-344`) returns `office_managed` for all five providers. It does not call `checkAuth()`, does not call any fetcher, and does not write to `cli_usage_cache`.
- **The GET route** (`worktrees-and-usage.ts:384`) skips the cache when managed, so old `unauthenticated` rows are never served.
- **The panel** shows a neutral label for `office_managed` (`CliUsagePanel.tsx:176-178`) using `LOCALE_TEXT.cliOfficeManaged` (`vendor/claw-empire/src/components/office-view/themes-locale.ts:210`; ko "Office에서는 사용량을 표시하지 않음", en "usage not shown in Office"). The generic "unavailable" branch excludes it (`CliUsagePanel.tsx:179`).
- **Trade-off:** Office shows no usage numbers. Login status still comes only from Office's `/api/cli-status`.

## Why This Works

The thing being protected is "no token read". The token reads happen inside `checkAuth()` and the fetchers, and the only code that reaches those for usage is `refreshCliUsageData()`. Putting the check there covers every current entry point: the two routes, the two orchestration callers, and any future caller that gets the function through the runtime context (`vendor/claw-empire/server/modules/runtime-helper-keys.ts:15`). It works whether or not the Office bridge is up, and it doesn't depend on where `HOME` points. Returning a dedicated `office_managed` value instead of an empty map lets the UI say why there are no numbers, instead of falling back to "not signed in" or "unavailable".

## Prevention

- **Put the guard on the shared function every caller goes through, not on one transport.** Before choosing an interception point, grep for every caller (`grep -rn refreshCliUsageData vendor/claw-empire/server`). Here that turned up the orchestration callers that route interception would have missed.
- **Never treat HOME isolation as a credential guard.** It hides reads instead of stopping them, it doesn't cover the macOS keychain, and it silently turns back into a real token read if the environment changes. For any vendored code path that touches `os.homedir()` login files or `security find-generic-password`, add an explicit `isPazmoManaged()` check.
- **When cached rows reflect a state from before the guard, guard the cache read too**, not only the refresh.
- **Regression tests:**
  - `tests/claw-cli-usage.test.mjs` calls `registerWorktreeAndUsageRoutes` with an injected context: an express app, an in-memory `DatabaseSync` seeded with a stale `unauthenticated` row, and `CLI_TOOLS`/fetchers that log every call into a `credentialReads` array. In managed mode, both routes and a direct `refreshCliUsageData()` call return `office_managed` for all five providers, the stale row is not served, and `credentialReads` stays `[]`. In unmanaged mode, upstream behaviour is unchanged: the cached row is served, and refresh calls `checkAuth` and the fetchers.
  - `vendor/claw-empire/src/components/office-view/CliUsagePanel.office.test.tsx` checks that the neutral text appears and that neither "로그인되지 않음" nor "사용 불가" does.
  - Each test was first seen failing for the expected reason. Results: root suite 453/453 at fix time and 458/458 on merged main, root typecheck exit 0. The UI vitest run had 2 failures that predate this change and are unrelated (ReportHistory/TaskReportPopup avatar tests).
- **Evidence limit:** before PR #6, any refresh in an Office run with a non-isolated `HOME` would have read tokens. Nothing on record shows that configuration ran.

## Related Issues

- [codex loads CODEX_HOME AGENTS.md into isolated Office runs](codex-home-agents-md-leaks-into-isolated-runs.md): the same rule that login folders are never read, applied to codex runs.
- [Pin bounded role instructions](../architecture-patterns/pin-bounded-role-instructions.md), "Restoring upstream execution without bypassing role boundaries": the general rule this fix follows. Guard the concrete upstream entry, because HTTP-only blocking misses timers and internal calls. `refreshCliUsageData()` is one more such entry.
- `docs/understanding/cli-runner-selection-decision.md` (item 2) and Story D15 in `docs/understanding/pazmo-agent-office-contract.md`: the credential rule. Commit `aac796d`'s message cites "D14", but D14 is about expired approval challenges; D15 is the correct reference.
- `docs/verification/2026-10-06-cli-runner-selection.md`, "남은 일·한계": records that the panel no longer reads credentials (PR #7).
- PR #6 (fix) and PR #7 (verification note), github.com/syjkim0125/pazmo-agent-office.
