# Licensing and source boundaries

Pazmo Agent Office is an independent, mixed-license open-source distribution. **MIT for Pazmo originals does not remove Apache-2.0 obligations on imported Claw-Empire code.**

| Scope | License and handling |
|---|---|
| Independently authored Pazmo code and documentation | Root MIT `LICENSE` |
| `vendor/claw-empire/` original source and retained upstream portions of modifications | Upstream Apache-2.0 `LICENSE`, applicable NOTICE and original attribution remain |
| Templates and repository workflow tooling (`.agents/skills/workflow/`, `.ai-workflow/`) from AI Workflow Kit | MIT; retain `licenses/ai-workflow-kit-MIT.txt` and source manifest |
| Other dependencies, assets and optional submodules | Their respective licenses; inspect before bundling |

Do not replace the upstream license with MIT. Preserve the existing root copyright holder as authored by the repository owner. Add prominent modification notices to modified upstream files and record changes in `upstream/CHANGES.md`; a changelog alone must not be assumed to replace file-level notices required by the applicable license.

When both MIT originals and Apache-2.0 source/object code are redistributed in the npm package, make the package metadata reflect that combined content (for example, `MIT AND Apache-2.0`, with the actual notices). Do not use `MIT OR Apache-2.0` to imply a choice over all components. Do not offer unsupported relicensing assurances.

A GitHub license badge is not a complete license inventory. Audit bundled third-party code, Remotion-related components, nested skills, submodules, images, fonts and other assets. Source import preserves upstream material; it does not certify every bundled component for every use.

References: [Apache-2.0 terms, especially section 4](https://apache.org/licenses/LICENSE-2.0.html), [Claw-Empire license at the pinned release](https://github.com/GreenSheep01201/claw-empire/blob/5c928b24ffa55b403fe7c5521d4ac3ac49516137/LICENSE), [AI Workflow Kit license](https://github.com/syjkim0125/ai-workflow-kit/blob/ea0f2a2e10872ef85b379afc1ee25835f446a763/LICENSE).

**Source status (2026-09-18):** The pinned Claw-Empire tree and its original license were imported and verified locally. Published source removes built-in Google OAuth defaults; the modified file carries a change notice and `upstream/CHANGES.md` records the difference. AI Workflow Kit templates/license match their pinned blobs; workflow tooling is from the verified official npm 3.1.1 package. This is source provenance, not a completed runtime or package license audit.
