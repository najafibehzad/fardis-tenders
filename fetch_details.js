#!/usr/bin/env node
// جزئیات کامل اگهی‌ها: مناقصه از etend، خرید/استعلام از eproc
// Usage: node fetch_details.js   (پوشه شهر از setadiran-data/LAST.txt خوانده می‌شود؛ آن را fetch_announcements می‌نویسد)
// خروجی: setadiran-data/<پوشه-شهر>/final_data.json
const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
// میزبان‌ها ثابت‌اند؛ توابع درخواست فقط «مسیر» می‌گیرند و اوریجن هرگز از ورودی نمی‌آید
const ETEND_ORIGIN = 'https://etend.setadiran.ir';
const EPROC_ORIGIN = 'https://eproc.setadiran.ir';

function request(u) {
  return new Promise((res, rej) => {
    const r = https.get(u, { headers: { 'User-Agent': UA } }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.setTimeout(40000, () => { r.destroy(); rej(new Error('timeout: ' + u.href)); });
  });
}
function etendGet(tenderId) {
  const u = new URL(ETEND_ORIGIN + '/etend/centralBoardTenderDetails-execute.action');
  u.searchParams.set('tenderId', String(tenderId));
  if (u.origin !== ETEND_ORIGIN || u.protocol !== 'https:') throw new Error('bad request target');
  return request(u);
}
function eprocGet(reqId) {
  const u = new URL(EPROC_ORIGIN + '/eproc/purchaseNeedViewBoardIntegration.do');
  u.searchParams.set('method', 'showNeedDetailInfo');
  u.searchParams.set('requestId', String(reqId));
  if (u.origin !== EPROC_ORIGIN || u.protocol !== 'https:') throw new Error('bad request target');
  return request(u);
}
const rootDir = path.resolve(process.cwd(), 'setadiran-data');
const lastPath = path.join(rootDir, 'LAST.txt');
if (!fs.existsSync(lastPath)) { console.error('first run fetch_announcements.js'); process.exit(1); }
const folder = fs.readFileSync(lastPath, 'utf8').trim();
// فقط حروف/اعداد/خط تیره — و مرز صریح: مسیر نهایی همیشه داخل ریشه setadiran-data می‌ماند
if (!/^[\p{L}\p{N}\-]{1,60}$/u.test(folder)) { console.error('bad folder name in LAST.txt'); process.exit(1); }
const outDir = path.resolve(rootDir, folder);
if (!outDir.startsWith(rootDir + path.sep)) { console.error('bad folder path'); process.exit(1); }
const itemsPath = path.join(outDir, 'all_items.json');
if (!fs.existsSync(itemsPath)) { console.error('no all_items.json — first run fetch_announcements.js'); process.exit(1); }
const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));

// شناسه عددی تمیز — هر شناسه از پاسخ API قبل از ساختن URL اعتبارسنجی می‌شود (ضد تزریق)
const cleanId = v => {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,15}$/.test(s) ? s : null;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = s => (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();

// ---------- پارس صفحه مناقصه (etend): مقادیر داخل input/textarea/select هستند ----------
function parseTender(html) {
  const g = {};
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
    const n = m[1], v = decode(m[2]);
    if (!g[n]) g[n] = v; else if (typeof g[n] === 'string') g[n] = [g[n], v]; else g[n].push(v);
  }
  for (const m of html.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) g[m[1]] = decode(m[2]);
  for (const m of html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g)) {
    const sel = [...m[0].matchAll(/<option[^>]*selected[^>]*>([^<]*)</g)].map(o => decode(o[1]));
    if (sel.length) g[m[1]] = sel.join(' | ');
  }
  const domains = [];
  const domSec = html.split('حوزه های فعالیت')[1] || '';
  for (const m of domSec.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(x => decode(x[1].replace(/<[^>]+>/g, '')));
    if (tds.length >= 3 && /^\d+$/.test(tds[0])) domains.push({ cls: tds[1], desc: tds[2] });
  }
  return { fields: g, domains };
}

