# runner-group-kill-race v3 · workflow-review (attempt 1) — pass 2

- **Reviewer:** independent, read-only `general-purpose` subagent with the superpowers code-review template. It got the requirements, pass 1's notes and the commit range, not the implementer's session.
- **Why a fresh reviewer:** pass 2 first went to pass 1's reviewer, but the session that ran it hit its account's usage limit mid-review and left no result. A second session sent the same scope to a new reviewer, with pass 1's findings in the prompt.
- **Range:** `4a6d6ed..d05d554` (d46cfba fix, dfb171d test, d05d554 docs).
- **Verdict:** "Ready to merge: With fixes". Critical 0, Important 0, Minor 3, all in docs.

## Confirmed by the reviewer

- **Rebase:** `git range-diff 70b8ff3..43c81f1 4a6d6ed..d46cfba` → `1: 43c81f1 = 1: d46cfba` (patch and message identical).
- **Nothing new to cover on main:** between 70b8ff3 and 4a6d6ed, src/scripts/bin add only a `spawnSync` in `scripts/kit-test-shard.mjs`, with no group stop. origin/main's newer 0660a12 and 723744d touch only `CONCEPTS.md` and a new solutions doc.
- **`signalGroup`** (`src/runners/command.ts:28-39`) meets (a)–(d). Each call site keeps its own first-kill handling and stop order.
- **dfb171d (pass 1 Minor 2):**
  - In an instrumented copy (3 runs, load average about 4.4), all ten fakes reached `eof` in the same 20 ms poll. SIGKILL came 21–22 ms after SIGTERM.
  - At SIGTERM the loops had done 0–14 of 5000 passes. None finished before the kill.
  - RED with 4a6d6ed's `runner-models.ts`: 0/1 ×3 (6, 5, 5 left, 2.6–3.0 s).
  - It cannot pass vacuously, and it stays bounded if a regression returns.
- **Other fork tests on the old files:** exec-relay 0/1 (9 left), claude-controller 0/1 (7 left).
- **At HEAD:**
  - runner-models 17/17, exec-relay 7/7, command 6/6, claude-controller 21/21.
  - `npm run typecheck` exit 0.
- **Docs:** they match the code on names, the 20 ms / 250-try behavior and `BOUNDARY_DIGEST` membership, with three exceptions below.
- **Hygiene:** no internal host or organization names.

## Findings (all Minor, docs)

1. `docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md:21` says `detached: true` is at line 50 of command.ts; it is line 70 since `signalGroup` was added above `runCommand`.
2. `docs/STATUS.md:14` gives "관련 시험 파일 25개 364/364". That was measured on 43c81f1 over 70b8ff3, before the rebase onto kit 5 and before dfb171d. Label it, or point at the verify record.
3. Wording:
   - Solutions doc `:63` and STATUS `:9` say every claude stop sends SIGTERM first. Only a cancel or timeout of a role run does, and model discovery does after closing stdin. Refused stops, and stops after the CLI exited, SIGKILL at once.
   - Solutions doc `:84` ("about 1.6–2.1 s by the kill") is not backed by the stored measurements. Cite the pass counts at SIGTERM.
   - `:65` ("followed on branch …") and `:102` (untracked run files) will go stale at merge. Update `:65` at delivery, and commit the run files as #67 did.

## Declined to judge (reviewer's list)

- No `t.after` group kill in the rewritten runner-models test: leftovers are bounded, as in the sibling tests.
- A regression that drops discovery's SIGKILL entirely would pass the fork test. The 12 s-grace test covers that case.
- Overlapping SIGKILL intervals in claude-controller: harmless (pass 1).
- Pid reuse within one 20 ms tick: not realistic on macOS.
- A stale `exec-relay.ts:214` in another doc, outside the range.
- The requalification note: no PR yet.
- Linux, real CLIs and the full suite: not run (machine rules).

## Routing

All three findings change tracked docs, which are part of the snapshot. This pass therefore fails with `fix`, and `implement` makes the doc edits. Finding 3's `:65` update is deferred to the G4 delivery commit, because the PR number does not exist yet. The run files get committed then too.
