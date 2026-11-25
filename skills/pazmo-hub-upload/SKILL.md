---
name: pazmo-hub-upload
description: Use when the PL asks to put an approved Story and its Tasks on the team Hub (for example "허브에 올려줘" or "upload this Story to the Hub"). Writes the Task file and runs `pazmo-office team upload`, which checks that the story-qa Story is approved, uploads the Story, makes each repo's Story base and opens it.
---

# Upload an approved Story to the team Hub

## When to use

The PL (the person who leads the Story) worked out a Story with you in this conversation and wants the team to build
it: teammates' Macs take its Tasks from the Hub. Use this only on the PL's own Mac, the one connected to the Hub with
`pazmo-office mac connect`. The command does everything itself: no Office, no AI and no web click is needed.

## Before you run it

1. Write the Story and get the PL's approval with `/story-qa` of the pazmo-story-to-dev plugin
   (https://github.com/syjkim0125/pazmo-story-to-dev). Follow the skill as it is now; this guide does not restate it.
   The command takes the skill's Story shape: a `# Story: <title>` line, `## MUST` with `- M1. …` lines and `## QA`
   with `- Q1 [M1] (script). …` lines (targets `M<n>`, `Unchanged` or `not shown`; method `script`, `agent` or
   `person`), every M named by a Q.
2. Once the PL approves, the Story's `Status:` line at the bottom reads `Approved` (anything may follow it, for
   example `Status: Approved (2026-11-24, <name>)`). The command reads that line as the approval; a `Draft` Story is
   refused.
3. Do not edit the Story after its approval. The Hub keys a Story by its text (the `Status:` lines left out), so a
   changed text goes up as another Story; ask the PL to approve the change first.
4. Write the Task file below. Each Task names its repo, the files it touches, the Story M/Q ids it covers, the Tasks
   it waits for, and its checks.

## Task file

```json
{ "project": "<프로젝트 이름 또는 id>", "risk": "normal",
  "repos": [{ "name": "app-be", "baseBranch": "main" }],
  "tasks": [{ "id": "be-pay", "repo": "app-be", "title": "…", "spec": "…", "files": ["src/pay.ts"],
              "covers": ["M1", "Q1"], "after": [], "checks": [{ "id": "Q1", "argv": ["npm", "test"], "timeoutMs": 120000 }] }],
  "storyChecks": [{ "repo": "app-be", "checks": [{ "id": "Q1", "argv": ["npm", "test"], "timeoutMs": 300000 }] }] }
```

- `project`: the Hub project's name or id (`--project` overrides it). `risk`: `normal` or `high`, as the PL judged the
  Story; the Hub shows it as written.
- `repos`: every repo a Task or Story check uses, by its Hub name, with the project's base branch for it (the same
  branch the Hub project shows).
- `tasks[].id`: lowercase letters, digits and `-`, at most 40 characters. `title`: one line. `spec`: what to build,
  for the teammate's AI; the command adds a last line `Covers: <covers>`. `files`: 1 to 50 relative paths the Task
  touches (a path ending in `/` is a folder); two Tasks of one repo that touch the same file need an order (`after`).
- `tasks[].covers`: the Story M and Q ids this Task makes true, at least one Q. Across all Tasks every M and every Q
  of the Story must be covered, and each M a Task covers must be checked by one of that Task's own Qs.
- `tasks[].after`: ids of Tasks that must be merged before this one starts. No cycles.
- `tasks[].checks`: 1 to 8 commands, one per Q in `covers` (`id` is that Q); `argv` is the command as a list,
  `timeoutMs` at most 600000.
- `storyChecks`: per repo, the checks that prove the whole Story once every Task is merged; each `id` is a Story Q.
- At most 40 Tasks.

## Run

```sh
pazmo-office team upload --story <Story.md> --tasks <tasks.json> [--project <name or id>] [--data-dir PATH]
```

It prints `{"storyId":"…","number":8,"opened":true,"already":false}` and the Story is open on the Hub board. Running
the same command again is safe: after a failure it goes on from the step that failed (uploaded → Story bases → open),
and after a success it answers `"already":true` and changes nothing. One Story text never makes two Stories.

