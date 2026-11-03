---
title: Run a team Story board real check on a local hub without shared resources
date: "2026-11-03"
category: workflow-issues
module: team Story board real check
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A team Story board stage needs a real check with a hub, a team Office, a PL and real Git pushes"
  - "The check must not write to the shared hub, a real team project or a shared account"
  - "Hub members, repos and link codes are needed without the hub web screen or other people"
  - "The roles run on the person's own claude or codex login, which may be near its usage limit"
symptoms:
  - "The stage-2 and stage-3 records say what was set up but not how; the setup and PL scripts lived only in a session scratch folder"
  - "`hub-link --connect \"--hub … --code … --fingerprint …\"` failed with `Missing value: --connect`"
  - "`hub --name <label>` printed a hub URL that nothing resolves"
  - "A runner account at its usage limit passed the readiness check and spent two attempts in under a minute, showing only `ENGINEER_FAILED`"
tags: [real-check, team-hub, team-office, story-board, hubstore, hub-link, test-data-dir, runner-usage-limit, pl]
---

# Run a team Story board real check on a local hub without shared resources

## Context

Each team Story board stage ends with a real check on top of the automated tests: a real hub, a real team Office, real `gh` and git pushes, and a PL publishing Stories. Stage 2 ([2026-10-30 record](../../verification/2026-10-30-team-story-office-real-check.md)) and stage 3 round 1 ([2026-11-03 record](../../verification/2026-11-03-team-story-task-mode-real-check.md)) both ran on one Mac without touching shared resources:

- no shared OpenShift hub (a local LAN-mode hub instead),
- no real team project (throwaway repos instead),
- no other people (one person plays admin, member A and PL; the PL uses the hub API instead of the hub screen).

The records say what was done, not how. The setup and PL scripts lived in a session scratch folder outside the repo (session history), and stage 3 lost time to two CLI detours (one in the record, one from the session) and to a runner account at its usage limit. This doc keeps the procedure, the two script shapes and the pitfalls so stage 3 round 2, stage 4 and stage 5 can repeat the check. The normal hub and team Office commands are in [LOCAL-PREVIEW.md](../../LOCAL-PREVIEW.md#팀-허브) ([team Office](../../LOCAL-PREVIEW.md#팀-office-3단계-시험)); this doc covers only what makes the check isolated.

Placeholders: `$SP` is a scratch folder for one round, `<owner>/<name>` is a GitHub account and repo the person controls. Commands run from the Office checkout under test, on Node 24 (`package.json:7-9`).

## Guidance

Do the parts in this order. Each test repo's `origin` must be fixed before seeding, because the hub's registered URL and the project's `origin` must name the same repo; with `gh repo create` that means creating the GitHub repos first.

### 0. Preflight

- `colima status -p pazmo-office`: note whether the VM is running, so cleanup can put it back.
- `gh auth status` for the host of the test repos.
- Runner account: `claude auth status` prints JSON with `loggedIn` and the account and plan fields. Check that it is the account you mean to spend, then check the **weekly** headroom with `/usage` (see Pitfall 3).
- If `~/.codex/AGENTS.md` exists, codex is blocked and only claude runs roles ([codex-home-agents-md-leaks-into-isolated-runs](../security-issues/codex-home-agents-md-leaks-into-isolated-runs.md)). Stage 3 ran on claude for this reason.

### 1. Test repos

- **A stage that pushes nothing** (stage 2): local `git init` repos with an `origin` URL are enough. Stage 2 used several origin hosts, including one with no `gh` login, plus a second clone of one repo.
- **A stage that pushes and opens PRs** (stage 3 onward): private GitHub repos holding a dependency-free Node project, so verification takes seconds (`npm test` = `node --test`).

```sh
cd $SP/repos/be && git init -q -b main   # package.json with "test": "node --test", src/, one node:test file
git add -A && git commit -q -m "chore: start the real-check repo"
gh repo create <owner>/<name>-be --private --source . --remote origin --push
git push origin main:refs/heads/feature/story-1/base   # hand-made Story base
```

The Story base is made by hand because creating it belongs to stage 4 (`docs/verification/2026-11-02-team-story-task-mode.md:114`). Pairing compares the registered URL with the project's `origin` after normalizing scheme, case and `.git` (`src/hub/remote.ts:1-17`, `src/hub/store.ts:543-558`), so both must name the same host and path. Stage 3 round 1 kept the origin https; an ssh push is a round-2 item (`docs/verification/2026-11-02-team-story-task-mode.md:125`).

### 2. Local hub

```sh
node bin/pazmo-office.mjs hub --host 127.0.0.1 --port 18444 --data-dir $SP/hub > $SP/hub.log 2>&1 &
head -1 $SP/hub.log   # {"url":"https://127.0.0.1:18444","fingerprint":"…","adminInvite":"…/invite/<raw>",…}
```

- `127/8` is an accepted LAN address (`src/hub/tls.ts:27`). Give each stage's check its own port and data folder (stage 2 used 18443, stage 3 18444). A later round of the same stage keeps them (part 6).
- The first stdout line is the start JSON (`src/hub/run.ts:106-114`). `adminInvite` is there only while the hub has no members (`src/hub/store.ts:180-181`).
- Files: `<data-dir>/team-hub/`, the self-signed CA at `team-hub/tls/ca.pem`, the database at `team-hub/hub.sqlite` (`src/hub/run.ts:54-65`).
- Do not pass `--name` (Pitfall 2).

### 3. Seed the hub through `HubStore`

Members, repos, owners and link codes are written straight into the running hub's database with the hub's own store code, not through the hub screen. Shape of the script (`node setup-hub.mjs $SP <office checkout>`, Node 24 so the `.ts` import works):

```js
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [SP, SRC] = process.argv.slice(2);
const { HubStore } = await import(join(SRC, "src/hub/store.ts"));
const start = JSON.parse(readFileSync(join(SP, "hub.log"), "utf8").split("\n")[0]);
const db = new DatabaseSync(join(SP, "hub/team-hub/hub.sqlite"));
db.exec("PRAGMA busy_timeout = 5000"); // the running hub holds the same file
const store = new HubStore(db, Date.now);
const admin = store.acceptInvite(new URL(start.adminInvite).pathname.split("/").pop(), "admin").member;
const join_ = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
const a = join_("A"), pl = join_("PL");
const repos = {};
for (const r of ["be", "fe"]) {
  repos[r] = store.addRepo(admin, `story-test-${r}`, `https://github.com/<owner>/<name>-${r}.git`);
  store.addOwner(admin, repos[r], a.id);
  store.addOwner(admin, repos[r], pl.id);
}
mkdirSync(join(SP, "secrets"), { recursive: true, mode: 0o700 });
const put = (f, text) => writeFileSync(join(SP, "secrets", f), text, { mode: 0o600 });
for (const r of ["be", "fe"]) // URL form (Pitfall 1)
  put(`a-${r}.connect`, `${start.url}/connect#c=${store.createLinkCode(a, repos[r])}&fp=${start.fingerprint}`);
