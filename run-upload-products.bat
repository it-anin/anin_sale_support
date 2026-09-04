@echo off
:: Daily 08:30 via Task Scheduler, after R05.106.CSV is exported.
:: Keep this file pure ASCII - cmd.exe reads .bat in the system codepage,
:: so Thai comments here break parsing (chcp below only affects output).
title Upload Products (R05.106)
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   Upload Products (R05.106)
echo ========================================
echo.

node upload-products.mjs
set RC=%errorlevel%

echo.
if "%RC%"=="0" echo [OK] Done
if "%RC%"=="2" echo [SKIP] R05.106.CSV not updated today - data left unchanged
if "%RC%"=="1" echo [ERROR] Something went wrong. See above or upload-products.log

:: Report the real exit code to Task Scheduler (Last Run Result).
:: run-upload-stock.bat / run-upload-customer-history.bat do not, so they always show success.
exit /b %RC%
