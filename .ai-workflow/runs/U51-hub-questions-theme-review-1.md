# U51 review 1 — D45: plan page readability, team PM question wording, 다크 모드 switch

Diffs reviewed: `9dfed5b..83c1eab -- docs/understanding` and `83c1eab..16d1c11`.

**Verdict: Not ready.** One Important finding: a PL answer that contains " → " is shown cut short on the draft. The fix is small. Every other invariant held in my checks.

## Important

**I1 — A PL answer containing " → " is split in the wrong place.**
- **Where:** `src/hub/plan-pages.ts:224`. `docWords` splits an Office `PL 답: <question> → <answer>` decision with the greedy regex `/^PL 답: (.*) → (.*)$/`.
- **What happens:** the split falls at the last arrow, so an arrow inside the answer moves part of the answer into the folded question.
- **Example (direct render):** the line `D1. PL 답: 어떤 순서로 처리할까요? → 결제 → 환불 순서로` shows the bold answer "PL 답 **환불 순서로**". The "결제" part sits inside the closed "질문 보기" fold.
- **Who is misled:** the PL approving the draft, and teammates reading it. Arrows are common in this team's Korean answers.
- **Why a lazy regex is not enough:** it breaks the opposite case, an AI question that contains an arrow. Example: `상태 흐름(대기 → 완료)을 그대로 둘까요? → 네` currently renders correctly and would then split wrongly.
- **Fix:** split using the plan's own rounds. A line equal to `PL 답: ${oneLine(q.text)} → …` for a known question `q` splits right after that question. Otherwise show the line as written. Add a test with an arrow in the answer and one in the question.
- No word is lost; the raw text and its approval hash are correct.

## Minor (acceptable to ship)

1. **Option lines lose their separating spaces.** `src/hub/plan-pages.ts:310-317`. `optionLines` trims the text before and between the "(a) …" options. The page looks right because each option is a block. But the text a screen reader or copy-paste gets becomes "예를 들어(a) 승인만,(b) 취소까지,".
   - The closing question clause also stays in the last option's indented line, so it looks like part of option (c). Example from the real data's pattern: "(c) 조회까지 중 어디까지 필요한가요?".
   - No word changes. The new PM instruction makes this less likely in future questions.
2. **A theme chosen in another tab does not reach an already-open live page.** live.js swaps only `<main>`, so the `<html data-theme>` attribute and the header switch stay as they were until the page is reloaded. The etag differs per theme, so nothing breaks.
3. **Known cost:** the phone header is now 2 rows, 105px at 320 and 390 (65px at 1360).

## What I verified, and how

All checks were read-only in the worktree (HEAD 16d1c11; only the U51 run files are untracked). Hubs were reached by GET only, and only on the preview copies.

**The Story change (D45 and V20).** D45 matches the request quotes. V20 gains the D45 test sentence. The G1 line is re-dated 2026-11-18.

**Behaviour.** I compared before and after with the same data:

| Data | Before | After | Plan states | Viewers |
|---|---|---|---|---|
| Real copy | 18573 | 18571 | questions, draft, cancelled | pl, a |
| Demo | 18574 | 18572 | 6 states | 4 viewers |

- For all 30 combinations of state and viewer, the forms (actions, revision, gate, hash, required fields, confirm) are identical.
- On every draft and design, every content line of the raw text appears on the page. "PL 답" lines were checked as question plus answer, with nothing missing.
- The approve hash equals the sha256 of the "원문 그대로 보기" text, including the 4,002-character real draft.

**Escaping.** HTML in a question, a reason or an answer is escaped, in both open and answered rounds. So are the dtitle, the refs and the ⓘ text.

**The theme route.**
- It runs after the global Origin check (server.ts:170) and the CSRF check (:205).
- Only `dark` or `light` is accepted; anything else is a 400.
- An unsafe `back` address falls back to `/`.
- The cookie is `Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`, the same flags as the session cookie.
- The tests pin these, plus the 403 on a bad Origin and the 403 without CSRF.
- The only dark-specific CSS is the token block plus the switch's visibility, so there is no leftover dark rule elsewhere in the stylesheet.

**Theme matrix in a browser.** 162 runs, all clean. That is the device setting (light, dark) × cookie (none, light, dark) × width (320, 390, 1360) × 9 pages, across the real copy and the demo:

- the page's background follows the cookie, or the device setting when there is no cookie;
- exactly one switch is visible, and it reads pressed when dark is in effect, with its form sending the opposite value;
- nothing drawn past the edge and no sideways scroll;
- no small targets with touch on, and no duplicate ids.

**Class names.** I listed every rule for the new classes. Clashes: `.count` takes the existing pill style inside `.doc h3`, and `.doc h3 .count` overrides the font, which is intended. `.past` is also used by the steps bar, but those rules are scoped to `.steps`. No other overlaps.

**Reverts.** I broke one thing at a time on a scratch copy and ran the plan-pages, board-page, design-invariants and team-planning test files. Each of these 12 breakages failed at least one test:

- the PL-answer reorder removed;
- the option split removed;
- the bold on the asking sentence removed;
- the counts dropped from the card;
- the Story title dropped;
- Why moved out of the ⓘ;
- the form-less view for other members replaced;
- the theme not applied to pages;
- the route's value check removed;
- light ignored on a dark device;
- the cookie without HttpOnly;
- the PM instruction dropped.

The team-planning file needs the full copy (its role profiles). There it passes 15/15, and 14/15 with the PM line dropped.

## Coverage limits

- I did not run the whole suite.
- Safari, Firefox and screen readers were not checked.
- I did not POST `/me/theme` against a live hub; the route was checked through its tests and the code.
- The questions page was seen with real data that has no "?" or option markers. The option and bold rules were checked by direct render.
- I did not touch 18444, `pazmo-midcheck` or the main checkout.
