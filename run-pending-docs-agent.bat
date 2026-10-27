@echo off
:: Agent หน้า "ตรวจสอบเอกสารค้าง" — Task Scheduler เรียกตอนเปิดเครื่อง (At startup) แล้วรันค้างไว้ตลอด
:: Agent หยุด/ล้ม → รอ 10 วิแล้วเปิดใหม่เอง
:: ใช้ ping หน่วงเวลาแทน timeout เพราะ timeout ใช้ไม่ได้ตอนรันแบบไม่มีหน้าจอ (Run whether user is logged on or not)
:: แล้วจะวนเปิดใหม่รัวๆ ไม่หยุด · ไฟล์นี้ต้องเป็น CRLF — label/goto ในไฟล์ LF ของ cmd.exe พังได้
title Pending Docs Agent
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   Pending Docs Agent
echo ========================================
echo.

:loop
node pending-docs-agent.mjs
echo.
echo [%date% %time%] Agent stopped (exit code %errorlevel%) - restarting in 10 seconds...
ping -n 11 127.0.0.1 > nul
goto loop
