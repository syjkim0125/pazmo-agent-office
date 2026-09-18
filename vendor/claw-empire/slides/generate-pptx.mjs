import PptxGenJS from "pptxgenjs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const html2pptx = require("./html2pptx.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9"; // 10" × 5.625" = 720pt × 405pt

  const slides = [
    "slide-01.html",
    "slide-02.html",
    "slide-03.html",
    "slide-04.html",
    "slide-05.html",
    "slide-06.html",
    "slide-07.html",
    "slide-08.html",
    "slide-09.html",
    "slide-10.html",
  ];

  for (const slideFile of slides) {
    const filePath = path.join(__dirname, slideFile);
    console.log(`Converting ${slideFile}...`);
    try {
      await html2pptx(filePath, pres);
      console.log(`  ✓ ${slideFile} done`);
    } catch (err) {
      console.error(`  ✗ ${slideFile} error: ${err.message}`);
    }
  }

  const outputPath = path.join(__dirname, "..", "docs", "reports", "2026-02-20T12-25-report-deck.pptx");
  await pres.writeFile({ fileName: outputPath });
  console.log(`\nPPTX saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
