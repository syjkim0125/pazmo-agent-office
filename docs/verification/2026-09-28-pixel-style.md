# Office pixel style — M7 / V7

- Scope authorized by the user's attached pixel-character reference on 2026-09-28. Visual assets and drawing only; no new workflow, menus or execution features.
- Plan source: N/A — small and reversible visual outcome. Earlier uncommitted Tasks changes were preserved and are not part of this verification.
- Generated `office-pixel-atlas.png` (14 identities, 5 poses each) and `ceo-human-pixel.png` with imagegen using the user's image as a style reference. Original upstream sprites remain available. Both PNGs have real alpha transparency.
- Connected the existing sprite IDs and pose keys to atlas textures, and the same idle portraits to AgentAvatar. Unsupported IDs or an unavailable atlas retain the original Office sprite loader.
- Updated floors, desks, chairs, plants, sofas, coffee tables and room outlines to hard edges and stepped shading. Nearest texture filtering, integer pixel positioning and 1x canvas rendering avoid smoothed sprite edges. Existing layout and character interaction remain.

## Review and correction

Direct inline review under the repository's sequential-agent instruction; no independent reviewer or cross-model review claimed. Checked frame identity, bounds, unsupported IDs, React accessibility labels, Pixi loading/lifecycle, and the visual-only diff. Simplification checked reuse, quality and efficiency inline: one shared atlas geometry helper serves both renderers; no additional abstractions were added.

Browser inspection found preceding-row feet leaking into the Lead avatar. The generated image did not have the exact uniform grid requested. Measured transparent gutters replaced even division, and an inner avatar frame now clips the source before the outer portrait crop. Final browser inspection confirmed the unwanted pixels were gone. This is why geometry is explicit in `pixel-atlas.ts`.

## Fresh verification

- Vendor `tsc -b`: exit 0.
- Vendor `vite build`: exit 0; existing large-chunk warning remains.
- Scoped ESLint for changed drawing/atlas/avatar files: exit 0, no errors; 3 pre-existing runtime-hook warnings remain.
- Node assertions: all 70 frames have integral coordinates within the actual 749×2098 atlas, total coverage equals image area, first/last measured rows match, invalid IDs/poses return fallback; exit 0.
- PNG inspection: RGBA, alpha range 0–255 for both assets. Internal measured row/column gutters have no opaque character pixels.
- `git diff --check`: exit 0.
- `check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0. Story remains Approved; G4 not checked.
- Actual local browser: rebuilt Office at port 49930, new CEO/workers/furniture visible, Tasks→Office navigation and Lead click/detail/close work, corrected portrait has no neighboring frame fragments. Browser left on Office.

## Boundary

Visual implementation and local preview checked. Actual model execution, all animated work states, and full product acceptance were not exercised here. No user approval was synthesized; no commit/push/merge performed. Existing Tasks work remains uncommitted.

Compound (non-interactive, lightweight): documentation skipped — the atlas gutter cause/prevention is captured directly beside the measured source geometry and in this verification; a second learning file would duplicate that explanation.

## 2026-09-29 CEO correction

Replaced the generated lobster with a human CEO matching the employee atlas: brown hair, navy suit and gold tie, transparent background. Both canvas and sidebar use the same asset. CEO_SIZE is 64 to match the employee height. Actual browser on the native Claw server shows the full character with its existing crown/name and no clipping. Root/vendor type checks and vendor build exit 0; no new model task was run. Generation's first request failed with a network error; the explicit retry succeeded. This is visual completion only.
