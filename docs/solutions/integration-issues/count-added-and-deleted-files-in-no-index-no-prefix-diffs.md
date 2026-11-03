---
title: Count added and deleted files in a no-index, no-prefix folder diff
date: "2026-11-03"
category: integration-issues
module: Three-line change summary (G4 question and team Hub report)
problem_type: integration_issue
component: service_object
severity: medium
symptoms:
  - "A Story Task that only added files was reported to the team Hub as `2. 변경 파일: 변경 없음`"
  - "In the first real check, Tasks #2 and #4 (two new files each) listed no files while #3, which edited a file, was right"
  - "The single Office's G4 question uses the same function, so an add-only change would show the same empty line above evidence that holds the new files (not observed)"
  - "Deleted files were never listed either; in a mixed change the +/− counts still included their lines"
  - "A Task whose changed files all have non-ASCII names (Git quotes those header paths) also read `변경 없음` (reproduced with real Git, not seen in a real run)"
root_cause: logic_error
resolution_type: code_fix
tags: [git-diff, no-index, no-prefix, diff-header, quotepath, change-summary, story-task, team-hub, g4]
---

# Count added and deleted files in a no-index, no-prefix folder diff

## Problem

`changeSummary` (`src/runtime/decision-summary.ts:22`) builds the three-line `[변경사항]` block from stored evidence. It took file names only from `diff --git a/… b/…` headers, but the evidence producer never writes that shape for an added or deleted file. A Task that only added files was reported as changing nothing. The parser came in with PR syjkim0125/pazmo-agent-office#8 (merged 2026-10-06), long before team Story Task mode.

## Symptoms

- In the first real check of team Story Task mode, the Hub reports for Task #2 and Task #4 (each added two new files) said `2. 변경 파일: 변경 없음`. Task #3, which modified an existing file, was correct ([real check](../../verification/2026-11-03-team-story-task-mode-real-check.md), finding 3).
- The function is shared. It feeds the single Office's G4 question (`src/runtime/native-office.ts:584`) and the Story Task report (`src/team/story-contract.ts:315-321`), so both had the gap. The Office and Hub screens read the finished block back (`src/lean/office.ts:156-158`, `src/runtime/hub-snapshot.ts:71`). Only the Hub report was actually observed.
- In a mixed change, the list showed only modified files, but the `+/−` counts still included lines from added and deleted files, because line counting does not look at headers (`decision-summary.ts:39-40`). For an add-only diff the counts were computed and then dropped: an empty path list prints `변경 없음` (`decision-summary.ts:44-46`).

## What Didn't Work

No fix attempt failed. The question is why the tests passed for a month:

- **Fixtures copied ordinary `git diff`, not the producer.** The helper in `tests/decision-summary.test.mjs:5-13` hand-writes `diff --git a/${path} b/${path}` with a one-line hunk. That is an in-repo modification, the one shape the old regex accepted. The `storySummary` tests copy the same shape (`tests/team-story-contract.test.mjs:443`), and one heads added-only content (`+x`) with `a/f b/f` (`:465`), a header the producer never writes for a new file.
- **The producer test never checks headers.** `tests/candidate-diff.test.mjs:72-73` asserts `new file mode` and `deleted file mode` in real Git output, but not the `diff --git` line, and its output never reaches `changeSummary`.
- **Code review did not catch it (session history).** The stage-3 task reviews and the final branch review looked at the executor, merge and lock logic. Only the real run, where Tasks added brand-new files, showed the empty file line.

## Solution

The producer runs `git diff --no-index --binary --no-prefix … -- a b` over two snapshot folders named `a` and `b` (`src/runners/candidate-diff.ts:134-149`). With `--no-prefix`, the `a/` and `b/` in a header are those folder names, not Git's usual prefixes. Git writes the real path for each side, so a file that exists on only one side uses that side's path twice:

```text
diff --git a/mod.txt b/mod.txt                 # modified
diff --git a/old.js a/old.js                   # deleted
diff --git b/src/greet.js b/src/greet.js       # added
```

PR syjkim0125/pazmo-agent-office#59 (merged 2026-11-03) accepts either folder on both sides.

Before:

