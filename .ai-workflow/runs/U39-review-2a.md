# Final fix wave re-review (U39, e89cd58..eab3265, 7 commits)

### Finding Verdicts

1. **(R2) The Task file's `risk` alone decided whether G3 is checked; "normal" skipped the design gate** — ADDRESSED.
   - src/team/upload.ts:139-151 `readProfile` reads `<gateRoot>/.ai-workflow/verification.json` once. If the file is missing it returns null. If the file is not JSON it refuses with UPLOAD_G3 (ruling line 104).
   - src/team/upload.ts:136 `G3_LINE = /^Understanding gate \(G3\):/im` uses the same anchor as `gatePath` (:97). It matches both a bound G3 line and a `pending` one. It has no `g` flag, so `.test` keeps no state between calls.
   - src/team/upload.ts:247-254 sets `needsG3` when the profile has `requiresG3 === true` or the Story has a G3 line. `risk === "normal"` with either one refuses with UPLOAD_G3. This runs before anything is sent to the Hub.
   - High risk still runs the full G3 binding (src/team/upload.ts:255-262). `designPath` (:159) now takes the profile that was already read, so the profile is read once.
   - No path skips the check. `runUpload` runs `checkUpload` (:530) before `link.upload` (:545) on every run, resumed runs included, so all three triggers (Task file, profile `requiresG3`, G3 line) apply.
   - A normal Story without any trigger still uploads. tests/team-upload.test.mjs:202 shows that `requiresG3: false`, a profile without `requiresG3`, and no profile (the existing `files(t).check().risk === "normal"` case) all keep normal.
   - The test also covers the refusals: profile requires G3 with no G3 line, a bound G3 line, a pending G3 line, and a non-JSON profile. The same Story with `high` and a bound G3 passes.
   - Docs updated: skills/pazmo-hub-upload/SKILL.md:24-25, :42-44, :78; docs/LOCAL-PREVIEW.md:436, :443.
2. **(R1) "취소한 것도 보기" never showed cancelled Task cards** — ADDRESSED.
   - src/hub/board-pages.ts:50-57 `cancelledStrip` draws the cards in the "hidden" column in a `<div class="cancelled">` placed after `.cols`. It is drawn only when `v.cancelled` is on (:67, :86). `board()` (story-store.ts:634) returns those cards only when the toggle is on.
   - Every value is escaped, and each card links to `/tasks/<id>`.
   - The new CSS is at src/hub/pages.ts:49. Its class name collides with nothing: no other template emits `class="cancelled"`, and the tone classes are need/run/stop/done.
   - Test tests/hub-board-page.test.mjs:271 covers it:
     - With the toggle off, the card is absent and there is no strip.
     - With the toggle on, the card is in the strip, below the last column and in no column.
     - The live card stays in 할 일.
     - The lane of a cancelled Story carries both cards.
3. **(R1) The guide's managed marker came before the `---` front matter** — ADDRESSED.
   - src/cli/mac.ts:283-308: SKILL.md is written byte for byte as the repo file. Ownership moves to the sidecar `.pazmo-managed`, which holds sha256 of the SKILL.md that was written (:257, :307).
   - skills/pazmo-hub-upload/SKILL.md starts with `---\nname: pazmo-hub-upload\ndescription:` at byte 0.
   - Tests check byte equality, front matter at byte 0 and the sidecar hash: tests/mac-skill-copy.test.mjs:28-38 and tests/team-mac-cli.test.mjs:188-192.
   - The deferred minor is folded in: STATE, HUB_UNREACHABLE and HUB_BAD_RESPONSE are now in SKILL.md:90-92 and LOCAL-PREVIEW.md:455-457.
