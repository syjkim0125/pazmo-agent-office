---
title: Read a claude role report that follows a sentence of its own
date: "2026-10-27"
category: integration-issues
module: Office claude runner output normalization
problem_type: integration_issue
component: assistant
related_components: [service_object, testing_framework]
severity: high
symptoms:
  - "A claude sonnet reviewer returned a valid pass report, but the review verdict was recorded as unknown with report null"
  - "The lean Office task stopped with UNKNOWN_RESULT and offered no rerun, only cancel"
  - "The reviewer's final text block was one sentence, a blank line, then a fenced json block holding the report"
root_cause: logic_error
resolution_type: code_fix
tags: [claude-cli, reviewer, role-report, unfence, terminal-report, unknown-result, regex, lean-office]
---

# Read a claude role report that follows a sentence of its own

## Problem
Office reads every role report (planning, understanding, review) from the last assistant message of a run. For claude runs, `normalizeClaudeStream` first passes each text block through `unfence`. That function only unwrapped a message that was nothing but one fenced block. When a sonnet reviewer wrote a sentence before its fenced JSON pass report, Office read no report, recorded the review as unknown, and the task stopped.

## Symptoms
- The task detail showed "하위 작업이 멈췄습니다: UNKNOWN_RESULT …" and no automatic rerun.
- The review event's observation had `exitCode: 0`, `report: null` and verdict `unknown`.
- Its output held a well-formed report, `"verdict":"pass"` with digests matching the candidate. The report sat inside ```json after a line like "All three registered checks (V1, V2, V3) verified independently: …".
- The same reviewer had earlier sent the JSON as a separate text block, and that review parsed. The failure depends on how the model formats one run, so it comes and goes.

## What Didn't Work
- **Blaming the task wording.** An earlier stop on 2026-10-23 with the same agent was a genuine unknown. The task body asked the reviewer to verify runner identities it had no evidence for. A clean rerun without that requirement stopped again. The two stops looked alike (`UNKNOWN_RESULT` after a sonnet review) but had different causes. Compare `observation.report` first: a parsed report with verdict `unknown` is a real verdict, while `report: null` means Office never read the report.
- **Counting fences across the whole message** (first fix): accept only when `text.split("```").length === 3`. An independent review showed this rejected a fenced-only report whose JSON string quoted ```npm test```, a form the old code read. That is the same stall it was meant to fix. The unanchored regex `(?:^|\n)\s*```…` also became quadratic on long blank runs (100K newlines took 7.5 s, inside the controller's close handler).

## Solution
`unfence` in `src/runners/claude-profile.ts` (line 113) now finds the message's first ``` and requires that it opens its own line as ```json or a bare ```, and that a fence line ends the message. The text between them is the answer. Anything else leaves the message as is, and the existing readers decide.

```ts
function unfence(text: string): string {
  const open = text.indexOf("```");
  if (open < 0) return text;
  const m = /^[ \t]*```(?:json)?\n([\s\S]*)\n```\s*$/.exec(text.slice(text.lastIndexOf("\n", open) + 1));
  return m ? m[1] : text;
}
```

Tests in `tests/claude-profile.test.mjs` pin these cases:

- A sentence before the block is read.
- Backticks inside a JSON string are kept (line 142).
- A fence on the same line as prose is rejected.
- Text after the block is rejected.
- Two blocks do not parse.
- An earlier sentence-and-block draft voids the final report (line 146).

Replaying the stalled reviewer message through the fixed path gave `verdict=pass findings=0`. Both fixes landed with PR syjkim0125/pazmo-agent-office#32.

## Why This Works
Only `unfence` changed which text counts as the answer. The source boundary is unchanged:

- `terminalReport` (`src/runners/terminal-report.ts`) still takes only the last agent_message right before `turn.completed` (line 28) and JSON-parses it (line 46).
- Tool output never becomes an agent_message.
- A review report must carry the run's candidate and contract digests, so a quoted candidate file cannot pass as a report.

Starting from the first ``` means a fence earlier in the prose rejects the message. That keeps "the block is the whole answer" without counting backticks inside JSON strings. A second block cannot slip through: a fence line inside the captured text puts a raw newline and ``` outside any JSON string, so `JSON.parse` fails. The anchored regex runs once from a fixed start, so it stays linear.

## Prevention
- When a role report reads as null, check the raw final message before blaming the model or the task. `src/core/verification.ts` turns a missing report into `unknown` (line 103), which stops the task with no automatic rerun.
- Keep the role prompt strict ("Your final assistant message must be only a JSON object", `assets/roles/reviewer.md:9`), and keep the parser tolerant of the commonest harmless deviation. Accepted tradeoff: the sentence is discarded, so "I could not verify X; a pass report would be: ```json …```" reads as that report.
- An earlier message that unfences to a report with marker keys still voids the turn (`terminal-report.ts:42`). Earlier prose-and-block drafts now count as such reports.
- For parsers on model output, test with a report whose JSON quotes backticks, and time one degenerate input (long blank runs) once before merging.
- Separate issue, not fixed here: a reviewer that ends with a runner/API error (`turn.failed`, exit 1) is recorded as review `fail` (`verification.ts:92`), so Office rebuilds and spends a retry. That classification is being handled as its own change.

## Related Issues
- [Report planning runner failures as runner failures, not plan-format rejections](report-planning-runner-failure-separately.md): the same idea for planning, where a runner failure must not look like a report-format problem.
- [codex home AGENTS.md leaks into isolated runs](../security-issues/codex-home-agents-md-leaks-into-isolated-runs.md): why codex was blocked and the different-runner review used another claude model.
- Real check record: `docs/verification/2026-10-21-lean-office-phase1.md` ("실제 확인에서 찾은 것" 1).
