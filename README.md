<div align="center">

# Pazmo Agent Office

### One goal. A coordinated AI team. Evidence before done.

**Build products and improve existing systems with a team you direct.**

![Stage](https://img.shields.io/badge/stage-local_alpha-orange)
![Pazmo originals](https://img.shields.io/badge/Pazmo_originals-MIT-blue)
![Included third-party files](https://img.shields.io/badge/third--party_files-Apache--2.0-blue)
![Workflow design](https://img.shields.io/badge/workflow_design-Jira_optional-purple)

**English** · [한국어](README_ko.md)

[Why Pazmo](#why-pazmo) · [The team](#the-team) · [Status](#current-status) · [Contributing](#contributing) · [License](#license)

</div>

> **Local alpha on Apple Silicon macOS.** Office runs kit role graphs (PM, Lead, Developer, Reviewer) through a trusted Mac controller and a dedicated VM, with the codex or claude CLI you installed and logged in to. The screen is Pazmo's own minimal Office (Tasks, task detail, Decisions, Agents). Claw Empire, where the project started, was removed from the repository on 2026-10-30 (D30). Real tasks have gone through human G4 and delivery on one Mac. Other people's PCs, company IT policy and npm distribution remain unverified. See [current status](docs/STATUS.md).

## Why Pazmo

An AI office should do more than look busy. Our goal is a team that turns approved intent into small, reviewable changes — and stops honestly when it cannot prove the result.

Pazmo started from the office interface of [Claw-Empire](https://github.com/GreenSheep01201/claw-empire) and combines it with the contracts, templates and verification principles developed in [AI Workflow Kit](https://github.com/syjkim0125/ai-workflow-kit). The execution engine (decisions, isolated runs, verification and delivery) and today's minimal Office screen are Pazmo's own; no Claw-Empire code remains. It is an independent project; the original kit stays unchanged.

| Principle | What we are building |
|---|---|
| **One clear contract** | A Story defines the goal, requirements, exclusions and verification. |
| **Specialists that hand off work** | Engineers and reviewers exchange artifacts linked to the same task and code snapshot. |
| **Evidence before done** | Missing tests, failed reviews and merge conflicts cannot become a successful delivery. |
| **Human direction, fewer interruptions** | Approve scope, important risks, understanding and consequential delivery — not every keystroke. |
| **Jira is optional** | Local Story/Task files and the office's local state are enough. No Jira account, key or connector is required by the design. |

## The team

| Role | Owns | When |
|---|---|---|
| PM / Team Lead | Scope, assumptions, task dependencies and coordination | Default |
| Software Engineer | Implementation, tests, simplification and fixes | Default |
| QA / Code Reviewer | Requirement-aligned review and reproducible findings | Default |
| Product Designer | User flows, interface states and design quality | UI work |
| DevOps / Release Engineer | Builds, previews and release preparation | Runtime or delivery changes |

Roles are responsibility boundaries, not five permanently running conversations. Each role runs with the codex or claude CLI you installed and logged in to; Office does not read or copy the login. Subscription usage limits still apply; API-key billing is separate. No silent paid-provider fallback is part of the design.

## From goal to result

```text
Goal → Story → Human scope approval → Plan
                                      ↓
                            Implement → Verify → Review
                                ↑                  │
                                └────── Fix ───────┘
                                      ↓
                          Integrated verification
                                      ↓
                   Human understanding → Authorized delivery
```

Compound Engineering supplies bounded implementation and review procedures. Selected Superpowers skills reinforce test quality, debugging and verification. One scheduler owns the team; each employee does not start another full workflow.

**Use it for:** changes to existing systems, new products, and evidence-based local reports. Non-code work uses source and result checks rather than artificial code-test ceremonies. Unattended production writes are outside the initial release.

## Local startup

On Apple Silicon macOS, complete the initial login and prerequisites, then run `./office --project /absolute/path/to/project` from this repository. Later, run `./office` to reopen the selected project. See [startup instructions and limits](docs/LOCAL-PREVIEW.md).

The Office has four screens (Tasks, task detail, Decisions, Agents), and each agent has its own work runner and review runner. `--lean` from older commands is still accepted and starts the same Office; `--claw` was removed. See [the Office guide](docs/LOCAL-PREVIEW.md#새-office).

### Updating from a Claw version

1. Before pulling: finish or cancel the Claw Office's running tasks and any team hub requests you accepted, then stop that Office (`node bin/pazmo-office.mjs stop --project /absolute/path/to/project`). The same command still stops it after pulling.
2. After pulling: run `./office` once (`./office --team` for the team Office). The first run installs the root dependency (`ws`), so it needs the npm registry, and the runners are qualified once more before the first role runs. An Office that is already running gets the dependency through this run too.
3. If several Offices run from one checkout (per project, or the team Office), update while no task is running: the install briefly removes `node_modules`, so another Office's claude jobs can fail meanwhile.
4. The leftover `vendor/` folder (the old install and build) can be deleted. The old task data (`claw/`) is kept as it is; the new Office does not read it.

## Current status

| Area | Status |
|---|---|
| Starting point | Claw-Empire `v2.0.4` (commit `5c928b24ffa55b403fe7c5521d4ac3ac49516137`), removed from the repository on 2026-10-30 (D30) — [provenance](upstream/CHANGES.md) |
| Story and Task templates | Installed kit 4.1.0 role graphs; Office owns assignments and approvals |
| Jira-independent team execution | Real tasks in an existing project through human G4 and delivery on one Mac — [evidence](docs/verification/2026-10-06-cli-runner-selection.md) |
| CLI runners | Your installed codex or claude, chosen per role; subscription login, no API key |
| Local launcher and Office screen | `./office` starts the minimal Office (Tasks, task detail, Decisions, Agents); made the default and Claw removed on 2026-10-30 (D30); the app-be real check is still to do — [guide](docs/LOCAL-PREVIEW.md#새-office) · [evidence](docs/verification/2026-10-30-lean-office-default.md) |
| Team hub and team Story board | Hub server (invites, repos, owners) and team Story board stages 1–2 (Hub, team Office with several repos, trial). The Office screens for sending and receiving hub requests went with Claw; the Story board replaces them. Not yet checked across PCs — [guide](docs/LOCAL-PREVIEW.md#팀-office-2단계-시험) |
| Decisions and approvals | Answer G1, questions and G4 in the Office's Decisions. The terminal contract and approval commands and the chat bridge went with the legacy engine (D30) |
| Execution isolation and completion guards | Dedicated VM checks and guarded completion implemented; native host-only execution stays disabled |
| npm `@pazmo/agent-office` | Target package name; not published or installation-tested |

There is no Pazmo `npx` quickstart yet. Do not infer a working installer from the package name. Read the [current status and next step](docs/STATUS.md), [approved Story](docs/understanding/pazmo-agent-office-contract.md), and [implementation plan](docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md) first. The [v3 handoff](docs/HANDOFF-v3.md) and [source import procedure](docs/IMPORT-UPSTREAM.md) are historical inputs, not approval records. Do not run imported upstream agents with company credentials before their execution boundaries are verified.

## Contributing

Keep changes small and connect them to an observable requirement and fresh evidence. Preserve the pinned upstream baseline and attribution. Prefer tests of real behavior over assertions that a source file contains a particular word. Report source import, build, mock workflow, live Codex, browser and package verification separately.

Current work and the next step are in [STATUS](docs/STATUS.md). Existing user files, the original AI Workflow Kit and operator credentials are not development scratch space.

## License

**Original Pazmo code and documentation: [MIT](LICENSE).** Third-party files in the repository (the Codex model entry in `assets/codex`) are **Apache-2.0**, with their license and notice retained. Claw-Empire code (Apache-2.0) is only in versions before 2026-10-30; its provenance and notices stay on record. Other components keep their respective licenses.

See [license boundaries](LICENSING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

With thanks to Claw-Empire and AI Workflow Kit, and to the maintainers of Compound Engineering and Superpowers. Open Office and Pixel Agents informed the documentation/interaction references. Pazmo is independent and is not an official release of those projects or OpenAI.