4. **(R1) The live swap closed open `<details>` and dropped selection and focus** — ADDRESSED, as the ruling defines it.
   - src/hub/live-script.ts:36-44 `eachDetails` keys each fold by its trimmed summary text plus its place among folds with that text. The open keys are remembered before `main.innerHTML = …` and reopened after it (:67, :71).
   - `selecting(main)` (:29-34) is checked before the fetch (:52) and again before the swap (:62). A skipped swap keeps the old ETag, so the next tick tries again.
   - Focus comes back by id (:68-75).
   - The served script contains the escape `\u0000`, not a NUL byte, and it parses. I checked this: `LIVE_SCRIPT.includes("\\u0000") === true`, `includes("\0") === false`, and `new Function(LIVE_SCRIPT)` succeeds.
   - Tests: tests/hub-live.test.mjs:215, :233, :256.
   - Residual, Minor: focus restore is in practice a no-op on today's markup (see Minor 1 below).
5. **(R1) After the live script stopped, `html.live` stayed on** — ADDRESSED.
   - `stop()` now calls `root.classList.remove("live")` (src/hub/live-script.ts:48). The CSS at src/hub/pages.ts:51 therefore hides the "저절로 업데이트" note and shows `.refresh` again.
   - Any status other than 200 or 304 still stops polling (Review Focus 1 is unchanged). A 304 or a network error leaves polling on.
   - Test tests/hub-live.test.mjs:200 checks that 401, 403, 404, 500 and 502 remove the class and that 304 keeps it.
6. **(R1) V20 "web-planned and uploaded Stories on one board" had no automated test** — ADDRESSED.
   - tests/hub-board-page.test.mjs:195 covers it.
   - Web path: plan, Office lease, draft, web G1, `publishStory` under `planStoryKey`, open. Upload path: PL Mac, POST `/api/link/story/upload` with the kit hash, then open.
   - Before the uploaded Story opens, it waits in 기획 중 next to the web lane.
   - After it opens, both Stories are lanes of the same project section with their 할 일 cards, for the PL and for teammate C. The uploaded Story page shows "로컬 승인 · PL Mac".
   - The fixer reports a mutation check: excluding `upload:` or `plan:` Stories from `board()` makes the test fail. I did not re-run it.
7. **(Ruling) The Hub trusted the client's storyHash** — ADDRESSED.
   - src/hub/story-store.ts:842-843 recomputes `kitStoryHash(input.body)` right after the hash-shape check. A mismatch refuses with 400 INVALID inside the transaction, before `#currentMac`, the project or the key lookup, so nothing is created.
   - `link-api.ts:124-127` always passes `body` through `str()`, so the `typeof body === "string"` guard is only defensive.
   - Idempotent resends still work. The command sends the same `body` string it hashed (upload.ts:240, :396, `uploadLink.upload` sends `input` unchanged), so a resend carries the same hash and reaches the `prior` lookup and `already`.
   - A resend whose only change is a Status or gate line has the same kit hash, so it still resolves to the first Story.
   - Test tests/hub-story-upload.test.mjs:246 covers three mismatches, each giving 400 INVALID with no Story under either key, and a CRLF body with a Status line that is accepted. The existing tests now send real kit hashes (FIRST, OTHER, THIRD); "same text uploads once" still asserts one Story and one record.

Tests: the fix report names the covering tests and gives RED and GREEN counts for each fix. It also reports focused 1062/1062, full 1841/1841 and typecheck exit 0. I checked these claims against the diff. I re-ran no tests, because no doubt came up that those runs do not answer.

### New Breakage in the Fix Diff

No Critical or Important breakage. Named risks checked:

- (a) Guide copy:
  - Symlinks: `~/.claude`, `.claude/skills`, the guide folder, SKILL.md and the sidecar are each checked with lstat (mac.ts:290-291), so nothing is written through a link.
  - Temp files: they get UUID names and are opened with `flag: "wx"`, which fails on an existing path or symlink. They are removed in `finally` (mac.ts:262-275).
  - Rename onto a symlinked final path replaces the link and does not follow it.
  - User edits are never overwritten: an edited guide, a guide with no sidecar, an unreadable or folder sidecar, or a SKILL.md that is not a regular file all give "kept-user-edit".
  - The caller catches any error (mac.ts:410-421).
- (b) Live script:
  - The restore step only sets `d.open = true` on folds already in the swapped `<main>` and calls `.focus()` on the element `getElementById` finds. It injects and runs nothing. The swap is still the old `main.innerHTML` (innerHTML does not run `<script>`, and CSP is unchanged).
  - The hidden, typing and dirty guards are still checked both before the fetch and before the swap (:52, :62).
