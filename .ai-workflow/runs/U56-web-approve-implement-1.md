# U56 implement attempt 1 — web result approval with a QA list, run steps and an AI prompt (D49)

- Story: D49 and one V20 sentence. G1 recorded twice the same day: b8321b4 (web approval, QA list, prompt), then
  1718780 (the prompt asks for a visible Playwright browser and screenshots; an AI-written or AI-run QA is the next
  bundle with D41). Story hash 31be3d3a….
- Base: main d256fc6. Code commit: 3f57ad0.

## Changes
- **New `src/hub/story-approve.ts`** (no AI; plain text the page escapes)
  - `storyItems(body)`: `- M…` lines under `## MUST`, `- V…` lines under `## Verify`; none for a free-text Story.
  - `compareUrl(remote, base, commit)`: `https://host/owner/repo/compare/<base>...<commit>` for a host/owner/repo
    remote only; null otherwise.
  - `shellLine(argv)`: quotes an argument only when a shell would split or expand it.
  - `approvalPlan(...)`: QA items (MUST "— 동작하는지", Verify "— 이 장면 그대로인지", Task ASSUMED "— 이대로
    괜찮은지"; a fallback item for a free-text Story; 30 per kind, the rest counted), touched files per repo, run steps
    per repo (fetch, detached switch to the checked commit, Story check commands), and the prompt: no code changes,
    per-item 통과 / 실패 / 확인 못 함 with evidence, a Playwright browser the PL can watch with screenshots when there
    is a web screen, and "승인은 사람이 합니다".
- **Store** (`story-store.ts`)
  - `FinishApproval` gains `via: "web"` and `by`; a web approval keeps `macId: null`, `macName: "웹 승인"`.
  - `approvalView(actor, storyId)`: only the PL, only at awaiting_g4 before an approval; fingerprint, verified
    commits (null offers 다시 검증), Story checks and repo remotes.
  - `approveOnWeb(actor, storyId, {fingerprint, commits})`: PL only (admins and others FORBIDDEN), awaiting_g4,
    verified commits needed (STATE), commits shape INVALID, fingerprint or commits not current STALE (nothing
    recorded). Record hash = sha256 of (web, Story, fingerprint, commits, PL): a double click answers `already`; any
    approval over another is STATE, so the first of web and `team finish` wins. Event `approved` "web · name".
  - `recheckStory` takes any actor (the web passes the session's member).
- **Web** (`server.ts`, `story-pages.ts`, `pages.ts`, `copy-script.ts`, `board-pages.ts`)
  - `POST /stories/:id/approve`: needs the confirm box (400), JSON commits (400), then `approveOnWeb`; 303 back.
    Origin and CSRF as every POST.
  - `POST /stories/:id/recheck`: `recheckStory`; a double click (Story already open) also returns 303.
  - Story page for the PL: a `결과 승인` card (class decide) with the check result, Task 3-line summaries and ASSUMED,
    compare links, QA list, touched files, run steps, the prompt in `<pre id="approve-prompt">` and a `copy-only`
    copy button, then the form (hidden fingerprint and commits, required box, "승인하고 main에 머지"). The separate
    check section is not repeated for the PL. Without commits the card has the 다시 검증 form instead.
  - `copy.js` marks the page `copy`; CSS hides `.copy-only` without it, so without a script the prompt is a selectable
    box with no dead button.
  - Wording: PL "모든 Task가 끝났습니다. 아래 결과 승인 칸에서 확인하고 승인하세요."; others "… PL이 결과를
    승인하면 레포마다 main에 머지됩니다."; the board's box "… Story 화면에서 결과를 확인하고 승인하세요.".
    The approval line reads "웹 승인 · PL 이름 · 시각" or "결과 승인 · Mac 이름 · 시각".
- **Docs**: `skills/pazmo-hub-finish/SKILL.md` says the web card is the other path (first approval wins);
  `docs/LOCAL-PREVIEW.md` describes the card.

## Tests (TDD)
- RED: `u56-red-1` — the four touched files, 137/147 (10 failing: the new module missing, the store methods, the
  card, the routes, and the changed wording).
- GREEN: same files 151/151; Office merge of a web approval over a real Hub added to `team-story-finish` (16/16);
  full `npm test` 2044/2044, exit 0; `tsc -p tsconfig.json` exit 0.
- New tests: `hub-story-approve` (5), `hub-story-finish` (+3: web approval rules, not-at-승인-대기/no-commits,
  approvalView), `hub-story-pages` (+3: card contents for the PL only, button rules incl. Origin/CSRF/stale/box/
  others/admin and the following record, 다시 검증), `team-story-finish` (+1: the PL Office merges a web approval).

## Not done here
- The hands-on web approval on a copy Hub (V20 (D49)) writes the test repo's main: only with the user's allowance.
- Copy button behaviour in a real browser is checked in the hands-on step, not by these tests.
