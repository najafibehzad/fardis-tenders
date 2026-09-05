#!/usr/bin/env bash
# زنجیره روزانه (توسط Task Scheduler از طریق daily_run.cmd اجرا می‌شود)
cd "$(dirname "$0")"
export CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
if node run_pipeline.mjs; then
  bash scheduled_push.sh
  node notify_send.mjs
else
  bash scheduled_push.sh || true
  node notify_send.mjs --alert "گزارش روزانه فردیس امروز ساخته نشد — جزئیات در task-run.log"
  exit 1
fi