- (c) G3 trigger: clean, as verdict 1 describes.
- (d) Hash check: idempotent resends are clean, as verdict 7 describes.

Minor:

1. **Focus restore is a no-op on today's markup, and when it does fire it may scroll.** src/hub/live-script.ts:69-75
   - Today no focusable element inside a live page's `<main>` has an id. The only `id=` in src/hub is `copy-value`, a `<pre>`. So a `<summary>` someone clicked or tabbed to, a link or a button still loses focus to `body` on each swap. The fold itself does stay open.
   - When restore does fire, `again.focus()` without `{ preventScroll: true }` can scroll the page. K6 rejected `location.reload()` partly because the page jumps.
   - Suggested fix: give folds and cards stable ids, or match focus the way folds are matched, and pass `preventScroll`.
2. **A forgotten text selection silently freezes live updates.** src/hub/live-script.ts:29-34, :52
   - A double-click or triple-click that leaves text selected in `<main>` stops every swap until the selection collapses.
   - Meanwhile the page still says "저절로 업데이트". This matters most on a board left open on a shared screen.
   - Ruling line 100 accepts the skip itself; what is missing is any sign of it on the page.
3. **A failure between the two renames leaves the guide stuck as "user-edited".** src/cli/mac.ts:306-307
   - The sidecar is renamed first. If replacing our older guide and the SKILL.md rename then fails, the old SKILL.md is left next to the new hash. Every later run then answers "kept-user-edit" and never updates the guide.
   - This errs on the safe side, since it never overwrites. The comment at :306 covers only the case where the guide was absent.
   - It can hardly happen: both renames are in the same folder, and the earlier lstat already checked that SKILL.md is a regular file.
4. **The "kept-user-edit" message is wrong for the symlink case.** src/cli/mac.ts:291, :415-416
   - A symlinked `~/.claude` or `~/.claude/skills` (dotfiles setups) now gives "kept-user-edit". `mac connect` then prints "고친 안내가 있어 그대로 둡니다" although no guide was installed at all.
   - Ruling line 105 accepts not installing, and LOCAL-PREVIEW.md:434 documents it. The message itself is still misleading.
5. **A non-boolean `requiresG3` passes silently.** src/team/upload.ts:249
   - `profile?.requiresG3 === true` treats a profile that is JSON but invalid for the kit (for example `"requiresG3": "true"`) as not requiring G3.
   - The kit refuses such a profile (`.ai-workflow/graph/verification.mjs:15`).
   - Meanwhile a non-JSON profile refuses every upload, so the two broken cases are handled differently.

### Out-of-Scope Observations

1. docs/plans/2026-11-11-1400-feat-hub-board-plan.md:252 still says the installed guide's first line is `<!-- pazmo-office managed: sha256=… -->`. That is stale against the sidecar design. It is a HOW doc; update or prune it in the compound pass.
2. The G3-line trigger can be removed without breaking G1, because `kitStoryHash` leaves out `Understanding gate (G[134]):` lines (src/core/kit-role-runs.ts:31).
   - Deleting the G3 line from an approved Story keeps its G1 record valid. Without `requiresG3: true` in the profile, the Story then uploads as normal.
   - The binding trigger is the profile; the G3 line is defence in depth. The profile itself is an unsigned workspace file.
   - Both fall under the accepted local-trust model (R2 residual note). This is not a regression of the fix.
3. SKILL.md's Task-file example still shows `"risk": "normal"` (skills/pazmo-hub-upload/SKILL.md:34).
   - In a kit repo whose profile still has `requiresG3: true` from an earlier run, as this repo's own `.ai-workflow/verification.json:126` does, the first attempt gets UPLOAD_G3.
   - The refusal message tells the agent to set `high`, so this only costs one extra run.

### Verdict

**Fix round:** All findings addressed, no new Critical or Important breakage. Five Minor items in the fix diff (focus restore no-op or scroll, silent freeze under a selection, rename-order stale guide, symlink message wording, non-boolean `requiresG3`) are for the controller's ledger.
