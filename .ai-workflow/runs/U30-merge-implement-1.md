# U30 merge · implement (attempt 1)

Merge c0bfef5 = this branch (014e9bc, the U30 replan run finished at status g4 on 25d3df7) + origin/main f4478f3 (#62, #63 and doc refreshes since bf3f31c).
The only file both sides changed is docs/STATUS.md: both added a top entry; resolved by keeping both (this change first, then main's "3줄 요약: 따옴표(비ASCII) 경로").
In the same merge commit, the overclaim the round-3 review found was corrected in docs/STATUS.md and docs/verification/2026-11-03-kit5-upgrade.md (Important: 3 Fixed, 1 Partly, remainder accepted).
main's code change (src/runtime/decision-summary.ts with tests candidate-diff/decision-summary) does not touch any file of this change. The Story is unchanged by main; the G1 JSON binding still holds (storyHash equal).
