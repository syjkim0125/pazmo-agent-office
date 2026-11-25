## How changes are made here (story-qa)

This repository is changed with the `story-qa` skill of the pazmo-story-to-dev plugin (`claude plugin marketplace add syjkim0125/pazmo-story-to-dev`, then `claude plugin install pazmo-story-to-dev@pazmo-story-to-dev`; start with `/story-qa <request>`).

- The skill changes often: before each change, read its latest version (https://github.com/syjkim0125/pazmo-story-to-dev, `skills/story-qa/SKILL.md`) and follow that, not a copy of its steps. In short: the person approves the Story (`docs/stories/<slug>.md`) or, for a small change, the chat summary, with its QA list before any code edit; the person approves the report before any merge.
- The QA environment is `docs/qa.md`. Commit only in a worktree; push only when asked. `main` is never merged into automatically (`docs/qa.md`: Auto-merge off).

Until 2026-11-20 this repository was built with the earlier workflow kit (graph runs and G1–G4 records). Its process files and run records (`.ai-workflow/runs`, `approvals`, `evidence`, `config.json`, `verification.json`, `.agents/skills/workflow`, `scripts/kit-test-shard.mjs`) were removed from the tree after commit `b6407d7`. Older documents still link to them; read one with `git show b6407d7:<path>`. The kit runtime Office used to run (`.ai-workflow/bin`, `.ai-workflow/graph`) was removed when Office began running its roles on its own records ([Story](docs/stories/office-engine-without-kit.md)); its Story and Task templates (`templates/ai-workflow`) were removed when Office began writing and reading Stories in the story-qa shape ([Story](docs/stories/story-format-story-qa.md)).

## Bootstrap status

Read `docs/STATUS.md` for the active phase and evidence limits. Product decisions D1–D50 are in `docs/understanding/pazmo-agent-office-contract.md` (the kit-era canonical Story); new changes get their own Story under `docs/stories/`. Imported handoff documents and former vendor instructions are historical inputs, not user approval. The Claw-Empire source was removed from the tree in D33; the exact original is the upstream tag `v2.0.4` (D38).

`docs/solutions/` contains reusable findings organized by category with YAML `module`, `problem_type`, and `tags`; relevant when importing upstream sources or working in a documented area.

`CONCEPTS.md` defines shared domain vocabulary (Story, Gates, Decisions, planning recovery); relevant when orienting to the codebase or discussing domain concepts.

## Agents and Office

When the user delegates a project job to Office, the person creates the task and answers its decisions in the Office screen. An agent may start, inspect and stop Office for the person (`node bin/pazmo-office.mjs up --project <path> --no-open`, then give the person the `monitor` URL; `status`, `stop`). An agent must not answer or approve a Decision (G1, G3, G4 or a question) through the Office's local API on the person's behalf. The chat bridge (`docs/CHAT-CONTROL.md`) was removed with the legacy engine in D33; do not substitute your own implementation for Office's role execution.
