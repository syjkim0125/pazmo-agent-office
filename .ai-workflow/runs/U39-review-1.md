# U39 workflow-review — attempt 1 (HEAD e89cd58, base 0acd1d9)

Two independent whole-branch reviewers (most capable model), read-only, over the full 16-commit diff:
- Reviewer 1, overall correctness / integration / regressions / tests: ready with fixes — Critical 0, Important 5, Minor 11. Full report: .ai-workflow/runs/U39-review-1a.md
- Reviewer 2, security / authorization / approval trust: ready with fixes — Critical 0, Important 1, Minor 8. Full report: .ai-workflow/runs/U39-review-1b.md

Important findings (to fix before verification):
1. (R2) The Task file's `risk` alone decides whether G3 is checked; a high-risk Story can be uploaded as "normal" and skip the design gate (src/team/upload.ts:237-247).
2. (R1) "취소한 것도 보기" never shows cancelled Task cards (board() returns column "hidden"; board-pages draws only five columns).
3. (R1) The guide copied on `mac connect` puts the managed marker before the `---` front matter, so claude likely does not load it as a skill.
4. (R1) The live swap closes open <details> and drops selection/focus every minute on pages with minute-level times.
5. (R1) When live refresh stops, `html.live` stays on: the page still says "저절로 업데이트" and hides the refresh link.
6. (R1) V20's "web-planned and uploaded Stories on the same board" has no automated test.

Triage of deferred minors: fix the missing STATE / HUB_UNREACHABLE / HUB_BAD_RESPONSE codes in SKILL.md and LOCAL-PREVIEW with item 3; the live selection/focus minor is part of item 4; others stay deferred.
Residual trust note (R2, accepted model, not widened by the code): a local G1 record is an unauthenticated file, and the old link `publish`/`open` routes still open Stories with no G1; only the "로컬 승인" line tells them apart.
