// بات دوطرفهٔ بله برای گزارش تدارکات — هر شهر
// Usage:
//   node bale_bot.mjs                  → یک دور getUpdates + پردازش پیام‌ها (تسک FardisBaleBot هر ۱ دقیقه)
//   node bale_bot.mjs --send "متن"     → ارسال پیام متنی به چت مالک (برای تست/اعلان)
//   node bale_bot.mjs --selftest       → اجرای هندلر روی پیام‌های فرضی بدون ارسال واقعی
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'notify.local.json'), 'utf8'));
const TOKEN = String(CFG?.bale?.token || '').trim();
const OWNER = String(CFG?.bale?.chatId || '').trim();
const botTokenOk = t => /^\d{5,14}:[A-Za-z0-9_-]{25,60}$/.test(t);
if (!botTokenOk(TOKEN) || !OWNER) { console.error('bale creds missing/invalid in notify.local.json'); process.exit(1); }
const API = 'https://tapi.bale.ai/bot' + TOKEN;

const STATE_PATH = path.join(ROOT, 'bale-bot-state.json');
const LOCK_PATH = path.join(ROOT, 'bale-bot.lock');
const ALLOW_PATH = path.join(ROOT, 'bale-bot-allow.json');
const BASH = 'C:\\Users\\behzad\\AppData\\Local\\hermes\\git\\usr\\bin\\bash.exe';
const SITE = 'https://najafibehzad.github.io/fardis-tenders';
const HELP = [
  '🤖 ربات گزارش تدارکات (هر شهر)',
  '',
  'گزارش — گزارش فردیس (پیش‌فرض)',
  'گزارش قدس — گزارش شهر قدس',
  'گزارش تهران قدس — استان + شهر',
  'گزارش کرج — شهر کرج',
  'وضعیت — وضعیت آخرین اجرا',
  'لینک — آدرس گزارش آنلاین',
  'تست — بررسی اتصال',
  'راهنما — همین فهرست',
  '',
  'مثال: گزارش اصفهان نجف آباد',
  'وقتی لپ‌تاپ خاموش است، دستور را به ربات تلگرام بفرستید (صف می‌شود).',
].join('\n');

// شهرهای پرکاربرد → استان پیش‌فرض (اگر فقط نام شهر داده شود)
const CITY_PROVINCE = {
  'فردیس': 'البرز', 'کرج': 'البرز', 'نظرآباد': 'البرز', 'ساوجبلاغ': 'البرز',
  'قدس': 'تهران', 'رباط کریم': 'تهران', 'رباطکریم': 'تهران', 'شهریار': 'تهران',
  'اسلامشهر': 'تهران', 'ملارد': 'تهران', 'پردیس': 'تهران', 'ورامین': 'تهران',
  'ری': 'تهران', 'تهران': 'تهران',
  'نجف آباد': 'اصفهان', 'نجفآباد': 'اصفهان', 'کاشان': 'اصفهان', 'اصفهان': 'اصفهان',
  'مشهد': 'خراسان رضوی', 'نیشابور': 'خراسان رضوی',
  'شیراز': 'فارس', 'تبریز': 'آذربایجان شرقی', 'اهواز': 'خوزستان',
  'قم': 'قم', 'اراک': 'مرکزی', 'همدان': 'همدان', 'کرمانشاه': 'کرمانشاه',
};

function parseReportCmd(raw) {
  // «گزارش» | «گزارش قدس» | «گزارش تهران قدس» | «/report تهران قدس»
  let t = String(raw || '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\/?report\b/i, 'گزارش').trim();
  if (!t.startsWith('گزارش')) return null;
  let rest = t.slice('گزارش'.length).replace(/^[:\-–—\s]+/, '').trim();
  if (!rest || rest === 'امروز' || rest === 'فوری') return { province: 'البرز', city: 'فردیس' };
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const city = parts[0];
    const province = CITY_PROVINCE[city] || CITY_PROVINCE[city.replace(/\s+/g, '')] || 'البرز';
    return { province, city };
  }
  if (parts.length >= 2) {
    // آخرین بخش = شهر، بقیه = استان (برای نام‌های چندکلمه‌ای مثل خراسان رضوی)
    const city = parts[parts.length - 1];
    const province = parts.slice(0, -1).join(' ');
    return { province, city };
  }
  return { province: 'البرز', city: 'فردیس' };
}

