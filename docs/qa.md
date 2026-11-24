# QA environment

Production is never used for QA. Here "production" is the company's deployed team Hub (OpenShift) and the real Offices
people work in, including the check Hub on this Mac (port 18444) and its Offices: QA uses copies of their data, never the
running ones.

- Environment: local (this Mac, Apple Silicon, Node 24.19 or later 24.x first on PATH; the default `node` may be 22)
- Start:
  - Tests: `npm ci` in a fresh worktree, then `npm test` and `npm run typecheck`. Run one full `npm test` at a time on
    this Mac; ready = the process exits, with `ℹ pass`/`ℹ fail` counts in its output.
  - Hub: `node bin/pazmo-office.mjs hub --host 127.0.0.1 --port <port> --data-dir <empty or copied folder>`; ready =
    `curl -sk https://127.0.0.1:<port>/` answers (401 before sign-in).
  - Office preview (no model calls, opens no browser): once per project `node bin/pazmo-office.mjs init --project <git
    project> --apply`, then `node bin/pazmo-office.mjs start --project <git project> --port 0`; ready = `status --project
    <git project>` says running and its `url` answers 200. Afterwards `remove --project <git project> --apply` takes the
    Office files out of a scratch project; its data folder stays where `dataPreserved` says.
  - Live team Office (real VM and runners): after `team add --project <repo clone> --data-dir <folder>` (or `mac
    connect`) registered at least one repo, `node bin/pazmo-office.mjs up --team --no-open --data-dir <folder>` (Colima
    VM `pazmo-office`, codex or claude logged in, `gh` logged in for the repos' host).
- Stop: Office `node bin/pazmo-office.mjs stop --project <git project>` (or `stop --team --data-dir <folder>`); Hub: end
  its process (`pkill -f "pazmo-office.mjs hub --host 127.0.0.1 --port <port>"`).
- Base URL: `https://127.0.0.1:<port>` (the Hub's own CA: `<data-dir>/team-hub/tls/ca.pem`; browsers and curl need
  `-k`/ignore-HTTPS-errors for a copy).
- Login: the first admin and invites as `docs/LOCAL-PREVIEW.md` describes; for a scripted check on a copy, a device invite
  made with `HubStore.createDeviceInvite` and accepted (`acceptInvite`, or a POST to `/invite/<token>` with the Hub's own
  Origin) gives the session for the `pazmo_hub` cookie. Never a real person's account on
  the company Hub.
- Test data: a copy of the check Hub's data made with `VACUUM INTO` into a scratch folder, served on another port; the
  copy may pair a Mac and link repos. Stories #1 (be + fe) and #7 (be) are there.
- External services:
  - GitHub test repos `syjkim0125/pazmo-story-test-be` and `syjkim0125/pazmo-story-test-fe` through the person's `gh`
    login. Writing to them (merging into `main`, making or merging into `dev`) needs the person's allowance each time.
  - Colima VM and the codex/claude CLIs for live Offices.
- Needs a person: `oc login --web` and the company Hub deploy, GitHub and Claude/codex logins and their 2FA, any write
  to the test repos' `main` or `dev`, and approving Office Decisions (G1, G3, G4, questions).
- Organization-managed Claude plugins: a non-builtin plugin the organization turns on stops every claude run of Office
  (`CLAUDE_PLUGIN_UNEXPECTED`) until the person allows it on that Mac. The stop reason gives the allow command with
  the node and `bin/pazmo-office.mjs` of the Office that printed it (and `--data-dir <folder>` when that Office runs on
  another data folder), so it runs as printed. `runner plugins --review` finds the plugins this Mac's claude loads and,
  on a terminal, asks which to allow (the Hub's install line runs it before `mac connect`); `runner plugins` lists,
  `runner disallow-plugin` removes. A skill-only plugin passes; one whose folder or marketplace entry adds hooks, MCP
  servers, agents or commands never does.

- QA scripts: `qa/<slug>.sh`, run from the repository root with `BASE_URL=<base URL> bash qa/<slug>.sh` (a script that
  only runs commands ignores `BASE_URL`); Node 24 first on PATH.
- Browser test runner: none in the repository (a scripted browser check uses Playwright from `npx` with a scratch script,
  as `docs/verification/2026-11-20-dev-pr.md` did).

## Integration (dev)

- Auto-merge: off   <!-- the human sets "on"; an agent never turns it on -->
- Integration branch: none (this repository has no dev environment)
- Production branch: main
- Dev base URL: none
- Dev runs the merged commit when: not applicable
- Dev QA in CI: none
- Dev login and test data: not applicable
