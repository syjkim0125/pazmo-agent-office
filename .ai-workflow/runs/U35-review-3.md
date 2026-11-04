# U35 review, attempt 3 (docs only)

Allocation: the same 1 independent reviewer, read-only with no temporary edits, scoped to the docs changed in implement attempt 3.

## Reviewer report (verbatim)

# U35 review 3 (docs only, read only)

**Ready to merge: Yes.** No Critical or Important findings.

I modified no repo file. `src/` and `tests/` are byte-identical to the round-2 copy (`diff -rq`).

## Checked against the code (all accurate)
- **The cancel bullet** (`docs/verification/2026-11-04-claude-job-recheck.md:35`, `docs/STATUS.md:11`):
  - With the guard, a cancelled run skips qualification (`runner-jobs.ts:78`).
  - `superviseRemote` already reported CANCELLED (`remote-job.ts:28,56-65`).
  - The codex half is the same in the code and is disclosed as untested.
- **The cancel-delay residual** (`verification:100`, `STATUS:24`) gives the right numbers:
  - probes 10 s, codex listing 15 s, claude listing 15 s plus a stop of 3+12+2 s (`runner-discovery.ts:101`, `runner-models.ts:39,48,158`);
  - 18 s of grace (`remote-job.ts`);
  - `closed:false` leading to `PROCESS_LIVENESS_UNKNOWN`, which is used by the engineer, planning, understanding and coordinator paths.
- **Counts:**
  - 7 new tests and 1 changed; the first 6 RED at 17/20 and 51/54.
  - After the fix 21/21 and 54/54, 222/222 across the 10 files.
  - The 6 mutant rows and the 4 reviewer mutants all match my runs.
- **Round-1 Minors 1, 2, 6:** stated accurately at `verification:86-87,98-99` and `STATUS:18,22-23`.

## Minor findings
1. **Forward references** (`STATUS:16-17`, `verification:78,91`).
   - `.ai-workflow/runs/U35-review-3.md` and `U35-verify-1.md` do not exist yet.
   - `STATUS:17` says the verification results "are in" that file, in the present tense.
   - Make sure both files land at exactly these paths.
2. **The round-2 summary misnames one Minor** (`verification:88`: "Minor 2, 둘 다 문서 문구다").
   - Round-2 Minor 1 was a test gap: the "guard for claude only" mutant survived. It was settled by disclosing it, not by fixing wording.
   - `verification:90` and `STATUS:16` ("문서만 고침") describe it correctly, so only this one summary phrase is off.

## Not checked
- Re-running tests in this round.
- The existence of the review-3 and verify-1 files after this round.

## Disposition (controller)
- Ready to merge: Yes; recorded as passed.
- Minor 1 (forward references): this file and `.ai-workflow/runs/U35-verify-1.md` are written at exactly those paths in this run.
- Minor 2 (the round-2 summary calls both Minors wording; Minor 1 was a test gap settled by disclosure): left as is in this run; to be corrected after kit verification as a disclosed doc edit outside the kit review, like U33's delivery commit.
