---
title: Give every blocking local claim state an exit for every Hub answer
date: "2026-10-29"
last_updated: "2026-11-02"
last_refreshed: "2026-11-05"
category: architecture-patterns
module: Team Office Story claim (local record, scheduler, executor, registry)
problem_type: architecture_pattern
component: service_object
related_components:
  - database
  - testing_framework
severity: high
applies_when:
  - "A local record gates later work or blocks a command (a scheduler that claims nothing new, a remove that refuses) until a remote system answers"
  - "The remote side can answer something the plan did not list: a Task the Hub no longer has after a relink to a new or another Hub, a repo recreated with a new id, a permanently failing call"
  - "The record names a resource that can disappear from under it, such as a registered repo folder"
  - "One loop serves several independent lanes and a single lane can fail permanently"
  - "A record also holds work still owed to the remote side (a report in an outbox), so dropping it could lose that work"
symptoms:
  - "Heartbeat answered 404 NOT_FOUND after the repo was relinked to a recreated or another Hub, or recreated with a new id, yet every tick still said open and `team remove` kept refusing with OPEN_CLAIM"
  - "A registered repo folder was moved or deleted: start --team died with a raw ENOENT inside the service, up --team with a git error, and team remove refused with OPEN_CLAIM"
  - "One permanently failing lane (persistent 404 or config error) ended the whole claim cycle on retry and starved every later lane and recovery"
  - "Heartbeat answered 409 STATE after the Office's own merged or failed report, and the record could neither finish nor be dropped"
root_cause: logic_error
resolution_type: code_fix
tags: [team-hub, story-board, open-claim, scheduler, executor, heartbeat, not-found, state, outbox, record-lifetime, dead-end-state]
---

# Give every blocking local claim state an exit for every Hub answer

