import { type Container, Graphics } from "pixi.js";
import { DESK_H, DESK_W, TARGET_CHAR_H } from "./model";
import { blendColor } from "./drawing-core";
import { OFFICE_PASTEL } from "./themes-locale";

/** Integer-pixel silhouettes and three-tone shading, matching the worker atlas. */
function drawDesk(parent: Container, dx: number, dy: number, working: boolean): Graphics {
  const g = new Graphics();
  const x = Math.round(dx),
    y = Math.round(dy);
  const ink = 0x332638;
  g.rect(x + 2, y + 4, DESK_W, DESK_H + 3).fill({ color: ink, alpha: 0.22 });
  g.rect(x + 3, y + DESK_H, 4, 5).fill(ink);
  g.rect(x + DESK_W - 7, y + DESK_H, 4, 5).fill(ink);
  g.rect(x, y, DESK_W, DESK_H).fill(ink);
  g.rect(x + 2, y + 2, DESK_W - 4, DESK_H - 4).fill(0xb7764e);
  g.rect(x + 2, y + 2, DESK_W - 4, 3).fill(0xf0c58a);
  g.rect(x + 2, y + 5, DESK_W - 4, DESK_H - 10).fill(0xdca36b);
  // Paper, keyboard, mug and a dark CRT screen.
  g.rect(x + 4, y + 5, 8, 10).fill(0x926047);
  g.rect(x + 3, y + 4, 8, 9).fill(0xffecc2);
  g.rect(x + 5, y + 6, 4, 1).fill(0xb39379);
  g.rect(x + 5, y + 9, 3, 1).fill(0xb39379);
  g.rect(x + 15, y + 4, 18, 6).fill(ink);
  for (let i = 0; i < 6; i++) g.rect(x + 16 + i * 3, y + 5, 2, 2).fill(0xc4c3cf);
  g.rect(x + 19, y + 8, 10, 1).fill(0xc4c3cf);
  g.rect(x + 37, y + 4, 7, 7).fill(ink);
  g.rect(x + 38, y + 5, 5, 5).fill(0xf5b776);
  g.rect(x + 39, y + 5, 3, 2).fill(0x704135);
  g.rect(x + 14, y + 12, 22, 14).fill(ink);
  g.rect(x + 16, y + 14, 18, 10).fill(working ? 0x31545a : 0x45435d);
  g.rect(x + 16, y + 14, 18, 1).fill(0x696585);
  if (working) {
    for (let i = 0; i < 3; i++) g.rect(x + 18, y + 16 + i * 2, 10 - i * 2, 1).fill(0xa6dab0);
  } else {
    g.rect(x + 22, y + 18, 5, 3).fill(0x8987a5);
  }
  g.rect(x + 22, y + 26, 6, 2).fill(ink);
  parent.addChild(g);
  return g;
}

function drawChair(parent: Container, cx: number, cy: number, color: number) {
  const g = new Graphics();
  const x = Math.round(cx),
    y = Math.round(cy);
  const ink = 0x332638;
  g.rect(x - 13, y - 11, 26, 19).fill(ink);
  g.rect(x - 11, y - 9, 22, 15).fill(blendColor(color, ink, 0.25));
  g.rect(x - 10, y - 8, 20, 3).fill(blendColor(color, 0xffe9c0, 0.35));
  g.rect(x - 9, y - 2, 18, 6).fill(color);
  g.rect(x - 16, y - 3, 4, 10).fill(ink);
  g.rect(x + 12, y - 3, 4, 10).fill(ink);
  parent.addChild(g);
}

function drawPlant(parent: Container, x: number, y: number, variant: number = 0) {
  const g = new Graphics();
  x = Math.round(x);
  y = Math.round(y);
  const ink = 0x332638;
  g.rect(x - 5, y, 10, 8).fill(ink);
  g.rect(x - 4, y + 1, 8, 5).fill(0xb96b4f);
  g.rect(x - 4, y + 1, 8, 2).fill(0xe7aa72);
  if (variant % 4 === 1 || variant % 4 === 3) {
    g.rect(x - 3, y - 13, 6, 14).fill(ink);
    g.rect(x - 2, y - 12, 4, 13).fill(0x54815c);
    g.rect(x - 1, y - 11, 1, 10).fill(0xa1bc78);
    g.rect(x - 7, y - 8, 5, 3).fill(ink);
    g.rect(x - 6, y - 10, 2, 4).fill(0x759b65);
    g.rect(x + 2, y - 6, 5, 3).fill(ink);
    g.rect(x + 4, y - 8, 2, 4).fill(0x759b65);
  } else {
    g.rect(x - 6, y - 10, 12, 8).fill(ink);
    g.rect(x - 3, y - 13, 7, 13).fill(ink);
    g.rect(x - 7, y - 7, 14, 4).fill(ink);
    g.rect(x - 5, y - 9, 10, 6).fill(0x54815c);
    g.rect(x - 2, y - 12, 5, 10).fill(0x759b65);
    g.rect(x - 4, y - 9, 4, 3).fill(0xa8c87b);
    if (variant % 4 === 2) {
      g.rect(x - 3, y - 12, 4, 4).fill(0xe6a0a0);
      g.rect(x + 3, y - 8, 3, 3).fill(0xf0c58a);
    }
  }
  parent.addChild(g);
}

function drawWhiteboard(parent: Container, x: number, y: number) {
  const g = new Graphics();
  // Shadow behind board (deeper, offset)
  g.roundRect(x + 2, y + 2, 38, 22, 2).fill({ color: 0x000000, alpha: 0.15 });
  g.roundRect(x + 1, y + 1, 38, 22, 2).fill({ color: 0x000000, alpha: 0.08 });
  // Frame (warmer silver)
  g.roundRect(x, y, 38, 22, 2).fill(0xcccccc);
  g.roundRect(x, y, 38, 22, 2).stroke({ width: 0.5, color: 0xaaaaaa });
  // Frame highlight (top edge)
  g.moveTo(x + 2, y + 0.5)
    .lineTo(x + 36, y + 0.5)
    .stroke({ width: 0.5, color: 0xffffff, alpha: 0.15 });
  // White surface
  g.roundRect(x + 2, y + 2, 34, 18, 1).fill(0xfaf8f2);
  // Content: colored lines + shapes
  const cc = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b];
  for (let i = 0; i < 3; i++) {
    g.moveTo(x + 5, y + 5 + i * 5)
      .lineTo(x + 5 + 8 + Math.random() * 16, y + 5 + i * 5)
      .stroke({ width: 1, color: cc[i], alpha: 0.6 });
  }
  // Small sticky notes
  g.rect(x + 26, y + 4, 6, 5).fill({ color: 0xffee88, alpha: 0.8 });
  g.rect(x + 26, y + 11, 6, 5).fill({ color: 0x88eeff, alpha: 0.8 });
  // Marker tray
  g.roundRect(x + 8, y + 21, 22, 3, 1).fill(0x999999);
  // Markers
  g.roundRect(x + 10, y + 20, 2, 3, 0.5).fill(0x3366ff);
  g.roundRect(x + 13, y + 20, 2, 3, 0.5).fill(0xff3333);
  g.roundRect(x + 16, y + 20, 2, 3, 0.5).fill(0x33aa33);
  parent.addChild(g);
}

export { drawDesk, drawChair, drawPlant, drawWhiteboard };
