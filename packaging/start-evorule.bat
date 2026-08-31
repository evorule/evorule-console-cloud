@echo off
rem ASCII-only on purpose: cmd batch parser is codepage-sensitive with non-ASCII text.
rem Chinese instructions live in README-STARTUP.txt (open with Notepad).
cd /d "%~dp0"
echo ================================================
echo   evorule demo   ^|   http://localhost:18080
echo ================================================
echo.
echo [1/3] Starting governance service (evorule-rule-serve, port 18081)...
start "evorule-rule" /min evorule-rule-serve.exe --db .\data\rule.db --port 18081 --secret evorule-demo-secret-2026 --admin-user admin --admin-password evorule-demo --allowed-origins http://localhost:18080,http://127.0.0.1:18080
echo [2/3] Starting main service (evorule-server, port 18080)...
start "evorule-server" /min evorule-server.exe --addr 127.0.0.1:18080 --web-dir web --rules-dir rules --service-registry service_registry.json --plugins plugin_manifest.json --wal-dir .\data\wal --wal-fsync
timeout /t 2 /nobreak >nul
echo [3/3] Opening browser...
start "" "http://localhost:18080"
echo.
echo SECURITY NOTE: this demo pack ships PUBLIC default credentials
echo   governance login: admin / evorule-demo
echo For real deployments, edit start-evorule.bat and change --admin-user,
echo --admin-password AND --secret BEFORE first start (see README-STARTUP.txt,
echo section "Safety Notice (Required Reading for Formal Deployment)").
echo.
echo Done. If the browser did not open, visit http://localhost:18080
echo To stop: close BOTH minimized windows ("evorule-server" and "evorule-rule") in the taskbar.
echo (For Chinese instructions, open README-STARTUP.txt)
echo.
pause
