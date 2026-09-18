import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PptxGenJS = require('pptxgenjs');
const html2pptx = require(path.join(__dirname, '..', '..', '..', 'tools', 'ppt_team_agent', '.claude', 'skills', 'pptx-skill', 'scripts', 'html2pptx.js'));

async function main() {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const slides = [
    'slide-01.html',
    'slide-02.html',
    'slide-03.html',
    'slide-04.html',
    'slide-05.html',
    'slide-06.html',
    'slide-07.html',
    'slide-08.html',
    'slide-09.html',
  ];

  for (const slideFile of slides) {
    const filePath = path.join(__dirname, slideFile);
    console.log(`Converting ${slideFile}...`);
    try {
      await html2pptx(filePath, pres);
      console.log(`  OK: ${slideFile}`);
    } catch (err) {
      console.error(`  ERROR in ${slideFile}: ${err.message}`);
    }
  }

  const outputPath = path.join(__dirname, '..', '2026-02-20T12-52-report-deck.pptx');
  await pres.writeFile({ fileName: outputPath });
  console.log(`\nPPTX written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
