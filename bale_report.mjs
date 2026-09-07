// سازندهٔ گزارش آگهی یک شهر — متن (بله) + PDF (Vazirmatn + playwright)
// ورودی: setadiran-data/<استان-شهر>/final_data.json  |  خروجی: متن گزارش / فایل PDF
// قواعد: فارسی، مهلت‌گذشته قرمز/❌[گذشته]، جدیدترین در بالا (ترتیب خود برد)، شماره فراخوان کامل
// بدون وابستگی اجباری — playwright فقط برای PDF (نصب تنبل در ابر/محلی)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// ---------- تقویم شمسی (همان الگوی امتحان‌شدهٔ gen_city_report.js) ----------
export function todayJalali() {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = t => Number((parts.find(p => p.type === t) || {}).value);
    return { y: get('year'), m: get('month'), d: get('day') };
  } catch { return null; }
}
const TZ = 'Asia/Tehran';
export function todayFaLong() {
  try {
    const d = new Date();
    const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ }).format(d);
    const time = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(d);
    return date + ' — ساعت ' + time;
  } catch { return ''; }
}
const jNum = s => { const m = String(s || '').match(/(\d{4})\/(\d{2})\/(\d{2})/); return m ? Number(m[1] + m[2] + m[3]) : null; };
const effDl = it => jNum(it.docDeadline && it.docDeadline !== ' - ' ? it.docDeadline : '') || jNum(it.sendDeadline);
export function isExpired(it) {
  const t = todayJalali(); if (!t) return false;
  const dl = effDl(it);
  return !!(dl && dl < t.y * 10000 + t.m * 100 + t.d);
}

// ---------- نرمال‌سازی و شهر ----------
export const norm = t => String(t || '')
  .replace(/[\u064A\u0649]/g, '\u06CC').replace(/\u0643/g, '\u06A9')
  .replace(/\u200c/g, ' ').replace(/[\u064B-\u0652\u0670]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();
export function listCities(rootDir) {
  try { return fs.readdirSync(rootDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); }
  catch { return []; }
}
// فردیس → البرز-فردیس  (تطبیق انعطافی روی نام پوشه‌ها)
export function resolveCity(rootDir, query) {
  const dirs = listCities(rootDir);
  if (!dirs.length) return null;
  const q = norm(query);
  if (!q) { const last = (fs.readFileSync(path.join(rootDir, 'LAST.txt'), 'utf8') || '').trim(); return dirs.includes(last) ? last : dirs[0]; }
  const exact = dirs.find(d => norm(d) === q || norm(d).replace(/^.+?[-–]/, '') === q);
  if (exact) return exact;
  const partial = dirs.find(d => norm(d).includes(q) || q.includes(norm(d).replace(/^.+?[-–]/, '')));
  return partial || null;
}

// ---------- قالب‌بندی ----------
const faNum = n => { try { return new Intl.NumberFormat('fa-IR').format(n); } catch { return String(n); } };
const riyal = n => (n == null || n === '' ? null : faNum(Number(String(n).replace(/[^\d]/g, '')) || 0) + ' ریال');
const cleanTitle = s => String(s || '').replace(/\s+/g, ' ').trim();

export function loadCityData(rootDir, cityDir) {
  const p = path.join(rootDir, cityDir, 'final_data.json');
  const items = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(items)) throw new Error('bad dataset');
  return items;
}
// تاریخ داده: آخرین کامیت روی final_data.json (در Actions گیت موجود است)
export function dataDate(cityDir) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ci', '--', path.join('setadiran-data', cityDir, 'final_data.json')], { timeout: 10000 }).toString().trim();
    if (!out) return '—';
    const d = new Date(out);
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ }).format(d)
      + ' (' + new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(d) + ')';
  } catch { return '—'; }
}

// ---------- گروه‌بندی ----------
export function groupItems(items) {
  const g = {
    'مناقصه': items.filter(i => i.board === 'مناقصه'),
    'خدمات': items.filter(i => String(i.needType) === '1431'),
    'کالا': items.filter(i => String(i.needType) === '1432'),
    'مزایده': items.filter(i => i.board === 'مزایده'),
  };
  for (const k of Object.keys(g)) {
    g[k] = [...g[k]].sort((a, b) => (a.orderIdx ?? 0) - (b.orderIdx ?? 0)); // جدیدترین (اول برد) در بالا
  }
  return g;
}
const activeOf = arr => arr.filter(i => !isExpired(i));
const pastOf = arr => arr.filter(i => isExpired(i));

