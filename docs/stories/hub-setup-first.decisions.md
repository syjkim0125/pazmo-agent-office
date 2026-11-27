# Decisions: hub-setup-first

Decisions made while building [the Story](hub-setup-first.md) that change what a person sees or what the hub stores.

D1. Only a hub that serves the install line gates anyone.  Status: proposed
- Chosen: the setup check holds a member at `/mac` only on a hub started with the installer (behind the router). A hub on its own certificate (LAN mode) gates nobody and shows no "설치 확인" panel.
- Instead of: gating every hub.
- Because: a self-CA hub has no install line and cannot pair a Mac for real work, so its members could never pass.
- You would notice it is wrong if: a LAN-mode hub is expected to hold new members at `/mac`.
- To reverse: make `setupGated` in `src/hub/server.ts` ignore `installer`.
- Kept true by: `tests/hub-setup.test.mjs` "a hub on its own certificate (no installer) gates nobody".

D2. The check is stored on the member row.  Status: proposed
- Chosen: `hub_members` gets `setup_exempt` (0/1), `setup_mac_id` (the Mac the member passed with) and `setup_at`; `hub_invites` gets `repo_ids` (a JSON array of repo ids). Added by the store's migration, empty for members from before (S3a).
- Instead of: a separate verification table.
- Because: one record per member, compared with the member's newest live Mac, is all H2 needs: a Mac going off keeps it, revoking it or pairing a new Mac no longer matches.
- You would notice it is wrong if: a member who paired a new Mac keeps the hub without passing the four rows again.
- To reverse: drop the columns; nobody is gated without them only if `setupPassed` is also removed.
- Kept true by: `tests/hub-setup.test.mjs` E10 and E12.

D3. A passing check is recorded on the request that sees it.  Status: proposed
- Chosen: whenever the hub reads a member's check (any signed-in request on a gated hub, and `/mac`) and all four rows pass, it records that Mac at once. An existing member whose Mac passes now goes straight to the board (E10).
- Instead of: recording only when the member presses [허브로 가기].
- Because: the Story says the first moment the rows pass is the moment the hub opens.
- You would notice it is wrong if: a member is let in by a Mac they did not mean to use.
- To reverse: record only in a POST from the panel.
- Kept true by: `tests/hub-setup.test.mjs` E10.

D4. What a held member may still reach.  Status: proposed
- Chosen: GET `/mac`, `/mac/approve`, `/account`; POST `/logout`, `/account/logout-others`, `/account/devices/<id>/logout`, `/mac/approve`, `/mac/deny`, `/me/theme`, `/mac/exempt`, and `/macs/<id>/revoke` only for their own Mac. Everything else is 303 to `/mac`; a POST does nothing. The theme switch stays because it changes only this browser.
- Instead of: also letting a held admin end other members' Macs from `/mac`'s route.
- Because: H3 lists only installation and sign-in pages.
- You would notice it is wrong if: a held admin needs to manage members before passing (they can exempt themself first, E9).
- To reverse: edit `openWhileGated` in `src/hub/server.ts`.
- Kept true by: `tests/hub-setup.test.mjs` E2/H1/H3 and E6.

D5. The held header.  Status: proposed
- Chosen: no 보드/팀 menu, no auto-work switch, and the name tag is not a link to `/me`; 내 로그인, the theme button and the Mac chip stay. On a hub without the Story board the header shows only the name (to 내 로그인) and the Mac chip.
- Instead of: keeping the name tag link (it would only bounce back to `/mac`).
- Because: E1.
- You would notice it is wrong if: a held member cannot find how to sign out (it is on 내 로그인).
- To reverse: `boardHeader` and `layout` in `src/hub/pages.ts` (`chrome.gated`).
- Kept true by: `tests/hub-setup.test.mjs` E1.

D6. The row words.  Status: proposed
- Chosen: each row shows 통과 / 아직 / 확인 중 and one sentence. 확인 중 is only a newly paired Mac whose Office has not reported yet (within 3 minutes). Runner details map to "<runner> 로그인이 필요합니다" (not_ready, login), "사용 한도에 걸렸습니다" (limit), "결제나 요금제 확인이 필요합니다" (billing), "Office가 일을 받지 않는 상태로 켜져 있습니다" (locked); plugin details name the plugin without its marketplace (`name@market` → `name`). An unlisted plugin shows the command `pazmo-office runner plugins --review`; a refused one says to ask the organization admin and shows no command.
- Instead of: the full `name@market` source, or the per-plugin `allow-plugin` command.
- Because: E4 and E7 name the plugin and one allow command; the review command lets the person see every plugin at once.
- You would notice it is wrong if: two plugins share a name in different marketplaces and the row names the wrong one.
- To reverse: `runnerReason` in `src/hub/setup.ts`.
- Kept true by: `tests/hub-setup.test.mjs` E4/E7 and "setupRows".

