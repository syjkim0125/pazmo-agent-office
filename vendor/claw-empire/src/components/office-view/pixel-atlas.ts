// Generated office workers: each row is one identity; columns retain the
// upstream idle / walking / left / right frame contract.
export const PIXEL_ATLAS_URL = "/sprites/office-pixel-atlas.png";
export const PIXEL_ATLAS_WIDTH = 749;
export const PIXEL_ATLAS_HEIGHT = 2098;
export const PIXEL_ATLAS_POSES = ["D-1", "D-2", "D-3", "L-1", "R-1"] as const;
// Measured transparent gutters in the generated PNG, not an assumed even grid.
// Keep these tied to this asset: evenly dividing it clips feet into the next row.
const COLUMNS = [0, 156, 297, 441, 587, 749];
const ROWS = [0, 156, 297, 441, 582, 730, 874, 1020, 1166, 1312, 1459, 1607, 1755, 1908, 2098];

export function pixelAtlasFrame(spriteNum: number, pose: string = "D-1") {
  const col = PIXEL_ATLAS_POSES.indexOf(pose as (typeof PIXEL_ATLAS_POSES)[number]);
  if (!Number.isInteger(spriteNum) || spriteNum < 1 || spriteNum > 14 || col < 0) return undefined;
  const x = COLUMNS[col];
  const y = ROWS[spriteNum - 1];
  return {
    x,
    y,
    width: COLUMNS[col + 1] - x,
    height: ROWS[spriteNum] - y,
  };
}
