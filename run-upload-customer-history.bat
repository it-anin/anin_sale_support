@echo off
:: ตั้ง Task Scheduler ให้รันวันละครั้ง หลัง export customer_history.csv เสร็จ
title Upload Customer History
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   Upload Customer History
echo ========================================
echo.

node upload-customer-history.mjs

echo.
if %errorlevel% == 0 (
    echo [OK] Done
) else (
    echo [ERROR] Something went wrong. See above.
)