put("pl.token", store.pair(store.createLinkCode(pl, repos.be), "https://github.com/<owner>/<name>-be").token);
writeFileSync(join(SP, "hub-ids.json"), JSON.stringify({ url: start.url, a: a.id, pl: pl.id, repos }));
```

- The same calls, against an in-memory hub, are in `tests/hub-story-fixture.mjs`.
- `createLinkCode` (`src/hub/store.ts:533`) is owner-only and expires in 10 minutes (`LINK_CODE_TTL`, `:23`). Run `hub-link` (part 5) within that, or seed new codes.
- `pair(code, remote)` (`:543`) gives the PL a link token without an Office.
- Secrets go to 0600 files and are never printed. Redact long tokens from any output you paste.

### 4. PL through the real Story API

The PL is a small HTTPS client with the PL's link token. It pins the hub CA and sends the Story protocol header (`pl.mjs`, `node pl.mjs $SP <METHOD> <path> [json]`):

```js
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
const [SP, method, path, body] = process.argv.slice(2);
const ids = JSON.parse(readFileSync(join(SP, "hub-ids.json"), "utf8"));
const token = readFileSync(join(SP, "secrets/pl.token"), "utf8").trim();
const ca = readFileSync(join(SP, "hub/team-hub/tls/ca.pem"));
const data = body ? Buffer.from(body) : undefined;
const req = request(new URL(path, ids.url), { method, ca, headers: {
  authorization: `Bearer ${token}`, "x-pazmo-hub-protocol": "3",
  ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
} }, (r) => { let t = ""; r.on("data", (c) => (t += c)); r.on("end", () => { console.log(r.statusCode, t); if (r.statusCode >= 400) process.exitCode = 1; }); });
if (data) req.write(data);
req.end();
```

Story routes need protocol `3` (`src/hub/story-protocol.ts:5`); any other value gets 426 (`src/hub/link-api.ts:140-155`). The PL calls the checks used so far (`src/hub/link-api.ts:40-61`, `:89-131`):

| Step | Call | Body / query |
|---|---|---|
| Project | `POST /api/link/story/projects` | `{name, repos:[{repoId, baseBranch:"main"}]}` |
| Story | `POST /api/link/story/publish` | `{projectId, title, body, risk:"normal", key, graph:{nodes, edges}, storyVerify}` |
| Open | `POST /api/link/story/open` | `{storyId}` |
| Watch | `GET /api/link/story/story?id=<storyId>`, `GET /api/link/story/projects` | |
| More Tasks | `POST /api/link/story/add-tasks` | `{storyId, key, graph}` |
| Cancel | `POST /api/link/story/cancel-task` | `{taskId}` |
| Free a held Task | `POST /api/link/story/release` | `{taskId}` |

A graph node is `{id, repoId, title, spec, files:[…], verify:[{id:"V1", argv:["npm","test"], timeoutMs:120000}]}`, an edge is `{from, to}`, and `storyVerify` is `[{repoId, checks:[…]}]`. Not listed: the other PL routes (`stories`, `project-repos`, `cancel`, `complete`, `rerun`, `inbox`) and the Office's own claim, heartbeat and merge routes.

### 5. Team Office under a test data folder

```sh
D=$SP/office; mkdir -p $D
cp -Rp ~/.local/share/pazmo-agent-office/qualified-runtime $D/ && rm -rf $D/qualified-runtime/setup.lock
for r in be fe; do
  node bin/pazmo-office.mjs team add --project $SP/repos/$r --data-dir $D
  node bin/pazmo-office.mjs hub-link --project $SP/repos/$r --connect "$(cat $SP/secrets/a-$r.connect)" --data-dir $D
