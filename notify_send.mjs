// ارسال گزارش روزانه به کانال‌های اطلاع‌رسانی — تنظیمات در notify.local.json (گیت‌آگنورده؛ هرگز کامیت نشود)
// Usage:
//   node notify_send.mjs                     → ارسال PDF + خلاصه به همه کانال‌های تنظیم‌شده
//   node notify_send.mjs --alert "متن"       → فقط پیام متنی (هشدار خطا)
//   node notify_send.mjs --setup telegram --token <TOKEN>   → ثبت توکن و پیدا کردن chat_id
//   node notify_send.mjs --setup bale --token <TOKEN>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CFG_PATH = path.join(ROOT, 'notify.local.json');
const loadCfg = () => (fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) : {});
const saveCfg = c => fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 1), 'utf8');

// برای تلگرام در ایران: عبور از پراکسی محلی فیلترشکن (مثلاً http://127.0.0.1:10809)
// بدنه multipart به‌صورت دستی ساخته می‌شود تا وابسته به کلاس FormData هیچ نسخه‌ای نباشد.
let U = null;
try { U = await import('undici'); } catch {}
const proxyAgents = new Map();
function dispatcherFor(proxy) {
  if (!proxyAgents.has(proxy)) proxyAgents.set(proxy, new U.ProxyAgent(proxy));
  return proxyAgents.get(proxy);
}

// توکن ربات فقط این قالب را می‌تواند داشته باشد (ضد تزریق در مسیر URL)
const botTokenOk = t => /^\d{5,14}:[A-Za-z0-9_-]{25,60}$/.test(String(t || '').trim());

const BASES = { telegram: 'https://api.telegram.org', bale: 'https://tapi.bale.ai' };

// fields: [{ name, value, filename?, contentType? }]
function multipart(fields) {
  const boundary = '----fardis' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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

async function parseBotJson(r) {
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || 'HTTP ' + r.status);
  return j.result;
}

async function botPost(channel, token, method, fields) {
  const base = BASES[channel];
  const u = new URL(base + '/bot' + token + '/' + method); // token قبلاً با regex اعتبارسنجی شده
  if (u.origin !== base) throw new Error('bad request target');
  const { body, contentType } = multipart(fields);
  const init = { method: 'POST', body, headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(120000) };
  const r = (cfg[channel]?.proxy && U)
    ? await U.fetch(u, { ...init, dispatcher: dispatcherFor(cfg[channel].proxy) })
    : await fetch(u, init);
  return parseBotJson(r);
}

async function sendFile(channel, c, cap, pdfPath, fileName) {
  return botPost(channel, c.token, 'sendDocument', [
    { name: 'chat_id', value: c.chatId },
    { name: 'caption', value: cap.slice(0, 900) },
    { name: 'document', value: fs.readFileSync(pdfPath), filename: fileName, contentType: 'application/pdf' },
  ]);
}

async function sendText(channel, c, text) {
  return botPost(channel, c.token, 'sendMessage', [
    { name: 'chat_id', value: c.chatId },
    { name: 'text', value: text.slice(0, 3500) },
  ]);
}

async function sendMail(smtp, subject, text, pdfPath, fileName) {
  const nodemailer = (await import('nodemailer')).default ?? (await import('nodemailer'));
  const tr = nodemailer.createTransport({
    host: smtp.host, port: Number(smtp.port) || 465, secure: String(smtp.secure ?? 'true') === 'true',
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 60000,
  });
  const att = pdfPath && fs.existsSync(pdfPath)
    ? [{ filename: fileName, content: fs.readFileSync(pdfPath), contentType: 'application/pdf' }] : [];
  await tr.sendMail({ from: smtp.user, to: smtp.to, subject, text, attachments: att });
}