```ts
const header = /^diff --git a\/.+ b\/(.+)$/.exec(line);
```

After (PR #59; the quoted-path follow-up in Prevention adds a second alternative to this regex):

```ts
// The candidate diff compares folders a and b, so an added file is headed b/… b/… and a deleted one a/… a/….
const header = /^diff --git [ab]\/.+ [ab]\/(.+)$/.exec(line);
```

The PR adds the test "added and deleted files are counted in the diff git writes for two folders" (`tests/decision-summary.test.mjs:37-45`). It feeds a `b/src/greet.js b/src/greet.js` add and an `a/old.js a/old.js` delete and expects `src/greet.js, old.js (+3 −2줄)`. Written first, it failed with `변경 없음` before the regex change.

## Why This Works

The captured group is the text after the second `<folder>/`, which is the repo-relative path whichever snapshot holds the file. (The first `.+` is greedy, so an unquoted path that itself contains ` a/` or ` b/` is named after its last part; the file count is still right, and the old regex behaved the same. A quoted header is parsed exactly; see Prevention.) The producer passes `--no-renames` (`candidate-diff.ts:143`), so no header has two different paths. The `+/−` counting was already header-independent; with the paths found again, those counts are shown.

## Prevention

- **Test a parser against its producer's real output, not a hand-written copy of what Git usually prints.** The fix test above is a hand-written string. The pair test "the change summary names every added, modified and deleted file in a real candidate diff" (`tests/candidate-diff.test.mjs:199`) now runs `captureCandidateDiff` with that file's `fixture(t)` helper and checks the `changeSummary` file line for an ASCII and a non-ASCII trio of modified, added and deleted files.
- **Quoted paths (fixed 2026-11-03, the follow-up after #59).** The producer drops global Git config (`candidate-diff.ts:98-108`), so `core.quotePath` keeps its default. Git then quotes both sides of a header whose path has non-ASCII bytes or `"`: `diff --git "b/src/\354\235\270\354\202\254.js" "b/src/\354\235\270\354\202\254.js"` (Git 2.50.1). The `[ab]/` regex did not match a header that starts with `"`, so a Task whose changed files all had non-ASCII names (added, modified or deleted) read `변경 없음`. `changeSummary` now also matches the quoted form (escape-aware, so a `\"` inside the path cannot end it early) and decodes Git's C-style quoting in `unquote` (`decision-summary.ts:10-17`): octal escapes are collected as bytes and read as UTF-8, and `\"` and `\\` are literal. Letter escapes (`\t`, `\n`, …) stay as Git wrote them, and Git always writes LF and CR that way. This matters because the Office and Hub screens find the block line by line (`src/lean/office.ts:158`, `src/runtime/hub-snapshot.ts:71`) and a decoded newline would add a line to it. Paths with spaces only are not quoted and still use the plain regex. Candidate paths reject `\` and the control characters 0x00–0x1f (`candidates.ts` `validPath`), so real evidence quotes only for non-ASCII bytes, `"` and DEL (`\177`, decoded to an invisible character). `\\`, `\t` and `\n` are covered by a unit test on a patch Git 2.50.1 wrote (`tests/decision-summary.test.mjs:57`). The pair test failed with `변경 없음` for `src/인사.js, 지울.txt, 한글 " space.txt` before the fix.
- **Only one place parses the patch.** `diff --git` is parsed only in `decision-summary.ts:34-38`. `native-office.ts:1522-1525` passes `rawDiff` through for display, and the other readers parse the finished `[변경사항]` text. A new reader of `rawDiff` belongs under the same pair test.

## Related Issues

- [Replay frozen diffs before binding them to approval](replay-frozen-diff-before-approval.md): why the producer diffs frozen snapshot copies in private folders instead of accepting a supplied diff string.
- [Read a claude role report that follows a sentence of its own](read-claude-role-report-after-a-sentence.md): the same bug class, a parser that accepted fewer output shapes than its producer emits.
- [First real check of team Story Task mode](../../verification/2026-11-03-team-story-task-mode-real-check.md), finding 3, and its [G4 record](../../verification/2026-11-03-team-story-task-mode-g4.md).
