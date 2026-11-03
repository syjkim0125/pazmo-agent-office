# quoted-path-change-summary implement — attempt 1

Story: `docs/understanding/pazmo-agent-office-contract.md` (M16 and V18: the Story Task's three-line summary; the same `changeSummary` builds the single Office's G4 summary). Plan source: N/A — small and reversible. No Story change.

Problem: the candidate diff (`src/runners/candidate-diff.ts`, `git diff --no-index --no-prefix -- a b` with global Git config dropped, so `core.quotePath` is on) quotes both sides of a header whose path has non-ASCII bytes or `"`, e.g. `diff --git "b/src/\354\235\270\354\202\254.js" "b/src/\354\235\270\354\202\254.js"` (Git 2.50.1). `changeSummary` matched only `[ab]/… [ab]/…`, so a Task whose changed files all had non-ASCII names reported `2. 변경 파일: 변경 없음`.

Change (commit `e0245fd` on main `76c0743`):

- `src/runtime/decision-summary.ts`: a second, escape-aware alternative for quoted headers (`"[ab]/…" "[ab]/…"`, where `\"` cannot end the path) and `unquote`: octal escapes are collected as bytes and read as UTF-8; `\"` and `\\` are literal; letter escapes (`\t`, `\n`, …) stay as Git wrote them (Git always writes LF and CR that way), so a path cannot add a line to the block the Office and Hub screens read line by line. Unquoted headers (including paths with spaces) use the old regex.
- `tests/candidate-diff.test.mjs`: pair test "the change summary names every added, modified and deleted file in a real candidate diff". Runs `captureCandidateDiff` (real `/usr/bin/git`) with the file's `fixture(t)` on an ASCII trio and a quoted trio (`src/인사.js` added, `지울.txt` deleted, `한글 " space.txt` modified) and checks the `changeSummary` file line.
- `tests/decision-summary.test.mjs`: "quoted header paths are decoded and their control characters stay escaped". The fixture is byte-equal to the patch Git 2.50.1 wrote for `back\slash.txt`, `new<LF>line.txt` and `tab<TAB>name "인".txt` (candidate paths reject `\` and the control characters 0x00–0x1f, so the producer cannot make these).
- `docs/solutions/integration-issues/count-added-and-deleted-files-in-no-index-no-prefix-diffs.md`: the "Still open: quoted paths" bullet now records the fix; the pair-test sketch is replaced by the real test; stale line references refreshed.

RED (before the production change):

- Pair test: the ASCII trio passed; the quoted trio gave `2. 변경 파일: 변경 없음` instead of `src/인사.js, 지울.txt, 한글 " space.txt (+3 −2줄)`.
- Unit test, first version (decoding `\t`): `변경 없음`. After review Minor 1 the test was changed to expect control escapes kept as written; with the first fix (which decoded `\n`) it failed with a 5-line summary instead of 4.

GREEN: `tests/decision-summary.test.mjs`, `tests/team-story-contract.test.mjs`, `tests/hub-snapshot.test.mjs`, `tests/candidate-diff.test.mjs`: 40/40. `npm run typecheck`: exit 0.

Review follow-up: the re-review's one Minor (the comment and doc said "control characters" stay escaped, but octal-written ones such as DEL `\177` are decoded) was fixed by narrowing the wording to letter escapes; no behavior change.

Simplification (direct kit procedure; `ce-simplify-code` not used because the user's global instructions limit CE to `ce-compound` in this repo): the review fix removed the letter-escape table, so `unquote` is one regex with three branches. No other change.
