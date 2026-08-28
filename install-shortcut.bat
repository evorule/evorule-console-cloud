@echo off
REM install-shortcut.bat — 桌面快捷入口(双击此文件创建桌面图标)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"
