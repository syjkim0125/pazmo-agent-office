# U36 (Mac connect) review, attempt 1

Snapshot `263330f0…` = tree `5fff3de` (range `27f2bff..5fff3de`). Allocation: 3 independent read-only reviewers (kit default 3), all opus:
1. generalist whole-branch review against plan, design, Story and the SDD ledger (re-dispatch: a first attempt in the stopped Team B session was cut off by an OAuth 401 before reporting anything);
2. seam: secrets, auth and Hub store concurrency;
3. seam: Office lifecycle and failure paths.
Reason: 8.7k-line change with token/pairing and self-restart seams; ten task-scoped reviews already ran, so 3 rather than 4–5. Reviewers ran only focused test files (`hub-mac-api` 19/19, `team-mac-watch` 14/14) and the Story check (exit 0).

## Disposition (controller)

Not ready: Critical 1, Important 5 (after merging duplicates). Fix before merge:

| Fix | Source | What |
|---|---|---|
| F1 | lifecycle C1 | After a reboot, logout, crash or SIGKILL `running.json` stays; `up --team` at login fails (status `unknown` → `UNKNOWN`/`RUNNING`), `stop`, `mac restart`, `mac disconnect` refuse; nothing repairs it. Fix: the team service removes its own `running.json` (matching instance) on shutdown; a saved state whose control call fails and whose pid is gone (`kill(pid,0)` → ESRCH) is cleared under the start lock and reported `stopped`. Pre-existing for every engine; Critical now because the LaunchAgent relies on it. |
| F2 | general I1 = lifecycle I1 = T8 deferred | `mac connect` re-run re-pairs on any `repos()` failure; a 5xx/timeout re-pairs and revokes the running Office's links (held Task risk). Fix: re-pair only on 401; otherwise keep the file and report the Hub failure with the rerun line. Remove the "re-run only when the Hub is fine" limitation from STATUS, LOCAL-PREVIEW and the record. |
| F3 | general I2 = lifecycle I3 | A self-restart stops the Office, then `up` preflight (runner login, colima, VM) fails → Office off until next login. Fix: no self-restart while a live Office's runners are not ready; `mac restart` checks runner login before `stopTeam`; LaunchAgent `StartInterval` so a failed start retries without a re-login (`up --team` on a running Office must stay cheap). |
| F4 | lifecycle I2 | Every `mac connect` boots out the loaded agent, SIGTERMs an in-progress `up`, and `start()` leaves `start.lock` forever (BUSY/UNKNOWN). Fix: `start()` removes its lock (and stops its child) on SIGTERM/SIGINT; LaunchAgent install skips bootout/bootstrap when the same plist is already loaded. |
| F5 | security I1 + lifecycle M1 | A web "연결 해제" of a Mac-minted link is undone by the next 5-min sync; a connection-string link to the same repo and the Mac revoke each other forever. Fix: the Hub refuses `/api/mac/link` (409 `LINKED_ELSEWHERE`) while the member holds a live non-Mac link to the repo, and the Office says so once; Mac-minted links on `/repos` show the Mac and no per-link revoke (POST refused, pointing to `/mac`). |
| F6 | security M2, 5, 7; general M3, M9; lifecycle M2, M4 | Cheap hardening: approve URL must be on the Hub's origin; `/mac/approve` warns when the member has an open Task (re-pairing strands it); installer update fetches `$REPO`; Rosetta check via `sysctl hw.optional.arm64`; immediate lane recheck after a links-only mint; `mac disconnect` removes `mac-restart.json`; 20-repo limit checked before cloning and limit-blocked repos left out of `pending`. |
| F7 | docs | Record the fixes; remove the F2 limitation lines; add to the real check: reboot then `status --team`, re-run during a Task, owner change while claude is logged out, a git `insteadOf` alias, a lost `/api/mac/link` response, the router's X-Forwarded-For policy. |

