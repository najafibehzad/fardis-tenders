#!/usr/bin/env node
// فهرست آگهی‌های تابعلو ی اعلانات مرکزی ستاد ایران برای یک شهر
// Usage: node fetch_announcements.js "البرز" "فردیس" ["orgFilter"] ["folderName"]
//   orgFilter: فیلتر نام دستگاه/عنوان — برای شهرهایی مثل محمدشهر/کمال‌شهر که زیرمجموعه کرج‌اند
//   folderName: نام پوشه خروجی (پیش‌فرض: استان-شهر) — جلوگیری از overwrite شهر مادر
// خروجی: setadiran-data/<پوشه>/all_items.json (+ prev_items.json، history.json، LAST.txt)
const https = require('https');
const fs = require('fs');
const path = require('path');

const ALLOWED_HOSTS = ['gw.setadiran.ir', 'etend.setadiran.ir', 'eproc.setadiran.ir', 'fe.setadiran.ir'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const BASE = 'https://gw.setadiran.ir/api/centralboard/cards/';

const province = process.argv[2];
const city = process.argv[3] || null;
const orgFilter = process.argv[4] || null;
const folderArg = process.argv[5] || null;
if (!province) { console.error('Usage: node fetch_announcements.js "<استان>" "<شهر>" ["orgFilter"] ["folderName"]'); process.exit(1); }

const safe = s => String(s).replace(/[^\p{L}\p{N}\-]+/gu, '-').replace(/^-+|-+$/g, '');
const folder = folderArg ? safe(folderArg) : safe([province, city].filter(Boolean).join('-'));
const outDir = path.join(process.cwd(), 'setadiran-data', folder);
if (!outDir.startsWith(path.join(process.cwd(), 'setadiran-data') + path.sep)) { console.error('bad folder path'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const norm = s => String(s || '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// درخواست با اعتبارسنجی میزبان — جلوگیری از تزریق هاست
const JAR = {};
let SESSION_H = { 'User-Agent': UA };
function get(url, headers) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) {
    return Promise.reject(new Error('host not allowed: ' + u.hostname));
  }
  return new Promise((res, rej) => {
    const h = Object.assign({ 'User-Agent': UA }, headers || {});
    const r = https.get(u, { headers: h }, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => res({ body: d, status: x.statusCode, setCookie: x.headers['set-cookie'] || [] }));
    });
    r.on('error', rej); r.setTimeout(25000, () => { r.destroy(); rej(new Error('timeout: ' + url)); });
  });
}
// سشن بوت استراپ — gw.setadiran.ir بدون سشن 428 برمی‌گرداند
async function bootstrapSession() {
  const r = await get('https://fe.setadiran.ir/centralboard', { 'Accept': 'text/html' });
  for (const c of r.setCookie) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) JAR[kv.slice(0, i)] = kv.slice(i + 1); }
  SESSION_H = {
    'User-Agent': UA, 'Accept': 'application/json',
    'Referer': 'https://fe.setadiran.ir/centralboard', 'Origin': 'https://fe.setadiran.ir',
    'Cookie': Object.entries(JAR).map(([k, v]) => k + '=' + v).join('; '),
  };
}
async function apiGet(url) {
  for (let a = 0; a < 4; a++) {
    const r = await get(url, SESSION_H);
    if (r.status === 428) { await bootstrapSession(); await sleep(3000); continue; }
    if (r.status !== 200) throw new Error('http ' + r.status + ' ' + url);
    return r.body;
  }
  throw new Error('rate-limited 428: ' + url);
}