// ---------- متن گزارش برای بله ----------
function itemLines(it, opts = {}) {
  const exp = isExpired(it);
  const L = [];
  const tag = exp ? '❌ [گذشته]' : '✅';
  L.push(`${tag} ${cleanTitle(it.title).slice(0, opts.titleMax || 110)}`);
  L.push(`   شماره فراخوان: ${it.number}`);
  if (it.org) L.push(`   دستگاه: ${it.org}`);
  const pr = riyal(it.basePrice);
  if (pr) L.push(`   ارزش پایه: ${pr}`);
  if (it.sendDeadline) L.push(`   مهلت ارسال: ${it.sendDeadline}${exp ? '' : ''}`);
  if (it.docDeadline && it.docDeadline !== ' - ') L.push(`   مهلت اسناد: ${it.docDeadline}`);
  return L.join('\n');
}
export function buildTextReport({ cityLabel, items, syncedFa, maxMozayde = 8 }) {
  const g = groupItems(items);
  const P = [];
  P.push(`📋 گزارش آگهی‌های «${cityLabel}»`);
  P.push(`🗓 ${todayFaLong()}`);
  P.push(`🗃 منبع: ستادیران | دادهٔ همگام‌شده: ${syncedFa}`);
  P.push('━━━━━━━━━━━━━━━━━━━━');
  const section = (name, arr, opts = {}) => {
    const act = activeOf(arr), past = pastOf(arr);
    P.push('');
    P.push(`🔹 ${name}: ${faNum(arr.length)} مورد (${faNum(act.length)} فعال / ${faNum(past.length)} گذشته)`);
    if (!arr.length) { P.push('   موردی ثبت نشده است.'); return; }
    act.forEach(it => { P.push(''); P.push(itemLines(it, opts)); });
    past.forEach(it => { P.push(''); P.push(itemLines(it, opts)); });
    if (opts.summary && arr.length > act.length + (opts.summaryKeep ?? 0)) {
      const shown = act.length + (opts.summaryKeep ?? 0);
      P.push('');
      P.push(`   … ${faNum(arr.length - shown)} مورد دیگر — فایل PDF کامل را بخواه: «گزارش ${cityLabel} pdf»`);
    }
  };
  section('مناقصه‌ها', g['مناقصه'], { titleMax: 120 });
  section('استعلام خدمات', g['خدمات'], { titleMax: 100 });
  section('کالا', g['کالا'], { titleMax: 100 });
  // مزایده: خلاصه (فعال‌ها تا سقف مشخص + شمارنده)
  const mz = g['مزایده'], mzAct = activeOf(mz), mzPast = pastOf(mz);
  P.push('');
  P.push(`🔹 مزایده‌ها: ${faNum(mz.length)} مورد (${faNum(mzAct.length)} فعال / ${faNum(mzPast.length)} گذشته)`);
  if (!mz.length) P.push('   موردی ثبت نشده است.');
  else {
    mzAct.slice(0, maxMozayde).forEach(it => { P.push(''); P.push(itemLines(it, { titleMax: 90 })); });
    if (mzAct.length > maxMozayde) { P.push(''); P.push(`   … ${faNum(mzAct.length - maxMozayde)} مزایدهٔ فعال دیگر + ${faNum(mzPast.length)} گذشته — PDF کامل: «گزارش ${cityLabel} pdf»`); }
    else if (mzPast.length) { P.push(''); P.push(`   (${faNum(mzPast.length)} مزایدهٔ مهلت‌گذشته — PDF کامل: «گزارش ${cityLabel} pdf»)`); }
  }
  P.push('');
  P.push('💡 «تحلیل ' + cityLabel + '» = خلاصهٔ آماری | «گزارش ' + cityLabel + ' pdf» = فایل کامل');
  return P.join('\n');
}

