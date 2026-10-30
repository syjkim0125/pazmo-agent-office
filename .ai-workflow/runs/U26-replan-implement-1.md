# U26 replan: implement (2026-10-30)

Why a new run: the user answered the open question from review 2 (N4) with "그대로" (keep the lean start wait at 30 s). D31 now records that decision, which changed the Story; the earlier run `.ai-workflow/runs/U26-discovery-stop-grace.json` (implement x2, review x2, verify, action g4 before the edit) is kept as evidence.

Changes in this attempt:
- Story D31: names the Claw requests that wait for discovery, says "live lean Office", and records that a claude using its whole 15 s answer limit makes discovery up to 32 s so such a start may time out, and that 30 s is kept knowingly because the discovery claude gets EOF when the service exits and ends by itself (user confirmation "그대로", 2026-10-30).
- Merged origin/main f568734 (#48 internal-name aliases, #49 gitignore) into the branch: merge commit 13c48ff, no conflicts.
- Product code and tests unchanged since commit 7c949ab (CLAUDE_STOP_MS term 12 s frozen; STARTUP_MS.lean 30 s; tests as reviewed in the earlier run, RED/GREEN and mutations 4/4 there).

Fresh checks after the merge: runner-models + runner-settings + team-registry 57/57; lean-lifecycle "lean start wait" 1/1; typecheck exit 0; Story check exit 0.
