@echo off
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
