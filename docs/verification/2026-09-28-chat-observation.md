# Chat control and read-only observation — 2026-09-28

Scope: U7; Story M2/M3/M4 and V2/V3/V4. The user's request to remove manual operator entry/control and subsequent “진행해” authorize this interaction-channel change. Existing Story/plan, internal authentication, real approvals, Mac controller/VM isolation, kit 4.1.0 rules and main-merge ownership remain in force.

## Implementation

- The trusted local host uses the bounded stdin `bridge` command for requests, addressed answers, publication, execution/cancellation, approvals, G4 assessment and delivery. It calls existing operator endpoints without displaying their credential or storing a second task state. Office/kit still determine readiness.
- `monitor` authenticates the owned controller and derives a separate viewer capability. The browser exchanges a URL fragment for an HttpOnly, SameSite=Strict, instance-bound read session and removes the fragment. Only selected GET readers are exposed; the browser cannot execute or approve.
- `/activity` shows saved conversations, scope, implementation/check/review evidence, raw diff, feedback, approval and delivery records. Polling pauses while hidden, stale selection responses cannot replace newer details, and unchanged details retain their expansion state. Non-UTF-8 diffs are labeled Base64.
- `/operator` redirects to observation; its old JS assets return 410. The old interactive console and form-only tests are removed. Private APIs and compatibility CLI remain. Main Office task navigation now opens observation. The illustrated office remains an upstream presentation, not independent proof that its avatars correspond to live executions.
- `docs/CHAT-CONTROL.md` and AGENTS link define how this Codex host continues the existing role execution and relays actual answers. This is an active chat host integration, not a background daemon or arbitrary chat-app connector.

## Checks and evidence boundary

Node 24.19.0; all commands run in this worktree.

| Check | Result | What it establishes |
| --- | --- | --- |
| New bridge tests before implementation | RED: unknown command | Missing transport reproduced |
| New observation tests before implementation | RED: missing module/monitor command | Missing viewer path reproduced |
| `node --experimental-vm-modules --test tests/*.test.mjs` | 333/333, exit 0 | Existing lifecycle, graph, execution, approval and delivery regressions plus new bridge/observation protocol checks |
| Final bridge + monitor tests after review edits | 7/7, exit 0 | Actual loopback server/DB request, stale cancellation, permission separation, fixture planning publication and addressed G1/G3, no unverified G4/delivery, UI race/hidden-tab behavior |
| Final monitor tests after selection/style cleanup | 3/3, exit 0 | Late selection rejection, viewer reconnect and read-only evidence display |
| `npm run typecheck` equivalent explicit Node/tsc | exit 0 | Root TypeScript |
| Story and U7 Task checkers | exit 0 | Canonical contract/Task validity; Story not Delivered, G4 not asserted |
| `npm run build:office` | exit 0 | Vendor TS build and production bundle; existing large-chunk warning remains |
| Focused vendor header/preview tests and lint | 3/3 tests; lint exit 0, no output | Main navigation compatibility; rebuilt navigation also checked in the browser |

The full test count decreases because 22 old console interaction tests are replaced by 7 bridge/observation tests; core approval, lifecycle, completion and graph tests remain. Added tests use fixture proposal/approval values explicitly labeled synthetic. They are not real PM output or user approval. The broader existing suite covers G4 submission, evaluation binding, cancellation, restart and delivery; the bridge does not replace those ledgers.

Actual in-app browser, existing preview `http://127.0.0.1:49930`: opened the monitor URL without user key entry; fragment disappeared; created a clearly labeled connection-only request through the supported bridge; observed it and its persisted dialogue; cancelled through the same bridge and observed `취소됨`; refreshed to confirm viewer cookie reconnection; followed the rebuilt main **진행과 결과** button to observation. No SQLite edits, model calls, synthetic role conversations or real approvals were made in this preview.

## Simplification and review

Reused the approved plan and running developer kit assignment; no duplicate delivery graph. `ce-simplify-code` reuse/quality/efficiency lenses ran inline under the host's sequential mapping: reused the existing safe conversation formatter, removed retired form assets and unused CSS, kept original guarded readers and private client, retained no-change DOM and hidden-tab polling. No new dependency or kit source modification.

The installed CE full code-review path requires delegated merge/report workers. Its mode is incompatible with this repository's sequential-host mapping; selected the workflow's direct review procedure before dispatch. This is a main-context review, **not an independent reviewer or cross-model review**. Reviewed correctness, contracts, auth boundaries, asynchronous UI lifetime, requirement coverage and testing limits. Findings fixed: disposed pagination callback, stale read after session expiry, bfcache resume, opaque raw diff formatting, stale manual-control instructions, and a CSS selector joining section panels to the button rule (caught visually and rechecked). No unresolved material finding in this change; actual-model acceptance and independent delivery review remain separate.

Focused Superpowers TDD and verification-before-completion were used within the assigned implementation. Frontend and React guidance were applied to the small observation/navigation changes; no UI redesign or performance claim beyond paused polling. Compound uses non-interactive lightweight mode to update the existing UI-state learning rather than create a duplicate, preserving its historical evidence. No session-history or semantic subagent review is claimed. The existing learning passed the bundled frontmatter and mechanical claims validators. Knowledge-store discoverability has no gap; CONCEPTS.md is absent, so vocabulary-file creation is deferred.

## Still pending

The actual project path/task selection and one actual-model PM → human G1 → Lead → Developer → Reviewer/checks → real G4 → evaluated approval → delivery through the new chat flow. Existing README pilot evidence is preserved and not reinterpreted as this acceptance. No whole-alpha completion, fabricated G4, main merge or public release.
