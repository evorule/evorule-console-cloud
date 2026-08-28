@echo off
REM SPDX-License-Identifier: AGPL-3.0-or-later
REM Copyright (C) 2026 EvoRule Project
REM stop-all.bat — 一键停止 evorule 全栈
REM 双击此文件即可(绕 PowerShell ExecutionPolicy 限制)

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"
