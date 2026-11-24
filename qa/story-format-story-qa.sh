#!/usr/bin/env bash
# QA checks for docs/stories/story-format-story-qa.md (the script scenarios: Q1, Q2, Q5, Q6, Q7, Q8, Q9, Q11, Q13; S2 of the
# progress log small change approved on 2026-11-24).
# Q10 is `npm test` and `npm run typecheck`, run on their own (one full test run at a time on this Mac).
# Run from the repository root, Node 24 first on PATH: bash qa/story-format-story-qa.sh
# These checks run commands only, so BASE_URL is not used. Prints PASS/FAIL per scenario id; exits 1 when any fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }
run() { node --input-type=module -e "$1" 2>&1; }
ROOT=$(pwd)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

# A PM result in the story-qa shape, as Office's PM returns it.
PM_STORY='{
  title: "인사말 도구",
  asIs: "인사말을 만드는 함수가 없다.",
  toBe: "greet(name)이 \"안녕, <name>\"을 돌려준다.",
  unchanged: "다른 모듈의 공개 함수는 그대로다.",
  decisions: [{ fork: "이름이 비었을 때", options: ["오류", "\"안녕\"만"], pick: "오류", because: "src/a.ts:3이 빈 값을 오류로 다룬다" }],
  copies: "",
  must: ["greet(name)이 인사말을 돌려준다.", "빈 이름은 오류다."],
  out: ["다국어: 요청 밖이다."],
  qa: [
    { refs: ["M1"], how: "script", scenario: "node -e로 greet(\"지수\")를 부른다 → \"안녕, 지수\"" },
    { refs: ["M2"], how: "script", scenario: "greet(\"\")를 부른다 → 오류" },
    { refs: ["Unchanged"], how: "script", scenario: "npm test → 기존 시험이 통과한다" },
    { refs: ["not shown"], how: "agent", scenario: "README → 인사말 설명이 없다" }
  ]
}'

