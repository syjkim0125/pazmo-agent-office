<div align="center">

# Pazmo Agent Office

### One goal. A coordinated AI team. Evidence before done.

**Build products and improve existing systems with a team you direct.**

![Stage](https://img.shields.io/badge/stage-local_alpha-orange)
![Pazmo originals](https://img.shields.io/badge/Pazmo_originals-MIT-blue)
![Upstream license](https://img.shields.io/badge/Claw--Empire-Apache--2.0-blue)
![Workflow design](https://img.shields.io/badge/workflow_design-Jira_optional-purple)

**English** · [한국어](README_ko.md)

[Why Pazmo](#why-pazmo) · [The team](#the-team) · [Status](#current-status) · [Contributing](#contributing) · [License](#license)

</div>

> **Local alpha on Apple Silicon macOS.** Office runs kit role graphs (PM, Lead, Developer, Reviewer) through a trusted Mac controller and a dedicated VM, with the codex or claude CLI you installed and logged in to. The default screen is still the Claw Office UI. A new minimal Office without Claw Empire (`--lean`, phase 1) runs on the same engine as an opt-in; Claw Empire is removed in a later phase. Real tasks have gone through human G4 and delivery on one Mac. Other people's PCs, company IT policy and npm distribution remain unverified. See [current status](docs/STATUS.md).

<p align="center">
  <img src="https://raw.githubusercontent.com/GreenSheep01201/claw-empire/5c928b24ffa55b403fe7c5521d4ac3ac49516137/Sample_Img/Office.png" alt="Upstream Claw-Empire office interface, shown as a credited reference rather than completed Pazmo features" width="100%" />
  <br /><sub>Upstream Claw-Empire interface, the base of today's default Office screen that the minimal Office is replacing. This reference image does not demonstrate implemented Pazmo features.</sub>
</p>

## Why Pazmo

An AI office should do more than look busy. Our goal is a team that turns approved intent into small, reviewable changes — and stops honestly when it cannot prove the result.

Pazmo started from the office interface of [Claw-Empire](https://github.com/GreenSheep01201/claw-empire) and combines it with the contracts, templates and verification principles developed in [AI Workflow Kit](https://github.com/syjkim0125/ai-workflow-kit). The execution engine (decisions, isolated runs, verification and delivery) is Pazmo's own, and a minimal Office that no longer needs Claw-Empire is being built in phases. It is an independent project; the original kit stays unchanged.

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

To try the minimal Office without Claw-Empire, add `--lean`: `./office --lean --project /absolute/path/to/project`. It has four screens (Tasks, task detail, Decisions, Agents), keeps its own data, and lets each agent use a different runner for review. Stop a running Claw Office for the same project first. See [the minimal Office guide](docs/LOCAL-PREVIEW.md#새-office-1단계-시험).

## Current status

| Area | Status |
|---|---|
| Selected upstream | Claw-Empire `v2.0.4`, checked 2026-09-17 |
| Required commit | `5c928b24ffa55b403fe7c5521d4ac3ac49516137` |
| Destination source import | **Original verified locally; publication sanitized** — [evidence](docs/verification/2026-09-18-publication.md) |
| Story and Task templates | Installed kit 4.1.0 role graphs; Office owns assignments and approvals |
| Jira-independent team execution | Real tasks in an existing project through human G4 and delivery on one Mac — [evidence](docs/verification/2026-10-06-cli-runner-selection.md) |
| CLI runners | Your installed codex or claude, chosen per role; subscription login, no API key |
| Local launcher and Claw Office UI (default) | `./office`; clean source installation checked on this Mac; [local preview guide](docs/LOCAL-PREVIEW.md) |
| Minimal Office without Claw-Empire | Phase 1 opt-in (`--lean`): Tasks, task detail, Decisions, Agents on the same engine; real check passed 2026-10-27. Team hub screen, making it the default and removing Claw-Empire come in later phases — [evidence](docs/verification/2026-10-21-lean-office-phase1.md) |
| Team hub | Teammates send, accept and cancel work between their own Offices; checked with two Offices on one Mac, not yet across PCs — [guide](docs/LOCAL-PREVIEW.md#팀-허브-1단계-시험) |
| Operator contract and G1/G3 CLI | Implemented with real HTTP/SQLite tests; native Decisions used for live work — [evidence](docs/verification/2026-09-19-contract-approvals.md) |
| Execution isolation and completion guards | Dedicated VM checks and guarded completion implemented; native host-only execution stays disabled |
| npm `@pazmo/agent-office` | Target package name; not published or installation-tested |

There is no Pazmo `npx` quickstart yet. Do not infer a working installer from the package name. Read the [current status and next step](docs/STATUS.md), [approved Story](docs/understanding/pazmo-agent-office-contract.md), and [implementation plan](docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md) first. The [v3 handoff](docs/HANDOFF-v3.md) and [source import procedure](docs/IMPORT-UPSTREAM.md) are historical inputs, not approval records. Do not run imported upstream agents with company credentials before their execution boundaries are verified.

## Contributing

Keep changes small and connect them to an observable requirement and fresh evidence. Preserve the pinned upstream baseline and attribution. Prefer tests of real behavior over assertions that a source file contains a particular word. Report source import, build, mock workflow, live Codex, browser and package verification separately.

Current work and the next step are in [STATUS](docs/STATUS.md). Existing user files, the original AI Workflow Kit and operator credentials are not development scratch space.

## License

**Original Pazmo code and documentation: [MIT](LICENSE).** Imported Claw-Empire code: **Apache-2.0**, with original licensing, attribution and applicable notices retained. Other components keep their respective licenses.

This is **not** an MIT-only relicensing of the upstream project. See [license boundaries](LICENSING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

With thanks to Claw-Empire and AI Workflow Kit, and to the maintainers of Compound Engineering and Superpowers. Open Office and Pixel Agents informed the documentation/interaction references. Pazmo is independent and is not an official release of those projects or OpenAI.