const GH_REPO = 'najafibehzad/fardis-tenders';
const GHTOK_PATH = path.join(os.homedir(), '.zcode', 'fardis-ghtoken');
const QUEUE_PATH = 'pending-commands.json';
async function ghApi(method, pathname, body) {
  const tok = fs.readFileSync(GHTOK_PATH, 'utf8').trim();
  const r = await fetch('https://api.github.com/repos/' + GH_REPO + pathname, {
    method,
    headers: { Authorization: 'token ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'bale-bot-local', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  return { code: r.status, json: await r.json().catch(() => ({})) };
}
async function heartbeat() {
  try {
    let r = await ghApi('PATCH', '/actions/variables/LAPTOP_ALIVE', { value: String(Date.now()) });
    if (r.code === 404) r = await ghApi('POST', '/actions/variables', { name: 'LAPTOP_ALIVE', value: String(Date.now()) });
    if (r.code >= 300) log('heartbeat status ' + r.code);
  } catch (e) { log('heartbeat ERR ' + e.message); }
}
async function drainQueue() {
  try {
    const g = await ghApi('GET', '/contents/' + QUEUE_PATH + '?ref=main');
    if (g.code !== 200) return;
    let jobs;
    try { jobs = JSON.parse(Buffer.from(g.json.content, 'base64').toString('utf8')); } catch { return; }
    if (!Array.isArray(jobs) || !jobs.length) return;
    const done = new Set();
    for (const j of jobs) {
      try {
        if (!j.ts || Date.now() - Date.parse(j.ts) > 86400000) { done.add(j.id); continue; }
        await handle(j.text, sendTo(OWNER));
        done.add(j.id);
      } catch (e) { log('queue job ERR ' + e.message); done.add(j.id); }
    }
    for (let i = 0; i < 3; i++) {
      const fresh = await ghApi('GET', '/contents/' + QUEUE_PATH + '?ref=main');
      if (fresh.code !== 200) return;
      let cur = [];
      try { cur = JSON.parse(Buffer.from(fresh.json.content, 'base64').toString('utf8')); } catch {}
      const next = (Array.isArray(cur) ? cur : []).filter(j => !done.has(j.id));
      const p = await ghApi('PUT', '/contents/' + QUEUE_PATH, {
        message: 'bale queue drain', branch: 'main', sha: fresh.json.sha,
        content: Buffer.from(JSON.stringify(next, null, 1), 'utf8').toString('base64'),
      });
      if (p.code >= 200 && p.code < 300) { log('queue drained n=' + done.size); return; }
      if (p.code !== 409 && p.code !== 422) { log('queue PUT ' + p.code); return; }
    }
  } catch (e) { log('drain ERR ' + e.message); }
}

const log = s => console.log(new Date().toISOString(), s);
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } };
const saveState = s => fs.writeFileSync(STATE_PATH, JSON.stringify(s), 'utf8');
const readAllow = () => { try { return JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8')).map(String); } catch { return []; } };
const norm = t => String(t).replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

function multipart(fields) {
  const boundary = '----balebot' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const parts = [];
  for (const f of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) head += `; filename="${f.filename.replace(/["\r\n]/g, '')}"`;
    if (f.contentType) head += `\r\nContent-Type: ${f.contentType}`;
    parts.push(Buffer.from(head + '\r\n\r\n'));
    parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(String(f.value)));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + boundary };
}
async function api(method, fields) {
  const { body, contentType } = multipart(fields);
  const r = await fetch(`${API}/${method}`, { method: 'POST', body, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || 'HTTP ' + r.status);
  return j.result;
}
const sendTo = chat => async payload => {
  if (payload.text != null) return api('sendMessage', [{ name: 'chat_id', value: chat }, { name: 'text', value: String(payload.text).slice(0, 4000) }]);
  if (payload.doc) {
    const buf = fs.readFileSync(payload.doc);
    return api('sendDocument', [
      { name: 'chat_id', value: chat },
      { name: 'caption', value: String(payload.caption || '').slice(0, 1000) },
      { name: 'document', value: buf, filename: path.basename(payload.doc), contentType: 'application/pdf' },
    ]);
  }
};

const tail = (s, n = 700) => { s = String(s || '').trim(); return s.length > n ? '…' + s.slice(-n) : s; };
const run = (cmd, args, timeout, env) => new Promise(res => {
  execFile(cmd, args, { cwd: ROOT, timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env: env || process.env },
    (err, so, se) => res({ code: err && err.code != null ? err.code : (err ? 1 : 0), out: tail((so || '') + '\n' + (se || '')) }));
});
async function taskStatus(name) {
  const r = await new Promise(res => execFile('schtasks', ['/query', '/tn', name, '/fo', 'csv', '/nh'], { timeout: 15000, windowsHide: true }, (e, so) => res(e ? '' : String(so))));
  return r;
}

function statusText() {
  const lines = [];
  try {
    const mt = fs.statSync(path.join(ROOT, 'report.pdf')).mtime;
    lines.push('گزارش فعلی: ' + mt.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }));
  } catch { lines.push('گزارش فعلی: یافت نشد'); }
  try {
    const last = fs.readFileSync(path.join(ROOT, 'setadiran-data', 'LAST.txt'), 'utf8').trim();
    lines.push('آخرین شهر: ' + last);
  } catch {}
  try {
    const t = fs.readFileSync(path.join(ROOT, 'task-run.log'), 'utf8').trimEnd().split('\n').filter(Boolean).slice(-5);
    lines.push('انتهای لاگ روزانه:', ...t.map(l => '  ' + l.slice(0, 110)));
  } catch {}
  lines.push('اجرای روزانه: هر روز ۱۵:۰۰ (فردیس) | بات: هر ۱ دقیقه');
  return lines.join('\n');
}