(async () => {
  await bootstrapSession();
  // ۱) کد استان و شهر
  const raw = JSON.parse(await apiGet(BASE + 'setadCity?pageNumber=&pageSize=&sort=id,desc'));
  const rows = Array.isArray(raw) ? raw : (raw.content || []);
  const pick = (r, keys) => { for (const k of keys) if (r[k] != null) return r[k]; return undefined; };
  const nameOf = r => norm(pick(r, ['cityName', 'name', 'title', 'locName']));
  const idOf = r => pick(r, ['locId', 'id', 'loc_id']);
  const parentOf = r => pick(r, ['parentLocId', 'parentId', 'parent_id']);

  const provRow = rows.find(r => nameOf(r) === norm(province))
    || rows.find(r => nameOf(r).includes(norm(province)));
  if (!provRow) { console.error('PROVINCE NOT FOUND. Sample rows:'); console.error(JSON.stringify(rows.slice(0, 10), null, 1)); process.exit(2); }
  const provId = idOf(provRow);
  if (!provId) { console.error('bad province id'); process.exit(2); }

  let cityId = null;
  if (city) {
    let kids;
    try { kids = JSON.parse(await apiGet(BASE + 'setadCity?parentLocId=' + provId + '&pageNumber=&pageSize=&sort=id,desc')); }
    catch (e) { kids = null; }
    const kidRows = Array.isArray(kids) ? kids : ((kids && kids.content) || []);
    const pool = kidRows.length ? kidRows : rows.filter(r => String(parentOf(r)) === String(provId));
    const cityRow = pool.find(r => nameOf(r) === norm(city)) || pool.find(r => nameOf(r).includes(norm(city)));
    if (!cityRow) { console.error('CITY NOT FOUND in:', pool.map(nameOf).join(' | ')); process.exit(2); }
    cityId = idOf(cityRow);
    if (!cityId) { console.error('bad city id'); process.exit(2); }
  }
  const selectedCities = cityId != null ? provId + '-' + cityId : String(provId);
  console.log('selectedCities =', selectedCities);

  // ۲) صفحه‌بندی فهرست (سقف pageSize=10 — بزرگ‌تر نگیرید، dedupe می‌شود)
  const seen = new Set(); const out = [];
  for (let p = 0; p < 200; p++) {
    const url = BASE + '?searchTypeCode=0&selectedCities=' + encodeURIComponent(selectedCities) +
      '&queryText=&pageNumber=' + p + '&pageSize=10&sort=insertDate,desc';
    const j = JSON.parse(await apiGet(url));
    for (const it of (j.content || [])) if (!seen.has(it.number)) { seen.add(it.number); out.push(it); }
    if (out.length >= j.totalElements || !(j.content || []).length) break;
    await sleep(100);
  }

  // ۲ب) فیلتر نام دستگاه/عنوان (برای شهرهای بدون کد مستقل — مثل محمدشهر/کمال‌شهر)
  if (orgFilter) {
    const keys = orgFilter.split(/[,،|]+/).map(norm).filter(Boolean);
    const filtered = out.filter(it => {
      const hay = norm(it.orgName) + ' ' + norm(it.title);
      return keys.some(k => k && hay.includes(k));
    });
    console.log('org-filter [' + keys.join(' / ') + ']:', filtered.length, 'از', out.length);
    out.length = 0; out.push(...filtered);
  }

  // ۳) نسخه قبلی برای نشان «جدید» + تاریخچه اولین مشاهده + ترتیب جدیدترین-در-بالا
  const itemsPath = path.join(outDir, 'all_items.json');
  const hadPrev = fs.existsSync(itemsPath);
  if (hadPrev) {
    fs.copyFileSync(itemsPath, path.join(outDir, 'prev_items.json'));
    console.log('prev snapshot saved');
  }
  const histPath = path.join(outDir, 'history.json');
  let hist = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : { runs: 0, firstSeen: {} };
  hist.runs += 1;
  const nowIso = new Date().toISOString();
  for (const it of out) {
    const k = String(it.number);
    if (!hist.firstSeen[k]) hist.firstSeen[k] = { iso: nowIso, run: hist.runs, baseline: !hadPrev };
  }
  fs.writeFileSync(histPath, JSON.stringify(hist, null, 1), 'utf8');
  out.forEach((it, i) => { it.orderIdx = i; });
  fs.writeFileSync(path.join(outDir, '..', 'LAST.txt'), folder, 'utf8');
  fs.writeFileSync(itemsPath, JSON.stringify(out, null, 1), 'utf8');
  const by = {}; out.forEach(i => by[i.boardName] = (by[i.boardName] || 0) + 1);
  console.log('TOTAL UNIQUE:', out.length, '| BY BOARD:', JSON.stringify(by));
  console.log('WROTE', itemsPath);
})().catch(e => { console.error(e); process.exit(1); });
