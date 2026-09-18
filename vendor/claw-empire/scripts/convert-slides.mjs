/**
 * Convert HTML slides to PPTX using Playwright screenshots + PptxGenJS
 * Bypasses html2pptx.js CJS/ESM conflict
 */
import { chromium } from "playwright";
import PptxGenJS from "pptxgenjs";
import { readdir } from "fs/promises";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");

async function main() {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE"; // 13.33" x 7.5"

  const slidesDir = resolve(projectRoot, "slides");
  const files = (await readdir(slidesDir)).filter((f) => f.endsWith(".html")).sort();

  console.log(`Found ${files.length} slides to convert...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  for (const file of files) {
    const filePath = join(slidesDir, file);
    const page = await context.newPage();

    try {
      await page.goto(`file://${filePath}`, { waitUntil: "networkidle" });

      // Wait a moment for fonts/images to load
      await page.waitForTimeout(1000);

      // Get body dimensions from CSS
      const dims = await page.evaluate(() => {
        const body = document.body;
        const style = getComputedStyle(body);
        return {
          width: parseFloat(style.width),
          height: parseFloat(style.height),
        };
      });

      // Set viewport to match body dimensions
      await page.setViewportSize({
        width: Math.ceil(dims.width),
        height: Math.ceil(dims.height),
      });

      // Wait for re-layout
      await page.waitForTimeout(300);

      // Screenshot the body element
      const screenshot = await page.locator("body").screenshot({
        type: "png",
        scale: "device", // Ensure 1:1 pixel mapping
      });

      // Convert buffer to base64
      const base64 = screenshot.toString("base64");

      // Add slide with full-bleed image
      const slide = pres.addSlide();
      slide.addImage({
        data: `image/png;base64,${base64}`,
        x: 0,
        y: 0,
        w: "100%",
        h: "100%",
      });

      console.log(`  ✓ ${file} (${Math.round(dims.width)}x${Math.round(dims.height)}px)`);
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const outputPath = resolve(projectRoot, "docs/reports/2026-02-20T12-52-report-deck.pptx");
  await pres.writeFile({ fileName: outputPath });
  console.log(`\nPPTX saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