// ---------- تحلیل آماری ----------
export function buildAnalysis({ cityLabel, items, syncedFa }) {
  const g = groupItems(items);
  const L = [];
  L.push(`📊 تحلیل آگهی‌های «${cityLabel}» — ${todayFaLong()}`);
  L.push(`🗃 دادهٔ همگام‌شده: ${syncedFa}`);
  L.push('━━━━━━━━━━━━━━━━━━━━');
  const row = name => {
    const arr = g[name] || [], a = activeOf(arr), p = pastOf(arr);
    const vals = a.map(i => Number(i.basePrice) || 0).filter(v => v > 0);
    const sum = vals.reduce((x, y) => x + y, 0);
    L.push(`• ${name}: ${faNum(arr.length)} کل | ${faNum(a.length)} فعال | ${faNum(p.length)} گذشته${sum ? ` | جمع ارزش فعال‌ها ≈ ${faNum(sum)} ریال` : ''}`);
  };
  ['مناقصه', 'خدمات', 'کالا', 'مزایده'].forEach(row);
  // نزدیک‌ترین مهلت‌های فعال
  const upcoming = Object.values(g).flat().filter(i => !isExpired(i) && i.sendDeadline)
    .sort((a, b) => (jNum(a.sendDeadline) || 0) - (jNum(b.sendDeadline) || 0)).slice(0, 5);
  L.push('');
  L.push('⏳ نزدیک‌ترین مهلت‌های فعال:');
  upcoming.forEach(i => L.push(`  ${i.number} — ${cleanTitle(i.title).slice(0, 60)}\n    مهلت: ${i.sendDeadline}`));
  // بزرگ‌ترین برآوردها
  const top = Object.values(g).flat().filter(i => !isExpired(i) && Number(i.basePrice) > 0)
    .sort((a, b) => Number(b.basePrice) - Number(a.basePrice)).slice(0, 5);
  if (top.length) {
    L.push('');
    L.push('💰 بزرگ‌ترین ارزش‌های فعال:');
    top.forEach(i => L.push(`  ${faNum(i.basePrice)} ریال — ${cleanTitle(i.title).slice(0, 55)} (${i.number})`));
  }
  L.push('');
  L.push('⚠️ داده از آخرین همگام‌سازی لپ‌تاپ است؛ برای واکشی لحظه‌ای: «گزارش تازه» (نیازمند روشن بودن لپ‌تاپ).');
  return L.join('\n');
}

