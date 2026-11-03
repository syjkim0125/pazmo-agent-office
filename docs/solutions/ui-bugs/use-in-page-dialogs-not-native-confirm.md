---
title: Use in-page dialogs, not native confirm/alert, in the Office UI
date: "2026-10-14"
last_updated: "2026-11-03"
category: ui-bugs
module: Office UI dialogs (lean screen, src/lean/web)
problem_type: ui_bug
component: frontend_stimulus
related_components: [testing_framework]
symptoms:
  - "Pressing 요청 취소 in Decisions did nothing; no confirmation appeared and no request was sent"
  - "Browser console showed: [Claude browser] Page dialog suppressed (confirm) … confirm() returned false to the page"
  - "Error messages shown with window.alert never appeared in the same browser"
  - "Vitest tests spying on window.confirm passed, so the defect only showed in the real two-Office check"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [window-confirm, window-alert, native-dialog, in-app-browser, confirm-box, dialog-element, office-ui, lean-web]
---

# Use in-page dialogs, not native confirm/alert, in the Office UI

## Problem
The Office UI asked for confirmation with `window.confirm()` and reported errors with `window.alert()`. People open the Office in the desktop app's in-app browser. That browser suppresses native JavaScript dialogs: `confirm()` returns `false` without showing anything, and `alert()` does nothing. Confirmed actions therefore cancelled themselves silently, and errors were never seen.

The incident was in the vendored Claw screen, which D33 (PR #56, 2026-10-30) removed. The lean screen in `src/lean/web` follows the same rule.

## Symptoms
- Real check for the team hub cancel feature (PR syjkim0125/pazmo-agent-office#21), 2026-10-13: the user pressed "요청 취소" on a Decisions item, and nothing happened. The hub request stayed accepted.
- The browser console had one line per click: `[Claude browser] Page dialog suppressed (confirm): "…" — native JavaScript dialogs are disabled in this browser; confirm() returned false to the page.` No `/reply` request had been sent.
- The same click in another browser worked. That browser showed the native dialog, and the request was cancelled end to end.
- The unit tests were green. They stub `window.confirm` to return `true`, so they never meet a browser that refuses dialogs.

## What Didn't Work
- Suspecting the server path. The hub, gateway and local API were fine. The request was never sent, because the page's own `confirm()` returned false.
- Relying on tests that spy on `window.confirm`/`window.alert`. A stub that returns `true` hides exactly this environment difference.

## Solution
Replace native dialogs with in-page UI that every browser renders. PR #21 did this in the Claw screen with a shared `DialogProvider` and a test guard that failed on any native dialog call. Both went with that screen in D33.

The lean screen has no native dialogs. It uses three in-page pieces (`src/lean/web/app.js`):
- **`confirmBox({ question, yesLabel, run, back })`** (`:400-437`), the in-screen confirm. It shows the question with [yes] and [keep], and Escape keeps. While it shows, the poll leaves the screen alone (`data-hold`). If `run` fails, the error shows inline (`role="alert"`) and the choice stays open. Rejecting a decision, cancelling a task and deleting an agent go through it.
- **`openDialog(trigger, build)`** (`:861-867`), a modal `<dialog>`. Escape closes it and focus returns to the trigger. While a request is in flight, Escape and Close do nothing, so the dialog cannot be closed and reopened into a second request. The new-task and rerun form (`openTaskDialog`) and the agent form (`openAgentDialog`) use it.
- **`say(text, kind)`** (`:162`), the page notice for results and errors.

## Why This Works
In-page UI is ordinary DOM, so it does not depend on the host browser's dialog policy. The decision moves from a synchronous native call that a host can veto silently to an awaited promise that the page itself resolves.

## Prevention
- In the Office UI, do not call `window.confirm`, `window.alert` or `window.prompt` for a user decision or message. Use `confirmBox`, `openDialog` or `say`.
- No lean test forbids native dialogs the way the Claw guard did, so audit with `grep -nE 'window\.(confirm|alert|prompt)|[^.A-Za-z_](alert|confirm|prompt)\(' src/lean/web/*.js`. It finds none as of 2026-11-03. The `alert(1)` strings in `tests/lean-web.test.mjs` are XSS payloads, not calls.
- After an awaited confirm, flush pending work before asserting that "Cancel did nothing". Assert the action ran exactly once on the OK path. Without the flush, the assertion runs before the handler resumes and cannot fail. In the Claw screen's tests, a mutation check showed 6 such tests passing while the code ignored the result.
- Check any new confirmation once in the in-app browser, not only in Chrome and a fake DOM.

## Related Issues
- Verification: `docs/verification/2026-10-14-team-hub-office-cancel.md`. Decision: `docs/understanding/team-hub-office-cancel-decision.md`.