Deferred (disclosed, not blocking this merge): security 3 (no terminal confirm of the approving member's name — product decision, raised at G4), 4 (route must use XFF `append`/`replace`; before the OpenShift redeploy), 6 (user code in the approve URL, RFC 8628 style), 8 (`link-api` re-resolve after `readBody`, with a shared `body.ts`); general M1 (dead Mac link never re-minted after a lost response), M2 (`insteadOf` alias → hourly restart; before rollout), M4 (locked Office restarts live; developer path), M5 (deleted Mac clone → REPO_MISSING), M6 (installer re-run swaps code under a running Office), M7 (signed-out copy), M8 (G1 `scope` wording; the file is hash-bound to this run), recommendations (pin `PAZMO_OFFICE_REF` to a tag and add installer env to the deploy template before redeploy); lifecycle M3 (English text on teammate paths, copy batch), M5 (sleep/wake hold). Every ledger `minor (deferred)` item: CAN WAIT per the generalist's triage, except T8 (→ F2).

## Reviewer reports (verbatim)

### Reviewer: general

## Final review: feat/hub-web-flow, 27f2bff..5fff3de (Bundle 1, "Mac 연결")

**How I reviewed.** I read every changed `src/` file through per-file `git diff 27f2bff..5fff3de -- <path>`, not the 680 KB package:
- **Read in full:** `store.ts`, `server.ts`, `mac-api.ts`, `rate-limit.ts`, `installer.ts`, `pages.ts`, `team/mac.ts`, `mac-sync.ts`, `launch-agent.ts`, `mac-watch.ts` and `cli/mac.ts`.
- **Read the diffs:** `office.ts`, `lifecycle.ts`, `launcher.ts`, `index.ts`, `project.ts`, `hub-link.ts` and `branch.ts`.
- **Also read:** the plan, the design doc, the Story/G1 diff, the docs diffs, the ledger, selected tests, and the code paths these changes touch (link-api, scheduler/executor relink, stop/start, `prepareMachine`, `teamRunning`).
- **Ran one command:** `node .ai-workflow/bin/check.mjs story …`, which printed PASS and exited 0. I ran no tests and did not mutate the checkout.

### Strengths
- **Secret handling is consistent end to end.**
  - The Hub stores only sha256 of the device code, user code, Mac token and link tokens.
  - The device code never appears in a URL. The Office checks that `approveUrl` carries only the user code (`mac.ts:147-160`) and never quotes Hub replies.
  - `mac-link.json` is 0600 and written atomically. The plist and argv carry no token. `printable` (now with C1) is applied to Hub text.
- **The Hub is careful.**
  - The Mac is re-authorized after `readBody` (`mac-api.ts:84-86`).
  - Inputs are type-checked, never coerced.
  - The one-live-Mac rule runs in a single `pollMac` transaction.
  - `link()` has a LEFT JOIN guard, so a link minted by a revoked Mac is refused even if a race slips past `#revokeMac`.
  - CSP has `frame-ancestors 'none'`, so the approve button cannot be clickjacked.
  - GET misses on `/mac/approve` are limited.
- **Office robustness is good.**
  - Clones go through `.partial` with a strict regex.
  - The remote is validated before it reaches git (`cloneTarget` round-trips `normalizeRemote`), with `--no-recurse-submodules` and hooks off.
  - Restart claim safety holds: `holding()` sits in both `canExecute` and `claimCouldFollow`, and `idle()` includes `claimTicking`.
  - The restart-loop guard is persisted; `STABLE_NODE` is used once Homebrew's node path changes.
  - The restart child survives because `stopTeam` stops the service over its control channel, not with a signal.
- **The bundle only adds.** `NO_REPOS` is gated on the Mac link in all three places. Protocols 1–3 and `/api/link/*` are unchanged. `reason()` behaves as before for non-clone commands. The new timers do nothing when there is no Mac link.
- **The docs are honest** about what is unverified (real launchctl, Homebrew, OpenShift XFF), and the plan's "구현 중 바뀐 것" matches the code.
- **No internal host, org or repo names** appear in the diff (only `*.example.com` and public github.com).
- **The D40 merge is clean.**
  - The source changes from main are disjoint from this bundle.
  - M16 has both the D40 and D41 sentences. Dropping "Office는 main/master에 쓰지 않는다 / 화면은 … 칸반" came from the approved D41 commit (3a9dd6d), not from the merge.
  - Decisions read D40 then D41; Verify has V19 then V18 with D40's clause.
  - STATUS keeps the U35 entry. The G1 record cites both approvals.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)

**I1. `src/cli/mac.ts:237-243`: `reusable()` re-pairs on any `repos()` failure, not only on 401.**
- **This is a plan-level flaw.** Connect step 1 says "repos() 성공 → 재사용, 아니면 pairMac".
- **What happens:** a 5xx, timeout or VPN blip during a re-run of the install line leads to a new code and a browser approve prompt. If the person approves (they will; they are at the terminal), `pollMac` revokes the old Mac and every link it minted (`store.ts` `pollMac` → `#revokeMac`).
  - The running Office's lanes get a 401 and go to `relink`.
  - The open claim's Story heartbeat stops until the links-only sync re-mints (up to 5 min) and the lane recheck re-reads the file. The recheck timer runs before the mac check in each cycle (`office.ts:681/685`), so that is up to 5 more minutes.
  - That can cross the Hub's 10-minute heartbeat hold, and then the PL has to release the Task.
- **Today it ships as a documented "known limitation".** STATUS, LOCAL-PREVIEW and the verification record tell people to re-run only "when the Hub is fine", which a teammate cannot know.
- **Fix:** re-pair only when `fields(error).status === 401`. For anything else, throw `hubFailure(error, hub)` (HUB_NOT_READY or HUB_UNREACHABLE, with the rerun command). Add a test: a 503 or timeout on reuse means no pairing, an error naming the rerun command, and an unchanged `mac-link.json`. Then remove the limitation lines from the three docs.

**I2. `src/team/office.ts:555` (`idle()`) and `src/cli/mac.ts:487-492` (`restart`): a self-restart can turn a recoverable "limited" Office into "off" with no self-recovery.**
- **Cause:** `idle()` does not ask whether the Office could start again. `mac restart` stops the team Office, then runs `up --team`, whose `prepareMachine` refuses on:
  - no usable runner (`assertRunnerLogin`, LOGIN_REQUIRED / RUNNER_BLOCKED);
  - missing colima/docker;
  - a VM probe failure.
- **Scenario:** a member's only runner (claude) is logged out, so the Office is correctly `limited — claude: not_ready` and would recover in place under D39 once they log in. Then an admin adds them as an owner. The self-restart stops the Office, `up` fails, and the Office stays off until the next Mac login or an installer re-run.
  - The web shows "꺼짐(N분 전)" and loses the reason.
  - The reason is only in `launchd.log`.
- **This is a plan gap:** the restart design never considered `up` failing after the stop.
- **Fix (cheap):** don't restart while `!runnersReady`. Log the waiting line once, as is already done for open Tasks. Optionally have `mac restart` run the cheap preflight (runner login, colima presence) before calling `stopTeam`. Add a test.

#### Minor (Nice to Have)

**M1. `src/team/mac-sync.ts:298`: a dead link minted by this Mac is never re-minted.**
- **How it happens:**
  - the Hub commits `macLink`, which revokes the old link, but the response is lost (VPN drop or the 15 s timeout);
  - or the write fails;
  - or two full syncs run at once.
