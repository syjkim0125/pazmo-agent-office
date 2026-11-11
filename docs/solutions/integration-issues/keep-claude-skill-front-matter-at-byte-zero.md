---
title: Keep a Claude skill's front matter at byte 0; put ownership markers in a sidecar file
date: "2026-11-11"
category: integration-issues
module: claude upload guide
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "The guide copied into ~/.claude/skills/pazmo-hub-upload/SKILL.md began with an HTML comment line before its YAML front matter"
  - "Claude Code would most likely not load it as a skill, and skill validators reject a SKILL.md that does not start with ---"
root_cause: config_error
resolution_type: code_fix
tags: [claude-skill, skill-md, front-matter, mac-connect, managed-file, sidecar]
---

# Keep a Claude skill's front matter at byte 0; put ownership markers in a sidecar file

## Problem

U39 (D42, PR #81) ships a claude guide, `skills/pazmo-hub-upload/SKILL.md`, and copies it into `~/.claude/skills/pazmo-hub-upload/` on `mac connect`. The copy must never overwrite a guide the user has edited. The plan's first design marked our copies with a header line, `<!-- pazmo-office managed: sha256=… -->`, placed before the file's front matter. That broke the one thing the copy is for.

## Symptoms

- The installed `SKILL.md` started with the comment line, and its `---` front matter began on line 2.
- A skill's `name` and `description` are read from YAML front matter that starts at the first byte. A file that does not start with `---` is rejected by skill validators and most likely never triggers. The guide would sit in the right folder and do nothing.

## What Didn't Work

- **The header-comment marker.** It is fine for most managed files, but a `SKILL.md`'s first bytes belong to the front matter. The task review did not catch it either: the plan itself mandated the header, and the test asserted the header-plus-body bytes. The final whole-branch review found it.

## Solution

Write `SKILL.md` byte for byte equal to the repo's file, front matter first. Keep the ownership marker next to it in a sidecar file (`src/cli/mac.ts`, `GUIDE_MARK = ".pazmo-managed"` at line 257, `installUploadGuide` at line 283):

- No `SKILL.md` → write it and `.pazmo-managed` (the sha256 of what was written) → `written`.
- Sidecar present and `sha256(SKILL.md)` equals it → the file is ours. If it already equals the source → `same`; else replace both → `written`.
- No sidecar, or a mismatch → the user's file, left untouched → `kept-user-edit`.
- A symlinked `SKILL.md` or folder is treated as the user's (`lstat`, `src/cli/mac.ts:259`). Writes go through a temp file and a rename, and the temp file is removed on failure.

## Why This Works

The front matter stays where Claude Code reads it. Ownership is still decidable: the sidecar records exactly what we wrote, so any byte the user changed makes the hashes differ and the file is kept. Edits are never overwritten, and our older copies are still upgraded.

## Prevention

- In tests for any installed skill, assert that the file's first bytes are `---` and that the file equals the source exactly, not "header + source".
- When a plan mandates a format for a file another tool parses, check that tool's format first. A reviewer should treat a plan-mandated format as a finding to check, not a given.
- `tests/mac-skill-copy.test.mjs` and `tests/team-mac-cli.test.mjs` pin these points: front matter at byte 0, the sidecar rules, and a symlink being kept.

## Related

- `skills/pazmo-hub-upload/SKILL.md` (the guide; `pazmo-office team upload --guide` prints it).
- [self-ignore-pazmo-office-metadata-folder.md](self-ignore-pazmo-office-metadata-folder.md): another case of writing into a place the user owns.
