# Choose a model for the assigned work

Use this policy before model dispatch, in standalone delivery and every role flow. The kit supplies the rule; the host supplies available models and executes the choice. This is instruction policy, not a model router, provider SDK or Graph CLI flag. Jev is not required.

## Discover once, then choose

1. Honor explicit user model choices, permitted providers, data boundaries, delegation rules and remaining time/cost limits. This policy grants no new permissions.
2. Read the host's available-model catalog or configuration. Use exact selectable IDs, supported tools/modalities, context limits, relevant capability evidence and known cost/latency information. Public model lists do not prove account access. Do not guess IDs, prices or capability rankings from model names. Reuse this information during the run; refresh when availability changes or new requirements need missing information.
3. Identify this task's needs: ambiguity, failure impact, required tools, input size/modality and how the result can be checked. Filter out unsuitable models. For poorly understood or high-impact work, require stronger relevant capability evidence. Unknown capability is not proof of suitability.
4. Compare **all eligible models**, including ones several levels below the current model. Choose the lowest expected total cost that meets the task's needs and deadline, using comparable task results where available. Include correction, review and handoff overhead. When total-cost evidence is absent, use verified relative cost information and a cautious suitability judgment; do not invent scores. Do not select an expensive model solely because the role is PM or Reviewer.
5. Apply the choice using the host's supported model/configuration controls. Pass the same policy and allowed catalog to already-authorized workers. Confirm the actual model from execution metadata when available. A recommendation alone is not a model switch.

If discovery or switching is unsupported, keep the permitted current/default model, subject to known capabilities and limits, and disclose the restriction once. A worker-only model selector cannot switch its parent session. Do not create extra workers solely to switch models. If no permitted option can satisfy required capabilities or budget, return the specific blocker.

## Match effort to work

| Work | Selection rule |
|---|---|
| Graph readiness, schema checks, tests | Run existing deterministic tools; no model call just to reinterpret their state |
| Clear, bounded, low-impact edits or extraction | Cheapest supported model with sufficient tools, context and capability; skipping several tiers is valid |
| Implementation with clear scope and checks | Lowest-cost suitable model; keep implementation, review and verification requirements |
| Ambiguous design, unexplained failures, high-impact behavior | Choose using evidence of relevant reasoning ability; price alone cannot establish suitability |

## Reassess only with a reason

An expected red test, missing input, expired credential or tool outage is not evidence that a larger model is needed. Diagnose the cause first. Reassess after concrete feedback reveals a material capability gap or the scope changes. Select a better-suited permitted model directly; do not walk every tier or cycle through models. Every attempt consumes existing graph and host limits.

Before a handoff, stop the previous worker and inspect its changes. Carry the task constraints, revision, relevant artifacts, failed checks and unresolved issues, not the whole conversation. Preserve the run and attempt history; use existing recovery/token rules when an attempt restarts. Never overlap writers or reset a run to renew its budget. Review independence and human approval remain unchanged.

Record the selected model/configuration, short reason and any actual switch or limitation in existing task evidence. Keep observed tokens, cost, elapsed time and correction counts when the host provides them; unknown usage stays unknown. Judge savings per accepted task. Do not promise fewer tokens or lower cost merely because a smaller model was selected. Selection itself uses this rule and existing metadata, not a separate routing-model call.

## Record host execution, not a prediction

Use `output.execution` on the existing Graph result, not another workflow or routing agent:

```json
{"selection":"delegated","requestedModel":"<exact eligible host ID>","actualModel":null,"confirmation":"unknown","effort":"low","reason":"bounded task with runnable acceptance checks","usage":null}
```

`selection` is `inline`, `delegated`, `pinned`, `unsupported`, or `unknown` when the host supplies no selection record. Set `confirmation: confirmed` and `actualModel` only with a host execution `metadataRef`. Otherwise actual model and unknown usage remain null. Observed usage has `inputTokens`, `outputTokens`, `cost` (each nullable), and `source`; include currency when known. A validated metadata object preserves host claims; it does not independently authenticate the provider or prove savings. See `examples/host-routing/README.md` in the package for host acceptance cases.
