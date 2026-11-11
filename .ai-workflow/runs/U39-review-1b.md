# Final whole-branch review 2 of 2: security, authorization, approval trust

Range: 0acd1d9..e89cd58 (D42: Hub board, live refresh, landing, local upload, guide copy).
Method: read the diff package in passes (server/paths/live/pages, store/link-api/story-store, upload/story-bases/planner, CLI/mac guide copy, story/board pages, tests for the upload and landing paths). Outside the diff I checked one thing per named risk: `HubStore.#macRows`/`pollMac` (can a member have two live Macs), `transaction()` (does a refusal inside `uploadStory` roll back the nested `publishStory`), `branch.ts` `git`/`fetchTip`/`pushRef`/`pushStoryBase` (what the clone and the remote can be changed by), kit `check.mjs` `evidencePath` (what the kit itself does about symlinks), and `SSH_AUTH_SOCK` in other GitEnv builders. I ran one scratch-repo experiment (in the session scratchpad, not this worktree) for git's `fetch.prune`/`fetch.pruneTags` doubt; result below. I did not run the test suite.

## Strengths

- `safePath` (src/hub/paths.ts:1-12) is an anchored allowlist (exact pages plus `/(stories|tasks|plans)/<36 hex/dash>`), refuses `//`, `\`, control chars and `%2f`, caps length, and drops every query. All three consumers go through it: the remembered pre-sign-in path (server.ts:186, set only on a signed-out GET of an allowlisted path), the invite redirect (server.ts:170, decoded then re-validated, cookie cleared on use), and the switch's `back` (server.ts:412). No open redirect or header injection is reachable: the cookie value and every `Location` are restricted to `[/a-z0-9-]`.
- The live refresh is narrow: `/live.js` is static and secret-free; CSP gains only `connect-src 'self'` (server.ts HEADERS); the ETag is computed only for `GET` + `200` + `text/html` (server.ts:60-70), signed-out pages are 401 so they never get one, and every response keeps `cache-control: no-store`. The tag is a hash of a page that embeds the member's CSRF token and name, so it is per user and a 304 tells the requester nothing they could not already read. `<meta name="etag">` is inserted only when the page carries the script tag; user text is escaped, so content cannot fake that tag. POST results and one-time values (`page.created`) never get `live`.
- Every new rendered value is escaped (board-pages.ts:265-317, story-pages.ts upload/approval/cancel block, pages.ts `teamPage`/`boardHeader`). The swap is `main.innerHTML` of a same-origin, server-escaped page, and CSP `script-src 'self'` stops inline handlers anyway.
- Hub upload authorization is in the store and is done in the right order (story-store.ts:831-866): hash shape, then `#currentMac` (link minted by the member's newest live Mac; connection-string links have `macId` null and are refused), then project existence, then `ownsProject`, then the per-PL key. `pollMac` revokes every earlier Mac and its links, so an "older live Mac" cannot exist outside a hand-made test row, and a revoked Mac's links are already dead in `link()`. A replay must also come from the current Mac, because `#currentMac` runs before the idempotency lookup. The whole thing is one transaction, and `transaction()` nests as a savepoint, so a refusal leaves no Story and no record.
- `upload-bases` takes the same current-Mac check plus `#assertPl`, stores each repo once (`mergeBases`: 40-hex, repo in the Story's project, `__proto__` keys fail `names.has`), and accepts a new repo only while the Story is a draft (story-store.ts:881-902). The web [취소] needs CSRF, Origin, the confirm box, PL-or-admin, and an uploaded draft (server.ts:433-445, story-store.ts:909-916). Tests cover no Origin, wrong CSRF, a non-PL, an opened upload, and a non-upload draft.
- The only remote write is `pushStoryBase` (branch.ts:560-592): it checks the name against `^feature/story-\d+/base$` and needs a full object id. The refspec is a single `sha:refs/heads/...` with no `+` and no delete. Hooks are off (`core.hooksPath=/dev/null`). `BASE_EXISTS` is decided by `ls-remote` before and after the push. The command also refuses a Hub-supplied `storyBase` that does not equal `storyBaseBranch(number)` (upload.ts:540), and `checkBase` stops option-like base branch names from a hostile Hub.
- The PL's registered clone: `fetchTip` writes only objects and FETCH_HEAD (`--refmap=`, `--no-tags`, no destination), and the test pins HEAD, `refs/heads`, the index and porcelain status (tests/hub-upload-office.test.mjs:223-257). I also checked that a user config of `fetch.prune=true` + `fetch.pruneTags=true` (or the `remote.origin.*` forms) does not prune tags or move any ref with this exact command line (git 2.50.1, scratch repo).
- Header-named files: absolute paths and `..` escapes are refused (upload.ts:102-112). Gate record and design contents are only parsed or hashed, never sent or echoed. The parser message is not shown.
- The guide copy never overwrites a file without a valid managed header whose hash matches its body (mac.ts:264-278), and `rename` replaces a final-path symlink instead of writing through it.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

1. **An AI-written Task-file field can skip the G3 human gate.**
   - File: src/team/upload.ts:237-247 (also skills/pazmo-hub-upload/SKILL.md:32,39; Hub side story-store.ts:849 via `publishStory`, which takes `risk` from the request).
   - What is wrong: whether G3 is checked at all is decided only by `raw.risk` in the Task file, which the PL's claude writes and no approval binds (the kit hash covers the Story text, and the Story text has no risk field). Three things are ignored: the kit's own requirement (`requiresG3` in `.ai-workflow/verification.json`, the same file `designPath` already reads for `design`), a `Understanding gate (G3):` line present in the Story, and a G3 record that is stale or missing while the profile requires it. The Hub cannot tell either, and shows "위험도 보통".
   - Attack or failure scenario: the PL runs a high-risk kit Story. The profile has `requiresG3: true` and `design: docs/x-design.md`, but G3 is not given yet, or the design changed after G3. Claude writes `tasks.json` with `"risk": "normal"`, the value SKILL.md's example shows. `checkUpload` passes on G1 alone and never reads the profile. The Story uploads, bases are pushed, it opens, and teammates' Offices start building with no approved design. A human gate was removed without any human decision. In the web flow the PL picks risk with a click; in this flow nobody does.
   - Why it matters: D42(5) and K2 make the local G1/G3 binding the command's whole trust check. This is a gate bypass, not a forgery, so the ASSUMED trust model ("a local G1 is trusted because it comes from the PL's Mac") does not cover it. The plan says "높은 위험이면 G3" but is silent on who decides high risk locally. A reasonable person, and the kit, would say the kit profile decides.
   - Fix: treat the Story as high risk when the profile under `gateRoot` has `requiresG3 === true`, or when the Story carries a G3 line. Refuse `risk: "normal"` in that case with UPLOAD_G3 (or force `high` and run the G3 checks). Add a team-upload test: profile requires G3, Task file says normal, refused. Say this in SKILL.md (risk must be `high` when the kit requires G3).

### Minor (Nice to Have)

1. **The Hub does not bind the recorded Story hash to the uploaded body.** story-store.ts:837-855 stores client-supplied `storyHash` and `body` independently; the key `upload:<storyHash>` and the "로컬 승인 · Story 해시" shown on the Story page are whatever the client claims (tests/hub-story-upload.test.mjs uses `body: "# Story\n본문"` with hash `a…a`). Within the trust model the command is the only client, so this holds today. But the badge is meant as evidence for teammates and later G4, and invariant 2 ("one Story per text") rests on the client hashing honestly. `kitStoryHash` is a pure function (src/core/kit-role-runs.ts:26), so the Hub can recompute it and refuse a mismatch for a few lines of code.
2. **An upload replay ignores the requested project and the new graph.** `publishStory` keys only on (PL, key) (story-store.ts:680-684), so `uploadStory` with the same hash and another `projectId` returns the first Story (`already: true`, project A). Only ownership of the *new* project is checked (story-store.ts:841). The command does not compare: it takes `view.branches` of Story A and finishes A's bases and open (upload.ts:530-578). So "upload to B" can silently open the draft in A, or report success for A. Likewise, a fixed Task file re-run after a failure is silently ignored (the first graph wins). No wrong-repo push happens, because branches come from the Story's own project. Fix: return `projectId` from upload and refuse a mismatch in the command (or in the Hub), and state the graph-wins behaviour in the guide.
3. **The guide copy uses a predictable temp name with a non-exclusive write, and follows directory symlinks.** mac.ts:274-277: `writeFileSync(\`${target}.${process.pid}.tmp\`)` follows a pre-existing symlink at that name, and `mkdirSync(..., {recursive})` writes into a symlinked `~/.claude/skills[/pazmo-hub-upload]`. A symlinked `SKILL.md` whose target carries our valid header is replaced by a regular file, which breaks the user's dotfiles link without touching its content. No privilege boundary is crossed on a single-user Mac. The codebase's own pattern (`writeLinkConfig`/`writeMacLink`: `randomUUID()` + `flag: "wx"`, `noSymlinks`) is the fix. The stray-tmp minor from the ledger is the same spot.
4. **`projectText` has no realpath containment, unlike the kit's `evidencePath`.** upload.ts:102-112 vs .ai-workflow/bin/check.mjs:62-67. `gateRoot` can also climb to `~` when the home has `.ai-workflow/` (upload.ts:83-93). Nothing read leaves the machine (parse or hash only; errors name the path, not the content), so this is kit parity and a hang risk (a symlink to `/dev/zero`), not a disclosure. Already deferred in the ledger; I agree it is Minor.
5. **The guide does not forbid the agent from writing or editing gate records.** SKILL.md:18-24 and the UPLOAD_G1/UPLOAD_G3 rows say "get G1 again through the kit workflow". There is no explicit line saying "never create or edit a G1/G3 record or its storyHash yourself; only the PL's answer in the kit workflow does". This guide is installed globally into the PL's claude, which is the same agent that receives UPLOAD_G1 ("G1 기록이 지금 Story 글과 맞지 않습니다") and could "fix" it by rewriting `storyHash`. One sentence closes the most likely path to a self-approved upload (see the trust-model note below).
6. **The upload command's git env drops `SSH_AUTH_SOCK`.** upload.ts:544 builds `{home, pathEnv}`, while mac.ts:167 and lifecycle.ts:482 pass `sshAuthSock`. Clones that authenticate only through an agent socket fail fetch and push with GIT_FAILED. This is functional, not a security issue; the fix is one line.
7. **The fetch in the PL's clone overwrites FETCH_HEAD.** branch.ts:157-165. If the PL had just run `git fetch origin x` and then runs `git merge FETCH_HEAD`, they merge the base-branch tip instead. Ruling line 80 allows the fetch; FETCH_HEAD is not in its list. A one-line note in LOCAL-PREVIEW and the guide is enough.
8. **`retiredMacLink` ignores `l.revoked_at` and ownership.** store.ts:750-756. A link revoked by hand on /repos whose Mac was later replaced answers 403 NOT_YOUR_MAC instead of 401. It reveals that only to a holder of the full 43-char token. This is cosmetic, and the ruling stands.

## Rulings challenged

- Line 65 (403 NOT_YOUR_MAC for a retired Mac's token, upload routes only): it discloses only "this token's Mac was retired", and only to whoever holds the token. Accepted. See Minor 8 for a wording edge.
- Line 80 (fetch and push in the PL's registered clone): verified as stated. Objects plus FETCH_HEAD only; one explicit non-force refspec; hooks off. Prune configs checked experimentally. Accepted, with Minor 7.
- Line 81 (empty upload call after a 401): `str(body, "projectId")` throws before the store runs (link-api.ts:124), so it has no side effect even if the token turned valid in between. Accepted.
- Line 70 (STATE for a non-upload Story under `upload:<hash>`): a PL can block only their own upload, by publishing with that key on the plain route. Accepted.
- Line 76 (gate root = nearest ancestor with `.ai-workflow/`): acceptable only because nothing read leaves the machine. Pair it with Minor 4.
- Line 91 (no managed header means the PL's file is kept), lines 40 and 52 (query dropped): safe. Accepted.
- No ruling creates a real security problem. Important 1 is a gap no ruling addressed.

## Trust model (Story D42 ASSUMED, D41 "승인 신뢰")

The model has a hole, and the code neither creates nor widens it, apart from Important 1:

- A local G1 record is an unauthenticated JSON file (`gate`, `storyHash`, non-empty `responseRef`). The agent that runs the upload can write one. Records committed to git, as this repo does, can be replayed by any other member who owns every repo of some project, from *their* current Mac. The Hub then shows "로컬 승인 · <uploader's Mac>", which names the uploader, not the approver. This matches kit 5's own statement that the binding "prevents reuse; it does not authenticate the person", so it is within the ASSUMED model. Minor 5 is the cheap mitigation for the agent path.
- The old link routes `POST /api/link/story/publish` + `/open` still accept any PL link, connection-string links included, with no G1 at all ("기존 경로는 그대로"). So the current-Mac rule protects the meaning of the "로컬 승인" badge, not whether an unapproved Story can be opened. The absence of the badge is what tells the two apart. Teammates and reviewers should read the board with that in mind. The D41 last line of defence (GitHub protection rules) is unchanged.
- Important 1 is the one place where the code lets a gate be *skipped* rather than *forged*. The model does not cover that.

## Recommendations

- Fix Important 1 with a test. Then consider Minor 1 (Hub-side `kitStoryHash(body) === storyHash`) and Minor 2 (project mismatch refusal). Together they make the badge self-checking at almost no cost.
- Reuse the codebase's `randomUUID` + `wx` + `noSymlinks` pattern for the guide (Minor 3), and the kit's realpath containment for header paths (Minor 4).

## Declined to judge

- Board and live poll cost: `board()` reads every Story and Task of the hub on each GET and each 10-second poll per open tab, and a 304 still pays the full render; `projectPlans` runs once per project. This is performance and fixed-query scope, which is reviewer 1's lens.
- Session sliding by polls: a visible tab keeps its 30-day session alive indefinitely. This follows from the existing sliding-session design, not this change's trust surface.
- live.js follows redirects: already deferred, and no GET route redirects today.
- A web [취소] racing a resumed command whose bases were already recorded can leave a `feature/story-<N>/base` for a cancelled Story (the record step returns early with no new repo, then the push runs, then open fails). The window is narrow and the leftover branch is unique to that number. This is reliability, not authorization.
- The registered clone's `origin` is not compared with the Hub repo's remote before the push. That is pre-existing trust in registration (`mac connect` clones from the Hub's remote).
- `open` and `upload-bases` do not re-check repo ownership after upload. This is pre-existing (`openStory` has always been PL-only).
- `/team` shows every member's Mac state and current Task to all members. K7 approved this explicitly.

## Assessment

**Ready to merge: With fixes**

**Reasoning:** Redirect, CSRF, XSS, ETag/304, Hub link authorization (current Mac, ownership, idempotency, cancel) and the guarded single-ref push are all sound and well tested. One approval-trust gap remains: an unapproved Task-file `risk` value decides whether the G3 human gate is checked at all, and the kit's own `requiresG3` is ignored. Fix that before G4.
