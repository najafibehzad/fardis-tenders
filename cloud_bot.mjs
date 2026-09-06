// بات ابری گزارش فردیس — روی GitHub Actions اجرا می‌شود (bale-cloud.yml، هر ۵ دقیقه)
// کانال: ربات تلگرام (api.telegram.org از سرور خارجی باز است؛ بله از کلاود 403 می‌دهد).
// دستورهای سبک را همان‌جا جواب می‌دهد؛ بقیه (مثل «گزارش») را در pending-commands.json صف می‌کند
// تا bale_bot.mjs روی لپ‌تاپ (هر ۱ دقیقه) اجرا و جوابش را در بله بفرستد.
// اسرار فقط از env (Actions Secrets) — هیچ توکنی در این فایل نیست.
const TG_TOKEN = process.env.TGTOKEN || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'najafibehzad/fardis-tenders';
const TG_API = 'https://api.telegram.org/bot' + TG_TOKEN;
const GHAPI = 'https://api.github.com/repos/' + REPO;
const TGOCHAT = '241301020'; // چت مالک در تلگرام (شناسه، نه رمز)
const SITE = 'https://najafibehzad.github.io/fardis-tenders';
const STATE_PATH = 'bale-cloud-state.json';
const QUEUE_PATH = 'pending-commands.json';
const HELP = [
  '🤖 بات گزارش فردیس (کانال ابری — تلگرام)',
  '',
  'گزارش — صف می‌شود؛ لپ‌تاپ به‌محض روشن شدن اجرا و PDF را در بله می‌فرستد',
  'وضعیت — وضعیت لپ‌تاپ، آخرین گزارش و سایت',
  'لینک — آدرس گزارش آنلاین',
  'تست — بررسی اتصال کلاود',
  'راهنما — همین فهرست',
  '',
  'نکته: وقتی لپ‌تاپ روشن است، پیام مستقیم در بله ۱ دقیقه‌ای جواب می‌گیرد.',
].join('\n');

const log = s => console.log(new Date().toISOString(), s);
const norm = t => String(t).replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const tail = (s, n = 300) => { s = String(s || '').trim(); return s.length > n ? '…' + s.slice(-n) : s; };
const b64 = o => Buffer.from(JSON.stringify(o, null, 1), 'utf8').toString('base64');

async function gh(method, path, body) {
  const r = await fetch(GHAPI + path, {
    method,
    headers: { Authorization: 'token ' + GH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'bale-cloud-bot', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  return { code: r.status, json: await r.json().catch(() => ({})) };
}
async function contentsGet(path) {
  const { code, json } = await gh('GET', `/contents/${path}?ref=main`);
  if (code === 404) return { data: null, sha: null };
  if (code !== 200) throw new Error('contents GET ' + path + ': ' + code);
  return { data: JSON.parse(Buffer.from(json.content, 'base64').toString('utf8')), sha: json.sha };
}
// transform روی دادهٔ تازهٔ فایل اعمال می‌شود؛ در تعارض sha، دوباره fetch و تلاش می‌کنیم
async function contentsUpdate(path, message, transform) {
  for (let i = 0; i < 4; i++) {
    const g = await contentsGet(path);
    const { code, json } = await gh('PUT', `/contents/${path}`, {
      message, branch: 'main', sha: g.sha || undefined, content: b64(transform(g.data)),
    });
    if (code >= 200 && code < 300) return;
    if (code !== 409 && code !== 422) throw new Error('contents PUT ' + path + ': ' + code + ' ' + tail(JSON.stringify(json)));
  }
  throw new Error('contents PUT ' + path + ': gave up after conflicts');
}
async function tgSend(chat, text) {
  const r = await fetch(TG_API + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 4000) }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('sendMessage: ' + (j.description || r.status));
}

async function laptopAlive() {
  try {
    const { code, json } = await gh('GET', '/actions/variables/LAPTOP_ALIVE');
    if (code !== 200) return 'نامشخص';
    const ageMin = (Date.now() - Number(json.value || 0)) / 60000;
    return ageMin < 4 ? 'روشن ✓' : 'خاموش/خواب (آخرین نشانه ' + Math.round(ageMin) + ' دقیقه پیش)';
  } catch { return 'نامشخص'; }
}
async function lastReportInfo() {
  try {
    const { json } = await gh('GET', '/commits?path=report.pdf&per_page=1');
    const c = json?.[0]?.commit?.committer?.date;
    return c ? new Date(c).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) : 'نامشخص';
  } catch { return 'نامشخص'; }
}

async function handle(text, reply) {
  const t = norm(text);
  if (t === '/start' || t === 'start' || ['راهنما', 'کمک', '/help', 'help'].includes(t)) return reply(HELP);
  if (['تست', 'ping', '/ping'].includes(t)) return reply('سبزم ✓ بات ابری (تلگرام) از سرور گیت‌هاب جواب داد.');
  if (['لینک', 'link', '/link'].includes(t)) return reply(`گزارش آنلاین: ${SITE}\nPDF: ${SITE}/report.pdf`);
  if (['وضعیت', '/status'].includes(t)) {
    const [alive, rep] = [await laptopAlive(), await lastReportInfo()];
    return reply(`لپ‌تاپ: ${alive}\nآخرین گزارش کامیت‌شده: ${rep}\nاجرای روزانه: هر روز ۱۵:۰۰ | بات بله (لپ‌تاپ): هر ۱ دقیقه`);
  }
  if (t.startsWith('گزارش') || t === '/report') {
    const job = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), text: text.trim(), from: 'telegram', ts: new Date().toISOString() };
    await contentsUpdate(QUEUE_PATH, 'bale-cloud: queue job',
      cur => [...(Array.isArray(cur) ? cur.filter(j => Date.now() - Date.parse(j.ts || 0) < 86400000) : []), job]);
    return reply('در صف گذاشتم ✅ لپ‌تاپ به‌محض روشن شدن اجرا می‌کند و نتیجه را در بله می‌فرستد. (اجرای ابری واکشی ستادیران ممکن نیست — بلاک IP خارجی)');
  }
  return reply('دستور را نفهمیدم؛ «راهنما» را بفرست.');
}

async function main() {
  if (!TG_TOKEN || !GH_TOKEN) throw new Error('missing env TGTOKEN/GITHUB_TOKEN');
  const state = (await contentsGet(STATE_PATH)).data || {};
  const u = new URL(TG_API + '/getUpdates');
  u.searchParams.set('timeout', '0');
  u.searchParams.set('limit', '20');
  if (state.offset) u.searchParams.set('offset', String(state.offset));
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('getUpdates: ' + (j.description || r.status));
  const ups = j.result || [];
  let replies = 0, lastId = 0;
  for (const up of ups) {
    const msg = up.message, text = msg?.text || '', chat = String(msg?.chat?.id ?? '');
    try {
      if (text && chat === TGOCHAT && replies < 10) await handle(text, async s => { await tgSend(chat, s); replies++; });
    } catch (e) { log('update ERR: ' + e.message); }
    lastId = up.update_id + 1;
  }
  if (lastId) await contentsUpdate(STATE_PATH, 'bale-cloud: offset', () => ({ offset: lastId }));
  log(`cloud poll n=${ups.length} replies=${replies}`);
}
main().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
