---
name: pazmo-hub-finish
description: Use when the PL asks to approve a finished Story's result on the team Hub and merge it (for example "Story 7 결과 승인해줘", "main에 머지해줘" or "finish story 7"). Shows the PL what passed, asks for the approval, writes the approval record and runs `pazmo-office team finish`, after which the PL's team Office merges each repo.
---

# Approve a Story's result and merge it (team Hub)

## When to use

A Story on the team Hub shows **승인 대기**: every Task is merged and the PL's Office checked the Story (its Story checks
passed on each repo's latest Story base). The PL (the person who leads the Story) approves the result here, in this
conversation, on the PL's own Mac (the one connected with `pazmo-office mac connect`). The Hub records it as a local
approval with this Mac's name. The PL's team Office then merges each repo's Story base into its base branch. Nothing
is merged until the PL has said yes to you here. The PL can instead approve on the Story's Hub page (결과 승인 card,
D49); whichever approval comes first is used, and `team finish` then reports `status: "approved"`.

## Steps

1. Run `pazmo-office team finish --story <N>` (N is the Story number on the Hub). It prints JSON.
   - `status: "needs-approval"`: go to step 2.
   - `status: "approved"`: the Story is approved already; tell the PL the Office is merging (see `repos`, and
     `problem` when a merge keeps failing, for example an expired `gh` login).
   - `status: "rechecking"`: the Story was checked before approvals were bound to commits; the PL's Office checks it
     again. Run the command again once the Hub shows the Story at 승인 대기.
   - `status: "done"`: the Story is finished.
   - An error with a `code`: see the table below.
2. Show the PL, in plain words: the Story title, the check `summary` and, for each repo, the base branch and the
   checked `commit`. Say what approving does: each repo's Story base is merged into its base branch with the PL's
   git and gh, through a PR per repo; a conflict or a protection rule leaves that PR to a person.
3. Ask the PL whether to approve, like a kit G4: what the change does, one thing that must stay true, and what was
   not checked. Do not answer for the PL and do not approve on your own.
4. Only after the PL says yes: copy `record.template` into the file at `record.path`, and put the PL's own words in
   `responseRef` (what you showed, your question and the PL's answer, quoted). Change nothing else in the template:
   `storyFingerprint` and `commits` bind the approval to what the Office checked.
5. Run `pazmo-office team finish --story <N>` again. `status: "approved"` means the Hub took it. The record file is
   renamed (`….approved.json`), so a later approval needs a new answer from the PL.
6. Tell the PL to follow the merge on the Hub's Story page: 머지 중, 사람 머지 대기 (a PR waits for a person; its link
   and reason are there) and 머지됨. When every repo is merged the Story is 완료.

If the PL says no, write nothing. To fix the result, the PL adds Tasks to the Story; the Office checks it again.

## Record

```json
{ "gate": "G4", "story": 7, "storyFingerprint": "<from the template>",
  "commits": [{ "repoId": "<from the template>", "repo": "app-be", "commit": "<from the template>" }],
  "responseRef": "보여 준 것: …. 질문: \"이 결과를 승인하고 main에 머지할까요?\" PL의 답: \"승인\"",
  "date": "2026-11-19" }
```

## Errors

| code | meaning | what to do |
|---|---|---|
| `FINISH_STATE` | The Story is not at 승인 대기, or has no checked commits | Wait for the Story check; if it failed, the PL adds Tasks |
| `FINISH_RECORD` | The record is not JSON, not this Story's, or has no PL answer | Rewrite it from the template with the PL's words |
| `FINISH_STALE` | The record's fingerprint or commits differ from what the Office checked | Delete the record, show the new result and ask again |
| `NOT_YOUR_MAC` | This Mac is not the PL's connected Mac | Run on the PL's current Mac |
| `STALE` / `STATE` from the Hub | The Story changed meanwhile, or is approved already | Run `team finish --story <N>` again and follow its status |
