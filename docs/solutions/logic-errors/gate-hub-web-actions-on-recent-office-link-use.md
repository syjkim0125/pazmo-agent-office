---
title: Gate Hub web actions on recent Office link use, not on a valid link
date: "2026-11-05"
category: logic-errors
module: Team hub teammate web (pick and rerun)
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "A web pick (작업하기) or web rerun (다시 시도) was accepted, but the member's team Office never took the claim"
  - "The member was BUSY for every repo, because the Hub holds one open Task per member, until the PL released the Task"
  - "After 10 minutes the Task read 멈춤(Mac 소식 없음) and promised to continue when the Mac comes on, while the Mac was on"
  - "After the first fix, a member who owns two repos saw the 'Mac is not taking this repo' sentence on every other-repo Task while their Mac worked normally"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - database
tags: [team-hub, hub-web, reachable-repos, link-last-seen, office-recover, liveness-evidence, check-order, busy-before-not-linked]
---

# Gate Hub web actions on recent Office link use, not on a valid link

## Problem

Bundle 2 of the browser-first team flow (D41, kit unit U37, PR syjkim0125/pazmo-agent-office#77) lets a teammate pick a ready Task or rerun a failed one from the Hub web. By design the web changes only Hub state, and the member's team Office on their Mac takes the new claim through its existing recovery path (`scheduler.recover()` reads each lane's inbox and records the claim). The Hub accepted these actions when the member had a *valid* link to the repo. A valid link does not mean that the running Office will act on it. A claim made for a lane the Office was not polling was never taken, and it blocked the member in every repo.

## Symptoms

From the first kit review's live scenarios against the real scheduler and Hub (`.ai-workflow/runs/U37-review-1.md`, Office-seam reviewer I1 and I2(b)):

- **A lane that is not ready.** The Office started while `gh auth status` failed, so the lane stayed `gh` until the 5-minute recheck. The Mac still showed 대기 중. The web offered 작업하기 for that repo's Task, and the Hub accepted the pick. Every claim tick then answered `{claimed: null, open: fe-1}`: the Office treated the Task as the member's open Task, so automatic claims in **every** repo stopped.
- **The same with a link held elsewhere.** The member's live link was a connection-string link held by another Office (bundle 1's `LINKED_ELSEWHERE`), so this Mac's lane had no link at all.
- **The page then said something untrue.** After 10 minutes the Task read 멈춤(Mac 소식 없음) with "Mac이 켜지면 이어서 합니다", while the Mac was on. The assignee had no button. Only the PL's 풀기 freed the member, and nothing on the web said that fixing gh would also free it.
- **Web rerun.** A web rerun of a failed Task on a `gh` lane did the same: the heartbeat dropped the failed record as NOT_YOURS (a Hub call needs no gh), and then recovery skipped the lane.
- **A locked Office.** On an Office started without `--live`, the picked claim was recovered and heartbeated every minute but never driven. Because it never went held, the PL's 풀기 was refused, and only the irreversible 취소 remained.

## What Didn't Work

- **`liveLinkRepos` as the gate.** It matches `HubStore.link()` clause for clause: the member is active and still owns the repo, the link is not revoked, and the Mac that minted it (if any) is not revoked (`src/hub/store.ts:1047-1062`). That is right for **authorization**. It is wrong for **"will this Office run it"**, because it knows nothing about lane readiness, which machine holds the link, or whether the Office runs locked. The rerun path was worse: before the fix, `rerunTask` checked no link at all (hubweb reviewer, Minor 1).
- **The Mac badge alone.** In the `gh`-lane case the Mac is on and reports 대기 중. The badge belongs to one Mac, while readiness belongs to each lane. The badge can say "locked", but it cannot say "this lane is not being polled".
- **Keeping the old check order once the gate's input changed.** The first fix (F1) swapped in the recent-use set but left `#pickBlock` checking NOT_LINKED before BUSY. Both second-round reviewers found the same regression (`.ai-workflow/runs/U37-review-2.md`, G1/N1). While the Office holds an open record, `runTick` returns `skipped: "open"` before `recover()` (`src/team/scheduler.ts:199`), so only that record's lane is stamped, by its heartbeat. Once the last stamp on each of a multi-repo member's other repos was more than 180 s old, those repos went stale. Every ready Task there then showed "내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제)", and a pick was refused NOT_LINKED instead of BUSY. This happened on the default path, for most of the working day. No state was harmed, but the page blamed a working Mac. The lesson: when you change what a predicate's input means, re-derive the order of the checks that consume it.

