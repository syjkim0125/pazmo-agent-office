# U25 workflow-verify — attempt 1

Fresh checks after the last code change (3bfb30a); later commits are docs only (c4f31ec).

- Full suite at 3bfb30a: 1072/1072 exit 0 (117.6 s, run alongside another session's full suite). typecheck (root tsc) exit 0. Story checker exit 0.
- Baseline 3926ee2 (vendor installed and built): 1104/1104. Difference: 34 tests in Claw/legacy/bridge-only files or legacy lifecycle tests removed (listed with reasons in docs/verification/2026-10-30-lean-office-default.md), +1 lean-schema, +1 lifecycle (old-version Office), +1 lifecycle (reuse-path), +1 launcher (packed install); delivery test count unchanged (one replaced).
- Fresh copy outside the main checkout (45078a1, npm ci only, no vendor): 1070/1070, typecheck exit 0.
- Upgrade check: a 3926ee2 checkout with vendor installed and built moved to 45078a1 has a clean git status (vendor/ ignored); start before the root install -> NOT_INSTALLED; npm ci --omit=dev installs only ws; start/status/stop lean; <dataDir>/claw/ hashes and mtimes unchanged.
- Reuse check at 91d9a27 (fresh copy without node_modules, fake controller): ready lean Office -> up reuses it and installs ws first; locked -> RUNNING, nothing installed, no stop call.
- git ls-files vendor: 0; no .gitmodules; npm pack --dry-run has no vendor or node_modules entries; local branch codex/local-original-claw-v2.0.4 intact (bc5120d).
- Not verified: app-be real run with ./office (V17), the two pre-checks (in-flight Claw tasks, in-flight OpenShift hub requests), other people's PCs, a first run without network.