// ---------- پارس صفحه خرید/استعلام (eproc): متن سمت سرور رندر شده ----------
function parseEproc(html) {
  const t = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const seg = t.replace(/<[^>]+>/g, '\u0001').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/\u0001+/g, '\u0001').split('\u0001').map(s => s.trim()).filter(Boolean);
  const out = { items: [], buyerNotes: '', desc: '', kind: '' };
  const gi = seg.findIndex(s => s.includes('شرح کلي نياز'));
  if (gi >= 0 && seg[gi + 1]) out.desc = seg[gi + 1];
  out.kind = seg.some(s => s.includes('اطلاعات خدمات مورد نياز')) ? 'خدمت' : 'کالا';
  const hdr = seg.findIndex(s => s === 'رديف');
  if (hdr >= 0) {
    for (let i = hdr + 1; i < seg.length; i++) {
      if (seg[i].includes('توضيحات خريدار')) break;
      if (/^\d+$/.test(seg[i]) && seg[i + 1]) {
        const row = seg.slice(i + 1, i + 6);
        if (row.length >= 5) out.items.push({ code: row[0], name: row[1], unit: row[2], qty: row[3], date: row[4] });
      }
    }
  }
  const bi = seg.findIndex(s => s.includes('توضيحات خريدار'));
  if (bi >= 0 && seg[bi + 1] && !seg[bi + 1].startsWith('صفحه')) out.buyerNotes = seg[bi + 1];
  return out;
}

