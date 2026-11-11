# U39 implement — attempt 2 (fix wave after review attempt 1)

Base e89cd58, head eab3265. One fixer, each fix test-first (RED then GREEN). Full report kept beside the run: findings from .ai-workflow/runs/U39-review-1.md.

| Finding | Commit | Covering tests |
|---|---|---|
| 1 G3 skipped by risk "normal" → high when Task file says high, kit profile requiresG3, or a G3 line in the Story; else UPLOAD_G3 | 2291121 | tests/team-upload.test.mjs |
| 7 Hub refuses storyHash ≠ kitStoryHash(body) (400 INVALID) | a8db08d | tests/hub-story-upload.test.mjs |
| 2 cancelled cards shown in a "취소됨" strip only with the toggle | f395b9e | tests/hub-board-page.test.mjs |
| 6 V20: web-planned and uploaded Stories on the same board | 03c8d11 | tests/hub-board-page.test.mjs (mutation-checked) |
| 4+5 live swap keeps open details, waits while text is selected, restores focus by id; stop() removes html.live | 37a3b34 | tests/hub-live.test.mjs (vm) |
| 3 guide SKILL.md byte-equal to the source with a `.pazmo-managed` sidecar; symlinks kept; STATE/HUB_UNREACHABLE/HUB_BAD_RESPONSE added to SKILL.md and LOCAL-PREVIEW | c1c2685 | tests/mac-skill-copy.test.mjs, tests/team-mac-cli.test.mjs |
| change record section "마지막 리뷰 뒤 고친 것" | eab3265 | — |

Tests at eab3265: focused hub/team/mac 1062/1062; full `npm test` 1841/1841 (10 new); `npm run typecheck` exit 0. One earlier focused run had 1061/1062 (team-executor "a conflict counts an attempt…", untouched by this change; passed 41/41 three times alone and in the full run) — recorded as a load flake.
