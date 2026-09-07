// بات ابری بله — گزارش آگهی شهرها بدون نیاز به لپ‌تاپ (روی GitHub Actions هر ~۵ دقیقه)
// توکن بات: secret روی ریپو (BALE_TOKEN) | state آفست: bale-bot-state.json (کامیت‌شونده)
// دستورها: راهنما | تست | لینک | وضعیت | گزارش [شهر] [pdf] | تحلیل [شهر] | گزارش تازه
// نکته: داده از آخرین همگام‌سازی لپ‌تاپ (final_data.json در ریپو)؛ واکشی زندهٔ ستادیران فقط از IP ایران.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  norm, listCities, resolveCity, loadCityData, dataDate,
  buildTextReport, buildAnalysis, buildHtmlReport, renderPdf,
} from './bale_report.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = String(process.env.BALE_TOKEN || '').trim();
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'najafibehzad/fardis-tenders';
const OWNER = String(process.env.BALE_OWNER || '1138576389'); // چت مالک (بهزاد)
const API = 'https://tapi.bale.ai/bot' + TOKEN;
const GHAPI = 'https://api.github.com/repos/' + REPO;
const SITE = 'https://najafibehzad.github.io/fardis-tenders';
const STATE_PATH = 'bale-bot-state.json';
const QUEUE_PATH = 'pending-commands.json';
const DATA_ROOT = path.join(ROOT, 'setadiran-data');

const HELP = [
  '🤖 بات ابری گزارش تدارکات — همیشه آنلاین (بدون نیاز به لپ‌تاپ)',
  '',
  'گزارش — آگهی‌های فردیس (متن کامل، جدیدترین در بالا)',
  'گزارش <شهر> — آگهی‌های هر شهرِ همگام‌شده (مثال: گزارش کرج)',
  'گزارش فردیس pdf — فایل PDF کامل آگهی‌ها',
  'تحلیل [شهر] — خلاصهٔ آماری + نزدیک‌ترین مهلت‌ها',
  'گزارش تازه — واکشی لحظه‌ای (لپ‌تاپ باید روشن باشد)',
  'وضعیت — وضعیت لپ‌تاپ و تاریخ داده',
  'لینک — گزارش آنلاین | تست — بررسی اتصال',
  '',
  '⚠️ گزارش ابری از آخرین همگام‌سازی داده است (تاریخش بالای گزارش ذکر می‌شود).',
].join('\n');

const log = s => console.log(new Date().toISOString(), s);
const b64 = o => Buffer.from(JSON.stringify(o, null, 1), 'utf8').toString('base64');
const tail = (s, n = 300) => { s = String(s || '').trim(); return s.length > n ? '…' + s.slice(-n) : s; };

