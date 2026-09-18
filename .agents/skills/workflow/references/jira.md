# Optional Jira publication

The canonical Story stays local and remains the source of truth. Jira is an optional publication target, never a second requirements contract. Do not create or update an issue merely because Jira is installed.

## Preview first

Run `ai-workflow-kit jira preview <story-file> --root <project>` for a paste-ready, readable preview. This command never loads a connector, writes a publication record or creates an issue. Draft Stories can be previewed; invalid Stories fail validation. Review the entire preview for confidential content before sharing it. The preview intentionally includes only Goal, Domain, MUST, SHOULD, OUT, Decisions and Verify, not Owner or gate records.

In Codex, use `$workflow`; in Claude Code, use `/workflow`. After a user asks to publish, check the approved Story and G1 evidence, resolve the exact Jira site, project and optional parent, and obtain explicit publication authorization. Requirements approval alone does not authorize an external write. If the host has no supported connector or the user has not supplied a target, return the preview and stop. Never claim an issue exists without its verified key and URL.

## Host adapter API

The package exports `formatStory(text)` and `publishStory(options)` from `@pazmo/ai-workflow-kit/src/jira.mjs`. There is no bundled Jira network client, credential store, environment-based connector loader or shell execution. A trusted host integration wraps its available connector/MCP/CLI as these asynchronous functions:

- `find({publicationId, target})`: return **all** matching issue identities (`{key, url}`), or `[]`. Search by exact publication identity within the authorized site/project/parent, not by title. Exhaust pagination; incomplete or inaccessible search results must be an error, not `[]`.
- `create({publicationId, target, summary, description})`: create-if-absent using that identity; persist the identity in Jira metadata, then return `{key, url}`. The host must serialize competing creation for the same identity if used across machines. Jira's ordinary create endpoint alone does not provide this guarantee.
- `read({key, url, target})`: fetch the actual issue and return `{key, url, publicationId, target, summary, description}`. These values must come from Jira; never echo the create request to simulate verification. Retrieve the parent as well as the project and description.

`target` is `{siteUrl, project, parent?}`: an HTTPS origin without credentials/query/path, uppercase project key, and optional issue key in the same project. Jira Cloud ADF is the supported transport description format. Data Center wiki text needs a host-side lossless conversion and real rendered verification; it is not a built-in supported transport in this release.

The `description` is an [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/) document containing seven level-2 headings and inert paragraph/bullet-list text. M1/V1 and M-1/V-1 spellings remain exactly as written. Inline Markdown and code fences are preserved as literal text, not interpreted as links, macros or mentions. Empty sections require an explicit N/A reason. No arbitrary Markdown-to-ADF renderer is included.

```js
import { publishStory } from '@pazmo/ai-workflow-kit/src/jira.mjs';

// hostJiraAdapter is trusted code supplied by your host, with credentials kept there.
// Keep this identity for this Story across retries and clones; do not generate it per call.
const result = await publishStory({
  root: projectRoot,
  file: 'docs/understanding/my-change-contract.md',
  publicationId: stableStoryPublicationId,
  target: authorizedTarget,
  adapter: hostJiraAdapter,
  publish: true, // only after the human authorizes this specific external publication
});
```

Only literal `publish: true` enables publication. Missing target or adapter returns `status: 'preview'`. The caller provides a unique opaque `publicationId` (8–128 letters/digits/underscore/dot/colon/hyphen, beginning with a letter/digit; UUID recommended). Different Stories must not reuse it. The library derives the remote identity from that value and target, so two repositories named `story.md` do not collide. Review changes in target as a new authorization decision.

## Verification, retries and failures

Before create, the library checks Story shape and one Approved/Delivered Status plus one G1 record in the metadata, then stores a private local intent under `.ai-workflow/publications/`. Publication requires a plain preamble: title, Status, Owner, gate records, optional G4 restatement and blank lines only. Comments, fences and other blocks cannot supply approval. Publication additionally requires a separate nonempty G1 evidence artifact; a self-reference or hard link to the Story is insufficient. This is stricter than the general checker. The host must establish that the evidence records genuine human approval. The library searches for an existing issue, rejects malformed or multiple matches, reads the chosen issue back, and compares title, target, identity, heading/list order and content. JSON object-property ordering is irrelevant; semantic document differences fail verification. On success it returns `status: 'published'`, the verified key/URL and relative record path. A retry verifies again and never automatically updates an existing issue.

Gate metadata belongs in the preamble, except a trailing block of `Understanding gate (G1/G3/G4): ...` and `G4: PASS — ...` records after all Verify content, which is also excluded from preview/ADF. No requirement content may follow that trailing block. Ordinary section prose (including `Status:` or `Owner:` paragraphs) remains public content. This is not a general confidential-content detector.

The record contains only schema/state, derived identity, content digest, target and verified issue identity; no Story body, gate evidence, credentials or transport errors. Keep the original Story unchanged. Include publication records when moving this workflow to another machine, subject to the team's policy for Jira URLs; protect them against deletion/tampering. Deleting records, changing the identity or implementing a host adapter that blindly creates defeats deduplication.

The adapter owns permissions and credentials, finite network deadlines, pagination, remote create-if-absent and rate limiting. Do not retry create inside the adapter without remote idempotency. The package catches rejected calls and returns stage-specific errors without raw connector messages. A lost create response leaves an intent; a retry can adopt a matching issue, but if lookup finds nothing, creation stays blocked because indexing may lag. Reconcile in Jira before further action; do not delete the intent just to force retry.

Same-project local invocations use an exclusive lock directory. A crash leaves it for inspection. After confirming no publisher is active, remove only the named `.json.lock` directory; preserve the `.json` intent and any `.json.next` file for reconciliation. A leftover `.next`, unreadable/invalid record, changed Story, mismatch or permission error is an actionable failure, not a created-issue claim. Never edit the Story to make verification pass. The checker verifies records and evidence paths, not human identity, cognition or authenticity of approval.

This release is tested with synthetic adapters. It does not prove a live Jira connector's permissions, renderer, search consistency or distributed idempotency. No live Jira action is needed to install or use the workflow.
