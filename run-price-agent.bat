@echo off
:: Keep this file in CRLF format for Windows Task Scheduler.
title Price Agent
chcp 65001 > nul
cd /d "%~dp0"

:loop
node price-agent.mjs
echo [%date% %time%] Price Agent stopped (exit code %errorlevel%) - restarting in 10 seconds...
ping -n 11 127.0.0.1 > nul
goto loop