async function reportFlow(send, province, city) {
  if (process.argv[2] === '--selftest') return send({ text: `[گزارش ${province}/${city}: در selftest پایپ‌لاین واقعی اجرا نمی‌شود]` });
  if (fs.existsSync(LOCK_PATH) && Date.now() - fs.statSync(LOCK_PATH).mtimeMs < 20 * 60 * 1000)
    return send({ text: 'یک اجرا در جریان است؛ چند دقیقه دیگر نتیجه می‌آید.' });
  if (/running|در حال اجرا/i.test(await taskStatus('FardisTenderDaily')))
    return send({ text: 'اجرای زمان‌بندی‌شدهٔ امروز همین حالا در جریان است؛ نتیجه‌اش خودش ارسال می‌شود.' });
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  try {
    await send({ text: `در حال اجرای پایپ‌لاین برای «${province} / ${city}»… چند دقیقه طول می‌کشد.` });
    const env = { ...process.env, CHROME_PATH: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' };
    const p = await run(process.execPath, ['run_pipeline.mjs', province, city], 20 * 60 * 1000, env);
    if (p.code !== 0) { log('pipeline FAIL ' + p.out); return send({ text: 'پایپ‌لاین شکست خورد:\n' + p.out }); }
    const q = await run(BASH, ['scheduled_push.sh'], 5 * 60 * 1000, env);
    const pushOk = q.code === 0;
    if (!pushOk) log('push FAIL ' + q.out);
    const pdf = path.join(ROOT, 'report.pdf');
    await send({ doc: pdf, caption: `گزارش تدارکات ${province} / ${city} — ` + new Date().toLocaleDateString('fa-IR') + (pushOk ? '' : '\n⚠️ انتشار گیت‌هاب شکست خورد؛ PDF محلی فرستاده شد') });
    await send({ text: SITE + (pushOk ? ' (به‌روز شد)' : '') });
  } finally { fs.rmSync(LOCK_PATH, { force: true }); }
}

async function handle(text, send) {
  const t = norm(text);
  if (t === '/start' || t === 'start' || ['راهنما', 'کمک', '/help', 'help'].includes(t)) return send({ text: HELP });
  if (['تست', 'ping', '/ping'].includes(t)) return send({ text: 'سبزم ✓ اتصال دوطرفه برقرار است.' });
  if (['لینک', 'link', '/link'].includes(t)) return send({ text: `گزارش آنلاین: ${SITE}\nPDF: ${SITE}/report.pdf` });
  if (['وضعیت', '/status'].includes(t)) return send({ text: statusText() });
  const loc = parseReportCmd(text);
  if (loc) return reportFlow(send, loc.province, loc.city);
  return send({ text: 'دستور را نفهمیدم؛ «راهنما» را بفرست.\nمثال: گزارش قدس' });
}

async function processUpdate(u) {
  const msg = u.message;
  const chat = String(msg?.chat?.id ?? '');
  const text = msg?.text || '';
  if (!text) return;
  log(`msg chat=${chat} text=${JSON.stringify(text.slice(0, 60))}`);
  if (![OWNER, ...readAllow()].includes(chat)) { log(`IGNORED foreign chat=${chat}`); return; }
  try { await handle(text, sendTo(chat)); }
  catch (e) { log('handle ERR: ' + e.message); try { await sendTo(chat)({ text: 'خطا در پردازش دستور: ' + e.message }); } catch {} }
}
async function main() {
  const mode = process.argv[2] || '';
  if (mode === '--send') { await sendTo(OWNER)({ text: process.argv[3] || '' }); log('manual send ok'); return; }
  if (mode === '--selftest') {
    const out = [];
    const send = async p => out.push(p.text != null ? p.text : `[doc ${p.doc ? path.basename(p.doc) : ''}] ${p.caption || ''}`);
    for (const m of ['راهنما', 'تست', 'لینک', 'وضعیت', 'سلام', 'گزارش', 'گزارش قدس', 'گزارش تهران قدس']) {
      out.push('>> ' + m);
      await handle(m, send);
    }
    console.log(out.join('\n'));
    return;
  }
  const state = readState();
  const u = new URL(API + '/getUpdates');
  u.searchParams.set('timeout', '0');
  u.searchParams.set('limit', '20');
  if (state.offset) u.searchParams.set('offset', String(state.offset));
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || 'HTTP ' + r.status);
  for (const up of j.result || []) {
    await processUpdate(up);
    state.offset = up.update_id + 1;
    saveState(state);
  }
  await heartbeat();
  await drainQueue();
  log(`poll n=${(j.result || []).length}`);
}
main().catch(e => { log('FATAL: ' + e.message); console.error(e); process.exit(1); });
