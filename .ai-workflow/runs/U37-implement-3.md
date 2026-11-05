# U37 implement, attempt 3 (fixes after review attempt 2)

Tree: `claude/silly-liskov-b64760` at `917d4c9` (range `3a282fa..917d4c9`, 3 commits), the same fix implementer resumed with G1–G2 of `U37-review-2.md`.

| Fix | Commit | What |
|---|---|---|
| G1 | `45aa383` | the pick rule checks BUSY before NOT_LINKED (STATE → FORBIDDEN → BUSY → NOT_LINKED); rerun unchanged; store and page tests |
| G2 | `2515a15` | a Story verification Task's release line has its own words; one page assertion |
| G1/G2 docs | `917d4c9` | plan "리뷰 뒤 바뀐 것" line, record rows and "리뷰 2차 뒤 고친 것", the narrow reachable-repo windows as limits (record and LOCAL-PREVIEW) |

TDD: G1 RED 3/20 failed (the NOT_LINKED message, memberWork `not-linked`), GREEN 54/54 over three files; G2 RED 1/1, GREEN 30/30.

## Checks

- Focused 8 files: 187/187, exit 0.
- Full `npm test` (one run, nothing else testing, code at `2515a15`; `917d4c9` adds docs only): **1619/1619**, exit 0, 111 s (2 new tests).
- `npm run typecheck`: exit 0. Story check: exit 0.
