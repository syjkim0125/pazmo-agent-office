# runner-group-kill-race v3 · implement (attempt 1)

This run continues the kit 4.1.0 run `.ai-workflow/runs/runner-group-kill-race.json`. That run recorded implement attempt 1 (`runner-group-kill-race-implement-1.md`) and review pass 1 (`runner-group-kill-race-review-1.md`, "With fixes", routed `fix`). It became read-only (`upgrade-required`) once the branch moved onto main with kit 5. This v3 run records the corrected change.

## Base and history

- The base fix (`runCommand`) was merged to main as `4a6d6ed` (syjkim0125/pazmo-agent-office#67).
- The first commit was rebased from `70b8ff3` onto `4a6d6ed` (`git rebase --onto origin/main 70b8ff3`), without conflicts. The nine files it touches were byte-identical between `70b8ff3` and `4a6d6ed` (`git diff --stat 70b8ff3 origin/main -- <files>` empty). The commit's diff is therefore the reviewed one, now `d46cfba`.
- `package.json` and `package-lock.json` are unchanged against `70b8ff3`, so `node_modules` from `npm ci` stays valid.
- Story: G1 `.ai-workflow/approvals/pazmo-agent-office-g1.json`, bound to the current Story hash; this change does not edit the Story.

## Commits on top of main

1. `d46cfba` fix: kill the relay, claude and model-discovery groups until they are empty (reviewed in pass 1 as `43c81f1`).
2. `dfb171d` test: start the model-discovery fork-race fakes from one binary (review pass 1, Minor 2).
3. `d05d554` docs: record that every process-group stop now kills until the group is empty (review pass 1, Important 1, plus the STATUS entry).

## Review fixes

**Minor 2 (`tests/runner-models.test.mjs`).** The test now builds one native fake and runs `claudeModels(binary, home)` in ten homes, instead of ten `refreshingClaude` copies. The fake's script is the same: it writes its pid, traps TERM, answers, waits for the end of its input, touches `eof`, then runs `forkLoop("sleep 5 >/dev/null")`.

- **RED.** `runner-models.ts` from `origin/main` swapped in: 3/3 runs failed with "no forked child may outlive the stopped claude", 8, 9 and 9 left. The harness first waited for another session's `node --test` run.
- **GREEN.** 3/3 runs, 715–1019 ms (was about 2.2 s).
- **Margin probe** (temporary instrumentation, reverted, 3 runs, load average 10–15): all ten fakes reached `eof` within 44 ms of each other, and the SIGKILL tick came 22–45 ms after the last one. With ten copies, the reviewer measured that the first loop had run about 1.6–2.1 s by then.
- The whole file: 17/17, exit 0.

**Important 1 (`docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md`).**
- The Solution section shows `signalGroup` and how its callers keep their own first-kill handling, and adds "Repeat only SIGKILL".
- Prevention lists all five fork-race tests and the shared fixture. It adds the `kill -9` lesson (a TERM trap let `kill $!` miss 139 of 200 just-forked children) and the one-binary lesson.
- Related Issues now names the three call sites as fixed, keeps SIGTERM one-shot by design, and notes requalification and why `command.ts` is not in `BOUNDARY_DIGEST`.
- The frontmatter module and tags cover all four stops.

**STATUS.** `docs/STATUS.md` has a new top entry for this change. The previous entry's "남은 것" bullet about the three call sites now points to it.

**Minor 3 (requalification note in the PR text).** For the PR, when the user asks for one. It is also in STATUS and the learning.

## Checks after the fixes

- `npm run typecheck`: exit 0.
- `tests/runner-models.test.mjs`: 17/17.
- The other changed test files were unchanged since review pass 1. There the reviewer ran exec-relay 7/7, claude-controller 21/21 and command 6/6, and the implementer ran the 25 related files 364/364 (`runner-group-kill-race-implement-1.md`).
- Fresh full verification is the `workflow-verify` node's.

Not changed or not proven: as in `runner-group-kill-race-implement-1.md` ("Not changed or not proven here").
