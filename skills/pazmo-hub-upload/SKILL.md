---
name: pazmo-hub-upload
description: Use when the PL asks to put an approved Story and its Tasks on the team Hub (for example "허브에 올려줘" or "upload this Story to the Hub"). Writes the Task file and runs `pazmo-office team upload`, which checks the local kit approval, uploads the Story, makes each repo's Story base and opens it.
---

# Upload an approved Story to the team Hub

## When to use

The PL (the person who leads the Story) worked out a Story with you in this conversation and wants the team to build
it: teammates' Macs take its Tasks from the Hub. Use this only on the PL's own Mac, the one connected to the Hub with
`pazmo-office mac connect`. The command does everything itself: no Office, no AI and no web click is needed.

## Before you run it

1. Write the Story with the kit workflow (`$workflow` or `/workflow`) in the kit template: `# Story: <title>`, Goal,
   Domain, MUST (`- M1. …`), SHOULD, OUT, Decisions, Verify (`- V1 [M1, M2]. …`). Every M needs a V that names it.
2. Get the PL's G1 (understanding gate) through the kit workflow. The kit writes the line
   `Understanding gate (G1): <record path> · <date> · Check-in: accepted` into the Story header and the record (JSON with
   `gate`, `storyHash`, `responseRef`). Keep that line as it is.
3. For a high-risk Story also get G3 (design approval) through the kit workflow: the Story gets an
   `Understanding gate (G3): …` line whose record binds the Story and the design file it names (`design`,
   `decisionHash`).
4. Do not edit the Story after its approval. Any change to the text (except the Status and gate lines) needs a new G1
   (and G3), and the command refuses the old one.
5. Write the Task file below. Each Task names its repo, the files it touches, the Story M/V ids it covers, the Tasks
   it waits for, and its checks.

## Task file

```json
{ "project": "<프로젝트 이름 또는 id>", "risk": "normal",
  "repos": [{ "name": "app-be", "baseBranch": "main" }],
  "tasks": [{ "id": "be-pay", "repo": "app-be", "title": "…", "spec": "…", "files": ["src/pay.ts"],
              "covers": ["M1", "V1"], "after": [], "checks": [{ "id": "V1", "argv": ["npm", "test"], "timeoutMs": 120000 }] }],
  "storyChecks": [{ "repo": "app-be", "checks": [{ "id": "V1", "argv": ["npm", "test"], "timeoutMs": 300000 }] }] }
```

- `project`: the Hub project's name or id (`--project` overrides it). `risk`: `normal` or `high` (high needs G3).
- `repos`: every repo a Task or Story check uses, by its Hub name, with the project's base branch for it (the same
  branch the Hub project shows).
- `tasks[].id`: lowercase letters, digits and `-`, at most 40 characters. `title`: one line. `spec`: what to build,
  for the teammate's AI; the command adds a last line `Covers: <covers>`. `files`: 1 to 50 relative paths the Task
  touches (a path ending in `/` is a folder); two Tasks of one repo that touch the same file need an order (`after`).
- `tasks[].covers`: the Story M and V ids this Task makes true, at least one V. Across all Tasks every M and every V
  of the Story must be covered, and each M a Task covers must be checked by one of that Task's own Vs.
- `tasks[].after`: ids of Tasks that must be merged before this one starts. No cycles.
- `tasks[].checks`: 1 to 8 commands, one per V in `covers` (`id` is that V); `argv` is the command as a list,
  `timeoutMs` at most 600000.
- `storyChecks`: per repo, the checks that prove the whole Story once every Task is merged; each `id` is a Story V.
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
| `UPLOAD_G1` | The Story has no G1 line, its record is missing, or the record does not bind this Story text (it changed after approval). | Get G1 again through the kit workflow for the Story as it is now, then run again. |
| `UPLOAD_G3` | `risk` is `high` but there is no G3 line, its record does not bind this Story, or the design file changed after G3. | Get G3 for the design through the kit workflow, then run again. |
| `UPLOAD_STORY` | No `# Story:` title, the Story is over 32768 bytes, or it is not the kit shape (an M no V names, a V naming an M that does not exist, duplicate ids). | Fix the Story, get G1 again (the text changed), then run again. |
| `UPLOAD_TASKS` | The Task file is not JSON or not the shape above: a bad `risk`, a `covers` id the Story does not have, a covered V without its check or a check whose V is not covered, an `after` naming no Task, or a graph the Hub refuses (cycle, two Tasks on one file with no order, limits). | Fix the Task file as the message says, then run again. |
| `UPLOAD_COVERAGE` | An M or V of the Story is in no Task's `covers`, or a Task covers an M that none of its own Vs checks. | Add a Task or put the id in the right Task's `covers` (and its check), then run again. |
| `UPLOAD_REPO` | The project is not on the Hub, a repo is not in the project, its `baseBranch` is not the project's, a Task or Story check uses a repo `repos` does not list, or a Story repo is not on this Mac. | Use the project's repos and base branches; get a missing repo onto this Mac with `pazmo-office mac connect`. |
| `UPLOAD_LINK` | This Mac is not connected to the Hub, or its connection was ended. | Run `pazmo-office mac connect --hub <hub>` on this Mac, or run the command on the PL's current Mac. |
| `NOT_YOUR_MAC` | The Hub says this is not the PL's current Mac (a newer Mac was connected, or the link was not made by a Mac). | Run the command on the Mac the PL connected last. |
| `NOT_OWNER` | The PL is not an owner of every repo of the project. | Ask a Hub admin to add the PL as owner of those repos. |
| `UPLOAD_CANCELLED` | A Story with this exact text was cancelled on the web. | Change the Story, get a new G1, then upload it as a new Story. |
| `GIT_FAILED` | Fetching a base branch or pushing `feature/story-<N>/base` failed (network, permission, a branch rule). The Story waits on the Hub as not opened. | Fix the cause and run the same command again; it goes on where it stopped. To give up, cancel the Story on its Hub page. |
| `BASE_EXISTS` | `feature/story-<N>/base` is already on origin at another commit. | Only if that branch holds no team work, a developer deletes it and the command is run again; otherwise cancel the Story on its Hub page. |
| `BASES_CHANGED` | The Hub already keeps another base commit for a repo of this Story. | Run the same command again: it uses the commits the Hub keeps. |

Any other code comes from the Hub or the network with its own sentence; fix what it says and run the same command
again.
