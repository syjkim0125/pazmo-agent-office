import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function generate() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const outputDir = path.resolve(__dirname, "..", "public", "sprites");
  fs.mkdirSync(outputDir, { recursive: true });

  const width = 508;
  const height = 847;

  const colors = {
    pink: "#FFB7C5",
    darkPink: "#E75480",
    white: "#FFFFFF",
    gold: "#FFD700",
    black: "#333333",
    red: "#FF0000",
    shadow: "rgba(0,0,0,0.1)",
  };

  // SVG Helper with 508x847 aspect ratio
  // Character centered, approximately 400x600 within the frame
  const drawDoroSVG = (dir, frame) => {
    let headY = dir === "D" && (frame === 2 || frame === 3) ? 20 : 0;
    let bounceY = dir === "D" && (frame === 2 || frame === 3) ? 10 : 0;
    let flip = dir === "R" ? 'transform="scale(-1, 1)" transform-origin="center"' : "";

    return `
      <svg width="${width}" height="${height}" viewBox="0 0 508 847" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
        <g ${flip}>
          <!-- Shadow -->
          <ellipse cx="254" cy="780" rx="150" ry="40" fill="${colors.shadow}" />

          <!-- Feet -->
          <rect x="180" y="730" width="60" height="30" fill="${colors.white}" rx="15" />
          <rect x="268" y="730" width="60" height="30" fill="${colors.white}" rx="15" />

          <!-- Body (Doraemon Suit) -->
          <rect x="150" y="450" width="208" height="300" fill="${colors.pink}" rx="50" transform="translate(0, ${bounceY})" />
          <circle cx="254" cy="620" r="80" fill="${colors.white}" transform="translate(0, ${bounceY})" />
          <path d="M 174 620 A 80 80 0 0 0 334 620" fill="none" stroke="${colors.black}" stroke-width="2" transform="translate(0, ${bounceY})" />

          <!-- Collar & Bell -->
          <rect x="180" y="440" width="148" height="20" fill="${colors.red}" rx="10" transform="translate(0, ${headY})" />
          <circle cx="254" cy="465" r="25" fill="${colors.gold}" transform="translate(0, ${headY})" />
          <circle cx="254" cy="465" r="5" fill="${colors.black}" transform="translate(0, ${headY})" />

          <!-- Head -->
          <rect x="100" y="150" width="308" height="300" fill="${colors.pink}" rx="120" transform="translate(0, ${headY})" />
          <rect x="140" y="220" width="228" height="200" fill="${colors.white}" rx="80" transform="translate(0, ${headY})" />

          <!-- Face Features -->
          <rect x="190" y="300" width="15" height="15" fill="${colors.black}" transform="translate(0, ${headY})" />
          <rect x="303" y="300" width="15" height="15" fill="${colors.black}" transform="translate(0, ${headY})" />
          <!-- :3 Mouth -->
          <path d="M 234 360 Q 244 380 254 360 Q 264 380 274 360" fill="none" stroke="${colors.black}" stroke-width="5" stroke-linecap="round" transform="translate(0, ${headY})" />
          
          <!-- Rose Accessory -->
          <g transform="translate(320, 120) translate(0, ${headY})">
             <circle cx="40" cy="40" r="50" fill="${colors.darkPink}" />
             <path d="M 40 40 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0" fill="none" stroke="white" stroke-width="3" />
             <rect x="0" y="70" width="20" height="20" fill="#9370DB" rx="5" /> <!-- Purple bow -->
          </g>

          <!-- Arms (Waving if frame 2/3) -->
          <rect x="80" y="500" width="80" height="40" fill="${colors.pink}" rx="20" transform="rotate(${frame === 2 ? -30 : 0}, 150, 520)" />
          <rect x="348" y="500" width="80" height="40" fill="${colors.pink}" rx="20" transform="rotate(${frame === 3 ? 30 : 0}, 358, 520)" />
        </g>
      </svg>
    `;
  };

  const frames = [
    { name: "13-D-1", dir: "D", f: 1 },
    { name: "13-D-2", dir: "D", f: 2 },
    { name: "13-D-3", dir: "D", f: 3 },
    { name: "13-L-1", dir: "L", f: 1 },
    { name: "13-R-1", dir: "R", f: 1 },
  ];

  for (const f of frames) {
    const svg = Buffer.from(drawDoroSVG(f.dir, f.f));
    await sharp(svg)
      .png()
      .toFile(path.join(outputDir, `${f.name}.png`));
    console.log(`Saved: ${f.name}.png`);
  }
}

generate().catch(console.error);
