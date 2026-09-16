// اندازه‌گیری ارتفاع اجزای measure.html (تولیدشده توسط gen_city_report.js)
// اجرا از همان پوشه کاری که gen_city_report.js اجرا شده.
let chromium;
try { chromium = require('playwright-core').chromium; } catch { chromium = require('playwright').chromium; }
const fs = require('fs');
const path = require('path');
// مسیرها per-city: از پوشه داده شهر جاری در setadiran-data (همان قرارداد gen_city_report.js)
const rootDir = path.join(process.cwd(), 'setadiran-data');
const lastPath = path.join(rootDir, 'LAST.txt');
let baseDir = process.cwd();
if (fs.existsSync(lastPath)) {
  const folder = fs.readFileSync(lastPath, 'utf8').trim();
  const dataDir = path.resolve(rootDir, folder);
  if (dataDir.startsWith(rootDir + path.sep)) baseDir = dataDir;
}
const IN = path.join(baseDir, 'measure.html');
const OUT = path.join(baseDir, 'heights.json');
const CHROME = process.env.CHROME_PATH || '';
const launchOpts = { headless: true };
if (CHROME) launchOpts.executablePath = CHROME;

(async () => {
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 } });
  const page = await ctx.newPage();
  await page.goto('file:///' + IN.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const heights = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-m]').forEach(el => {
      out[el.getAttribute('data-m')] = Math.ceil(el.getBoundingClientRect().height);
    });
    return out;
  });
  // نسخهٔ چیدمان از gen (تگ layout-v در measure.html) همراه ارتفاع‌ها ذخیره می‌شود تا بی‌اعتباری ارتفاع‌های قدیمی قابل تشخیص باشد
  const layoutV = await page.evaluate(() => (document.querySelector('meta[name="layout-v"]') || {}).content || null);
  fs.writeFileSync(OUT, JSON.stringify(layoutV ? Object.assign({ __layout: layoutV }, heights) : heights), 'utf8');
  const keys = Object.keys(heights);
  console.log('MEASURED', keys.length, 'elements');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
