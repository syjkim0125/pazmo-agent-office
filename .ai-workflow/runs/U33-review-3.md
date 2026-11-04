# U33 workflow-review, attempt 3, the last (D39 Minor follow-ups)

- **Allocation:** one focused reviewer, the same read-only subagent as attempts 1 and 2, resumed with its context. It said it ran as Opus 5.5; host metadata did not confirm the model.
- **Scope:** commit `a4209a0` (`git diff 4a00f25 a4209a0`), the verify attempt 1 fix and the docs it carries.
  - At the end, HEAD was still `a4209a0` and the status was unchanged.
  - Throwaway worktrees at `a4209a0` and `4a00f25` were removed.

## Verdict

"Ready to merge: Yes". Critical 0, Important 0, Minor 1 (doc wording).

## Minor finding

1. **The learning doc's "Why" bullets state the cause as fact:**
   - The file is `docs/solutions/test-failures/rewrite-a-fake-cli-script-not-its-executed-binary.md`. It says the overwrite modifies the same vnode and "macOS's code-signing check" kills the later exec.
   - The trigger is well supported, but the code-signing part is not confirmed. The unified log kept no kernel entries for the stress windows.
   - STATUS, the change record and the helper comment only say macOS SIGKILLs the next start, which matches the evidence.
   - Fix: "likely macOS's code-signing check (not confirmed from the kernel log)".

**Nit in the author's evidence:** `U33-implement-3.md` says the runner-models and claude-controller `fakeNative` calls "overwrite before the first run". They never overwrite: each creates a fresh path. That evidence file is recorded and stays as is, and this note corrects it.

## Confirmed by the reviewer

- **The helper keeps each test's intent:**
  - It writes exactly the script the shim runs (the shim's realpath plus `.sh`).
  - The native file is untouched, so the sha256 is the same by construction.
  - The real `loadRunnerCatalog` path runs with both failed and answered listings.
  - Nothing reads the script while it is rewritten.
  - A helper mutant that writes `claude.sh.unused` fails exactly the three helper tests (19/22).
- **Earlier mutants, re-run with the new helper, still caught:**

  | Mutant | Result |
  |---|---|
  | Old empty-models proxy | 21/22 |
  | Keep the old hint | 20/22 |
  | Never set the mark | 20/22 |
  | Earlier login for the hint | 21/22 |
  | Drop the sha guard | 21/22 |

- **The trigger, probed directly** with the fixture's `fakeNative`, 10 at a time:

  | Case | Result |
  |---|---|
  | Run, copy the shim over it, run again | 283/300 and 277/300 ok. Every failure was `{code:null, signal:"SIGKILL"}`. |
  | Run, rewrite only `.sh`, run again | 300/300 ok |
  | Overwrite before the first run, then run twice | 600/600 ok |

  - This confirms the docs' claim about the other `fakeNative` callers.
  - The reviewer could not reproduce the old test failure itself at load 2–5: the old helper passed 60/60 at 10 parallel and 60/60 at 20. The author's 4/60 was at load about 12. The probe reproduces the trigger directly.
- **Stress at `a4209a0`:** 60/60 runs had 3/3 passing.
- **Docs:**
  - STATUS and the change record are accurate: the related-set wording, the lean Office follow-up's three readers, and the verify-failure bullet.
  - The kit bullet matches `snapshot.mjs`, `cli.mjs:183` and `.gitignore`.
  - The frontmatter uses existing vocabulary, and the links resolve.
  - Hygiene: nothing new.
- **Other runs at `a4209a0`:** runner-settings 22/22, `tsc` exit 0, `check.mjs story` exit 0. No src change since `4a00f25`.

## Not checked by the reviewer

- the full suite (left to verify attempt 2)
- a real claude CLI
- `createLiveRuntime`'s role job path
- the kernel log for the kill mechanism (not retained)

## Routing

Recorded as passed, as the reviewer concluded. This is the node's last attempt, and the finding is one sentence of doc wording.

- It will be corrected in the delivery commit after G4, together with the kit outputs and the STATUS G4 line.
- The G4 explainer and the PR say this, and they say that the correction is not covered by a kit review or verify.
