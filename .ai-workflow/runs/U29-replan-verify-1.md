# U29 (after merging main #50–#56) workflow-verify — attempt 1

Fresh on `957ec6e` (after the final review fix wave), one test run at a time:

- `npm run typecheck`: exit 0
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: PASS, exit 0
- `npm test`: exit 0, tests 1275, pass 1275, fail 0, cancelled 0, skipped 0, 116.6 s. Against the merge with main (1216 after the alias fix-up `62c85f7`) the difference is +59 tests from Tasks 8–9 and the final fixes.
- `git grep -i` for the internal names main's #48 replaced: 0 files at HEAD.

Changed-file scope against origin/main `43d18f6`: 43 files, +10052 −404 — `src/team/*` (new executor.ts, branch.ts, pr.ts, story-contract.ts; store, scheduler, office, registry, story-link), `src/hub/story-store.ts` and `link-api.ts` (open Task on claim), `src/hub/story-protocol.ts` (shared PR URL check), `src/runtime/native-office.ts`, `live.ts`, `team-service.ts`, `src/core/verification.ts`, `src/lean/office.ts`, `src/cli/{index,team,lifecycle}.ts`, their tests, the plan, LOCAL-PREVIEW, STATUS, the Story contract (D34, M16, V18), the verification record and one solutions doc.

Not proven here: a real run against a local Hub, a GitHub test repo (not a bare remote) and the VM (real `gh` output shapes, `gh pr create -R` from the Office's cwd, PR head timing after a push, the Docker verifier, merge commits allowed by the repo, "Commit suggestion", a closed PR, a cancel during a re-check — the real-check plan in `docs/verification/2026-11-02-team-story-task-mode.md`), other people's PCs, the 30 s live start with real repos, and G4 (human-owned).