function reportState() {
  const last = fs.readFileSync(path.join(ROOT, 'setadiran-data', 'LAST.txt'), 'utf8').trim();
  const dir = path.join(ROOT, 'setadiran-data', last);
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'final_data.json'), 'utf8'));
  const prevP = path.join(dir, 'prev_items.json');
  const prev = fs.existsSync(prevP) ? new Set(JSON.parse(fs.readFileSync(prevP, 'utf8')).map(i => String(i.number))) : new Set();
  const tenders = items.filter(i => i.board === 'مناقصه' && i.tender);
  const services = items.filter(i => i.board === 'خرید' && i.purchase && i.purchase.kind === 'خدمت');
  const fresh = items.filter(i => prev.size > 0 && !prev.has(String(i.number))).length;
  return { tenders: tenders.length, services: services.length, fresh };
}

function todayJalaliHyphen() {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = t => (parts.find(p => p.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function buildCaption() {
  const s = reportState();
  const today = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
  return [
    `📋 گزارش روزانه تدارکات — شهر فردیس`,
    `📅 ${today}`,
    `مناقصه: ${s.tenders} | استعلام خدمات: ${s.services}${s.fresh ? ` | 🆕 جدید: ${s.fresh}` : ''}`,
    `🔗 https://najafibehzad.github.io/fardis-tenders/`,
  ].join('\n');
}

const args = process.argv.slice(2);
const cfg = loadCfg();

if (args[0] === '--setup') {
  const channel = args[1];
  const token = (args[3] || '').trim();
  if (!BASES[channel]) { console.error('SETUP-ERROR unknown channel'); process.exit(1); }
  if (!botTokenOk(token)) { console.error('SETUP-ERROR token format looks wrong'); process.exit(1); }
  cfg[channel] = { ...(cfg[channel] || {}), token };
  saveCfg(cfg);
  const j = await botPost(channel, token, 'getUpdates', []);
  const chats = new Map();
  for (const u of j) {
    const m = u.message || u.edited_message || u.channel_post || u.my_chat_member?.chat;
    const c = m?.chat;
    if (c) chats.set(c.id, { id: String(c.id), type: c.type, title: c.title || c.username || c.first_name || '' });
  }
  console.log('TOKEN-SAVED for', channel);
  if (chats.size === 0) console.log('NO-CHATS-YET: اول در', channel, 'به ربات خودت /start بده و این دستور را دوباره اجرا کن');
  else for (const c of chats.values()) console.log('CHAT-FOUND id=' + c.id, '(' + c.type + ')', c.title);
} else if (args[0] === '--alert') {
  const text = '⚠️ ' + (args[1] || 'گزارش روزانه ساخته نشد') + '\n' + new Date().toLocaleString('fa-IR');
  const out = [];
  for (const ch of ['telegram', 'bale']) {
    if (cfg[ch]?.token && cfg[ch]?.chatId) {
      try { await sendText(ch, cfg[ch], text); out.push(ch + '=OK'); }
      catch (e) { out.push(ch + '=FAIL(' + e.message + ')'); }
    }
  }
  if (cfg.smtp?.host) {
    try { await sendMail(cfg.smtp, 'هشدار: گزارش روزانه فردیس', text, null); out.push('smtp=OK'); }
    catch (e) { out.push('smtp=FAIL(' + e.message + ')'); }
  }
  console.log('ALERT ' + (out.join(' ') || 'no-channels-configured'));
} else {
  const cap = buildCaption();
  const fileName = 'Fardis-Alborz-Tenders-' + todayJalaliHyphen() + '.pdf';
  const pdfPath = path.join(ROOT, 'report.pdf');
  const out = [];
  for (const ch of ['telegram', 'bale']) {
    if (cfg[ch]?.token && cfg[ch]?.chatId) {
      try { await sendFile(ch, cfg[ch], cap, pdfPath, fileName); out.push(ch + '=OK'); }
      catch (e) { out.push(ch + '=FAIL(' + String(e.message).slice(0, 120) + ')'); }
    } else out.push(ch + '=SKIP');
  }
  if (cfg.smtp?.host) {
    try { await sendMail(cfg.smtp, 'گزارش روزانه فردیس — ' + todayJalaliHyphen(), cap, pdfPath, fileName); out.push('smtp=OK'); }
    catch (e) { out.push('smtp=FAIL(' + String(e.message).slice(0, 120) + ')'); }
  } else out.push('smtp=SKIP');
  console.log('NOTIFY ' + out.join(' '));
}
