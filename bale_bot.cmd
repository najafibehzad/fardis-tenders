@echo off
rem بات دوطرفهٔ بله گزارش فردیس — تسک FardisBaleBot هر ۱ دقیقه این را صدا می‌زند
setlocal
set TASKDIR=C:\Users\behzad\.zcode\workspace\default\fardis-tenders
set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
cd /d "%TASKDIR%"
rem چرخش لاگ (فقط وقتی نمونهٔ قبلی در حال اجرا نیست)
for %%F in ("%TASKDIR%\bale-bot.log") do if %%~zF GTR 2000000 move /y "%TASKDIR%\bale-bot.log" "%TASKDIR%\bale-bot.log.old" >nul 2>&1
"C:\Users\behzad\AppData\Local\hermes\node\node.exe" bale_bot.mjs >> bale-bot.log 2>&1
endlocal
