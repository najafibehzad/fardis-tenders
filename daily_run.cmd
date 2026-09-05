@echo off
rem اجرای روزانه گزارش فردیس — توسط Task Scheduler فراخوانی می‌شود
setlocal
set TASKDIR=C:\Users\behzad\.zcode\workspace\default\fardis-tenders
set LOG=%TASKDIR%\task-run.log
echo ===== RUN %date% %time% =====>> "%LOG%"
"C:\Users\behzad\AppData\Local\hermes\git\usr\bin\bash.exe" -lc "cd /c/Users/behzad/.zcode/workspace/default/fardis-tenders && bash daily_chain.sh >> task-run.log 2>&1"
endlocal
