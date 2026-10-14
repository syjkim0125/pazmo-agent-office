---
title: Use in-page dialogs, not native confirm/alert, in the Office UI
date: "2026-10-14"
category: ui-bugs
module: Office UI dialogs (vendored Claw-Empire screen)
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
tags: [window-confirm, window-alert, native-dialog, in-app-browser, dialog-provider, office-ui, team-hub, vitest]
---

# Use in-page dialogs, not native confirm/alert, in the Office UI

## Problem
The Office UI asked for confirmation with `window.confirm()` and reported errors with `window.alert()`. People open the Office in the desktop app's in-app browser. That browser suppresses native JavaScript dialogs: `confirm()` returns `false` without showing anything, and `alert()` does nothing. Confirmed actions therefore cancelled themselves silently, and errors were never seen.

## Symptoms
- Real check for the team hub cancel feature (PR syjkim0125/pazmo-agent-office#21), 2026-10-13: the user pressed "요청 취소" on a Decisions item, and nothing happened. The hub request stayed accepted.
- The browser console had one line per click: `[Claude browser] Page dialog suppressed (confirm): "…" — native JavaScript dialogs are disabled in this browser; confirm() returned false to the page.` No `/reply` request had been sent.
- The same click in another browser worked. That browser showed the native dialog, and the request was cancelled end to end.
- The unit tests were green. They stub `window.confirm` to return `true`, so they never meet a browser that refuses dialogs.

## What Didn't Work
- Suspecting the server path. The hub, gateway and local API were fine. The request was never sent, because the page's own `confirm()` returned false.
- Relying on tests that spy on `window.confirm`/`window.alert`. A stub that returns `true` hides exactly this environment difference.

## Solution
Replace native dialogs with in-page UI that every browser renders. This is done in PR syjkim0125/pazmo-agent-office#21.
- A shared provider, `vendor/claw-empire/src/components/common/DialogProvider.tsx`, mounted once in `vendor/claw-empire/src/main.tsx` around `<App />`. `useDialog()` returns two calls:
  - `confirm({ message, tone })`, which resolves to a `Promise<boolean>`. It renders a `role="alertdialog"` modal. Focus starts on Cancel and Esc cancels.
  - `notify(message, { tone })`, which renders an in-page notice. Errors stay until closed; info notices auto-dismiss.
  - `useDialog()` throws outside the provider, so a missing provider fails loudly instead of silently blocking actions.
- Call sites become `if (!(await confirm({ message, tone: "danger" }))) return;` and `notify(text, { tone: "error" })`. Message texts stay the same.
- Context-specific confirmations stay inline where they read better, such as the card's sent-request ✕ and the Decisions hub cancel. They render a full-width block with the message and [요청 취소] [돌아가기].
- Tests use `vendor/claw-empire/src/test/renderWithDialogs.tsx` to wrap renders in the provider. `vendor/claw-empire/src/test/forbidNativeDialogs.ts` makes a test fail if `window.confirm` or `window.alert` is called.

## Why This Works
In-page UI is ordinary DOM, so it does not depend on the host browser's dialog policy. The decision moves from a synchronous native call that a host can veto silently to an awaited promise that the page itself resolves. The guard in tests turns "someone added a native dialog again" into a failing test instead of a silent field bug.

## Prevention
- In the Office UI, do not call `window.confirm`, `window.alert` or `window.prompt` for a user decision or message. Use `useDialog()` or an inline confirmation. The only remaining native call is the API-token `window.prompt` in `vendor/claw-empire/src/api/core.ts`, which managed Office does not use.
- After an awaited confirm, flush pending work before asserting that "Cancel did nothing". With React Testing Library, call `await act(async () => {})` after the click, then `expect(action).not.toHaveBeenCalled()`. Assert `toHaveBeenCalledTimes(1)` on the OK path. Without the flush, the assertion runs before the handler resumes and cannot fail. A mutation check showed 6 such tests passing while the code ignored the result.
- A quick audit: `grep -rnE 'window\.(confirm|alert|prompt)|[^.A-Za-z_](alert|confirm)\(' vendor/claw-empire/src --include='*.ts' --include='*.tsx'`, excluding tests and `await confirm(`.
- Check any new confirmation once in the in-app browser, not only in Chrome and jsdom.

## Related Issues
- Verification: `docs/verification/2026-10-14-team-hub-office-cancel.md`. Decision: `docs/understanding/team-hub-office-cancel-decision.md`.
- Colour and layout of the same new UI: [match-light-theme-remapped-classes.md](match-light-theme-remapped-classes.md).