D7. The exemption button sits in the member's 관리 fold.  Status: proposed
- Chosen: on 팀원·초대 (`/members`) [설치 확인 없이 허용] / [면제 해제] is the first button in each member's 관리 fold; "설치 확인 면제" is a pill beside the name, always visible.
- Instead of: a button outside the fold.
- Because: the page's rule (U45) keeps everything that changes a member inside 관리.
- You would notice it is wrong if: an admin cannot find the button.
- To reverse: move `exemptForm` out of `actions` in `members()` in `src/hub/pages.ts` (and update the U45 test).
- Kept true by: `tests/hub-setup.test.mjs` E8; `tests/hub-board-page.test.mjs` U45.

D8. The Office's plugin check.  Status: proposed
- Chosen: when every engine's runners pass and an engine's agent runs claude (work or review), the team Office starts claude up to its init (no model call) and judges its plugins against the allowed list. The first unlisted plugin wins over a refused one in the heartbeat (`claude: plugin-unlisted <source>`, else `claude: plugin-refused <source>`, cut at 200 characters). One answer serves the same claude binary (sha256) and allowed list for the recheck interval (5 minutes); a changed list is checked on the next claim tick. A failed check judges nothing (the runs still refuse a bad plugin as before). The check does not trap the process's signals, so the Office's SIGTERM stays its graceful stop.
- Instead of: refused first, or checking on every tick.
- Because: the allow command fixes an unlisted plugin, so it is the next useful step; starting claude every 30 s would be heavy.
- You would notice it is wrong if: a Mac with only a refused plugin shows the unlisted one's command after the person allowed it (it then moves to the refused one on the next tick).
- To reverse: `pluginDetail` and `createPluginCheck` in `src/team/plugin-check.ts`.
- Kept true by: `tests/team-plugin-check.test.mjs`; `tests/team-office.test.mjs` "S1 (hub-setup-first)".

D9. An invite's repos are checked when made and skipped when gone.  Status: proposed
- Chosen: a repo id that is not registered refuses the invite (400); a chosen repo deleted before the link is used is skipped; a password reset link carries no repos.
- Instead of: storing any id and failing on acceptance.
- Because: E11; a dead repo should not stop someone from joining.
- You would notice it is wrong if: a joined member is missing a repo the admin chose.
- To reverse: `createInvite` and `acceptInvite` in `src/hub/store.ts`.
- Kept true by: `tests/hub-setup.test.mjs` E11.

## Example check

- E1: `tests/hub-setup.test.mjs` "E1: a new invitee lands on /mac…"; `src/hub/server.ts` `signedIn` (land on `/mac`), `src/hub/pages.ts` `boardHeader` (`chrome.gated`) and `mac()` (the line).
- E2: `tests/hub-setup.test.mjs` "E2/H1/H3…"; `src/hub/server.ts` `openWhileGated` and the gate after the CSRF check.
- E3: `tests/hub-setup.test.mjs` "E3/E11…"; `src/hub/setup.ts` `setupRows`, `src/hub/pages.ts` `setupPanel` (live page via `live()`).
- E4: `tests/hub-setup.test.mjs` "E4/E7…"; `src/hub/setup.ts` `runnerReason`.
- E5: `tests/hub-setup.test.mjs` "E5…" and the end of "E4/E7…"; `setupRows` (담당 레포 없음).
- E6: `tests/hub-setup.test.mjs` "E6…"; `src/hub/server.ts` gate (POST → 303 `/mac`, nothing done).
- E7: `tests/hub-setup.test.mjs` "E4/E7…"; `tests/team-plugin-check.test.mjs`; `tests/team-office.test.mjs` "S1 (hub-setup-first)…"; `src/team/plugin-check.ts`, `src/team/office.ts` `checkRunners`/`presenceOf`.
- E8: `tests/hub-setup.test.mjs` "E8…"; `src/hub/store.ts` `setSetupExempt`, route `/members/<id>/setup-exempt`, `members()` fold.
- E9: `tests/hub-setup.test.mjs` "E9…"; route `/mac/exempt`, `setupPanel` admin button.
- E10: `tests/hub-setup.test.mjs` "E10…"; `src/hub/store.ts` migration and `setupCheck` recording.
- E11: `tests/hub-setup.test.mjs` "E3/E11…" and "E11: an invite refuses…"; `createInvite`/`acceptInvite` `repo_ids`, `members()` checkboxes.
- E12: `tests/hub-setup.test.mjs` "E12/H2…"; `src/hub/store.ts` `setupPassed` (record vs newest live Mac).
