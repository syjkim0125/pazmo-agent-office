# U30 replan · implement (attempt 1)

Commits: 73702d4 (kit 5.0.3 install + Office v3 role runs + tests), 2a766a8 (decision, plan, profile, G1 JSON, runs, docs), df48a79 (merge origin/main #60 #61, STATUS conflict resolved keeping both).

What: kit 4.1.0 -> 5.0.3 installed from the official npm tarball (sha512 equal to the registry). Office role runs are v3: PM/Lead in .pazmo-office/kit-runs/, Developer/Reviewer in a per-task kit folder whose only snapshot input is candidate.json; checks run once in the VM and kit's verify executes only the Office relay; G1 records are kit 5 JSON; Verify lines outside the Task are marked; kit 4 tasks stop with KIT_UPGRADE_REQUIRED.

RED: before the change, kit 5.0.3 on main 226cbf1 failed 22/1276 tests (coordinator 9, kit-role-runs 6, planning-coordinator 7); probe errors: G1 binding missing, verification.json ENOENT, "Verification execution required for V1", spawn npm ENOENT, reviewer stale after a person's edit.
GREEN: npm test 1284/1284 exit 0 (336 s, load 27-39); typecheck exit 0; Story check exit 0; coordinator 24/24, kit-role-runs 10/10, planning-coordinator 34/34.
Mutations caught: removing GIT_CEILING_DIRECTORIES (reviewer test fails), disabling the kit 4 completion pass-through, disabling the outside-Task V marking.
Deviation from the G3 ASSUMED: kit 4 in-flight tasks stop (KIT_UPGRADE_REQUIRED) instead of re-running review/verification in v3; reason in docs/understanding/kit5-upgrade-decision.md.
Simplify: reviewed the diff; no change beyond what tests need.
