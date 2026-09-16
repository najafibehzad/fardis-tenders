Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""C:\Users\behzad\.zcode\workspace\default\fardis-tenders"" && ""C:\Users\behzad\AppData\Local\hermes\node\node.exe"" bale_bot.mjs >> bale-bot.log 2>&1", 0, False
