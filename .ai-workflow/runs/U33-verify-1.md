# U33 workflow-verify, attempt 1 (D39 Minor follow-ups)

- **Code:** HEAD `4a00f25`, run snapshot `5fca643b15849603aad2862992f06fb43ffc9aa2e219ef57befa7d236d00b029`. Node 24.19.0.
- **Ran:** `graph.mjs verify` for each check, one at a time, with no other test run on the machine. The load average was about 12 at the start, from system processes.

## Results

| Check | CLI exit | `verification.passed` | Count | Time |
|---|---|---|---|---|
| `tests-1of3` | 0 | true | 441/441 | 50 s |
| `tests-2of3` | 0 | true | 448/448 | 45 s |
| `tests-3of3` | 0 | **false**, exit 1 | **431/432** | 71 s |
| `typecheck` | 0 | true | exit 0 | 2 s |
| `story` | 0 | true | exit 0 | 0 s |

The receipts and logs are under `.ai-workflow/evidence/ac22429a-e57b-44c5-8595-4c2d73ff25f4/`. The failing shard is `403cf823-…/stdout.log`.

## The failure

The failing test was the new "a block kept over a failed listing gives the login cue for claude's login now (D39 follow-up)" (`tests/runner-settings.test.mjs:229`). It failed with "a failed listing never unblocks claude": actual `undefined`, expected `'SessionEnd hook (policySettings)'`.

### Diagnosis

The diagnosis ran in a throwaway worktree at `4a00f25` with logging added, and the test ran 10 at a time.

- **Reproduced:** 4 of 60 runs failed.
- **Where it breaks:**
  - In each failing run, the second discovery (after `rewriteClaude`) found claude `unsupported`, with the hint "claude 버전을 확인할 수 없습니다".
  - So there was no listing and no `claudeUnlisted` mark, and the block was correctly not kept.
- **What killed it:** the logged `--version` result was `{"exitCode":null,"signal":"SIGKILL","timedOut":false,"error":null}`. The process was killed at once. It did not time out.
- **Cause:**
  - `rewriteClaude` called `fakeNative`, which `copyFileSync`s the compiled shim over the fake's executable. The shim had already run: the first discovery started it for `--version`, `auth status` and the listing.
  - Overwriting an executed Mach-O in place lets macOS sometimes SIGKILL the next exec of that file, even with identical bytes. This is the kernel's code-signing check of a modified vnode.
  - The older test "a claude whose model discovery fails" overwrote the file before its first run, so it was not exposed.
- **Fix tried in the throwaway worktree:** `rewriteClaude` writes only the `claude.sh` script that the shim runs. The binary, and so its sha256, is never touched. Result: 0 of 60 runs failed, covering the three tests that use the helper (60 passing summaries).

## Evaluation

The verify node failed with `fix`. The defect is in the new test helper, not in the production code. `implement` is reset for the fix.