## Context
Team Story board stage 2 (PR syjkim0125/pazmo-agent-office#41, merged 2026-10-29) lets one team Office claim Story Tasks from the team Hub for several registered repos. Stage 3 (the Story Task mode, branch `codex/team-story-task`) runs the claimed Task and reports it. The Office keeps a local record of the one Task it holds in `<dataRoot>/team/team.sqlite`. Two local states block progress:

- **The open record.** A unique partial index allows one open row (`src/team/store.ts:178`), and `recordClaim` refuses a second with `OPEN_CLAIM` (`store.ts:437-446`). While a record is open, every claim tick stops before any Hub call (`src/team/scheduler.ts:199`; test "an open record ends the tick before any Hub call"). `team remove` refuses that repo with `OPEN_CLAIM` (`src/team/registry.ts:253-264`). Since stage 3 the record also has a phase (`claimed`, `building`, `verified`, `merging`, `reporting`, `failed`) and may hold a report the Hub has not taken yet.
- **A lane state other than `ready`.** Recovery and the claim pass skip such a lane (`isReady`, `scheduler.ts:38-39`; checked at `136` in `recover` and at `217` in the claim pass). The Office sets `no-link` or `gh` at start (`stateOf`, `src/team/office.ts:242`, applied at `429`). The scheduler sets `relink` or `hub-too-old` when the Hub refuses a call (`scheduler.ts:94-102`, `257-266`).

Independent reviews, per Task and of the whole branch (`.ai-workflow/runs/U21-review-1.md`), found three ways into these states with no way out in stage 2. None of them crashed. The Office logged a line, kept waiting, and refused the commands that would have freed it. All three were fixed before merge. Stage 3 added the reports, and with them the `409 STATE` answer, which needed its own exit.

## Guidance
**Rule:** for every local state that blocks progress, list every remote answer and every local precondition that can keep it. Check that at least one of them leads out, and pin each exit with a test. A generic `retry` bucket is where permanent conditions hide. A record that still owes the remote side something (a report) must send it before any answer drops it.

The open record's exits as of stage 3 (test files under `tests/`, line of the `test(` call):

| What happened | What the Office sees | Exit | Test |
|---|---|---|---|
| The PL cancels (or releases) the Task | heartbeat `409 NOT_YOURS` | a pending merged report is sent first (the Hub takes the late report of the claim that held the merge lock); otherwise drop, reason `NOT_YOURS` (`scheduler.ts:274-283`, `294-321`) | `team-scheduler` "a heartbeat answered NOT_YOURS drops the record and the next tick claims fresh" (351), "a heartbeat answered NOT_YOURS with a pending merged report resends it before anything is dropped" (544) |
| The Office reported the Task itself (merged or failed) | heartbeat `409 STATE` (the Hub answers it once its own report moved the Task out of `claimed`: `#owned`, `src/hub/story-store.ts:658-663`, which `heartbeat` calls at `787`) | merged report pending: sent again, answered `already`, record `done`. Nothing pending: drop, reason `STATE`. A failed report still pending: kept for the executor to send (`scheduler.ts:294-321`) | `team-scheduler` (436, 624, 531); real Hub (1160, 1184) |
| A failed Task (not heartbeated) is released or cancelled by the PL, or the Hub no longer knows it | `task()` read `NOT_YOURS` or `404 NOT_FOUND` | drop (`scheduler.ts:336-342`) | `team-scheduler` "a failed record is not heartbeated; its task() NOT_YOURS or NOT_FOUND drops it" (392) |
| The member asks for a rerun of the failed Task | `team rerun --memo` writes the request (`src/cli/team.ts`). A rerun from the Hub web changes only the Hub: the Task gets a new claim for the same member (`rerunTask`, `src/hub/story-store.ts:838-849`; refused `NOT_LINKED` where this Office is not taking the repo now, see Related) | the executor asks the Hub `rerun` and replaces the record with the new claim (`src/team/executor.ts:606-640`). After a web rerun, the failed record's next `task()` read answers `NOT_YOURS` and drops it, and the next tick's recovery records the new claim (`scheduler.ts:336-342`, `134-157`) | `team-executor` (1185, 1231); `team-lifecycle` "team rerun --memo writes the request; NO_FAILED_CLAIM without a failed record"; `team-office` "with --live, a repo engine that settles drives the open record at once"; `hub-web-office` "a web rerun of a failed Task: the next beat drops the failed record as NOT_YOURS, …" (124) |
| The Hub refuses a report for good (`INVALID`, `LOCK_REQUIRED`, a `STATE` for another commit) | the executor's report call, or the heartbeat's merged resend, fails with a final kind | drop, reason `HUB_REFUSED_REPORT` (or `NOT_YOURS`/`NOT_FOUND`), with the PR named in the log (`executor.ts:560-570`, `scheduler.ts:311-316`). The Hub still lists the claim as this member's, so recovery does not take a claim whose last record was dropped this way back (`store.refusedClaim`, `scheduler.ts:140-143`, `165-175`): one line, shown as `blockedBy`, no heartbeat, so the Hub shows it held and the PL releases or cancels it. The store refuses a PR address the Hub would refuse (`prUrlOf`, shared in `story-protocol.ts`), and the executor reports the https address of the remote and PR number instead | `team-executor` "a merged report the Hub refuses for good is dropped once with its PR: …" (1438); `team-scheduler` (477, 499) |
| Hub wiped and recreated (once the repo is linked to it again; the old token first gets `401`, which moves the lane to `relink`), repo linked to another Hub, or repo recreated under a new id | heartbeat `404 NOT_FOUND`: the Hub cannot see the Task through this link (`#visible`, `story-store.ts:648-652`) | drop, reason `NOT_FOUND`; the next tick's inbox recovery records it again if the Hub still says it is this member's | `team-scheduler` "a heartbeat answered 404 NOT_FOUND drops the record; a tick whose inbox still reports the claim records it again as recovered" (866) |
| Repo folder moved or deleted | the folder does not exist | `team remove` drops, reason `REPO_REMOVED` (`registry.ts:243`, `253-264`); every start fails first with `REPO_MISSING` | `team-registry` (274, 309); `team-office` (1443); `team-lifecycle` (234) |
| Link refused: 401, untrusted TLS, protocol too old | heartbeat `relink` or `hub-too-old` | record kept, lane taken out of use (`scheduler.ts:257-266`); the lane's exit is the 300 s recheck (`office.ts:610-637`) | `team-scheduler` (792); `team-office` "every 300000 ms the lanes that are not ready are checked again, in place, and ready lanes are left alone" (438) |
| Network or Hub error; no lane or link for the record | `retry`; no call | kept on purpose and logged (`scheduler.ts:263-264`, `349-353`) | `team-scheduler` (806, 817) |
| A restart finds a record left `merging` (PR merged, no report written) whose claim the PL released | the next heartbeat would answer `NOT_YOURS` with no report pending, and drop it | a live start drives the record at once; heartbeats do not wait for that drive, but until it settles a heartbeat `NOT_YOURS` keeps a `verified` or `merging` record (`keepOnNotYours`, `office.ts:601`). The drive's merge lock answers not-yours, the PR is read, and the merged report is written and sent (`executor.ts:506-512`) | `team-office` "with --live, the heartbeat does not wait for the first drive; until that drive settles a NOT_YOURS keeps a verified or merging record, …" (781) |

How to add an exit without breaking something else:

- **Read the special answer where its meaning is known.** `classifyLinkError` (`src/team/story-link.ts:123-132`) names the kinds; only the calls about the open claim drop on `not-yours` or `not-found` (`scheduler.ts:274-283`). A 404 on inbox, claim or task-during-recovery is still a lane-level retry (`team-scheduler` 981, 942, 1009). A heartbeat 404 without code `NOT_FOUND` keeps the record (899).
- **Send what is owed before you drop.** A merged report waiting in the record goes to the Hub on `NOT_YOURS` and `STATE` alike, and the record closes as `done` only after the Hub has it (`scheduler.ts:294-321`). The executor writes the report to the record before it sends it (outbox), so a stop between the two sends it again.
- **Drop only what you still hold.** Every drop compares the current record's `taskId` and `claimId` with the ones sent (`scheduler.ts:236-254`). A record replaced while the call was in flight survives (`team-scheduler` 639, 851, 885).
- **Drop only when a way back exists.** Every tick runs recovery before it claims: each ready lane's inbox, then `task()` for its `mine` (`scheduler.ts:134-157`, `201`). Dropping a record the Hub still holds costs one tick, not the Task.
- **Scope `retry` to the smallest unit that failed.** A failed call returns `null` from `attempt` (`scheduler.ts:120-127`), and both loops `continue` to the next lane.
- **Give every non-ready state a recheck.** `recheck` runs every 300000 ms over every lane that is not ready, and at once after a connected Mac's repo check mints a link (`office.ts:545-547`; `team-office` "a link the repo check mints reaches its lane at once, not one repo check later" (1338)). It reads `hub-link.json` again, asks `gh` again for a host that failed, and recomputes the state from link and gh, in place on the lane objects the scheduler holds (`office.ts:35`, `610-637`).

## Why This Matters
These dead ends look like healthy waiting. A permanent condition classified as `retry` yields one log line per cycle and nothing else. Each tick reports `skipped: "open"`. `team remove` answers `OPEN_CLAIM` and tells the member to have the PL cancel, but no cancel can reach an Office whose link points at a Hub that does not have the Task. The member's only remaining move would be editing `team.sqlite` by hand. Happy-path tests and tests of the documented error codes pass throughout. The gap shows only when you list, per blocking state, which answers can arrive and where each one goes.

## When to Apply
- Any new local flag, lock or record that makes a scheduler skip work or a CLI command refuse (`OPEN_CLAIM`, `TEAM_RUNNING`, lane states, record phases).
- Any new caller of `classifyLinkError`, and any plan step that says a failure "ends the cycle".
- Any record that also carries work owed to the other side: check every drop path for what it loses.
- Plan and code review: for each blocking state ask "which answer or local change takes us out, and which test proves it?"

## Examples
**1. A heartbeat 404 kept the record forever (stage 2).** `classifyLinkError` then mapped a 404 to `retry`, and the heartbeat did nothing on `retry`. After a Hub wipe and a relink, a relink to another Hub, or a recreated repo, every heartbeat answered `404 NOT_FOUND`. The record stayed open, every tick stopped at `open`, and `team remove` kept answering `OPEN_CLAIM`. Fixed with a heartbeat-only check in stage 2; stage 3 moved it into the shared classifier as the `not-found` kind, read only for the calls about the open claim:

```ts
function answer(open: OpenClaim, lane: RepoLane, what: string, error: unknown): void {
  const kind = classifyLinkError(error);
  if (kind === "not-yours") drop(open, "NOT_YOURS", ...);
  else if (kind === "not-found") drop(open, "NOT_FOUND", ...);
  else keep(open, lane, what, kind, error);
}
```

(`scheduler.ts:274-283`; `drop` checks the claim id first, `236-254`.)

**2. A moved or deleted repo folder could not be cleared.** `start --team` failed with a raw `ENOENT` inside the service, and `up --team` with a git error. `team remove` refused with `OPEN_CLAIM` when that repo held the record (`docs/verification/2026-10-29-team-story-office-repos.md:51`). Fix: `assertReposPresent` (`registry.ts:142-149`) runs before anything opens in `start --team`, `up --team` and the team service (`src/cli/lifecycle.ts:537`, `src/cli/launcher.ts:356`, `office.ts:273`). It fails `REPO_MISSING`, naming the path and `pazmo-office team remove --project <path>`. Removing a repo whose folder is gone drops its record instead of refusing:

```ts
settleOpenClaim(root, project, !existsSync(project)); // before the registry is written
// in settleOpenClaim:
if (!folderGone) fail("OPEN_CLAIM", "... it closes when the Task is merged and reported, or when the PL cancels ...");
store.dropClaim(open.taskId, "REPO_REMOVED");
```

(`registry.ts:243`, `253-264`). The Hub Task shows as held once its last heartbeat is older than `HELD_AFTER_MS` = 600000 ms (`src/hub/story-protocol.ts:7`), and the PL decides. A repo whose folder exists still gets `OPEN_CLAIM`.

**3. A `retry` ended the whole cycle.** Tick step 5 of the stage 2 plan said a `retry` ends the cycle (`docs/plans/2026-10-27-1730-feat-team-story-office-repos-plan.md:234`). The Task 5 review found that one permanently failing lane would starve every later lane and recovery for good (`U21-review-1.md:13`). Fix: skip that lane for this cycle and continue. Pinned by `team-scheduler` 942, 981 and 1009. Accepted cost: in a Hub outage a tick makes up to 2N failing calls, an inbox and a claim per ready lane, and logs each one every 30 s.

**4. The Office's own report made the heartbeat answer `409 STATE` (stage 3).** Stage 2 kept the record on `STATE`, which could not happen yet. Once the Office sends merged and failed reports, the Hub moves the Task out of `claimed` and answers the claimant's heartbeat `STATE`. Fix: `settle` reads the record again and decides by what it still owes (`scheduler.ts:294-321`): a merged report is sent again and closes the record, nothing owed drops it as `STATE`, and a failed report still pending stays for the executor, after which the record waits in phase `failed` and is read with `task()` instead of heartbeated.

**Lane states.** The scheduler can move a lane to `relink` or `hub-too-old`, but nothing in it moves a lane back. A Task 5 review minor was carried into Task 7 (`U21-review-1.md:17`) and became the 300 s recheck.

**Known dead ends, parked:**
- **An open record whose Hub is permanently unreachable, or whose repo lost its link.** `beat` logs and keeps the record (`scheduler.ts:263-264`, `349-353`; `team-scheduler` 806, 817). A network failure leaves the lane `ready`, and the recheck skips ready lanes (`office.ts:611`). A ready lane's link is read only at start (`office.ts:425`). Exit today: link the repo to a reachable Hub (`hub-link`), then restart the team Office (`stop --team`, `start --team --live`). A running Office keeps a ready lane's old link; only a lane that had no link at start, or one in `relink` or `hub-too-old`, picks up the new link at the 300 s recheck (`office.ts:624`). The first heartbeat through the new link then gets `NOT_YOURS` after a PL cancel, or `404 NOT_FOUND`, and drops the record. A `team drop` command is a later candidate (`U21-review-1.md:34`).
- **A team Office started without `--live` leaves its open record where it is.** It does not drive it. It sends the heartbeat (or reads a failed Task), except for a `verified` or `merging` record: that one may hold a merged PR not yet reported, and a heartbeat answered `NOT_YOURS` after a PL release would drop it with nothing pending. So a locked Office neither heartbeats nor drops it (the Hub shows it held after 10 minutes), and the next start with `--live` drives it at once, keeping it through a heartbeat `NOT_YOURS` until that drive settles, through the late report if the claim is gone (`team-office` "a locked start leaves a verified or merging record for a live start: …").

**Closed since:** a stale `<dataRoot>/team/start.lock` (Ctrl-C during start) made `team add` and `team remove` answer `TEAM_RUNNING` until someone deleted it (`U21-review-1.md:32`). A lock whose maker's pid is gone or from another boot, or that has had no readable pid for 60 s, no longer counts as a running team Office (`startUnderWay`, `registry.ts:96-105`; `startLockStale`, `src/cli/lifecycle.ts:167-185`). `team-registry` 362 pins it, and 346 pins that a start still under way still answers `TEAM_RUNNING`.

## Related
- [Forget the merge-lock holder when its own claim gives the lock up](../logic-errors/forget-merge-lock-holder-when-own-claim-gives-lock-up.md): the Hub-side version of the same rule, clear a record on every exit of what it stands for.
- [Classify a review runner failure as unknown, not as a review fail](../integration-issues/classify-review-runner-failure-as-unknown.md): another case where one bucket for two causes sends the person to the wrong fix.
- [Gate Hub web actions on recent Office link use, not on a valid link](../logic-errors/gate-hub-web-actions-on-recent-office-link-use.md): the Hub-side consequence of this doc's lane rule. Recovery and the claim pass skip a lane that is not ready, and a locked Office does not drive its record, so the Hub must not create a claim (a web pick or rerun) that only such a lane or a locked Office could take.
- Verification records: `docs/verification/2026-10-29-team-story-office-repos.md` (stage 2), `docs/verification/2026-11-02-team-story-task-mode.md` (stage 3).
- Review record: `.ai-workflow/runs/U21-review-1.md`.