// ---------- گیت‌هاب (state و صف) ----------
async function gh(method, p, body) {
  const r = await fetch(GHAPI + p, {
    method,
    headers: { Authorization: 'token ' + GH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'bale-cloud-bot', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  return { code: r.status, json: await r.json().catch(() => ({})) };
}
async function contentsGet(p) {
  const { code, json } = await gh('GET', `/contents/${p}?ref=main`);
  if (code === 404) return { data: null, sha: null };
  if (code !== 200) throw new Error('contents GET ' + p + ': ' + code);
  return { data: JSON.parse(Buffer.from(json.content, 'base64').toString('utf8')), sha: json.sha };
}
async function contentsUpdate(p, message, transform) {
  for (let i = 0; i < 4; i++) {
    const g = await contentsGet(p);
    const { code, json } = await gh('PUT', `/contents/${p}`, { message, branch: 'main', sha: g.sha || undefined, content: b64(transform(g.data)) });
    if (code >= 200 && code < 300) return;
    if (code !== 409 && code !== 422) throw new Error('contents PUT ' + p + ': ' + code + ' ' + tail(JSON.stringify(json)));
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('contents PUT ' + p + ': gave up');
}

// ---------- API بله ----------
async function baleApi(method, body) {
  const r = await fetch(API + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ': ' + (j.description || r.status));
  return j.result;
}
async function sendText(chat, text) {
  // بخش‌بندی برای سقف ~۴۰۰۰ نویسه
  const parts = [];
  let cur = '';
  for (const block of String(text).split('\n\n')) {
    if ((cur + '\n\n' + block).length > 3800 && cur) { parts.push(cur); cur = block; }
    else cur = cur ? cur + '\n\n' + block : block;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    try { await baleApi('sendMessage', { chat_id: chat, text: p.slice(0, 4000) }); }
    catch { await baleApi('sendMessage', { chat_id: chat, text: p.slice(0, 4000) }); } // بدون parse_mode — متن ساده
  }
}
function multipart(fields) {
  const b = '----balebot' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const parts = [];
  for (const f of fields) {
    let head = `--${b}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) head += `; filename="${f.filename.replace(/["\r\n]/g, '')}"`;
    if (f.contentType) head += `\r\nContent-Type: ${f.contentType}`;
    parts.push(Buffer.from(head + '\r\n\r\n'));
    parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(String(f.value)));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + b };
}
async function sendDocument(chat, filePath, caption) {
  const buf = fs.readFileSync(filePath);
  const { body, contentType } = multipart([
    { name: 'chat_id', value: chat },
    { name: 'caption', value: String(caption || '').slice(0, 900) },
    { name: 'document', value: buf, filename: path.basename(filePath), contentType: 'application/pdf' },
  ]);
  const r = await fetch(API + '/sendDocument', { method: 'POST', body, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(180000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('sendDocument: ' + (j.description || r.status));
}

// ---------- وضعیت لپ‌تاپ و داده ----------
async function laptopAlive() {
  try {
    const { code, json } = await gh('GET', '/actions/variables/LAPTOP_ALIVE');
    if (code !== 200) return 'نامشخص';
    const ageMin = (Date.now() - Number(json.value || 0)) / 60000;
    return ageMin < 4 ? 'روشن ✓ (گزارش تازه ممکن است)' : 'خاموش/خواب — ' + Math.round(ageMin) + ' دقیقه از آخرین نشانه گذشته';
  } catch { return 'نامشخص'; }
}
function cityLabelOf(dir) { return dir.replace(/^.+?[-–]/, '') || dir; }

// ---------- دستورها ----------
async function reportPayload(query, pdf) {
  const dir = resolveCity(DATA_ROOT, query);
  if (!dir) {
    const cs = listCities(DATA_ROOT);
    return { text: `شهر «${query || '…'}» هنوز همگام نشده است.\nشهرهای آماده: ${cs.map(cityLabelOf).join('، ')}\n\nبرای افزودن شهر جدید، اسکیل iran-setadiran-tenders را روی لپ‌تاپ برای آن شهر اجرا کن؛ بعد از push شدن داده، همین‌جا جواب می‌گیرد.` };
  }
  const items = loadCityData(DATA_ROOT, dir);
  const synced = dataDate(dir);
  const label = cityLabelOf(dir);
  if (!pdf) return { text: buildTextReport({ cityLabel: label, items, syncedFa: synced }) };
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = label.replace(/[^\w-]/g, '') || 'city';
  const htmlPath = path.join(ROOT, `report-${safe}-${stamp}.html`);
  const pdfPath = path.join(ROOT, `report-${safe}-${stamp}.pdf`);
  fs.writeFileSync(htmlPath, buildHtmlReport({ cityLabel: label, items, syncedFa: synced }));
  await renderPdf(htmlPath, pdfPath);
  return { text: `📄 گزارش کامل «${label}» (داده: ${synced})`, pdfPath, caption: `گزارش آگهی‌های ${label} — ${stamp}` };
}

async function freshReport(query, chat) {
  const dir = resolveCity(DATA_ROOT, query);
  const job = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), text: 'گزارش' + (dir && cityLabelOf(dir) !== 'فردیس' ? ' ' + cityLabelOf(dir) : ''), from: 'bale-cloud', ts: new Date().toISOString() };
  await contentsUpdate(QUEUE_PATH, 'bale-cloud-bale: fresh fetch job', cur => [...(Array.isArray(cur) ? cur.filter(j => Date.now() - Date.parse(j.ts || 0) < 86400000) : []), job]);
  const alive = await laptopAlive();
  return `درخواست واکشی لحظه‌ای ثبت شد ✅\nلپ‌تاپ: ${alive}\nاگر روشن باشد تا چند دقیقه PDF تازه می‌آید (از بات لپ‌تاپ). اگر خاموش است، با روشن شدنش اجرا می‌شود.\nدر همین حله «گزارش» را بفرست تا نسخهٔ ابریِ آخرین داده را فوراً بگیری.`;
}

async function handle(text, chat) {
  const t = norm(text);
  if (t === '/start' || t === 'start' || ['راهنما', 'کمک', '/help', 'help'].includes(t)) return sendText(chat, HELP);
  if (['تست', 'ping', '/ping'].includes(t)) return sendText(chat, 'سبزم ✓ بات ابری بله از گیت‌هاب جواب داد — بدون لپ‌تاپ.');
  if (['لینک', 'link', '/link'].includes(t)) return sendText(chat, `گزارش آنلاین: ${SITE}\nPDF: ${SITE}/report.pdf`);
  if (['وضعیت', '/status'].includes(t)) {
    const dir = resolveCity(DATA_ROOT, '');
    const alive = await laptopAlive();
    const cities = listCities(DATA_ROOT);
    return sendText(chat, `💻 لپ‌تاپ: ${alive}\n🗃 شهرهای همگام‌شده: ${cities.map(cityLabelOf).join('، ')}\n🗓 تاریخ دادهٔ ${cityLabelOf(dir)}: ${dir ? dataDate(dir) : '—'}\n☁️ بات ابری: هر ~۵ دقیقه چک می‌کند`);
  }
  // گزارش تازه
  if (/^(گزارش تازه|تازه|لحظه ای|لحظه‌ای)$/.test(t)) {
    const q = t.replace(/^(گزارش تازه|تازه|لحظه ای|لحظه‌ای)/, '').trim();
    return sendText(chat, await freshReport(q, chat));
  }
  // تحلیل [شهر]
  if (t.startsWith('تحلیل') || t.startsWith('انالیز') || t.startsWith('آنالیز')) {
    const q = t.replace(/^(تحلیل|انالیز|آنالیز)/, '').replace(/^(شهر)?\s*/, '').trim();
    const dir = resolveCity(DATA_ROOT, q || 'فردیس');
    if (!dir) return sendText(chat, 'شهری مطابقت نداشت؛ «راهنما» را ببین.');
    const items = loadCityData(DATA_ROOT, dir);
    return sendText(chat, buildAnalysis({ cityLabel: cityLabelOf(dir), items, syncedFa: dataDate(dir) }));
  }
  // گزارش [شهر] [pdf]
  if (t.startsWith('گزارش') || t === '/report') {
    let rest = t.replace(/^گزارش/, '').replace(/^(امروز|کامل)?\s*/, '').trim();
    const wantPdf = /(pdf|فایل|پی دی اف)/.test(rest);
    if (wantPdf) rest = rest.replace(/(pdf|فایل|پی دی اف)/g, '').trim();
    const msg = await reportPayload(rest, wantPdf);
    if (msg.pdfPath) { await sendDocument(chat, msg.pdfPath, msg.caption); return sendText(chat, msg.text); }
    return sendText(chat, msg.text);
  }
  return sendText(chat, 'دستور را نفهمیدم؛ «راهنما» را بفرست.');
}

// ---------- حلقه اصلی ----------
async function processUpdate(up) {
  const msg = up.message, text = msg?.text || '', chat = String(msg?.chat?.id ?? '');
  if (!text) return;
  log(`msg chat=${chat} text=${JSON.stringify(text.slice(0, 50))}`);
  const allowed = new Set([OWNER, ...(process.env.BALE_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean)]);
  if (!allowed.has(chat)) { log(`IGNORED foreign chat=${chat}`); return; }
  await handle(text, chat);
}

async function main() {
  const mode = process.argv[2] || '';
  if (!TOKEN) { // بدون توکن (تا secret ست نشده) بی‌صدا رد شو تا ورک‌فلو قرمز نشود
    console.log('BALE_TOKEN empty — skip (secret را در Settings ▸ Secrets ▸ Actions اضافه کن)'); return;
  }
  if (mode === '--send') { await sendText(OWNER, process.argv[3] || ''); log('manual send ok'); return; }
  if (mode === '--sendpdf') { await sendDocument(OWNER, process.argv[3], process.argv[4] || ''); log('manual pdf ok'); return; }
  const state = (await contentsGet(STATE_PATH)).data || {};
  const u = new URL(API + '/getUpdates');
  u.searchParams.set('timeout', '0');
  u.searchParams.set('limit', '20');
  if (state.offset) u.searchParams.set('offset', String(state.offset));
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('getUpdates: ' + (j.description || r.status) + (r.status === 403 ? ' — احتمالاً IP رانر بلاک است؛ probe را اجرا کن' : ''));
  const ups = j.result || [];
  let replies = 0, lastId = 0;
  for (const up of ups) {
    try { if (replies < 10) { await processUpdate(up); replies++; } }
    catch (e) { log('update ERR: ' + e.message); }
    lastId = up.update_id + 1;
  }
  if (lastId && state.offset !== lastId) {
    await contentsUpdate(STATE_PATH, 'bale-cloud-bale: offset', () => ({ offset: lastId }));
    log('offset committed ' + lastId);
  }
  log(`bale poll n=${ups.length} replies=${replies}`);
}
main().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
