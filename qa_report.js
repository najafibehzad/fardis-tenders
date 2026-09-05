// کنترل کیفی قطعی گزارش (جایگزین سریع بازبینی LLM برای همه موارد قابل‌اندازه‌گیری)
// Usage: node qa_report.js   (از همان پوشه‌ای که report.html و setadiran-data هستند)
// خروجی: PASS/FAIL به تفکیک چک + exit code (0=pass، 1=fail)
let chromium;
try { chromium = require('playwright-core').chromium; } catch { chromium = require('playwright').chromium; }
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '';
const launchOpts = { headless: true };
if (CHROME) launchOpts.executablePath = CHROME;

const rootDir = path.join(process.cwd(), 'setadiran-data');
const folder = fs.readFileSync(path.join(rootDir, 'LAST.txt'), 'utf8').trim();
const dataPath = path.join(rootDir, folder, 'final_data.json');
const prevPath = path.join(rootDir, folder, 'prev_items.json');
const items = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const prevSet = fs.existsSync(prevPath) ? new Set(JSON.parse(fs.readFileSync(prevPath, 'utf8')).map(i => String(i.number))) : null;
const isNew = it => prevSet && prevSet.size > 0 && !prevSet.has(String(it.number));

const FA = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
const toFa = s => String(s).replace(/[0-9]/g, d => FA[+d]);
const faNum = n => toFa(String(n));
const jn = s => { const m = String(s || '').match(/(\d{4})\/(\d{2})\/(\d{2})/); return m ? Number(m[1] + m[2] + m[3]) : null; };
function todayJalali() {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = t => Number((parts.find(p => p.type === t) || {}).value);
  return g('year') * 10000 + g('month') * 100 + g('day');
}
const T = todayJalali();
const isExpired = it => {
  const dl = jn(it.docDeadline && it.docDeadline !== ' - ' ? it.docDeadline : '') || jn(it.sendDeadline);
  return !!(dl && dl < T);
};
const expect = {
  tenders: items.filter(i => i.board === 'مناقصه' && i.tender).sort((a, b) => (a.orderIdx - b.orderIdx) || String(b.number).localeCompare(String(a.number))),
  services: items.filter(i => i.board === 'خرید' && i.purchase && i.purchase.kind === 'خدمت').sort((a, b) => (a.orderIdx - b.orderIdx) || String(b.number).localeCompare(String(a.number))),
};
const rendered = [...expect.tenders, ...expect.services];
const expiredItems = rendered.filter(isExpired);
const newItems = rendered.filter(isNew);

