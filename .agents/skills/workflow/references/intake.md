# Intake and Contract

## Internal Domain Frame

Derive before asking: actor, desired outcome, terms/entities, state change, invariant/forbidden outcome, failure, external side effect, and observable evidence.

## Question policy

- Ask **only blocking** unknowns that change behavior, ownership, or failure semantics.
- Ask one decision per turn by default; **at most three** independent, closely related questions.
- Stop after **two question rounds**. Draft with safe defaults labeled `ASSUMED`; keep unsafe gaps as `OPEN BLOCKING`.
- Never ask implementation or **HOW** questions before the contract is clear. Database, queue, lock, and file choices belong to planning.
- Offer a concrete default rather than an open questionnaire when a conventional safe choice exists.

## Explain the direction first

Before showing the contract or asking for G1, give a short explanation in the user's language. Assume no knowledge of the codebase, not a lack of intelligence. Use familiar words and a respectful tone; define necessary technical terms on first use.

Cover these points in a few connected sentences:
- What happens today, and why that is a problem for the person using it.
- What will happen after the change, with one concrete before/after example if helpful.
- What must remain true, and what happens if the operation fails.
- How we will tell it works, including anything we cannot yet verify.

Explain observable behavior here, not implementation choices. Label a suspected cause as a hypothesis. Use an analogy only when it clarifies the real behavior, and connect it back to that behavior. For a simple change, one or two sentences are enough. Do not force a diagram, quiz, separate explainer artifact, or another approval round.

Put this explanation at the start of the Story's Goal section, with the formal criteria and technical evidence below it. It is part of the same contract, not a second requirements source. The reader should be able to judge the desired outcome before seeing field names, gate IDs or commands.

## Output recipe

Create one Story from `../assets/STORY.md`:

1. Goal: actor + observable outcome.
2. Domain: terms and business invariants only.
3. MUST: numbered positive and negative behavior.
4. SHOULD: useful but non-blocking behavior.
5. OUT: explicit exclusions that prevent scope expansion.
6. Decisions: human choices, `ASSUMED`, and material open items.
7. Verify: V# cases mapped to M#; include success and failure.

Keep it one-screen by default. Do not copy it into an “AI spec.”

## Jira section formatting

When creating or updating Jira Stories or Tasks, use the editor's actual format. In Jira wiki-text mode, use literal h2. and h3. headings, not Markdown heading markers. Use real newline characters, not escaped backslash-n text.

Each heading must occupy its own line, with a blank line before and after it. End the preceding paragraph or list before starting the next section. Keep peer sections such as MUST, SHOULD, OUT, Decisions and Verify at the same heading level; do not indent a heading or place it inside a list item or paragraph. Separate consecutive headings with a blank line even when there is no intervening body. Do not leave empty sections unintentionally: use a brief N/A reason where appropriate.

Example for Jira wiki-text mode:

```text
h2. Scope

h3. MUST

* M1. The user can complete the operation.

h3. SHOULD

* S1. The user can identify the failed step.

h3. OUT

* O1. Other payment methods are unchanged.
```

In the visual editor, apply actual heading styles to separate blocks instead of typing wiki markup as ordinary text. After publishing, check the rendered description: headings must appear as distinct sections, and the previous list or paragraph must not absorb the next heading. Preserve the user's existing formatting when editing a description; do not overwrite their manual corrections.

## G1 approval

Show the full concise draft, beginning with the plain-language explanation above, and ask: “이 내용이 이번 구현의 범위와 완료 조건으로 맞나요?” End the turn. On explicit approval, save the approved snapshot and decision to `docs/understanding/<slug>-contract.md`, set `Status: Approved`, and record:

`Understanding gate (G1): <artifact> · <date> · Check-in: accepted`

Then verify instead of assuming. Write `Status: Approved` and the G1 record first, then run
both checks and report both exit codes:

```
node .ai-workflow/bin/check.mjs story <story-file>
node .ai-workflow/bin/check.mjs gate G1 <story-file>
```

`story` checks that the contract is well formed. `gate G1` checks that a human actually
approved it. Run `story` while the file still says `Draft` and it exits 0 on shape alone —
that is not approval, and the output says which gate it skipped. Do not start implementation
unless both exit 0, and never claim the gate passed without that output.

No approval means no implementation.
