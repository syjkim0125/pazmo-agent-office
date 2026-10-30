---
title: Redeploy the team hub to OpenShift from a fresh bundle and verify it without writing data
date: "2026-10-22"
category: workflow-issues
module: team hub deploy
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Redeploying the team hub to OpenShift after a code change"
  - "The pazmo-hub BuildConfig is a Binary build fed from a local directory with oc start-build --from-dir"
  - "More than one worktree, person or agent session can build the bundle or start a build for the same hub"
  - "Verifying a rollout on a hub that already has members, repos, requests and live Office links"
symptoms:
  - "A bundle built in another worktree holding older code lacked the new files (15 bundled files instead of 17), so start-build would have shipped the old hub"
  - "Plain `oc login` only printed a token-request URL, then `oc start-build` failed with 'You must be logged in to the server (Unauthorized)'"
  - "Two start-builds of the same bundle ran at once, which would roll the pod twice"
  - "The route answered 503 'Application is not available' right after the rollout until the new pod was Ready"
  - "A read-only database check failed with 'unable to open database file' because it used the wrong path"
resolution_type: workflow_improvement
tags: [openshift, binary-build, oc-start-build, hub-bundle, redeploy, deploy-verification, team-hub]
---

# Redeploy the team hub to OpenShift from a fresh bundle and verify it without writing data