## Solution

**1. A "reachable" set built from recent use** (`src/hub/store.ts:1063-1077`):

```ts
/**
 * Repos whose work the member's Office is taking now: a live link it used within MAC_OFFLINE_MS. link() stamps
 * `last_seen` on every call, and a running team Office reads the inbox of every ready lane each claim tick while
 * it holds no record, and its failed record's Task each beat; a lane that is not ready, a link held on another
 * machine and an off Office stamp nothing. None while the member's newest Mac reports locked (it runs no Task).
 */
reachableRepos(memberId: string): Set<string> {
  if (this.macBadge(memberId).state === "locked") return new Set();
  const now = this.#now();
  return new Set(
    this.#liveLinks(memberId)
      .filter((r) => r.last_seen !== null && now - r.last_seen <= MAC_OFFLINE_MS)
      .map((r) => r.repo_id),
  );
}
```

`liveLinkRepos` stays the authorization view. Home, the Task page, the pick POST and the web rerun POST all pass `reachableRepos` instead (`src/hub/server.ts` lines 170, 183 and 298-299). The web rerun now refuses with NOT_LINKED as well (`#rerunBlock`, `src/hub/story-store.ts:820-827`). The NOT_LINKED words name the causes a person can check: "내 Mac이 지금 이 레포의 일을 가져갈 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요." (`src/hub/story-store.ts:206`). The Office code did not change for this rule.

**2. BUSY before NOT_LINKED** in the one rule shared by the buttons (`#pickState`) and the POST (`pickTask`) (`src/hub/story-store.ts:1203-1209`):

```ts
// Before (F1): a busy member's other repos read as "not linked" once their links went stale
if (!this.#owns(memberId, t.repo_id)) return "FORBIDDEN";
if (!linked.has(t.repo_id as string)) return "NOT_LINKED";
if (this.#openTask(memberId)) return "BUSY";

// After (G1)
if (!this.#owns(memberId, t.repo_id)) return "FORBIDDEN";
if (this.#openTask(memberId)) return "BUSY";
if (!linked.has(t.repo_id as string)) return "NOT_LINKED";
```

`#rerunBlock` needs no reorder: the rerun is for the member's own failed Task, and that record's lane is stamped every beat.

## Why This Works

The gate now observes the exact code path that would take the claim, instead of a credential that merely allows it.

- `HubStore.link()` stamps `hub_links.last_seen` on every Bearer call (`src/hub/store.ts:742`).
- A running team Office runs its claim tick every 30 s (`CLAIM_MS`, `src/team/office.ts` lines 31 and 684). With no open record, `runTick` calls `recover()` first (`src/team/scheduler.ts:198-202`). `recover()` reads `inbox()` on every **ready** lane (`src/team/scheduler.ts:134-137`) before `canExecute`, the pause and the daily cap. So a ready lane is stamped at least every 30 s, even while paused or with automatic work off. That inbox read is also exactly how a web pick gets taken.
- A failed record's lane is stamped by its Task read at each 60 s heartbeat (`BEAT_MS`, `src/team/office.ts:33`), so a web rerun of the member's own failed Task stays reachable.
- A lane that is not ready (`isReady` requires state `ready` and a link, `src/team/scheduler.ts:38-39`), a link held on another machine, and an Office that is off stamp nothing.
- The window is `MAC_OFFLINE_MS` = 180 000 ms (`src/hub/store.ts:25`): six claim ticks and three beats. It is the same window that makes a Mac read "off".
- A locked Office still polls and stamps, so recent use alone cannot see "locked". The newest Mac's reported state covers that case.

