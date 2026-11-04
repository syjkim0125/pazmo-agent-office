# U34 implement, attempt 1 (lean Office kept claude hook block)

- **Scope:** U33 review 1, Minor 5 (`.ai-workflow/runs/U33-review-1.md`): the lean Office's own catalog copy never applied `keptClaudeBlock`. Story unchanged.
- **Story decision:** after the explainer https://claude.ai/artifact/UfeLicdWbEcSc1s6MFTPzJ (version 1) the user chose "A. Story 그대로 (Recommended)" over "B. D29 문구 고치고 G1" (2026-11-04). kit's canonical Story hash is `b005160e3d6082ef4dfd75b0109da58302328a0f62b0815270a3ad655906604e`, the same as `.ai-workflow/approvals/pazmo-agent-office-g1.json`; `graph.mjs init` accepted the binding.
- **Base:** U33's branch tip `a4209a0` (U33 was unmerged when this started). U33 then merged as PR syjkim0125/pazmo-agent-office#72; main `d8ac282` was brought in with the app's sync (merge `e9bcac3`, no `src`/`tests` change).
- **Commits:** `7f71838` (code and tests), `e9bcac3` (merge main), `a825cf8` (docs). Node 24.19.0.
- **Plan source:** N/A — small and reversible.

## Changes

1. `src/runtime/runner-settings.ts`: `keptClaudeBlock` is exported; its docstring says every catalog copy a screen or check reads keeps a block this way (the engine's in `refresh()`, the lean Office's in its discovery).
2. `src/lean/office.ts`, `discoverNow()`: stores and returns `keptClaudeBlock(catalog, found)` instead of `found`. The engine's `RunnerSettings` loads through `discoverNow()`, so it receives the same kept result (and applies its own `keptClaudeBlock` on top, which only rebuilds the same block's hint).
3. `tests/lean-office.test.mjs`: three tests and two catalog helpers (`hookedClaude` via the real `blockHookedClaude`, `unlistedClaude` with `claudeUnlisted: true` and no claude models).

Docs (`a825cf8`): the change record `docs/verification/2026-11-04-lean-kept-hook-block.md`, a STATUS top entry, U33's STATUS follow-up bullet and the D39 record's "후속 · 남은 것" lean bullet now point to U34.

## RED (before production code, on `a4209a0` + tests only)

`node --experimental-vm-modules --test --test-name-pattern="failed listing|default runner passes over" tests/lean-office.test.mjs`: 0/3 pass.

- Runners screen: claude after the failed listing was `{ blocked: false, hint: '준비됨', models: [] }`; expected the hook block and its hint.
- Agent save: "Missing expected rejection" — `create` with claude and `model: null` saved Bob.
- Default runner: `chooseRunner` with no agent gave `{ runner: 'claude', model: 'default', reasoning: null }`; expected codex `gpt-5.5`.

The save test's expected agent list first named the default agent "Pazmo"; corrected to "기본 agent" (the test had already failed earlier, at the rejection). The corrected test fails on the unfixed code too (mutant M0 below).

## GREEN

Same command after the change: 3/3 pass.

The save test then gained one assertion: the engine's copy, refreshed by the save's fresh discovery, carries the kept block's hint, although the engine never saw the hooked listing.

## Mutants (`discoverNow()` line only, restored after each; `git diff` afterwards shows only the intended change)

| Mutant | Failed tests (of the 3) |
|---|---|
| M0 store and return `found` (the code before) | 3 |
| M1 keep in the lean copy, return `found` to callers and the engine | 2 (screen, save) |
| M2 duplicate the rule by copying the earlier claude install (stale hint) | 1 (screen: the logged-out hint) |
| M3 keep the earlier block even when the listing went through | 1 (screen: the cleared case) |

## Related checks (after the change, before the merge)

- 7 test files that import `src/lean/office.ts`, `src/lean/agents.ts`, `src/runtime/runner-settings.ts` or the team/lean servers: lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office — **170/170**, exit 0.
- `tsc -p tsconfig.json`: exit 0.
- The merge `e9bcac3` changed no file under `src`, `tests`, `scripts` or `package.json`.

## Simplification

The production change is three lines in one function plus an export; nothing to simplify. No new abstraction.

## Limits

- The engine's copy can keep its own older block over the lean copy's newer listing (conservative; next successful listing fixes it). Not tested.
- A team Office repo whose copy saw only a failed listing of a new binary does not know the block. Not tested.
- No real claude: hand-built catalogs only.
