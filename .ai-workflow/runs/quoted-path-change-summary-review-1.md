# quoted-path-change-summary workflow-review — attempt 1

Reviewer: an independent read-only reviewer subagent (general-purpose, Superpowers `requesting-code-review` template) that got the requirements and the diff, not this session's history. `ce-code-review` was not used: the user's global instructions limit CE to `ce-compound` in this repo. Two passes over the uncommitted diff against `4e80426` (tree equal to main `76c0743`).

Pass 1 — "Ready to merge: Yes". Critical 0, Important 0, Minor 4:

1. Decoding `\n`/`\r` could let a path add a line to the `[변경사항]` block that `src/lean/office.ts:158` and `src/runtime/hub-snapshot.ts:71` read line by line (not reachable today: `validPath` rejects control characters). Fixed: letter escapes stay as Git wrote them; the unit test asserts a 4-line summary.
2. The doc overstated which escapes the unit test covers. Fixed.
3. The unit test's hand-written `---`/`+++` lines lacked the trailing TAB Git writes for a spaced name. Fixed: the fixture is now byte-equal to a real Git 2.50.1 patch.
4. "Why This Works" greedy-match note applied only to unquoted headers. Fixed.

The reviewer also checked: the quoted and unquoted alternatives cannot be confused; an escaped `\"` cannot end the path early (real Git cases `x" "b/y.txt`, `end"`, `한 b/y.txt`); multi-byte octal (4-byte emoji, NFD Hangul); quoted `---`/`+++` lines are not counted; both new tests give `변경 없음` against the base `changeSummary`; the pair test's expected order matches Git's byte order; every line reference in the learning doc; typecheck exit 0.

Pass 2 (the delta) — "Ready to merge: Yes". Critical 0, Important 0, Minor 1: "control characters stay as written" was broader than the code (Git writes control bytes other than `\a \b \t \n \v \f \r` in octal, and `unquote` decodes them; only DEL is reachable, invisible, and cannot add a line). Fixed by narrowing the comment and doc to letter escapes; no behavior change.

Declined by the reviewer as pre-existing or unreachable (not changed here): unquoted paths containing ` a/`/` b/` are named after their last part; a file↔symlink change lists the path twice; content lines starting with `--`/`++` are not counted; `, ` inside a path makes the list ambiguous; non-UTF-8 path bytes decode to U+FFFD.
