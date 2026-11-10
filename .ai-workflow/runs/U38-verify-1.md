# U38 (PL planning) verify

Tree `c9676dd` (snapshot `d13c5b9c…`, unchanged before and after every check of the passing attempt). Run with `graph.mjs verify` per docs/verification/kit-checks.md, node 24.19.0, no other test process.

## Attempts

- **Attempt 1:** tests-1of3 514/514 passed; tests-2of3 516/516 with exit 0 but `passed: false` because the snapshot changed mid-run: a design-check hook wrote `.impeccable/hook.cache.json` (untracked, not ignored) into the worktree while the controller drafted the G4 page. The file was moved out (snapshot back to `d13c5b9c`); a check cannot be re-run inside an attempt, so the node was reset.
- **Attempt 2:** tests-2of3 515/516 — the pre-existing `tests/lean-lifecycle.test.mjs` "up does not reuse a running Office that cannot execute, and never stops it" failed at its final `stop` (status 1 instead of 0) while machine load was 11–12 (endpoint security software at ~200% CPU). This branch does not touch that test, `src/cli/lifecycle.ts` or `src/cli/launcher.ts`; the file passed 15/15 three times alone right after, and in both full runs (1726/1726, 1754/1754). Recorded as a load flake; reset after the load fell below 4.
- **Attempt 3 (recorded):**

| Check | Result | Evidence |
|---|---|---|
| tests-1of3 | `ℹ tests 514`, `ℹ pass 514`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (03:12:25–03:13:06Z) | `.ai-workflow/evidence/c07f0cc5-77a4-4e2d-8b55-c151a88a2f81/f3fc48e3-2663-4d72-bd40-ae12b1098ce3/` |
| tests-2of3 | `ℹ tests 516`, `ℹ pass 516`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0 (03:13:06–03:13:41Z) | `.ai-workflow/evidence/c07f0cc5-77a4-4e2d-8b55-c151a88a2f81/7ef08ce1-ce41-43c2-830f-346b377799bf/` |
| tests-3of3 | `ℹ tests 724`, `ℹ pass 724`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0 (03:13:42–03:14:52Z) | `.ai-workflow/evidence/c07f0cc5-77a4-4e2d-8b55-c151a88a2f81/ea3892fd-4de6-4f57-8457-5ae19c13312c/` |
| typecheck | exit 0 | `.ai-workflow/evidence/c07f0cc5-77a4-4e2d-8b55-c151a88a2f81/519f0b9c-aa8b-49ad-9ade-0286ace81f0c/` |
| story | exit 0 (shape and gate presence only) | `.ai-workflow/evidence/c07f0cc5-77a4-4e2d-8b55-c151a88a2f81/6513642f-d0d5-4292-8bfb-67ded60e1e90/` |

Tests total: 514 + 516 + 724 = **1754/1754**, the same count as the full `npm test` on `a359f38` (code identical to `c9676dd`).

Secret scan of the evidence output: token/secret/password appear only in test names; temporary paths only.

Boundary (not proven by these checks): a real PL run with a real claude (question and draft quality), real Mac Offices over a real Hub, real GitHub base branches and rulesets, the OpenShift Hub, two people's Macs; V3/V9 real CLIs, V4 real VM sandbox, V5/V6, V10/V13/V14/V18/V19 real GitHub/OpenShift (kit-checks.md boundary).