BUSY comes first because while a record is open `runTick` returns at `skipped: "open"` and never reads the other lanes. Their staleness then means "busy", not "cannot reach". BUSY is the true reason, and checking it first hides the stale-but-healthy lanes. After the Task ends, the next tick (≤30 s) stamps them again.

## Prevention

- **A valid credential is not proof of action.** "This link would be accepted" and "this Office will act on a claim made through it" are different predicates. When a Hub must predict a worker's behavior without contacting it, gate on evidence that the worker recently ran the same path that would act (here, the inbox read in `recover()`), within a window tied to the worker's poll period.
- **List what stamps the evidence and what stops it.** Before choosing the window, enumerate every call that stamps (including calls through a lane that is not ready) and every legitimate state that stops stamping (an open record). Order the refusals so that the legitimate reason (BUSY) wins over the "unreachable" reason.
- **The rule breaks if the poll changes.** The rule assumes that a ready lane is read at least once in every 180 s. An Office that polls more slowly (for example, because a claim tick runs long) has its member wrongly refused with NOT_LINKED. A change to `CLAIM_MS`, `BEAT_MS`, `MAC_OFFLINE_MS` or `runTick`'s early return must re-check `reachableRepos`.
- **One predicate for buttons and actions.** `#pickBlock` drives both `#pickState` and `pickTask`, so a screen cannot offer a button that the POST refuses.
- **Pin each layer where its clock actually moves:**
  - real scheduler, a `gh` lane is not reachable: `tests/hub-web-office.test.mjs` "a lane that is not ready (gh) is not reachable, so the web cannot pick its Task…";
  - the 180 000 ms boundary and the locked case: `tests/hub-store-mac.test.mjs` "reachableRepos holds a live link seen within 180000 ms…";
  - a multi-repo member past the window: `tests/hub-story-work.test.mjs` "a member holding a Task in one repo sees busy, not not-linked…".

  The second review noted that the `hub-web-office` fixture gives the test clock only to the board, not to `HubStore`, which stamps `last_seen`. Those tests therefore cannot age a link, and the boundary is pinned only at store level. In a stale-evidence test, advance the clock that writes the evidence.

## Known gaps

Recorded, not fixed, in `docs/verification/2026-11-05-teammate-web.md` (확인하지 않은 범위 → 사람에게 보이는 한계):

- A web rerun on a lane whose gh login lapsed still passes, because the failed record's Task read stamps the link.
- For 180 s after an Office restart in which a lane fell to `gh` or lost its link, the previous run's stamps are still fresh, so a pick there is accepted and strands. Any Hub call through a not-ready lane's link (for example, a released record's heartbeat) stamps it the same way.
- Brief wrong refusals: while the Office holds a record the Hub no longer counts (just dropped, or kept by `keepOnNotYours` until the first drive), and for up to 30 s after a merge.
- An Office linked by connection string (no Mac) that runs locked: the Hub learns "locked" only from Mac heartbeats, so it cannot see this case.

## Related Issues

- PR syjkim0125/pazmo-agent-office#77 (bundle 2, 팀원 웹); review dispositions in `.ai-workflow/runs/U37-review-1.md` (F1, F2) and `.ai-workflow/runs/U37-review-2.md` (G1, G2).
- [Give every blocking local claim state an exit for every Hub answer](../architecture-patterns/give-local-claim-record-an-exit-for-every-hub-answer.md) is the Office-side twin. It lists the lane states that recovery and the claim pass skip, and it notes that a locked Office does not drive its record. This doc is the Hub-side consequence: do not create a claim that only such a lane could take.
- [Detect a runner account limit from the CLI's error kind, not its words](../integration-issues/detect-runner-account-limits-from-the-cli-error-kind.md) teaches the same lesson for runners: "logged in" did not mean "able to run". A check that gates work must read the same evidence the worker acts on.
- [Keep a remembered runner block in every copy of the runner catalog](keep-a-remembered-runner-block-in-every-catalog-copy.md) is another case where a gate and the executor disagree about readiness. There the gate could refresh from the executor's evidence. Here the Hub cannot contact the Office, so it uses recent use instead.
