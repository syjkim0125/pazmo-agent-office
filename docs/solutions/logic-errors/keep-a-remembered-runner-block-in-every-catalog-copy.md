---
title: Keep a remembered runner block in every copy of the runner catalog
date: "2026-11-04"
category: logic-errors
module: Runner catalog copies (RunnerSettings, lean Office discoverNow, team Office sharedDiscovery)
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "After a failed claude model-and-hook listing, the lean runners screen showed a hook-blocked claude as 준비됨"
  - "An agent with claude and no model was saved while the engine would refuse it"
  - "The engine started a hooked claude role job after its D39 rediscovery met a failed listing (error: null)"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - testing_framework
tags: [runner-catalog, cache-copies, kept-block, claude-hooks, d29, d39, d40, rediscovery, refresh-before-run, team-office, lean-office]
---

# Keep a remembered runner block in every copy of the runner catalog

## Problem
D29 blocks a claude whose hook listing names any hook. A failed listing judges nothing, so D39 and U33 made the engine keep an earlier block of the same binary across a failed listing (`keptClaudeBlock` in `RunnerSettings.refresh()`).

The catalog has more copies than the engine's:
- the team Office's discovery that all repo engines share (`sharedDiscovery` in `src/team/office.ts`);
- each lean Office's own copy (`discoverNow()` in `src/lean/office.ts`), which is also the engine's loader;
- the engine's copy (`RunnerSettings`).

Only the engine's copy kept the block. The others stored each discovery as is.

## Why it mattered
- **Copies see different discoveries.** The lean copy sees every discovery its screen, agent checks and engine run. The engine's copy is refreshed only now and then. In a team Office, each repo's copies see only their own repo's discoveries.
- So the evidence (a listing that found a hook) can reach one copy and miss another. The copy that missed it holds no block.
- D39 made that dangerous. Before refusing a not-ready runner, the engine discovers again. If that listing fails, a copy with no block of its own judges claude ready, and the role job starts. That reopened the hole D29 closes.
- The first change record called this "a display problem: the engine still refuses". That held only when the engine's own copy had seen the hook. An independent review found the job-start path with a probe.

## Fix
- Apply the same pure function (`keptClaudeBlock`) at every place that stores a discovery, and hand the kept result down instead of the raw one.
  - `sharedDiscovery` keeps against the shared history, so a block one repo found reaches every repo.
  - `discoverNow()` keeps against the lean history and returns the kept result, so the engine receives it.
  - `RunnerSettings.refresh()` still keeps against its own history. In production the engine always loads through a lean Office (`createNativeOffice` is called only from `src/lean/office.ts`), so this keep matters for the engine's own older block and for tests that build a native Office directly.
- Re-applying the function lower down is safe: on a catalog that already carries the block it only rebuilds the same hint. At worst, a lower copy keeps its own older block, which errs toward blocked.

## Prevention
- When a rule depends on history ("keep X across a failed check"), list every place that stores the checked result. Follow the loader's callers (`runnerCatalog`, `discover`), not only the class that first got the rule.
- Test at the lowest reader, with the evidence seen only by an upper copy:
  - lean: only `runners()` sees the hooked listing; the engine's job then rediscovers into a failed listing and must be refused (`tests/lean-office.test.mjs`).
  - team: only repo A's engine sees it; the listing then fails twice, at A's next look and at B's, and B's engine must hold the block (`tests/team-office.test.mjs`; the fake runtime keeps the engine's `runners`). One failure is not enough: a layer that stores the raw result but returns the kept one passes it, and loses the block on the second failure.
- When a record says "the engine still refuses", name which copy must have seen the evidence for that to hold, and check it with a job-level test, not by reading.

## Fresh evidence (closed in D40/U35)
- Keeping a block across failures does not make the copies agree on fresh evidence. The engine used to rediscover only when its install was not ready or its binary changed (`src/runtime/runner-jobs.ts`). If a hook appeared while the engine's copy said ready, the next claude role job started, whether only the lean runners screen had listed the hook (U34 review 2, by probe) or nothing had.
- D40 chose "refresh first" over "make the copies agree": `roleJobFactory` rediscovers before every claude job, so a guard no longer depends on which copy happened to see the evidence, or on anyone having looked. Codex jobs still trust a ready copy; codex has its own check right before the run (`CODEX_PERSONAL_INSTRUCTIONS`).
- Rule: a check that guards a run must refresh right before the run when the state it guards can change without anyone looking. Following another copy only helps when some copy has looked. Test both cases at job level: evidence seen only by an upper copy, and evidence nobody listed (`tests/lean-office.test.mjs`, D40).

## Related
- `docs/verification/2026-11-04-lean-kept-hook-block.md`: the change (U34), its tests, mutants and residual risks.
- `docs/verification/2026-11-04-claude-job-recheck.md`: D40/U35, the rediscovery before every claude role job.
- `docs/verification/2026-11-03-runner-not-ready-wait.md`: D39 and its follow-up U33, where `keptClaudeBlock`, `claudeUnlisted` and `hookBlock` came from.
