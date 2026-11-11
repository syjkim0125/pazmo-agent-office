---
title: Real-check Mac-paired Hub features on a router-mode Hub, not the local self-CA Hub
date: "2026-11-11"
category: workflow-issues
module: team Hub real check
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A Hub feature only accepts a link minted by a paired Mac (for example `pazmo-office team upload`, D42)"
  - "The planned real check runs on a Hub started locally with its own CA (`pazmo-office hub --host 127.0.0.1 ...`)"
  - "New Hub web code should be looked at on real data before merging, without touching the running check Hub"
symptoms:
  - "On the local check Hub, `/mac` says the one-line install cannot be used, and the team Offices there are linked with connection strings"
  - "An upload from such an Office is refused with NOT_YOUR_MAC, although the PL is signed in and owns every repo"
tags: [team-hub, self-ca, mac-pairing, real-check, team-upload, preview, local-hub]
---

# Real-check Mac-paired Hub features on a router-mode Hub, not the local self-CA Hub

## Context

U39 (D42, PR #81) added `POST /api/link/story/upload` and the `pazmo-office team upload` command. By design (K2 in `docs/understanding/hub-board-local-upload-plan.md`) the Hub accepts an upload only through a link that the PL's current Mac minted. At G4 the plan was to try the upload for real on this Mac's local check Hub (the one set up as in [run-a-team-stage-real-check-on-a-local-hub.md](run-a-team-stage-real-check-on-a-local-hub.md)). It could not work there, and the reason is structural, not a bug.

## Guidance

- **A self-CA Hub cannot pair Macs.** Mac API calls trust only the system's certificate store: `hubCall({ hub: target.hub, caPem: null, fingerprint: null, ... })` (`src/team/mac.ts:130`). A Hub that serves its own CA therefore cannot finish `mac connect`. Its `/mac` page says so ("이 허브는 사내 인증서를 써서 설치 한 줄을 쓸 수 없습니다", `src/hub/pages.ts:263`). On such a Hub, team Offices are linked repo by repo with connection strings (`hub-link --connect`), which mint links with no Mac.
- **Mac-only routes refuse those links.** The upload checks that the link's Mac is the member's current Mac and answers 403 `NOT_YOUR_MAC` otherwise (`src/hub/story-store.ts:877`, `currentMac` in `src/hub/store.ts:1046`). `upload-bases` applies the same check. So on the local check Hub, `team upload` is always refused.
- **Real-check Mac-paired features on a router-mode Hub.** Use the company Hub behind its router, where the one-line install pairs Macs. Until it is redeployed with the feature, write the upload check down as "not verified" rather than working around the Mac check.
- **Preview new web code on real data with a copy.** Do not restart the running check Hub on unmerged code. Copy its data folder and run the new code on another port:
  1. Copy the data folder's tls folder as it is.
  2. Copy the database with `VACUUM INTO` from a read-only connection, which is safe while the Hub runs.
  3. Run `node <new checkout>/bin/pazmo-office.mjs hub --host 127.0.0.1 --port <other port> --data-dir <copy>`. The new code migrates only the copy.
  4. Mint sign-ins in the copy with `HubStore.createDeviceInvite`, sign in with `curl` (send an `Origin` header, or the POST is refused), and save the pages.
  5. Open the saved HTML through a local static server to take screenshots.

## Why This Matters

Trying a Mac-only feature on a self-CA Hub wastes the real-check slot and can tempt a workaround: minting a Mac link straight into the database, or loosening the Mac check "for testing". Either would test something other than what the team will run. The copy-and-preview route still gives real screens on real data without touching the Hub a teammate may be testing on. During U39 it confirmed the board landing, the 304 on an unchanged page, the pre-sign-in cookie and the CSP line.

## When to Apply

- Any check of a feature that requires a Mac-minted link or a paired Mac (uploads, Mac state, the Mac approval screen).
- Not for features that work with connection-string links (claiming and running Tasks, the board, the web planning pages). The local check Hub covers those, as in the related doc.

## Examples

Copy and preview, as done for U39:

```bash
B=~/Documents/pazmo-midcheck/b3/hub; S=$SCRATCH/board-check
mkdir -p $S/hub/team-hub && cp -R $B/team-hub/tls $S/hub/team-hub/
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
new DatabaseSync('$B/team-hub/hub.sqlite', { readOnly: true }).exec(\"VACUUM INTO '$S/hub/team-hub/hub.sqlite'\");"
node <worktree>/bin/pazmo-office.mjs hub --host 127.0.0.1 --port 18446 --data-dir $S/hub
```

## Related

- [run-a-team-stage-real-check-on-a-local-hub.md](run-a-team-stage-real-check-on-a-local-hub.md): how the local check Hub itself is set up.
- [redeploy-team-hub-to-openshift-from-fresh-bundle.md](redeploy-team-hub-to-openshift-from-fresh-bundle.md): the router-mode Hub where the upload check belongs.
- `docs/verification/2026-11-11-hub-board.md`: U39's change record and its unverified list.