## Context
The first deploy of the team hub to OpenShift is documented in [docs/LOCAL-PREVIEW.md](../../LOCAL-PREVIEW.md#openshift에-허브-띄우기). It ends with `npm run hub:bundle` and `oc start-build`. That section does not cover the second deploy: shipping a code change to a hub that already has members, repos and connected Offices.

The redeploy for PR #29 (team Story board) on 2026-10-22 showed that this path has silent failure modes. A stale bundle deploys old code and reports success. A half-done login fails only at the last step. Verifying the result by writing test data would put it in the shared team database. This doc records the command sequence and the checks that proved the redeploy without writing anything.

The same pitfalls showed up in the earlier redeploys of 2026-10-15 and 2026-10-16 (session history): an expired login failed `oc start-build` with Unauthorized after the bundle step had already succeeded, the route answered 503 right after the pod swap, the bundle was run in the feature worktree rather than `main`, and a 401/426 probe was what proved the new code was live. They recur, so they are worth a standing checklist.

All values below are placeholders: `<cluster API URL>`, `<project>`, `<hub route host>`, `<pod>`. Real values stay out of this public repo (see [keep-internal-cluster-hosts-out-of-a-public-repo](../security-issues/keep-internal-cluster-hosts-out-of-a-public-repo.md)).

## Guidance
Redeploy is two commands plus a check. The BuildConfig source type is `Binary` (`deploy/openshift/pazmo-hub.json:50`), so the bundle is uploaded from the machine that runs `oc`. A finished build moves the `pazmo-hub:latest` image tag, and the Deployment's image trigger (`deploy/openshift/pazmo-hub.json:114`) rolls the pod.

Division of labor: the person logs in (`oc login --web`, in the browser, so no token passes through chat). After that, an agent may run the bundle, the build and the read-only checks for that deploy when the person asks for it.

1. Build the bundle from the checkout that holds the change. Read the JSON it prints before shipping.
   ```sh
   cd <worktree that contains the change>
   npm run hub:bundle
   # {"out":"/abs/path/dist/hub-bundle","files":17,"bundled":["bin/pazmo-hub.mjs", …, "package.json"]}
   ```
   - `out` must be inside the worktree you intend. The default is `<repo root>/dist/hub-bundle` of the repo that holds the script (`scripts/hub-bundle.mjs:28`).
   - `bundled` is the import graph of `bin/pazmo-hub.mjs` plus a generated `package.json` (`scripts/hub-bundle.mjs:14-20`, `:90`, `:118-119`). It must list every file the change added. For PR #29 that meant the new `src/hub/story-store.ts` and `src/hub/story-protocol.ts`.
   - The repo declares Node `>=24.19.0 <25` (`package.json:7-9`); use Node 24, as for the tests (see [fresh-worktree-tests-fail-without-office-ui-build](../test-failures/fresh-worktree-tests-fail-without-office-ui-build.md)). The bundle script itself does not enforce the version.
2. Make sure you are logged in before you start the build.
   ```sh
   oc whoami                                  # must print a user, not an error
   oc login --web --server=<cluster API URL>  # if it does not
   oc project <project>
   ```
3. Start exactly one build, with an absolute path.
   ```sh
   oc get builds -l buildconfig=pazmo-hub     # nothing New or Running for this bundle
   oc start-build pazmo-hub --from-dir <absolute path from "out"> --follow
   ```
4. Wait for the rollout before judging anything.
   ```sh
   oc get pods -l app=pazmo-hub        # wait for READY 1/1 on the new pod
   oc get endpoints pazmo-hub          # must list an address
   oc logs deploy/pazmo-hub | head -1  # first line: url, listening
   ```
5. Verify without writing data (see Examples).

### Pitfalls
1. **A bundle from the wrong worktree ships old code with a success message.** `npm run hub:bundle` bundles the repo that contains the script. A bundle built in another worktree had `out` pointing at that worktree and 15 files instead of 17. Check `out` and the `bundled` list. Pass an absolute `--from-dir`, because a `cd` in a one-shot shell may not persist and a relative `dist/hub-bundle` then points somewhere else.
2. **`oc login` can look done and not be.** A plain `oc login` only printed a token-request URL. `oc start-build` then failed with `You must be logged in to the server (Unauthorized)`. `oc whoami` diagnoses it. `oc login --web --server=<cluster API URL>` logs in through the browser. Earlier sessions also saw (session history):
   - a login that worked in the morning had expired by the next day, so check `oc whoami` on every deploy;
   - the console's copied login command used the API's default port, which did not answer from the office network; a `--server` URL with the port that answers fixed it;
   - a terminal with `KUBECONFIG` set saves the login to a different file than the one the agent's shell reads.
3. **The CLI is required.** The Binary BuildConfig is fed by `oc start-build --from-dir` from the machine that holds the bundle (`deploy/openshift/pazmo-hub.json:49-51`). The web console's start button does not upload a local directory (as observed in this session), so a redeploy cannot be "just clicked".
4. **Never start the same build twice.** The BuildConfig has `runPolicy: Serial` (`deploy/openshift/pazmo-hub.json:48`), so a duplicate does not fail. It would queue, finish later and roll the pod a second time; here the duplicate was cancelled before that happened. If two people or agents may be deploying, list and cancel:
   ```sh
   oc get builds -l buildconfig=pazmo-hub
   oc cancel-build <duplicate build name>
   ```
5. **Right after rollout the route answers 503 "Application is not available".** The Deployment strategy is `Recreate` (`deploy/openshift/pazmo-hub.json:120`), so the old pod stops before the new one is Ready. The readiness probe is `/healthz`. Wait for `READY 1/1` and endpoints, then test.
6. **The database is one directory deeper than the data dir.** `PAZMO_HUB_DATA_DIR` defaults to `/data` in the container (`src/hub/main.ts:27`). The hub adds a `team-hub` subdirectory (`src/hub/run.ts:54`) and opens `hub.sqlite` there (`src/hub/run.ts:65`). So the file is `/data/team-hub/hub.sqlite`, not `/data/hub.sqlite`.

## Why This Matters
The redeploy keeps the PVC. Members, repos, requests and connected Offices are the team's real data, and a wrong step is hard to see:

- Pitfall 1 reports `Build complete` for code you did not mean to ship. Nothing fails until someone calls the new route.
- Pitfalls 2 and 3 are loud but waste a deploy window.
- Pitfall 4 would restart the pod twice, dropping every connected Office's sync twice.
- Pitfall 6 sends a read-only check to a file that is not there, so it reports an error instead of the data.
- Pitfall 5 makes a healthy deploy look broken, and the next move (redeploying again) makes it worse.
- Test data written to prove the deploy stays in the team's board for good. Writing it is a decision for the team, not part of the deploy.

## When to Apply
- You changed anything under `src/hub/` or `bin/pazmo-hub.mjs` and the OpenShift hub must run it.
- You are deploying from a worktree, or from a shell that may not be in the repo root.
- More than one person or agent can deploy to the same project.
- The hub already has members. A first deploy with an empty database is covered by the LOCAL-PREVIEW section; the admin invite appears in the pod log only while the hub has no members (a restart before the admin joins prints a fresh link).
- The change adds tables or routes and you need to know the existing database took it.

## Examples
Modeled on the checks run after the PR #29 redeploy (that run probed `/api/link/story/inbox` and `/api/link/work`; any protocol-3-only route and any protocol-2 route answer the same way). Every step is read-only or unauthenticated. Use the hub's own `<hub route host>`.

1. Liveness (`src/hub/server.ts:195`, answers before the Host check and needs no session):
   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" https://<hub route host>/healthz   # 200
   ```
2. A route only the new code serves, with no token. New code passes the protocol gate and reaches the token check, so it answers 401 (`src/hub/link-api.ts:164-167`). Old code does not know protocol `3`, so it answers 426 at its first gate with `"expected":"2"` (the gate as it was before PR #29: `git show 2fb903d:src/hub/link-api.ts`, lines 56-61). Use a method the route accepts (`src/hub/link-api.ts:39-40`), or you get 405 before the token check (`src/hub/link-api.ts:158-159`).
   ```sh
   curl -s -w "\n%{http_code}\n" -H "x-pazmo-hub-protocol: 3" \
     https://<hub route host>/api/link/story/projects                           # 401 UNAUTHORIZED
   ```
3. The same route with the old protocol header answers 426 and names the version it expects, `"expected":"3"` (`src/hub/link-api.ts:146-151`). Old code answers 404 to this protocol-2 call: it passes the old gate and the route does not exist in it.
   ```sh
   curl -s -w "\n%{http_code}\n" -H "x-pazmo-hub-protocol: 2" \
     https://<hub route host>/api/link/story/projects                           # 426, "expected":"3"
   ```
4. An old route (`/api/link/repos`, a protocol-2 route, `src/hub/link-api.ts:31`, `:65`) still answers the way it did before the change:
   ```sh
   curl -s -w "\n%{http_code}\n" -H "x-pazmo-hub-protocol: 2" \
     https://<hub route host>/api/link/repos                                    # 401, same as before the change
   ```
5. Pod log. The first line is JSON with `url` and `listening` (`src/hub/main.ts:38`). It has **no `adminInvite`** when members exist (`src/hub/run.ts:79`, `:86`; `src/hub/store.ts:181`); an `adminInvite` there would mean the hub started on a database with no members, which is a different incident.
   ```sh
   oc logs deploy/pazmo-hub | head -1
   ```
6. Read-only SQLite check inside the pod. Save as `check.mjs`:
   ```js
   import { DatabaseSync } from "node:sqlite";
   const db = new DatabaseSync("/data/team-hub/hub.sqlite", { readOnly: true });
   const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
   console.log({
     members: n("hub_members"), repos: n("hub_repos"), requests: n("hub_requests"), links: n("hub_links"),
     lastSeenSecondsAgo: Math.round((Date.now() - db.prepare("SELECT MAX(last_seen) AS t FROM hub_links WHERE revoked_at IS NULL").get().t) / 1000),
     tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hub_%' ORDER BY name").all().map((r) => r.name),
   });
   ```
   ```sh
   oc exec -i <pod> -- node --input-type=module < check.mjs
   ```
   Read it three ways:
   - Counts equal the numbers you noted before the deploy. The PVC data survived.
   - `lastSeenSecondsAgo` is small when at least one Office is running (its hub poll defaults to every 5 seconds, `src/runtime/hub-link.ts:395`). Existing Offices reconnected without a new link. A huge number means no Office is polling right now or no link is live, not necessarily a failed rollout.
   - `tables` now lists the new Story tables (`hub_projects`, `hub_stories`, `hub_story_tasks`, and the rest of the set in `src/hub/story-store.ts:174-184`). The schema is `CREATE TABLE IF NOT EXISTS`, run in the board's constructor (`src/hub/story-store.ts:269`), so it applied to the old database without a migration step.

Stop here. Creating a project, a Story or a request on the shared hub to "test end to end" is a separate step. Ask the team first.

## Related
- [docs/LOCAL-PREVIEW.md, "OpenShift에 허브 띄우기"](../../LOCAL-PREVIEW.md#openshift에-허브-띄우기): first-deploy commands (Template, `local.env`, first `adminInvite`).
- [docs/understanding/team-hub-openshift-decision.md](../../understanding/team-hub-openshift-decision.md): why one pod, `Recreate`, PVC and an edge route.
- [keep-internal-cluster-hosts-out-of-a-public-repo](../security-issues/keep-internal-cluster-hosts-out-of-a-public-repo.md): keep real hosts out of commands and examples like the ones above.
- [fresh-worktree-tests-fail-without-office-ui-build](../test-failures/fresh-worktree-tests-fail-without-office-ui-build.md): Node 24 and vendor setup for a fresh worktree.
- [Hub stage verification record](../../verification/2026-10-22-team-story-board-hub.md): the dated evidence for this redeploy.
- syjkim0125/pazmo-agent-office#29 (team Story board, the change that was redeployed).
