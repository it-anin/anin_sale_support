@echo off
:: One existing Task runs both Pending and Stock through the supervisor.
:: Keep CRLF; ping also works when Task Scheduler runs without a desktop.
title ANIN Pending and Stock Agents
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   ANIN Pending and Stock Agents
echo ========================================
echo.

:loop
node promaxx-agents.mjs
echo.
echo [%date% %time%] Supervisor stopped (exit code %errorlevel%) - restarting in 10 seconds...
ping -n 11 127.0.0.1 > nul
goto loop
