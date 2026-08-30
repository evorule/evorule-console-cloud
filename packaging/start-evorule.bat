@echo off
rem ASCII-only on purpose: cmd batch parser is codepage-sensitive with non-ASCII text.
rem Chinese instructions live in README-STARTUP.txt (open with Notepad).
cd /d "%~dp0"
echo ================================================
echo   evorule demo   ^|   http://localhost:18080
echo ================================================
echo.
echo [1/2] Starting local server (evorule-server)...
start "evorule-server" /min evorule-server.exe --addr 127.0.0.1:18080 --web-dir web --rules-dir rules
timeout /t 2 /nobreak >nul
echo [2/2] Opening browser...
start "" "http://localhost:18080"
echo.
echo Done. If the browser did not open, visit http://localhost:18080
echo To stop: close the minimized "evorule-server" window in the taskbar.
echo (For Chinese instructions, open README-STARTUP.txt)
echo.
pause
