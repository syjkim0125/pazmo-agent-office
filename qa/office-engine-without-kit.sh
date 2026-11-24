#!/usr/bin/env bash
# QA checks for docs/stories/office-engine-without-kit.md (the script scenarios: Q1, Q5, Q6's upload guide, Q9).
# Run from the repository root, Node 24 first on PATH: bash qa/office-engine-without-kit.sh
# These checks run commands only, so BASE_URL is not used. Prints PASS/FAIL per scenario id; exits 1 when any fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }

# Q1: no workflow runtime in the tree, and only the local upload (step 4, O1) still names the PL project's kit records.
n=$(git ls-files .ai-workflow | wc -l | tr -d ' ')
[ "$n" = 0 ] && pass Q1 "git ls-files .ai-workflow: 0 files" || fail Q1 "git ls-files .ai-workflow: $n files"
refs=$(git grep -l -E '\.ai-workflow/|kit-role-runs|KitDelivery|KitPlanning' -- src tests | sort | tr '\n' ' ')
allowed="src/team/upload.ts tests/hub-upload-office.test.mjs tests/team-upload.test.mjs "
[ "$refs" = "$allowed" ] && pass Q1 "workflow references only in: $refs" || fail Q1 "workflow references in: ${refs:-none}, expected: $allowed"

# Q5: a fixed Story keeps the hash it had under the removed runtime (Hub upload keys depend on it).
hash=$(node --input-type=module -e '
const story = "# Story: Validate input\nStatus: Draft\nOwner: Human\n\n## Goal\nReject invalid input.\n## Domain\nPreserve existing records.\n## MUST\n- M1. Reject invalid input.\n## SHOULD\n- S1. Explain errors.\n## OUT\n- O1. Deployment.\n## Decisions\n- D1. Local only.\n## Verify\n- V1 [M1]. Check invalid input.\n";
let f;
try { f = (await import(process.cwd() + "/src/core/story-hash.ts")).hashStory; }
catch { f = (await import(process.cwd() + "/src/core/kit-role-runs.ts")).kitStoryHash; }
console.log(f(story));' 2>&1)
expected=5858498905450b3a6c51a6591a5b09d298e876c8a152d10106e671b88bba5158
[ "$hash" = "$expected" ] && pass Q5 "story hash $hash" || fail Q5 "story hash $hash, expected $expected"

# Q6 (part): the local upload guide still prints as before.
guide=$(node bin/pazmo-office.mjs team upload --guide 2>&1)
grep -qF "name: pazmo-hub-upload" <<<"$guide" && pass Q6 "team upload --guide prints the pazmo-hub-upload guide" || fail Q6 "team upload --guide: $(head -1 <<<"$guide")"

# Q9: a "kit" word (not -webkit-) remains only in the kit-era stop (가) and its tests, and in the step 4 (O1) parts.
left=$(git grep -lIi -E '(^|[^a-z-])kit' -- src tests scripts upstream | sort | tr '\n' ' ')
allowed9="src/cli/index.ts src/cli/team.ts src/core/legacy-tasks.ts src/hub/plan-pages.ts src/hub/story-approve.ts src/hub/story-store.ts src/team/upload.ts tests/coordinator.test.mjs tests/hub-plan-pages.test.mjs tests/hub-story-approve.test.mjs tests/hub-story-upload.test.mjs tests/hub-upload-office.test.mjs tests/native-office.test.mjs tests/planning-coordinator.test.mjs tests/team-upload.test.mjs "
[ "$left" = "$allowed9" ] && pass Q9 "kit words only in the (가) stop and step 4 parts (15 files)" || fail Q9 "kit words in: $left"

exit $failed
