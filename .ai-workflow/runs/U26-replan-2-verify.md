# U26 replan-2 fresh verification (2026-10-30)

Branch `codex/discovery-stop-grace`: 7c949ab (D31 change) + merge 13c48ff (origin/main f568734), plus the uncommitted D31 decision/hedge and docs.

- Full `npm test` after the D31 hedge: **1106/1106**, fail 0, cancelled 0, exit 0. Started 14:32:39, ended 14:34:53 KST, load average 15–27, no other full run. Last product-code change (src/cli/lifecycle.ts comment) 14:31:49, before the run. `npm run build:office` was rerun after the merge (exit 0).
- Full `npm test` right after the merge with the D31 decision (before the hedge): 1106/1106 exit 0, 14:28–14:30.
- typecheck exit 0; Story check exit 0 (re-run now).
- Related after the merge: runner-models + runner-settings + team-registry 57/57; lean-lifecycle startup guard 1/1.
- Earlier evidence for the behavior (RED before the change, mutations 4/4, two pre-merge full runs 1106/1106): run `U26-discovery-stop-grace.json`.

Limits: no new real-CLI run; real lean start time under load not measured; a claude that does not answer within 15 s makes discovery up to 32 s, beyond the 30 s lean wait, kept knowingly by the user's choice (D31).