(async () => {
  const data = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      const it = items[idx];
      const tableId = cleanId(it.tableId);
      const reqId = cleanId(it.reqId);
      const rec = {
        board: it.boardName, number: it.number, title: (it.title || '').replace(/\s+/g, ' ').trim(),
        org: it.orgName, province: it.provinceName, city: it.cityName,
        sendDeadline: it.jalaliSendDeadlineDate, docDeadline: it.jalaliDocumentDeadlineDate,
        basePrice: it.basePrice, tableId: tableId, reqId: reqId, needType: it.needType,
        orderIdx: typeof it.orderIdx === 'number' ? it.orderIdx : 999999,
      };
      try {
        if (it.boardName === 'مناقصه') {
          if (!tableId) { console.log('FAIL', it.number, 'bad tableId'); }
          else {
            const html = await etendGet(tableId);
            const p = parseTender(html); const f = p.fields;
            rec.tender = {
              subject: f['tenderDto.tender.subjectAllowedName'], setupType: f['tenderDto.tender.setupType'],
              registrar: f['tenderRegistrarEmployeeFullName'], postalCode: f['tenderDto.tender.postalCode'],
              address: f['tenderDto.tender.address'], desc: f['tenderDto.tender.description'],
              domainsDesc: f['tenderDto.tender.domainsDescription'],
              operationProvince: f['tenderDto.tender.tenderAdditionalInfo.operationProvinceId'],
              operationCity: f['tenderDto.tender.tenderAdditionalInfo.operationCityId'],
              financialEstimate: f['tenderDto.tender.financialEstimatePrice'],
              docsPrice: f['tenderDto.tender.tenderDocumentsPrice'],
              docsAccount: f['tenderDto.tender.tenderDocumentsPriceAccount.id'],
              guaranty: f['tenderDto.tender.guarantyPrice'], guarantyDesc: f['tenderDto.tender.guarantyDescription'],
              docDeadlineFull: (f['tenderDto.documentsDeadlineDateEx'] || '') + ' ' + (f['tenderDto.documentsDeadlineTimeEx'] || ''),
              proposalDeadlineFull: (f['tenderDto.proposalDeadlineDateEx'] || '') + ' ' + (f['tenderDto.proposalDeadlineTimeEx'] || ''),
              opening: (f['tenderDto.openingDateEx'] || '') + ' ' + (f['tenderDto.openingTimeEx'] || ''),
              validUntil: (f['tenderDto.offersValidDateEx'] || '') + ' ' + (f['tenderDto.offersValidTimeEx'] || ''),
              domains: p.domains,
            };
            rec.url = 'https://etend.setadiran.ir/etend/centralBoardTenderDetails-execute.action?tenderId=' + tableId;
            console.log('TENDER OK', tableId);
          }
        } else if (it.boardName === 'خرید' && it.needType === '1432' && reqId) {
          // فقط خدمات (1432) — کالا (1431) به درخواست کاربر حذف شده
          const html = await eprocGet(reqId);
          rec.purchase = parseEproc(html);
          rec.url = 'https://eproc.setadiran.ir/eproc/purchaseNeedViewBoardIntegration.do?method=showNeedDetailInfo&requestId=' + reqId;
          console.log('EPROC OK', reqId);
        } else if (it.boardName === 'خرید') {
          // کالا (1431) به درخواست کاربر حذف شده
          console.log('SKIP-KALA', reqId);
        }
      } catch (e) {
        console.log('RETRY', it.number, e.message);
        try { await sleep(800);
          if (it.boardName === 'مناقصه' && tableId) {
            const html = await etendGet(tableId);
            const p = parseTender(html); const f = p.fields;
            rec.tender = { subject: f['tenderDto.tender.subjectAllowedName'], setupType: f['tenderDto.tender.setupType'], registrar: f['tenderRegistrarEmployeeFullName'], postalCode: f['tenderDto.tender.postalCode'], address: f['tenderDto.tender.address'], desc: f['tenderDto.tender.description'], domainsDesc: f['tenderDto.tender.domainsDescription'], operationProvince: f['tenderDto.tender.tenderAdditionalInfo.operationProvinceId'], operationCity: f['tenderDto.tender.tenderAdditionalInfo.operationCityId'], financialEstimate: f['tenderDto.tender.financialEstimatePrice'], docsPrice: f['tenderDto.tender.tenderDocumentsPrice'], docsAccount: f['tenderDto.tender.tenderDocumentsPriceAccount.id'], guaranty: f['tenderDto.tender.guarantyPrice'], guarantyDesc: f['tenderDto.tender.guarantyDescription'], docDeadlineFull: (f['tenderDto.documentsDeadlineDateEx'] || '') + ' ' + (f['tenderDto.documentsDeadlineTimeEx'] || ''), proposalDeadlineFull: (f['tenderDto.proposalDeadlineDateEx'] || '') + ' ' + (f['tenderDto.proposalDeadlineTimeEx'] || ''), opening: (f['tenderDto.openingDateEx'] || '') + ' ' + (f['tenderDto.openingTimeEx'] || ''), validUntil: (f['tenderDto.offersValidDateEx'] || '') + ' ' + (f['tenderDto.offersValidTimeEx'] || ''), domains: p.domains };
            rec.url = 'https://etend.setadiran.ir/etend/centralBoardTenderDetails-execute.action?tenderId=' + tableId;
            console.log('TENDER OK(retry)', tableId);
          } else if (it.boardName === 'خرید' && reqId) {
            const html = await eprocGet(reqId);
            rec.purchase = parseEproc(html);
            rec.url = 'https://eproc.setadiran.ir/eproc/purchaseNeedViewBoardIntegration.do?method=showNeedDetailInfo&requestId=' + reqId;
            console.log('EPROC OK(retry)', reqId);
          }
        } catch (e2) { console.log('FAIL', it.number, e2.message); }
      }
      data[idx] = rec;
      await sleep(200);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const ordered = data.filter(Boolean);
  fs.writeFileSync(path.join(outDir, 'final_data.json'), JSON.stringify(ordered, null, 1), 'utf8');
  console.log('WROTE', path.join(outDir, 'final_data.json'),
    '| tender details:', ordered.filter(d => d.tender).length, '| purchase details:', ordered.filter(d => d.purchase).length);
})().catch(e => { console.error(e); process.exit(1); });
