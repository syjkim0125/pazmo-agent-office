# Changes from Claw-Empire v2.0.4

Original commit: `5c928b24ffa55b403fe7c5521d4ac3ac49516137`.
Original tree: `3ca77ccbebc879fa80997a374288285531aa6b26`.

## 2026-09-18 — Google OAuth defaults

`vendor/claw-empire/server/oauth/helpers.ts`: remove the built-in Google OAuth client ID and secret. The existing `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET` environment variables remain supported; absent variables now yield empty strings. GitHub configuration and the remaining OAuth implementation are unchanged. A modification notice is included in the changed file.

GitHub push protection rejected the exact original snapshot because of these embedded values. The exact import commit `8e25d7c5ea42d03e202d1599338f3a76d61d05fe` is retained locally under `codex/local-original-claw-v2.0.4`; that branch must not be pushed. Published history starts from the project's existing initial commit and contains only the sanitized source. The lock file distinguishes original and published source trees. No protection exception was used.

Approval: [publication decision](../docs/understanding/source-publication-decision.md).
Verification: [focused test and publication checks](../docs/verification/2026-09-18-publication.md).
