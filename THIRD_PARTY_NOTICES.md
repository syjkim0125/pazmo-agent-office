# Third-party notices and provenance

This file records source attribution. It does not replace any upstream LICENSE or NOTICE file.

## Claw-Empire

- Source: https://github.com/GreenSheep01201/claw-empire
- Release: `v2.0.4`, commit `5c928b24ffa55b403fe7c5521d4ac3ac49516137`.
- Location: `vendor/claw-empire/`; original tree verified in local-only import commit `8e25d7c5ea42d03e202d1599338f3a76d61d05fe`. Published source removes built-in Google OAuth defaults; see `upstream/CHANGES.md` and the original/published trees in the lock file.
- License: Apache-2.0. Retain the original license, applicable NOTICE, original notices and modification attribution.
- README image: upstream `Sample_Img/Office.png` at this commit, explicitly labeled as an upstream reference, not completed Pazmo behavior.

## AI Workflow Kit

- Source: https://github.com/syjkim0125/ai-workflow-kit
- Commit: `ea0f2a2e10872ef85b379afc1ee25835f446a763`.
- Copyright: `Copyright (c) 2026 JongKun Kim`.
- License: MIT; full text in `licenses/ai-workflow-kit-MIT.txt`.
- Exact copies: `templates/ai-workflow/STORY.md` and `TASK.md`.
- Repository-only workflow tooling: `.agents/skills/workflow/`, `.ai-workflow/` and generated routing in `AGENTS.md`, installed from official npm 3.1.1. See `.ai-workflow/config.json` for managed hashes.
- The existing upstream repository/package is not modified and is not a required runtime dependency.

## Optional skills and components

The controller's pinned `assets/codex/gpt-5.5.json` contains the unchanged
GPT-5.5 model entry extracted from OpenAI Codex `rust-v0.155.1`,
`codex-rs/models-manager/models.json`. Source:
https://github.com/openai/codex/tree/rust-v0.155.1. License: Apache-2.0;
the original license and notice are retained at `assets/codex/LICENSE` and
`assets/codex/NOTICE`. Only the selected
entry and JSON formatting were changed. The CLI binary is not redistributed.
The catalog describes client tool behavior; it does not guarantee account
entitlement, model availability, or the model actually served.

Compound Engineering, Superpowers, PM Skills, Impeccable, Vercel/HashiCorp skills and Trail of Bits are selected design inputs, not included installed dependencies in this pack. Before redistributing any of their code or skill text, record exact ref, files, license and notices. Do not imply endorsement.

`tools/playwright-mcp` and `tools/ppt_team_agent` are separate pinned Git submodules of Claw-Empire. Preserving their gitlinks does not copy their contents or complete their license review.

Open Office and Pixel Agents are public UX/README references only. Their code, artwork and logos have not been included in this handoff pack.