`pazmo-office team upload --guide` prints this file.

## Errors and how to fix them

A refusal prints `{"code":"…","error":"…"}` with a plain sentence and exits nonzero. Nothing is created on the Hub when
a check before the upload fails.

| Code | What is wrong | Fix |
|---|---|---|
| `UPLOAD_G1` | The Story is not approved: its last `Status:` line does not read `Approved` (it is `Draft`, or there is none). | Get the PL's approval with `/story-qa`, write `Status: Approved` at the bottom, then run again. |
| `UPLOAD_STORY` | The Story is not a story-qa Story (no `## QA`, or an earlier format's `## Verify` or `Understanding gate` line), has no `# Story:` title, is over 32768 bytes, or breaks the shape (a QA line that is not `- Q<n> [<targets>] (script\|agent\|person). …`, an M no Q names, a Q naming an M that does not exist, duplicate ids). | Rewrite or fix the Story with `/story-qa`, get the PL's approval for the new text, then run again. |
| `UPLOAD_TASKS` | The Task file is not JSON or not the shape above: a bad `risk`, a `covers` id the Story does not have, a covered Q without its check or a check whose Q is not covered, a Story check whose id is not a Story Q, an `after` naming no Task, or a graph the Hub refuses (cycle, two Tasks on one file with no order, limits). | Fix the Task file as the message says, then run again. |
| `UPLOAD_COVERAGE` | An M or Q of the Story is in no Task's `covers`, or a Task covers an M that none of its own Qs checks. | Add a Task or put the id in the right Task's `covers` (and its check), then run again. |
| `UPLOAD_REPO` | The project is not on the Hub, a repo is not in the project, its `baseBranch` is not the project's, a Task or Story check uses a repo `repos` does not list, or a Story repo is not on this Mac. | Use the project's repos and base branches; get a missing repo onto this Mac with `pazmo-office mac connect`. |
| `UPLOAD_LINK` | This Mac is not connected to the Hub, or its connection was ended. | Run `pazmo-office mac connect --hub <hub>` on this Mac, or run the command on the PL's current Mac. |
| `NOT_YOUR_MAC` | The Hub says this is not the PL's current Mac (a newer Mac was connected, or the link was not made by a Mac). | Run the command on the Mac the PL connected last. |
| `NOT_OWNER` | The PL is not an owner of every repo of the project. | Ask a Hub admin to add the PL as owner of those repos. |
| `UPLOAD_CANCELLED` | A Story with this exact text was cancelled on the web. | Change the Story, get the PL's approval for it, then upload it as a new Story. |
| `GIT_FAILED` | Fetching a base branch or pushing `feature/story-<N>/base` failed (network, permission, a branch rule). The Story waits on the Hub as not opened. | Fix the cause and run the same command again; it goes on where it stopped. To give up, cancel the Story on its Hub page. |
| `BASE_EXISTS` | `feature/story-<N>/base` is already on origin at another commit. | Only if that branch holds no team work, a developer deletes it and the command is run again; otherwise cancel the Story on its Hub page. |
| `BASES_CHANGED` | The Hub already keeps another base commit for a repo of this Story. | Run the same command again: it uses the commits the Hub keeps. |
| `STATE` | The Story cannot go on from where it is on the Hub: the same text was put on the Hub another way (not by this command), or the uploaded Story is no longer a draft the command can open. | Open the Story on the Hub and look at its state. To put it up again, change the Story, get the PL's approval for it, then run the command. |
| `HUB_UNREACHABLE` | The command could not reach the Hub (network, VPN, the Hub is restarting). | Check the network and that the Hub page opens, then run the same command again; it goes on where it stopped. |
| `HUB_BAD_RESPONSE` | The Hub answered in a shape the command does not know (the Hub and this Office are different versions). | Update this Office (and ask the admin about the Hub version), then run the same command again. |

Any other code comes from the Hub or the network with its own sentence; fix what it says and run the same command
again.
