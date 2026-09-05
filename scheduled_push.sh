#!/usr/bin/env bash
# پوش نتایج روزانه به GitHub (توسط daily_run.cmd از Task Scheduler صدا زده می‌شود)
set -u
cd "$(dirname "$0")"

git add setadiran-data report.html report.pdf
if git diff --cached --quiet; then
  echo "PUSH-SKIP nothing new at $(date '+%Y-%m-%d %H:%M:%S')"
  exit 0
fi
git commit -q -m "daily report $(date +%Y-%m-%d)"
git pull --rebase -q origin main 2>/dev/null || true
if git -c credential.helper= -c credential.helper='!f(){ echo username=najafibehzad; echo "password=$(cat ~/.zcode/fardis-ghtoken)"; }; f' push origin main; then
  echo "PUSH-OK $(date '+%Y-%m-%d %H:%M:%S')"
else
  echo "PUSH-FAILED $(date '+%Y-%m-%d %H:%M:%S') (token expired? re-run device auth)"
  exit 1
fi
