# U25 workflow-review — attempt 1

Independent report-only review: ce-code-review mode:agent against origin/main (f5687342), run 20261030-144107-4f9d51a2. Reviewers: correctness, security, adversarial (session model), testing, maintainability, project-standards, reliability, agent-native, learnings; Codex cross-model adversarial pass.

- Codex cross-model: 0 findings. Security: 0 findings.
- Actionable (anchor 75): (1) P2 reuse-path dependency step untested — fixed in 3bfb30a with the prepare seam and a new lifecycle test; (2) P2 restart test lost the survive-restart half — fixed in 3bfb30a; (3) P2 graph run stale against the final Story — this run replaces it.
- Below the gate, applied in 3bfb30a: --ignore-scripts, packed-install guard, install line only when installing, COMMAND_REMOVED, NOT_INSTALLED hint, doctor/operator-file assertions, static ws imports, stale comments, AGENTS.md "Agents and Office", README shared-checkout note, history banners, last commit with source in upstream/.
- Recorded as residual risk: npm ci empties node_modules before fetching (future ws bump offline); concurrent installs unlocked; CJS vs ESM ws resolution; team start time unmeasured; hub web still offers accept; chat control reopening needs a human-only gate design.
- Earlier, plan review (coherence, feasibility, adversarial) and the simplify pass (reuse, quality, efficiency) ran; their findings were applied (plan ea152ee, code 948afc7).
