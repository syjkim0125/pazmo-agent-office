# U50 review 1 — Story creation flow (`4a4aa8a..71b4533`)

**Verdict: Not ready.**

Behaviour is unchanged. For every plan state and every viewer the forms are identical before and after: action, revision, gate, hash, required fields and the confirm checkbox. `server.ts` and `plan-store.ts` are untouched, and the approve hash matches the raw text shown.

Two things are wrong on screen:

1. Every high-risk plan draws its 6-step bar on two rows.
2. The rendered draft and design can drop or change lines that the approval binds.

## Important

### I1 — High-risk plans draw the steps bar on two rows

- **Where:** `src/hub/pages.ts:83` (`.plansteps{display:flex}`), overridden by `:188` (`.steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}`).
- **Why:** both rules have the same specificity, and `.steps` comes later, so it wins.
- **Measured on 18572:** on the awaiting_g3 plan the bar computes to `display:grid`, 5 columns, 6 items, 2 rows, at both 390px and 1360px.
  - "보드에서 시작" sits alone on a second row under "하고 싶은 일".
  - On a phone, a stray sixth bar sits under the first.
  - Normal-risk plans (5 steps) are fine.
- **Who is affected:** every high-risk plan, at every width, for everyone.
- **Not caught:** the tests check only the markup; the change record's 80 browser runs measure overflow, not rows.
- **Fix:** use `.steps.plansteps{display:flex}`, or set the column count from the number of steps. Add a style test.

### I2 — `docBody` drops or rewrites lines anywhere in the draft or design, not only the kit header

- **Where:** `src/hub/plan-pages.ts:230` and `:241`.
  - Line 230 drops any line starting `# `, `Status:`, `Owner:` or `Understanding gate…:`, wherever it appears.
  - Line 241 treats any line starting with digits plus `. ` as an ordered-list item.
- **What a PL would see (direct render):**
  - A Goal of "2026. 12. 1.부터 생일 쿠폰을 자동 발급한다." renders as `<ol><li>12. 1.부터 …</li></ol>`. The page shows "1. 12. 1.부터 …": the year is gone and the date reads differently.
  - A Domain of "# 회원 혜택 영역" disappears, leaving an empty 영역 heading.
  - Goal and Domain lines, and a design's plan line, starting with `Status:` or `Owner:` also vanish.
- **Why it matters:** the PL approves the page they read, but G1 and G3 bind the raw text, which is folded under 원문 그대로 보기.
  - Goal, Domain and the design's plan are free single-line model text (`planning.ts` `text()`), so a Korean date at the start of a Goal is plausible.
- **Fix:**
  - Drop only the first `# ` title line, and the Status/Owner/Understanding gate lines that come before the first `##`.
  - Treat `N.` lines as list items only after a list or a heading's first item, or require `N.` to be a small number.
  - Add tests for these lines.

## Minor (acceptable to ship)

1. **"위" points the wrong way.** `plan-pages.ts:34`. `G3_NOTE` says "이 설계와 위 [올라갈 Task 전부 보기]…". In the new card the fold is below that sentence, and the 설계 section is below the card. It should say "아래".
2. **A cancelled plan's step ignores its approvals.** `plan-pages.ts:110`. Direct render:
   - normal, cancelled while splitting after G1, reads "3/5단계 · 초안 확인" (it was at Task로 나누기);
   - high, cancelled after G3, reads "설계 확인";
   - high, cancelled after G1 with no design yet, reads "초안 확인".
3. **Test gaps.** I made one change at a time on a scratch copy and ran 6 Hub files: 153 pass at baseline, plus 3 `hub-plan-office` tests that fail even unchanged because they need Node 24 on PATH for spawned processes. These changes did not fail any further test:
   - `stepOf` for failed, cancelled, splitting and open;
   - the refusal line for a blocked G3 removed;
   - the failure hidden from members who cannot retry;
   - the open questions hidden from other members;
   - the design shown only as raw text;
   - a duplicate split fold in the 설계 section;
   - `for="intent"` removed;
   - `aria-describedby` removed;
   - the phone step names set to `display:none`, which removes them for screen readers.
4. **The textarea's description includes the ⓘ button's name.** `plan-pages.ts:128`. The described paragraph contains the ⓘ button, so the description reads "평소 말로 적으세요. 하고 싶은 일 설명". Describe a span with only the hint text.
5. **`OPEN BLOCKING` display and the store disagree.** "- D1. OPEN BLOCKING: …" shows as 꼭 정해야 함, but the store's `hasOpenBlocking` does not block it, so the PL can approve it. The planner never writes such lines, so this is an edge case.
6. **Nested lists are flattened** (the content is kept).
7. **Answer boxes don't name their question (pre-existing).** Each is labelled only "답 (4000자까지)". An `aria-describedby` pointing at the question would help screen readers.

## What I verified, and how

All checks were read-only in the worktree (HEAD 71b4533; only the U50 run files are untracked).

**Forms: before (18573) vs after (18572) on the same data.**

| Viewer | States | Forms | Ids |
|---|---|---|---|
| pl, mj, admin | questions, draft, awaiting_g3, failed, splitting, queued | Identical: answer (Q1–Q3 required), G1 or G3 approve with hash, rewrite (note required), retry, cancel (confirm required). Revision is on each. | One `decide` only for the PL; no duplicate ids |

The approve hash equals the sha256 of the 원문 text shown, for both G1 and G3.

**Cards.**

- The PL's actions all have a card: answer; draft yes, open-blocking, not-owner and repos-changed (rewrite is always allowed for the PL there); G3 yes; retry.
- A blocked G3 shows the refusal in the head. Cancel is folded at the bottom.
- Others and the admin get no card. They see a blue pill, "PL의 … 기다립니다", and the current questions, draft, design or failure read-only. The admin keeps cancel.

**Steps.** I rendered 21 state, risk and history combinations directly; all are correct except the cancelled cases in Minor 2.

**docBody.** Edge cases: nested lists, code fences, a `#` at the start of a paragraph, Korean dates, `OPEN BLOCKING` with an id, and escaping (script, `<b>` in a heading).

- Everything is escaped.
- The losses are listed in I2.
- The demo draft renders fully, and its ASSUMED box has 2 items.

**Browser.** 78 runs: 6 plans as pl and mj plus the new-Story page as pl, at 320, 390 and 1360px, in light and dark. Folds were open.

- Nothing drawn past the edge, no sideways scroll, no small targets with touch on, no duplicate ids.
- The ASSUMED box contrast is 14.5:1 in light and 11.6:1 in dark.
- On phones the step names are visually hidden but stay in the accessibility tree, and "N/M단계" shows.
- The accessibility tree has a "위험도" group with 2 named radios, and the textarea is named "하고 싶은 일".

## Coverage limits

- Safari and Firefox were not tried, and no screen reader was used.
- The whole suite was not run.
- I did not see in a browser a failed plan from design or splitting, a cancelled plan, or an open plan; these were rendered directly.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
