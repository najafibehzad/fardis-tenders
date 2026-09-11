#!/usr/bin/env node
// گزارش لحظه‌ای آگهی‌های هر شهر از سامانه ستاد ایران — با یک دستور
// Usage: node city_report.mjs "<شهر>" [استان] [--open] [--no-open]
//   شهر: نام فارسی شهر (الزامی) — استان: اختیاری، خودش از لیست شهرهای سامانه حل می‌شود
//   --no-open : PDF بعد از ساخت باز نشود
// همه‌چیز از cwd این فایل اجرا می‌شود؛ خروجی: PDF روی دسکتاپ + report.pdf/html داخل ریپو
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.chdir(HERE); // همه اسکریپت‌ها از cwd می‌خوانند — همیشه ریشه ریپو

// ---------- آرگومان‌ها ----------
const args = process.argv.slice(2);
const open = !args.includes('--no-open');
const positional = args.filter(a => !a.startsWith('--'));
if (!positional.length) {
  console.error('Usage: node city_report.mjs "<شهر>" [استان] [--no-open]');
  process.exit(1);
}
const city = positional[0];
let province = positional[1] || null;

// ---------- یافتن استان شهر (وقتی کاربر نداده) از API عمومی ستاد ایران ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
function request(u) {
  return new Promise((res, rej) => {
    const r = https.get(u, { headers: { 'User-Agent': UA } }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.setTimeout(40000, () => { r.destroy(); rej(new Error('timeout')); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function apiGetJson(pathname, params, tries = 3) {
  const u = new URL('https://gw.setadiran.ir' + pathname);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  let last;
  for (let t = 0; t < tries; t++) {
    try { return JSON.parse(await request(u)); }
    catch (e) { last = e; if (t < tries - 1) await sleep(900); }
  }
  throw last;
}
const norm = s => String(s || '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();
// فیلد نام در این API «locName» است؛ بقیه نام‌ها برای اطمینان می‌مانند
const pick = (r, keys) => { for (const k of keys) if (r[k] != null) return r[k]; };
const nameOf = r => norm(pick(r, ['locName', 'cityName', 'name', 'title']));
const idOf = r => { const v = pick(r, ['locId', 'id', 'loc_id']); const s = String(v == null ? '' : v).trim(); return /^\d{1,12}$/.test(s) ? s : undefined; };
const parentOf = r => pick(r, ['parentLocId', 'parentId', 'parent_id']);

// نگاشت شهر→استان: یک بار از فرزندان همه استان‌ها ساخته و کش می‌شود (30 روز اعتبار)
const mapPath = path.join(HERE, 'setadiran-data', 'city-map.json');
async function buildCityMap(provRows) {
  const map = {}; // شهرِ نرمال‌شده → { province, cityId, provId }
  let cursor = 0;
  async function w() {
    while (true) {
      const i = cursor++;
      if (i >= provRows.length) break;
      const provId = idOf(provRows[i]);
      const provName = nameOf(provRows[i]);
      if (!provId || !provName) continue;
      try {
        const kids = await apiGetJson('/api/centralboard/cards/setadCity', { parentLocId: provId, pageNumber: '', pageSize: '', sort: 'id,desc' }, 2);
        const kidRows = Array.isArray(kids) ? kids : ((kids && kids.content) || []);
        for (const k of kidRows) {
          const kid = idOf(k);
          if (kid && nameOf(k)) map[nameOf(k)] = { province: provName, cityId: kid, provId };
        }
      } catch { /* استان موقت در دسترس نبود — بقیه را می‌سازیم */ }
    }
  }
  await Promise.all([w(), w(), w(), w(), w(), w()]);
  return map;
}
async function resolveProvince() {
  const raw = await apiGetJson('/api/centralboard/cards/setadCity', { pageNumber: '', pageSize: '', sort: 'id,desc' });
  const rows = Array.isArray(raw) ? raw : (raw.content || []);
  // ردیف‌های برگردانده‌شده خودشان استان‌اند (locType=92؛ فرزندانشان با parentLocId گرفته می‌شوند)
  const provRows = rows.filter(r => idOf(r) && nameOf(r));
  // کش تازه؟
  let map = null;
  try {
    const c = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    if (c.map && Object.keys(c.map).length && Date.now() - new Date(c.builtAt).getTime() < 30 * 86400e3) map = c.map;
  } catch { /* کش نبود — می‌سازیم */ }
  const findHit = m => m[norm(city)] || (Object.entries(m).find(([k]) => k.includes(norm(city))) || [null, null])[1];
  let hit = map ? findHit(map) : null;
  if (!hit) {
    console.log('building city→province map (یک بار، چند ثانیه)…');
    map = await buildCityMap(provRows);
    fs.mkdirSync(path.dirname(mapPath), { recursive: true });
    fs.writeFileSync(mapPath, JSON.stringify({ builtAt: new Date().toISOString(), map }, null, 1), 'utf8');
    hit = findHit(map);
    if (!hit) {
      console.error('شهر پیدا نشد: «' + city + '» — نمونه: ' + Object.keys(map).slice(0, 30).join(' | '));
      process.exit(2);
    }
  }
  console.log('PROVINCE-RESOLVED:', city, '→', hit.province, `(city=${hit.cityId} prov=${hit.provId})`);
  return hit.province;
}
if (!province) province = await resolveProvince();

// ---------- زنجیرهٔ گزارش ----------
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const envChrome = { env: { ...process.env, CHROME_PATH: CHROME } };
const run = (file, cmdArgs = [], opts = {}) => {
  console.log('\n===== ' + file + ' ' + cmdArgs.join(' ') + ' =====');
  const r = spawnSync(process.execPath, [file, ...cmdArgs], { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error('FAILED at ' + file + ' (exit ' + r.status + ')');
    process.exit(r.status || 1);
  }
};
// خروجی را هم برمی‌گرداند تا معلوم شود gen به measure-mode رفته یا مستقیم گزارش ساخته
const runCapture = file => {
  console.log('\n===== ' + file + ' =====');
  const r = spawnSync(process.execPath, [file], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) { console.error('FAILED at ' + file + ' (exit ' + r.status + ')'); process.exit(r.status || 1); }
  return r.stdout || '';
};
console.log(`CITY REPORT: ${province} / ${city} — ${new Date().toLocaleString('fa-IR')}`);

const t0 = Date.now();
run('fetch_announcements.js', [province, city]);
run('fetch_details.js');
const g1 = runCapture('gen_city_report.js');
if (g1.includes('MEASURE_FIRST')) {
  run('measure.js', [], envChrome);   // ارتفاع کارت‌ها با Chrome اندازه‌گیری شد
  run('gen_city_report.js');          // → report.html نهایی
} else {
  console.log('(ارتفاع‌های این شهر از قبل معتبرند — از اندازه‌گیری صرف‌نظر شد)');
}
run('qa_report.js', [], envChrome);  // کنترل کیفی قطعی — exit 1 روی خطا
run('render.js', [], envChrome);

// ---------- تحویل: PDF نام‌دار روی دسکتاپ + باز شدن ----------
const desktop = 'C:\\Desktop';
const items = JSON.parse(fs.readFileSync(path.join(HERE, 'setadiran-data', fs.readFileSync(path.join(HERE, 'setadiran-data', 'LAST.txt'), 'utf8').trim(), 'final_data.json'), 'utf8'));
const tenders = items.filter(i => i.board === 'مناقصه' && i.tender).length;
const services = items.filter(i => i.board === 'خرید' && i.purchase && i.purchase.kind === 'خدمت').length;

// تاریخ شمسی امروز برای نام فایل (formatToParts مطمئن‌تر از رجکس روی رشته است)
const jParts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const jGet = t => Number((jParts.find(p => p.type === t) || {}).value);
const dateStr = `${jGet('year')}-${String(jGet('month')).padStart(2, '0')}-${String(jGet('day')).padStart(2, '0')}`;

const out = path.join(desktop, `گزارش آگهی‌های ${city} ${dateStr}.pdf`);
fs.copyFileSync(path.join(HERE, 'report.pdf'), out);
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\nDONE in ${secs}s — مناقصه: ${tenders} | استعلام خدمات: ${services}`);
console.log('PDF:', out);

if (open) {
  // Invoke-Item با -LiteralPath برای مسیرهای فارسی/نیم‌فاصله امن است (آرگومان‌ها UTF-16 به PowerShell می‌رسند)
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Invoke-Item -LiteralPath '${out.replace(/'/g, "''")}'`], { stdio: 'ignore' });
    if (r.status !== 0) console.log('OPEN-FAILED status=' + r.status);
  } catch (e) { console.log('OPEN-FAILED', e.message); }
}
