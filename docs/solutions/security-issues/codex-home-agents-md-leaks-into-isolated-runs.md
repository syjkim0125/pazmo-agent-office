---
title: codex loads CODEX_HOME AGENTS.md into isolated Office runs despite --ignore-user-config
date: "2026-10-06"
category: security-issues
module: Codex controller profile and runner qualification
problem_type: security_issue
component: tooling
symptoms:
  - "A canary in $CODEX_HOME/AGENTS.md or AGENTS.override.md appeared in the model request even with --ignore-user-config and project_doc_max_bytes=0"
  - "Runner qualification reported user-config-not-loaded failed only after the canary was planted in CODEX_HOME instead of the working directory"
root_cause: scope_issue
resolution_type: code_fix
severity: high
tags: [codex, codex-home, agents-md, isolation, user-config, qualification]
---

# codex loads CODEX_HOME AGENTS.md into isolated Office runs despite --ignore-user-config

## Problem

Office runs codex with `CODEX_HOME` set to the user's login folder (`~/.codex`), because the subscription login lives there and must not be copied. codex always reads `AGENTS.md` and `AGENTS.override.md` from `CODEX_HOME` as user instructions. So the user's personal codex instructions entered every Office codex role run, breaking the rule that personal CLI settings never mix into isolated runs. This affected both the user-installed codex 0.160.0 and the pinned 0.155.1 runtime used since 2026-09-22.

## Symptoms

- A local fake Responses server received the `CANARY_AGENTS.md` / `CANARY_AGENTS.override.md` text in the request for both binaries.
- The earlier qualification only planted the canary as `AGENTS.md` in the controller's working directory. That path is suppressed by `project_doc_max_bytes=0`, so the leak stayed invisible until the canary was planted in `CODEX_HOME`.

## What Didn't Work

- **`--ignore-user-config`** (`src/runners/codex-profile.ts:164`) skips `config.toml` only. The instruction files are still loaded.
- **`project_doc_max_bytes=0`** (`src/runners/codex-profile.ts:152`) suppresses project docs found from the working directory, not the `CODEX_HOME` user instructions.
- **Other overrides:** `-c instructions=""`, `-c include_permissions_instructions=false` and `-c project_doc_fallback_filenames=[]` all left the canary in the request. No feature flag in `codex features list` covers it.
- **A private `CODEX_HOME` with the login file copied or linked in** was rejected. Copying the login is forbidden. A link can be replaced by a fresh file when codex refreshes its token, which would leave the user's real login stale.

## Solution

Detect the files by existence (never read their content) and refuse codex runs while either exists (user decision, 2026-10-06):

```ts
// src/runners/codex-profile.ts:19
export function codexPersonalInstructions(codexHome: string): string[] {
  return ["AGENTS.md", "AGENTS.override.md"].filter((name) =>
    existsSync(join(codexHome, name)),
  );
}
```

- **`codexJob`** checks this before verifying the binary or starting the relay. It returns a closed `CODEX_PERSONAL_INSTRUCTIONS: <paths>` failure (`src/runners/codex-controller.ts:94`). Every codex path goes through this check: installed, pinned and the legacy service mode.
- **Discovery** marks the install `blocked` with on-screen guidance (`src/runners/runner-discovery.ts:123`). Settings, startup and the role defaults treat a blocked codex as unusable, so unchosen roles fall back to a logged-in claude.
- **The qualification fixture** no longer plants the `CODEX_HOME` canary (`src/runners/qualification-fixtures.ts:146`). The gate makes the property irrelevant to a passing run, and the other personal-config canaries (invalid `config.toml`, SessionStart hook, poisoned skill, working-directory `AGENTS.md`) still run.

## Why This Works

The leak follows from codex's design: one folder holds both the login and the user instructions, and Office must use that folder for the login. With no configuration to separate the two, the only way to keep the isolation invariant without touching credentials is to refuse to run while the instructions exist. The check is an existence test, so Office still never opens anything in the login folder.

## Prevention

- **Plant isolation canaries in every location the CLI reads, not only the working directory.** For codex that includes `$CODEX_HOME/AGENTS.md` and `AGENTS.override.md`. A canary that cannot leak proves nothing.
- **Re-verify on version changes.** Treat `--ignore-user-config` as "no `config.toml`", not "no user state", and re-check this whenever the codex version changes.
- **Regression tests:**
  - `tests/codex-controller.test.mjs`: a personal `AGENTS.md`/`AGENTS.override.md` blocks the run before anything starts.
  - `tests/runner-discovery.test.mjs`: codex is marked blocked with guidance.
  - `tests/runner-settings.test.mjs`, `tests/runner-jobs.test.mjs`, `tests/launcher.test.mjs`: a blocked codex is unusable at save, run and startup.
- **Evidence limits:** codex runs recorded before this gate may have included personal instructions. See `docs/verification/2026-10-06-cli-runner-selection.md`.

## Related

- `docs/understanding/cli-runner-selection-decision.md` — the G3 design and the 2026-10-06 decision.
- `docs/solutions/integration-issues/remote-codex-cwd-and-tool-evidence.md` — its profile summary says personal config/rules are ignored. That holds for `config.toml` and rules but not for `CODEX_HOME` instruction files.