done
node bin/pazmo-office.mjs up --team --data-dir $D --no-open   # live: VM, runner check, claims Tasks
node bin/pazmo-office.mjs status --team --data-dir $D
node bin/pazmo-office.mjs stop --team --data-dir $D
node bin/pazmo-office.mjs start --team --data-dir $D          # locked: no --live, claims nothing
```

- Pass the same `--data-dir` to every command. The default data root is `${XDG_DATA_HOME:-~/.local/share}/pazmo-agent-office` (`src/cli/project.ts:64-71`), so a command without it acts on the person's real Office data.
- **Copy the runtime instead of downloading it again.** Setup returns early when `qualified-runtime/codex-0.155.1-0.154.0` exists (`src/cli/runtime-setup.ts:138-141`), and `installedRuntime` only checks each binary against its pinned hash (`:55-74`), so a copy passes. `setup.lock` is setup's lock directory (`:146-155`); leave it behind.
- Timings to wait against: claim every 30 s, heartbeat every 60 s, re-check of a repo that is not ready every 5 min (`src/team/office.ts:26-30`). The hub shows a claimed Task as `held` after 10 minutes without a heartbeat (`src/hub/story-protocol.ts:7`).
- Where to look: `$D/team/office.log`, `status --team`, the PL's `GET …/story?id=`, and for a role failure the repo's engine database (`story/lean/office.sqlite` under the repo's data folder), table `pazmo_handoffs`, column `receipt_json`. In stage 3 that column was the only place holding the runner's own error.

### 6. Cleanup

```sh
node pl.mjs $SP POST /api/link/story/cancel-task '{"taskId":"<leftover ready Task>"}'
node bin/pazmo-office.mjs stop --team --data-dir $D
pkill -f "pazmo-office.mjs hub --host 127.0.0.1 --port 18444"
colima stop -p pazmo-office   # only if it was stopped at preflight
```

Keep the GitHub repos and `$SP` for the next round, and restart the hub with the same `--host`, `--port` and `--data-dir`. Each repo's link pins the hub's URL and CA (`src/runtime/hub-link.ts:11-14`). A new hub has a new CA and none of the old members, repos or tokens, so it needs a new seed and a new `hub-link --connect` for every repo ([report-changed-hub-certificate-on-cert-signature-failure](../integration-issues/report-changed-hub-certificate-on-cert-signature-failure.md)).

### Pitfalls

1. **`hub-link --connect "--hub … --code … --fingerprint …"` fails with `Missing value: --connect`.** The flag parser rejects any value that starts with `--` (`src/cli/index.ts:139-141`) before `parseConnection` sees it, even though `parseConnection` accepts that form when it is pasted elsewhere (`src/runtime/hub-connect.ts:29-49`). Give the URL form `https://<host>:<port>/connect#c=<code>&fp=<fingerprint>` and quote it for the shell.
2. **`hub --name <label>` puts the label in the hub URL.** The name is first in the listen names (`src/hub/run.ts:75`) and becomes the URL base (`src/hub/server.ts:234`). Stage 3 first started with `--name realcheck` and got `https://realcheck:18444`, which nothing resolves (session history). The CA records the name (`src/hub/tls.ts:60-67`), so restarting without `--name` fails with `HUB_CA_NAME_CHANGED` until `team-hub/tls` is deleted; on a throwaway hub, wipe `$SP/hub`.
3. **A runner account at its usage limit still passes the readiness check.** Readiness reads only `loggedIn` from `claude auth status` (`src/runners/runner-discovery.ts:115-129`). On stage 3 day 1 the account was at its limit: the team Office claimed Task #2, the Engineer exited at once, and attempts 1 and 2 were gone within a minute, with only `ENGINEER_FAILED` in the log and record. A third attempt would have reported the Task failed. Things that misled (session history):
   - The 5-hour window showed 0% while the weekly limit was at 100%. Check the weekly line.
   - A working chat session in the app does not prove the CLI login has headroom; it may bill through another login.
   - Office runs the CLI with the person's `HOME` (`src/runners/runner-discovery.ts:84-91`, with `homedir()` passed in at `src/team/office.ts:254`), so it always uses the terminal `claude` login. There is no per-Office account setting.

   To switch accounts, the person runs `claude auth logout` and `claude auth login` (a browser flow) in a terminal. Do not run Office under another `HOME` instead: that also changes the git author, the `gh` login and the VM location, which blurs what the check proves. If a Task fails within seconds, `stop --team` at once; the record keeps its attempt count, and the next `up --team` resumes from it. Stage 3 resumed at attempt 3 the next day on another seat of the same person. The underlying gap (a limit-blocked runner counts as a failed attempt) is unresolved as of 2026-11-03.