# Q1: the rendered Story follows the story-qa template.
out=$(run "
const { renderPlanningStory } = await import('$ROOT/src/runners/planning.ts');
const text = renderPlanningStory($PM_STORY);
const heads = [...text.matchAll(/^## (.+)\$/gm)].map((m) => m[1]).join('|');
const tail = text.trimEnd().split('\n').slice(-3).join('|');
const qa = /^- Q1 \[M1\] \(script\)\. /m.test(text);
const kit = /^## (Verify|Domain)\$|Understanding gate/m.test(text);
console.log(heads + ' / ' + tail + ' / qa=' + qa + ' / kit=' + kit);")
want="Goal|Decisions|MUST|OUT|QA / ---|Status: Draft|Owner: Human / qa=true / kit=false"
[ "$out" = "$want" ] && pass Q1 "$out" || fail Q1 "got: $out; want: $want"

# Q2: the contract shape check takes the new Story and refuses a kit Story for its missing QA section.
out=$(run "
const { renderPlanningStory } = await import('$ROOT/src/runners/planning.ts');
const { storyShapeErrors } = await import('$ROOT/src/core/contract-shape.ts');
const kit = '# Story: Validate input\nStatus: Draft\nOwner: Human\n\n## Goal\nReject invalid input.\n## Domain\nPreserve existing records.\n## MUST\n- M1. Reject invalid input.\n## SHOULD\n- S1. Explain errors.\n## OUT\n- O1. Deployment.\n## Decisions\n- D1. Local only.\n## Verify\n- V1 [M1]. Check invalid input.\n';
const a = storyShapeErrors('$SCRATCH', renderPlanningStory($PM_STORY));
const b = storyShapeErrors('$SCRATCH', kit);
console.log('new=' + a.length + ' / kitQA=' + b.some((e) => /\bQA\b/.test(e)));")
[ "$out" = "new=0 / kitQA=true" ] && pass Q2 "$out" || fail Q2 "got: $out; want: new=0 / kitQA=true"

# Q5: the result approval QA list reads the new Story's Q lines with their method, and an old kit Story as before.
out=$(run "
const { renderPlanningStory } = await import('$ROOT/src/runners/planning.ts');
const { approvalPlan } = await import('$ROOT/src/hub/story-approve.ts');
const base = { number: 3, title: 't', repos: [], tasks: [] };
const fresh = approvalPlan({ ...base, body: renderPlanningStory($PM_STORY) }).qa;
const old = approvalPlan({ ...base, body: '# Story: t\n\n## MUST\n- M1. 된다.\n\n## Verify\n- V1 [M1]. 시험이 통과한다.\n' }).qa;
console.log('new=' + fresh.some((l) => l.startsWith('Q1 [M1] (script)')) + ' / old=' + old.includes('V1 [M1]. 시험이 통과한다. — 이 장면 그대로인지'));")
[ "$out" = "new=true / old=true" ] && pass Q5 "$out" || fail Q5 "got: $out; want: new=true / old=true"

# Q6: the local upload takes a story-qa Story marked Approved, refuses a Draft and a kit Story, and its guide points to /story-qa.
mkdir -p "$SCRATCH/up"
out=$(run "
import { writeFileSync } from 'node:fs';
const { renderPlanningStory } = await import('$ROOT/src/runners/planning.ts');
const { checkUpload } = await import('$ROOT/src/team/upload.ts');
const dir = '$SCRATCH/up';
const project = { id: 'p1', name: 'demo', repos: [{ id: 'r-be', name: 'app-be', baseBranch: 'main' }] };
const check = (id) => ({ id, argv: ['npm', 'test'], timeoutMs: 120000 });
writeFileSync(dir + '/tasks.json', JSON.stringify({ project: 'demo', risk: 'normal', repos: [{ name: 'app-be', baseBranch: 'main' }],
  tasks: [{ id: 'be', repo: 'app-be', title: '인사말', spec: '함수를 만든다', files: ['src/greet.ts'], covers: ['M1', 'M2', 'Q1', 'Q2', 'Q3', 'Q4'], after: [], checks: ['Q1', 'Q2', 'Q3', 'Q4'].map(check) }],
  storyChecks: [{ repo: 'app-be', checks: [check('Q3')] }] }));
const draft = renderPlanningStory($PM_STORY);
const code = (text) => { writeFileSync(dir + '/story.md', text); try { checkUpload(dir + '/story.md', dir + '/tasks.json', project); return 'ok'; } catch (e) { return e.code + (/story-qa/.test(e.message) ? '+story-qa' : ''); } };
const kit = '# Story: t\nStatus: Approved\nOwner: x\nUnderstanding gate (G1): a.json · 2026-11-11 · Check-in: accepted\n\n## Goal\ng\n\n## MUST\n- M1. m\n\n## Verify\n- V1 [M1]. v\n';
console.log('approved=' + code(draft.replace(/^Status: Draft\$/m, 'Status: Approved')) + ' / draft=' + code(draft) + ' / kit=' + code(kit));")
want="approved=ok / draft=UPLOAD_G1 / kit=UPLOAD_STORY+story-qa"
[ "$out" = "$want" ] && pass Q6 "$out" || fail Q6 "got: $out; want: $want"
guide=$(node bin/pazmo-office.mjs team upload --guide 2>&1)
if grep -qF "/story-qa" <<<"$guide" && ! grep -qF "/workflow" <<<"$guide"; then pass Q6 "team upload --guide names /story-qa, not /workflow"
else fail Q6 "team upload --guide: /story-qa $(grep -cF "/story-qa" <<<"$guide"), /workflow $(grep -cF "/workflow" <<<"$guide")"; fi

# Q7: the Hub takes Q and V check ids and refuses any other.
out=$(run "
const { validateStoryVerify } = await import('$ROOT/src/hub/story-protocol.ts');
const ids = new Set(['r1']);
const take = (id) => { try { validateStoryVerify([{ repoId: 'r1', checks: [{ id, argv: ['npm', 'test'], timeoutMs: 1000 }] }], ids); return 'ok'; } catch { return 'refused'; } };
console.log('Q1=' + take('Q1') + ' / V1=' + take('V1') + ' / X1=' + take('X1'));")
[ "$out" = "Q1=ok / V1=ok / X1=refused" ] && pass Q7 "$out" || fail Q7 "got: $out; want: Q1=ok / V1=ok / X1=refused"

# Q8: a planning saved with an old-format PM Story stops with the reason; other plans run (tests/story-format-legacy.test.mjs).
if [ -f tests/story-format-legacy.test.mjs ]; then
  out=$(node --experimental-vm-modules --test tests/story-format-legacy.test.mjs 2>&1)
  if grep -qE '^ℹ fail 0$' <<<"$out" && grep -qF "옛 Story 형식으로 만든 기획입니다" <<<"$out"; then pass Q8 "$(grep -E '^ℹ (pass|fail) ' <<<"$out" | tr '\n' ' ')"
  else fail Q8 "$(grep -E '^ℹ (pass|fail) |^not ok' <<<"$out" | tr '\n' ' ')"; fi
else fail Q8 "tests/story-format-legacy.test.mjs is missing"; fi

# Q9: the Story hash is unchanged for the step 3 fixed Story, and a draft and its approved copy hash the same.
out=$(run "
const { hashStory } = await import('$ROOT/src/core/story-hash.ts');
const { renderTeamStory, approvedStory } = await import('$ROOT/src/runners/team-planning.ts');
const old = '# Story: Validate input\nStatus: Draft\nOwner: Human\n\n## Goal\nReject invalid input.\n## Domain\nPreserve existing records.\n## MUST\n- M1. Reject invalid input.\n## SHOULD\n- S1. Explain errors.\n## OUT\n- O1. Deployment.\n## Decisions\n- D1. Local only.\n## Verify\n- V1 [M1]. Check invalid input.\n';
const draft = renderTeamStory($PM_STORY, [{ question: '빈 이름은?', answer: '오류' }]);
const approved = approvedStory(draft, { approvalId: 'a1', gate: 'G1', memberId: 'm1', at: Date.UTC(2026, 10, 24), textHash: 'x' });
console.log(hashStory(old) + ' / same=' + (hashStory(draft) === hashStory(approved)) + ' / changed=' + (draft !== approved));")
want="5858498905450b3a6c51a6591a5b09d298e876c8a152d10106e671b88bba5158 / same=true / changed=true"
[ "$out" = "$want" ] && pass Q9 "$out" || fail Q9 "got: $out; want: $want"

# Q13 (added after approval, M9): the planning profile PM and Lead read asks for the request's language, headings in English.
out=$(run "
const { loadRoleProfile } = await import('$ROOT/src/runners/role-profiles.ts');
const text = (role) => loadRoleProfile(role).files.map((f) => f.content).join('\\n');
const ok = (role) => text(role).includes(\"Write every text value in the language of the person's request\") && text(role).includes('Keep headings and markers in English');
console.log('pm=' + ok('pm') + ' / lead=' + ok('lead'));")
[ "$out" = "pm=true / lead=true" ] && pass Q13 "$out" || fail Q13 "got: $out; want: pm=true / lead=true"

# S2 (small change, progress log in a scrolling box): the Office web tests pass and the fold button's words are gone.
out=$(node --experimental-vm-modules --test tests/lean-web.test.mjs 2>&1)
left=$(git grep -c -e "이전 기록" -e "eventsUnfold" -e "eventsFold" -- src/lean/web | wc -l | tr -d ' ')
if grep -qE '^ℹ fail 0$' <<<"$out" && [ "$left" = 0 ]; then pass S2 "lean-web $(grep -E '^ℹ pass ' <<<"$out"), fold words in src/lean/web: 0 files"
else fail S2 "lean-web $(grep -E '^ℹ (pass|fail) ' <<<"$out" | tr '\n' ' '), fold words in $left files"; fi

# Q11: no template copies in the tree or from init, and "kit" (not -webkit-) only in the (가) stop and its tests.
n=$(git ls-files templates/ai-workflow | wc -l | tr -d ' ')
[ "$n" = 0 ] && pass Q11 "git ls-files templates/ai-workflow: 0 files" || fail Q11 "git ls-files templates/ai-workflow: $n files"
mkdir -p "$SCRATCH/proj" && git -C "$SCRATCH/proj" init -q
node bin/pazmo-office.mjs init --project "$SCRATCH/proj" --data-dir "$SCRATCH/data" --apply >/dev/null 2>&1
made=$(ls "$SCRATCH/proj/.pazmo-office" 2>/dev/null | tr '\n' ' ')
if [ -n "$made" ] && ! grep -qE '(^| )(STORY|TASK)\.md( |$)' <<<"$made"; then pass Q11 "init made: $made"
else fail Q11 "init made: ${made:-nothing}"; fi
left=$(git grep -lIi -E '(^|[^a-z-])kit' -- src tests skills assets | sort | tr '\n' ' ')
allowed="src/core/legacy-tasks.ts tests/coordinator.test.mjs tests/native-office.test.mjs tests/planning-coordinator.test.mjs "
[ "$left" = "$allowed" ] && pass Q11 "kit words only in the (가) stop and its tests" || fail Q11 "kit words in: $left"

exit $failed