- **What follows:** the file keeps the revoked token while the Hub says `linked:true`. The lane stays in `relink` forever, and re-running the installer does not fix it (the reuse path keeps the file). Clearing it needs the terminal (delete `hub-link.json`) or a web revoke plus a re-run.
- **Fix:** return a link id from `/api/mac/link` and list it in `/api/mac/repos` (an additive field), store it in the file, and compare. Alternatively, force a re-mint for lanes in `relink` whose file carries this Mac's macId.

**M2. A git `insteadOf` host alias causes an hourly restart loop (Task 6 deferral, worsened by the Task 9 hourly retry).**
- **Cause:** the registry remote comes from `git remote get-url` (`hub-connect.ts:77-89`, which applies insteadOf), so a host alias such as `git@github-work:` differs from the Hub remote.
- **Effect:**
  - Every links-only check reports the clone in both `pending.remove` and `pending.add`.
  - So the Office restarts itself every `RESTART_RETRY_MS` while idle, forever.
  - Each full sync unregisters the clone, deletes its macId link file and re-mints.
- **The tests mask it:** `projectRemote` runs with the test process's HOME, not the fixture HOME.
- **Fix:** match Mac clones (`dirname === reposDir`) by their config origin (`originUrl`) rather than by the registry remote.

**M3. `office.ts:681/685`: a link re-minted by links-only reaches the lane one cycle late (up to about 10 minutes in total).** This matters for any re-pair while a Task is open, intentional ones included, because of the 10-minute hold above. **Fix:** after a links-only sync that minted, call `recheck()` (or re-read those lanes) at once.

**M4. Task 9 Ruling: a locked Office restarts itself into live.** A developer's deliberately locked team Office starts claiming Tasks after an owner change. **Fix:** when `!live`, log the pending set and skip the restart, or restart in the same mode.

**M5. `mac-sync.ts:280` with `launcher.ts` `assertReposPresent`: a deleted Mac clone folder strands the Office.**
- `up --team` fails REPO_MISSING at every login and restart.
- `mac connect` only says "폴더를 되돌리거나 team remove로 빼세요".
- The Office owns `<root>/repos/*`, so a full sync should unregister and re-clone a missing Mac clone. Today the only fix is a terminal command, which the anti-goal rules out.

**M6. `installer.ts` step "Office 새 버전 받기": re-running the install line while a team Office runs swaps `~/.pazmo/office` under it.**
- The code is swapped by `checkout --detach` plus `npm ci`.
- `mac connect` does not restart the Office, so the old code keeps running until the next login.
- Claude jobs start the tool bridge from disk, and `contracts.ts:145` dynamically imports the kit checker, so a Task in progress can mix versions.
- **Fix:** skip or warn on the update while the team Office has an open Task, or restart it when idle after an update.

**M7. `pages.ts:207` (`macSignedOut`) only steers people to invite or new-device links.**
- The common case is that `/usr/bin/open` launched a different default browser than the one the member uses.
- The page should add "이미 다른 브라우저에서 허브를 쓰고 있다면 터미널에 나온 주소를 그 브라우저에 붙여 넣으세요"; otherwise people take an unnecessary trip to an admin.
- Fold this into the deferred copy batch.

