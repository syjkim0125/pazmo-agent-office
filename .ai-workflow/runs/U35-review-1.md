# U35 review, attempt 1

Allocation: 1 independent reviewer (general-purpose subagent, read-only, direct bounded review), because the change is one condition plus tests and docs (small: 0–2 per skill-integration). The reviewer saw the diff and the Story, not the controller's conclusions.

## Reviewer report (verbatim)

# U35 review 1 (D40, claude rediscovery before every role job)

**Ready to merge: Yes**, with the Minor findings below. There are no Critical or Important findings. Fix the STATUS count before G4, and say the freshness limits in the G4 explainer.

## Correctness (checked by reading the code)
- Every claude role job goes through `roleJobFactory().supervise`. That covers pm and lead (PlanningCoordinator), engineer and reviewer (OfficeCoordinator), the G4 evaluation (`roleJob("reviewer")` in UnderstandingRunner), and team Story Tasks (the same lean/native runtime). `src/runtime/runner-jobs.ts:69` now always calls `rediscover` for claude. The fresh install is what the code checks for readiness, binary change, qualification and the job selection. Nothing else calls `claudeJob`.
- The pinned codex early return (`:47`) is untouched. A ready, unchanged codex is not rediscovered. The D39 paths behave as before: refusal, `UNVERIFIED_CONTROLLER_BINARY`, and failed discovery.

## Findings
1. **Minor: the in-flight discovery is shared, so it can return a result from before the hook** (`src/lean/office.ts:206`). PROBE-A (scratch copy of lean-office.test.mjs): the screen's `runners()` discovery starts, a hook appears, the claude job starts and joins that flight. Result: `error: null`, jobs `["claude"]`, no discovery of its own. The window is about one discovery (1–2 s). The verification doc says only "진행 중인 탐색만 함께 쓴다" and does not give this consequence.
2. **Minor: the team Office's "fresh" check is not always fresh** (`src/team/office.ts:202`). It reuses the shared discovery for up to 5 s, and for any age while `hold(true)` during start. A run resumed during start counts too (lean `native.refresh()`). M16's "claude는 역할 실행마다 새로 확인한다" and D40's "조회 한 번" cost are therefore broader than the team behavior. The verification doc discloses this. STATUS gives the 5 s but not the hold. I read this in the code and did not test it.
3. **Minor: a cancel during the rediscovery is not prompt.** `rediscover` takes no signal, so a cancel or stop waits for the whole discovery, which is bounded only by the probes' 10–15 s timeouts. Afterwards `qualify` is still called with the aborted signal. PROBE-B: fresh-ready gives `CANCELLED` (qualify 1, claude 0); fresh-blocked gives `RUNNER_NOT_READY claude: hooked` instead of `CANCELLED`. Claude never starts, and `storyOutcome` checks for a cancelled task first. Before this change the wait applied only to not-ready installs; now it applies to every claude job. There is no test, and the docs do not mention it.
4. **Minor: pm and lead are not pinned by a test.** A mutant that skips the rediscovery for pm and lead survived (74/74).
5. **Minor: wrong test count in `docs/STATUS.md`.** It says "새 시험 5개와 고친 시험 1개". The change has 6 new tests (3 in runner-jobs and 3 in lean-office, the `for` loop makes 2) plus 1 changed. RED 17/20 and 51/54 means 6 failures. The verification doc's list (1–7) is right.
6. **Minor: the G1 binds text the user did not see.** `.ai-workflow/approvals/pazmo-agent-office-g1.json` binds hash `1b507999`, which includes a V18 clause the user did not see. The record marks it ASSUMED. Show it at G4.

## Evidence (Node 24.19.0)
- runner-jobs 20/20, lean-office 54/54 (exit 0).
- The 8 other related files: lean-agents 15/15, lean-server 29/29, native-story-task 19/19, runner-settings 22/22, team-gate 9/9, team-office 27/27, live-runtime 17/17, runner-account 9/9. Total 221/221, which matches the claim.
- `tsc -p tsconfig.json` exit 0. `check.mjs story` PASS, exit 0.
- `graph.mjs status U35-claude-job-recheck.json` exit 0, so G1 is bound to the Story fingerprint. The run file was unchanged.
- U35 evidence hashes match the current files.
- Mutants, run on a scratch copy against the 74 tests of the two files:

| Mutant | Result | Caught? |
|---|---|---|
| pre-fix condition | 68/74 | yes, the 6 new tests fail (RED confirmed) |
| always rediscover | 72/74 | yes |
| skip for reviewer | 71/74 | yes |
| skip for engineer | 70/74 | yes |
| skip for pm/lead | 74/74 | **no, survived** |
| ignore the discovery result | 63/74 | yes |
| failed discovery refuses | 72/74 | yes |
| once per task | 68/74 | yes |

- The worktree diff is unchanged: `git diff --stat` still shows 9 files, +121/−22.
- Docs: D40's description of `keptClaudeBlock` and the failed-discovery fallback, the 13 hook runs over 6 h (no hook runs added for an already-blocked claude), the `CODEX_PERSONAL_INSTRUCTIONS` claim, and the edits to the learning doc and the U34 verification doc all match the code.

## Not checked
- A real claude, and the 1–2 s cost.
- The team Office path by test: the TTL and hold reuse I only read in the code.
- The explainer artifact's content.
- The full `npm test`.

## Disposition (controller)
- Accepted; the verdict is Ready to merge: Yes, and the controller fixes some Minors before verification, so this round is recorded as `fix` and `implement` is reset (attempt 2).
- 1 (in-flight discovery shared) and 2 (team TTL/hold): documented as residuals in the verification record and STATUS; no code change (the window is about one discovery; a strict fresh discovery would change the lean and team discovery sharing that D39/U34 rely on).
- 3 (cancel during the rediscovery): add `CANCELLED` right after the rediscovery when the job's signal is aborted (a cancelled job no longer reports `RUNNER_NOT_READY`), test-first; making the discovery itself abortable stays a documented residual.
- 4 (pm/lead not pinned): the hook-refusal unit test runs every executing role.
- 5 (STATUS count): fix to 6 new tests and 1 changed.
- 6 (G1 binds the ASSUMED V18 clause): shown at G4.
