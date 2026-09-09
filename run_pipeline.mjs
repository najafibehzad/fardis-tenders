// اجرای کامل زنجیره گزارش — از پوشه ریشه پروژه: node run_pipeline.mjs [استان] [شهر]
// مثال: node run_pipeline.mjs تهران قدس
// اگر آرگومان ندی، پیش‌فرض البرز / فردیس است.
// خروجی: setadiran-data به‌روز، report.html، report.pdf، site/ (برای GitHub Pages)، summary.md
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const province = process.argv[2] || 'البرز';
const city = process.argv[3] || 'فردیس';

const run = (file, args = []) => {
  console.log('\n===== ' + file + ' ' + args.join(' ') + ' =====');
  const r = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('PIPELINE FAILED at ' + file + ' (exit ' + r.status + ')');
    process.exit(r.status || 1);
  }
};

console.log(`PIPELINE CITY: ${province} / ${city}`);

// ۱–۲) داده تازه از تابلوی اعلانات مرکزی + جزئیات کامل هر اگهی
run('fetch_announcements.js', [province, city]);
run('fetch_details.js');

// ۳–۵) گزارش: پاس اندازه‌گیری برای صفحه‌بندی، سپس نسخه نهایی
run('gen_city_report.js');
run('measure.js');
run('gen_city_report.js');

// ۶) کنترل کیفی قطعی (exit 1 روی خطا → workflow متوقف می‌شود)
run('qa_report.js');
fs.writeFileSync('.qa_ok', '1');

// ۷) رندر PDF
run('render.js');

// سایت Pages: همیشه آخرین گزارش در ریشه
fs.mkdirSync('site', { recursive: true });
fs.copyFileSync('report.html', 'site/index.html');
fs.copyFileSync('report.pdf', 'site/report.pdf');

// خلاصه متنی برای GitHub Actions job summary
try {
  const last = fs.readFileSync('setadiran-data/LAST.txt', 'utf8').trim();
  const items = JSON.parse(fs.readFileSync(`setadiran-data/${last}/final_data.json`, 'utf8'));
  const prevSet = fs.existsSync(`setadiran-data/${last}/prev_items.json`)
    ? new Set(JSON.parse(fs.readFileSync(`setadiran-data/${last}/prev_items.json`, 'utf8')).map(i => String(i.number)))
    : new Set();
  const tenders = items.filter(i => i.board === 'مناقصه' && i.tender);
  const services = items.filter(i => i.board === 'خرید' && i.purchase && i.purchase.kind === 'خدمت');
  const fresh = t => prevSet.size > 0 && !prevSet.has(String(t.number));
  const rows = tenders.map(t =>
    `| ${t.number} | ${String(t.title).replace(/\|/g, '/').slice(0, 90)} | ${t.org || ''} | ${t.docDeadline || ''} | ${fresh(t) ? '🆕 جدید' : ''} |`).join('\n');
  const summary = [
    `## گزارش ${province} / ${city} — آماده شد ✅`,
    '',
    `- مناقصه: **${tenders.length}** | استعلام خدمات: **${services.length}** | کل آگهی فعال: **${items.length}**`,
    `- گزارش PDF: \`report.pdf\` در ریپو | نسخه وب: صفحه Pages همین ریپو`,
    '',
    '| شماره مناقصه | موضوع | دستگاه | مهلت دریافت اسناد | وضعیت |',
    '|---|---|---|---|---|',
    rows,
    '',
  ].join('\n');
  fs.writeFileSync('summary.md', summary, 'utf8');
  console.log('SUMMARY written');
} catch (e) {
  console.log('SUMMARY-SKIP ' + e.message);
}
console.log('PIPELINE OK');