**M8. `.ai-workflow/approvals/pazmo-agent-office-g1.json` `scope` has a garbled clause and a duplicate sentence.** The clause reads "and V19,)" and "Earlier decisions keep their own approval records" appears twice. No content is lost (the branch's "on top of main 534a769" was correctly dropped). Only edit it if the kit run does not bind the file, since editing recorded evidence can block the U36 run.

**M9. `installer.ts:68-69`: a Rosetta terminal is refused as Intel (deferred).** Checking `sysctl -n hw.optional.arm64` fixes it.

### Deferred-minor triage

- **T1 `pollMac` BEGIN IMMEDIATE on read-only polls:** CAN WAIT. Polls run every 3 s with at most 100 codes.
- **T1 `MAC_CODE_LIVE` positional `?`:** CAN WAIT. Maintainability only.
- **T1 `store.ts` 946→1186 lines:** CAN WAIT. The plan set the location.
- **T1 second-Mac test doesn't assert the connection-string link survives:** CAN WAIT. Same `#revokeMac` path as the revokeMac test; add the assertion when next touched.
- **T1 test `join` shadowing; old-schema fixture:** CAN WAIT. Test hygiene.
- **T1 CONTROL excludes C1:** CAN WAIT. Resolved by the Task 5 `printable` carry; Hub pages escape.
- **T2 `api` decided from raw `req.url`:** CAN WAIT. Only the error format, and the pattern already exists.
- **T2 no test for proxy approveUrl / empty last XFF:** CAN WAIT.
- **T2 "프로토콜 4이":** CAN WAIT. Copy batch.
- **T2 raw rate-limit key / eviction / test duplicate:** CAN WAIT. The global cap of 100 bounds the damage.
- **T2 ops (corporate LB → last XFF shared):** CAN WAIT for merge. It must be checked before the OpenShift redeploy. Note it also lets one client block every install for 10 minutes.
- **T2 link-api resolves the link before `await readBody`:** CAN WAIT. Pre-existing, the window is the body transfer time, and the impact is one request. Fix it together with a shared `body.ts`.
- **T3 template lacks `PAZMO_OFFICE_REPO`/`REF`; Rosetta refused:** CAN WAIT. Defaults work; see M9.
- **T3 shared step name / old origin kept / failed-step table / GET helper written 3× / English errors:** CAN WAIT.
- **T4 duplicated canonical user-code recompute; installer gate is `!== null`:** CAN WAIT.
- **T4 copy ("관리자 암호는 필요 없습니다", "clone합니다", gone-code wording, revoke-at-approve wording):** CAN WAIT for merge, because no teammate sees `/mac` before the redeploy. The admin-password claim must be proven or removed at the real check.
- **T4 `full()` test blind spot; 429 text on a GET:** CAN WAIT.
- **T5 unknown errors retried / pollMs unclamped / no interim line / writeMacLink wording / approve URL origin not forced:** CAN WAIT.
- **T6 insteadOf alias, no lock, disk-write failure after minting:** CAN WAIT for merge, but fix before rollout. See M2 (hourly restart loop) and M1.
- **T6 per-repo loop isolation / raw git text / gh gate before link refresh / dead token never re-minted / missing tests / closures:** CAN WAIT. Fix the dead token before rollout (M1).
- **T7 a thrown `run()` drops its cause; timeout and output cap not pinned:** CAN WAIT.
- **T7 wall-clock <400 ms assertion; hung launchctl worst case:** CAN WAIT. Low flake risk.
- **T8 any `repos()` failure on reuse re-pairs:** MUST FIX BEFORE MERGE. See I1: about 3 lines of change, it removes a documented limitation, and it prevents a path to a held Task.
- **T8 batch (macId files left when there is no link, swallowed removal note, EACCES worded as unreachable, duplicated text, `--fingerprint` hint, no lock, loaded assertion, ghLogin test, `--name` ignored, 4xx shown as unreachable, `/tmp` in tests):** CAN WAIT.
- **T9 double revocation log / guard file after spawn failure / cached `runnersReady` / re-issued link one recheck late / coverage gaps:** CAN WAIT. The late re-issue is M3.
- **T9 extra-CA check duplicated:** CAN WAIT.
- **T9 old-format guard file / negative age / plan line 517:** CAN WAIT. The plan text was already fixed in 4977ac5.
- **T10 LOCAL-PREVIEW mixes in internals / LAN pointer wording / "(Task 8 리뷰가 받아들임)" labels:** CAN WAIT.
- **Rulings:**
  - All Rulings are acceptable except the Task 9 locked→live one (see M4).
  - The Task 9 hourly retry combines badly with M2.
  - The Task 2 duplication into `mac-api.ts` can wait for a shared `body.ts`.

### Declined to judge
- **Real launchctl behavior:** whether bootout, enable and bootstrap with retries is needed, and whether `bootout` on a re-run of `mac connect` touches the detached team service. This cannot be verified without a real Mac.
- **Device-flow phishing:** someone on the corporate network asking a member to approve their code. This is inherent to the device flow; the design accepts it with code-match wording on the page.
- **`claude auth status` output, Homebrew cask and formula behavior, admin-password prompts:** real-install facts. Runner discovery already relies on the same command.
- **OpenShift router X-Forwarded-For mode (append or replace):** an ops fact.
- **Bundle 2–4 behavior** (automatic distribution, the web's My Tasks, PL planning, main merge): out of this bundle.
- **Hub/Office version-skew policy beyond protocol 4:** the design leaves "버전 맞추기" to the builder, and nothing requires it yet.
- **No index on `hub_links.mac_id`:** the tables are tiny.
- **Recomputing the kit Story fingerprint:** the ledger records that graph init accepted G1 at 641f931f.
- **`hub-unlink` on a link this Mac minted being re-minted within 5 minutes:** the spec is silent, and it is arguably expected with person-level pairing.
- **The header pill "내 Mac: 연결된 Mac 없음" showing on LAN hubs, where there is no install line:** cosmetic; the spec is silent.

### Recommendations
- **Before the OpenShift redeploy:**
  - Pin `PAZMO_OFFICE_REF` to a tag rather than `main` (otherwise a push to the public repo's `main` runs on every teammate's Mac at its next install).
  - Add both installer env parameters to `deploy/openshift/pazmo-hub.json`.
  - Settle the LB/XFF question.
- **Add to the planned real check:**
  - re-run the install line while a Task runs (launchctl bootout plus the code swap);
  - an owner change while claude is logged out (I2);
  - a host-alias `insteadOf` (M2);
  - a lost `/api/mac/link` response (M1).
- **Consider a LaunchAgent `StartInterval`** (for example 1800 s), so a failed `up` at login (colima, VPN, runner) retries without a re-login. `up --team` simply reuses a running Office.
- **When adding the post-body re-auth to `link-api.ts`, extract the shared `str`/`parse` helpers into a `body.ts`** that both `mac-api.ts` and `link-api.ts` use.

### Assessment
**Ready to merge?** With fixes.

**Reasoning:** Nothing critical was found: no secret leaks, no claim or main safety breaks, and the existing flows are untouched. Two cheap fixes should land first:
- I1: re-pair only on 401.
- I2: don't self-restart while the runners cannot start again. This is a plan-level gap.

Both remove paths where unattended operation silently leaves a teammate "off" or a Task held. The Minor items, M1 and M2 especially, can wait for the real check, before teammates are told to use this.

### Reviewer: security

## Seam review: secrets, auth, Hub store concurrency (feat/hub-web-flow, range 27f2bff..5fff3de, HEAD 5fff3de)

I made no changes to the working tree, index or HEAD. Test run: `tests/hub-mac-api.test.mjs`, 19/19 pass. I ran no other test files.

### Findings

**Critical**: none.

**Important**

1. **A link revoke on the web does not stick for a link a Mac minted. The Mac's 5-minute sync mints it again, and the same loop cuts a connection-string link the member made on another machine for the same repo.**
   - **Where:** `src/team/mac-sync.ts:295-305`, `src/hub/store.ts:931-938` (`macRepos.linked`), `src/hub/store.ts:697-708` (`#issueLink`), `src/team/office.ts:35,685` (`RECHECK_MS=300000`, "mac repo check"), `src/hub/pages.ts:161` (the per-link "연결 해제" button).
   - **Scenario A:**
     1. An admin, or the member, presses "연결 해제" on `/repos` for a Mac-minted link (`revokeLink`, store.ts:827).
     2. `macRepos` now reports `linked:false` for that repo.
     3. The running team Office's links-only sync takes the "mint" branch, because its file's `macId` matches but `repo.linked` is false.
     4. Within 300 s it calls `/api/mac/link` and has a fresh live link.
   - **Scenario B:**
     1. The member re-links repo R from PC1 with a connection string. `#issueLink(member,R,null)` revokes the Mac's link.
     2. The Mac's next check re-mints, and `#issueLink` revokes PC1's link.
     3. The Mac always wins within 5 minutes. PC1 only sees 401, and nothing tells the member why.
   - **Why it matters:** the Hub offers a revoke control that silently undoes itself. A PL or admin trying to detach one member's Office from one repo, for example during an incident, believes it is done. The real controls are removing the owner, revoking the Mac, or revoking the member. Plan line 82 prevents Mac-vs-Mac fights but not this case.
   - **Fix options:**
     - Make `macRepos` say why there is no live link (e.g. `link: "live" | "none" | "revoked"`, from a `revoked_by`/reason column, or "a newer non-Mac link exists"). Re-mint only on `none`, which covers the first sync and a new macId. On `revoked`, log one line telling the person to run `mac connect` or re-enable on the web.
     - At minimum: hide or relabel the per-link revoke button for links with `mac_id` and point to `/mac`, and do not re-mint while the member holds a live non-Mac link to the repo.
     - Add a test: "a web link revoke of a Mac link is not undone by the next links-only sync."

**Minor**

2. **The Office does not check the approve URL's origin.**
   - **Where:** `src/team/mac.ts:147-160`.
   - **What happens:** `approveUrl()` checks https, no userinfo or hash, path `/mac/approve`, and a single `code` param. It never checks `url.origin === hub`. A Hub that is compromised or misconfigured (wrong `PAZMO_HUB_PUBLIC_URL`) can send the person's browser to any https origin, carrying the user code, while the terminal says "approve this Mac". The docstring claims "The approve page of the Hub … and nothing else."
   - **Fix:** add `url.origin === hub` and a test.

3. **Whichever member approves first gets the Mac, and the terminal never asks the person to confirm.**
   - **Where:** `src/cli/mac.ts:262-278`, `src/hub/store.ts:883-896`.
   - **Scenario:**
     1. A hub member (an insider) learns a live user code: a screen share during install, shoulder-surfing, or router access logs (see 6).
     2. They approve it before the owner does.
     3. `pollMac` binds the Mac to the insider. `connect` writes mac-link.json, clones the insider's owned repos (any https remote the insider registered) and installs the LaunchAgent.
     4. The team Office then runs that member's Story Tasks with the victim's gh and Claude credentials.
     5. The only signal is the member name in one line, `허브에서 이 Mac을 허용했습니다(name, memberName)`. The real owner gets a 409 on their own approve and may just re-run.
   - **Preconditions:** an insider, the 10-minute window, and the owner ignoring the printed name. Guessing a code is bounded (about 1.6e9 codes, at most 100 live, 10 tries per member per 10 minutes).
   - **Fix:** when stdin/`/dev/tty` is a TTY, ask "이 Mac을 <memberName>(으)로 연결할까요? [y/N]" before `writeMacLink`. If the answer is no, call `/api/mac/revoke`.

4. **Rate-limit key and global pending cap.**
   - **Where:** `src/hub/server.ts:93-96`, `src/hub/store.ts:844`.
   - **Default router policy is fine:** under the OpenShift default `set-forwarded-headers: append`, HAProxy adds its own XFF line last and Node joins duplicate XFF lines with ", ". "Last entry" is then the peer the router saw, and a client-injected first entry does not escape (tested).
   - **Other policies are not:** if the route or router uses `if-none` or `never`, or anything reaches the pod or service without the router (in-cluster), the client sets the whole header and gets a fresh bucket per request. If XFF is absent, every client falls back to the router or pod address and shares one bucket.
   - **Consequence:** with a spoofable key, one unauthenticated client fills `MAC_PENDING_LIMIT=100` live codes. Mac pairing is then refused hub-wide, renewable every 10 minutes. LAN mode has the same cap and is reachable by anyone on the LAN.
   - **Not a duplicate:** the deferred "corporate LB" item covers the shared-bucket case, not this spoofing/cap case.
   - **Fix:** document and require `append` or `replace` on the route (an explicit route annotation in the deploy manifests). Optionally give each client key at most N of the 100 live codes.

5. **Pairing a different Mac while the old Mac holds a Story claim strands the Task.**
   - **Where:** `src/hub/store.ts:898-925` (`pollMac` revokes the old Mac and its links), `src/hub/story-store.ts:656-670`.
   - **What happens:** claims are per member and never expire; a held claim is only flagged after `HELD_AFTER_MS`.
     - The old Mac's links now 401, so it can neither heartbeat nor report merged or failed.
     - The new Mac gets `claimNext` → `{task:null, open}` and does not know the claimId.
     - The Task stays claimed until the PL releases it.
   - The approve page warns that the previous Mac will be disconnected, but not about the open Task.
   - **Fix:** show "이전 Mac이 Task #N을 진행 중입니다" on `/mac/approve` when `#openTask(member)` exists, or document it.

6. **The user code travels in a URL query string, against item 1's stated rule.**
   - **Where:** `src/hub/mac-api.ts:62`, and the GET `/mac/approve?code=` handling in `src/hub/server.ts` (around line 170).
   - **Assessment:** this is deliberate, RFC 8628 `verification_uri_complete` style. The device code never appears in a URL. The code lands in browser history and any router or proxy access log. On its own it only lets a signed-in member approve or deny it within 10 minutes; that path feeds finding 3.
   - **Fix:** acceptable as is if the TTY confirmation in 3 is added. Otherwise keep router access logging off for this route.

7. **The installer's update path does not pin the repository.**
   - **Where:** `src/hub/installer.ts:102`.
   - **What happens:** an existing install runs `git -C "$OFFICE" fetch --depth 1 origin "$REF"`, which uses the clone's stored `origin`, not `$REPO`. If the operator changes `PAZMO_OFFICE_REPO` (for example to an internal mirror), every existing Mac silently keeps tracking the old repo.
   - **Fix:** `fetch --depth 1 "$REPO" "$REF"`.

8. **Known deferred item (link-api reads the link before `await readBody`), re-judged: same severity.**
   - **Where:** `src/hub/link-api.ts:167-171` and `storyRoute` line 96.
   - **What changed:** the window is no longer, but Mac pairing now revokes links automatically. A `POST /api/link/story/claim` from the old Mac whose body completes after the new Mac's first poll would create a member-level claim held by a dead link, i.e. the stranding in 5.
   - **Assessment:** the bodies are `{}` and the window is a few ticks, so I keep it Minor.
   - **Fix:** re-resolve the link after `readBody`, as `mac-api.ts:80-84` already does.

### Checked and fine

1. **Secrets:**
   - **Device code:** never in a URL (`mac.ts:148` refuses an approve URL that contains it). It is not in any say, throw or argv; `/usr/bin/open` gets only the URL with the user code.
   - **Mac token:** lives only in mac-link.json, written 0600 with `wx`+rename into a 0700 team dir (`noSymlinks`, chmod of a loose dir) at `mac.ts:100-116`. Readers refuse a file with group/other bits (`mac.ts:87`). Parse errors never quote content.
   - **Repo link tokens:** written 0600 `wx`+rename (`hub-link.ts:38-42`), dataDir created 0700.
   - **Plist and processes:** the plist has no token and every value is XML-escaped (`launch-agent.ts:68-111`). The restart child's argv/env holds only paths, PATH/HOME/LANG and optional SSH_AUTH_SOCK and NODE_EXTRA_CA_CERTS (`mac-watch.ts:274-283`).
   - **Output:** CLI JSON results and log lines carry no token. The Hub logs only messages of non-HubError errors. `/install.sh` holds no secret.
   - **Docs:** the diff has no real tokens or hostnames, only example.com and the public repo.
2. **Hub auth:**
   - **Hashes only:** device, user and Mac tokens are stored as sha256 (`store.ts:858-861`, plus a test). Bearer lookup goes by hash, so timing is irrelevant; CSRF uses `timingSafeEqual`.
   - **Codes:** 10-minute TTL enforced in both decide and poll. Single use via `delivered_at` inside the poll transaction. An unknown device code reads the same as an expired one.
   - **Approve/deny:** limited to 10 per 10 minutes per member, counted after the CSRF check; a miss on GET also counts.
   - **CSRF and binding:** POST needs both the Origin check and the CSRF token (`server.ts:120,139`). `#decideMac` binds the code to `by.id`. A member revoked between approve and poll gets `denied`.
3. **Store concurrency:**
   - **Serial transactions:** every store call is synchronous with BEGIN IMMEDIATE, and nested `transaction` uses savepoints, so approve, poll and revoke never interleave.
   - **One live Mac:** enforced inside the `pollMac` transaction.
   - **Revocation:** `#revokeMac` revokes only `mac_id=macId`. `link()` also refuses at read time when the minting Mac is revoked (LEFT JOIN, `store.ts:710-720`).
   - **No stale acts on `/api/mac/*`:** `/link` and `/heartbeat` re-authorize after `readBody` with no await before the store call. `/repos` and `/revoke` read no body. `/start` and `/token` take no credential.
   - **Other revocations:** `revokeMember` also revokes Macs.
   - **Connection-string links** to other repos survive a Mac revoke (tested); same-repo behaviour is finding 1.
4. **XFF key:** correct under the router's default append policy, and ignored in LAN mode (both tested). The caveats are in finding 4.
5. **`/install.sh`:**
   - **Proxy mode only:** built only in proxy mode (`run.ts:56`, `server.ts:306`), otherwise a 404.
   - **No request input:** the script text comes from the configured `base` (publicUrl origin), not Host or X-Forwarded-*; Host must already be in `hosts` or the request gets a 421.
   - **Validation:** hub, repo and ref are each checked by a strict regex before substitution with function replacers (`installer.ts:11-14,124-128`), and an unsafe origin fails startup.
   - **Commands:** `git clone` gets an https URL and a ref starting with an alphanumeric (no option injection); `npm ci --ignore-scripts`.
   - **Trust:** no pin, by design (public certificate). The extra CA is passed along, and `rejectUnauthorized:true` is explicit.
6. **Protocol 4 is additive:**
   - `/api/mac/*` requires `"4"`; `/api/link/*` still takes only 1, 2 or 3.
   - Old links have `mac_id` NULL, so `link()` behaves as before (migration test).
   - Cookie attributes are unchanged. Pages take `Chrome` with the same `trust` key, every caller was updated, and `tsc` covers it.
   - Mac answers never set a cookie or return HTML (tested).

### Declined to judge
- **Supply chain of `curl | sh`:** it fetches a moving branch (default `main` of a personal GitHub repo) with no commit or signature pin. This is a product decision.
- **Classic device-code phishing:** an outsider gets a member to approve the outsider's code. This is inherent to the flow; the approve page's warning text is the mitigation.
- **Mac and link tokens never expire:** revocation-only lifetime. This is a policy choice.
- **OpenShift router config:** I could not check the exact HAProxy template (append vs if-none) offline; finding 4 is conditional on it.

### Verdict for this seam: **With fixes**
Fix 1 (revocation that undoes itself) before merge. 2 and 3 are one-line or short hardening changes and worth doing now. 4–8 can be documented or deferred.

### Reviewer: lifecycle

## Seam review: Office lifecycle and failure paths (feat/hub-web-flow, 27f2bff..5fff3de)

Read-only review. The only test I ran was `tests/team-mac-watch.test.mjs`, which passed 14/14. I also ran one scratch probe of the stale-state path: `/private/tmp/claude-502/-Users-jongkkim-Documents-pazmo-agent-office/e4a09923-81bd-495f-a9c5-52e81cdfceff/scratchpad/stale/check.mjs`.

### Findings

**Critical**

**C1. After a reboot, shutdown or crash (probably logout too), the team Office never starts again at login, and no CLI command can repair it.**
- **Code path:**
  - `src/runtime/team-service.ts:40-58,66-77`: shutdown on SIGTERM closes the Office but never removes `running.json`.
  - `src/cli/lifecycle.ts:383-386`: only the CLI `stop()` removes it.
  - At the next login, the LaunchAgent runs `up --team`. `status()` cannot reach the old port, so it returns `"unknown"` (`lifecycle.ts:~165-185`).
  - `launcher.ts:354` then fails with `RUNNING`.
  - `stop --team` refuses with UNKNOWN ("state is preserved", `lifecycle.ts:~371-379`). So do `mac restart` (`cli/mac.ts:489`, stop comes first) and `mac disconnect` (`cli/mac.ts:437`).
  - If the old pid has been reused, `teamRunning()` (`registry.ts:99-121`) is true. Then `mac connect` says "팀 Office가 켜져 있어…" and skips the sync.
- **Scratch evidence** (dead pid, closed port): `statusTeam` returned `{"status":"unknown",…}`, `stopTeam` threw `UNKNOWN Runtime could not be authenticated…`, and `running.json` was still there.
- **Effect on the teammate:** after the first reboot the Hub shows the Mac as off for good. The only fix is deleting `<root>/team/running.json` by hand, and no message says so. Real check step 3 ("재로그인 자동 실행 … 또는 재부팅") will fail.
- **Fix:**
  - (a) On shutdown, the team service deletes `running.json` itself when the file names its own `instance`. It knows `dataDir` and `instance`. This covers the SIGTERM at reboot and logout.
  - (b) Treat the state as stale when the control call fails and `process.kill(pid, 0)` gives ESRCH. In that case remove the file under `start.lock` and report `stopped`. This covers a crash or SIGKILL. It only reads the pid and never signals it, which `teamRunning` already does.
  - Add a reboot step to the real check: `status --team` should show `running` after login.

**Important**

**I1. Re-running `mac connect` re-pairs on any `repos()` failure** (`cli/mac.ts:237-243`). This is the Task 8 deferred minor; I judge it more severe.
- **Scenario:** an already-connected Mac re-runs the install line, and the reuse probe gets a 5xx, a timeout or the router's HTML page. `reusable()` returns null with no line explaining why. Then `pairMac` succeeds, and the browser shows the allow page, which the person clicks.
- `pollMac` (`store.ts`, the `#revokeMac` loop) revokes the old Mac and every link it minted.
- A running Office's lanes keep the revoked tokens until three things happen:
  1. a heartbeat gets 401 and the lane goes to `relink`;
  2. the watch mints new link files, up to 5 min;
  3. `recheck` re-reads them, up to another 5 min. The "repo check" timer is registered before "mac repo check" (`office.ts:681` vs `685`).
- That is up to about 10 min with no heartbeat or PR/merge report. `HELD_AFTER_MS` is 600 000 ms (`story-protocol.ts:7`), so the PL can see the Task as "held", release it, and the Office drops a running Task (NOT_YOURS).
- If the person does not click allow, connect waits 10 min and fails with `MAC_CODE_EXPIRED`.
- **Fix before merge.** The change is three lines, and it protects the stated invariant ("같은 명령을 다시 실행하면 다시 짝짓지 않고"). Every failure message points at rerunning, so reruns will be common. The local-hub real check will not trigger the bug, but the midpoint check (an OpenShift redeploy) and production will.
- **Minimal fix:** re-pair only on 401. For any other error, say one line and `return file`; step [2/3] then reports the Hub failure with the rerun line through the existing path (`cli/mac.ts:310-316`). Add a test: a 503 on reuse calls neither `/api/mac/start` nor `/token`.

**I2. Every `mac connect` boots out the loaded agent** (`launch-agent.ts:175`, called from `cli/mac.ts:323`). This kills an `up --team` that is still running and can leave `start.lock` behind for good.
- The previous connect's `RunAtLoad`, or the login, starts an `up` that runs for minutes ("VM과 이미지를 준비하느라 몇 분"). The documented recovery is "fix, then rerun the install line", and that rerun's step [3/3] runs `bootout`, which SIGTERMs `up`.
- The CLI has no signal handler (nothing in `src/cli`), so `start()`'s `finally rmdirSync(lock)` (`lifecycle.ts:217-221,319`) never runs.
- If `up` was inside start's 30 s window, this follows:
  - `start.lock` stays;
  - every later `up` gets `BUSY`;
  - `stop --team` and `mac disconnect` get UNKNOWN (`lifecycle.ts:~358-362`);
  - `teamRunning()` is true, so connect wrongly says the Office is on.
- If `up` was killed earlier, the start is simply cancelled and the reload starts a fresh `up`. That is mostly fine; a half-started colima may make it fail.
- **Fix:**
  - When `launchctl print` says the agent is loaded and the plist is unchanged, don't reload it. If no Office and no `up` is running, use `kickstart` without `-k`.
  - Separately, make `start()` remove its lock and kill its child on SIGTERM/SIGINT.

**I3. A self-restart stops the Office before running the full `up` preflight. If the preflight fails, the Office stays off until the next login.**
- `cli/mac.ts:487-492` runs `stopTeam` first, then `up` → `prepareMachine` (`launcher.ts:~285-325`).
- Any preflight failure leaves the Office stopped:
  - `LOGIN_REQUIRED` when no runner is usable (`launcher.ts:47-56`); a typical teammate has only claude;
  - colima or VM failure, or `VM_PROBE`;
  - `NOT_INSTALLED`;
  - the pinned Codex check.
- Nothing retries: KeepAlive is false, and the watch died with the Office. `idle()` (`office.ts:555`) ignores runner readiness, so a "limited" Office whose claude is logged out restarts on a repo-set change and ends up "off". A zero-repo Office always counts its runners as ready.
- **Effect:** "쉬는 중(한도)" silently becomes "꺼짐" until the next login, and the reason is only in `launchd.log`.
- **Fix:** run the runner and VM preflight in `mac restart` before `stopTeam`, then stop, sync and start with the prepared config. At minimum, add `(!live || runnersReady)` to `idle()` and check runner login before stopping.

**Minor**

- **M1. Additive gap (developer-only).** The Mac's mint revokes a connection-string link to the same repo held by a single Office (`#issueLink` revokes the member's earlier link). If the person re-runs `hub-link`, the next links-only check sees `linked:false` with this Mac's macId and mints again (`mac-sync.ts:295-302`). The two links revoke each other every 5 min.
- **M2.** `mac disconnect` leaves `<root>/team/mac-restart.json` (`cli/mac.ts:468`). A reconnect within the hour with the same pending set waits up to 1 h before restarting.
- **M3. English text on teammate paths:**
  - `TASK_ACTIVE` / `UNKNOWN` from `stopTeam` inside `mac disconnect` and `mac restart`;
  - registry reasons in sync problem lines (`LIMIT`, `NO_ORIGIN`);
  - non-LAUNCHD install errors (EACCES) and a `writeMacLink` failure come out raw, with no rerun line.
- **M4. A member owning more than 20 repos.** The clone happens before addTeamRepo's 20-repo `LIMIT` check (`mac-sync.ts:373-391`). Repos past the limit are downloaded and can never be registered, and links-only `pending.add` keeps listing them, so the Office restarts once an hour forever. The hourly Ruling assumed transient failures, but this one is permanent. Fix: check the count before cloning, and leave LIMIT-blocked repos out of `pending`.
- **M5. Sleep/wake.** The restart hold uses the wall clock. Closing the lid between the restart request and the child's stop can expire the hold and spawn a second `mac restart`. `start.lock` still allows only one Office; the other gets one `BUSY` line.

### Checked and fine

1. **Transitions** (C1 and I2 aside):
   - `mac-link.json` is written by tmp file + rename, 0600, only after the token (`mac.ts:100-116`); a pairing failure changes nothing on disk.
   - The plist is written before it is loaded and kept on `LAUNCHD_FAILED`, with a Korean rerun line (`cli/mac.ts:333-339`).
   - A web revoke gives one line, then no Mac calls for that macId (`mac-watch.ts:141-146,168,181`). A rerun re-pairs and re-mints when the macId differs (`mac-sync.ts:295-299`).
   - Disconnect runs stop → bootout → revoke → link files → `mac-link.json`; each step is idempotent on rerun.
2. **Claim safety:**
   - The watch restarts only when the Office is not stopping, no claim tick is running, no record is open and no engine is busy (`office.ts:555`).
   - The decision, the hold and the spawn are synchronous after the await (`mac-watch.ts:216-239`).
   - `canExecute` and `claimCouldFollow` respect the hold (`office.ts:565,586`).
   - No claim is open across a watch restart. A `recover()` claim during the hold persists in `team.sqlite` and is driven by the next start.
   - Two Offices cannot run at once: `start.lock` (mkdir) plus the `running.json` re-check (`lifecycle.ts:217-226`), and the LaunchAgent's `up` reuses a ready Office (`launcher.ts:354-359`).
3. **Restart-loop guard:**
   - Keyed on the sorted set; a same set within 1 h gives one line and no restart; a changed set restarts; an empty set clears it.
   - A synchronous spawn throw resumes claims; an async spawn error is logged, the hold expires and it retries roughly every 15 min.
   - Negative age is already deferred.
   - Fixable-without-a-set-change waits at most 1 h, per the Ruling.
4. **Sync isolation:**
   - Each per-repo step is caught; gh and setup-git run once per host.
   - Links-only lines are deduplicated across checks (`office.ts:526-546`); full-sync lines appear once per start or restart.
   - Concurrent full syncs remain a deferred minor; not escalated.
5. **Re-run of `mac connect`:** covered in I1.
6. **Additive guarantee:**
   - Without a mac link, `syncBeforeUp` returns at null (`mac-sync.ts:427-428`).
   - The `NO_REPOS` checks short-circuit when repos exist (`launcher.ts:340`, `lifecycle.ts:333`, `office.ts:270`).
   - The watch timers do nothing and `holding()` stays false.
   - `hub-link` writes no macId (`hub-link.ts:202-206`).
   - `serviceEnv` adds `NODE_EXTRA_CA_CERTS` only for the team engine and only when it is set.
   - Locked mode follows the Ruling.

### Declined to judge

- Whether `launchctl bootout` of the loaded agent also kills the already-detached team Office (coalition/session tracking). If it does, every rerun while the Office runs leads to C1 and an Office that is off. In real check step 2, confirm `status --team` reports the same pid after a rerun.
- Whether macOS logout, as opposed to reboot, terminates the detached Office.
- The installer rerun's `git checkout` + `npm ci` under a running Office (installer seam).

### Verdict for this seam: With fixes

C1 must be fixed. I1 should be fixed before merge. I2 and I3 should be fixed or explicitly accepted.

