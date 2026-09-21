<div align="center">

# Pazmo Agent Office

### One goal. A coordinated AI team. Evidence before done.

**Build products and improve existing systems with a team you direct.**

![Stage](https://img.shields.io/badge/stage-read--only_preview-orange)
![Pazmo originals](https://img.shields.io/badge/Pazmo_originals-MIT-blue)
![Upstream license](https://img.shields.io/badge/Claw--Empire-Apache--2.0-blue)
![Workflow design](https://img.shields.io/badge/workflow_design-Jira_optional-purple)

**English** · [한국어](README_ko.md)

[Why Pazmo](#why-pazmo) · [The team](#the-team) · [Status](#current-status) · [Contributing](#contributing) · [License](#license)

</div>

> **Read-only development preview.** The local CLI runs the Claw UI against a new Office database. Model execution is locked at the server. Native macOS isolation probes did not meet the required boundary; live Codex team execution remains unavailable. npm distribution and the complete workflow are not ready. See [verification evidence](docs/verification/2026-09-18-runtime-baseline.md).

<p align="center">
  <img src="https://raw.githubusercontent.com/GreenSheep01201/claw-empire/5c928b24ffa55b403fe7c5521d4ac3ac49516137/Sample_Img/Office.png" alt="Upstream Claw-Empire office interface, shown as a credited reference rather than completed Pazmo features" width="100%" />
  <br /><sub>Upstream Claw-Empire interface. This reference image does not demonstrate implemented Pazmo features.</sub>
</p>

## Why Pazmo

An AI office should do more than look busy. Our goal is a team that turns approved intent into small, reviewable changes — and stops honestly when it cannot prove the result.

Pazmo combines the office experience and task runtime of [Claw-Empire](https://github.com/GreenSheep01201/claw-empire) with the contracts, templates and verification principles developed in [AI Workflow Kit](https://github.com/syjkim0125/ai-workflow-kit). It is an independent project; the original kit stays unchanged.

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

Roles are responsibility boundaries, not five permanently running conversations. All are intended to use your own officially authenticated Codex CLI. Subscription usage limits still apply; API-key billing is separate. No silent paid-provider fallback is part of the design.

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

## Current status

| Area | Status |
|---|---|
| Selected upstream | Claw-Empire `v2.0.4`, checked 2026-09-17 |
| Required commit | `5c928b24ffa55b403fe7c5521d4ac3ac49516137` |
| Destination source import | **Original verified locally; publication sanitized** — [evidence](docs/verification/2026-09-18-publication.md) |
| Story and Task templates | Exact upstream copies; installed workflow tooling 3.1.1 |
| Jira-independent team execution | Planned; required end-to-end acceptance test |
| Local CLI and read-only Office | Implemented and tested; [local preview guide](docs/LOCAL-PREVIEW.md) |
| Operator contract and G1/G3 CLI | Implemented with real HTTP/SQLite tests; execution stays locked — [evidence](docs/verification/2026-09-19-contract-approvals.md) |
| Execution isolation and completion guards | Native canary did not meet requirements; live runner and completion guards remain incomplete |
| npm `@pazmo/agent-office` | Target package name; not published or installation-tested |

There is no Pazmo `npx` quickstart yet. Do not infer a working installer from the package name. Read the [current status and next step](docs/STATUS.md), [approved Story](docs/understanding/pazmo-agent-office-contract.md), and [implementation plan](docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md) first. The [v3 handoff](docs/HANDOFF-v3.md) and [source import procedure](docs/IMPORT-UPSTREAM.md) are historical inputs, not approval records. Do not run imported upstream agents with company credentials before their execution boundaries are verified.

## Contributing

Keep changes small and connect them to an observable requirement and fresh evidence. Preserve the pinned upstream baseline and attribution. Prefer tests of real behavior over assertions that a source file contains a particular word. Report source import, build, mock workflow, live Codex, browser and package verification separately.

Current work is organized in the [v3 milestones](docs/HANDOFF-v3.md#10-구현-순서와-끝내야-할-증거). Existing user files, the original AI Workflow Kit and operator credentials are not development scratch space.

## License

**Original Pazmo code and documentation: [MIT](LICENSE).** Imported Claw-Empire code: **Apache-2.0**, with original licensing, attribution and applicable notices retained. Other components keep their respective licenses.

This is **not** an MIT-only relicensing of the upstream project. See [license boundaries](LICENSING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

With thanks to Claw-Empire and AI Workflow Kit, and to the maintainers of Compound Engineering and Superpowers. Open Office and Pixel Agents informed the documentation/interaction references. Pazmo is independent and is not an official release of those projects or OpenAI.
