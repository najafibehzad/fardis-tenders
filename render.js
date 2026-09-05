let chromium;
try { chromium = require('playwright-core').chromium; } catch { chromium = require('playwright').chromium; }
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '';
const launchOpts = { headless: true };
if (CHROME) launchOpts.executablePath = CHROME;

// Usage: node render.js   (از پوشه کاری پایپ‌لاین؛ ورودی/خروجی ثابت)
// Renders report.html → report.pdf (vector, system Chrome via CHROME_PATH or playwright chromium),
// sets metadata, and saves 2x PNGs of every .page element into ./pages-report/.
const WORK = path.resolve(process.cwd());
const IN = path.join(WORK, 'report.html');
const OUT = path.join(WORK, 'report.pdf');

(async () => {
  const pngDir = path.join(WORK, 'pages-report');
  fs.mkdirSync(pngDir, { recursive: true });
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 1300 } });
  const page = await ctx.newPage();

  await page.goto('file:///' + IN.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // overflow diagnostics: content taller than the fixed .page container?
  const diag = await page.evaluate(() =>
    [...document.querySelectorAll('.page')].map((p, i) => {
      const inner = p.querySelector('.content') || p;
      return { page: i + 1, overflow: inner.scrollHeight > inner.clientHeight, byPx: inner.scrollHeight - inner.clientHeight };
    })
  );
  console.log('OVERFLOW-DIAG ' + JSON.stringify(diag));

  // per-page PNGs (2x) for visual review
  const els = await page.$$('.page');
  for (let i = 0; i < els.length; i++) {
    await els[i].screenshot({ path: path.join(pngDir, `page-${i + 1}.png`) });
  }

  // vector PDF (page.pdf — never screenshots)
  const pdfBytes = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  fs.writeFileSync(OUT, pdfBytes);

  // metadata
  try {
    const doc = await PDFDocument.load(pdfBytes);
    doc.setTitle(await page.title());
    doc.setAuthor('fardis-tenders');
    doc.setCreator('fardis-tenders');
    doc.setProducer('fardis-tenders');
    fs.writeFileSync(OUT, await doc.save());
    console.log('METADATA set, pages=' + doc.getPageCount());
  } catch (e) {
    console.log('METADATA-SKIP ' + e.message);
  }

  const size = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('DONE pdf=' + OUT + ' sizeKB=' + size + ' pages=' + els.length + ' pngs=' + pngDir);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
