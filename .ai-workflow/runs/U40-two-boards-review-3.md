# U40 two-boards · workflow-review (attempt 3)

Reviewed: `8a42da8..0d3baab` (fixes for review 2), with `U40-two-boards-review-2.md` and `U40-two-boards-implement-3.md`. Allocation: 1 direct bounded reviewer (last attempt, narrow scope), read-only, model inherited.

## Reviewer F — verdict: Ready (Minor only)

- Review-2 Minor 1 fixed: rendered `/?cancelled=1` — merged + cancelled "Task 2개 취소됨 · 1개 끝남"; cancelled from 승인 대기 "Task 2개 끝남"; 7 merged then cancelled "Task 2개 취소됨 · 7개 끝남" (`doneMore` counted); 6 merged then cancelled from 승인 대기 "Task 7개 끝남"; nothing done "Task 3개 취소됨"; same with `mine=1`. `cancelStory` leaves every Task hidden or done, so the numbers add up.
- Minor 2 fixed: ✓ on one line beside the label at all widths (32 px desktop, 42 px phone), no overflow at 390 px.
- Minor 3 fixed at the asked widths: 10 pages × 390/900/1000/1360 × light/dark with 기획 중 shown — five columns in one row at ≥900 px, no page wider than the window.
- Tests `hub-board-page` 37/37; new tests pin what they claim; nothing weakened; CSS change is layout only.
- Remaining Minor: (1) between 861 and 887 px 완료 still wraps alone (stages box 821–845 px, five columns need 848 px) — the change record says the 861–1087 band is fixed; (2) 888–~950 px the "Story 검증 중" pill breaks before "중"; not from this diff: a cancelled Story's own page reads "Task 1개 중 1개 끝" while its card reads "Task 2개 취소됨 · 1개 끝남".
- Upload-test failure: agrees it is pre-existing and load-dependent — since `a72a57b` the server diff only changes the HTML routes `/`, `/tasks`, `/stories/:id`; `src/team`, `link-api.ts`, `hub-link.ts` and the TLS keep-alive settings are unchanged; the test's synchronous git helpers can block > 5 s between the two uploads, so the second reuses a keep-alive socket the server is closing → `ECONNRESET`.

## Evaluation

Passed: no Critical or Important findings remain across three review rounds; the remaining Minor items (the 861–887 px wrap and the change-record wording, the pill wrap, the cancelled Story page count) and the upload-test flake are recorded for STATUS as follow-ups. Main did not change code after this review.