// ---------- HTML + PDF ----------
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function buildHtmlReport({ cityLabel, items, syncedFa }) {
  const g = groupItems(items);
  const tbl = (name, arr, accent) => {
    const a = activeOf(arr), p = pastOf(arr);
    const rows = [...a, ...p].map(it => {
      const exp = isExpired(it);
      const pr = riyal(it.basePrice);
      return `<div class="item${exp ? ' exp' : ''}">
        <div class="row1"><span class="tag${exp ? ' red' : ''}">${exp ? 'گذشته' : 'فعال'}</span>
        <span class="num">فراخوان ${esc(String(it.number))}</span></div>
        <div class="ttl">${esc(cleanTitle(it.title))}</div>
        <div class="meta">${it.org ? ' دستگاه: <b>' + esc(it.org) + '</b> ·' : ''}${pr ? ' ارزش پایه: <b>' + esc(pr) + '</b> ·' : ''}
        مهلت ارسال: <b>${esc(it.sendDeadline || '—')}</b>${it.docDeadline && it.docDeadline !== ' - ' ? ' · مهلت اسناد: <b>' + esc(it.docDeadline) + '</b>' : ''}</div>
      </div>`;
    }).join('');
    return `<h2 style="border-right:5px solid ${accent}">${esc(name)} <span class="cnt">${faNum(arr.length)} مورد — ${faNum(a.length)} فعال / ${faNum(p.length)} گذشته</span></h2>${rows || '<div class="none">موردی ثبت نشده است.</div>'}`;
  };
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>گزارش ${esc(cityLabel)}</title>
<style>
@font-face{font-family:Vazirmatn;src:url('fonts/Vazirmatn-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:Vazirmatn;src:url('fonts/Vazirmatn-Bold.woff2') format('woff2');font-weight:700}
@font-face{font-family:Vazirmatn;src:url('fonts/Vazirmatn-Medium.woff2') format('woff2');font-weight:500}
@page{size:A4;margin:11mm 10mm}
*{box-sizing:border-box}
body{font-family:Vazirmatn,sans-serif;font-size:10.5px;color:#1a1a1a;margin:0}
h1{font-size:17px;margin:0 0 2px}
.sub{color:#555;font-size:9.5px;margin-bottom:8px}
h2{font-size:12.5px;margin:14px 0 6px;padding-right:8px}
h2 .cnt{font-size:9px;color:#555;font-weight:400;margin-right:6px}
.item{border:1px solid #d8dde3;border-radius:6px;padding:6px 9px;margin-bottom:5px;break-inside:avoid}
.item.exp{background:#fdf3f2;border-color:#e8b7b2}
.item.exp .ttl{color:#b02a20}
.row1{display:flex;gap:8px;align-items:center;margin-bottom:2px}
.tag{background:#e8f6ee;color:#177245;font-size:8px;padding:1px 7px;border-radius:9px;font-weight:700}
.tag.red{background:#fdecea;color:#c0392b}
.num{font-size:8.5px;color:#555;direction:ltr}
.ttl{font-weight:700;font-size:11px;line-height:1.7;margin-bottom:2px}
.meta{font-size:9px;color:#444;line-height:1.9}
.none{color:#777;font-size:9.5px}
.head{border-bottom:2.5px solid #14532d;padding-bottom:6px;margin-bottom:4px}
.brand{font-size:8.5px;color:#777;margin-top:3px}
</style></head><body>
<div class="head"><h1>📋 گزارش آگهی‌های تدارکات الکترونیکی دولت — ${esc(cityLabel)}</h1>
<div class="sub">🗓 ${esc(todayFaLong())} &nbsp;|&nbsp; 🗃 منبع: سامانه ستادیران — دادهٔ همگام‌شده: ${esc(syncedFa)} &nbsp;|&nbsp; آگهی‌های مهلت‌گذشته با رنگ قرمز</div></div>
${tbl('مناقصه‌ها', g['مناقصه'], '#14532d')}${tbl('استعلام خدمات', g['خدمات'], '#1d4ed8')}${tbl('کالا', g['کالا'], '#7c3aed')}${tbl('مزایده‌ها', g['مزایده'], '#b45309')}
<div class="brand">کارپوشهٔ تدارکات — تولید خودکار توسط بات ابری بله (بعد از مهلت، آگهی با برچسب «گذشته»)</div>
</body></html>`;
}

// رندر PDF — playwright (نصب تنبل) یا Chrome سیستم از CHROME_PATH
export async function renderPdf(htmlPath, pdfPath) {
  let chromium = null;
  const require = createRequire(import.meta.url);
  try { chromium = require('playwright').chromium; }
  catch { console.log('installing playwright…'); execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.dirname(htmlPath), timeout: 300000, stdio: 'inherit' }); chromium = require('playwright').chromium; }
  const opts = { headless: true };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  let browser;
  try { browser = await chromium.launch(opts); }
  catch { console.log('installing chromium…'); execFileSync('npx', ['playwright', 'install', 'chromium', '--with-deps'], { cwd: path.dirname(htmlPath), timeout: 600000, stdio: 'inherit' }); browser = await chromium.launch(opts); }
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
  } finally { await browser.close(); }
  return pdfPath;
}

// ---------- CLI محلی: node bale_report.mjs <شهر> [pdf|text|analysis] ----------
if (process.argv[1] && process.argv[1].endsWith('bale_report.mjs')) {
  const rootDir = path.join(process.cwd(), 'setadiran-data');
  const q = process.argv[2] || '';
  const mode = process.argv[3] || 'text';
  const dir = resolveCity(rootDir, q);
  if (!dir) { console.error('شهر یافت نشد. شهرهای موجود: ' + listCities(rootDir).join(' , ')); process.exit(1); }
  const items = loadCityData(rootDir, dir);
  const synced = dataDate(dir);
  const cityLabel = dir.replace(/^.+?[-–]/, '') || dir;
  if (mode === 'pdf') {
    const htmlPath = path.join(process.cwd(), 'report-' + cityLabel + '.html');
    const pdfPath = path.join(process.cwd(), 'report-' + cityLabel + '.pdf');
    fs.writeFileSync(htmlPath, buildHtmlReport({ cityLabel, items, syncedFa: synced }));
    renderPdf(htmlPath, pdfPath).then(() => console.log('PDF: ' + pdfPath));
  } else if (mode === 'analysis') {
    console.log(buildAnalysis({ cityLabel, items, syncedFa: synced }));
  } else {
    console.log(buildTextReport({ cityLabel, items, syncedFa: synced }));
  }
}