(async () => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) console.log('FAIL:', name, '—', detail); };

  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1300 } });
  const page = await ctx.newPage();
  const reportPath = path.resolve(process.cwd(), 'report.html');
  await page.goto('file:///' + reportPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  // داده‌های هر صفحه از DOM واقعی
  const pages = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.page')).map((p, i) => {
      const content = p.querySelector('.content') || p;
      const foot = p.querySelector('.foot');
      return {
        i: i + 1,
        text: (p.innerText || '').replace(/\u200c/g, ' '),
        overflow: content.scrollHeight - content.clientHeight,
        hasRunhead: !!p.querySelector('.runhead'),
        footText: foot ? foot.innerText.replace(/\s+/g, ' ') : '',
        rowExpired: p.querySelectorAll('.row-expired').length,
        expiredSpans: p.querySelectorAll('.expired').length,
        newtags: p.querySelectorAll('.newtag').length,
        newChips: p.querySelectorAll('.tchip.new').length,
        hasAucHeader: p.innerText.includes('قیمت پایه') && p.innerText.includes('شرح مزایده'),
        hasPublishCol: p.innerText.includes('زمان ارسال به صفحه اعلام'),
      };
    });
  });
  await browser.close();

  const totalN = pages.length;
  const docText = pages.map(p => p.text).join('\n');

  // ۱) سرریز و صفحه خالی
  const overflowPages = pages.filter(p => p.overflow > 0).map(p => p.i);
  check('no-overflow', overflowPages.length === 0, 'pages: ' + overflowPages.join(','));
  const blank = pages.filter(p => p.text.trim().length < 150).map(p => p.i);
  check('no-blank-pages', blank.length === 0, 'pages: ' + blank.join(','));

  // ۲) سربرگ و پانوشت همه صفحات (جلد به‌جای runhead، نوار متا دارد)
  const noRunhead = pages.filter(p => p.i > 1 && !p.hasRunhead).map(p => p.i);
  check('runhead-every-page', noRunhead.length === 0, 'pages: ' + noRunhead.join(','));
  const badFoot = pages.filter(p => !p.footText.includes('صفحه') || !p.footText.includes(faNum(p.i)) || !p.footText.includes(faNum(totalN))).map(p => p.i);
  check('footer-page-numbers', badFoot.length === 0, 'pages: ' + badFoot.join(','));

  // ۳) حضور تک‌تک اگهی‌های رندرشده (مناقصات + خدمات)
  const missing = [];
  for (const it of rendered) {
    if (!docText.includes(faNum(it.number))) missing.push(it.number);
  }
  check('all-announcements-present', missing.length === 0, 'missing: ' + missing.join(','));

  // ۴) ترتیب «جدیدترین در بالا» در هر سکشن: توالی شماره‌ها در صفحات سکشن باید با انتظار یکی باشد
  function sectionPages(secKey) {
    return pages.filter(p => p.text.includes(secKey));
  }
  function orderCheck(secKey, expected, label) {
    const sp = sectionPages(secKey);
    if (!sp.length) { check('order-' + label, false, 'section pages not found'); return; }
    const seq = [];
    for (const p of sp) {
      const faNums = p.text.match(new RegExp('[' + FA.join('') + ']{14,16}', 'g')) || [];
      for (const f of faNums) {
        const latin = f.split('').map(c => FA.indexOf(c)).join('');
        if (expected.find(e => String(e.number) === latin)) seq.push(latin);
      }
    }
    const expSeq = expected.map(e => String(e.number));
    const uniqSeen = [...new Set(seq)];
    const ok = expSeq.length === uniqSeen.length && expSeq.every((n, idx) => n === uniqSeen[idx]);
    check('order-' + label, ok, 'seen=' + uniqSeen.slice(0, 6).join(',') + '… expected=' + expSeq.slice(0, 6).join(',') + '…');
  }
  orderCheck('بخش ۱', expect.tenders, 'tenders');
  orderCheck('بخش ۲', expect.services, 'services');

  // ۵) قرمزها: تعداد تاریخ‌های قرمز >= تعداد محاسبه‌شده مهلت‌های گذشته
  const expiredSpans = pages.reduce((s, p) => s + p.expiredSpans, 0);
  check('expired-dates-red', expiredSpans >= expiredItems.length, 'spans=' + expiredSpans + ' expected≥' + expiredItems.length);

  // ۶) بج‌های جدید (فقط وقتی prev موجود است)
  if (prevSet) {
    const newChips = pages.reduce((s, p) => s + p.newChips, 0);
    check('new-badges', newChips >= newItems.length, 'chips=' + newChips + ' newItems=' + newItems.length);
  }

  // ۷) ستون زمان اعلام در همه صفحات محتوایی
  const noPub = pages.filter(p => p.i > 1 && (p.text.includes('بخش ۱') || p.text.includes('بخش ۲')) && !p.hasPublishCol).map(p => p.i);
  check('publish-column-present', noPub.length === 0, 'pages: ' + noPub.join(','));

  // ۸) نام شهر در سند
  const city = (items.find(i => i.city) || {}).city || '';
  check('title-has-city', !city || docText.includes(city), 'city=' + city);

  const fails = results.filter(r => !r.ok);
  console.log('QA SUMMARY: ' + (fails.length ? 'FAIL (' + fails.length + ')' : 'ALL PASS') + ' | checks=' + results.length + ' | pages=' + totalN + ' | items=' + items.length);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
