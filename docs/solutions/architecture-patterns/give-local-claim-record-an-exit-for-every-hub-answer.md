---
title: Give every blocking local claim state an exit for every Hub answer
date: "2026-10-29"
category: architecture-patterns
module: Team Office Story claim (local record, scheduler, registry)
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
symptoms:
  - "Heartbeat answered 404 NOT_FOUND after the repo was relinked to a recreated or another Hub, or recreated with a new id, yet every tick still said open and `team remove` kept refusing with OPEN_CLAIM"
  - "A registered repo folder was moved or deleted: start --team died with a raw ENOENT inside the service, up --team with a git error, and team remove refused with OPEN_CLAIM"
  - "One permanently failing lane (persistent 404 or config error) ended the whole claim cycle on retry and starved every later lane and recovery"
root_cause: logic_error
resolution_type: code_fix
tags: [team-hub, story-board, open-claim, scheduler, heartbeat, not-found, record-lifetime, dead-end-state]
---

# Give every blocking local claim state an exit for every Hub answer

## Context
Team Story board stage 2 (PR syjkim0125/pazmo-agent-office#41, merged 2026-10-29) lets one team Office claim Story Tasks from the team Hub for several registered repos. The Office keeps a local record of the one Task it has claimed in `<dataRoot>/team/team.sqlite`. Two local states block progress:

- **The open record.** A unique partial index allows one open row (`src/team/store.ts:70`), and `recordClaim` refuses a second with `OPEN_CLAIM` (`store.ts:185-191`). While a record is open, every claim tick stops before any Hub call (`src/team/scheduler.ts:134`; test "an open record ends the tick before any Hub call"). `team remove` refuses that repo with `OPEN_CLAIM` (`src/team/registry.ts:250-256`).
- **A lane state other than `ready`.** Recovery and the claim pass skip such a lane (`scheduler.ts:121`, `147`). The Office sets `no-link` or `gh` at start (`src/team/office.ts:150`, `293`). The scheduler sets `relink` or `hub-too-old` when the Hub refuses a call (`scheduler.ts:83-85`, `190-192`).

Independent reviews, per Task and of the whole branch (`.ai-workflow/runs/U21-review-1.md`), found three ways into these states with no way out. None of them crashed. The Office logged a line, kept waiting, and refused the commands that would have freed it. All three were fixed before merge.

## Guidance
**Rule:** for every local state that blocks progress, list every remote answer and every local precondition that can keep it. Check that at least one of them leads out, and pin each exit with a test. A generic `retry` bucket is where permanent conditions hide.

The open record's exits as merged (test files under `tests/`, line of the `test(` call):

| What happened | What the Office sees | Exit | Test |
|---|---|---|---|
| The PL cancels (or releases) the Task | heartbeat `409 NOT_YOURS` | drop, reason `NOT_YOURS` (`scheduler.ts:176-187`) | `team-scheduler` "a heartbeat answered NOT_YOURS drops the record and the next tick claims fresh" (272); real Hub (644) |
| Hub wiped and recreated (once the repo is linked to it again; the old token first gets `401`, which moves the lane to `relink`), repo linked to another Hub, or repo recreated under a new id | heartbeat `404 NOT_FOUND`: the Hub cannot see the Task through this link (`src/hub/story-store.ts:589-592`) | drop, reason `NOT_FOUND`; the next tick's inbox recovery records it again if the Hub still says it is this member's | `team-scheduler` "a heartbeat answered 404 NOT_FOUND drops the record; a tick whose inbox still reports the claim records it again as recovered" (368) |
| Repo folder moved or deleted | the folder does not exist | `team remove` drops, reason `REPO_REMOVED` (`registry.ts:236`, `246-257`); every start fails first with `REPO_MISSING` | `team-registry` (305, 329); `team-office` (544); `team-lifecycle` (142) |
| Link refused: 401, untrusted TLS, protocol too old | heartbeat `relink` or `hub-too-old` | record kept, lane taken out of use (`scheduler.ts:190-192`); the lane's exit is the 300 s recheck (`office.ts:306-331`) | `team-scheduler` (302); `team-office` "every 300000 ms the lanes that are not ready are checked again, in place, and ready lanes are left alone" (259) |
| Task left `claimed` under this claim; network or Hub error; no lane or link for the record | `409 STATE`; `retry`; no call | kept on purpose and logged (`scheduler.ts:161-164`, `188-189`, `193-194`) | `team-scheduler` (289, 316, 327) |

How to add an exit without breaking something else:

- **Read the special answer where its meaning is known.** The 404 drop is a local `isNotFound` check used only in `runBeat` (`scheduler.ts:48-52`, `175`). The shared `classifyLinkError` (`src/team/story-link.ts:60-67`) has no 404 branch and did not change. A 404 on inbox, claim or task is still a lane-level retry (`team-scheduler` 444, 483, 511). A heartbeat 404 without code `NOT_FOUND` keeps the record (401).
- **Drop only what you still hold.** Both drops compare the current record's `taskId` and `claimId` with the ones sent (`scheduler.ts:179-180`). A record replaced while the heartbeat was in flight survives (`team-scheduler` 353, 387).
- **Drop only when a way back exists.** Every tick runs recovery before it claims: each ready lane's inbox, then `task()` for its `mine` (`scheduler.ts:119-131`, `136-137`). Dropping a record the Hub still holds costs one tick, not the Task.
- **Scope `retry` to the smallest unit that failed.** A failed call returns `null` from `attempt` (`scheduler.ts:106-113`), and both loops `continue` to the next lane (`122-126`, `148-149`).
- **Give every non-ready state a recheck.** `recheck` runs every 300000 ms over every lane that is not ready. It reads `hub-link.json` again, asks `gh` again for a host that failed, and recomputes the state from link and gh, in place on the lane objects the scheduler holds (`office.ts:24`, `306-331`, `351`).

## Why This Matters
These dead ends look like healthy waiting. A permanent condition classified as `retry` yields one log line per cycle and nothing else. Each tick reports `skipped: "open"`. `team remove` answers `OPEN_CLAIM` and tells the member to have the PL cancel, but no cancel can reach an Office whose link points at a Hub that does not have the Task. The member's only remaining move would be editing `team.sqlite` by hand. Happy-path tests and tests of the documented error codes pass throughout. The gap shows only when you list, per blocking state, which answers can arrive and where each one goes.

## When to Apply
- **Stage 3**, which executes claimed Tasks and adds states. One kept-record answer already has no exit: a heartbeat `409 STATE` keeps the record (`scheduler.ts:188-189`). The Hub answers `STATE` to the claimant once its own failed or merged report moves the Task out of `claimed` (`story-store.ts:599-602`). Those reports keep `claimed_by` (`story-store.ts:837`, `855`). Stage 2 sends no reports, so this cannot happen yet. Stage 3 adds the reports and must add the exit with them. The store's `done` state and `rerun` source have no writer yet (`store.ts:11`, `66`).
- Any new local flag, lock or record that makes a scheduler skip work or a CLI command refuse (`OPEN_CLAIM`, `TEAM_RUNNING`, lane states).
- Any new caller of `classifyLinkError`, and any plan step that says a failure "ends the cycle".
- Plan and code review: for each blocking state ask "which answer or local change takes us out, and which test proves it?"

## Examples
**1. A heartbeat 404 kept the record forever.** `classifyLinkError` maps a 404 to `retry`, and the heartbeat did nothing on `retry`. After a Hub wipe and a relink, a relink to another Hub, or a recreated repo, every heartbeat answered `404 NOT_FOUND`. The record stayed open, every tick stopped at `open`, and `team remove` kept answering `OPEN_CLAIM`. Fix, on the heartbeat only:

```ts
const gone = isNotFound(error); // status 404 and code "NOT_FOUND"
if (kind === "not-yours" || gone) {
  const reason = gone ? "NOT_FOUND" : "NOT_YOURS";
  const now = store.openClaim();
  if (now && now.taskId === open.taskId && now.claimId === open.claimId) {
    store.dropClaim(open.taskId, reason);
```

(`scheduler.ts:175-181`)

**2. A moved or deleted repo folder could not be cleared.** `start --team` failed with a raw `ENOENT` inside the service, and `up --team` with a git error. `team remove` refused with `OPEN_CLAIM` when that repo held the record (`docs/verification/2026-10-29-team-story-office-repos.md:51`). Fix: `assertReposPresent` (`registry.ts:135-142`) runs before anything opens in `start --team` (`src/cli/lifecycle.ts:331`), `up --team` (`src/cli/launcher.ts:308`) and the team service (`office.ts:174`). It fails `REPO_MISSING`, naming the path and `pazmo-office team remove --project <path>`. Removing a repo whose folder is gone drops its record instead of refusing:

```ts
settleOpenClaim(root, project, !existsSync(project)); // before the registry is written
// in settleOpenClaim:
if (!folderGone) fail("OPEN_CLAIM", "... ask the PL to cancel the Task on the Hub ...");
store.dropClaim(open.taskId, "REPO_REMOVED");
```

(`registry.ts:236`, `252-257`). The Hub Task shows as held once its last heartbeat is older than `HELD_AFTER_MS` = 600000 ms (`src/hub/story-protocol.ts:7`, `story-store.ts:313-316`), and the PL decides. A repo whose folder exists still gets `OPEN_CLAIM`.

**3. A `retry` ended the whole cycle.** Tick step 5 of the plan said a `retry` ends the cycle (`docs/plans/2026-10-27-1730-feat-team-story-office-repos-plan.md:234`). The Task 5 review found that one permanently failing lane would starve every later lane and recovery for good (`U21-review-1.md:13`). Fix: skip that lane for this cycle and continue. Pinned by "a 404 on one lane's claim is logged and the next lane is still claimed; the lane stays ready" (`team-scheduler` 444), "a 404 on one lane's inbox is logged and a later lane's open claim is still recovered, never claimed again" (483), and "a failing inbox read does not stop the claim pass: the lane is still asked for a claim and the next lane too" (501). Accepted cost: in a Hub outage a tick makes up to 2N failing calls, an inbox and a claim per ready lane, and logs each one every 30 s. Before, it made one.

**Lane states.** The scheduler can move a lane to `relink` or `hub-too-old`, but nothing in it moves a lane back. A Task 5 review minor was carried into Task 7 (`U21-review-1.md:17`) and became the 300 s recheck.

**Known dead ends, parked:**
- **An open record whose Hub is permanently unreachable, or whose repo lost its link.** `beat` logs and keeps the record (`scheduler.ts:161-164`, `193-194`; `team-scheduler` 327). A network failure leaves the lane `ready`, and the recheck skips ready lanes (`office.ts:312`). A ready lane's link is read only at start (`office.ts:289`). Exit today: link the repo to a reachable Hub (`hub-link`), then restart the team Office (`stop --team`, `start --team`). A running Office keeps a ready lane's old link; only a lane that had no link at start, or one in `relink` or `hub-too-old`, picks up the new link at the 300 s recheck (`office.ts:325`). The first heartbeat through the new link then gets `NOT_YOURS` after a PL cancel, or `404 NOT_FOUND`, and drops the record. A `team drop` command is a stage 3+ candidate (`U21-review-1.md:34`).
- **A stale `<dataRoot>/team/start.lock`** (Ctrl-C during start) makes `team add` and `team remove` answer `TEAM_RUNNING` (`registry.ts:99-102`). Deleting it recovers (`team-registry` 342; `U21-review-1.md:32`).

## Related
- [Forget the merge-lock holder when its own claim gives the lock up](../logic-errors/forget-merge-lock-holder-when-own-claim-gives-lock-up.md): the Hub-side version of the same rule, clear a record on every exit of what it stands for.
- [Classify a review runner failure as unknown, not as a review fail](../integration-issues/classify-review-runner-failure-as-unknown.md): another case where one bucket for two causes sends the person to the wrong fix.
- Verification record: `docs/verification/2026-10-29-team-story-office-repos.md`, final-review fix table (lines 48-56) and known limits (lines 88-92).
- Review record: `.ai-workflow/runs/U21-review-1.md`.
