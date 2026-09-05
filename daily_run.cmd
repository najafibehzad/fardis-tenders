@echo off
rem اجرای روزانه گزارش فردیس — توسط Task Scheduler فراخوانی می‌شود
setlocal
set TASKDIR=C:\Users\behzad\.zcode\workspace\default\fardis-tenders
set LOG=%TASKDIR%\task-run.log
echo ===== RUN %date% %time% =====>> "%LOG%"
"C:\Users\behzad\AppData\Local\hermes\git\usr\bin\bash.exe" -lc "cd /c/Users/behzad/.zcode/workspace/default/fardis-tenders && CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe' node run_pipeline.mjs >> task-run.log 2>&1; bash scheduled_push.sh >> task-run.log 2>&1"
endlocal
