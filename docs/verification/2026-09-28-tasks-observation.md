# Existing Tasks integration — 2026-09-28

User correction: remove the standalone activity page and retain Tasks. Canonical Story D10 and U7 are updated; existing chat control, approval, kit role rules and controller/VM boundaries remain unchanged. This revision supersedes the standalone presentation in the earlier chat-observation checkpoint.

## Change

- Restored the existing Office sidebar/header Tasks navigation. In Office read-only mode it mounts the observation content inside the existing app. No iframe or separate page is used; normal upstream mode retains its original TaskBoard.
- Moved the formatter and observer into the frontend component, with scoped DOM queries and CSS. The bundled static HTML shell contains no model/user content; that content continues to use textContent. Cleanup stops timers/listeners when leaving Tasks.
- `monitor` opens the main app with `officeView=tasks`. The same read-only fragment/session mechanism is preserved. React StrictMode remounts share the in-flight login promise, preventing early unauthenticated reads after the first mount removes the fragment.
- Deleted the standalone activity page/server/assets and floating activity link. Old `/activity` and `/operator` addresses redirect to Office Tasks; old assets return 410. Internal read and control API permissions remain unchanged.

## Evidence

- RED: focused integration test could not resolve the absent OfficeTasks component. Initial test-file placement was corrected before that valid RED run.
- GREEN: 5/5 focused React tests (Tasks and delayed-session StrictMode integration plus existing header/preview tests).
- 33/33 affected root tests: observer behavior, real local HTTP/DB bridge, viewer isolation, retired routes and lifecycle/restart. Core model/graph/approval implementation is unchanged; no unrelated full-suite rerun was needed.
- Root TypeScript, vendor production TS/Vite build, Story checker and U7 Task checker: exit 0. Existing bundle-size warning remains. Scoped lint initially found two browser globals in the moved JS module; declaring the existing browser globals resolves that environment mismatch without changing behavior.
- In-app browser against the existing locked preview: main app displayed Tasks, session fragment disappeared, previous saved request/cancellation and its dialogue appeared inside Tasks, and Office → Tasks navigation reconnected without a key input. Visual inspection confirmed the main app layout and scoped theme styling. No model or approval was invoked.

## Review and learning

Inline reuse/quality/efficiency and correctness/security/lifecycle review under the repository's sequential-host mapping. Reused the existing observer and APIs instead of introducing another state store or backend. Reviewed static HTML provenance, session remount lifetime, DOM scope, timer cleanup, no-mutation viewer access and legacy routing. No independent/cross-model review is claimed. Browser and affected test evidence cover the changed interface; they do not establish live execution completion.

Compound non-interactive lightweight update to the existing UI-state learning captures the user-experience correction and remount/session race. No duplicate learning or new concepts file. Main merge remains user-owned.

## Explicit limits

This is a Tasks presentation correction. Actual execution-to-character state and Decisions entries are still unconnected. Actual-model PM → Lead → implementation/review/checks → real G4 → delivery acceptance remains pending. Do not describe an illustrated character, empty Decisions list, or successful UI test as that proof.
