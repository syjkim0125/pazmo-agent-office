# U42 verify attempt 1 (HEAD 8e241f7)

Graph `verify` on the started token, checks run one after another (no other test run; load 15–24):
- tests-1of3: exit 0, 571/571 (66 s) — receipt .ai-workflow/evidence/ad41a05a-9ca1-4a56-93be-899159faadf6/4df2703b-6148-4f69-b234-c892cd647c98/receipt.json
- tests-2of3: exit 0, 636/636 (146 s) — receipt .ai-workflow/evidence/ad41a05a-9ca1-4a56-93be-899159faadf6/875cab03-f7a9-407d-8f5d-6773bcbc7cf0/receipt.json
- tests-3of3: exit 0, 655/655 (95 s) — receipt .ai-workflow/evidence/ad41a05a-9ca1-4a56-93be-899159faadf6/eb6fc96e-0ff1-4137-b460-919fc2cf0d90/receipt.json
- typecheck: exit 0 — receipt .ai-workflow/evidence/ad41a05a-9ca1-4a56-93be-899159faadf6/70f84b0e-2bba-42e4-bb1d-dbb5e6102fe3/receipt.json
- story: exit 0 (PASS) — receipt .ai-workflow/evidence/ad41a05a-9ca1-4a56-93be-899159faadf6/3e70543c-553e-4566-885f-36e275e2a187/receipt.json
Total 1862/1862. The once-flaky "upload again after a push failure resumes" passed in 21.3 s inside its shard; the new "every upload call reaches the Hub …" passed in 1.2 s.
Limits: one loaded run is not proof the flake can no longer happen in the suite; the cause and fix are shown by the deterministic reproductions in U42-implement-1/2.
