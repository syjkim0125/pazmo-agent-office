# Changes from Claw-Empire v2.0.4

Original commit: `5c928b24ffa55b403fe7c5521d4ac3ac49516137`.
Original tree: `3ca77ccbebc879fa80997a374288285531aa6b26`.

## 2026-09-18 — Google OAuth defaults

`vendor/claw-empire/server/oauth/helpers.ts`: remove the built-in Google OAuth client ID and secret. The existing `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET` environment variables remain supported; absent variables now yield empty strings. GitHub configuration and the remaining OAuth implementation are unchanged. A modification notice is included in the changed file.

GitHub push protection rejected the exact original snapshot because of these embedded values. The exact import commit `8e25d7c5ea42d03e202d1599338f3a76d61d05fe` is retained locally under `codex/local-original-claw-v2.0.4`; that branch must not be pushed. Published history starts from the project's existing initial commit and contains only the sanitized source. The lock file distinguishes original and published source trees. No protection exception was used.

Approval: [publication decision](../docs/understanding/source-publication-decision.md).
Verification: [focused test and publication checks](../docs/verification/2026-09-18-publication.md).

## 2026-09-18 — Read-only Pazmo preview

The following Claw UI files carry modification notices: `src/types/index.ts`, `src/app/useAppBootstrapData.ts`, `src/app/AppMainLayout.tsx`, `src/components/Dashboard.tsx`, `src/components/TaskBoard.tsx`, and `src/components/dashboard/HeroSections.tsx` (all under `vendor/claw-empire/`). They add the optional read-only setting, suppress automatic persistence, identify preview state and disable the Dashboard/empty-board mutation controls. Two adjacent preview tests are new Pazmo-authored tests.

The root `src/runtime/service.ts` is new Pazmo code. It imports Claw's unmodified base schema and seeds and serves the built UI through a read-only adapter. It does not start the upstream scheduler or agent runtime and is not a second scheduler. SQLite is the single Office data store. Automatic migration of existing user databases is disabled.

The lock file's published tree remains the source-import checkpoint, not the working vendor tree after these disclosed UI changes. Original Apache-2.0 licensing and notices remain in place; new root code retains the project MIT license.

Verification: [runtime baseline](../docs/verification/2026-09-18-runtime-baseline.md).
