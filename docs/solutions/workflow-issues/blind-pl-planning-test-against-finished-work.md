---
title: Test PL planning blind against the history of finished work
date: 2026-11-02
category: workflow-issues
module: team Story board
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "A planning step (PL planning, kit intake, a planner prompt) changes and its output must be judged before agents act on it"
  - "A finished multi-repo task with git history and decision records is available to serve as an answer key"
tags: [pl-planning, blind-test, blocking-decisions, risk-lens, story-board, task-verification]
---

# Test PL planning blind against the history of finished work

## Context
The team Story board (D24) lets Task agents implement without asking questions. PL planning at Story G1 is the only place where human decisions get surfaced, and the Task checks approved there are the only gate before an automatic merge. Neither had been tried on real work. All 32 kit run graphs under `.ai-workflow/runs/` on 2026-11-02 have the same three nodes (implement → workflow-review → workflow-verify), so the kit planner had never produced a multi-repo Task graph.

## Guidance
Pick a finished slice of internal work that spans several repos and left decision records. Then:

1. **Snapshot each repo at the fork commit.** Use `git archive <fork-sha> | tar -x`, not a worktree, so the snapshot carries no history that could leak the answer. The fork commit is the first parent of the first task merge on the Story base, found with a first-parent walk. Do not use `git merge-base` once main has been merged back into the base. It then returns a later commit.
2. **Check for leaks.** Grep the snapshots for the new identifiers the real work introduced. Investigate every hit; an old field with a similar name is not a leak.
3. **Run two agents that never see each other's output.**
   - The blind planner gets only the requirement document, the snapshots and the kit procedure. It may not read other repos, run git, or open the answer-key folder.
   - The answer-key agent reads the real git history, decision documents and follow-up tickets. It records the actual Task split and every blocking decision, with when it surfaced: in the requirement, before G1, during the build, or after merge.
4. **Compare decision by decision.** Classify each one as asked or `OPEN BLOCKING`, handled correctly by following the requirement, labeled `ASSUMED`, or missed. Then classify each Task check target as an existing test or a test the Task itself would write.
5. **Keep outputs out of public repos.** Record only counts and aliases. Company, repo and ticket names stay in local scratch space.

## Why This Matters
One run on a card-payment migration step across four repos gave these results:

| | Blocking decisions (25) |
|---|---|
| Real work | 6 decided before G1 and kept, 5 decided before G1 then reversed, 5 during the build, 9 after merge |
| Blind planner | 8 asked or `OPEN BLOCKING`, 8 correct by following the requirement, 5 `ASSUMED`, 4 missed or wrong |

- **The 5 `ASSUMED` decisions were the expensive ones.** They covered legacy coexistence, fail open or closed, and legacy removal, which people changed three times in three weeks. The kit had a migration lens with compatibility window and rollback, but its intake read `domain-risks.md` only after G1. Kit 5.0.2 now applies the lenses before G1 and keeps unsettled payment and migration items `OPEN BLOCKING` (syjkim0125/ai-workflow-kit#14).
- **Most Task checks would not have caught a bad change.** 14 of 16 check targets were tests the Task itself would create, and only 1 was an existing test. Auto-merging on those checks means "the tests I wrote pass on my code".
- **Splitting worked.** The planner produced 11 Tasks in 6 layers, in the same dependency order as the real work, and listed 13 external dependencies without turning them into Tasks. One Story cost about 440k agent tokens and 32 minutes.

These findings became D35 in the contract and chapter 10 of `docs/understanding/team-story-board-decision.md` (syjkim0125/pazmo-agent-office#57).

## When to Apply
- Before building or changing Office step 4 (PL planning), or the kit intake and planner instructions.
- When checking whether the `ASSUMED` and `OPEN BLOCKING` split holds in a new domain.

Read the results with these limits in mind:
- One slice is one sample.
- Decisions made outside the record (meetings, wikis) are invisible to the answer key.
- A blind default that matches the final state does not prove it would have worked at the time.
- The planner received no answers to its questions and did not run its checks.

## Examples
Find the fork commit and snapshot one repo:

```bash
first=$(git log --first-parent --reverse --format='%H %s' origin/feature/<story>/base --since=<start> \
  | grep -m1 '<story-id>' | cut -d' ' -f1)
fork=$(git rev-parse "$first^1")
mkdir -p snapshots/<repo> && git archive "$fork" | tar -x -C snapshots/<repo>
```

Count Task check targets the Task writes itself, given a graph whose `files` entries carry `status: "new"`:

```js
for (const n of graph.nodes) for (const v of n.verify) {
  const target = v.argv.join(' ').match(/--tests\s+\S*?([A-Za-z]+(?:Test|Spec))\b/)?.[1];
  const file = target && n.files.find(f => f.path.includes(target));
  console.log(n.id, v.id, target, file ? file.status : 'not in files');
}
```