4. **Do not use a real team project.** It already has its own Office data folder and a link to the shared hub. Registering it under a test data folder could diverge from its Office metadata and link (stage 2 record); its manifest names one data folder and is refused from another (`src/cli/project.ts:124-138`).

## Why This Matters

- Writes to the shared hub stay on the team's board. A local hub can be thrown away; the [redeploy check](redeploy-team-hub-to-openshift-from-fresh-bundle.md) stops before writing to the shared hub for the same reason.
- Without these script shapes, the next stage rebuilds them and walks into the same `--name` and `--connect` detours.
- An exhausted runner account looks like a product failure. It spends attempts in seconds, can fail the Task for good, and shows only `ENGINEER_FAILED`. A two-command preflight avoids a lost day.
- Some defects show up only in the real run. Stage 3's change summary bug, where Tasks that only added files were reported as changing nothing, passed every automated test and review ([count-added-and-deleted-files-in-no-index-no-prefix-diffs](../integration-issues/count-added-and-deleted-files-in-no-index-no-prefix-diffs.md)).

## When to Apply

- A real check for any team Story board stage: stage 3 round 2 (conflicts, stop and restart between steps, ssh push, final-review fixes), stage 4, stage 5.
- Any local check that needs a hub with members, repos, links and a PL, without the hub web screen or other people.
- Not for verifying a shared hub redeploy (use the redeploy doc), and not for checks that need a second Mac, a second person or a company Git host; the stage-3 record still lists those as unchecked. An ssh push needs the person's own ssh key and agent: switch the test repo's `origin` to ssh after pairing.

## Examples

Stage 3 round 1 (2026-11-02–03):

| Step | What happened |
|---|---|
| Hub | `hub --host 127.0.0.1 --port 18444 --data-dir $SP/hub`, after a first start with `--name` gave an unreachable URL (Pitfall 2, session history) |
| Seed | Admin, A, PL; two repos (`be`, `fe`) owned by A and PL; two one-time link codes for A; one PL token |
| PL | A project on `main` for both repos; Story #1 with `greet` → `farewell` (be) and `title` (fe), each verified by `npm test` at 120000 ms; then `open` |
| Link | The flag-style string failed with `Missing value: --connect`; the URL form linked both repos (Pitfall 1) |
| Start | `up --team … --no-open` reached `running` in 24 s with `execution: ready`, both repos `ready`, and claimed Task #2 at once |
| Runner | Account at its limit: two attempts gone in under a minute. Stopped, switched login the next day, resumed at attempt 3 (Pitfall 3) |
| Flow | Task #2: push → PR to `feature/story-1/base` → merge commit → hub `merged`, about 70 s after the restart. Then #3 and #4, about 1.5 min each |
| Locked | `start --team` without `--live`: the PL's new ready Task #6 was not claimed for 75 s, and no git or `gh` process ran |
| Cleanup | PL cancelled #6, team Office stopped, hub killed, VM stopped as before. Repos and test data kept |

## Related

- [LOCAL-PREVIEW.md](../../LOCAL-PREVIEW.md#팀-office-3단계-시험): the normal team Office commands.
- [Stage-3 real-check plan](../../verification/2026-11-02-team-story-task-mode.md): the check items, including the ones left for round 2.
- [Keep workflow graph evidence files immutable](keep-workflow-graph-evidence-files-immutable.md): write each real check into its own dated verification file.
- [Keep internal cluster hosts out of a public repo](../security-issues/keep-internal-cluster-hosts-out-of-a-public-repo.md): use aliases for real projects and hosts in the records.
